# 2026-03-10 Istio Hub 수정 + MariaDB → RDS 이전 + Terraform IaC 계획

- 작업자: Kyungyoon Kim
- 작업 시간: 2026-03-10 (세션 연속)

---

## 1. Istio sidecar injector Hub 값 수정

### 문제

`istio-sidecar-injector` ConfigMap의 `values` 필드 내 `global.hub`가 `/istio`로 잘못 설정되어 있음.
→ Istio sidecar 이미지를 `/istio/proxyv2`로 찾아 `InvalidImageName` 오류 발생.

### 원인 분석

ConfigMap `values` 필드는 JSON string으로 중첩되어 있어 단순 kubectl patch로 접근 불가.
Python으로 JSON 역직렬화 → 값 수정 → 다시 직렬화하여 patch 필요.

```python
# 핵심 로직 (fix_istio_hub.py)
import json, subprocess

cm = json.loads(subprocess.check_output([
    'kubectl', 'get', 'configmap', 'istio-sidecar-injector',
    '-n', 'istio-system', '-o', 'json'
]))

values = json.loads(cm['data']['values'])
old_hub = values['global']['hub']  # '/istio'
values['global']['hub'] = '903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/istio'

patch = {'data': {'values': json.dumps(values)}}
subprocess.run(['kubectl', 'patch', 'configmap', 'istio-sidecar-injector',
                '-n', 'istio-system', '--type=merge', '-p', json.dumps(patch)])
```

> **주의**: Windows에서 `python3`는 Microsoft Store stub → 사용 불가. `.venv/Scripts/python` 사용.

### 결과

- `global.hub`: `/istio` → `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/istio`
- istiod는 ConfigMap을 동적으로 감지하므로 재시작 불필요
- 기존 `Init:InvalidImageName` 상태 Pod들 삭제 → 자동 재스케줄링 → 정상화

---

## 2. Karpenter NodePool private-only 고정

### 문제

Karpenter가 생성하는 EKS 노드가 퍼블릭 서브넷(10.60.1.x, 10.60.2.x)에 배치됨.
공인 IP 없이 IGW로만 라우팅 → ECR/Docker Hub 이미지 풀 불가 → Pod ImagePullBackOff.

### 근본 원인

`default` NodeClass에 퍼블릭 서브넷(`subnet-0937edf9855525b1b`, `subnet-0495c1c0ae546f02c`)이 포함됨.
`system` NodePool이 `default` NodeClass로 복귀하는 경우 발생.

### 수정

```bash
# default NodeClass에서 퍼블릭 서브넷 제거 → private subnets only
kubectl patch nodeclass default --type='json' -p='[
  {"op":"replace","path":"/spec/subnetSelectorTerms","value":[
    {"id":"subnet-09e82b994d4378ed4"},
    {"id":"subnet-012b272e47d6e6a07"}
  ]}
]'

# 기존 퍼블릭 서브넷 NodeClaim 삭제 → private subnet 노드로 재생성
kubectl delete nodeclaim <public-subnet-nodeclaims>
```

### 결과

- 모든 Karpenter 노드: private subnet (10.60.11.x, 10.60.12.x) NAT GW 경유
- tutum-app, tutum-data 전체 Pod: Running 2/2 (Istio sidecar 포함)

> **MEMORY 기록**: NodePool이 어떤 NodeClass로 돌아와도 `default` NodeClass 자체가 private-only이므로 퍼블릭 노드 생성 불가. ArgoCD가 NodeClass를 관리하지 않으므로 patch 영구 유지.

---

## 3. MariaDB → RDS 이전 (D-5 완료)

### 배경

회원 정보(users, portfolios)가 학원 서버 211.46.52.153:15432에 의존 → 학원 네트워크 의존성 제거.

### 작업 순서

#### 1) 인프라 생성

```bash
# RDS Security Group
aws ec2 create-security-group \
  --group-name tutum-rds-sg \
  --description "RDS MariaDB for tutum-stg" \
  --vpc-id vpc-07de5077a86cac33f
# → sg-0a8c73b3ea2d26143

# EKS Cluster SG → 3306 inbound
aws ec2 authorize-security-group-ingress \
  --group-id sg-0a8c73b3ea2d26143 \
  --protocol tcp --port 3306 \
  --source-group sg-0a819286b08c1162e  # eks-cluster-sg

# Monitoring EC2 SG → 3306 inbound (mysqldump 중계용)
aws ec2 authorize-security-group-ingress \
  --group-id sg-0a8c73b3ea2d26143 \
  --protocol tcp --port 3306 \
  --source-group sg-09bcd23950d81a5f0  # tutum-monitoring-sg

# DB Subnet Group
aws rds create-db-subnet-group \
  --db-subnet-group-name tutum-rds-subnet-group \
  --subnet-ids subnet-09e82b994d4378ed4 subnet-012b272e47d6e6a07

# RDS 생성
aws rds create-db-instance \
  --db-instance-identifier tutum-mariadb \
  --db-instance-class db.t3.micro \
  --engine mariadb --engine-version 10.11 \
  --master-username tutum_admin \
  --master-user-password Tutum2026RDS \
  --db-name team3 \
  --db-subnet-group-name tutum-rds-subnet-group \
  --vpc-security-group-ids sg-0a8c73b3ea2d26143 \
  --no-publicly-accessible \
  --storage-type gp3 --allocated-storage 20 \
  --backup-retention-period 7
```

#### 2) 데이터 이전 (monitoring EC2 경유)

학원 서버에서 직접 RDS로 연결 불가 → monitoring EC2(10.60.11.95)를 중계로 사용.

```bash
# SSM으로 monitoring EC2 접근
aws ssm start-session --target i-0a8cab5d5ce1cac60

# EC2에서 mysqldump + 복원 (base64 인코딩으로 특수문자 이슈 우회)
export MYSQL_PWD=Tutum2026RDS
mysqldump -h 211.46.52.153 -P 15432 -u team3 team3 > /tmp/team3_dump.sql
mysql -h tutum-mariadb.cfoeqgoysp2f.ap-northeast-2.rds.amazonaws.com \
      -u tutum_admin team3 < /tmp/team3_dump.sql
```

> **트러블슈팅**:
> - 비밀번호에 `!` 포함 시 bash 히스토리 확장으로 오류 → `Tutum2026RDS`로 재설정
> - EC2 Amazon Linux 2023: `apt` 없음 → `yum install -y mariadb105`
> - `nc` 없음 → `bash -c "echo >/dev/tcp/host/3306"` 으로 connectivity 확인
> - `.my.cnf` SSM 쿼팅 이슈 → `export MYSQL_PWD=...` 방식으로 우회

#### 3) Backend 환경변수 패치

```bash
kubectl patch secret backend-secret -n tutum-app --type=json -p='[
  {"op":"replace","path":"/data/MARIADB_HOST","value":"'$(echo -n "tutum-mariadb.cfoeqgoysp2f.ap-northeast-2.rds.amazonaws.com" | base64)'"},
  {"op":"replace","path":"/data/MARIADB_PORT","value":"'$(echo -n "3306" | base64)'"},
  {"op":"replace","path":"/data/MARIADB_USER","value":"'$(echo -n "tutum_admin" | base64)'"},
  {"op":"replace","path":"/data/MARIADB_PASSWORD","value":"'$(echo -n "Tutum2026RDS" | base64)'"}
]'
kubectl rollout restart deployment/backend -n tutum-app
```

#### 4) 결과

- users: 22 rows, portfolios 테이블 복원 완료
- backend rollout: SUCCESS (TCP 3306 연결 확인)
- 학원 서버 의존성 완전 제거 ✅

---

## 4. Terraform IaC 계획 수립 (D-8, 미구현)

### 목적

기존 수동 생성 AWS 인프라를 `terraform import`로 state에 등록 → 이후 변경은 코드로 관리.

### Import 대상

| 리소스 | ID |
|--------|-----|
| VPC | vpc-07de5077a86cac33f |
| Subnet ×4 | subnet-0937...(pub-2a), subnet-0495...(pub-2b), subnet-09e8...(prv-2a), subnet-012b...(prv-2b) |
| IGW | igw-03917cebd25167079 |
| NAT GW | nat-02d4de6a0d9b1cd72 |
| SG ×3 | eks-cluster-sg, tutum-rds-sg, tutum-monitoring-sg |
| EC2 | i-0a8cab5d5ce1cac60 (tutum-monitoring) |
| RDS | tutum-mariadb |
| Route53 Zone | Z04669402IT42VPHL8CRP (tutum.my) |
| ACM | cc8731ed-bd74-4ea4-a07b-897b6fbac78d (*.tutum.my) |
| VPC Endpoints ×4 | S3, ECR DKR, ECR API, Secrets Manager |

EKS는 `data` source로만 참조 (Auto Mode 복잡성).

### 디렉토리 구조

```
terraform/
├── versions.tf / backend.tf / variables.tf / main.tf / outputs.tf
├── terraform.tfvars          ← gitignore (RDS 비밀번호)
├── terraform.tfvars.example
└── modules/
    ├── networking/
    ├── security/
    ├── compute/
    ├── database/
    └── dns/
```

### State Backend

S3: `tutum-terraform-state-903913341620` / DynamoDB: `tutum-terraform-locks`

---

## 5. 현재 인프라 상태 요약

| 항목 | 상태 |
|------|------|
| Istio hub (sidecar injector) | ✅ ECR 경로 수정 완료 |
| Karpenter NodeClass default | ✅ private subnet only |
| 모든 Pod (tutum-app/data) | ✅ Running 2/2 |
| MariaDB → RDS | ✅ tutum-mariadb.cfoeqgoysp2f:3306 |
| backend-secret (MARIADB_*) | ✅ RDS 연결정보로 패치 완료 |
| Terraform IaC | ⬜ 미구현 (D-8 계획 완료) |

## 6. 다음 작업

1. **Terraform D-8**: S3 backend 생성 → 모듈 작성 → import 실행
2. **Kiali D-7**: Helm으로 istio-system에 설치, Mimir/Tempo/Grafana 연동
3. **SonarQube D-6**: 모니터링 EC2 docker-compose에 추가 또는 별도 EKS Pod
4. **MinIO → S3 D-4**: tutum-prod-storage 버킷 + IRSA + mc mirror
5. **E2E 검증**: 로그인/회원가입 RDS 연결 확인 (브라우저)
