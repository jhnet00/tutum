# 2026-03-08 AWS Prod Migration Ruby 작업 로그

## 작업일
- 날짜: 2026-03-08
- 브랜치: `develop`
- 작성자: Ruby
- 영역: AWS 프로덕션 마이그레이션 (Phase E 마무리 / Phase D 준비)

## 1. 오늘 완료/기록한 작업

### 1-1. 문서 정리
- `docs/dev_logs/3월_첫째주/2026-03-07_phase_e_remaining_tasks.md` 생성
  - Phase E 잔여 항목(블로커 포함), Cloudflare DNS 연동 필요사항 정리
- `docs/ruby/2026-03-06_prod_migration_phase_D_and_karpenter_runbook.md` 생성
  - Phase C 장애 점검 루틴 + Phase D 실행 가이드 + Karpenter 설치 초안 작성

### 1-2. 502 장애 분석 준비 데이터 수집
- `tutum-app` Namespace 핵심 워크로드 상태 점검
  - backend/email-worker/frontend/price/consumer/prod 상태 조회
- Kafka/Redis 상태 점검
  - `kubectl`로 `kafka`, `redis`, `mongodb`, `frontend-svc`, `backend-svc` 엔드포인트/서비스 확인
- ingress/ALB 상태 점검
  - `tutum-stg-ingress` 규칙 및 annotation 확인
  - ALB 대상은 `/api`, `/ws` -> backend-svc:8000, `/` -> frontend-svc:80
- 프론트 컨테이너 내부 직접 호출 점검
  - `kubectl exec`으로 `http://127.0.0.1:3000/` 호출: `200 OK`
  - `/health` 호출은 프론트에서 404 (컨테이너 내부 API/health 경로 부재)

### 1-3. kubeconfig / 인증 이슈 정리
- cp-3 환경에서 `exec plugin ... v1alpha1` 오류 반복 발생
- awscli v1 → v2로 전환(설치)하여 kubeconfig 재생성 흐름 적용
- 클러스터 연결 자체는 가능해졌고, 이후 kubectl 리소스 조회가 가능한 상태 유지

## 2. 확인된 현재 상태(요약)

- `kubectl`로 Pod/서비스/엔드포인트는 조회 가능
  - frontend pod는 1개 running + 1개 completed
  - `frontend` 및 `backend` endpoint는 각각 정상 IP를 가짐
- `curl -I https://tutum.my`는 여전히 `HTTP/2 502` 유지
- Cloudflare 네임서버 사용 이슈로 Route53만으로는 트래픽이 반영되지 않는 포인트 확인
- Cloudflare tunnel/legacy DNS 항목 정리 중이며, ALB 직접 라우팅 전환/검증이 필요

## 3. 남은 작업(다음 시작 포인트)

- [ ] Cloudflare DNS 재정비(Cloudflare 쪽 A/CNAME 정합성, `Proxy` 상태, ACM validation record 점검)
- [ ] `tutum.my` 502의 실제 원인 분리
  - ALB TargetGroup 상태(healthy/unhealthy)
  - healthcheck 경로/코드 적합성(frontend는 `/` 우선) 재점검
- [ ] frontend `/health` 의존 제거(라우팅/annotation 정합성) 여부 최종 결정
- [ ] OAuth Callback/웹 로그인/크롤러/OCR 등 E2E 기능 재검증
- [ ] Phase D(데이터 보존/모니터링/CloudTrail) 실행 항목은 다음 세션에서 이어서 진행

## 4. 참고 메모

- 502이 계속 나는 상태인데, Pod 자체 응답(`GET /`)은 정상인 시나리오라면
  **문제는 클러스터 내부 앱 장애보다는 ALB/Cloudflare/라우팅 계층**에서 발생할 가능성이 큼.
- 다음 세션은 `aws elbv2 describe-target-health` + Cloudflare DNS 캐시/프로xy 상태를 우선 확인하고, 프론트/백엔드 헬스 체크 정책을 정합성 있게 정리해서 처리.
