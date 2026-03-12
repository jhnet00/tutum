# D-8 Terraform IaC Implementation Guide (2026-03-12)

## 1. 작업 목적
- 수동으로 생성한 staging AWS 인프라를 Terraform state에 import해 이후 변경 이력을 코드로 관리한다.
- 대상은 `tutum.my` 현재 서비스 경로를 구성하는 core infra다.
- EKS cluster 자체는 Auto Mode/Karpenter 관리 범위라 import 대상에서 제외하고 data source로만 참조한다.

## 2. 적용 경로
- Terraform root: `terraform/`
- Modules:
  - `terraform/modules/networking`
  - `terraform/modules/security`
  - `terraform/modules/compute`
  - `terraform/modules/database`
  - `terraform/modules/dns`

## 3. State Backend
- S3 bucket: `tutum-terraform-state-903913341620`
- DynamoDB lock table: `tutum-terraform-locks`
- backend key: `staging/core-infra/terraform.tfstate`

`terraform/backend.tf`
```hcl
terraform {
  backend "s3" {
    bucket         = "tutum-terraform-state-903913341620"
    key            = "staging/core-infra/terraform.tfstate"
    region         = "ap-northeast-2"
    dynamodb_table = "tutum-terraform-locks"
    encrypt        = true
  }
}
```

## 4. Terraform Scope
### Included
- VPC `vpc-07de5077a86cac33f`
- Public/Private subnet 4개
- Internet Gateway 1개
- NAT Gateway 1개 + NAT EIP 1개
- Route table 3개 + default routes 3개 + association 4개
- VPC endpoint 5개
  - S3
  - ECR DKR
  - ECR API
  - Secrets Manager
  - STS
- Security Group 3개
  - `eks-cluster-sg-tutum-stg-eks-1483106172`
  - `tutum-rds-sg`
  - `tutum-monitoring-sg`
- EC2 1개
  - `tutum-monitoring`
- RDS 1개
  - `tutum-mariadb`
- DB subnet group 1개
- Route53 hosted zone 1개
  - `tutum.my`
- ACM certificate 1개
  - `*.tutum.my`

### Excluded
- EKS cluster / nodegroup / Karpenter resources
  - 이유: Auto Mode + controller 관리 범위
  - 처리: `data "aws_eks_cluster" "staging"` 로만 참조
- GuardDuty managed VPC endpoint
  - 리소스: `vpce-00bac47c533d6cc9d`
  - 이유: AWS service managed 리소스라 수동 IaC 범위에서 제외
- ALB / target group / k8s managed security group 리소스 자체
  - 현재 Terraform은 backend/managed LB SG ID를 참조만 한다

## 5. 파일 구성
```text
terraform/
├── backend.tf
├── imports.tf
├── locals.tf
├── main.tf
├── outputs.tf
├── provider.tf
├── terraform.tfvars.example
├── variables.tf
├── versions.tf
└── modules/
    ├── compute/
    ├── database/
    ├── dns/
    ├── networking/
    └── security/
```

## 6. 실행 순서
```bash
terraform -chdir=terraform init
terraform -chdir=terraform validate
terraform -chdir=terraform plan
terraform -chdir=terraform apply -auto-approve
terraform -chdir=terraform plan
```

실행 결과:
- `terraform init` 성공
- `terraform apply -auto-approve` -> `31 imported, 0 added, 0 changed, 0 destroyed`
- import 후 `terraform plan` -> `No changes`

## 7. import blocks
- `terraform/imports.tf`에 import block을 정의했다.
- 루트 모듈 기준 import 대상:
  - `module.networking.*`
  - `module.security.*`
  - `module.compute.aws_instance.monitoring`
  - `module.database.*`
  - `module.dns.*`

예시:
```hcl
import {
  to = module.networking.aws_vpc.this
  id = local.ids.vpc
}

import {
  to = module.database.aws_db_instance.this
  id = local.ids.rds_instance
}
```

## 8. 민감 정보 처리
- `terraform/terraform.tfvars`는 `.gitignore`에 추가했다.
- 현재 코드상 `db_password` 변수는 optional이며, import/plan 단계에서는 `null`로도 수렴 가능하다.
- RDS password를 실제 수정해야 할 경우에만 `terraform.tfvars` 또는 `TF_VAR_db_password`로 주입한다.

예시:
```bash
$env:TF_VAR_db_password="REPLACE_ME"
terraform -chdir=terraform plan
```

## 9. 산출물
- 주요 output:
  - `eks_cluster`
  - `networking`
  - `monitoring_instance`
  - `database`
  - `dns`
- 현재 state 기준 확인값:
  - monitoring EC2 private IP: `10.60.11.95`
  - RDS endpoint: `tutum-mariadb.cfoeqgoysp2f.ap-northeast-2.rds.amazonaws.com`
  - Route53 zone: `Z04669402IT42VPHL8CRP`

## 10. 남은 작업
1. prod account/infra를 위한 별도 Terraform stack 확장
2. GuardDuty managed endpoint를 IaC 범위에서 계속 제외할지 정책 확정
3. k8s managed SG/ALB와 Terraform 참조 관계를 문서화해 drift 대응 절차 정리
