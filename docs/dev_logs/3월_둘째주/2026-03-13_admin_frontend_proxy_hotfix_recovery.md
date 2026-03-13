# 개발 로그 작업 요약 (2026-03-13)

## 1. 작업 요약
- 작업 일시: 2026-03-13
- 작업자: 김경윤
- 브랜치: develop
- 작업 목적: `https://tutum.my/admin`에서 데이터가 로딩되지 않던 문제를 복구하고, frontend `/api/proxy` 경로가 새 롤아웃 이후에도 안정적으로 유지되도록 source-of-truth를 보정한다.

## 2. 상세 변경 사항
- `k8s-manifests/base/frontend/deployment.yaml`
  - frontend startup patch가 Next standalone 번들 내 `/app/.next/server/app/api/proxy/[...path]/route.js`를 수정할 때, `AUTH_INTERNAL_URL` 변수와 `Headers` 변수가 같은 식별자를 재사용해 syntax error를 만들던 문제를 수정했다.
  - proxy patch를 `backendBase/authBase/proxyHeaders` 식별자로 치환하도록 변경했다.
  - 이전 시도에서 startup script 자체를 깨뜨리던 정규식 기반 치환을 제거하고, live 번들에서 실제로 확인한 exact-string 치환만 남겼다.
- live frontend serving pod 핫패치
  - Argo CD 반영 전 사용자 영향도를 줄이기 위해 running 중이던 frontend pod 2개에 직접 `route.js` 핫패치를 적용해 `/api/proxy` 경로를 즉시 복구했다.
- GitOps source-of-truth 반영
  - 동일 수정 내용을 `origin/develop`에 반영해, 이후 Argo CD self-heal/rollout에도 같은 오류가 재발하지 않도록 맞췄다.

## 3. 작업 중 발생 이슈 및 대응
- 이슈: admin 화면 자체는 로그인 리다이렉트가 정상인데, 실제 데이터 API인 `/api/proxy/api/v1/admin/*`와 `/api/proxy/api/v1/chat/health`가 전부 `500`을 반환했다.
- 대응: frontend pod 내부에서 `node`로 직접 호출해 `/api/proxy`가 frontend 내부에서 이미 실패함을 확인했고, backend 데이터 문제가 아니라 frontend proxy bundle 문제로 범위를 축소했다.

- 이슈: live frontend 로그에 `SyntaxError: Identifier 'o' has already been declared`가 반복 출력됐다.
- 대응: `/app/.next/server/app/api/proxy/[...path]/route.js`를 직접 열어 `AUTH_INTERNAL_URL` 변수 `o`와 `let o=new Headers` 충돌을 확인했고, 우선 live pod 파일을 즉시 수정해 트래픽 경로를 복구했다.

- 이슈: 첫 번째 source-of-truth 수정에서는 startup script에 추가한 정규식 치환이 잘못되어 새 ReplicaSet이 `CrashLoopBackOff`가 발생했다.
- 대응: 실패 원인을 pod `previous` 로그에서 `Invalid regular expression`으로 확인한 뒤, 정규식 블록을 제거하고 exact-string 치환만 사용하는 두 번째 수정으로 교체했다.

- 이슈: `kubectl apply -k`로 직접 반영한 변경이 Argo CD self-heal로 다시 덮였다.
- 대응: 임시 복구는 live pod 핫패치로 처리하고, 최종 상태는 `origin/develop` push 후 Argo CD가 새 revision으로 `Synced / Healthy`가 되도록 수렴시켰다.

## 4. 결과
- 검증 항목: live frontend 내부 proxy health
- 검증 결과: frontend pod 내부 `http://127.0.0.1:3000/api/proxy/api/v1/chat/health` 호출이 `200`으로 복구됨

- 검증 항목: admin 비인증 API 경로
- 검증 결과: `https://tutum.my/api/proxy/api/v1/admin/nodes` -> `401`, 비로그인 기준 정상 응답

- 검증 항목: 시세 API 경로
- 검증 결과: `https://tutum.my/api/proxy/api/v1/market/prices/stocks?symbols=NVDA` -> `200`

- 검증 항목: chat health API 경로
- 검증 결과: `https://tutum.my/api/proxy/api/v1/chat/health` -> `200`

- 검증 항목: frontend rollout/Argo 상태
- 검증 결과: 최신 frontend RS `frontend-78b6f6c497` pod 2개 `2/2 Running`, Argo CD `tutum-staging` -> `Synced / Healthy`, revision `1c4c74fce1cd424bc7b0f5110906c4a23410b487`

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-13" --until="2026-03-13 23:59:59"
```

## 6. 후속 작업/리스크
- 이번 복구는 compiled frontend 산출물에 startup patch를 적용하는 방식이라, 프론트 원본 소스 기준 정식 수정이 아니면 번들 구조 변경 시 다시 취약해질 수 있다.
- 현재 admin 데이터 경로는 복구됐지만, 향후 frontend 이미지가 크게 바뀌면 startup patch target 유효성을 다시 확인해야 한다.
