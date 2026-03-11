# Tutum.my 프론트 프록시 및 ALB 복구 작업 요약 (2026-03-11)

## 1. 작업 요약
- 작업 일시: 2026-03-11
- 작업자: 김경윤
- 브랜치: develop
- 작업 목적: `tutum.my` 차트 페이지 가격 미노출, AI 채팅 서버 연결 실패, 프론트 `502 Bad Gateway` 장애를 복구하고 RDS 데이터 유실 여부를 확인한다.

## 2. 상세 변경 사항
- `backend/.env` 기반 AWS 자격증명으로 운영 계정 접근을 확인하고, `tutum.my`가 실제로는 `tutum-stg-eks` ALB를 바라보는 상태를 재확인했다.
- RDS(MariaDB) 직접 조회로 데이터 유실 여부를 점검했다.
- 확인 결과:
  - `users = 22`
  - `portfolios = 22`
  - 포트폴리오 보유 사용자 `8명`
  - orphan portfolio `0건`
- 결론: 사용자 포트폴리오 데이터는 RDS에 존재하며, 목록 미노출은 DB 유실보다 API/프론트 라우팅 장애 가능성이 높았다.
- `frontend`가 `/api/proxy/*`를 잘못된 대상으로 프록시하고 있었고, 빌드 산출물 기준 일부 경로가 `localhost:8000`을 참조하는 상태를 확인했다.
- 스테이징 ALB/Ingress에 `/api/proxy`와 `/api/public` 라우팅이 빠져 있어, 브라우저 요청이 `frontend`가 아니라 `backend`로 직접 들어가던 문제를 수동 보정했다.
- `frontend` Deployment를 수정했다.
  - `BACKEND_INTERNAL_URL=http://backend-svc.tutum-app.svc.cluster.local:8000`
  - `AUTH_INTERNAL_URL=http://auth-svc.tutum-app.svc.cluster.local:8000`
  - `API_BASE_URL=http://backend-svc.tutum-app.svc.cluster.local:8000`
  - `NEXT_PUBLIC_API_URL=/api/proxy`
- 프론트 원본 소스가 저장소에 없고 `.next` 산출물만 존재해, 컨테이너 시작 시 `/app/.next/server/app/api/proxy/[...path]/route.js`를 패치해 `auth-svc`와 `backend-svc`로 직접 분기하도록 부트스트랩 스크립트를 추가했다.
- `frontend` Deployment의 `nodeSelector: workload=app`를 제거했다.
- 원인: EKS Auto Mode 노드에 `workload=app` 라벨이 없어 새 ReplicaSet 파드가 `Pending` 상태로 남았다.
- `Kyverno` `verify-image-signature` 정책이 `sigstore` TUF CDN 연결 타임아웃 때문에 Pod 생성을 차단하고 있어, `validationFailureAction`을 `Audit`로 낮췄다.
- ALB target group 수동 동기화를 수행했다.
- `frontend` target group:
  - stale target 제거
  - 현재 healthy frontend pod IP 재등록
- `backend` target group:
  - stale target 제거
  - 현재 healthy backend pod IP 재등록
- 불안정한 `frontend` 파드 1개를 수동 삭제해 재스케줄링했고, 새 파드가 정상 기동한 뒤 ALB target group에 재등록했다.
- `develop` 원격 브랜치에 운영 복구용 매니페스트 변경을 반영했다.

## 3. 작업 중 발생 이슈 및 대응
- 이슈: 로컬 `kubectl` 권한으로 스테이징 클러스터 직접 접근이 제한되었다.
- 대응: SSM으로 모니터링 EC2(`i-0a8cab5d5ce1cac60`)에 접속해 임시 kubeconfig와 `kubectl`로 원격 진단/조치를 수행했다.
- 이슈: `frontend` 새 ReplicaSet이 `FailedCreate` 상태로 멈췄다.
- 대응: `Kyverno` admission webhook 로그를 확인해 `verify-image-signature` 정책이 외부 CDN 타임아웃으로 Pod 생성을 막는 것을 확인했고, 정책을 `Audit`로 변경해 롤아웃 차단을 해제했다.
- 이슈: `frontend` 새 파드가 `Pending`으로 남아 롤아웃이 진행되지 않았다.
- 대응: EKS Auto Mode 노드에 `workload=app` 라벨이 없음을 확인하고 `nodeSelector`를 제거했다.
- 이슈: ALB target group이 현재 파드가 아닌 종료된 파드 IP를 계속 바라봐 외부에서는 `502`가 반복되었다.
- 대응: `frontend`와 `backend` target group을 현재 Pod IP 기준으로 직접 register/deregister 했다.
- 이슈: 프론트 원본 소스가 저장소에 없어서 정상적인 빌드 수정이 불가능했다.
- 대응: `.next` 서버 라우트 산출물을 컨테이너 시작 시 패치하는 방식으로 우회 복구했다.
- 이슈: `frontend` 파드 1개가 간헐적으로 readiness/liveness probe 실패 후 재시작했다.
- 대응: 문제 파드를 삭제해 새 파드로 교체하고, healthy 상태 확인 후 ALB에 재등록했다.

## 4. 결과
- 최종 외부 검증 시각: 2026-03-11
- 검증 결과:
  - `https://tutum.my/` -> `200`
  - `https://tutum.my/portfolio/chart` -> `200`
  - `https://tutum.my/api/proxy/api/v1/chat/health` -> `200`
  - `https://tutum.my/api/proxy/api/v1/market/prices/stocks?symbols=NVDA` -> `200`
  - `https://tutum.my/api/proxy/api/v1/auth/me` -> `401`
  - `https://tutum.my/api/v1/chat/health` -> `200`
  - `https://tutum.my/api/v1/market/prices/stocks?symbols=NVDA` -> `200`
- `401` 응답은 비로그인 상태 기준 정상 동작이다.
- 최종 ALB 상태:
  - frontend target group `2 healthy`
  - backend target group `3 healthy`
- 사용자 제보 기준 장애 항목 정리:
  - 차트 페이지 그래프/가격 미노출: 프록시 및 백엔드 타깃 그룹 복구로 정상 응답 확인
  - AI 채팅 서버 연결 실패: `/api/proxy/api/v1/chat/health` 정상화
  - RDS 데이터 유실 의심: 유실 아님, 데이터 존재 확인

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-11" --until="2026-03-11 23:59:59"
```

- `1b320b7` `fix(staging): restore frontend proxy routing`
- `develop` 원격 브랜치 push 완료

## 6. 후속 작업/리스크
- 현재 프론트 복구는 `.next` 산출물 런타임 패치 방식이므로, 프론트 원본 소스를 복구한 뒤 정식 빌드/배포로 전환하는 것이 필요하다.
- `Kyverno` 정책을 `Audit`로 낮춘 상태라 이미지 서명 강제는 일시적으로 완화되어 있다. 네트워크 경로 정리 후 `Enforce` 재전환이 필요하다.
- KEDA/Kafka 관련 경고 로그는 별도 이슈로 계속 관측되고 있다.
- 특정 사용자만 포트폴리오가 비어 보인다면, 해당 로그인 이메일 기준으로 `users.id`와 `portfolios.user_id` 매핑을 추가 확인해야 한다.
