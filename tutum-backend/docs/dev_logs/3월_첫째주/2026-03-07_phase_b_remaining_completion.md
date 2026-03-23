# 2026-03-07 Phase B 나머지 항목 완료

## 작업자
박성준

## 작업 배경
AWS Migration Plan Phase B 미완료 항목 순차 처리
기준: `docs/plans/infra/AWS_MIGRATION_PLAN_2026-03-03.md`

---

## 완료 항목

### 1. KEDA Kafka ScaledObject 수정 (Istio mTLS PERMISSIVE)

- **원인**: KEDA operator (`keda` ns)가 Istio sidecar 없음 → tutum-data Kafka 9092 포트 STRICT mTLS 차단
  - 에러: `error creating kafka client: kafka: client has run out of available brokers to talk to: read tcp ... connection reset by peer`
- **해결**: Kafka pod의 9092 포트만 `PERMISSIVE` PeerAuthentication 추가
  ```yaml
  apiVersion: security.istio.io/v1beta1
  kind: PeerAuthentication
  metadata:
    name: kafka-permissive
    namespace: tutum-data
  spec:
    selector:
      matchLabels:
        app: kafka
    portLevelMtls:
      "9092":
        mode: PERMISSIVE
  ```
- **파일**: `k8s-manifests/base/ingress/peer-authentication.yaml` (추가)
- **결과**: KEDA ScaledObject 5개 전부 READY: True, HPA 5개 생성
  ```
  backend-scaledobject:         CPU 기반, READY: True, ACTIVE: True
  frontend-scaledobject:        CPU 기반, READY: True, ACTIVE: True
  price-consumer-scaledobject:  Kafka lag 기반, READY: True
  news-consumer-scaledobject:   Kafka lag 기반, READY: True
  elastic-consumer-scaledobject: Kafka lag 기반, READY: True
  ```

### 2. Kyverno 설치 + Cosign 정책 적용

- Helm 설치: `kyverno/kyverno`, kyverno 네임스페이스
- 4개 컴포넌트 1/1 Running (admission/background/cleanup/reports controller)
- Cosign 정책 적용 (`Audit` 모드 — 파이프라인 완성 후 `Enforce`로 전환 예정):
  ```yaml
  ClusterPolicy: verify-image-signature
  imageReferences: 903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/tutum/*
  validationFailureAction: Audit  # Enforce로 전환 필요
  ```

### 3. NACL 생성 (public subnet 80/443 inbound 제한)

- NACL ID: `acl-00118c05434717dbf` (이름: tutum-stg-public-nacl)
- 적용 subnet: `subnet-0937edf9855525b1b` (10.60.1.0/24), `subnet-0495c1c0ae546f02c` (10.60.2.0/24)
- Inbound 규칙:
  - Rule 100: TCP 80 허용
  - Rule 110: TCP 443 허용
  - Rule 120: TCP 1024-65535 허용 (ephemeral, 응답 트래픽)
  - Rule 32767: ALL Deny (기본값)
- Outbound: Rule 100 ALL 허용

### 4. VPC Endpoints 생성

| Endpoint | 타입 | ID | 상태 |
|----------|------|-----|------|
| ECR DKR (`ecr.dkr`) | Interface | vpce-0972fed29a2e31ac5 | pending→available |
| ECR API (`ecr.api`) | Interface | vpce-06638d8d5ac9bbbd0 | pending→available |
| S3 | Gateway | vpce-00990c1243c6723ba | available (기존) |

- ECR Endpoints: private subnet 2개 + EKS cluster SG (`sg-0a819286b08c1162e`) + private DNS 활성화
- S3 Gateway: 기존 Gateway Endpoint 이미 존재 확인

### 5. AWS WAF WebACL 생성

- ARN: `arn:aws:wafv2:ap-northeast-2:903913341620:regional/webacl/tutum-stg-waf/14db8c23-c2dc-4d17-9f85-4b509bf4c261`
- 규칙:
  1. `AWSManagedRulesCommonRuleSet` (Priority 1) — OWASP Top 10 차단
  2. `AWSManagedRulesKnownBadInputsRuleSet` (Priority 2) — 악성 입력 차단
  3. `RateLimit2000per5min` (Priority 3) — IP당 5분간 2000req 초과 시 Block
- ALB 연결: ALB가 아직 없음 → Phase E에서 ALB Ingress 생성 후 연결 예정

### 6. GuardDuty 활성화

- Detector ID: `d2ce621d2402eea5e645d450c11381aa`
- 활성화된 기능:
  - CLOUD_TRAIL: ENABLED
  - DNS_LOGS: ENABLED
  - FLOW_LOGS: ENABLED
  - S3_DATA_EVENTS: ENABLED
  - EKS_AUDIT_LOGS: ENABLED
  - EBS_MALWARE_PROTECTION: ENABLED
  - RDS_LOGIN_EVENTS: ENABLED
  - EKS_RUNTIME_MONITORING: ENABLED ← EKS Protection
  - LAMBDA_NETWORK_LOGS: ENABLED

### 7. gitlab-registry-secret placeholder 생성

- 이유: base 매니페스트에서 `imagePullSecrets: gitlab-registry-secret` 참조 → warning 발생
- 실제로는 EKS 노드 IAM role로 ECR 인증 (secret 불필요)
- 3개 namespace에 placeholder docker-registry secret 생성:
  ```bash
  kubectl create secret docker-registry gitlab-registry-secret \
    --docker-server=registry.gitlab.com --docker-username=placeholder \
    --docker-password=placeholder -n tutum-app/tutum-data/tutum-storage
  ```

---

## 남은 작업 (Phase C, E)

### Phase C
- **GitLab CI `COSIGN_PRIVATE_KEY`/`COSIGN_PUBLIC_KEY` 수동 업데이트** (cp-2 `/tmp/cosign.key`, `/tmp/cosign.pub`)
- `develop` 브랜치 push → 파이프라인 전체 실행 (build→scan→sign→deploy)
- Kyverno 정책 `Audit` → `Enforce` 전환 (서명 확인 후)
- E2E 검증 (MariaDB, OAuth, 시세, 뉴스, OCR)

### Phase E
- **ACM `*.tutum.my` ISSUED 확인** (DNS validation 전파 대기)
- ALB Ingress 생성 (ACM ARN annotation 추가)
- WAF WebACL → ALB 연결
- Route53 A 레코드 → ALB DNS 연결
- OAuth 콜백 URL 업데이트 (Google, Naver → ALB DNS 또는 tutum.my)
