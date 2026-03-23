# 개발 로그 작업 요약 (2026-03-12)

## 1. 작업 요약
- 작업 일시: 2026-03-12
- 작업자: 김경윤
- 브랜치: `develop`
- 작업 목적: `https://tutum.my/admin`에서 로그인 페이지로 이동한 뒤 소셜 로그인을 수행해도 다시 `/portfolio/asset`으로 빠지던 문제를 수정하고, OAuth provider별 callback 경로를 보존하도록 auth/frontend 런타임 patch를 정리한다.

## 2. 상세 변경 사항
- frontend startup patch를 통해 `/login?callbackUrl=/admin` 진입 시 callback을 유지하도록 보강했다.
  - login page의 Google/Kakao/Naver 버튼이 `/api/v1/auth/*/login?callbackUrl=/admin` 형식으로 callback 경로를 함께 전달하도록 수정했다.
  - frontend middleware가 로그인 상태의 `/login?callbackUrl=/admin` 요청을 `/admin`으로 되돌리도록 유지했다.
- auth service startup patch를 추가했다.
  - 파일: `k8s-manifests/base/auth/deployment.yaml`
  - auth container 부팅 시 `/app/app/routers/auth.py`를 patch하도록 변경했다.
- auth OAuth 흐름을 다음과 같이 보강했다.
  - provider login endpoint에서 `callbackUrl`을 `oauth_callback_<provider>` cookie로 저장
  - provider callback endpoint에서 저장된 callback path를 읽어서 최종 redirect 경로로 사용
  - callback이 없으면 기존 기본 경로 `/portfolio/asset` 유지
- auth service deployment에 누락되어 있던 Kakao OAuth env를 추가했다.
  - `KAKAO_CLIENT_ID`
  - `KAKAO_CLIENT_SECRET`
  - `KAKAO_REDIRECT_URI`
- GitOps 기준 source-of-truth를 맞추기 위해 `origin/develop`에 push 후 Argo CD refresh 및 staging apply를 수행했다.

## 3. 작업 중 발생 이슈 및 대응
- 이슈: `/admin`에서 로그인 후 email/password 로그인은 `/admin`으로 복귀하지만 소셜 로그인은 `/portfolio/asset`으로 이동
  - 대응: frontend만 수정해서는 해결되지 않았다. auth service가 OAuth 성공 후 항상 `FRONTEND_URL/auth/callback` 또는 기본 경로로만 보내고 있었고 callback path를 저장하지 않았기 때문이다. auth startup patch를 추가해 provider login/callback 양쪽에서 callback cookie를 보존하도록 수정했다.
- 이슈: Kakao 로그인 endpoint가 `500 Internal Server Error`
  - 대응: auth deployment에 Kakao env 자체가 누락되어 있었다. secret에는 값이 있었지만 pod env로 주입되지 않아 항상 500이 나고 있었다. env를 추가한 뒤 `307 Temporary Redirect`로 수렴했다.
- 이슈: local apply 후 patch가 잠깐 반영되었다가 사라짐
  - 대응: Argo CD가 `origin/develop` 기준으로 self-heal 중이라 local apply만으로는 유지되지 않았다. 변경을 먼저 `origin/develop`에 push한 뒤 refresh/apply로 수렴시켰다.

## 4. 결과
- 외부 검증:
  - `https://tutum.my/admin` 비인증 요청 -> `307` / `Location: /login?callbackUrl=%2Fadmin`
  - `https://tutum.my/login?callbackUrl=%2Fadmin` + `auth_token=dummy` cookie -> `307` / `Location: /admin`
  - `https://tutum.my/api/proxy/api/v1/auth/google/login?callbackUrl=%2Fadmin` -> `307` + `Set-Cookie: oauth_callback_google="/admin"`
  - `https://tutum.my/api/proxy/api/v1/auth/kakao/login?callbackUrl=%2Fadmin` -> `307` + `Set-Cookie: oauth_callback_kakao="/admin"`
  - `https://tutum.my/api/proxy/api/v1/auth/naver/login?callbackUrl=%2Fadmin` -> `307` + `Set-Cookie: oauth_callback_naver="/admin"`
- live auth pod 검증:
  - `/app/app/routers/auth.py`에 `_oauth_callback_cookie_key`, `_set_oauth_callback_cookie`, `_get_oauth_callback_cookie`, callback-aware redirect 로직이 실제 반영됨
  - Google/Kakao/Naver 세 provider 모두 `callbackUrl`을 login 단계에서 저장하도록 patch 확인
- GitOps 수렴:
  - Argo CD `tutum-staging` sync revision: `e08e227a8aa2cdc3d0bf598cfaa212063260e5e5`

## 5. 커밋 로그
```bash
c69c8046 fix(auth): preserve oauth callback redirects
e08e227a fix(auth): configure kakao oauth env
```

## 6. 후속 작업/리스크
- 현재 수정은 `/admin`에서 소셜 로그인한 사용자를 다시 `/admin`으로 복귀시키는 문제를 해결한 것이다.
- 다만 auth service는 여전히 social login 시 `_oauth_find_or_create()`로 사용자를 자동 생성한다. 즉, "사전에 RDS에 존재하는 계정만 admin 접근 허용" 정책까지는 아직 구현되지 않았다.
- 그 정책이 필요하면 `/admin` callback 경로일 때는 신규 사용자 auto-create를 차단하고 `/login?callbackUrl=/admin&error=admin_access_denied`로 돌려보내는 별도 정책 변경이 추가로 필요하다.
