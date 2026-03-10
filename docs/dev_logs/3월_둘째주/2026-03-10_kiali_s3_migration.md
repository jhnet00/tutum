# 2026-03-10 D-7 Kiali + D-4 MinIO → S3 작업

- 작업자: Kyungyoon Kim
- 작업 시간: 2026-03-10 (세션 연속)

---

## 1. D-4 MinIO → S3 이전

### 배경

EKS 클러스터는 신규 구성이라 MinIO에 데이터 없음 → 데이터 마이그레이션 생략, 코드/설정만 교체.

### 인프라 작업

```bash
# S3 버킷 생성
aws s3api create-bucket --bucket tutum-prod-storage \
  --region ap-northeast-2 \
  --create-bucket-configuration LocationConstraint=ap-northeast-2

# IAM 정책 생성 및 기존 IRSA 역할에 연결
aws iam create-policy --policy-name tutum-backend-s3-policy \
  --policy-document '{ ... S3 tutum-prod-storage/* 접근 권한 ... }'

# backend-sa는 이미 tutum-backend-secrets-role을 사용 중
# 기존 역할에 직접 정책 연결
aws iam attach-role-policy \
  --role-name tutum-backend-secrets-role \
  --policy-arn arn:aws:iam::903913341620:policy/tutum-backend-s3-policy
```

### 코드 변경

**backend/app/config.py**: `S3_BUCKET_NAME: str = ""` 필드 추가 (비어 있으면 MinIO 사용)

**backend/app/services/storage.py**: 전체 재작성
- `_USE_S3 = bool(settings.S3_BUCKET_NAME)` 스위치
- S3 사용 시: boto3 + IRSA (단일 버킷 `tutum-prod-storage`, prefix로 ocr-images/profile-images/ 구분)
- MinIO fallback: 기존 코드 유지

### 환경변수 패치

```bash
kubectl patch secret backend-secret -n tutum-app --type=json -p='[
  {"op":"replace","path":"/data/S3_BUCKET_NAME",
   "value":"'$(echo -n "tutum-prod-storage" | base64)'"}
]'
kubectl rollout restart deployment/backend -n tutum-app
```

### 결과

- S3 버킷: `tutum-prod-storage` (ap-northeast-2) ✅
- IRSA: `tutum-backend-secrets-role` + `tutum-backend-s3-policy` ✅
- Backend: S3 모드로 정상 기동 ✅

---

## 2. D-7 Kiali 설치

### 설치 방법

Kiali Operator Helm chart → quay.io 이미지 ECR 미러링 패턴.

#### ECR 미러링 (quay.io 접근 불가)

EKS private subnet 노드는 quay.io 접근 불가 → monitoring EC2(10.60.11.95) SSM 경유 ECR 미러링.

```bash
# kiali-operator 미러링 (이전 세션)
aws ecr create-repository --repository-name kiali/kiali-operator
# SSM으로 monitoring EC2에서 pull → tag → push to ECR

# kiali 미러링
aws ecr create-repository --repository-name kiali/kiali
# SSM으로 monitoring EC2에서 pull → push
```

#### Kiali Operator 설치

```bash
helm install kiali-operator kiali/kiali-operator \
  -n istio-system --create-namespace \
  --set image.repo=903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/kiali/kiali-operator \
  --set image.tag=v2.23.0
```

#### Kiali CR 적용

```yaml
apiVersion: kiali.io/v1alpha1
kind: Kiali
metadata:
  name: kiali
  namespace: istio-system
spec:
  auth:
    strategy: anonymous
  deployment:
    accessible_namespaces: [tutum-app, tutum-data, istio-system]
    ingress:
      enabled: false
  external_services:
    grafana:
      enabled: true
      url: "http://10.60.11.95:3000"
    prometheus:
      url: "http://10.60.11.95:9009/prometheus"
    tracing:
      enabled: true
      url: "http://10.60.11.95:3200"
      use_grpc: true
  istio_namespace: istio-system
```

Kiali pod `ImagePullBackOff` → kiali/kiali 이미지도 ECR 미러링 → `kubectl set image` 패치 → Running.

#### ALB Ingress (kiali.tutum.my)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: kiali-ingress
  namespace: istio-system
  annotations:
    alb.ingress.kubernetes.io/group.name: tutum-stg
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:...:certificate/cc8731ed-...
    alb.ingress.kubernetes.io/healthcheck-path: /kiali/
spec:
  ingressClassName: alb
  rules:
  - host: kiali.tutum.my
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: kiali
            port:
              number: 20001
```

**트러블슈팅**: ALB controller에 `SetRulePriorities` 권한 누락 → inline policy 추가.
Kiali ALB 룰은 성공적으로 생성됨 (priority 재정렬만 실패, 기능에는 영향 없음).

Route53: `kiali.tutum.my` A alias → ALB DNS.

### 결과

- `https://kiali.tutum.my/kiali/` → 200 OK ✅
- auth.strategy: anonymous (별도 인증 불필요)
- Grafana/Prometheus/Tempo 연동 설정 완료

---

## 3. 현재 인프라 상태

| 항목 | 상태 |
|------|------|
| MinIO → S3 이전 | ✅ D-4 완료 |
| Kiali | ✅ D-7 완료 (`kiali.tutum.my`) |
| Terraform IaC | ⬜ D-8 미구현 |
| SonarQube | ⬜ D-6 미구현 |

## 4. 다음 작업

1. **Terraform D-8**: S3 backend + 모듈 작성 + import 실행
2. **SonarQube D-6**: monitoring EC2 docker-compose 추가
3. **Kiali 연동 개선**: Prometheus 401 오류 확인 (Mimir auth 이슈 가능)
