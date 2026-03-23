# 2026-03-10 마이그레이션 Phase 감사 및 보안 강화

- 작업자: 박성준
- 작업 시간: 2026-03-10

## 1. 작업 배경

AWS_MIGRATION_DETAIL_GUIDE.md 기준 Phase A~E 전체 감사 (audit) 및 미완료 항목 순차 완료.

## 2. 완료한 작업 목록

### admin 대시보드 확인 및 수정

- `tutum.my/admin` 접근 테스트 → `/login?callbackUrl=/admin` 리다이렉트 확인 (정상)
- **문제 발견**: `backend/app/routers/admin.py` 내 `_grafana_url()` 함수에 `192.168.0.230:3000` 하드코딩
- **수정**: `GRAFANA_URL = os.getenv("GRAFANA_URL", "http://192.168.0.230:3000")` 환경변수로 교체
- **수정**: `frontend/app/admin/page.tsx` `GRAFANA` 상수 → `NEXT_PUBLIC_GRAFANA_URL` env var 참조로 교체
- Phase D-5 (모니터링 EC2) 완료 후 backend-secret에 `GRAFANA_URL`, `MIMIR_URL`, `LOKI_URL`, `TEMPO_URL` 추가 필요

### EKS 접근권한 (Access Entry) 추가

- 기존: tutum-sj1202pak, tutum-ruby, tutum-gitlab-ci 3명만 등록
- 추가: `tutum-jhnet00`, `tutum-kyk02405` → AmazonEKSClusterAdminPolicy
- kubectl 설정 방법: `aws eks update-kubeconfig --name tutum-stg-eks --region ap-northeast-2`

### Phase B: ECR 토큰 갱신 CronJob

- `k8s-manifests/base/security/ecr-token-cronjob.yaml` 신규 생성
- 6시간마다 ECR 토큰 갱신 → tutum-app/data/storage/kyverno 네임스페이스에 `ecr-pull-secret` 갱신
- `sidecar.istio.io/inject: "false"` 적용 (Job 완료 보장)
- base/kustomization.yaml에 추가

### Phase B: NACL 확인

- 공용 서브넷(10.60.1.x, 10.60.2.x) NACL 이미 완료 상태 확인
  - Inbound: 80/443/ephemeral(1024-65535) ALLOW + default DENY
  - Outbound: ALL ALLOW (ALB 응답 트래픽 허용)

### Phase B: VPC Endpoint 현황 확인

- 기존 완료: S3 Gateway, ECR DKR, ECR API, GuardDuty (vpce)
- **신규 생성**: Secrets Manager Interface Endpoint (`vpce-0a4b335d1f3e0bcc8`)
  - private subnet 2개(10.60.11.x, 10.60.12.x), cluster SG 연결

### Phase B: GuardDuty → SNS → Lambda → Slack 연동

- SNS 토픽 생성: `arn:aws:sns:ap-northeast-2:903913341620:tutum-guardduty-alerts`
- Lambda 생성: `tutum-guardduty-to-slack` (Python 3.12)
  - `SLACK_WEBHOOK_URL` env var: `#tutum-alerts` 채널
  - 심각도별 이모지 표시 (CRITICAL/HIGH/MEDIUM/LOW)
- EventBridge 규칙: `tutum-guardduty-findings` → GuardDuty Finding → SNS
- SNS → Lambda 구독 완료
- Lambda 테스트 실행 → 200 OK 확인 (`#tutum-alerts` 채널 메시지 도착 확인 필요)

### Phase A: COSIGN 키 확인

- `verify-image-signature` Kyverno 정책의 publicKey가 `/tmp/cosign.pub`와 동일 확인
- GitLab CI COSIGN_PRIVATE_KEY/PUBLIC_KEY 이미 등록 완료 상태로 판단

### Karpenter 확인

- EKS Auto Mode에 Karpenter 내장
- NodePool (general-purpose, system), NodeClass (default, private-only) 정상 동작
- KEDA (파드 스케일링) + Karpenter (노드 스케일링) 함께 작동 중

## 3. 현재 마이그레이션 현황

| Phase | 항목 | 상태 |
|-------|------|------|
| A | ECR repos, GitLab CI vars, VPC, ACM | ✅ |
| A | COSIGN 키 GitLab CI 등록 | ✅ |
| B (기본) | EKS, Istio, ALB, ArgoCD, KEDA, Kyverno, Secrets | ✅ |
| B (기본) | ECR 토큰 CronJob | ✅ (이번 작업) |
| B (보안) | NACL, VPC Endpoints (S3/ECR/GuardDuty/SecretsManager) | ✅ |
| B (보안) | WAF, GuardDuty, GuardDuty→Slack | ✅ (이번 작업) |
| B (보안) | KMS CMK + Secrets Manager + ESO | ❌ 미완료 |
| C | .gitlab-ci.yml ECR 전환, Cosign | ✅ |
| C | 파이프라인 실제 실행 검증 | ⬜ |
| D | MinIO→S3, ES 이전, 모니터링 EC2 | ❌ 미시작 |
| E | DNS 컷오버 (tutum.my → Route53) | ✅ 이미 완료 |
| E | OAuth 콜백 URL 등록 | ⬜ (브라우저 수동 작업) |

## 4. 다음 작업

1. `#tutum-alerts` GuardDuty Slack 메시지 수신 확인
2. Phase D: 모니터링 EC2 생성 (EKS VPC private subnet, t3.medium)
3. Phase D: MinIO → S3 이전 + Backend S3 IRSA 적용
4. Phase D 완료 후: backend-secret에 `MIMIR_URL`, `LOKI_URL`, `TEMPO_URL`, `GRAFANA_URL` 추가
5. Phase C: CI 파이프라인 실제 실행 (빌드/서명/배포 전 구간)
