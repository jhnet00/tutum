# 2026-03-10 Auth 라우팅 분리 (tutum-v1)

- 작성자: Ruby Kim
- 일시: 2026-03-10

## 작업 배경
- 기존 `/api/*` 요청이 `backend-svc`로만 라우팅되면서 인증 API(`/api/v1/auth/*`)도 백엔드로 통합되어 있었음.
- auth 서비스를 별도 분리해 운영 중이므로 `/api/v1/auth`만 별도 서비스로 분기 필요.

## 작업 내용

### 1) Istio VirtualService 라우팅 추가
- 파일: `k8s-manifests/base/ingress/virtualservice.yaml`
- 변경:
  - `http` 룰 최상단에 `/api/v1/auth` 매칭 추가
  - 대상: `auth-svc.tutum-app.svc.cluster.local:8000`
  - 우선순위 보장 위해 기존 `/api` 라우트보다 먼저 배치

### 2) Nginx Ingress 라우팅 추가
- 파일: `k8s-manifests/step2-ingress/02-app-ingress.yaml`
- 변경:
  - `/api/v1/auth` 경로를 `auth-svc:8000`으로 라우팅
  - `/api`는 기존대로 `backend-svc:8000` 유지

### 3) Staging ALB Ingress 라우팅 추가
- 파일: `k8s-manifests/overlays/staging/alb-ingress.yaml`
- 변경:
  - `/api/v1/auth` 경로를 `auth-svc:8000`으로 라우팅
  - `/api`는 기존 백엔드 라우트 유지

### 4) 경로 우선순위 기준 재확인
- `/api/v1/auth`는 `/api`보다 상단에 위치하도록 정렬 (Prefix 매칭 선행 충돌 방지)
- 나머지 프런트 경로(`/`)는 기존대로 유지

## 검증 항목(운영 반영 전)
- [ ] `kubectl -n tutum-app get svc auth-svc` 존재 및 8000 노출 확인
- [ ] `argocd app sync tutum-production` (또는 staging 앱) 동기화 후 상태 확인
- [ ] `curl -i https://tutum.my/api/v1/auth/me`(또는 내부 endpoint) 200/예상 응답 확인
- [ ] `/api/health`는 여전히 backend로 응답되는지 확인

## 반영 파일
- `k8s-manifests/base/ingress/virtualservice.yaml`
- `k8s-manifests/step2-ingress/02-app-ingress.yaml`
- `k8s-manifests/overlays/staging/alb-ingress.yaml`
