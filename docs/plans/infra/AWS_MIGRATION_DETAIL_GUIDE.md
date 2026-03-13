# AWS Migration 세부 기술 가이드 — 온프레미스 K8s → EKS 이전

작성일: `2026-03-05`
참조: `AWS_MIGRATION_PLAN_2026-03-03.md`

> **이 문서의 목적**: 현재 VirtualBox 온프레미스 K8s 클러스터에서 실행 중인
> 모든 워크로드를 AWS EKS로 이전하는 **실제 마이그레이션 절차**를 단계별로 기술한다.
> "어떻게 설정하는가"가 아닌 **"무엇을 어떻게 옮기는가"** 에 집중.

---

## 0. 현재 상태 vs 이전 후 상태 비교

| 구분 | 현재 (온프레미스) | AWS 이전 후 |
|------|-----------------|------------|
| **VM 구성** | VirtualBox **8대** (cp-1/2/3 + worker1/2/3 + monitoring + mongodb) | EKS 관리형 클러스터 |
| **K8s 버전** | v1.29.15 (수동 kubeadm, Ubuntu 22.04.5, containerd 1.7.28) | EKS v1.29 (AWS 관리) |
| **노드 스펙** | CP: 192.168.0.220~222 / Worker: 192.168.0.223~225 (모두 Ready) | EKS Auto Mode (Bottlerocket, private subnet 전용) |
| **CNI** | Calico (tigera-operator) | AWS VPC CNI + Network Policy |
| **컨테이너 레지스트리** | ~~GitLab CR~~ → **ECR 전환 완료** (Phase C, 2026-03-06) | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/tutum/{frontend\|backend\|workers}` |
| **인그레스** | MetalLB VIP 192.168.0.240 + Istio IngressGateway | ALB (internet-facing) — Istio IngressGateway 제거 |
| **외부 HTTPS** | Cloudflare Tunnel → 192.168.0.240 | Route53 → ALB (가비아 네임서버를 Route53으로 변경, Cloudflare 미사용) |
| **Service Mesh** | Istio (istiod + IngressGateway, mTLS STRICT, tutum-app ns) | Istio minimal profile (istiod만, IngressGateway 제거, mTLS STRICT 유지) |
| **MongoDB** | K8s StatefulSet **3-replica** (tutum-data ns, PVC 30Gi×3, worker1/2/3 분산) + 독립 VM (192.168.0.231, v7.0.30) | EKS StatefulSet 정본 운영 + Atlas/legacy VM 의존 제거 |
| **MariaDB** | 211.46.52.153:15432 (학원 공인 IP) | **RDS 이전 완료** (D-5, 2026-03-10) — `tutum-mariadb.cfoeqgoysp2f.ap-northeast-2.rds.amazonaws.com:3306` |
| **Redis** | K8s StatefulSet 3-replica, Master+2Replica (tutum-data, PVC 5Gi×3) | EKS StatefulSet 그대로 이식 |
| **Kafka** | K8s StatefulSet KRaft 3-replica (tutum-data, PVC 20Gi×3, RF=3) | EKS StatefulSet 그대로 이식 |
| **Elasticsearch** | K8s StatefulSet 1-replica (tutum-data, PVC 30Gi) | EKS StatefulSet 그대로 이식 + S3 스냅샷 복원 |
| **MinIO** | K8s StatefulSet **4-pod** (tutum-storage, PVC 20Gi×4) | S3 버킷으로 대체 |
| **모니터링** | 독립 VM (192.168.0.230) Docker Compose — Grafana(3000), Loki(3100), Tempo(3200), Mimir(9009), InfluxDB(8086), Kiali(20001) | EC2 Docker Compose (EKS VPC private subnet) |
| **GitOps** | GitLab CI → ECR → ArgoCD (tutum-staging: develop, tutum-production: main) | GitLab CI → ECR → ArgoCD → EKS |
| **Autoscaling** | KEDA 5종 ScaledObject (backend 2-5, frontend 2-4, price/news/elastic consumer) | KEDA 그대로 이식 |
| **보안 정책** | Kyverno Enforce + Cosign (ECR 공개키 적용 완료, on-prem 적용 완료) | Kyverno + Cosign (EKS 재설치 필요) |
| **StorageClass** | local-path-provisioner | AWS EBS CSI gp3 |

### 변경 없는 항목 (이전 불필요)
- ~~MariaDB: 학원 공인 IP(211.46.52.153:15432), EKS에서도 NAT GW → 직접 TCP 연결~~ → **RDS 이전 완료** (D-5, 2026-03-10, tutum-mariadb.cfoeqgoysp2f.ap-northeast-2.rds.amazonaws.com:3306)
- GitLab: SaaS, CI/CD 파이프라인은 Phase C에서 이미 ECR 전환 완료
- DNS: AWS Route53 기준 레코드는 준비 완료, 최종 네임서버 컷오버는 Phase E에서 수행

### 이미 완료된 항목 (이전 작업에서 처리됨)
- **컨테이너 레지스트리**: GitLab CR → ECR 전환 완료 (`.gitlab-ci.yml`, kustomization.yaml, Cosign 키 재발급, Kyverno 정책 갱신)
- **Dockerfile Alpine**: backend/workers `python:3.11-alpine` 전환 완료
- **MongoDB**: 2026-03-12 기준 앱 정본을 Atlas에서 EKS in-cluster ReplicaSet(`mongodb-0~2`, `mongo-rs`)으로 전환 완료.
  `backend/auth/ocr`와 뉴스 파이프라인 secret까지 cutover했으며, 남은 작업은 local MongoDB 인증 적용, Atlas hidden writer/consumer 정리, legacy MongoDB VM(192.168.0.231) 종료

---

## 마이그레이션 로드맵

```
[현재] on-prem K8s                      [목표] AWS EKS
  ├─ tutum-app (backend/frontend/workers)  →  EKS tutum-app ns
  ├─ tutum-data (Redis, Kafka, MongoDB-backup) → EKS tutum-data ns
  ├─ tutum-storage (MinIO 4-pod)           →  S3 버킷
  ├─ monitoring VM (192.168.0.230 LGTM)    →  EC2 (EKS VPC private subnet)
  └─ Elasticsearch (K8s StatefulSet)        →  EKS StatefulSet (그대로 이식)

마이그레이션 순서:
Phase A (D+0~3)  : AWS 기반 준비 (계정, ECR, VPC 설계)               ← ✅ ECR/EKS 생성 완료, SSM 검증 완료           [5/8  63%]
Phase B (D+4~7)  : EKS 클러스터 구성 + 기존 addon 이식               ← 🔶 진행 중 (ALB/Istio/ArgoCD 완료, auth manifest 작성, KEDA/Runner/미러링 미완) [9/20 45%]
Phase C (D+8~12) : CI/CD 파이프라인 전환 + 스테이징 검증             ← 🔶 코드 완료, COSIGN키/파이프라인 실행 미완   [5/8  63%]
Phase D (D+13~18): 데이터 이전 (MongoDB/Kafka/ES/MinIO→S3/모니터링)  ← 🔶 RDS/모니터링/S3/Mongo cutover 완료, 나머지 미완 [9/19 47%]
Phase E (D+19~24): 트래픽 컷오버 + 온프레미스 철수                   ← 🔶 OAuth 콜백 완료, 전체 cutover는 미완          [1/9  11%]

전체 진행률: 29/64 ≈ 45%
```

---

## Phase A (D+0 ~ D+3): AWS 기반 준비

### A-1. 현재 클러스터 리소스 목록 추출 (이전 전 기준선 확보)

```bash
# 로컬 (cp-1 접속 후 실행)
ssh cp-1

# 네임스페이스별 리소스 스냅샷
kubectl get all -n tutum-app -o yaml > /tmp/tutum-app-snapshot.yaml
kubectl get all -n tutum-data -o yaml > /tmp/tutum-data-snapshot.yaml
kubectl get all -n tutum-storage -o yaml > /tmp/tutum-storage-snapshot.yaml

# PVC 목록 (데이터 마이그레이션 대상 확인)
kubectl get pvc -A
# 중요 PVC:
#   tutum-data/data-redis-0~2       → Redis AOF/RDB (이식 가능)
#   tutum-data/data-kafka-0~2       → Kafka 로그 (오프셋 관리 필요)
#   tutum-storage/data-minio-0~3    → MinIO 데이터 → S3 이전
#   tutum-data/mongodb-backup-pvc   → Atlas 백업본 (별도 처리)

# Secret 목록 (EKS에서 재생성 필요한 것들)
kubectl get secrets -A --no-headers | grep -v 'kubernetes.io/service-account'
```

---

### A-2. ECR 리포지토리 생성 (GitLab CR 대체)

```bash
# ✅ 이미 완료 (2026-03-06) — 실제 생성된 ECR 레포지토리:
# 903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/tutum/frontend
# 903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/tutum/backend
# 903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/tutum/workers

# 참고: 계획 문서에 tutum-app/* 로 표기되어 있으나 실제 생성은 tutum/* 경로 사용
# GitLab CR 경로 → ECR 경로 매핑 (실제):
# registry.gitlab.com/tutum-project/tutum-app/backend/frontend → tutum/frontend
# registry.gitlab.com/tutum-project/tutum-app/backend          → tutum/backend
# registry.gitlab.com/tutum-project/tutum-app/backend/workers  → tutum/workers

REGION="ap-northeast-2"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)  # 903913341620

for repo in tutum/frontend tutum/backend tutum/workers; do
  aws ecr create-repository \
    --repository-name "$repo" \
    --region "$REGION" \
    --image-scanning-configuration scanOnPush=true \
    --encryption-configuration encryptionType=AES256
done

echo "ECR: ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
```

---

### A-3. 기존 이미지를 ECR로 복제 (전환 전 미리 당겨놓기)

> ⬜ **미완료** — Phase C에서 `.gitlab-ci.yml`을 ECR 전환 완료했으나, 파이프라인 실행 전
> 초기 이미지 적재는 아직 하지 않음. 파이프라인 첫 실행으로 대체 가능.

```bash
# GitLab CR에서 최신 이미지를 ECR로 미러링 (선택사항: 파이프라인 첫 실행으로 대체 가능)
GITLAB_REG="registry.gitlab.com/tutum-project/tutum-app/backend"
ECR_REG="903913341620.dkr.ecr.ap-northeast-2.amazonaws.com"

# GitLab 로그인
echo "$GITLAB_PAT" | docker login registry.gitlab.com -u sj1202pak --password-stdin

# ECR 로그인
aws ecr get-login-password --region ap-northeast-2 \
  | docker login --username AWS --password-stdin "$ECR_REG"

# 현재 on-prem 운영 태그 확인 (cp-1에서)
CURRENT_TAG=$(kubectl get deployment backend -n tutum-app \
  -o jsonpath='{.spec.template.spec.containers[0].image}' | cut -d: -f2)
echo "현재 운영 태그: $CURRENT_TAG"   # 예: stg-8a1321de

# 이미지 재태깅 및 ECR push (실제 ECR 경로: tutum/*)
for svc in backend frontend workers; do
  docker pull "${GITLAB_REG}/${svc}:${CURRENT_TAG}" 2>/dev/null || \
  docker pull "${GITLAB_REG}/backend/${svc}:${CURRENT_TAG}"

  docker tag "${GITLAB_REG}/${svc}:${CURRENT_TAG}" \
             "${ECR_REG}/tutum/${svc}:${CURRENT_TAG}"
  docker push "${ECR_REG}/tutum/${svc}:${CURRENT_TAG}"
done
```

---

### A-4. GitLab CI/CD 변수 업데이트

GitLab → Settings → CI/CD → Variables:

| 기존 변수 | 변경 | 새 값 |
|-----------|------|-------|
| `CI_REGISTRY` | 제거 (GitLab CR) | - |
| `CI_REGISTRY_USER` | 제거 | - |
| `CI_REGISTRY_PASSWORD` | 제거 | - |
| - | **신규** `AWS_ACCESS_KEY_ID` | IAM 키 (CI용) |
| - | **신규** `AWS_SECRET_ACCESS_KEY` | IAM 시크릿 |
| - | **신규** `ECR_REGISTRY` | `{ACCOUNT_ID}.dkr.ecr.ap-northeast-2.amazonaws.com` |

IAM 최소 권한 정책 (CI/CD용 — ECR push 전용):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "*"
    }
  ]
}
```

---

### A-5. VPC 설계 확정

> ✅ **이미 완료** — VPC, 서브넷, IGW, 라우트 테이블 생성 완료

```
EKS VPC (단일):  10.60.0.0/16
  - Public Subnet A  10.60.1.0/24 (ap-northeast-2a) — ALB, NAT GW
  - Public Subnet B  10.60.2.0/24 (ap-northeast-2b) — ALB (Multi-AZ)
  - Private Subnet A 10.60.11.0/24 (ap-northeast-2a) — EKS Auto Mode 노드, Monitoring EC2
  - Private Subnet B 10.60.12.0/24 (ap-northeast-2b) — EKS Auto Mode 노드
  - EKS 내 pod: GitLab Runner (gitlab-runner ns), ArgoCD (argocd ns), ALB Controller (kube-system)
온프레미스: 192.168.0.0/24 (참고용, 직접 연결 없음)
외부:       211.46.52.153/32 (학원 MariaDB, NAT GW 경유 outbound)

[라우팅]
  Public Subnet RT:  0.0.0.0/0 → Internet Gateway
  Private Subnet RT: 0.0.0.0/0 → NAT Gateway (10.60.1.x에 배치)
```

---

### A-6. NAT Gateway 생성 + Route Table 설정

> ✅ **VPC 생성 시 함께 완료** — 아래 CLI로 현황 확인 후 없으면 생성

```bash
VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=cidr-block,Values=10.60.0.0/16" \
  --query 'Vpcs[0].VpcId' --output text)

# 현재 NAT GW 상태 확인
aws ec2 describe-nat-gateways \
  --filter "Name=vpc-id,Values=$VPC_ID" \
  --query 'NatGateways[*].{ID:NatGatewayId,State:State,Subnet:SubnetId}' \
  --output table

# NAT GW가 없는 경우: EIP 할당 + NAT GW 생성 (Public Subnet A)
PUBLIC_SUBNET_A=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=cidr-block,Values=10.60.1.0/24" \
  --query 'Subnets[0].SubnetId' --output text)

EIP_ALLOC=$(aws ec2 allocate-address --domain vpc \
  --query 'AllocationId' --output text)

NAT_GW_ID=$(aws ec2 create-nat-gateway \
  --subnet-id "$PUBLIC_SUBNET_A" \
  --allocation-id "$EIP_ALLOC" \
  --tag-specifications 'ResourceType=natgateway,Tags=[{Key=Name,Value=tutum-nat-gw}]' \
  --query 'NatGateway.NatGatewayId' --output text)

# NAT GW 활성화 대기 (~60초)
aws ec2 wait nat-gateway-available --nat-gateway-ids "$NAT_GW_ID"

# Private Subnet Route Table에 기본 경로(0.0.0.0/0) → NAT GW 추가
PRIVATE_SUBNET_A=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=cidr-block,Values=10.60.11.0/24" \
  --query 'Subnets[0].SubnetId' --output text)

PRIVATE_RT=$(aws ec2 describe-route-tables \
  --filters "Name=vpc-id,Values=$VPC_ID" \
            "Name=association.subnet-id,Values=$PRIVATE_SUBNET_A" \
  --query 'RouteTables[0].RouteTableId' --output text)

aws ec2 create-route \
  --route-table-id "$PRIVATE_RT" \
  --destination-cidr-block 0.0.0.0/0 \
  --nat-gateway-id "$NAT_GW_ID"

# 검증: EKS 노드(private subnet)에서 인터넷 outbound 가능한지 확인
# kubectl run test-net --image=busybox --rm -it --restart=Never -- wget -qO- https://google.com
```

> **NAT GW 비용 절감**: B-10 VPC Endpoints(ECR DKR, Secrets Manager) 적용 시
> ECR pull 트래픽이 NAT GW 우회 → NAT GW 비용 ~$15/월 절감 가능

---

## Phase B (D+4 ~ D+7): EKS 클러스터 구성

### B-1. EKS 클러스터 생성

> ✅ **이미 완료 (2026-03-06)** — 실제 생성된 클러스터 정보:
>
> | 항목 | 실제 값 |
> |------|---------|
> | 클러스터명 | `tutum-stg-eks` (스테이징), `tutum-prd-eks` (프로덕션) |
> | 리전 | ap-northeast-2 |
> | K8s 버전 | v1.29 |
> | 노드 타입 | **EKS Auto Mode** (Bottlerocket, managed by Karpenter NodePool) |
> | VPC CIDR | **10.60.0.0/16** |
> | Public 서브넷 | 10.60.1.0/24 (ap-northeast-2a), 10.60.2.0/24 (ap-northeast-2b) |
> | Private 서브넷 | 10.60.11.0/24 (ap-northeast-2a), 10.60.12.0/24 (ap-northeast-2b) |
> | 인증 모드 | API (aws-auth ConfigMap 없음, access entries 방식) |
> | OIDC | 활성화 (IRSA 사용) |
> | 노드 그룹 | `ng-stg-general` (STG) |
>
> **주의**: Auto Mode 노드는 **private subnet 전용**으로 NodeClass 패치 완료.
> public subnet(10.60.1.x, 10.60.2.x)에 배치되면 NAT 없이 IGW → 인터넷 불가.
> (이미 NodeClass `default` → private subnet만 사용하도록 수정됨)

온프레미스와 동일한 K8s v1.29, 네임스페이스 구조 유지.

```bash
# EKS Auto Mode는 AWS 콘솔에서 생성 (eksctl 불필요)
# 또는 eksctl v0.224.0+ 에서 Auto Mode 지원:

# kubeconfig 업데이트
aws eks update-kubeconfig --region ap-northeast-2 --name tutum-stg-eks
kubectl get nodes  # Auto Mode Bottlerocket 노드 Ready 확인

# access entry 추가 (API 인증 모드에서 사용자 추가 방법)
aws eks create-access-entry \
  --cluster-name tutum-stg-eks \
  --principal-arn arn:aws:iam::903913341620:user/sj1202pak \
  --region ap-northeast-2
aws eks associate-access-policy \
  --cluster-name tutum-stg-eks \
  --principal-arn arn:aws:iam::903913341620:user/sj1202pak \
  --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy \
  --access-scope type=cluster \
  --region ap-northeast-2
```

---

### B-2. 기존 네임스페이스 + 시크릿 재생성

온프레미스와 동일한 네임스페이스 구조 유지.

```bash
# 네임스페이스 생성
kubectl create namespace tutum-app
kubectl create namespace tutum-data
kubectl create namespace tutum-storage

# 현재 on-prem에서 시크릿 내용 추출 (cp-1에서)
kubectl get secret app-secrets -n tutum-app -o jsonpath='{.data}' | python3 -c "
import json, sys, base64
data = json.load(sys.stdin)
for k, v in data.items():
    print(f'{k}={base64.b64decode(v).decode()}')
"
# → .env 파일 형태로 출력 → EKS에서 동일하게 재생성

# 시크릿 재생성 (EKS에서)
kubectl create secret generic app-secrets \
  --from-env-file=backend/.env \
  -n tutum-app

# ECR 이미지 풀 시크릿 (EKS에서 ECR은 IRSA로 자동 인증 가능)
# → imagePullSecrets 불필요 (EKS worker 노드 IAM Role이 ECR 접근 권한 포함)
```

---

### B-3. Istio 이식 — mTLS STRICT 그대로 유지

> ✅ **이미 완료 (2026-03-06)** — `istioctl install --set profile=minimal -y` 로 EKS에 설치
> - istiod만 설치 (IngressGateway 제거 — ALB가 대체)
> - 사이드카 주입 활성화: `tutum-app`, `tutum-data` 네임스페이스
>
> 온프레미스 현재 상태:
> - istiod + **istio-ingressgateway** 둘 다 Running (MetalLB VIP 192.168.0.240 사용 중)
> - PeerAuthentication mTLS STRICT (tutum-app ns) 적용 완료

현재 on-prem의 Istio 구성(PeerAuthentication mTLS STRICT)을 EKS에 이식.
IngressGateway는 MetalLB IP 대신 ALB로 교체됨.

```bash
# ✅ EKS에 이미 설치됨 (minimal profile)
istioctl install --set profile=minimal -y

# 네임스페이스 사이드카 주입 활성화 (✅ 완료)
kubectl label namespace tutum-app istio-injection=enabled
kubectl label namespace tutum-data istio-injection=enabled

# 기존 PeerAuthentication (mTLS STRICT) 적용
kubectl apply -f k8s-manifests/base/security/peer-authentication.yaml
```

on-prem vs EKS 트래픽 구조:
```
[온프레미스 현재]
  Client → Cloudflare Tunnel → 192.168.0.240 (MetalLB)
         → Istio IngressGateway → VirtualService → Service → Envoy Sidecar → Pod

[EKS 이전 후]
  Client → Route53 (tutum.my) → ALB
         → ALB → K8s Service → Envoy Sidecar → Pod (mTLS STRICT 유지)
         (Cloudflare 미사용 — 가비아 네임서버를 Route53으로 변경하여 직접 라우팅)
         (Istio IngressGateway 불필요 — ALB가 외부 진입점 역할)
```

---

### B-4. ALB Ingress Controller 설치

> ✅ **이미 완료 (2026-03-06)** — `eks/aws-load-balancer-controller v3.1.0` 설치 완료
> - 2/2 Running (system nodes, CriticalAddonsOnly toleration 추가)
> - IRSA: AWSLoadBalancerControllerIAMPolicy 연결 완료
> - ACM `*.tutum.my` 인증서 발급 신청 완료 (Route53 DNS validation, PENDING_VALIDATION → 자동 ISSUED 대기)
> - subnet 태그: public(kubernetes.io/role/elb=1), private(kubernetes.io/role/internal-elb=1)

```bash
# ✅ 완료됨 — 참고용
# IRSA 생성 (ALB Controller용)
eksctl create iamserviceaccount \
  --cluster=tutum-stg-eks \
  --namespace=kube-system \
  --name=aws-load-balancer-controller \
  --attach-policy-arn=arn:aws:iam::903913341620:policy/AWSLoadBalancerControllerIAMPolicy \
  --approve

# Helm 설치
helm repo add eks https://aws.github.io/eks-charts && helm repo update
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=tutum-eks \
  --set serviceAccountName=aws-load-balancer-controller

# Ingress 매니페스트 생성 (k8s-manifests/base/ingress/alb-ingress.yaml)
# 기존 Istio Gateway 매니페스트 옆에 추가
cat > k8s-manifests/base/ingress/alb-ingress.yaml << 'EOF'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: tutum-alb
  namespace: tutum-app
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP":80},{"HTTPS":443}]'
    alb.ingress.kubernetes.io/ssl-redirect: '443'
    # ACM 인증서로 ALB에서 TLS 처리 (Cloudflare 미사용)
spec:
  rules:
    - http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 80
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: backend
                port:
                  number: 8000
EOF
```

---

### B-5. KEDA 이식 — 기존 ScaledObject 그대로 사용

> ⬜ **미완료** — on-prem KEDA는 정상 운영 중, EKS에 아직 미설치

on-prem KEDA 현재 상태 (참고):
| ScaledObject | 타겟 | min | max | 트리거 |
|---|---|---|---|---|
| backend-scaledobject | backend | 2 | 5 | CPU 70% |
| frontend-scaledobject | frontend | 2 | 4 | CPU |
| price-consumer-scaledobject | price-consumer | 1 | 5 | Kafka lag |
| news-consumer-scaledobject | news-consumer | 1 | 4 | Kafka lag |
| elastic-consumer-scaledobject | elastic-consumer | 0 | 3 | Kafka lag |

```bash
# KEDA Helm 설치 (on-prem 버전 확인)
kubectl get deployment keda-operator -n keda \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
# 버전 확인 후 동일 버전으로 EKS에 설치

helm repo add kedacore https://kedacore.github.io/charts && helm repo update
helm install keda kedacore/keda -n keda --create-namespace \
  --version 2.x.x   # on-prem 버전과 동일

# 기존 ScaledObject 그대로 적용
kubectl apply -f k8s-manifests/base/autoscaling/
# bootstrapServers: kafka-bootstrap.tutum-data.svc:9092 → EKS에서도 동일 서비스명 사용
```

---

### B-6. Kyverno + Cosign 재구성 (GitLab CR → ECR)

현재 on-prem에서는 GitLab CR 이미지 서명 검증. EKS에서는 ECR 이미지 검증으로 전환.

```bash
# Kyverno 설치
helm repo add kyverno https://kyverno.github.io/kyverno && helm repo update
helm install kyverno kyverno/kyverno -n kyverno --create-namespace

# Cosign 새 키 생성 (ECR 전환 시 키도 교체 권장)
cosign generate-key-pair
# → cosign.key (GitLab CI 변수 COSIGN_PRIVATE_KEY 업데이트)
# → cosign.pub (아래 policy에 삽입)

# cosign-verify-policy.yaml 수정 포인트:
# 1. imageReferences: GitLab CR URI → ECR URI로 변경
# 2. publicKeys: 새 cosign.pub 내용으로 교체
# 3. secret 참조: ecr-registry-secret으로 변경
```

`k8s-manifests/kyverno/cosign-verify-policy.yaml` 수정:
```yaml
verifyImages:
  - imageReferences:
      # 변경 전: "registry.gitlab.com/tutum-project/tutum-app/*"
      - "${ACCOUNT_ID}.dkr.ecr.ap-northeast-2.amazonaws.com/tutum/*"
    attestors:
      - entries:
          - keys:
              publicKeys: |-
                -----BEGIN PUBLIC KEY-----
                (cosign generate-key-pair로 새로 생성한 pub key)
                -----END PUBLIC KEY-----
```

ECR auth token 자동 갱신 (12시간 만료 대응):
```yaml
# k8s-manifests/kyverno/ecr-token-refresh.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: ecr-token-refresh
  namespace: kyverno
spec:
  schedule: "0 */6 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: ecr-refresher
          restartPolicy: OnFailure
          containers:
            - name: refresh
              image: amazon/aws-cli:latest
              env:
                - name: ECR_REGISTRY
                  value: "${ACCOUNT_ID}.dkr.ecr.ap-northeast-2.amazonaws.com"
              command:
                - /bin/sh
                - -c
                - |
                  TOKEN=$(aws ecr get-login-password --region ap-northeast-2)
                  kubectl create secret docker-registry ecr-registry-secret \
                    --docker-server="$ECR_REGISTRY" \
                    --docker-username=AWS \
                    --docker-password="$TOKEN" \
                    -n kyverno --dry-run=client -o yaml | kubectl apply -f -
```

---

### B-7. ArgoCD 이식 — 기존 앱 정의 재사용

> ✅ **ArgoCD 설치 완료 (2026-03-06)** — 7/7 Running (EKS private subnet 10.60.11.x)
> - kubectl apply --server-side (CRD 크기 제한 우회)
> - ArgoCD 설치 방법: stable manifest kubectl apply (Helm 아님)
>
> ⬜ **미완료**: GitLab 리포 연결, staging-app.yaml destination 변경

```bash
# ArgoCD 설치 (stable manifest, kubectl apply)
kubectl create namespace argocd
kubectl apply -n argocd --server-side \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# ArgoCD admin 비밀번호 확인
kubectl get secret argocd-initial-admin-secret -n argocd \
  -o jsonpath='{.data.password}' | base64 -d

# GitLab 리포 연결 (미완료)
argocd login <argocd-server-url> --username admin --password <pw> --insecure
argocd repo add https://gitlab.com/tutum-project/tutum-app/backend \
  --username sj1202pak --password "$GITLAB_PAT"
```

`k8s-manifests/argocd/staging-app.yaml` — destination 변경 필요:
```yaml
# 변경 전 (on-prem ArgoCD)
spec:
  destination:
    server: https://192.168.0.220:6443   # cp-1 API server

# 변경 후 (EKS 내부에서 자기 자신)
spec:
  destination:
    server: https://kubernetes.default.svc  # ArgoCD가 EKS 내부에 있을 경우
```

EKS API endpoint 조회:
```bash
aws eks describe-cluster --name tutum-stg-eks \
  --query 'cluster.endpoint' --output text
```

---

### B-8. NetworkPolicy 이식

> ✅ **이미 완료 (2026-03-06)**

```bash
# AWS VPC CNI Network Policy Engine 활성화
aws eks update-addon \
  --cluster-name tutum-stg-eks \
  --addon-name vpc-cni \
  --configuration-values '{"enableNetworkPolicy": "true"}'

# 기존 NetworkPolicy 매니페스트 그대로 적용
kubectl apply -f k8s-manifests/base/security/network-policy.yaml
```

---

### B-9. NACL (Public Subnet 방화벽)

> ⬜ **미완료** — Public subnet 단위 Stateless 방화벽. SG와 별개 계층.

```bash
VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=cidr,Values=10.60.0.0/16" \
  --query 'Vpcs[0].VpcId' --output text)

# Public subnet NACL 생성
NACL_ID=$(aws ec2 create-network-acl \
  --vpc-id "$VPC_ID" \
  --tag-specifications 'ResourceType=network-acl,Tags=[{Key=Name,Value=tutum-public-nacl}]' \
  --query 'NetworkAcl.NetworkAclId' --output text)

# Inbound: HTTPS(443), HTTP(80), Ephemeral(1024-65535) 허용, 나머지 Deny
aws ec2 create-network-acl-entry --network-acl-id "$NACL_ID" \
  --rule-number 100 --protocol tcp --rule-action allow --ingress \
  --cidr-block 0.0.0.0/0 --port-range From=443,To=443
aws ec2 create-network-acl-entry --network-acl-id "$NACL_ID" \
  --rule-number 110 --protocol tcp --rule-action allow --ingress \
  --cidr-block 0.0.0.0/0 --port-range From=80,To=80
aws ec2 create-network-acl-entry --network-acl-id "$NACL_ID" \
  --rule-number 120 --protocol tcp --rule-action allow --ingress \
  --cidr-block 0.0.0.0/0 --port-range From=1024,To=65535
# Outbound: all allow (응답 트래픽)
aws ec2 create-network-acl-entry --network-acl-id "$NACL_ID" \
  --rule-number 100 --protocol -1 --rule-action allow --egress \
  --cidr-block 0.0.0.0/0

# Public subnet에 연결
PUBLIC_SUBNET_A=$(aws ec2 describe-subnets \
  --filters "Name=cidr,Values=10.60.1.0/24" \
  --query 'Subnets[0].SubnetId' --output text)
PUBLIC_SUBNET_B=$(aws ec2 describe-subnets \
  --filters "Name=cidr,Values=10.60.2.0/24" \
  --query 'Subnets[0].SubnetId' --output text)
aws ec2 replace-network-acl-association \
  --network-acl-id "$NACL_ID" --association-id <existing-assoc-id>
```

---

### B-10. VPC Endpoints (ECR, S3, Secrets Manager — 인터넷 미경유)

> ⬜ **미완료** — 현재 ECR pull이 NAT GW → 인터넷 경유. Endpoint 생성 시 내부망 통신.
> ECR DKR Endpoint: NAT GW 데이터 전송 비용 절감 (GB당 $0.045 절약)

```bash
VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=cidr,Values=10.60.0.0/16" \
  --query 'Vpcs[0].VpcId' --output text)

# EKS 노드 SG 조회 (Auto Mode 노드 SG)
NODE_SG=$(aws ec2 describe-security-groups \
  --filters "Name=tag:aws:eks:cluster-name,Values=tutum-stg-eks" \
  --query 'SecurityGroups[0].GroupId' --output text)

PRIVATE_SUBNET_A=$(aws ec2 describe-subnets \
  --filters "Name=cidr,Values=10.60.11.0/24" \
  --query 'Subnets[0].SubnetId' --output text)
PRIVATE_SUBNET_B=$(aws ec2 describe-subnets \
  --filters "Name=cidr,Values=10.60.12.0/24" \
  --query 'Subnets[0].SubnetId' --output text)

# 1. ECR API Endpoint (Interface)
aws ec2 create-vpc-endpoint \
  --vpc-id "$VPC_ID" \
  --service-name com.amazonaws.ap-northeast-2.ecr.api \
  --vpc-endpoint-type Interface \
  --subnet-ids "$PRIVATE_SUBNET_A" "$PRIVATE_SUBNET_B" \
  --security-group-ids "$NODE_SG" \
  --private-dns-enabled \
  --tag-specifications 'ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=tutum-ecr-api}]'

# 2. ECR DKR Endpoint (Interface) — 이미지 레이어 pull
aws ec2 create-vpc-endpoint \
  --vpc-id "$VPC_ID" \
  --service-name com.amazonaws.ap-northeast-2.ecr.dkr \
  --vpc-endpoint-type Interface \
  --subnet-ids "$PRIVATE_SUBNET_A" "$PRIVATE_SUBNET_B" \
  --security-group-ids "$NODE_SG" \
  --private-dns-enabled \
  --tag-specifications 'ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=tutum-ecr-dkr}]'

# 3. S3 Gateway Endpoint (무료, route table에 자동 추가)
PRIVATE_RTB_A=$(aws ec2 describe-route-tables \
  --filters "Name=association.subnet-id,Values=$PRIVATE_SUBNET_A" \
  --query 'RouteTables[0].RouteTableId' --output text)
PRIVATE_RTB_B=$(aws ec2 describe-route-tables \
  --filters "Name=association.subnet-id,Values=$PRIVATE_SUBNET_B" \
  --query 'RouteTables[0].RouteTableId' --output text)
aws ec2 create-vpc-endpoint \
  --vpc-id "$VPC_ID" \
  --service-name com.amazonaws.ap-northeast-2.s3 \
  --vpc-endpoint-type Gateway \
  --route-table-ids "$PRIVATE_RTB_A" "$PRIVATE_RTB_B" \
  --tag-specifications 'ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=tutum-s3-gw}]'

# 4. Secrets Manager Endpoint (Interface) — Phase B에서 Secrets Manager 사용 시
aws ec2 create-vpc-endpoint \
  --vpc-id "$VPC_ID" \
  --service-name com.amazonaws.ap-northeast-2.secretsmanager \
  --vpc-endpoint-type Interface \
  --subnet-ids "$PRIVATE_SUBNET_A" "$PRIVATE_SUBNET_B" \
  --security-group-ids "$NODE_SG" \
  --private-dns-enabled \
  --tag-specifications 'ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=tutum-secretsmgr}]'
```

---

### B-11. AWS WAF (ALB WebACL 연결)

> ⬜ **미완료** — ACM 인증서 ISSUED + ALB Ingress 생성 후 WAF WebACL 연결

```bash
# WAF WebACL 생성 (ap-northeast-2, REGIONAL — ALB용)
WAF_ARN=$(aws wafv2 create-web-acl \
  --name tutum-waf \
  --scope REGIONAL \
  --region ap-northeast-2 \
  --default-action Allow={} \
  --rules '[
    {
      "Name":"AWSManagedRulesCommonRuleSet",
      "Priority":1,
      "OverrideAction":{"None":{}},
      "Statement":{"ManagedRuleGroupStatement":{"VendorName":"AWS","Name":"AWSManagedRulesCommonRuleSet"}},
      "VisibilityConfig":{"SampledRequestsEnabled":true,"CloudWatchMetricsEnabled":true,"MetricName":"CommonRules"}
    },
    {
      "Name":"RateLimit2000",
      "Priority":2,
      "Action":{"Block":{}},
      "Statement":{"RateBasedStatement":{"Limit":2000,"AggregateKeyType":"IP"}},
      "VisibilityConfig":{"SampledRequestsEnabled":true,"CloudWatchMetricsEnabled":true,"MetricName":"RateLimit"}
    }
  ]' \
  --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=tutumWAF \
  --query 'Summary.ARN' --output text)

# ALB ARN 조회 (Ingress 생성 후)
ALB_ARN=$(aws elbv2 describe-load-balancers \
  --query 'LoadBalancers[?contains(LoadBalancerName,`tutum`)].LoadBalancerArn' \
  --output text)

# WebACL → ALB 연결
aws wafv2 associate-web-acl \
  --web-acl-arn "$WAF_ARN" \
  --resource-arn "$ALB_ARN" \
  --region ap-northeast-2
```

---

### B-12. GuardDuty (위협 탐지)

> ⬜ **미완료** — 계정 수준 활성화 (월 ~$10~30, 트래픽 기반)

```bash
# GuardDuty 활성화
DETECTOR_ID=$(aws guardduty create-detector \
  --enable \
  --features '[
    {"Name":"EKS_AUDIT_LOGS","Status":"ENABLED"},
    {"Name":"EKS_RUNTIME_MONITORING","Status":"ENABLED"},
    {"Name":"S3_DATA_EVENTS","Status":"ENABLED"}
  ]' \
  --query 'DetectorId' --output text)

echo "GuardDuty Detector ID: $DETECTOR_ID"

# SNS Topic → Slack 알림 (EventBridge 연동)
aws events put-rule \
  --name tutum-guardduty-findings \
  --event-pattern '{"source":["aws.guardduty"],"detail-type":["GuardDuty Finding"]}' \
  --region ap-northeast-2
```

---

### B-13. AWS Secrets Manager (K8s Secret 대체) + KMS CMK 암호화

> ⬜ **미완료** — app-secrets, OAuth 키 등을 AWS 관리형 시크릿으로 전환
> **순서**: KMS CMK 생성 → Secrets Manager 등록(CMK 지정) → External Secrets Operator → IRSA(kms:Decrypt 포함)
>
> Secrets Manager는 기본적으로 AWS 관리형 키(aws/secretsmanager)로 암호화되지만,
> **CMK(Customer Managed Key)** 를 지정하면 키 회전·감사 로그 제어권을 직접 가진다.
> CMK로 암호화된 시크릿을 읽으려면 IRSA에 `kms:Decrypt` 권한이 반드시 있어야 한다.

```bash
# 1. KMS CMK 생성 (Secrets Manager 전용)
KMS_KEY_ARN=$(aws kms create-key \
  --description "tutum Secrets Manager CMK" \
  --key-usage ENCRYPT_DECRYPT \
  --region ap-northeast-2 \
  --query 'KeyMetadata.Arn' --output text)

aws kms create-alias \
  --alias-name alias/tutum-secrets-key \
  --target-key-id "$KMS_KEY_ARN" \
  --region ap-northeast-2

echo "KMS CMK ARN: $KMS_KEY_ARN"

# 2. on-prem 시크릿 내용 추출 (cp-1에서)
kubectl get secret app-secrets -n tutum-app -o jsonpath='{.data}' | python3 -c "
import json, sys, base64
data = json.load(sys.stdin)
for k, v in data.items():
    print(f'{k}={base64.b64decode(v).decode()}')
" > /tmp/app-secrets.env

# 3. AWS Secrets Manager에 등록 — KMS CMK로 암호화
aws secretsmanager create-secret \
  --name tutum/app-secrets \
  --region ap-northeast-2 \
  --kms-key-id alias/tutum-secrets-key \
  --secret-string file:///tmp/app-secrets.env

# OAuth 키 등 개별 시크릿 (필요 시 분리)
# aws secretsmanager create-secret --name tutum/oauth \
#   --kms-key-id alias/tutum-secrets-key --secret-string '{"GOOGLE_CLIENT_ID":"..."}'

# 4. External Secrets Operator 설치
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace

# 5. IRSA 최소 권한 정책 (secretsmanager + kms:Decrypt)
cat > /tmp/secrets-irsa-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SecretsManagerAccess",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:ap-northeast-2:903913341620:secret:tutum/*"
    },
    {
      "Sid": "KMSDecrypt",
      "Effect": "Allow",
      "Action": ["kms:Decrypt", "kms:DescribeKey"],
      "Resource": "$KMS_KEY_ARN"
    }
  ]
}
EOF

POLICY_ARN=$(aws iam create-policy \
  --policy-name tutum-secrets-irsa \
  --policy-document file:///tmp/secrets-irsa-policy.json \
  --query 'Policy.Arn' --output text)

eksctl create iamserviceaccount \
  --name backend \
  --namespace tutum-app \
  --cluster tutum-stg-eks \
  --attach-policy-arn "$POLICY_ARN" \
  --approve --override-existing-serviceaccounts

# 6. ExternalSecret 리소스 적용 (K8s Secret 자동 동기화)
cat <<EOF | kubectl apply -f -
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: aws-secrets-store
  namespace: tutum-app
spec:
  provider:
    aws:
      service: SecretsManager
      region: ap-northeast-2
      auth:
        jwt:
          serviceAccountRef:
            name: backend
---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: app-secrets
  namespace: tutum-app
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-store
    kind: SecretStore
  target:
    name: app-secrets
    creationPolicy: Owner
  dataFrom:
    - extract:
        key: tutum/app-secrets
EOF
```

> **흐름 요약**: EKS Pod → IRSA(kms:Decrypt + secretsmanager:GetSecretValue) → Secrets Manager(VPC Endpoint 경유) → KMS CMK 복호화 → 시크릿 반환
> External Secrets Operator가 주기적으로 동기화하여 K8s Secret으로 노출

---

### B-14. MariaDB outbound 허용 (SG 규칙)

```bash
WORKER_SG=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=*tutum-eks*worker*" \
  --query 'SecurityGroups[0].GroupId' --output text)

aws ec2 authorize-security-group-egress \
  --group-id "$WORKER_SG" \
  --ip-permissions '[{
    "IpProtocol": "tcp",
    "FromPort": 15432,
    "ToPort": 15432,
    "IpRanges": [{"CidrIp": "211.46.52.153/32", "Description": "MariaDB 학원 서버"}]
  }]'

# 연결 확인 (EKS pod에서)
kubectl run mariadb-test --image=mariadb:10.11 --rm -it --restart=Never -n tutum-app \
  -- mysql -h 211.46.52.153 -P 15432 -u team3 -pGkrtod1@ team3 -e "SELECT VERSION();"
```

---

### B-15. EKS Security Group 구성 (Cluster SG · Node SG · Monitoring SG)

> EKS Auto Mode는 클러스터 생성 시 2종류의 SG를 자동 생성한다.
>
> | SG | 역할 | 커스텀 규칙 필요 여부 |
> |----|------|----------------------|
> | **Cluster SG** | Control Plane ↔ Node API 통신 (AWS 자동 관리) | 최소 (기본 규칙 유지) |
> | **Node SG** (Auto Mode = Cluster SG 공유) | Worker 노드 추가 트래픽 | MariaDB outbound(B-14), Monitoring push 허용 |
> | **Monitoring EC2 SG** | EC2 접근 제어 | EKS VPC 내 수신, SSM outbound |

```bash
# Cluster SG 확인 (EKS Control Plane 자동 생성)
CLUSTER_SG=$(aws eks describe-cluster \
  --name tutum-stg-eks \
  --region ap-northeast-2 \
  --query 'cluster.resourcesVpcConfig.clusterSecurityGroupId' \
  --output text)
echo "Cluster SG: $CLUSTER_SG"

# Node SG 조회 (Auto Mode에서는 Cluster SG와 동일할 수 있음)
NODE_SG=$(aws ec2 describe-security-groups \
  --filters "Name=tag:aws:eks:cluster-name,Values=tutum-stg-eks" \
  --query 'SecurityGroups[0].GroupId' --output text)
echo "Node SG: $NODE_SG"

# ------------------------------------------------------------------
# 1. EKS Node → Monitoring EC2 아웃바운드 (Alloy OTLP/Loki/Tempo push)
#    Monitoring EC2가 EKS VPC private subnet에 있을 경우 SG 규칙 추가
# ------------------------------------------------------------------
aws ec2 authorize-security-group-egress \
  --group-id "$CLUSTER_SG" \
  --ip-permissions '[
    {"IpProtocol":"tcp","FromPort":3100,"ToPort":3100,"IpRanges":[{"CidrIp":"10.60.0.0/16","Description":"Loki"}]},
    {"IpProtocol":"tcp","FromPort":4317,"ToPort":4318,"IpRanges":[{"CidrIp":"10.60.0.0/16","Description":"Tempo OTLP"}]},
    {"IpProtocol":"tcp","FromPort":9009,"ToPort":9009,"IpRanges":[{"CidrIp":"10.60.0.0/16","Description":"Mimir"}]}
  ]'

# ------------------------------------------------------------------
# 2. Monitoring EC2 SG 생성 (EC2 배치 후 적용)
# ------------------------------------------------------------------
MONITORING_SG=$(aws ec2 create-security-group \
  --group-name tutum-monitoring-sg \
  --description "Monitoring EC2 (Grafana/Loki/Tempo/Mimir)" \
  --vpc-id "$VPC_ID" \
  --query 'GroupId' --output text)

# Grafana UI: 팀원 PC에서만 접근 (또는 Cloudflare Tunnel 사용 시 불필요)
# aws ec2 authorize-security-group-ingress --group-id "$MONITORING_SG" \
#   --protocol tcp --port 3000 --cidr <TEAM_CIDR>

# EKS 노드 → Monitoring EC2 inbound 허용 (Alloy가 push하는 포트)
aws ec2 authorize-security-group-ingress \
  --group-id "$MONITORING_SG" \
  --ip-permissions '[
    {"IpProtocol":"tcp","FromPort":3100,"ToPort":3100,"UserIdGroupPairs":[{"GroupId":"'"$CLUSTER_SG"'","Description":"Loki from EKS"}]},
    {"IpProtocol":"tcp","FromPort":4317,"ToPort":4318,"UserIdGroupPairs":[{"GroupId":"'"$CLUSTER_SG"'","Description":"Tempo OTLP from EKS"}]},
    {"IpProtocol":"tcp","FromPort":9009,"ToPort":9009,"UserIdGroupPairs":[{"GroupId":"'"$CLUSTER_SG"'","Description":"Mimir from EKS"}]}
  ]'

# SSM Agent outbound (Session Manager 사용 시 — EC2 → SSM 엔드포인트)
aws ec2 authorize-security-group-egress \
  --group-id "$MONITORING_SG" \
  --ip-permissions '[
    {"IpProtocol":"tcp","FromPort":443,"ToPort":443,"IpRanges":[{"CidrIp":"0.0.0.0/0","Description":"SSM/HTTPS outbound"}]}
  ]'

# ------------------------------------------------------------------
# 3. 현재 Cluster SG inbound 규칙 확인 (ALB → 노드 포트 자동 추가 여부)
# ------------------------------------------------------------------
aws ec2 describe-security-group-rules \
  --filters "Name=group-id,Values=$CLUSTER_SG" \
  --query 'SecurityGroupRules[?IsEgress==`false`].{Port:FromPort,Source:CidrIpv4,SrcSG:ReferencedGroupInfo.GroupId,Desc:Description}' \
  --output table
```

> **Internal LB(내부 로드밸런서)가 불필요한 이유**:
> - 서비스 간 내부 통신은 **Istio Envoy Sidecar(mTLS)** 가 담당 → Internal ALB 중간 계층 불필요
> - Monitoring EC2는 EKS VPC private subnet에 배치 → SG 규칙으로 직접 통신
> - subnet 태그 `kubernetes.io/role/internal-elb=1` 은 향후 내부 서비스용 NLB 배치를 위한 예약 태그
>   (현재는 사용하지 않음)

---

### B-16. ArgoCD · KEDA ECR 이미지 미러링

> ⬜ **미완료** — ArgoCD(quay.io), KEDA(ghcr.io) 이미지가 외부 레지스트리에서 pull되어
> EKS private subnet + VPC Endpoint 환경에서 NAT GW 경유 또는 차단 위험 있음.
> Istio 이미지는 이미 ECR 미러링 완료 (903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/istio/{pilot,proxyv2}:1.25.0).

```bash
ECR_REG="903913341620.dkr.ecr.ap-northeast-2.amazonaws.com"
REGION="ap-northeast-2"

# ECR 로그인
aws ecr get-login-password --region $REGION \
  | docker login --username AWS --password-stdin "$ECR_REG"

# ── 1. ArgoCD 이미지 미러링 ──
# 현재 설치된 ArgoCD 버전 확인
ARGO_VERSION=$(kubectl get deployment argocd-server -n argocd \
  -o jsonpath='{.spec.template.spec.containers[0].image}' | cut -d: -f2)
echo "ArgoCD 버전: $ARGO_VERSION"

# ECR repo 생성
aws ecr create-repository --repository-name argocd/argocd --region $REGION 2>/dev/null || true

# 이미지 미러링
docker pull quay.io/argoproj/argocd:${ARGO_VERSION}
docker tag quay.io/argoproj/argocd:${ARGO_VERSION} \
           ${ECR_REG}/argocd/argocd:${ARGO_VERSION}
docker push ${ECR_REG}/argocd/argocd:${ARGO_VERSION}

# ── 2. KEDA 이미지 미러링 ──
KEDA_VERSION=$(kubectl get deployment keda-operator -n keda \
  -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null | cut -d: -f2 || echo "2.15.0")
echo "KEDA 버전: $KEDA_VERSION"

for img in keda-operator keda-operator-metrics-apiserver keda-admission-webhooks; do
  aws ecr create-repository --repository-name kedacore/${img} --region $REGION 2>/dev/null || true
  docker pull ghcr.io/kedacore/${img}:${KEDA_VERSION}
  docker tag  ghcr.io/kedacore/${img}:${KEDA_VERSION} \
              ${ECR_REG}/kedacore/${img}:${KEDA_VERSION}
  docker push ${ECR_REG}/kedacore/${img}:${KEDA_VERSION}
done

# ── 3. KEDA Helm values — ECR 이미지 경로로 재설치 ──
helm upgrade --install keda kedacore/keda -n keda --create-namespace \
  --version ${KEDA_VERSION} \
  --set image.keda.registry=${ECR_REG}/kedacore \
  --set image.metricsApiServer.registry=${ECR_REG}/kedacore \
  --set image.webhooks.registry=${ECR_REG}/kedacore \
  --set image.keda.tag=${KEDA_VERSION} \
  --set image.metricsApiServer.tag=${KEDA_VERSION} \
  --set image.webhooks.tag=${KEDA_VERSION}

# ── 4. ArgoCD Helm values — ECR 이미지 경로로 재설치 ──
# ArgoCD는 kubectl apply로 설치된 경우 패치 방식 적용
kubectl set image deployment/argocd-server \
  argocd-server=${ECR_REG}/argocd/argocd:${ARGO_VERSION} -n argocd
kubectl set image deployment/argocd-application-controller \
  application-controller=${ECR_REG}/argocd/argocd:${ARGO_VERSION} -n argocd
kubectl set image deployment/argocd-repo-server \
  repo-server=${ECR_REG}/argocd/argocd:${ARGO_VERSION} -n argocd

kubectl rollout status deployment/argocd-server -n argocd
```

**체크리스트**:
- [ ] ArgoCD 현재 버전 확인 + ECR repo 생성 + 이미지 미러링
- [ ] KEDA 이미지 미러링 (keda-operator, metrics-apiserver, admission-webhooks)
- [ ] KEDA Helm upgrade — ECR registry 경로로 재설치
- [ ] ArgoCD 컨테이너 이미지 ECR로 패치 + rollout 확인

---

### B-17. 파이프라인 온프레미스 의존성 체크

> ⬜ **미완료** — GitLab CI 파이프라인이 온프레미스 리소스(K8s API, Harbor 등)에 의존하는
> 단계가 남아있는지 확인하고 제거. GitLab Runner가 EKS에 배포되어야 완전히 온프레미스 독립.

```bash
# ── 1. 현재 GitLab Runner 위치 확인 ──
# 온프레미스 K8s에 runner가 있는지
kubectl get pods -n gitlab-runner 2>/dev/null || echo "온프레미스 gitlab-runner ns 없음"

# GitLab.com → Settings → CI/CD → Runners 에서 등록된 runner 확인
# runner tag: 'docker', 'k8s', 'eks' 등 — 온프레미스 runner가 online인지 확인

# ── 2. EKS에 GitLab Runner 설치 (온프레미스 의존 제거) ──
helm repo add gitlab https://charts.gitlab.io && helm repo update

# GitLab runner registration token 확인 (GitLab → Settings → CI/CD → Runners)
GITLAB_RUNNER_TOKEN="<registration-token>"

helm install gitlab-runner gitlab/gitlab-runner \
  -n gitlab-runner --create-namespace \
  --set gitlabUrl=https://gitlab.com \
  --set runnerRegistrationToken="${GITLAB_RUNNER_TOKEN}" \
  --set rbac.create=true \
  --set runners.tags="eks,docker,k8s" \
  --set runners.privileged=true   # DinD(Docker-in-Docker) 빌드용

# ── 3. .gitlab-ci.yml 온프레미스 의존 항목 점검 ──
# 아래 패턴으로 온프레미스 IP/주소 하드코딩 확인
grep -rn "192\.168\." .gitlab-ci.yml backend/.gitlab-ci.yml || echo "온프레미스 IP 없음"
grep -rn "211\.46\.52\.153" .gitlab-ci.yml backend/.gitlab-ci.yml || echo "학원IP 없음"
grep -rn "harbor\." .gitlab-ci.yml backend/.gitlab-ci.yml || echo "Harbor 없음"

# ── 4. 온프레미스 deploy 단계 → EKS deploy로 교체 확인 ──
# 기존: kubectl --server=https://192.168.0.220:6443 apply ...
# 변경: kubectl --server=https://kubernetes.default.svc apply ...
#       (EKS 내 GitLab Runner는 IRSA로 K8s API 직접 접근)

# ── 5. 파이프라인 실행 후 전 단계 통과 여부 확인 ──
# build → scan(trivy) → sign(cosign) → deploy(argocd sync)
# GitLab → CI/CD → Pipelines → 최신 파이프라인 단계별 로그 확인
```

**온프레미스 의존 항목 체크리스트**:

| 항목 | 확인 방법 | 상태 |
|------|---------|------|
| GitLab Runner 위치 | GitLab Settings → Runners | ⬜ 확인 필요 |
| Harbor 레지스트리 참조 | `.gitlab-ci.yml` grep | ⬜ |
| 온프레미스 K8s API 참조 | `192.168.0.220` grep | ⬜ |
| ArgoCD destination | `staging-app.yaml` | ⬜ `https://kubernetes.default.svc` 여부 |
| Cosign 키 GitLab 변수 | GitLab CI Variables | ⬜ COSIGN_PRIVATE_KEY 업데이트 |

- [ ] GitLab CI 파이프라인 실행 (build → scan → sign → deploy 전 구간)
- [ ] EKS GitLab Runner 설치 + 온프레미스 runner 비활성화
- [ ] `.gitlab-ci.yml` 온프레미스 IP·주소 하드코딩 없음 확인
- [ ] ArgoCD `staging-app.yaml` destination → `https://kubernetes.default.svc`
- [ ] 파이프라인 완료 후 EKS 배포 Pod 정상 Running 확인

---

## Phase C (D+8 ~ D+12): CI/CD 파이프라인 전환

### C-1. .gitlab-ci.yml — GitLab CR → ECR 전환

현재 `.gitlab-ci.yml`에서 변경할 부분:

```yaml
# 변경 전 (GitLab CR)
variables:
  BACKEND_IMAGE: "$CI_REGISTRY_IMAGE/backend"

before_script:
  - docker login -u "$CI_REGISTRY_USER" -p "$CI_REGISTRY_PASSWORD" "$CI_REGISTRY"

# 변경 후 (ECR)
variables:
  ECR_REGISTRY: "${AWS_ACCOUNT_ID}.dkr.ecr.ap-northeast-2.amazonaws.com"
  BACKEND_IMAGE:  "${ECR_REGISTRY}/tutum/backend"
  FRONTEND_IMAGE: "${ECR_REGISTRY}/tutum/frontend"
  WORKERS_IMAGE:  "${ECR_REGISTRY}/tutum/workers"

.ecr_login: &ecr_login
  before_script:
    - aws ecr get-login-password --region ap-northeast-2
        | docker login --username AWS --password-stdin "$ECR_REGISTRY"

build:backend:
  <<: *ecr_login
  script:
    - docker build -t "${BACKEND_IMAGE}:${CI_COMMIT_SHORT_SHA}" ./backend
    - docker push "${BACKEND_IMAGE}:${CI_COMMIT_SHORT_SHA}"

sign:backend:
  image: bitnami/cosign:latest
  script:
    # COSIGN_PRIVATE_KEY는 GitLab CI 변수 (새로 생성한 키)
    - echo "$COSIGN_PRIVATE_KEY" > /tmp/cosign.key
    - COSIGN_PASSWORD="$COSIGN_PASSWORD" cosign sign \
        --key /tmp/cosign.key \
        "${BACKEND_IMAGE}:${CI_COMMIT_SHORT_SHA}" --yes
```

---

### C-2. Kustomize 이미지 경로 전환

`k8s-manifests/overlays/staging/kustomization.yaml`:
```yaml
images:
  # 변경 전
  # - name: registry.gitlab.com/tutum-project/tutum-app/backend
  # 변경 후
  - name: ${ACCOUNT_ID}.dkr.ecr.ap-northeast-2.amazonaws.com/tutum/backend
    newTag: stg-${CI_COMMIT_SHORT_SHA}
  - name: ${ACCOUNT_ID}.dkr.ecr.ap-northeast-2.amazonaws.com/tutum/frontend
    newTag: stg-${CI_COMMIT_SHORT_SHA}
  - name: ${ACCOUNT_ID}.dkr.ecr.ap-northeast-2.amazonaws.com/tutum/workers
    newTag: stg-${CI_COMMIT_SHORT_SHA}
```

---

### C-3. 스테이징 E2E 검증 (온프레미스와 병행 운영)

이 단계에서 **온프레미스 클러스터는 계속 운영**하면서 EKS 스테이징을 독립 검증.

```bash
# EKS에 staging 배포 확인
kubectl get pods -n tutum-app
# backend, frontend, workers, price-consumer 모두 Running 확인

# 기능별 검증 체크리스트
# 1. 인증: Google OAuth 콜백 URL이 EKS ALB DNS를 가리키도록 임시 수정
# 2. 시세: KIS API, Upbit API 호출 정상 여부
# 3. 뉴스: Elasticsearch 연결 (아직 온프레미스 Node3 사용, Phase D에서 이전)
# 4. AI 채팅: Bedrock Claude Sonnet 4.6 inference profile 응답 정상 여부
# 5. OCR: S3 연결 (2026-03-12 staging cutover 완료, MinIO 제거는 후속 정리)
# 6. MariaDB: 사용자 로그인/회원가입

# ALB DNS 확인
kubectl get ingress tutum-alb -n tutum-app \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
# 예: k8s-tutumap-tutumalb-xxxx.ap-northeast-2.elb.amazonaws.com
```

**2026-03-12 상태 업데이트**
- staging `backend` / `ocr`는 `tutum-prod-storage`를 사용하도록 전환 완료
- `backend-secret`에 `S3_BUCKET_NAME` 반영, `MINIO_*` 직접 설정 제거 완료
- 실제 업로드 검증 완료 (`ocr-images/`, `profile-images/` S3 객체 생성 확인)
- `mongodb-backup`는 S3 `backups/mongodb/`로 전환 완료
- Elasticsearch snapshot 경로는 S3 `backups/elasticsearch/` 기준으로 전환 완료
- EKS base에서는 MinIO StatefulSet과 `etcd-backup` CronJob을 제거 완료

---

## Phase D (D+13 ~ D+18): 데이터 이전

### D-1. MinIO → S3 이전

**현재 상태**: MinIO 4-pod HA StatefulSet (tutum-storage, PVC 4개)
**이전 대상**: ocr-images, profile-images 버킷 (약 10MB, 빠른 이전)

```bash
# S3 버킷 생성
REGION="ap-northeast-2"
BUCKET="tutum-prod-storage"

aws s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION"

# 서버사이드 암호화 (KMS)
aws s3api put-bucket-encryption \
  --bucket "$BUCKET" \
  --server-side-encryption-configuration '{
    "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "aws:kms"}}]
  }'

# 퍼블릭 액세스 차단
aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

mc를 사용한 데이터 이전:
```bash
# mc 설정 (on-prem MinIO 접근 — kubectl port-forward 활용)
kubectl port-forward svc/minio -n tutum-storage 9000:9000 &

mc alias set onprem http://localhost:9000 minioadmin minioadmin
mc alias set awss3 https://s3.amazonaws.com "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY"

# 버킷 내용 이전
mc mirror onprem/ocr-images      awss3/"$BUCKET"/ocr-images
mc mirror onprem/profile-images  awss3/"$BUCKET"/profile-images

# 검증: 파일 수 비교
mc ls onprem/ocr-images     | wc -l
mc ls awss3/"$BUCKET"/ocr-images | wc -l
```

백엔드 환경변수 변경 (S3 IRSA 방식):
```bash
# 기존 .env (MinIO)
# MINIO_ENDPOINT="minio.tutum-storage.svc.cluster.local:9000"
# MINIO_ACCESS_KEY="minioadmin"
# MINIO_SECRET_KEY="minioadmin"

# 변경 후 (S3 + IRSA — 키 불필요)
# AWS_S3_BUCKET="tutum-prod-storage"
# AWS_S3_REGION="ap-northeast-2"
# AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY → 제거 (IRSA 자동 주입)

# IRSA 생성 (backend SA에 S3 권한 부여)
eksctl create iamserviceaccount \
  --name backend \
  --namespace tutum-app \
  --cluster tutum-eks \
  --attach-policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess \
  --attach-policy-arn arn:aws:iam::aws:policy/AmazonBedrockFullAccess \
  --approve
```

S3 Lifecycle 정책 (Glacier):
```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket "$BUCKET" \
  --lifecycle-configuration '{
    "Rules": [
      {"ID":"ocr-expire","Status":"Enabled","Filter":{"Prefix":"ocr-images/"},
       "Expiration":{"Days":180}},
      {"ID":"backup-glacier","Status":"Enabled","Filter":{"Prefix":"backups/"},
       "Transitions":[{"Days":30,"StorageClass":"GLACIER"}],
       "Expiration":{"Days":365}}
    ]
  }'
```

---

### D-2. Redis 이식 — StatefulSet 그대로 + AOF 데이터 이전

Redis는 **캐시 용도**이므로 데이터 손실이 허용된다면 EKS에서 빈 상태로 시작 가능.
단, WebSocket 세션 등 중요 데이터가 있다면 아래 절차로 이전.

```bash
# 온프레미스에서 Redis snapshot 생성
kubectl exec -it redis-0 -n tutum-data -- redis-cli BGSAVE
kubectl exec -it redis-0 -n tutum-data -- redis-cli LASTSAVE   # 완료 timestamp 확인

# RDB 파일 로컬로 복사
kubectl cp tutum-data/redis-0:/data/dump.rdb ./redis-dump.rdb

# EKS Redis pod에 복사 (StatefulSet 먼저 배포 후)
kubectl cp ./redis-dump.rdb tutum-data/redis-0:/data/dump.rdb
kubectl rollout restart statefulset redis -n tutum-data
```

> **권장**: Redis 캐시는 손실 허용으로 처리. EKS Redis StatefulSet을 빈 상태로 시작하고
> 애플리케이션이 재기동 시 자동으로 캐시를 채우도록 허용.

---

### D-3. Kafka 이식 — 오프셋 관리

Kafka는 **토픽 데이터(메시지 로그)와 컨슈머 오프셋**을 보존해야 한다.

**전략**: EKS Kafka는 빈 상태로 시작 + 컷오버 시점을 정확히 맞춰 메시지 손실 최소화.

```bash
# 온프레미스 Kafka 상태 확인
kubectl exec -it kafka-0 -n tutum-data -- bash
# 현재 토픽 목록
kafka-topics.sh --bootstrap-server kafka-bootstrap:9092 --list
# 컨슈머 그룹 오프셋
kafka-consumer-groups.sh --bootstrap-server kafka-bootstrap:9092 \
  --all-groups --describe

# EKS Kafka 배포 후 동일 토픽 생성
# (메시지는 이전 안 함 — 실시간 가격 데이터는 재생산 가능)
kubectl apply -f k8s-manifests/base/messaging/kafka-topics.yaml
```

> Kafka 메시지(실시간 주가)는 재생산 가능 데이터이므로 이전 불필요.
> price_producer가 EKS에서 재기동되면 새로운 메시지를 생성.

---

### D-4. Elasticsearch 이전

**현재 위치**: K8s StatefulSet (`tutum-data/elasticsearch`, PVC `es-data-elasticsearch-0` 30Gi)

> ES는 이미 K8s 워크로드 — EC2 Docker 이전 불필요.
> EKS에도 동일한 `elasticsearch.yaml` StatefulSet 배포 + S3 스냅샷으로 데이터 복원.

```bash
# ── Step 1: 온프레미스 ES → S3 스냅샷 (이전용 임시) ──
# repository-s3 플러그인이 설치된 경우 (elasticsearch.yaml initContainer 필요)
ES="http://elasticsearch.tutum-data.svc.cluster.local:9200"

curl -X PUT "${ES}/_snapshot/s3_migration" \
  -H 'Content-Type: application/json' -d '{
    "type": "s3",
    "settings": {
      "bucket": "tutum-prod-storage",
      "region": "ap-northeast-2",
      "base_path": "elasticsearch-migration"
    }
  }'

curl -X PUT "${ES}/_snapshot/s3_migration/onprem_final?wait_for_completion=true"

# ── Step 2: EKS에 StatefulSet 그대로 배포 ──
kubectl apply -f k8s-manifests/base/data/elasticsearch.yaml
kubectl rollout status statefulset elasticsearch -n tutum-data

# ── Step 3: EKS ES에서 S3 스냅샷 복원 ──
curl -X PUT "${ES}/_snapshot/s3_migration" \
  -H 'Content-Type: application/json' -d '{
    "type": "s3",
    "settings": {
      "bucket": "tutum-prod-storage",
      "region": "ap-northeast-2",
      "base_path": "elasticsearch-migration"
    }
  }'

curl -X POST "${ES}/_snapshot/s3_migration/onprem_final/_restore"

# 백엔드 환경변수: 변경 없음 (K8s 서비스명 동일)
# ELASTICSEARCH_URL=http://elasticsearch.tutum-data.svc.cluster.local:9200
```

---

### D-5. 모니터링 이전 — LGTM Docker Compose

> **최근 반영 사항 (2026-03-12)**
> - monitoring EC2로의 Alloy `remote_write` 경로는 정상 수집 상태다.
> - `tutum.my/admin`은 `/api/proxy` ingress 경로를 `frontend-svc`로 복구한 뒤 Overview KPI, API 처리량/응답시간, Logs 탭까지 데이터 확인을 마쳤다.
> - traces는 `alloy.monitoring.svc.cluster.local:4317` export timeout(`DEADLINE_EXCEEDED`)이 남아 있어 추가 조치가 필요하다.
> - Kafka lag는 Mimir에 lag metric이 아직 적재되지 않아 `N/A`로 보일 수 있다.

```bash
# ──────────────────────────────────────────────
# 1. on-prem monitoring VM에서 설정 파일 백업
# ──────────────────────────────────────────────
scp clouddx@192.168.0.230:/opt/monitoring/docker-compose.yml ./monitoring-backup.yml

# Grafana 대시보드 백업 (JSON Export)
curl -s http://192.168.0.230:3000/api/search?type=dash-db \
  -u admin:tutum2026! | jq -r '.[].uid' | while read uid; do
  curl -s "http://192.168.0.230:3000/api/dashboards/uid/$uid" \
    -u admin:tutum2026! > "./grafana-dashboards/${uid}.json"
done

# ──────────────────────────────────────────────
# 2. EKS VPC private subnet에 모니터링 EC2 생성
# ──────────────────────────────────────────────
# AMI: Ubuntu 22.04 LTS (ap-northeast-2: ami-042e76978adeb8c48)
# SG: B-15에서 생성한 tutum-monitoring-sg 사용

MONITORING_SG=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=tutum-monitoring-sg" \
  --query 'SecurityGroups[0].GroupId' --output text)

PRIVATE_SUBNET_A=$(aws ec2 describe-subnets \
  --filters "Name=cidr-block,Values=10.60.11.0/24" \
  --query 'Subnets[0].SubnetId' --output text)

# SSM 사용을 위한 IAM Instance Profile 필요 (EC2 → SSM Session Manager)
aws iam create-instance-profile --instance-profile-name tutum-monitoring-profile 2>/dev/null || true
aws iam add-role-to-instance-profile \
  --instance-profile-name tutum-monitoring-profile \
  --role-name AmazonSSMManagedInstanceCore 2>/dev/null || true

MONITORING_EC2=$(aws ec2 run-instances \
  --image-id ami-042e76978adeb8c48 \
  --instance-type t3.medium \
  --subnet-id "$PRIVATE_SUBNET_A" \
  --security-group-ids "$MONITORING_SG" \
  --iam-instance-profile Name=tutum-monitoring-profile \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=tutum-monitoring}]' \
  --query 'Instances[0].InstanceId' --output text)

echo "Monitoring EC2: $MONITORING_EC2"
aws ec2 wait instance-running --instance-ids "$MONITORING_EC2"

# 내부 IP 확인 (10.60.11.x)
MONITORING_IP=$(aws ec2 describe-instances \
  --instance-ids "$MONITORING_EC2" \
  --query 'Reservations[0].Instances[0].PrivateIpAddress' --output text)
echo "Monitoring Private IP: $MONITORING_IP"

# ──────────────────────────────────────────────
# 3. EC2에 Docker + Docker Compose 설치 (SSM으로)
# ──────────────────────────────────────────────
aws ssm send-command \
  --instance-ids "$MONITORING_EC2" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=[
    "apt-get update -y",
    "apt-get install -y docker.io docker-compose-v2",
    "systemctl enable --now docker",
    "mkdir -p /opt/monitoring"
  ]' \
  --region ap-northeast-2 \
  --query 'Command.CommandId' --output text

# ──────────────────────────────────────────────
# 4. docker-compose.yml 전송 + 기동 (SSM File Transfer or S3 경유)
# ──────────────────────────────────────────────
# S3에 설정 파일 업로드 후 EC2에서 다운로드 (SCP 불가 — SSH 없음)
aws s3 cp ./monitoring-backup.yml s3://tutum-prod-storage/monitoring/docker-compose.yml

aws ssm send-command \
  --instance-ids "$MONITORING_EC2" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=[
    "aws s3 cp s3://tutum-prod-storage/monitoring/docker-compose.yml /opt/monitoring/docker-compose.yml",
    "cd /opt/monitoring && docker compose up -d"
  ]' \
  --region ap-northeast-2

# ──────────────────────────────────────────────
# 5. Grafana 대시보드 복원
# ──────────────────────────────────────────────
# EC2 기동 후 포트포워딩으로 접근 (SSM Session Manager 터널링)
aws ssm start-session \
  --target "$MONITORING_EC2" \
  --document-name AWS-StartPortForwardingSession \
  --parameters "portNumber=3000,localPortNumber=3000"
# → localhost:3000 접근 후 대시보드 JSON Import

# ──────────────────────────────────────────────
# 6. EKS Alloy DaemonSet remote_write 주소 변경
# ──────────────────────────────────────────────
# k8s-manifests/base/monitoring/alloy-config.yaml
# 기존: url = "http://192.168.0.230:9009/api/v1/push"
# 변경: url = "http://10.60.11.x:9009/api/v1/push"  ← EKS VPC private subnet EC2 내부 IP (10.60.11.0/24)
# (실제 MONITORING_IP 값으로 교체)
sed -i "s|http://192.168.0.230|http://${MONITORING_IP}|g" \
  k8s-manifests/base/monitoring/alloy-config.yaml

kubectl apply -f k8s-manifests/base/monitoring/alloy-config.yaml
kubectl rollout restart daemonset alloy -n monitoring

# 확인: Alloy pod 재시작 후 Mimir에 메트릭 수신되는지 검증
sleep 30
kubectl logs -l app.kubernetes.io/name=alloy -n monitoring --tail=20 | grep -i "remote_write\|error"
```

> **주의사항**:
> - Monitoring EC2는 SSH(22) 비허용 — SSM Session Manager로만 접근
> - Grafana 포트(3000)는 인터넷에 노출하지 않음 → SSM 포트포워딩으로 접근
> - InfluxDB(k6 테스트용)도 동일 EC2에서 docker-compose로 기동

---

### D-5. MariaDB → RDS 이전

**배경**: 회원 정보(로그인/회원가입)가 학원 서버(211.46.52.153:15432)에 있음. 학원 서버 의존성 제거 목적.

**목표 구성**:
```
EKS Backend → RDS MariaDB (10.60.11.x, private subnet, db.t3.micro)
```

```bash
# 1. DB Subnet Group 생성 (private 서브넷 2개)
aws rds create-db-subnet-group \
  --db-subnet-group-name tutum-rds-subnet-group \
  --db-subnet-group-description "Tutum RDS private subnets" \
  --subnet-ids subnet-09e82b994d4378ed4 subnet-012b272e47d6e6a07

# 2. RDS Security Group 생성 (EKS Cluster SG → 3306 inbound)
# EKS Cluster SG ID 확인 후 inbound 3306 허용

# 3. RDS MariaDB 생성
aws rds create-db-instance \
  --db-instance-identifier tutum-mariadb \
  --db-instance-class db.t3.micro \
  --engine mariadb \
  --engine-version 10.11 \
  --master-username tutum_admin \
  --master-user-password <password> \
  --db-name team3 \
  --db-subnet-group-name tutum-rds-subnet-group \
  --vpc-security-group-ids <rds-sg-id> \
  --no-publicly-accessible \
  --storage-type gp3 \
  --allocated-storage 20 \
  --backup-retention-period 7

# 4. 학원 DB 덤프 (로컬에서 실행)
mysqldump -h 211.46.52.153 -P 15432 -u team3 -pGkrtod1@ team3 > team3_dump.sql

# 5. RDS로 복원 (EKS Pod 활용)
kubectl run mysql-client --image=mariadb:10.11 --rm -it --restart=Never -n tutum-app \
  -- mysql -h <rds-endpoint> -u tutum_admin -p<password> team3 < team3_dump.sql

# 6. Backend 환경변수 변경
# MARIADB_URL: jdbc:mariadb://211.46.52.153:15432/team3 → jdbc:mariadb://<rds-endpoint>:3306/team3
```

**완료 결과** (2026-03-10):
- RDS Endpoint: `tutum-mariadb.cfoeqgoysp2f.ap-northeast-2.rds.amazonaws.com:3306`
- DB: team3, User: tutum_admin, Password: Tutum2026RDS
- SG: sg-0a8c73b3ea2d26143 (EKS Cluster SG → 3306, Monitoring EC2 SG → 3306)
- 학원 DB 덤프: users(22 rows) + portfolios 복원 완료 (monitoring EC2 경유)
- backend-secret: MARIADB_HOST/PORT/USER/PASSWORD 모두 RDS로 패치 완료

**체크리스트**:
- [x] RDS Subnet Group 생성 (tutum-rds-subnet-group)
- [x] RDS Security Group 생성 (sg-0a8c73b3ea2d26143)
- [x] RDS MariaDB (db.t3.micro) 생성 (MariaDB 10.11)
- [x] 학원 DB 덤프 + RDS 복원 (monitoring EC2 중계, mysqldump → mysql)
- [x] backend-secret MARIADB_HOST/PORT/USER/PASSWORD 패치
- [ ] 연결 테스트 (로그인/회원가입 E2E) — 브라우저 E2E 필요

---

### D-6. SonarQube 배포 (코드 품질 분석)

**배치**: EC2 (private subnet, t3.medium 권장) 또는 EKS Pod
**접근**: kubectl port-forward 또는 ALB Ingress (IP 제한)

> **현재 상태 (2026-03-13)**
> - SonarQube와 PostgreSQL은 AWS monitoring EC2 `tutum-monitoring`(`10.60.11.95`)에서 실제 기동 중이다.
> - `http://10.60.11.95:9000/api/system/status`는 `200`, 상태는 `UP`이다.
> - `https://sonar.tutum.my`는 ALB host rule 복구 후 `200` 응답을 확인했다.
> - 다만 AWS Load Balancer Controller는 external EC2 endpoint를 target group에 자동 등록하지 않아, 현재 Sonar target `10.60.11.95:9000`은 수동 등록 상태다.
> - GitLab CI Sonar job은 `.gitlab-ci.yml`에 이미 존재하며, 남은 작업은 CI 변수/실행 검증이다.

```bash
# EC2 배포 시 docker-compose
# /opt/sonarqube/docker-compose.yml
version: '3'
services:
  sonarqube:
    image: sonarqube:community
    ports:
      - "9000:9000"
    environment:
      SONAR_JDBC_URL: jdbc:postgresql://db:5432/sonar
      SONAR_JDBC_USERNAME: sonar
      SONAR_JDBC_PASSWORD: sonar
    volumes:
      - sonarqube_data:/opt/sonarqube/data
      - sonarqube_logs:/opt/sonarqube/logs
  db:
    image: postgres:15
    environment:
      POSTGRES_USER: sonar
      POSTGRES_PASSWORD: sonar
      POSTGRES_DB: sonar
    volumes:
      - postgresql_data:/var/lib/postgresql/data
volumes:
  sonarqube_data:
  sonarqube_logs:
  postgresql_data:
```

**GitLab CI 연동** (`.gitlab-ci.yml`에 추가):
```yaml
sonarqube:
  stage: test
  image: sonarsource/sonar-scanner-cli:latest
  script:
    - sonar-scanner
      -Dsonar.projectKey=tutum-backend
      -Dsonar.host.url=$SONAR_URL
      -Dsonar.login=$SONAR_TOKEN
  only:
    - develop
    - main
```

**체크리스트**:
- [x] SonarQube EC2 생성 또는 기존 모니터링 EC2 활용 (메모리 여유 확인)
- [x] docker-compose로 SonarQube + PostgreSQL 기동
- [ ] GitLab CI `SONAR_HOST_URL`, `SONAR_TOKEN` 변수 등록 확인
- [x] `.gitlab-ci.yml` sonarqube stage 추가
- [ ] 첫 분석 실행 + 결과 확인

---

### D-7. Kiali 설치 (Istio 서비스 메시 시각화)

**배치**: EKS `istio-system` 네임스페이스
**연동**: Mimir(메트릭), Tempo(트레이싱)

> **현재 상태 (2026-03-13)**
> - `istio-system/kiali` pod가 `Running` 상태다.
> - `https://kiali.tutum.my/kiali/`는 `200` 응답을 반환한다.
> - 운영 경로 기준으로는 설치/노출까지 완료된 상태다.

```bash
# Kiali Operator 설치
helm repo add kiali https://kiali.org/helm-charts
helm repo update

helm install kiali-operator kiali/kiali-operator \
  --namespace kiali-operator \
  --create-namespace

# Kiali CR 생성
cat <<EOF | kubectl apply -f -
apiVersion: kiali.io/v1alpha1
kind: Kiali
metadata:
  name: kiali
  namespace: istio-system
spec:
  auth:
    strategy: anonymous
  external_services:
    prometheus:
      url: http://10.60.11.95:9009/prometheus
    tracing:
      enabled: true
      in_cluster_url: ""
      url: http://10.60.11.95:16686
      use_grpc: false
    grafana:
      enabled: true
      in_cluster_url: ""
      url: http://10.60.11.95:3000
EOF

# 접근 (로컬)
kubectl port-forward svc/kiali 20001:20001 -n istio-system
# → http://localhost:20001
```

**체크리스트**:
- [x] Kiali Operator Helm 설치
- [x] Kiali CR 생성 (Mimir/Tempo/Grafana 연동)
- [x] 서비스 메시 그래프 확인 (tutum-app 트래픽 흐름)

---

### D-8. Terraform IaC — 기존 AWS 인프라 코드화

**배경**: 수동 AWS CLI/Console로 생성된 인프라를 Terraform으로 import → GitOps로 인프라 변경 이력 관리.

> **현재 상태 (2026-03-12)**
> - `terraform/` 루트와 `modules/networking|security|compute|database|dns` 구조를 작성했다.
> - S3 backend `tutum-terraform-state-903913341620` + DynamoDB lock table `tutum-terraform-locks`는 이미 생성되어 있고, `terraform init`으로 연결을 확인했다.
> - `terraform apply`로 VPC, Subnet, IGW, NAT, Route Table, VPC Endpoint, SG, monitoring EC2, RDS, Route53 zone, ACM cert 총 31개 리소스를 import했다.
> - import 후 `terraform plan` 결과가 `No changes`로 수렴했다.
> - EKS cluster는 guide 원칙대로 `data "aws_eks_cluster"`로만 참조하고 import 대상에서 제외했다.
> - GuardDuty managed endpoint(`vpce-00bac47c533d6cc9d`)는 서비스 관리 리소스라 D-8 범위에서 제외했다.

**State Backend**: S3 버킷 + DynamoDB
```bash
aws s3api head-bucket --bucket tutum-terraform-state-903913341620
aws dynamodb describe-table --table-name tutum-terraform-locks --region ap-northeast-2
```

**Import 대상 리소스**:
| 리소스 | ID |
|--------|-----|
| VPC | vpc-07de5077a86cac33f |
| Subnet ×4 | public(2a/2b), private(2a/2b) |
| IGW | igw-03917cebd25167079 |
| NAT GW | nat-02d4de6a0d9b1cd72 |
| SG ×3 | eks-cluster-sg, tutum-rds-sg, tutum-monitoring-sg |
| EC2 | i-0a8cab5d5ce1cac60 (tutum-monitoring) |
| RDS | tutum-mariadb |
| Route53 | Z04669402IT42VPHL8CRP (tutum.my) |
| ACM | cc8731ed-... (*.tutum.my) |
| VPC Endpoints ×5 | S3, ECR DKR, ECR API, Secrets Manager, STS |

**EKS**: `data "aws_eks_cluster"` 로만 참조 (Auto Mode + Karpenter 관리 복잡성으로 직접 import 제외)

**디렉토리 구조**:
```
terraform/
├── versions.tf / backend.tf / provider.tf / variables.tf / locals.tf / main.tf / imports.tf / outputs.tf
├── terraform.tfvars.example
└── modules/
    ├── networking/   # VPC, subnets, IGW, NAT, route tables, VPC endpoints
    ├── security/     # Security Groups
    ├── compute/      # EC2 (tutum-monitoring)
    ├── database/     # RDS subnet group + MariaDB instance
    └── dns/          # Route53 zone, ACM cert
```

**검증 결과 (2026-03-12)**:
```bash
terraform init
# Success! Terraform has been successfully initialized!

terraform apply -auto-approve
# Apply complete! Resources: 31 imported, 0 added, 0 changed, 0 destroyed.

terraform plan
# No changes. Your infrastructure matches the configuration.
```

**체크리스트**:
- [x] State Backend S3 + DynamoDB 생성
- [x] terraform/ 디렉토리 및 모든 모듈 파일 작성
- [x] `terraform init` 성공 (S3 backend 연결)
- [x] 전체 리소스 `terraform import` 완료
- [x] `terraform plan` → "No changes" 확인
- [x] `.gitignore`에 `terraform/terraform.tfvars` 추가 (RDS 비밀번호 보호)
- [ ] GuardDuty managed endpoint / ALB managed SG를 Terraform 범위에 포함할지 별도 결정
- [ ] prod 계정/리소스용 별도 Terraform stack 확장

---

### D-9. MongoDB 정본 전환 - Atlas → EKS ReplicaSet

**배경**:
- 마이그레이션 목표는 외부 Atlas가 아니라 AWS 내부의 EKS MongoDB ReplicaSet을 정본으로 사용하는 것이다.
- 2026-03-11 기준 `backend/auth/ocr`는 MongoDB Atlas, `news-consumer`는 EKS in-cluster MongoDB를 바라보는 이원화 상태였다.
- 2026-03-12 cutover로 앱 정본을 EKS in-cluster ReplicaSet으로 통일했고, Atlas는 잔여 writer/consumer 점검 후 제거 대상으로 전환했다.

**현재 연결 상태 (2026-03-12)**:
```
backend/auth/ocr -> mongodb-0/1/2.mongodb-headless.tutum-data.svc.cluster.local:27017
                    replicaSet=mongo-rs, db=clouddx
news-consumer    -> same replica set, db=clouddx
Atlas            -> 앱 정본 아님 / hidden writer·consumer 점검 대상
legacy VM        -> 192.168.0.231, 의존성 확인 후 shutdown 대상
```

**실행 절차**:
1. Atlas와 local MongoDB(`clouddx`)의 collection별 문서 건수를 비교해 기준 데이터를 확정했다.
2. Atlas 데이터를 local ReplicaSet으로 merge했다.
   - `users`, `assets`, `email_verification_tokens`: `_id` 기준 upsert
   - `news`: `url/link/id` 우선 upsert, 없으면 `_id` 기준 보존
3. AWS Secrets Manager `tutum/backend-secret`의 `MONGODB_URL`을 in-cluster ReplicaSet URI로 변경했다.
4. ExternalSecret 동기화 후 `backend`, `auth`, `ocr`를 재기동했다.
5. `news-pipeline-secret`의 `MONGO_URI`를 `/clouddx?replicaSet=mongo-rs`로 정규화했다.

**적용 URI**:
```text
mongodb://mongodb-0.mongodb-headless.tutum-data.svc.cluster.local:27017,mongodb-1.mongodb-headless.tutum-data.svc.cluster.local:27017,mongodb-2.mongodb-headless.tutum-data.svc.cluster.local:27017/clouddx?replicaSet=mongo-rs
```

**검증 결과 (2026-03-12)**:
- local `clouddx.users = 11`
- local `clouddx.assets = 22`
- local `clouddx.email_verification_tokens = 11`
- local `clouddx.news = 12421`
- `backend 5/5`, `auth 2/2`, `ocr 1/1`
- 외부 검증
  - `https://tutum.my/api/v1/chat/health` -> `200`
  - `https://tutum.my/api/v1/market/prices/stocks?symbols=NVDA` -> `200`
  - `https://tutum.my/api/v1/auth/me` -> `401` (비로그인 상태 기준 정상)

**체크리스트**:
- [x] Atlas 데이터 → EKS ReplicaSet merge
- [x] `backend/auth/ocr` `MONGODB_URL` cutover
- [x] `news-pipeline-secret` `clouddx` 기준 정리
- [x] 주요 앱 API health 검증
- [ ] local MongoDB 인증/권한 적용
- [ ] Atlas hidden writer/consumer audit 및 중지
- [ ] legacy MongoDB VM(192.168.0.231) shutdown

---

### D-9-V. LGTM / Admin 모니터링 검증

> **현재 상태 (2026-03-13)**
> - `/api/proxy`, `/api/public` ingress를 `frontend-svc`로 복구해 admin 요청이 Next proxy를 경유하도록 수정했다.
> - Overview KPI, API 처리량/응답시간, Logs 탭은 실제 데이터 확인을 마쳤다.
> - backend startup patch에 Mongo fallback client와 `$toDate(ingested_at|created_at)` 최근 1시간 집계를 주입해 `Data Store Status`의 Mongo/Elasticsearch business count를 맞췄다.
> - `/admin`의 AI Summary 탭과 admin login callback 경로는 운영 기준으로 복구됐다.
> - traces는 OTLP export timeout, Kafka lag는 Mimir lag metric 부재로 후속 조치가 남아 있다.

```bash
# 검증 1. Grafana 접근 (SSM 포트포워딩)
MONITORING_EC2="i-0a8cab5d5ce1cac60"
aws ssm start-session   --target "$MONITORING_EC2"   --document-name AWS-StartPortForwardingSession   --parameters "portNumber=3000,localPortNumber=3000"
# 브라우저: http://localhost:3000 (admin / tutum2026!)

# 검증 2. Alloy DaemonSet 상태 확인
kubectl get pods -n monitoring -l app.kubernetes.io/name=alloy
kubectl logs -n monitoring -l app.kubernetes.io/name=alloy --tail=50 | grep -E "error|warn|remote_write"

# 검증 3. Mimir 메트릭 수신 확인
# Grafana → Explore → Mimir datasource → 쿼리:
# up{namespace="tutum-app"}
# container_cpu_usage_seconds_total{namespace="tutum-app"}

# 검증 4. Loki 로그 수신 확인
# Grafana → Explore → Loki datasource → 쿼리:
# {namespace="tutum-app"}
```

**LGTM 검증 체크리스트**:
- [x] `/api/proxy` ingress 복구 후 admin API가 frontend proxy를 경유하도록 수정
- [x] Overview KPI / API 처리량 그래프 / Logs 탭 정상 확인
- [x] MongoDB `news_total/news_last_1h`와 Elasticsearch business count 정합성 확인
- [x] Alloy DaemonSet 전체 노드 Running 확인
- [ ] traces export (`alloy.monitoring.svc.cluster.local:4317`) timeout 해소
- [ ] Kafka lag metric Mimir 적재 확인
- [ ] Grafana Explore에서 Tempo trace 조회 확인

---

### D-10. Kafka EC2 이전 (Docker Compose)

**배경**: 현재 K8s StatefulSet KRaft 3-replica(tutum-data)로 운영 중인 Kafka를
EC2 Docker Compose 방식으로 이전. 온프레미스 K8s 의존성 제거 목적.

**목표 구성**:
```
현재: kafka.tutum-data.svc.cluster.local:9092 (K8s StatefulSet 3-broker KRaft)
변경: Kafka EC2 (10.60.11.x, Docker Compose, KRaft 또는 단일 브로커 구성)
Consumer/Producer: kafka-bootstrap 주소 → EC2 내부 IP로 변경
```

```bash
# ── Step 1: Kafka EC2 생성 ──
PRIVATE_SUBNET_A=$(aws ec2 describe-subnets \
  --filters "Name=cidr-block,Values=10.60.11.0/24" \
  --query 'Subnets[0].SubnetId' --output text)

CLUSTER_SG=$(aws eks describe-cluster --name tutum-stg-eks \
  --query 'cluster.resourcesVpcConfig.clusterSecurityGroupId' --output text)

# Kafka 전용 SG 생성
KAFKA_SG=$(aws ec2 create-security-group \
  --group-name tutum-kafka-sg \
  --description "Kafka EC2" \
  --vpc-id "$(aws ec2 describe-vpcs --filters Name=cidr-block,Values=10.60.0.0/16 \
              --query 'Vpcs[0].VpcId' --output text)" \
  --query 'GroupId' --output text)

# EKS → Kafka 9092 inbound 허용
aws ec2 authorize-security-group-ingress \
  --group-id "$KAFKA_SG" \
  --ip-permissions "[{
    \"IpProtocol\":\"tcp\",\"FromPort\":9092,\"ToPort\":9092,
    \"UserIdGroupPairs\":[{\"GroupId\":\"$CLUSTER_SG\",\"Description\":\"EKS apps\"}]
  },{
    \"IpProtocol\":\"tcp\",\"FromPort\":9093,\"ToPort\":9093,
    \"UserIdGroupPairs\":[{\"GroupId\":\"$CLUSTER_SG\",\"Description\":\"KRaft controller\"}]
  }]"

aws ec2 authorize-security-group-egress \
  --group-id "$KAFKA_SG" \
  --ip-permissions '[{"IpProtocol":"tcp","FromPort":443,"ToPort":443,"IpRanges":[{"CidrIp":"0.0.0.0/0"}]}]'

# EC2 생성 (t3.large, 50GB gp3)
KAFKA_EC2=$(aws ec2 run-instances \
  --image-id ami-042e76978adeb8c48 \
  --instance-type t3.large \
  --subnet-id "$PRIVATE_SUBNET_A" \
  --security-group-ids "$KAFKA_SG" \
  --iam-instance-profile Name=tutum-monitoring-profile \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":50,"VolumeType":"gp3"}}]' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=tutum-kafka}]' \
  --query 'Instances[0].InstanceId' --output text)

aws ec2 wait instance-running --instance-ids "$KAFKA_EC2"
KAFKA_IP=$(aws ec2 describe-instances --instance-ids "$KAFKA_EC2" \
  --query 'Reservations[0].Instances[0].PrivateIpAddress' --output text)
echo "Kafka EC2 IP: $KAFKA_IP"

# ── Step 2: Docker + Kafka 설치 (SSM) ──
# docker-compose.yml을 S3에 업로드 후 EC2에서 다운로드
cat > /tmp/kafka-compose.yml << EOF
version: '3'
services:
  kafka:
    image: confluentinc/cp-kafka:7.6.0
    container_name: kafka
    ports:
      - "9092:9092"
      - "9093:9093"
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://${KAFKA_IP}:9092
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@localhost:9093
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_LOG_DIRS: /var/lib/kafka/data
      CLUSTER_ID: MkU3OEVBNTcwNTJENDM2Qk
    volumes:
      - kafka_data:/var/lib/kafka/data
    restart: always
volumes:
  kafka_data:
EOF

aws s3 cp /tmp/kafka-compose.yml s3://tutum-prod-storage/migration/kafka/docker-compose.yml

aws ssm send-command \
  --instance-ids "$KAFKA_EC2" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=[
    "apt-get update -y && apt-get install -y docker.io docker-compose-v2",
    "systemctl enable --now docker",
    "mkdir -p /opt/kafka",
    "aws s3 cp s3://tutum-prod-storage/migration/kafka/docker-compose.yml /opt/kafka/docker-compose.yml",
    "cd /opt/kafka && docker compose up -d",
    "sleep 10 && docker compose logs kafka | tail -20"
  ]' --region ap-northeast-2

# ── Step 3: 토픽 생성 (온프레미스 토픽 목록 복제) ──
# 온프레미스 토픽 목록 확인
kubectl exec -it kafka-0 -n tutum-data -- \
  kafka-topics.sh --bootstrap-server kafka-bootstrap:9092 --list

# EC2 Kafka에 동일 토픽 생성 (SSM)
aws ssm send-command \
  --instance-ids "$KAFKA_EC2" \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[
    \"docker exec kafka kafka-topics --bootstrap-server localhost:9092 --create --topic price-topic --partitions 3 --replication-factor 1 --if-not-exists\",
    \"docker exec kafka kafka-topics --bootstrap-server localhost:9092 --create --topic news-topic --partitions 3 --replication-factor 1 --if-not-exists\",
    \"docker exec kafka kafka-topics --bootstrap-server localhost:9092 --create --topic stock-topic --partitions 3 --replication-factor 1 --if-not-exists\",
    \"docker exec kafka kafka-topics --bootstrap-server localhost:9092 --list\"
  ]" --region ap-northeast-2

# ── Step 4: backend-secret Kafka 주소 변경 ──
kubectl patch secret backend-secret -n tutum-app --type=merge -p "{
  \"data\": {
    \"KAFKA_BOOTSTRAP_SERVERS\": \"$(echo -n "${KAFKA_IP}:9092" | base64)\"
  }
}"

# KEDA ScaledObject의 bootstrapServers 주소도 변경 필요
# k8s-manifests/base/autoscaling/ 내 ScaledObject 파일에서 수정
sed -i "s|kafka.tutum-data.svc.cluster.local:9092|${KAFKA_IP}:9092|g" \
  k8s-manifests/base/autoscaling/*.yaml
kubectl apply -f k8s-manifests/base/autoscaling/

# ── Step 5: Consumer 재기동 + 정상 동작 확인 ──
kubectl rollout restart deployment/price-consumer deployment/news-consumer \
  deployment/elastic-consumer -n tutum-app
kubectl rollout status deployment/price-consumer -n tutum-app

# Consumer 로그에서 Kafka 연결 확인
kubectl logs -n tutum-app -l app=price-consumer --tail=20 | grep -E "kafka|connect|error"
```

**체크리스트**:
- [ ] Kafka EC2 생성 (t3.large, 50GB gp3, private subnet)
- [ ] Kafka SG 생성 (EKS → 9092/9093 inbound)
- [ ] Docker Compose Kafka 설치 + 서비스 기동
- [ ] 온프레미스 토픽 목록 확인 + EC2 Kafka에 동일 토픽 생성
- [ ] backend-secret `KAFKA_BOOTSTRAP_SERVERS` → EC2 IP로 변경
- [ ] KEDA ScaledObject `bootstrapServers` → EC2 IP로 변경
- [ ] price-consumer / news-consumer / elastic-consumer rolling restart
- [ ] Consumer 로그에서 Kafka 연결 + 메시지 수신 확인

---

### D-11. 온프레미스 VM 워크로드 현황 점검 + 단계별 Shutdown 계획

> 2026-03-12 SSH 감사 결과와 2026-03-13 네트워크 재검증 결과를 함께 기준으로 사용한다.
> 2026-03-13에는 cp1/2/3, w1/2/3, monitoring, mongodb VM 8대 모두 ping 응답을 확인했다.
> 다만 현재 셸의 SSH 인증키가 없어 2026-03-13에는 네트워크 reachability까지만 재검증했다.
> 결론은 여전히 "핵심 서비스는 상당 부분 AWS로 이전됐지만, 온프레미스 VM을 지금 한 번에 모두 종료하면 안 된다"이다.

관련 문서:
- `docs/plans/infra/ONPREM_VM_TO_AWS_MIGRATION_STATUS_2026-03-12.md`
- `docs/plans/infra/ONPREM_VM_SHUTDOWN_CHECKLIST_2026-03-12.md`

#### 2026-03-12 live 확인 요약

- `cp1/2/3`, `w1~3`는 아직 kubeadm 온프레미스 클러스터로 `Ready` 상태이며 실제 파드가 계속 실행 중이다.
- `worker1~3`에는 `frontend`, `backend`, `ocr`, `news/price workers`, `kafka`, `mongodb`, `redis`, `elasticsearch`, `minio`, `argocd`, `istio`, `gitlab-runner`, `sonarqube`, `cloudflared` 등이 남아 있다.
- `monitoring VM(192.168.0.230)`은 Docker Compose 기반 `Grafana/Loki/Tempo/Mimir/Kiali/InfluxDB`를 아직 실행 중이다.
- `mongodb VM(192.168.0.231)`은 standalone `mongod`가 계속 떠 있다.
- AWS 쪽에는 `EKS`, `RDS`, `S3`, `monitoring EC2`, `EKS MongoDB/Redis/Kafka/Elasticsearch`, `frontend/backend/auth/ocr`가 실제로 동작 중이다.

#### 기능별 온프레미스 -> AWS 매핑

| 기능 | 기존 온프레미스 위치 | 현재 AWS 대응 리소스 | 상태 | 남은 이슈 |
|---|---|---|---|---|
| Kubernetes control plane | `cp1`, `cp2`, `cp3` | EKS managed control plane | 부분 완료 | 온프레미스 kubeadm control-plane이 아직 live |
| 앱 워크로드 (`frontend/backend/auth/ocr/workers`) | 주로 `w2`, `w3` | EKS `tutum-app` | 대부분 완료 | 온프레미스 중복 파드 정리 필요 |
| ArgoCD | `w2`, `w3` | EKS `argocd` | 대부분 완료 | on-prem ArgoCD 철수 절차 필요 |
| GitLab Runner | `w3` | EKS `gitlab-runner` | 부분 완료 | on-prem runner 사용 여부 최종 감사 필요 |
| SonarQube | `w1`, `w3` | AWS monitoring EC2 `10.60.11.95:9000` + `sonar.tutum.my` | 대부분 완료 | GitLab CI Sonar 실행 검증, external target 등록 자동화 필요 |
| Ingress / 외부 진입 | `w3` + MetalLB `192.168.0.240` | AWS ALB + EKS ingress | 부분 완료 | on-prem `cloudflared` 잔존 |
| Monitoring LGTM | `monitoring VM` | EC2 `10.60.11.95` | 대부분 완료 | old monitoring VM 참조 제거 확인 필요 |
| MongoDB 앱 DB | `mongodb VM` + on-prem K8s Mongo | EKS `mongodb-0~2` | 대부분 완료 | legacy VM, on-prem Mongo 정리 필요 |
| MariaDB | 학원 외부 DB | RDS `tutum-mariadb` | 완료 | 앱 경로는 RDS 사용 중 |
| Redis | on-prem K8s `redis-0~2` | EKS `redis-0~2` | 완료에 가까움 | on-prem Redis 종료 시점만 남음 |
| Kafka | on-prem K8s `kafka-0~2` | EKS `kafka-0~2` | 대부분 완료 | 장기적으로 D-10 방향 정리 필요 |
| Elasticsearch | on-prem K8s `elasticsearch-0` | EKS `elasticsearch-0` | 부분 완료 | 복원/검증 후속 필요 |
| Object storage | on-prem K8s `minio-0~3` | S3 `tutum-prod-storage` | 부분 완료 | mirror/정합성 검증 필요 |

#### VM별 종료 판단

| VM | 현재 역할 | 현재 판단 | 이유 |
|---|---|---|---|
| `cp1`, `cp2`, `cp3` | kubeadm control-plane | 종료 금지 | 온프레미스 클러스터 자체가 아직 live |
| `w1`, `w2`, `w3` | app/data/storage/infra worker | 종료 금지 | 실제 서비스 파드와 infra 파드가 남아 있음 |
| `monitoring` | old LGTM Docker Compose | 조건부 종료 가능 | AWS monitoring EC2 LGTM + Sonar는 확인됐고 old VM 참조 제거 확인 필요 |
| `mongodb` | legacy standalone MongoDB | 조건부 종료 가능 | 앱 정본은 EKS Mongo로 전환됐지만 hidden client audit 필요 |

#### D-11 후속 작업

- [ ] `mongodb` VM 접속자, cron, 백업 경로가 더 없는지 확인
- [ ] old `monitoring` VM을 참조하는 Alloy/Loki/Tempo/Grafana 경로가 없는지 확인
- [ ] on-prem `cloudflared` 사용 여부 최종 감사
- [ ] `MinIO -> S3` mirror 및 실제 업로드/다운로드 정합성 확인
- [ ] `SonarQube`의 AWS 이전 여부 결정 또는 온프레미스 유지 범위 확정
- [ ] on-prem `worker1~3`에서 app/data/storage/infra 파드를 0으로 줄인 뒤 단계적 drain
- [ ] on-prem kubeadm control-plane(`cp1~3`) 폐기 절차와 스냅샷 확보
- [ ] shutdown 순서를 `mongodb -> monitoring -> worker -> control-plane`로 고정하고 단계별 검증

---

## Phase E (D+19 ~ D+24): 트래픽 컷오버 + 온프레미스 철수

### E-1. 2026-03-12 기준 컷오버 판정

2026-03-10 ~ 2026-03-12 작업을 기준으로 보면, Phase E의 핵심은 "새 인프라를 더 만드는 것"이 아니라
"AWS 경로가 실제 정본인지 검증하고, 온프레미스 잔존 의존성을 종료 가능한 상태로 정리하는 것"이다.

| 항목 | 현재 상태 | 판정 | 근거 |
|---|---|---|---|
| `tutum.my` 메인 서비스 응답 | ALB + EKS staging 기준 응답 확인 | 대부분 완료 | `2026-03-12_monitoring_admin_proxy_and_lgtm_validation.md` |
| OAuth callback | Google / Naver / Kakao AWS 기준으로 정리 | 완료 | 관련 dev log, 운영 검증 기록 |
| MariaDB | RDS 정본 사용 중 | 완료 | D-5 |
| MongoDB 앱 정본 | EKS ReplicaSet 정본 전환 완료 | 완료 | D-9 |
| Object storage 경로 | S3 기준 매니페스트/secret 정리 완료 | 부분 완료 | D-1 runtime 검증 필요 |
| Monitoring / LGTM | monitoring EC2 기준 경로 복구 | 부분 완료 | traces / Kafka lag 후속 필요 |
| On-prem monitoring / Mongo VM | shutdown 조건은 정리됐으나 실제 종료는 미실행 | 부분 완료 | D-11 |
| Terraform IaC | staging AWS core infra import 및 `No changes` plan 검증 완료 | 완료 | D-8 |
| Kafka EC2 이전 | 장기 과제, 현재 EKS Kafka 정상 | 보류 가능 | D-10 |

**판정 기준**
- 아래 조건을 만족하면 AWS migration은 "서비스 경로 기준 종료"로 판정할 수 있고, Kafka EC2 이전과 비용 최적화는 후속 hardening backlog로 분리할 수 있다.
  1. `tutum.my` 핵심 사용자 경로가 AWS EKS/RDS/S3 기준으로 정상 동작한다.
  2. monitoring EC2의 LGTM / Sonar readiness가 확인된다.
  3. S3 backup runtime 검증이 끝난다.
  4. legacy Mongo / old monitoring / Cloudflare / MinIO 잔존 의존성의 종료 조건이 문서화된다.

### E-2. 오늘 바로 닫아야 하는 실행 항목

#### 1) D-1 runtime 검증

목표:
- `s3-backup-secret` 생성 확인
- `mongodb-backup` / `elasticsearch-backup` CronJob 실행 확인
- Elasticsearch `_snapshot/s3_backup` repository 응답 확인
- 실제 S3 업로드 산출물 확인

```bash
# secret / cronjob
kubectl --context tutum-stg-eks -n tutum-data get externalsecret,secret | egrep "s3-backup-secret|backend-secret"
kubectl --context tutum-stg-eks -n tutum-data get cronjob
kubectl --context tutum-stg-eks -n tutum-data get jobs --sort-by=.metadata.creationTimestamp

# CronJob 1회 수동 실행
kubectl --context tutum-stg-eks -n tutum-data create job --from=cronjob/mongodb-backup mongodb-backup-manual-$(date +%H%M%S)
kubectl --context tutum-stg-eks -n tutum-data create job --from=cronjob/elasticsearch-backup elasticsearch-backup-manual-$(date +%H%M%S)

# Elasticsearch snapshot repository 확인
kubectl --context tutum-stg-eks -n tutum-data exec statefulset/elasticsearch -- \
  curl -s http://localhost:9200/_snapshot/s3_backup?pretty

# S3 산출물 확인
aws s3 ls s3://tutum-prod-storage/backups/ --recursive --profile ruby --region ap-northeast-2
```

#### 2) D-5 monitoring EC2 / Sonar readiness 재확인

`tutum-monitoring` 인스턴스가 `m5.large`로 변경된 뒤 재기동되었으므로, LGTM + Sonar를 다시 확인해야 한다.

```bash
aws ec2 describe-instance-status \
  --region ap-northeast-2 \
  --instance-ids i-0a8cab5d5ce1cac60 \
  --include-all-instances \
  --profile ruby

# monitoring VM 내부
hostname
free -h
df -h
sudo systemctl status docker --no-pager
cd /opt/monitoring
docker compose ps
curl -s http://localhost:3000/api/health
curl -s http://localhost:3100/ready
curl -s http://localhost:3200/ready
curl -s http://localhost:9009/ready
curl -s http://localhost:9000/api/system/status
```

#### 3) D-9-V traces / Kafka lag 후속 확인

목표:
- traces export timeout 원인 확인
- Kafka lag metric이 Mimir에 적재되는지 확인

```bash
# Alloy / OTLP export 로그
kubectl --context tutum-stg-eks -n monitoring logs -l app.kubernetes.io/name=alloy --tail=200 | egrep "tempo|4317|error|warn"

# Tempo / Mimir readiness
curl -s http://localhost:3200/ready
curl -s http://localhost:9009/ready

# Grafana Explore 기준 확인 쿼리
# Mimir:
#   up{namespace="tutum-app"}
#   kafka_consumergroup_lag
# Tempo:
#   service.name="backend"
```

#### 4) D-11 on-prem 철수 조건 점검

현재는 "shutdown 실행"보다 "shutdown 가능한지"를 닫는 것이 우선이다.

```bash
# legacy Mongo / monitoring 참조 확인
ssh mongo 'mongosh --quiet --eval "db.runCommand({ ping: 1 })"'
ssh mon 'docker ps'

# cloudflared / minio / on-prem runner 잔존 확인
ssh cp1 'kubectl get pods -A -o wide | egrep "cloudflared|minio|gitlab-runner|sonarqube"'
ssh cp1 'kubectl get svc -A'
```

#### 5) Phase E 최종 E2E 검증

최소 사용자 경로:
- 메인 페이지 로드
- 일반 로그인
- OAuth 로그인
- 시세 / 뉴스
- OCR 업로드
- `/admin` Overview / Logs / Cost

기록 예시:
```text
2026-03-12 E2E
- /: 200
- /login: 정상
- /api/v1/market/prices/stocks: 200
- /api/v1/news: 200
- OCR 업로드: 성공/실패 사유 기록
- /admin: Overview/Logs/Cost 확인
```

### E-3. Post-migration backlog로 분리할 항목

아래는 중요하지만 "서비스 migration 종료"의 직접 블로커로 보지 않는다.

| 항목 | 처리 방향 |
|---|---|
| D-10 Kafka EC2 이전 | 현재 EKS Kafka가 정상인 동안 보류 가능 |
| prod cost optimization / nodepool role separation | staging 기반 migration 종료와 분리 |

### E-4. 최종 종료 판정 체크리스트

- [ ] `tutum.my` 핵심 사용자 경로가 AWS 기준으로 정상 동작
- [ ] RDS / EKS Mongo / EKS Redis / EKS Kafka / EKS Elasticsearch / S3가 실제 서비스 정본 경로로 확인
- [x] monitoring EC2 LGTM / Sonar readiness 확인
- [ ] `mongodb-backup`, `elasticsearch-backup` S3 runtime 검증 완료
- [ ] traces / Kafka lag 후속 이슈는 원인과 보류 사유가 문서화됨
- [ ] on-prem `mongodb`, `monitoring`, `cloudflared`, `minio` 종료 조건이 확정됨
- [x] D-8은 완료되었고, D-10만 backlog로 분리됨

> 위 7개를 만족하면 2026-03-12 기준 AWS migration은 "서비스 운영 경로 기준 완료, 잔여 항목은 hardening/backlog"로 판정한다.
