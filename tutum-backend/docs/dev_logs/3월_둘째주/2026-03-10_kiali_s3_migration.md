# 개발 로그 작업 요약 (2026-03-10)

## 1. 작업 요약

- 작업 일시: 2026-03-10
- 작업자: 김경윤
- 브랜치: develop
- 작업 목적:
  - **D-4** MinIO → AWS S3 이전: EKS 환경에서 파일 저장소를 MinIO(레거시)에서 AWS S3(IRSA 방식)로 교체
  - **D-7** Kiali 설치: Istio 서비스 메시 시각화 도구 배포 및 외부 접근 구성

---

## 2. 상세 변경 사항

### D-4 MinIO → AWS S3 이전

#### 인프라

| 항목 | 변경 내용 |
|------|-----------|
| S3 버킷 | `tutum-prod-storage` 생성 (ap-northeast-2, private) |
| IAM 정책 | `tutum-backend-s3-policy` 생성 (`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on `tutum-prod-storage/*`) |
| IRSA | 기존 `tutum-backend-secrets-role`에 `tutum-backend-s3-policy` 연결 (backend-sa 재사용) |

```bash
# S3 버킷 생성
aws s3api create-bucket --bucket tutum-prod-storage \
  --region ap-northeast-2 \
  --create-bucket-configuration LocationConstraint=ap-northeast-2

# 정책 연결
aws iam attach-role-policy \
  --role-name tutum-backend-secrets-role \
  --policy-arn arn:aws:iam::903913341620:policy/tutum-backend-s3-policy
```

#### 코드 변경

- **`backend/app/config.py`**: `S3_BUCKET_NAME: str = ""` 필드 추가
  - 값이 비어 있으면 MinIO fallback, 값이 있으면 S3 모드로 동작
- **`backend/app/services/storage.py`**: 전면 재작성
  - `_USE_S3 = bool(settings.S3_BUCKET_NAME)` 스위치로 백엔드 선택
  - S3 모드: boto3 + IRSA, 단일 버킷 `tutum-prod-storage`, prefix `ocr-images/` / `profile-images/`로 구분
  - MinIO fallback: 기존 코드 유지 (하위 호환)

#### K8s 환경변수 패치

```bash
kubectl patch secret backend-secret -n tutum-app --type=json -p='[
  {"op":"replace","path":"/data/S3_BUCKET_NAME",
   "value":"'$(echo -n "tutum-prod-storage" | base64)'"}
]'
kubectl rollout restart deployment/backend -n tutum-app
```

---

### D-7 Kiali 설치

#### ECR 이미지 미러링 (quay.io 접근 불가)

EKS private subnet 노드는 quay.io에 직접 접근 불가 → monitoring EC2(10.60.11.95)에서 SSM으로 pull → ECR push.

| 이미지 | ECR 경로 |
|--------|----------|
| `quay.io/kiali/kiali-operator:v2.23.0` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/kiali/kiali-operator:v2.23.0` |
| `quay.io/kiali/kiali:v2.23.0` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/kiali/kiali:v2.23.0` |

```bash
# 예시: kiali 미러링 (monitoring EC2 SSM 경유)
aws ssm send-command --instance-ids i-0a8cab5d5ce1cac60 \
  --parameters 'commands=[
    "aws ecr get-login-password --region ap-northeast-2 | docker login ...",
    "docker pull quay.io/kiali/kiali:v2.23.0",
    "docker tag quay.io/kiali/kiali:v2.23.0 903913341620.dkr.ecr.../kiali/kiali:v2.23.0",
    "docker push 903913341620.dkr.ecr.../kiali/kiali:v2.23.0"
  ]'
```

#### Kiali Operator 설치 (Helm)

```bash
helm install kiali-operator kiali/kiali-operator \
  -n istio-system --create-namespace \
  --set image.repo=903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/kiali/kiali-operator \
  --set image.tag=v2.23.0
```

#### Kiali CR

```yaml
# k8s 오브젝트: kiali.io/v1alpha1 Kiali
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

#### ALB Ingress + Route53

- **Ingress** `kiali-ingress` (namespace: istio-system): ALB group `tutum-stg`, host `kiali.tutum.my` → `kiali:20001`
- **Route53**: `kiali.tutum.my` A alias → `k8s-tutumstg-522ae53287-1398442796.ap-northeast-2.elb.amazonaws.com`

---

## 3. 작업 중 발생 이슈 및 대응

### 이슈 1: Kiali operator `ImagePullBackOff`

- **원인**: `quay.io/kiali/kiali-operator:v2.23.0` — private subnet에서 quay.io 타임아웃
- **대응**: monitoring EC2(인터넷 접근 가능) SSM 경유로 ECR에 미러링 → `kubectl set image`로 ECR 이미지 사용

### 이슈 2: Kiali pod `ImagePullBackOff`

- **원인**: Kiali CR 적용 시 operator가 `quay.io/kiali/kiali:v2.23.0` 이미지로 pod 생성 → 동일 문제
- **대응**: `kiali/kiali` 이미지도 ECR 미러링 → `kubectl set image deployment/kiali` 패치

### 이슈 3: ALB controller `SetRulePriorities` 403

- **원인**: `AWSLoadBalancerControllerIAMPolicy`에 `elasticloadbalancing:SetRulePriorities` 권한 누락
- **대응**: inline policy `ALBSetRulePriorities` 추가 → Kiali ALB 룰 생성 성공

### 이슈 4: ALB controller 재시작 실패

- **원인**: `kubectl rollout restart` 시 새 pod가 ARM64 노드에 스케줄 → AMD64 ECR 미러 이미지와 아키텍처 불일치 → `exec format error`
- **대응**: `kubectl rollout undo` 로 기존 pod 유지 (IAM 정책은 STS 세션 만료 후 자동 적용)

### 이슈 5: IRSA 새 서비스어카운트 문제 (D-4)

- **원인**: 신규 `backend` SA를 생성했으나 기존 deployment는 `backend-sa` 사용 중
- **대응**: 신규 SA 삭제, 기존 `tutum-backend-secrets-role`에 S3 정책 직접 연결

---

## 4. 결과

### 검증 항목 및 결과

| 검증 항목 | 명령/엔드포인트 | 결과 |
|-----------|----------------|------|
| Kiali UI 접근 | `curl -o /dev/null -w "%{http_code}" https://kiali.tutum.my/kiali/` | 200 OK ✅ |
| Kiali pod 상태 | `kubectl get pod -n istio-system -l app=kiali` | Running 1/1 ✅ |
| Kiali 로그 정상 | `Server endpoint will start at [:20001/kiali]` | 정상 기동 ✅ |
| S3 bucket 존재 | `aws s3 ls s3://tutum-prod-storage` | 조회 성공 ✅ |
| backend 재기동 | `kubectl rollout status deployment/backend -n tutum-app` | SUCCESS ✅ |

---

## 5. 커밋 로그

```bash
git log --oneline --after="2026-03-09"
```

```
07a3a83 Merge branch 'develop' of gitlab.com:tutum-project/.../backend into develop
b2f3d73 docs: add dev log for D-4 MinIO→S3 and D-7 Kiali installation
2b60b15 feat(storage): migrate to AWS S3 with IRSA, keep MinIO fallback
077083c fix(lint): fix remaining E221 alignment spaces in price_producer
96925eb fix(lint): fix E221 alignment spaces and E305 blank lines
```

---

## 6. 후속 작업/리스크

- **D-8 Terraform IaC**: 기존 수동 생성 AWS 인프라를 Terraform으로 import (S3 backend + 모듈 작성)
- **D-6 SonarQube**: monitoring EC2 docker-compose에 추가 또는 EKS Pod 배포
- **Kiali Prometheus 401**: Mimir(9009/prometheus) 인증 이슈 가능 → 로그 모니터링 필요
- **ALB controller 이미지 정책**: ARM64/AMD64 혼합 클러스터 대응을 위해 multi-arch ECR 이미지 또는 nodeSelector 추가 검토
- **Kiali 접근 제어**: 현재 `anonymous` auth → 내부 사용 한정이나 IP 화이트리스트 또는 basic auth 추가 검토
