# 작업 계획서 — Auth 서비스 배포 + 모니터링 수집 수정

- 작성일: 2026-03-11
- 작성자: 김경윤
- 관련 Phase: B(EKS 구성), C(CI/CD), D(모니터링)

---

## 배경 및 문제 정의

### 문제 1: tutum.my/api/v1/auth → "Backend service does not exist"
- **원인**: `auth` 서비스가 backend 모놀리스에서 독립 서비스로 분리(`tutum-app/auth` 레포)
- backend `main.py`에서 `/api/v1/auth` 라우터 이미 제거됨
- ALB Ingress는 `/api/v1/auth` → `auth-svc:8000` 라우팅 설정됨
- **`auth-svc` Deployment/Service가 EKS에 미배포 상태**

### 문제 2: OAuth 콜백 URL 미등록
- Google OAuth Console에 `https://tutum.my/api/v1/auth/google/callback` 미등록
- 별도 callback 페이지 불필요 — auth 서비스가 `/api/v1/auth/google/callback` 직접 처리
- **브라우저 수동 작업 필요** (자동화 불가)

### 문제 3: 모니터링 데이터 Mimir에 안 들어옴
- **원인**: Alloy가 Mimir에 push 시 `400 Bad Request: out-of-order samples`
- 복수의 Alloy Pod(12개)가 같은 시계열을 중복 push → 타임스탬프 역전
- Mimir 기본 설정은 out-of-order 샘플 거부
- **Mimir 설정에 `out_of_order_time_window` 허용 필요**

---

## 작업 계획

### Task 1: Auth 서비스 EKS 배포 (정식 배포 — Option B)

**순서**:
1. ECR 레포 `tutum/auth` 생성
2. `k8s-manifests/base/auth/` 디렉토리 + 매니페스트 작성 (Deployment + Service)
3. `k8s-manifests/base/kustomization.yaml`에 auth 추가
4. Docker 이미지 빌드 + ECR push (로컬 또는 GitLab CI)
5. ArgoCD sync 또는 kubectl apply로 EKS 배포
6. `auth-svc` Running 확인 + `tutum.my/api/v1/auth/google/login` 접속 확인

**필요 리소스**:
- ECR: `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/tutum/auth`
- K8s Secret: `backend-secret` (auth 서비스가 동일한 시크릿 사용 예상)
- Namespace: `tutum-app` (기존 네임스페이스 사용)

**상태**: ⬜ 미완료

---

### Task 2: OAuth 콜백 URL 등록 (수동 작업)

**대상**: Google Cloud Console + Naver Developer Console

> **별도 콜백 페이지 불필요**: auth 서비스 자체가 `/api/v1/auth/google/callback`을 처리하므로
> 프론트엔드에 별도 페이지 추가 없이 Google Console에 URL만 등록하면 됨.

**Google Cloud Console 등록 절차**:
```
1. console.cloud.google.com 접속
2. API 및 서비스 → 사용자 인증 정보 → OAuth 2.0 클라이언트 ID
3. "승인된 리디렉션 URI" 에 추가:
   - https://tutum.my/api/v1/auth/google/callback
4. 저장
```

**Naver Developer Console**:
```
1. developers.naver.com 접속
2. 내 애플리케이션 → tutum → API 설정
3. 서비스 URL: https://tutum.my
4. Callback URL: https://tutum.my/api/v1/auth/naver/callback
5. 저장
```

**상태**: ⬜ 수동 작업 대기

---

### Task 3: Mimir out-of-order 샘플 허용 설정

**원인 분석**:
```
level=error msg="non-recoverable error"
  component_id=prometheus.remote_write.mimir
  err="server returned HTTP status 400 Bad Request:
  out-of-order samples are not allowed (err-mimir-sample-out-of-order)"
```
- Alloy DaemonSet 12개 Pod이 동일 시계열 중복 push
- Mimir가 과거 타임스탬프 샘플 거부

**해결책**: 모니터링 EC2(i-0a8cab5d5ce1cac60)의 Mimir 설정에 `out_of_order_time_window: 30m` 추가

**수정 대상**: EC2 `/opt/monitoring/` 내 mimir 설정 파일

**상태**: ⬜ 미완료

---

## 체크리스트

### Task 1 — Auth 서비스 배포
- [ ] ECR 레포 `tutum/auth` 생성
- [ ] `k8s-manifests/base/auth/deployment.yaml` 작성
- [ ] `k8s-manifests/base/auth/service.yaml` 작성
- [ ] `k8s-manifests/base/kustomization.yaml` auth 경로 추가
- [ ] Docker 이미지 빌드 + ECR push (`tutum/auth:latest`)
- [ ] EKS 배포 (kubectl apply 또는 ArgoCD sync)
- [ ] `kubectl get pods -n tutum-app | grep auth` Running 확인
- [ ] `curl https://tutum.my/api/v1/auth/google/login` → 302 redirect 확인

### Task 2 — OAuth 콜백 URL (수동)
- [ ] Google Cloud Console — 리디렉션 URI 추가 (수동)
- [ ] Naver Developer Console — Callback URL 추가 (수동)
- [ ] 브라우저에서 Google 소셜 로그인 E2E 확인

### Task 3 — Mimir 설정 수정
- [ ] EC2 SSM으로 접속, mimir 설정 파일 확인
- [ ] `out_of_order_time_window: 30m` 설정 추가
- [ ] mimir 컨테이너 재시작 (`docker compose restart mimir`)
- [ ] Alloy 로그에서 400 에러 없어짐 확인
- [ ] Grafana → Explore → Mimir — `up{namespace="tutum-app"}` 쿼리 데이터 수신 확인

---

## 완료 후 업데이트 대상

- `AWS_MIGRATION_DETAIL_GUIDE.md`
  - Phase B: auth 서비스 배포 완료 항목 체크
  - Phase D-9-V: LGTM 모니터링 데이터 수신 확인 완료 항목 체크
  - 체크리스트 Phase B, D 완료 항목 갱신
