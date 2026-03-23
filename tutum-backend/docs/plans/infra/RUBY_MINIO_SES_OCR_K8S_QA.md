# RUBY MinIO / SES / OCR / K8s QA Checklist

작성자: `ruby`  
작성일: `2026-03-03`  
대상 네임스페이스: `tutum-app`, `tutum-storage`

---

## 0. 먼저 확인 (중요)

### 0-1. `kubectl` 실행 위치
- 이 문서의 `kubectl` 명령은 기본적으로 **control-plane 노드(cp-3)** 에서 실행한다.
- `worker` 노드에서 아래 오류가 나면 kubeconfig/context가 없는 상태다.

```text
The connection to the server localhost:8080 was refused
```

이는 Cloudflare tunnel 문제와 무관하다.

### 0-2. 왜 `minio.tutum-storage.svc.cluster.local` 인가
- `minio.tutum-storage.svc.cluster.local:9000`은 **클러스터 내부 DNS** 이며 정상 값이다.
- `tutum.my`는 외부 사용자 경로(Cloudflare 경유)이고, 내부 서비스 DNS와 목적이 다르다.

### 0-3. 기본 사전 점검

```bash
kubectl config current-context
kubectl get nodes -o wide
kubectl get ns tutum-app tutum-storage
```

---

## 1. MinIO QA

### 1-1. 배포 상태 확인

```bash
kubectl -n tutum-storage get statefulset,pod,svc,pvc
kubectl -n tutum-storage get job minio-init
kubectl -n tutum-storage logs job/minio-init
```

성공 기준:
- `minio-0` Running
- `minio-data-minio-0` Bound
- `minio-init` Completed

### 1-2. Section 1-4 장애 포인트 해결 (Service DNS 테스트)

반드시 cp-3에서 실행:

```bash
kubectl -n tutum-app run curl-test --rm -it --restart=Never --image=curlimages/curl -- \
  curl -sS -i http://minio.tutum-storage.svc.cluster.local:9000/minio/health/live
```

성공 기준:
- `HTTP/1.1 200 OK`

실패 시 점검:

```bash
kubectl -n tutum-storage get svc minio -o wide
kubectl -n tutum-storage get endpoints minio
kubectl -n tutum-storage logs statefulset/minio --tail=100
kubectl -n tutum-app get networkpolicy
```

### 1-3. Backend 환경변수 확인

```bash
kubectl -n tutum-app exec -it deploy/backend -- env | grep MINIO
```

성공 기준:
- `MINIO_ENDPOINT=minio.tutum-storage.svc.cluster.local:9000`
- `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` 존재

---

## 2. SES/SQS QA

### 2-1. 워커 및 백엔드 환경변수

```bash
kubectl -n tutum-app exec -it deploy/email-worker -- env | grep -E "AWS_|SQS_|SES_|FRONTEND"
kubectl -n tutum-app exec -it deploy/backend -- env | grep -E "AWS_|SQS_|FRONTEND"
```

### 2-2. 워커 로그 확인

```bash
kubectl -n tutum-app logs -f deploy/email-worker --tail=50
```

성공 기준:
- 큐 연결 성공 로그
- `InvalidClientTokenId`, `QueueDoesNotExist` 미발생

---

## 3. OCR QA

## 3-1. 현재 배포 구조
- 현재 OCR은 backend `/api/v1/ocr/*` 통합 라우트가 아니라, 별도 서비스 `ocr`(포트 8002)다.
- 프론트는 `/api/proxy/import/*` 경로로 OCR 서비스에 프록시한다.

검증:

```bash
kubectl -n tutum-app get deploy ocr
kubectl -n tutum-app get svc ocr
kubectl -n tutum-app logs deploy/ocr --tail=80
```

### 3-2. OCR 업로드 직접 테스트 (클러스터 내부)

```bash
kubectl -n tutum-app run ocr-curl --rm -it --restart=Never --image=curlimages/curl -- \
  sh -c 'curl -sS -X POST http://ocr.tutum-app.svc.cluster.local:8002/import/ocr \
    -F "file=@/etc/hosts" -F "user_id=qa-user"'
```

주의:
- 샘플은 `/etc/hosts`로 호출 형태만 확인한다.
- 실제 OCR 품질 테스트는 이미지 파일이 필요하다.

### 3-3. OCR 토큰/주소 기준 정리

`curl -X POST http://<CLUSTER-IP>/api/v1/ocr/upload -H "Authorization: Bearer <token>" ...` 문구는 아래처럼 해석한다.

- `<token>`: 일반적으로는 `/api/v1/auth/login` 성공 시 반환되는 `access_token`(JWT)
- `<CLUSTER-IP>`: Kubernetes Service의 내부 IP(대개 `10.x.x.x`), **VM IP(예: 192.168.x.x) 아님**

현재 배포에서는 OCR 엔드포인트가 `ocr` 서비스의 `/import/ocr`이므로, 인증 토큰 없이도 호출된다.
향후 backend `/api/v1/ocr/*` 보호 라우트로 통합되면 Bearer 토큰을 사용한다.

---

## 4. 공통 트러블슈팅

### 4-1. worker에서 `kubectl`이 localhost:8080으로 붙는 경우
- 원인: worker에 kubeconfig/context가 없음
- 해결: cp-3로 접속해서 명령 실행

### 4-2. 재시작 순서 (환경변수 반영)

```bash
kubectl -n tutum-app rollout restart deploy/backend deploy/email-worker deploy/ocr
kubectl -n tutum-app rollout status deploy/backend
kubectl -n tutum-app rollout status deploy/email-worker
kubectl -n tutum-app rollout status deploy/ocr
```

---

## 5. Done Definition

- MinIO: Pod/PVC 정상 + 서비스 DNS 헬스체크 `200`
- SES/SQS: email-worker 큐 연결 정상 + 회원가입 메일 발송 확인
- OCR: `ocr` 서비스 업로드/드래프트 호출 성공 + MinIO 저장 확인

