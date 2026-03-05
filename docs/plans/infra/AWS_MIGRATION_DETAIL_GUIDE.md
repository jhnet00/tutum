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
| **K8s 클러스터** | VirtualBox VM 6대 (cp×3 + worker×3) | EKS 관리형 클러스터 |
| **K8s 버전** | v1.29.15 (수동 kubeadm) | EKS v1.29 (AWS 관리) |
| **노드 스펙** | VM (불균일) | EC2 m5.large × 3 (ASG) |
| **CNI** | Calico | AWS VPC CNI + Network Policy |
| **컨테이너 레지스트리** | GitLab CR (registry.gitlab.com) | ECR (프라이빗, 리전 내) |
| **인그레스** | MetalLB 192.168.0.240 + Istio GW | ALB (internet-facing) |
| **외부 HTTPS** | Cloudflare Tunnel → 192.168.0.240 | Cloudflare Tunnel → ALB DNS (origin 변경만) |
| **Service Mesh** | Istio (mTLS STRICT) | Istio (mTLS STRICT) — 그대로 이식 |
| **MongoDB** | Atlas Cloud (이미 AWS 외부 클라우드) | **변경 없음** |
| **MariaDB** | 211.46.52.153:15432 (학원 공인 IP) | **변경 없음** (EKS NAT GW → 직접 접속) |
| **Redis** | K8s StatefulSet (tutum-data, 3-replica) | EKS StatefulSet 그대로 이식 |
| **Kafka** | K8s StatefulSet, KRaft 3-replica | EKS StatefulSet 그대로 이식 |
| **Elasticsearch** | K8s StatefulSet (tutum-data, PVC 30Gi) | EKS StatefulSet 그대로 이식 + S3 스냅샷 복원 |
| **MinIO** | K8s StatefulSet 4-pod (tutum-storage) | S3 버킷으로 대체 |
| **모니터링** | Docker Compose on 192.168.0.230 | EC2 Docker Compose (EKS VPC private subnet) |
| **GitOps** | GitLab CI → ArgoCD → on-prem K8s | GitLab CI → ECR → ArgoCD → EKS |
| **Autoscaling** | KEDA | KEDA (그대로 이식) |
| **보안 정책** | Kyverno (Enforce) + Cosign | Kyverno + Cosign (ECR 대응 재구성) |

### 변경 없는 항목 (이전 불필요)
- MongoDB: 이미 Atlas Cloud (온프레미스에 없음)
- MariaDB: 학원 공인 IP, EKS에서도 직접 TCP 연결 (VPN 불필요)
- GitLab: SaaS, CI/CD 파이프라인 재구성만 필요
- Cloudflare Tunnel: 터널 자체는 유지, origin URL(IP)만 변경

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
Phase A (D+0~3)  : AWS 기반 준비 (계정, ECR, VPC 설계)
Phase B (D+4~7)  : EKS 클러스터 구성 + 기존 addon 이식
Phase C (D+8~12) : CI/CD 파이프라인 전환 + 스테이징 검증
Phase D (D+13~18): 데이터 이전 (MinIO→S3, Elasticsearch 이전)
Phase E (D+19~24): 트래픽 컷오버 + 온프레미스 철수
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
# 로컬 (AWS CLI 설정 완료 후)
REGION="ap-northeast-2"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# 현재 GitLab CR 경로 → ECR 경로 매핑:
# registry.gitlab.com/tutum-project/tutum-app/backend          → ECR/tutum-app/backend
# registry.gitlab.com/tutum-project/tutum-app/backend/frontend → ECR/tutum-app/frontend
# registry.gitlab.com/tutum-project/tutum-app/backend/workers  → ECR/tutum-app/workers

for repo in tutum-app/backend tutum-app/frontend tutum-app/workers; do
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

```bash
# GitLab CR에서 최신 이미지를 ECR로 미러링 (CI 전환 전 초기 적재)
GITLAB_REG="registry.gitlab.com/tutum-project/tutum-app"
ECR_REG="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

# GitLab 로그인
echo "$GITLAB_PAT" | docker login registry.gitlab.com -u sj1202pak --password-stdin

# ECR 로그인
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ECR_REG"

# 현재 운영 중인 태그 확인 (cp-1에서)
CURRENT_TAG=$(kubectl get deployment backend -n tutum-app \
  -o jsonpath='{.spec.template.spec.containers[0].image}' | cut -d: -f2)
echo "현재 운영 태그: $CURRENT_TAG"   # 예: stg-accfcfe2

# 이미지 재태깅 및 push
for svc in backend frontend workers; do
  docker pull "${GITLAB_REG}/${svc}:${CURRENT_TAG}" 2>/dev/null || \
  docker pull "${GITLAB_REG}/backend/${svc}:${CURRENT_TAG}"

  docker tag "${GITLAB_REG}/backend/${svc}:${CURRENT_TAG}" \
             "${ECR_REG}/tutum-app/${svc}:${CURRENT_TAG}"
  docker push "${ECR_REG}/tutum-app/${svc}:${CURRENT_TAG}"
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

```
EKS VPC (단일):  10.0.0.0/16
  - Public Subnet  10.0.1.0/24  (ALB, NAT GW)
  - Private Subnet 10.0.2.0/24  (EKS worker nodes)
  - Private Subnet 10.0.3.0/24  (Redis, Kafka StatefulSet)
  - Private Subnet 10.0.4.0/24  (Monitoring EC2, ES EC2)
  - EKS 내 pod: GitLab Runner (gitlab-runner ns), ArgoCD (argocd ns)
온프레미스: 192.168.0.0/24 (참고용, 직접 연결 없음)
외부:       211.46.52.153/32 (학원 MariaDB, NAT GW 경유 outbound)
```

---

## Phase B (D+4 ~ D+7): EKS 클러스터 구성

### B-1. EKS 클러스터 생성

온프레미스와 동일한 K8s v1.29, 네임스페이스 구조 유지.

```bash
cat > eks-cluster.yaml << 'EOF'
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig

metadata:
  name: tutum-eks
  region: ap-northeast-2
  version: "1.29"   # 온프레미스와 동일 버전

vpc:
  cidr: 10.0.0.0/16
  nat:
    gateway: Single   # 비용 절감; HA 필요 시 HighlyAvailable

availabilityZones:
  - ap-northeast-2a
  - ap-northeast-2b
  - ap-northeast-2c

managedNodeGroups:
  - name: tutum-workers
    instanceType: m5.large
    minSize: 2
    maxSize: 5
    desiredCapacity: 3
    availabilityZones:
      - ap-northeast-2a
      - ap-northeast-2b
      - ap-northeast-2c
    iam:
      withAddonPolicies:
        albIngress: true
        cloudWatch: true
    tags:
      Project: tutum

iam:
  withOIDC: true   # IRSA 활성화 (S3, Bedrock 키리스 인증에 필수)

addons:
  - name: vpc-cni
  - name: coredns
  - name: kube-proxy
  - name: aws-ebs-csi-driver   # PVC(EBS) 프로비저닝용
EOF

eksctl create cluster -f eks-cluster.yaml
# 소요 시간: 약 15~20분

# kubeconfig 업데이트
aws eks update-kubeconfig --region ap-northeast-2 --name tutum-eks
kubectl get nodes  # 3개 노드 Ready 확인
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

현재 on-prem의 Istio 구성(PeerAuthentication mTLS STRICT, VirtualService)을 EKS에 그대로 이식.
단, IngressGateway는 MetalLB IP 대신 ALB로 교체.

```bash
# Istio 설치 (EKS 환경 — IngressGateway 비활성화, ALB가 대신함)
cat > istio-eks.yaml << 'EOF'
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
spec:
  components:
    ingressGateways:
      - name: istio-ingressgateway
        enabled: false   # ALB로 대체
  values:
    global:
      proxy:
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
EOF

istioctl install -f istio-eks.yaml -y

# 기존 PeerAuthentication (mTLS STRICT) 그대로 적용
kubectl apply -f k8s-manifests/base/security/peer-authentication.yaml

# 기존 VirtualService / DestinationRule 그대로 적용
kubectl apply -f k8s-manifests/base/networking/
```

on-prem Istio Gateway (MetalLB 기반) vs EKS 구조 변경:
```
[기존]
  Client → Cloudflare Tunnel → 192.168.0.240 (MetalLB)
         → Istio IngressGateway → VirtualService → Service

[EKS 이후]
  Client → Cloudflare Tunnel → ALB DNS
         → ALB → tutum-app Service (포트 80/443)
         → Istio sidecar mesh (mTLS STRICT 유지)
```

---

### B-4. ALB Ingress Controller 설치

```bash
# IRSA 생성 (ALB Controller용)
eksctl create iamserviceaccount \
  --cluster=tutum-eks \
  --namespace=kube-system \
  --name=aws-load-balancer-controller \
  --attach-policy-arn=arn:aws:iam::${ACCOUNT_ID}:policy/AWSLoadBalancerControllerIAMPolicy \
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
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP":80}]'
    # Cloudflare가 TLS 처리하므로 ALB는 HTTP만
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

```bash
# KEDA Helm 설치 (버전 on-prem과 동일하게 맞출 것)
helm repo add kedacore https://kedacore.github.io/charts && helm repo update

# on-prem 버전 확인
kubectl get deployment keda-operator -n keda -o jsonpath='{.spec.template.spec.containers[0].image}'

helm install keda kedacore/keda -n keda --create-namespace \
  --version 2.x.x   # on-prem 버전과 동일

# 기존 ScaledObject 그대로 적용 (Kafka scaler는 kafka service name 확인 필요)
kubectl apply -f k8s-manifests/base/autoscaling/
# ScaledObject 내 bootstrapServers: kafka-bootstrap.tutum-data.svc:9092 → 동일하게 동작
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
      - "${ACCOUNT_ID}.dkr.ecr.ap-northeast-2.amazonaws.com/tutum-app/*"
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

```bash
# ArgoCD 설치 (on-prem과 동일 방식)
kubectl create namespace argocd
helm install argocd argo/argo-cd -n argocd \
  --set server.service.type=ClusterIP \
  --set configs.params."server\.insecure"=true

# GitLab 리포 연결 (기존과 동일)
argocd repo add https://gitlab.com/tutum-project/tutum-app/k8s-manifests \
  --username sj1202pak --password "$GITLAB_PAT"
```

`k8s-manifests/argocd/staging-app.yaml`에서 변경할 부분:
```yaml
# 변경 전 (on-prem ArgoCD가 바라보던 서버)
spec:
  destination:
    server: https://192.168.0.220:6443   # cp-1 API server

# 변경 후 (EKS API server)
spec:
  destination:
    server: https://<EKS-API-SERVER-ENDPOINT>  # eksctl로 생성 후 조회
    # 또는
    server: https://kubernetes.default.svc  # ArgoCD가 EKS 내부에 있을 경우
```

EKS API endpoint 조회:
```bash
aws eks describe-cluster --name tutum-eks \
  --query 'cluster.endpoint' --output text
```

---

### B-8. NetworkPolicy 이식

```bash
# AWS VPC CNI Network Policy Engine 활성화 (Calico 불필요)
aws eks update-addon \
  --cluster-name tutum-eks \
  --addon-name vpc-cni \
  --configuration-values '{"enableNetworkPolicy": "true"}'

# 기존 NetworkPolicy 매니페스트 그대로 적용
kubectl apply -f k8s-manifests/base/security/network-policy.yaml
```

---

### B-9. MariaDB outbound 허용 (SG 규칙)

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
  BACKEND_IMAGE:  "${ECR_REGISTRY}/tutum-app/backend"
  FRONTEND_IMAGE: "${ECR_REGISTRY}/tutum-app/frontend"
  WORKERS_IMAGE:  "${ECR_REGISTRY}/tutum-app/workers"

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
  - name: ${ACCOUNT_ID}.dkr.ecr.ap-northeast-2.amazonaws.com/tutum-app/backend
    newTag: stg-${CI_COMMIT_SHORT_SHA}
  - name: ${ACCOUNT_ID}.dkr.ecr.ap-northeast-2.amazonaws.com/tutum-app/frontend
    newTag: stg-${CI_COMMIT_SHORT_SHA}
  - name: ${ACCOUNT_ID}.dkr.ecr.ap-northeast-2.amazonaws.com/tutum-app/workers
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
# 4. AI 채팅: Bedrock Claude 응답 정상 여부
# 5. OCR: MinIO 연결 (아직 on-prem MinIO, Phase D에서 S3 전환)
# 6. MariaDB: 사용자 로그인/회원가입

# ALB DNS 확인
kubectl get ingress tutum-alb -n tutum-app \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
# 예: k8s-tutumap-tutumalb-xxxx.ap-northeast-2.elb.amazonaws.com
```

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

```bash
# 현재 monitoring VM (192.168.0.230)의 docker-compose.yml 복사
scp clouddx@192.168.0.230:/opt/monitoring/docker-compose.yml ./monitoring-backup.yml

# EKS VPC private subnet에 모니터링 EC2 생성 (t3.medium)
# docker-compose.yml에서 변경할 사항:
# 1. Alloy remote_write endpoint 주소 → EC2 내부 IP (자기 자신)
# 2. 외부 접근 SG 규칙: 3000(Grafana), 9009(Mimir) 포트

# EKS Alloy DaemonSet 설정 업데이트
# k8s-manifests/base/monitoring/alloy-config.yaml
# 기존: url = "http://192.168.0.230:9009/api/v1/push"
# 변경: url = "http://10.0.4.x:9009/api/v1/push"  ← EKS VPC private subnet EC2 내부 IP

kubectl apply -f k8s-manifests/base/monitoring/alloy-config.yaml
kubectl rollout restart daemonset alloy -n monitoring
```

---

## Phase E (D+19 ~ D+24): 트래픽 컷오버 + 온프레미스 철수

### E-1. Cloudflare Tunnel origin 변경 (핵심 컷오버 단계)

**현재 Tunnel 구성**:
```
Cloudflare Edge → Tunnel → 192.168.0.240 (MetalLB, Istio IngressGateway)
```

**변경 후**:
```
Cloudflare Edge → Tunnel → k8s-tutumap-xxx.ap-northeast-2.elb.amazonaws.com (ALB)
```

```bash
# Cloudflare Zero Trust Dashboard에서 변경
# Tunnels → tutum-tunnel → Edit → Public Hostname
# Service: HTTP
# URL: http://k8s-tutumap-xxx.ap-northeast-2.elb.amazonaws.com

# 또는 cloudflared CLI로 변경
cloudflared tunnel route dns tutum-tunnel tutum.app
# config.yaml의 ingress 수정:
# - hostname: tutum.app
#   service: http://k8s-tutumap-xxx.ap-northeast-2.elb.amazonaws.com
```

**컷오버 체크리스트** (순서 중요):
```
1. [ ] EKS 스테이징에서 E2E 기능 검증 완료
2. [ ] MinIO → S3 데이터 이전 완료 + 백엔드 S3 연결 확인
3. [ ] Elasticsearch EC2 복원 완료 + 뉴스 검색 정상
4. [ ] OAuth 콜백 URL 업데이트 (Google, Naver) → ALB DNS로 변경
5. [ ] Cloudflare Tunnel origin 변경 (수 초 내 전환)
6. [ ] 브라우저에서 tutum.app 접속 → EKS 응답 확인
7. [ ] 로그인, 시세 조회, 뉴스, AI 채팅 빠른 확인
8. [ ] Grafana 대시보드에서 EKS 지표 수신 확인
```

> **롤백**: Cloudflare Tunnel origin을 다시 `192.168.0.240`으로 변경하면 즉시 온프레미스로 복귀 가능.
> 이 때문에 온프레미스 클러스터는 **1주일 이상 병행 운영** 후 철수 권장.

---

### E-2. OAuth 콜백 URL 업데이트

컷오버 직전, OAuth 제공사에 등록된 콜백 URL을 ALB DNS 또는 도메인으로 변경.

```
[Google Cloud Console]
Authorized redirect URIs:
- 기존: http://localhost:8000/api/v1/auth/google/callback
- 추가: https://tutum.app/api/v1/auth/google/callback

[Naver Developer Console]
- 기존: http://localhost:8000/api/v1/auth/naver/callback
- 추가: https://tutum.app/api/v1/auth/naver/callback
```

---

### E-3. 병행 운영 기간 (1주일)

```
온프레미스 K8s:  읽기 전용 모드 유지 (대기 상태)
EKS:            실 트래픽 처리

모니터링 지표:
- EKS Error Rate < 1%  → 온프레미스 철수 진행
- EKS Error Rate > 5%  → Cloudflare Tunnel 즉시 rollback
```

---

### E-4. 온프레미스 클러스터 철수 순서

```bash
# 1. ArgoCD sync 중단 (on-prem ArgoCD)
argocd app set tutum-staging --sync-policy none

# 2. 서비스 순서대로 중단 (역방향)
kubectl scale deployment backend frontend price-consumer --replicas=0 -n tutum-app
kubectl scale statefulset redis kafka --replicas=0 -n tutum-data
kubectl scale statefulset minio --replicas=0 -n tutum-storage

# 3. PVC 최종 백업 (MinIO는 이미 S3 이전 완료)
kubectl exec -it redis-0 -n tutum-data -- redis-cli BGSAVE

# 4. 네임스페이스 삭제 (데이터 소멸 확인 후)
kubectl delete namespace tutum-app tutum-data tutum-storage

# 5. VM 종료 (VirtualBox)
# worker1~3, cp1~3 순서로 shutdown
```

---

## 비용 모니터링

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

aws budgets create-budget \
  --account-id "$ACCOUNT_ID" \
  --budget '{
    "BudgetName": "tutum-monthly-budget",
    "BudgetLimit": {"Amount": "700", "Unit": "USD"},
    "TimeUnit": "MONTHLY",
    "BudgetType": "COST"
  }' \
  --notifications-with-subscribers '[{
    "Notification": {
      "NotificationType": "ACTUAL",
      "ComparisonOperator": "GREATER_THAN",
      "Threshold": 80,
      "ThresholdType": "PERCENTAGE"
    },
    "Subscribers": [{"SubscriptionType": "EMAIL", "Address": "team@tutum.io"}]
  }]'
```

예상 비용 (월간):
| 서비스 | 사양 | 월 비용 |
|--------|------|--------|
| EKS Control Plane | - | $73 |
| EC2 Worker (m5.large × 3) | 720h | $207 |
| NAT Gateway | - | $35 |
| ALB | - | $20 |
| ECR | - | $5 |
| Elasticsearch EC2 (t3.large) | - | $60 |
| 모니터링 EC2 (t3.medium) | - | $30 |
| S3 + CloudTrail | - | $11 |
| **합계** | | **$441** |

---

## 마이그레이션 체크리스트

### Phase A (기반 준비)
- [ ] 온프레미스 리소스 스냅샷 추출 (`kubectl get all -A -o yaml`)
- [ ] ECR repo 3개 생성 (backend, frontend, workers)
- [ ] 기존 운영 이미지 → ECR 미러링 완료
- [ ] GitLab CI 변수 업데이트 (ECR 크리덴셜)
- [ ] VPC CIDR 설계 확정

### Phase B (EKS 구성)
- [ ] EKS 클러스터 생성 (v1.29, 3 node)
- [ ] 네임스페이스 생성 (tutum-app, tutum-data, tutum-storage)
- [ ] 시크릿 재생성 (app-secrets, OAuth 키 등)
- [ ] Istio 설치 + PeerAuthentication(mTLS STRICT) 적용
- [ ] ALB Ingress Controller 설치
- [ ] KEDA 설치 + ScaledObject 적용
- [ ] Kyverno + Cosign 재구성 (ECR URI + 새 키)
- [ ] ArgoCD 설치 + GitLab 리포 연결
- [ ] ArgoCD staging-app.yaml destination → EKS API server
- [ ] NetworkPolicy 이식 (vpc-cni network policy 활성화)
- [ ] Worker SG outbound 211.46.52.153:15432 허용
- [ ] MariaDB 연결 E2E 테스트 (kubectl run mariadb-test)

### Phase C (CI/CD 전환)
- [ ] `.gitlab-ci.yml` ECR push로 전환
- [ ] Kustomize 이미지 경로 ECR로 수정
- [ ] 새 이미지 빌드 + ECR push + ArgoCD sync 확인
- [ ] Kyverno 이미지 서명 검증 통과 확인
- [ ] 스테이징 E2E (로그인, 시세, 뉴스, AI, OCR, MariaDB)

### Phase D (데이터 이전)
- [ ] S3 버킷 생성 + 암호화 + 퍼블릭 액세스 차단
- [ ] MinIO → S3 mc mirror 완료 + 파일 수 검증
- [ ] Backend S3 코드 변경 + IRSA 적용 (키 제거)
- [ ] Redis: 빈 상태 시작 or RDB 이전 (정책 결정)
- [ ] Kafka: 빈 상태 시작 + 동일 토픽 생성
- [ ] Elasticsearch EC2 생성 + S3 스냅샷 복원
- [ ] ELASTICSEARCH_URL 환경변수 → 새 EC2 IP
- [ ] 모니터링 EC2 생성 + Docker Compose 기동
- [ ] Alloy remote_write → 새 EC2 IP
- [ ] S3 Lifecycle (Glacier 30일) 설정
- [ ] CloudTrail 활성화

### Phase E (컷오버)
- [ ] OAuth 콜백 URL → ALB DNS (Google, Naver)
- [ ] Cloudflare Tunnel origin → ALB DNS
- [ ] 접속 확인 (tutum.app 전체 기능)
- [ ] 1주일 병행 운영 이상 없음 확인
- [ ] 온프레미스 워크로드 순차 중단
- [ ] Budget Alert $700 설정
- [ ] IAM Access Analyzer 미사용 권한 정리
- [ ] 운영 문서 최종 갱신

---

## 롤백 계획

| 단계 | 롤백 방법 | 소요 시간 |
|------|---------|---------|
| Cloudflare Tunnel 컷오버 후 | Tunnel origin → 192.168.0.240으로 변경 | ~30초 |
| EKS 서비스 장애 | ArgoCD rollback to previous revision | ~2분 |
| 데이터 이전 중 | S3 데이터는 유지, MinIO도 유지 (병행) | 즉시 |
| 전체 EKS 장애 | Cloudflare Tunnel rollback → 온프레미스 복귀 | ~30초 |

> **핵심**: Cloudflare Tunnel의 origin 변경이 사실상 유일한 사용자-facing 컷오버 포인트.
> origin을 되돌리는 것만으로 즉시 온프레미스로 돌아올 수 있으므로
> **온프레미스는 컷오버 후 최소 1주일 유지** 후 철수.
