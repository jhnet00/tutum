# 개발 로그 작업 요약 (2026-03-12)

## 1. 작업 요약
- 작업 일시: 2026-03-12
- 작업자: 김경윤
- 브랜치: `develop`
- 작업 목적: `AWS_MIGRATION_DETAIL_GUIDE.md`의 D-8 항목을 실제 Terraform 코드로 구현하고, staging AWS core infra를 state backend에 import한 뒤 `terraform plan -> No changes` 상태까지 수렴시킨다.

## 2. 상세 변경 사항
- Terraform 루트를 신규 작성했다.
  - `terraform/backend.tf`
  - `terraform/versions.tf`
  - `terraform/provider.tf`
  - `terraform/variables.tf`
  - `terraform/locals.tf`
  - `terraform/main.tf`
  - `terraform/imports.tf`
  - `terraform/outputs.tf`
  - `terraform/terraform.tfvars.example`
- Terraform module 5개를 추가했다.
  - `terraform/modules/networking/*`
  - `terraform/modules/security/*`
  - `terraform/modules/compute/*`
  - `terraform/modules/database/*`
  - `terraform/modules/dns/*`
- D-8 범위 리소스를 Terraform으로 코드화했다.
  - VPC / Subnet / IGW / NAT GW / NAT EIP
  - Route table 3개 / default route 3개 / association 4개
  - VPC endpoint 5개(S3, ECR DKR, ECR API, Secrets Manager, STS)
  - Security Group 3개
  - monitoring EC2 1개
  - RDS instance + DB subnet group
  - Route53 hosted zone + ACM certificate
  - EKS cluster는 `data "aws_eks_cluster" "staging"`으로만 참조했다.
- state backend를 실제 AWS backend로 연결했다.
  - S3 bucket: `tutum-terraform-state-903913341620`
  - DynamoDB lock table: `tutum-terraform-locks`
  - state key: `staging/core-infra/terraform.tfstate`
- import block 기반으로 state를 구성했다.
  - 총 31개 리소스를 `terraform apply -auto-approve`로 import했다.
- 관련 문서를 갱신했다.
  - `docs/plans/infra/D8_TERRAFORM_IAC_IMPLEMENTATION_GUIDE_2026-03-12.md`
  - `docs/plans/infra/AWS_MIGRATION_DETAIL_GUIDE.md`
- `.gitignore`를 보강했다.
  - `terraform/.terraform/`
  - `terraform/terraform.tfvars`
  - `terraform/*.tfplan`
  - `terraform/terraform_plan*.txt`
  - `.tools/`

## 3. 작업 중 발생 이슈 및 대응
- 이슈: 로컬 환경 PATH에 `terraform` 바이너리가 없었다.
- 대응: 저장소에는 포함하지 않고 worktree 하위 `.tools/terraform/terraform.exe`로 임시 설치해 검증에 사용했다.
- 이슈: VPC endpoint와 security group은 import 시 drift가 나기 쉬운 리소스다.
- 대응: 실제 AWS describe 결과를 기준으로 interface endpoint 보안 그룹, NAT/EIP, SG ingress/egress, route table/association을 코드에 맞췄다.
- 이슈: RDS password는 write-only 속성이라 IaC에 평문 커밋하면 안 된다.
- 대응: `db_password`를 optional variable로 두고, `terraform/terraform.tfvars`는 `.gitignore`에 추가했다.
- 이슈: GuardDuty managed endpoint가 동일 VPC에 존재한다.
- 대응: AWS service managed 리소스라 D-8 범위에서 제외했고, guide와 설명 문서에 제외 사유를 명시했다.

## 4. 결과
- Terraform 검증:
  - `terraform init` 성공
  - `terraform validate` 성공
  - import 전 `terraform plan` -> `31 to import, 0 to add, 0 to change, 0 to destroy`
  - `terraform apply -auto-approve` -> `31 imported, 0 added, 0 changed, 0 destroyed`
  - import 후 `terraform plan` -> `No changes. Your infrastructure matches the configuration.`
- state backend 검증:
  - S3 backend `tutum-terraform-state-903913341620`
  - DynamoDB table `tutum-terraform-locks`
- output 검증:
  - monitoring EC2 private IP -> `10.60.11.95`
  - RDS endpoint -> `tutum-mariadb.cfoeqgoysp2f.ap-northeast-2.rds.amazonaws.com`
  - Route53 zone -> `Z04669402IT42VPHL8CRP`
  - ACM cert -> `arn:aws:acm:ap-northeast-2:903913341620:certificate/cc8731ed-bd74-4ea4-a07b-897b6fbac78d`
- 문서 반영:
  - `AWS_MIGRATION_DETAIL_GUIDE.md`의 D-8 상태를 완료 기준으로 갱신했다.
  - `D8_TERRAFORM_IAC_IMPLEMENTATION_GUIDE_2026-03-12.md`를 추가했다.

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-12" --until="2026-03-12 23:59:59"
```

- 이번 작업과 직접 관련된 커밋:
  - `d1d07f0f` `feat(terraform): codify staging core aws infra`

## 6. 후속 작업/리스크
- prod 계정/리소스는 현재 D-8 stack 범위에 포함되지 않는다. prod Terraform stack은 별도 확장이 필요하다.
- GuardDuty managed endpoint와 k8s managed LB security group은 Terraform에서 참조만 하거나 제외하고 있다. 추후 범위를 넓힐지 정책 결정이 필요하다.
- EKS Auto Mode/Karpenter 리소스는 data source로만 참조한다. cluster/nodepool/controller 영역을 Terraform로 직접 관리할지 여부는 별도 설계가 필요하다.
- 이번 작업은 인프라 코드화/검증 작업이므로 별도 스크린샷은 첨부하지 않았다.
