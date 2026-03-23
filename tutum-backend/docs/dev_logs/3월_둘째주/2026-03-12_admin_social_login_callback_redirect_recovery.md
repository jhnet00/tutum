# 개발 로그 작업 요약 (2026-03-12)

## 1. 작업 요약
- 작업 일시: 2026-03-12
- 작업자: 김경윤
- 브랜치: `develop`
- 작업 목적: `https://tutum.my/admin` 진입 후 소셜 로그인 시 `/portfolio/asset`로 잘못 떨어지던 흐름을 복구해, admin 경로에서 시작한 인증은 최종적으로 `/admin`으로 돌아오도록 수정한다.

## 2. 상세 변경 사항
- frontend middleware startup patch를 보강했다.
  - `k8s-manifests/base/frontend/deployment.yaml`
  - 비인증 사용자가 `/admin`에 접근하면 `/login?callbackUrl=%2Fadmin`으로 보낼 뿐 아니라 `login_callback=/admin` 쿠키를 함께 저장하도록 유지했다.
  - 로그인 완료 후 `/portfolio/asset`로 먼저 도착하더라도 `auth_token + login_callback=/admin` 조합이면 즉시 `/admin`으로 다시 redirect하고 `login_callback` 쿠키를 삭제하도록 middleware를 추가했다.
- auth startup patch를 단계적으로 보강했다.
  - `k8s-manifests/base/auth/deployment.yaml`
  - OAuth callback path를 query/state/referer/cookie에서 복구하는 helper를 추가했다.
  - `%2Fadmin`처럼 URL-encoded callback cookie를 decode할 수 있도록 `_sanitize_callback_path()` 로직을 보강했다.
  - 다만 auth 컨테이너 내 원본 `auth.py` 구조가 patch 과정에서 다시 query/referer-only 라인을 생성해 cookie fallback이 일관되게 적용되지 않는 문제가 있어, 최종 사용자 경로는 frontend middleware에서 보정하는 방식으로 안정화했다.
- live 검증을 위해 staging `frontend`/`auth` rollout을 반복 적용했다.
  - Argo CD sync 후 `kubectl apply -k k8s-manifests/overlays/staging`
  - `kubectl rollout restart deploy/frontend -n tutum-app`
  - `kubectl rollout restart deploy/auth -n tutum-app`

## 3. 작업 중 발생 이슈 및 대응
- 이슈: provider(Google/Kakao/Naver) redirect URI 설정 누락처럼 보였으나, 실제 원인은 provider 설정이 아니라 앱 내부 callback 의도 보존 실패였다.
- 대응: 외부 응답 헤더와 auth 시작 URL을 직접 확인해 `redirect_uri=https://tutum.my/api/v1/auth/{provider}/callback`은 정상임을 확인하고, app 내부 쿠키/redirect 흐름만 수정했다.
- 이슈: 구버전 login bundle이 `callbackUrl` 없이 `/api/v1/auth/{provider}/login`을 호출하면 auth가 `/admin` 의도를 잃었다.
- 대응: `/admin` 접근 시 생성한 `login_callback` 쿠키를 기준으로, 로그인 후 `/portfolio/asset`에 도달하더라도 frontend middleware가 `/admin`으로 재이동하도록 우회 경로를 추가했다.
- 이슈: auth startup patch는 문자열 치환 순서 때문에 runtime `auth.py`에 cookie fallback이 일부 반영되지 않는 경우가 있었다.
- 대응: 해당 문제는 provider console 수정 대상이 아니라 runtime patch 구조 문제로 분리했고, 사용자 체감 경로는 frontend middleware 보정으로 우선 안정화했다.

## 4. 결과
- 외부 검증:
  - `GET https://tutum.my/admin` -> `307 /login?callbackUrl=%2Fadmin`
  - 위 응답에 `Set-Cookie: login_callback=%2Fadmin` 포함 확인
  - `GET https://tutum.my/portfolio/asset` with `Cookie: auth_token=dummy; login_callback=%2Fadmin` -> `307 /admin`
  - 위 응답에 `Set-Cookie: login_callback=; Max-Age=0` 포함 확인
- 운영 상태:
  - `frontend` rollout 성공
  - `auth` rollout 성공
  - 일반 `tutum.my` 로그인 경로는 기존대로 `/portfolio/asset`을 유지한다.
  - `/admin`에서 시작한 로그인 경로는 최종적으로 `/admin`으로 복귀하는 흐름으로 보정됐다.

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-12" --until="2026-03-12 23:59:59"
```

- 이번 작업과 직접 관련된 커밋:
  - `967c8993` `fix(auth): persist admin callback across social login`
  - `7a9ed7e8` `fix(auth): decode admin callback cookie`
  - `5aff3ed3` `fix(auth): apply callback decode to patched auth runtime`
  - `f73ad3ca` `fix(auth): use login callback cookie in oauth start`
  - `40f47052` `fix(auth): robustly patch oauth login callback fallback`
  - `0d5b817f` `fix(auth): apply cookie callback override after oauth patch`
  - `07183d11` `fix(frontend): bounce admin login callback from asset page`

## 6. 후속 작업/리스크
- auth startup patch는 runtime 원본 함수 구조에 의존하는 문자열 치환 방식이라 장기적으로 취약하다. auth 서비스 원본 소스가 repository에 정리되면 startup patch 대신 정식 코드 수정으로 전환하는 것이 맞다.
- 현재 수정은 `/admin`에서 시작한 로그인 흐름을 `/admin`으로 복귀시키는 문제를 해결한 것이다. `RDS에 이미 존재하는 계정만 admin 접근 허용` 정책은 별도 구현이 필요하다.
- 이번 작업은 UI 레이아웃 변경이 아니라 인증 redirect 흐름 수정이므로 별도 스크린샷은 첨부하지 않았다.
