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
| **외부 HTTPS** | Cloudflare Tunnel → 192.168.0.240 | Cloudflare Tunnel → ALB DNS (origin만 변경) |
| **Service Mesh** | Istio (istiod + IngressGateway, mTLS STRICT, tutum-app ns) | Istio minimal profile (istiod만, IngressGateway 제거, mTLS STRICT 유지) |
| **MongoDB** | K8s StatefulSet **3-replica** (tutum-data ns, PVC 30Gi×3, worker1/2/3 분산) + 독립 VM (192.168.0.231, v7.0.30) | EKS StatefulSet 그대로 이식 |
| **MariaDB** | 211.46.52.153:15432 (학원 공인 IP) | **변경 없음** (EKS NAT GW → 직접 접속) |
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
- MariaDB: 학원 공인 IP(211.46.52.153:15432), EKS에서도 NAT GW → 직접 TCP 연결 (VPN 불필요)
- GitLab: SaaS, CI/CD 파이프라인은 Phase C에서 이미 ECR 전환 완료
- Cloudflare Tunnel: 터널 자체는 유지, origin URL(IP)만 ALB DNS로 변경 (Phase E)

### 이미 완료된 항목 (이전 작업에서 처리됨)
- **컨테이너 레지스트리**: GitLab CR → ECR 전환 완료 (`.gitlab-ci.yml`, kustomization.yaml, Cosign 키 재발급, Kyverno 정책 갱신)
- **Dockerfile Alpine**: backend/workers `python:3.11-alpine` 전환 완료
- **MongoDB**: Atlas Cloud 아님 — K8s StatefulSet 3-replica (tutum-data)로 운영 중.
  독립 MongoDB VM(192.168.0.231, v7.0.30)은 별도 운영 중이나 앱 연결은 K8s StatefulSet 기준

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
Phase A (D+0~3)  : AWS 기반 준비 (계정, ECR, VPC 설계)          ← ✅ ECR/EKS 생성 완료, SSM 검증 완료
Phase B (D+4~7)  : EKS 클러스터 구성 + 기존 addon 이식          ← 🔶 진행 중 (ALB/Istio/ArgoCD/NP 완료, KEDA/Kyverno/시크릿 미완)
Phase C (D+8~12) : CI/CD 파이프라인 전환 + 스테이징 검증        ← 🔶 CI/CD 코드 완료, 파이프라인 실행 미완
Phase D (D+13~18): 데이터 이전 (MinIO→S3, Elasticsearch 이전)  ← ⬜ 미시작
Phase E (D+19~24): 트래픽 컷오버 + 온프레미스 철수              ← ⬜ 미시작
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
  Client → Cloudflare Tunnel → ALB DNS
         → ALB → K8s Service → Envoy Sidecar → Pod (mTLS STRICT 유지)
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

### B-13. AWS Secrets Manager (K8s Secret 대체)

> ⬜ **미완료** — app-secrets, OAuth 키 등을 AWS 관리형 시크릿으로 전환
> EKS IRSA + External Secrets Operator 또는 Secrets Store CSI Driver 사용

```bash
# on-prem 시크릿 내용 추출 (cp-1에서)
kubectl get secret app-secrets -n tutum-app -o jsonpath='{.data}' | python3 -c "
import json, sys, base64
data = json.load(sys.stdin)
for k, v in data.items():
    print(f'{k}={base64.b64decode(v).decode()}')
"

# AWS Secrets Manager에 등록
aws secretsmanager create-secret \
  --name tutum/app-secrets \
  --region ap-northeast-2 \
  --secret-string file://app-secrets.env

# External Secrets Operator 설치
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace

# IRSA: backend SA에 secretsmanager:GetSecretValue 권한 부여
eksctl create iamserviceaccount \
  --name backend \
  --namespace tutum-app \
  --cluster tutum-stg-eks \
  --attach-policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite \
  --approve
```

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

### Phase A (기반 준비) — 🔶 대부분 완료
- [ ] 온프레미스 리소스 스냅샷 추출 (`kubectl get all -A -o yaml`)
- [x] ECR repo 3개 생성 (`tutum/backend`, `tutum/frontend`, `tutum/workers`)
- [ ] 기존 운영 이미지 → ECR 미러링 (선택사항 — 파이프라인 첫 실행으로 대체 가능)
- [x] GitLab CI 변수: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `ECR_REGISTRY` 등록 완료
- [ ] GitLab CI 변수: `COSIGN_PRIVATE_KEY` (File), `COSIGN_PUBLIC_KEY` 수동 업데이트 필요 (cp-2 `/tmp/cosign.key`, `/tmp/cosign.pub`)
- [x] VPC 생성 완료 (10.60.0.0/16, public 10.60.1~2.0/24, private 10.60.11~12.0/24)
- [x] ACM `*.tutum.my` 인증서 발급 신청 + Route53 DNS validation CNAME 등록 완료

### Phase B (EKS 구성) — 🔶 진행 중
**기본 인프라**
- [x] EKS 클러스터 생성 (`tutum-stg-eks` ACTIVE, `tutum-prd-eks` ACTIVE, Auto Mode, K8s v1.29)
- [x] 네임스페이스 생성 (tutum-app, tutum-data, tutum-storage, monitoring, keda)
- [x] Istio minimal profile 설치 (istiod Running, IngressGateway 없음)
- [x] 사이드카 주입: tutum-app, tutum-data 네임스페이스 label 완료
- [x] ALB Ingress Controller 설치 (2/2 Running, eks/aws-load-balancer-controller v3.1.0)
- [x] ArgoCD 설치 (7/7 Running, private subnet 10.60.11.x)
- [x] NetworkPolicy 이식 (vpc-cni network policy 활성화 + manifest 적용)
- [x] MariaDB 연결 확인 (SSM send-command → `MARIADB_REACHABLE` ✅)

**미완료 — 기본**
- [ ] **시크릿 재생성** (app-secrets, OAuth 키, gitlab-registry-secret 등) — EKS에 미생성
- [ ] **KEDA 설치 + ScaledObject 적용** (on-prem 정상, EKS 미설치)
- [ ] **Kyverno 설치 + ECR 정책 적용** (on-prem 완료, EKS 미설치)
- [ ] **ECR 토큰 갱신 CronJob** (`kyverno` ns, 6시간마다 ECR 토큰 갱신)
- [ ] **ArgoCD GitLab 리포 연결** (`argocd repo add`)
- [ ] **staging-app.yaml destination → `https://kubernetes.default.svc`**
- [ ] Worker SG outbound 211.46.52.153:15432 명시적 허용 (현재 기본 SG로 통과 중)

**미완료 — 보안 강화 (B-9 ~ B-13)**
- [ ] **NACL 생성** — public subnet (10.60.1/2.0/24): 80/443 inbound only
- [ ] **VPC Endpoint: ECR API** (Interface, private subnet) — ECR 인증 내부망
- [ ] **VPC Endpoint: ECR DKR** (Interface, private subnet) — 이미지 pull NAT GW 비용↓
- [ ] **VPC Endpoint: S3 Gateway** (무료, route table 자동 추가) — S3 내부망
- [ ] **VPC Endpoint: Secrets Manager** (Interface) — 시크릿 조회 내부망
- [ ] **AWS WAF WebACL** 생성 + ALB 연결 (AWSManagedRulesCommonRuleSet + RateLimit 2000/5min)
- [ ] **GuardDuty 활성화** (EKS Audit Logs + Runtime Monitoring + S3 Data Events)
- [ ] **GuardDuty → SNS → Slack `#tutum-alerts`** EventBridge 연동
- [ ] **AWS KMS CMK** 생성 (EBS PVC 암호화, S3 버킷 암호화용)
- [ ] **AWS Secrets Manager** app-secrets 등록 + External Secrets Operator + IRSA

### Phase C (CI/CD 전환) — 🔶 코드 완료, 파이프라인 미실행
- [x] `backend/Dockerfile`, `backend/workers/Dockerfile` → `python:3.11-alpine` 전환
- [x] `.gitlab-ci.yml` ECR 전환 (build/scan/sign/deploy 전 구간)
- [x] `k8s-manifests/overlays/staging|production/kustomization.yaml` ECR 이미지 경로
- [x] Cosign 새 키쌍 생성 (cp-2 `/tmp/cosign.key`, `/tmp/cosign.pub`, 패스워드: tutum123)
- [x] Kyverno cosign-verify-policy.yaml ECR 경로 + 새 공개키 → on-prem 적용 완료
- [ ] **GitLab CI COSIGN_PRIVATE_KEY/PUBLIC_KEY 수동 업데이트** → 파이프라인 실행 차단 중
- [ ] 파이프라인 실행 (build → scan → sign → deploy, ECR 전 구간 동작 확인)
- [ ] Kyverno 이미지 서명 검증 통과 확인 (EKS 설치 후)
- [ ] 스테이징 E2E 검증 (로그인, 시세, 뉴스, AI, OCR, MariaDB)

### Phase D (데이터 이전) — ⬜ 미시작
- [ ] S3 버킷 생성 (`tutum-prod-storage`) + KMS 암호화 + 퍼블릭 액세스 차단
- [ ] MinIO → S3 mc mirror 완료 (ocr-images, profile-images 버킷)
- [ ] Backend MINIO_* env → S3 + IRSA 적용 (키 제거)
- [ ] Redis: 빈 상태 시작 (캐시 데이터 손실 허용) or RDB 이전
- [ ] Kafka: 빈 상태 시작 + 동일 토픽 생성 (메시지 재생산 가능)
- [ ] Elasticsearch: EKS StatefulSet 배포 + S3 스냅샷 복원 (repository-s3 플러그인 필요)
- [ ] 모니터링 EC2 생성 (EKS VPC private subnet, t3.medium)
- [ ] Docker Compose LGTM 기동 (Grafana/Loki/Tempo/Mimir)
- [ ] EKS Alloy DaemonSet remote_write → 모니터링 EC2 내부 IP
- [ ] S3 Lifecycle 설정 (ocr-images 180일 만료, backups/ Glacier 30일)
- [ ] CloudTrail 활성화 + S3 저장 (90일 보관)

### Phase E (컷오버) — ⬜ 미시작
- [ ] ACM `*.tutum.my` 인증서 ISSUED 확인 후 ALB Ingress 생성
- [ ] OAuth 콜백 URL → ALB DNS 또는 tutum.my (Google, Naver)
- [ ] Cloudflare Tunnel origin → ALB DNS
- [ ] tutum.app 전체 기능 접속 확인
- [ ] 1주일 병행 운영 (EKS Error Rate < 1% 확인 후 온프레미스 철수)
- [ ] 온프레미스 워크로드 순차 중단
- [ ] AWS Budget Alert $700 임계값 설정
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
