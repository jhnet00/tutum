# MinIO / SES(SQS) / OCR(Google Vision) — K8s QA 체크리스트

> **담당**: 김루비 (ruby)  
> **네임스페이스**: `tutum-storage` (MinIO), `tutum-app` (SES worker, OCR)  
> **현재 클러스터**: 3 CP + 3 Worker, all Ready  
> **작성일**: 2026-02-25

---

## 공통 전제조건 확인

```bash
# 네임스페이스 존재 확인 (이미 Active 상태 확인됨)
kubectl get ns tutum-app tutum-storage

# Ingress Controller alive 확인
kubectl -n ingress-nginx get pods
# 또는 monitoring ns에 있으면:
kubectl get pods -A | grep ingress
```

- [ ] `tutum-app` namespace **Active**
- [ ] `tutum-storage` namespace **Active**
- [ ] Ingress Controller Pod Running

---

## Section 1: MinIO

### 1-1. Secret / StatefulSet 배포

```bash
kubectl apply -f k8s-manifests/base/storage/minio-secret.yaml
kubectl apply -f k8s-manifests/base/storage/minio.yaml
```

- [ ] Apply 에러 없음

### 1-2. Pod & PVC 상태 확인

```bash
kubectl -n tutum-storage get statefulsets
kubectl -n tutum-storage get pods
kubectl -n tutum-storage get pvc
```

**기대값**:

```
NAME    READY   AGE
minio   1/1     ...

NAME        STATUS   VOLUME   CAPACITY
minio-data-minio-0   Bound   ...   20Gi
```

- [ ] `minio-0` Pod **Running**
- [ ] PVC `minio-data-minio-0` **Bound** (StorageClass 미지정 시 `local-path` 사용됨)

> **주의**: PVC가 `Pending`이면 StorageClass 확인
>
> ```bash
> kubectl get sc
> # local-path 가 default라면 OK
> ```

### 1-3. 버킷 초기화 Job 확인

```bash
kubectl -n tutum-storage get job minio-init
kubectl -n tutum-storage logs job/minio-init
```

**기대 로그**:

```
MinIO buckets initialized
```

- [ ] Job **Completed**
- [ ] `ocr-images` 버킷 생성 확인
- [ ] `profile-images` 버킷 생성 확인

> Job이 실패하면 MinIO Pod 기동 전 Job이 실행된 타이밍 문제일 수 있음.
> `kubectl -n tutum-storage delete job minio-init` 후 재실행.

### 1-4. 내부 Service DNS 확인

```bash
# 아무 Pod에서 minio 접근 테스트
kubectl -n tutum-app run curl-test --rm -it --image=curlimages/curl -- \
  curl -s http://minio.tutum-storage.svc.cluster.local:9000/minio/health/live
```

- [ ] HTTP 200 응답

### 1-5. Backend → MinIO 연결 확인

```bash
# backend Pod 환경변수 확인
kubectl -n tutum-app exec -it deploy/backend -- env | grep MINIO

# OCR 업로드 API 연결 테스트 (OCR 배포 후)
curl -X POST http://<CLUSTER-IP>/api/v1/ocr/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@test.jpg"
```

- [ ] `MINIO_ENDPOINT=minio.tutum-storage.svc.cluster.local:9000` 확인
- [ ] 업로드 API 정상 동작

---

## Section 2: SES / SQS (이메일 인증)

### 2-1. backend-secret 업데이트

```bash
kubectl apply -f k8s-manifests/base/backend/secret.yaml
```

- [ ] Apply 에러 없음

### 2-2. email-worker 배포 및 환경변수 확인

```bash
kubectl apply -f k8s-manifests/base/workers/email-worker.yaml
kubectl rollout restart deploy/email-worker -n tutum-app

# Pod 기동 대기
kubectl -n tutum-app rollout status deploy/email-worker

# 환경변수 확인
kubectl -n tutum-app exec -it deploy/email-worker -- env | grep -E "AWS_|SQS_|SES_|FRONTEND"
```

**기대값**:

```
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=...
SQS_QUEUE_NAME=tutum-email-verify-queue
SES_SENDER_EMAIL=clouddx.krb@gmail.com
FRONTEND_URL=https://tutum.my
```

- [ ] 위 5개 환경변수 존재
- [ ] Pod **Running** (CrashLoopBackOff 없음)

### 2-3. email-worker SQS 연결 로그 확인

```bash
kubectl -n tutum-app logs -f deploy/email-worker --tail=30
```

**기대 로그**:

```
✅ Connected to SQS queue: tutum-email-verify-queue
🔄 Starting email worker... (Press Ctrl+C to stop)
```

- [ ] SQS 연결 성공 로그 확인
- [ ] `❌ Failed to get queue URL` 에러 없음

> **실패 시 디버그**:
>
> - `ClientError: An error occurred (InvalidClientTokenId)` → IAM 키 만료/잘못됨 → 키 재발급
> - `QueueDoesNotExist` → AWS Console에서 SQS 큐 직접 확인
> - `Could not connect to the endpoint URL` → AWS_REGION 오타 확인

### 2-4. backend에서 SQS enqueue 확인

```bash
# backend 재배포 (환경변수 반영)
kubectl rollout restart deploy/backend -n tutum-app
kubectl -n tutum-app rollout status deploy/backend

# backend 환경변수 확인
kubectl -n tutum-app exec -it deploy/backend -- env | grep -E "AWS_|SQS_|FRONTEND"
```

- [ ] backend Pod `AWS_ACCESS_KEY_ID` 존재
- [ ] backend Pod `SQS_QUEUE_NAME` 존재
- [ ] backend Pod `FRONTEND_URL=https://tutum.my` 존재

### 2-5. E2E 이메일 인증 테스트

```bash
# 회원가입 API 직접 호출
curl -X POST http://tutum.my/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "clouddx.krb@gmail.com",
    "password": "Test1234!",
    "nickname": "testuser",
    "marketing_opt_in": false
  }'
```

**기대 응답**:

```json
{
  "message": "회원가입이 완료되었습니다. 이메일을 확인하여 인증을 완료해주세요.",
  "verification_required": true
}
```

- [ ] 201/200 응답
- [ ] `clouddx.krb@gmail.com` 받은편지함에 인증 메일 수신

> **이메일 미수신 시**:
>
> ```bash
> # email-worker 로그 실시간 확인 (30초 대기)
> kubectl -n tutum-app logs -f deploy/email-worker
> # "📧 Sending verification email" 출력 여부 확인
>
> # SQS 콘솔에서 메시지 잔류 여부 확인
> # AWS Console → SQS → tutum-email-verify-queue → 메시지 수
> ```

### 2-6. 인증 링크 클릭 확인

- [ ] 수신 메일의 "Verify Email Address" 버튼 클릭
- [ ] `https://tutum.my/verify-email?token=xxx` 페이지 정상 표시
- [ ] 이후 로그인 성공

---

## Section 3: OCR (Google Vision AI)

### 3-1. 현재 상태 확인 (OCR K8s 매니페스트 미존재)

```bash
# OCR API가 backend에 통합되어 있는지, 별도 서비스인지 확인
kubectl -n tutum-app get deploy
```

- [ ] OCR이 backend Pod 내부에서 동작하면 → **3-2** 진행
- [ ] OCR이 별도 서비스라면 → **별도 Deployment 작성 필요** (현재 k8s-manifests에 없음)

### 3-2. Google Vision API Key Secret 등록

```bash
# Google Vision API 키가 backend-secret에 있는지 확인
kubectl -n tutum-app get secret backend-secret -o jsonpath='{.data}' | python3 -c "
import sys,json,base64
d=json.load(sys.stdin)
for k in d:
    if 'GOOGLE' in k or 'VISION' in k or 'GCP' in k:
        print(k,'=',base64.b64decode(d[k]).decode())
"
```

- [ ] `GOOGLE_APPLICATION_CREDENTIALS` 또는 `GOOGLE_VISION_API_KEY` 확인

> **키가 없으면**:  
> `backend-secret.yaml`에 추가 후 `kubectl apply`:
>
> ```yaml
> GOOGLE_VISION_API_KEY: "<GCP_API_KEY>"
> ```

### 3-3. OCR API 동작 확인

```bash
# OCR 엔드포인트 확인 (backend 내부)
kubectl -n tutum-app exec -it deploy/backend -- \
  python -c "from app.ocr_api.ocr_app.main import app; print([r.path for r in app.routes])"

# 또는 직접 테스트 (이미지 업로드)
curl -X POST http://tutum.my/api/v1/ocr/analyze \
  -H "Authorization: Bearer <token>" \
  -F "file=@test_receipt.jpg"
```

- [ ] OCR 엔드포인트 존재
- [ ] Google Vision API 호출 성공 응답

> **실패 시 디버그**:
>
> ```bash
> kubectl -n tutum-app logs deploy/backend | grep -i "ocr\|vision\|google"
> # "PERMISSION_DENIED" → API 키 문제
> # "INVALID_ARGUMENT" → 이미지 포맷 문제
> ```

### 3-4. OCR 결과 MinIO 저장 확인

```bash
# OCR 처리 후 MinIO에 이미지가 저장되는지 확인
# MinIO 콘솔 접속 (port-forward 또는 minio.tutum.my)
kubectl -n tutum-storage port-forward svc/minio 9001:9001

# 브라우저: http://localhost:9001
# ID: minioadmin / PW: minioadmin
# ocr-images 버킷에 파일 존재 확인
```

- [ ] MinIO `ocr-images` 버킷에 업로드된 이미지 존재

---

## 디버그 치트시트

```bash
# 전체 Pod 상태 한눈에 보기
kubectl get pods -A | grep -E "tutum|minio"

# 특정 Pod 상세 이벤트 (Pending/Error 원인 파악)
kubectl -n tutum-app describe pod <pod-name>

# Secret 키 목록 확인 (값 미출력)
kubectl -n tutum-app get secret backend-secret -o jsonpath='{.data}' | \
  python3 -c "import sys,json; [print(k) for k in json.load(sys.stdin)]"

# 모든 worker 로그 한꺼번에
kubectl -n tutum-app logs -l app=email-worker --tail=50

# 재배포 롤링 (모든 변경 반영)
kubectl -n tutum-app rollout restart deploy/backend deploy/email-worker
kubectl -n tutum-app rollout status deploy/backend
kubectl -n tutum-app rollout status deploy/email-worker
```

---

## 완료 기준 (Done Definition)

| 항목    | 기준                                                       |
| ------- | ---------------------------------------------------------- |
| MinIO   | `minio-0` Running + PVC Bound + 버킷 2개 존재              |
| SES/SQS | 회원가입 → 이메일 실제 수신 + 인증 링크 클릭 성공          |
| OCR     | `/api/v1/ocr/...` 호출 → Vision API 응답 + MinIO 저장 확인 |
