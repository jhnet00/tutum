# 2026-03-10 Phase B 잔여 작업 완료

- 작업자: 박성준
- 작업 시간: 2026-03-10 (오후)

## 작업 배경

경윤님이 Phase D 작업(MinIO→S3, Kiali, SonarQube, Terraform 등)을 담당하기로 하여,
본 작업자는 Phase B 잔여 항목 2가지를 처리함.

## 1. alloy.monitoring:4317 Service 없음 버그 수정

### 문제
- alloy DaemonSet이 `grafana/alloy:latest` (Docker Hub) 이미지 사용 중
- EKS private/public subnet 노드에서 `imagePullPolicy: Always` + Docker Hub 타임아웃으로 5개 파드 ImagePullBackOff
- alloy Service가 없어 백엔드 파드가 trace를 `alloy.monitoring:4317`로 전송 불가

### 원인 분석
- public subnet 노드(`10.60.1.x`, `10.60.2.x`)에 public IP 없음
- public subnet route table `rtb-067b7ce595275a957`에 S3 VPC Gateway Endpoint 미등록
  → ECR 이미지 layer 다운로드(S3 경유) 불가

### 해결
1. ECR 레포 생성: `grafana/alloy`
2. `crane`으로 Docker Hub → ECR 이미지 복사 (v1.14.0)
   ```
   903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/grafana/alloy:v1.14.0
   ```
3. S3 VPC Gateway Endpoint(`vpce-00990c1243c6723ba`)에 public route table 추가
4. alloy DaemonSet 이미지 ECR로 변경 + `imagePullPolicy: IfNotPresent`
5. alloy Service 생성 (ClusterIP 172.20.81.17, ports: 4317/4318/12345)
6. 매니페스트 신규 생성:
   - `k8s-manifests/base/monitoring/alloy.yaml` (DaemonSet + Service + RBAC)
   - `k8s-manifests/base/monitoring/alloy-config.yaml` (ConfigMap)

### 결과
- alloy DaemonSet 12/12 Running
- `alloy.monitoring.svc.cluster.local:4317` trace 수신 가능

## 2. KMS CMK + Secrets Manager + ESO 구축

### 구현 순서

#### 2-1. KMS CMK 생성
```
ARN: arn:aws:kms:ap-northeast-2:903913341620:key/4994cb9a-8eef-45eb-a84b-1a248c64af24
Alias: alias/tutum-secrets-key
```

#### 2-2. AWS Secrets Manager 등록
```
ARN: arn:aws:secretsmanager:ap-northeast-2:903913341620:secret:tutum/backend-secret-GTcC2A
KMS CMK: alias/tutum-secrets-key
내용: 현재 backend-secret 전체 (RDS, OAuth, KIS, Upbit, Bedrock 등)
```

#### 2-3. External Secrets Operator 설치
- Helm chart: external-secrets/external-secrets v2.1.0
- ECR 이미지 미러 (ghcr.io → ECR):
  - `external-secrets/external-secrets:v2.1.0`
  - `external-secrets/external-secrets-webhook:v2.1.0`
  - `external-secrets/external-secrets-cert-controller:v2.1.0`
- 설치 네임스페이스: `external-secrets`

#### 2-4. IRSA 구성
- **tutum-eso-role**: `external-secrets` SA (OIDC trust)
  - Policy: TutumESOPolicy (secretsmanager:GetSecretValue, kms:Decrypt)
- **tutum-backend-secrets-role**: `backend-sa` SA in tutum-app (OIDC trust)
  - 같은 Policy 연결

#### 2-5. STS VPC Interface Endpoint 생성
- 문제: ESO가 IRSA(AssumeRoleWithWebIdentity)를 위해 STS 호출 → timeout
- 해결: STS Interface Endpoint 생성
  - ID: `vpce-0d73b7f2b20079d68`
  - 서브넷: 10.60.11.0/24, 10.60.12.0/24 (private)
  - Private DNS 활성화

#### 2-6. SecretStore + ExternalSecret 적용
```yaml
# SecretStore: aws-secrets-store (tutum-app)
# ExternalSecret: backend-secret (1h 갱신)
# 결과: SecretStore=Valid, ExternalSecret=SecretSynced ✅
```

## 3. 기타 업데이트

### k8s-manifests/base/backend/secret.yaml
- MariaDB: 온프레미스 → RDS 주소 반영
- 모니터링 URL 추가 (GRAFANA_URL, MIMIR_URL, LOKI_URL, TEMPO_URL → 10.60.11.95)
- ESO 관리 전환 안내 주석 추가

## 4. 현재 Phase B 전체 상태

| 항목 | 상태 |
|------|------|
| EKS, Istio, ALB, ArgoCD, KEDA, Kyverno, Secrets | ✅ |
| ECR 토큰 CronJob | ✅ |
| NACL, VPC Endpoints (S3/ECR/GuardDuty/SecretsManager/STS) | ✅ |
| WAF, GuardDuty, GuardDuty→Slack | ✅ |
| KMS CMK + Secrets Manager + ESO | ✅ (이번 작업) |
| alloy Service 4317 | ✅ (이번 작업) |

**Phase B 전체 완료** ✅

## 5. 다음 작업 (Phase C / D / E)

경윤님이 Phase D 담당 중 → MinIO→S3, Kiali, SonarQube 등

남은 항목:
1. Phase C: CI 파이프라인 실제 실행 (build→sign→deploy E2E)
2. Phase E: OAuth 콜백 URL 등록 (Google, Naver - 브라우저 수동)
3. Phase E: 로그인/회원가입 E2E 검증 (RDS 포함)
