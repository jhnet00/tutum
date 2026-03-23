# 개발 로그 작업 요약 (2026-03-12)

## 1. 작업 요약
- 작업 일시: 2026-03-12
- 작업자: 김경윤
- 브랜치: `develop`
- 작업 목적: `https://tutum.my/admin`에서 발생한 `500 Internal Server Error`를 제거하고, Admin AI 탭 runtime patch를 안정화하며, `/admin` 인증 흐름에서 로그인 후 원래 목적지로 복귀하도록 callback redirect를 복구한다.

## 2. 상세 변경 사항
- `k8s-manifests/base/frontend/deployment.yaml`의 frontend startup patch를 보강했다.
  - 기존에 삽입된 잘못된 Admin AI branch가 남아 있더라도 새 safe branch로 교체하도록 변경했다.
  - 기존 로직은 `"ai"===e&&` 분기가 이미 있으면 patch를 건너뛰었기 때문에, 잘못된 branch가 남아 있는 파드에서 `/admin`이 `500`으로 깨질 수 있었다.
- frontend startup 시 `/app/.next/server/middleware.js`를 patch하도록 추가했다.
  - 로그인 상태에서 `/login` 또는 `/register` 접근 시 무조건 `/portfolio/asset`으로 보내던 동작을 수정했다.
  - `callbackUrl`이 있고 `/`로 시작하는 내부 경로면 해당 경로를 우선 사용하도록 변경했다.
  - 결과적으로 `/admin` 비인증 접근 후 `/login?callbackUrl=/admin`으로 이동한 사용자가 로그인하면 `/admin`으로 복귀할 수 있게 했다.
- login page bundle patch를 추가했다.
  - `/app/.next/server/app/login/page.js`
  - `/app/.next/static/chunks/app/login/page-*.js`
  - Google/Kakao/Naver 로그인 버튼이 `callbackUrl`을 유지한 채 `/api/v1/auth/*/login`으로 이동하도록 보강했다.
- `origin/develop`에 반영 후 Argo CD refresh 및 `kubectl apply -k k8s-manifests/overlays/staging`로 live에 적용했다.
- frontend rollout 후 새 ReplicaSet 기준으로 파드가 모두 교체되는지 확인했다.

## 3. 작업 중 발생 이슈 및 대응
- 이슈: `/admin`에서 간헐적으로 `500 Internal Server Error` 발생
  - 대응: 새 AI 탭을 넣는 runtime patch가 기존 잘못된 AI branch를 교체하지 않고 건너뛰는 구조였음을 확인했다. startup patch를 `삽입 전용`에서 `교체 우선`으로 수정해 old branch를 제거했다.
- 이슈: `/admin` 비인증 접근 후 로그인해도 `/portfolio/asset`으로 이동
  - 대응: live frontend `middleware.js`를 확인한 결과, 인증된 상태에서 `/login` 접근 시 항상 `/portfolio/asset`으로 redirect하고 있었다. `callbackUrl`을 우선 사용하는 로직으로 수정했다.
- 이슈: 소셜 로그인 경로에서 callback이 누락될 가능성
  - 대응: login page의 Google/Kakao/Naver 로그인 버튼이 `callbackUrl` 없이 OAuth login endpoint로 이동하고 있어 runtime patch로 query 전달을 추가했다.

## 4. 결과
- 외부 응답 검증:
  - `https://tutum.my/admin` -> `200` 연속 확인
  - `https://tutum.my/admin` 비인증 요청 -> `307` / `Location: /login?callbackUrl=%2Fadmin`
  - `https://tutum.my/login?callbackUrl=%2Fadmin` + `auth_token=dummy` cookie -> `307` / `Location: /admin`
  - `https://tutum.my/login` + `auth_token=dummy` cookie -> `307` / `Location: /portfolio/asset`
- live frontend bundle 검증:
  - `/app/.next/server/middleware.js`에 `callbackUrl` 우선 redirect 로직 반영 확인
  - 새 frontend pod에서 `node --check /app/.next/server/app/admin/page.js` 통과
- rollout 결과:
  - 새 frontend ReplicaSet 기준 `2/2 Running`
  - Argo CD `tutum-staging` sync revision: `e41520927ae3c93c962eb9d785b3358e0fe4702b`

## 5. 커밋 로그
```bash
e4152092 fix(frontend): preserve admin callback after login
8ebbae74 fix(frontend): replace stale admin ai branch on startup
``` 

## 6. 후속 작업/리스크
- frontend는 현재 compiled bundle을 startup 시 patch하는 방식으로 운영하고 있어, 원본 frontend source가 정리되기 전까지는 patch target 문자열이 바뀌면 같은 유형의 장애가 재발할 수 있다.
- `sharp` 미설치 경고가 frontend 로그에 계속 남아 있다. 현재 `/admin` 장애 원인은 아니지만, image optimization을 실제로 쓰는 화면에서는 별도 정리가 필요하다.
- Admin AI 탭은 live에서 동작하지만, 정식 소스가 repo에 없는 상태라 장기적으로는 frontend source 기준 반영으로 전환하는 것이 맞다.
