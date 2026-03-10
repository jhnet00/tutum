# AWS Migration Plan 2026-03-03 (EKS + ECR)

작성일: `2026-03-03`
최종 수정: `2026-03-05` (MariaDB 공인 IP 직접 연결 / CI/CD VPC 제거 — GitLab SaaS + EKS 내 Runner로 단일 VPC 충분)

---

## 1. 확정 방향

1. Harbor는 사용하지 않는다.
2. 소스/CI/CD는 GitLab 기준으로 유지한다.
3. AWS 단계의 이미지 저장소는 ECR을 사용한다.
4. 배포 대상은 EKS를 사용한다.
5. 온프레 MinIO는 유지하고, 필요 데이터는 `MinIO → S3 → Glacier` 정책으로 관리한다.
6. EC2 접근은 SSH 키페어를 사용하지 않고 **AWS Systems Manager Session Manager**로 대체한다.
7. 모니터링 도구(LGTM)는 컨테이너(EKS)에 올리지 않고 **전용 EC2**로 분리 운영한다.
8. 도커 이미지 베이스는 가능한 **Alpine Linux** 기반으로 경량화한다.

---

## 2. 목표 아키텍처

### 2-1. VPC 구성 (핵심)

> **단일 VPC 채택 이유**: GitLab은 SaaS(gitlab.com)이고 GitLab Runner는 EKS 내 pod로 실행.
> Jenkins/GitLab self-hosted 서버가 없으므로 별도 CI/CD VPC가 불필요.
> Monitoring EC2만 EKS VPC private subnet에 배치. Elasticsearch는 EKS 내 StatefulSet.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  AWS ap-northeast-2                                                      │
│                                                                           │
│  ┌── EKS VPC (10.60.0.0/16) ───────────────────────────────────────────┐ │
│  │                                                                      │ │
│  │  [Public Subnet]  10.60.1.0/24 (ap-northeast-2a) — ALB, NAT GW     │ │
│  │  [Public Subnet]  10.60.2.0/24 (ap-northeast-2b) — ALB (Multi-AZ)  │ │
│  │                                                                      │ │
│  │  [Private Subnet] 10.60.11.0/24 (ap-northeast-2a) — EKS Auto Mode  │ │
│  │  [Private Subnet] 10.60.12.0/24 (ap-northeast-2b) — EKS Auto Mode  │ │
│  │                                                                      │ │
│  │  EKS 내 pod:  GitLab Runner (gitlab-runner ns)                      │ │
│  │               ArgoCD (argocd ns)                                    │ │
│  │               ALB Controller (kube-system)                          │ │
│  │  AZ 분산: ap-northeast-2a / 2b                                      │ │
│  │  클러스터: tutum-stg-eks (스테이징), tutum-prd-eks (프로덕션)         │ │
│  │  노드 타입: EKS Auto Mode (Bottlerocket, Karpenter 기반)             │ │
│  │  인증 모드: API (access entries, aws-auth ConfigMap 없음)            │ │
│  └──────────────────────────┬───────────────────────────────────────────┘ │
│                             │ NAT GW → 인터넷                             │
└─────────────────────────────┼────────────────────────────────────────────┘
                              │ TCP 15432
                    ┌─────────┴─────────────────────┐
                    │ 학원 제공 서버 (공인 IP)          │
                    │ MariaDB 211.46.52.153:15432    │
                    │ (회원/인증, VPN 불필요)          │
                    └───────────────────────────────┘
```

> **MariaDB 연결 방식**: 학원 제공 서버는 이미 공인 IP(`211.46.52.153`)로 외부 노출되어 있어
> EKS → NAT GW → 인터넷 → 211.46.52.153:15432 직접 연결 가능. VPN 불필요.
> 보안 강화: EKS worker 노드 Security Group에서 outbound 211.46.52.153:15432만 허용.

> **ap-northeast-2c**: 프리티어 혜택이 적용되는 AZ. Monitoring EC2(t3.micro) 배치 시 우선 고려.

### 2-2. MSA 서비스 구성

| 서비스 | 네임스페이스 | 현재 상태 | 역할 |
|--------|------------|----------|------|
| frontend (Next.js) | tutum-app | ✅ Running (2 pod) | UI 렌더링, API 프록시 |
| backend (FastAPI) | tutum-app | ✅ Running (2~5 pod, KEDA) | REST API, 비즈니스 로직 |
| price-producer | tutum-app | ✅ Running | 시세 수집 Kafka 생산자 |
| news-producer | tutum-app | ✅ Running | 뉴스 수집 Kafka 생산자 |
| price-consumer | tutum-app | ✅ Running (KEDA 1-5) | 시세 소비 → Redis 캐시 |
| news-consumer | tutum-app | ✅ Running (KEDA 1-4) | 뉴스 소비 → Elasticsearch |
| elastic-consumer | tutum-app | ✅ Running (KEDA 0-3) | 검색 인덱스 처리 |
| email-worker | tutum-app | ✅ Running | 이메일 인증 처리 |
| ocr | tutum-app | ✅ Running | OCR (GCP Vision API) |
| ~~cloudflared~~ | ~~tutum-app~~ | ~~Running~~ | ~~Cloudflare Tunnel~~ (EKS 전환 시 제거 — Route53 직접 라우팅으로 대체) |
| MongoDB | tutum-data | ✅ StatefulSet 3-replica (30Gi×3) | 자산/포트폴리오/AI 결과 |
| Redis | tutum-data | ✅ StatefulSet 3-replica Master+2Replica (5Gi×3) | 캐시, 세션, Rate Limiting |
| Kafka (KRaft) | tutum-data | ✅ StatefulSet 3-replica, RF=3 (20Gi×3) | 이벤트 스트리밍 |
| Elasticsearch | tutum-data | ✅ StatefulSet 1-replica (30Gi) | 뉴스 검색 |
| MinIO | tutum-storage | ✅ StatefulSet 4-pod (20Gi×4) | 오브젝트 스토리지 (→ S3 이전 예정) |
| MariaDB | 학원 서버 (211.46.52.153:15432) | ✅ 직접 연결 확인 | 회원/인증 |

### 2-3. 트래픽 흐름

```
Route53 (DNS)
  → ALB (HTTPS, ACM 인증서)
    → K8s Ingress (AWS Load Balancer Controller)
      → Istio Envoy Sidecar (mTLS, Circuit Breaker)
        → Pod (frontend / backend)
          → tutum-data namespace (MongoDB / Redis / Kafka)
```

- **HTTPS/SSL**: ACM(AWS Certificate Manager)에서 인증서 발급 → ALB에 부착
- **HTTP → HTTPS 리다이렉트**: ALB 리스너 규칙으로 강제
- **Istio IngressGateway**: EKS 전환 후 제거, ALB로 대체
- **Istio 내부 메시(Envoy proxy)**: 유지 — 서비스 간 mTLS, Circuit Breaker, Retry
- **Kiali**: Istio 서비스 맵 시각화 — EKS VPC Monitoring EC2에서 운영

### 2-4. 개발/배포 흐름

```
GitLab CI (SaaS)
  → build (Alpine Linux 기반 이미지)
  → scan (Trivy)
  → push (ECR)
  → sign (Cosign)
  → deploy (k8s-manifests image tag 갱신)
  → sync (ArgoCD → EKS)
```

---

## 3. 네트워크 / 보안 원칙

### 3-1. 외부 접근 (Public-facing 보안 계층)

| 계층 | 기술 | 구현 방법 | 비고 |
|------|------|----------|------|
| DNS | Route53 | A 레코드 → ALB | ✅ ACM 진행 중 |
| DDoS 방어 | **AWS Shield Standard** | 자동 활성화 (무료) | 기본 L3/L4 보호 |
| WAF | **AWS WAF v2** | ALB에 WebACL 연결 | Managed Rule(AWS Core) + Rate Limit (IP당 2000req/5min) |
| TLS 종료 | ACM + ALB | `*.tutum.my` 와일드카드 | ⬜ ISSUED 후 Ingress에 annotation 추가 |
| 서비스 간 mTLS | Istio (Envoy Sidecar) | PeerAuthentication STRICT | ✅ on-prem 적용, EKS 이식 예정 |

> **WAF WebACL 최소 룰셋** (ALB에 연결):
> - `AWSManagedRulesCommonRuleSet` — OWASP Top 10 기본 차단
> - `AWSManagedRulesKnownBadInputsRuleSet` — 악성 입력 차단
> - `RateBasedRule` — IP당 2000 req/5min 초과 시 Block

### 3-2. NetworkPolicy (네임스페이스 단위 격리)

| 네임스페이스 | 기본 정책 | 허용 |
|------------|----------|------|
| tutum-app | Deny All Ingress | istio-system, monitoring, 내부 |
| tutum-data | Deny All Ingress | tutum-app, monitoring, keda, 내부 |
| monitoring | Deny All Ingress | 내부만 |
| argocd | Deny All Ingress | 내부만 |
| keda | Deny All Ingress | tutum-data(Kafka 조회용) |

> on-prem K8s에서 이미 적용된 NetworkPolicy 구조를 EKS에 그대로 이식.
> EKS vpc-cni Network Policy 기반으로 동일하게 동작. ✅ EKS 이식 완료

### 3-3. NACL (Subnet 단위 방화벽)

> K8s NetworkPolicy(Pod 레벨)와 별개로 VPC subnet 레벨의 Stateless 방화벽.
> Public subnet에만 적용 (ALB, NAT GW). Private subnet은 SG로 충분.

| Subnet | NACL 규칙 | 목적 |
|--------|----------|------|
| Public (10.60.1.0/24, 10.60.2.0/24) | Inbound: 80/443 허용, 나머지 Deny | 외부 트래픽 제한 |
| Public | Outbound: 1024-65535 허용 (Ephemeral) | 응답 트래픽 |
| Private (10.60.11~12.0/24) | 기본값 유지 (all allow) | SG/NP로 제어 |

### 3-4. VPC Endpoints (AWS 서비스 내부 통신 — 인터넷 미경유)

> **현재 문제**: EKS 노드 → NAT GW → 인터넷 → ECR/S3 (데이터 전송 비용 발생)
> **개선**: VPC Endpoint 생성 시 NAT GW 통과 없이 AWS 내부망 직접 통신

| Endpoint | 타입 | 대상 서비스 | 효과 |
|----------|------|-----------|------|
| `com.amazonaws.ap-northeast-2.ecr.api` | Interface | ECR API | ECR 인증 트래픽 내부화 |
| `com.amazonaws.ap-northeast-2.ecr.dkr` | Interface | ECR Docker | 이미지 pull 내부화 (NAT GW 비용↓) |
| `com.amazonaws.ap-northeast-2.s3` | Gateway | S3 | MinIO→S3 이전 후 S3 접근 내부화 |
| `com.amazonaws.ap-northeast-2.secretsmanager` | Interface | Secrets Manager | 시크릿 조회 내부화 |

```bash
# ECR Interface Endpoint 생성 (private subnet SG 연결)
aws ec2 create-vpc-endpoint \
  --vpc-id <VPC_ID> \
  --service-name com.amazonaws.ap-northeast-2.ecr.dkr \
  --vpc-endpoint-type Interface \
  --subnet-ids <private-subnet-a> <private-subnet-b> \
  --security-group-ids <node-sg> \
  --private-dns-enabled

# S3 Gateway Endpoint (route table 연결 — 무료)
aws ec2 create-vpc-endpoint \
  --vpc-id <VPC_ID> \
  --service-name com.amazonaws.ap-northeast-2.s3 \
  --vpc-endpoint-type Gateway \
  --route-table-ids <private-rtb-a> <private-rtb-b>
```

### 3-5. IAM / 접근 제어

- **IRSA (IAM Roles for Service Accounts)**: Pod별 최소 권한 IAM Role (S3, Bedrock, Textract 등)
- **Session Manager**: ✅ EC2 SSH 키페어 없음. 포트 22 비허용. AWS SSM으로 쉘 접근. (완료)
- **AWS Secrets Manager**: K8s `app-secrets` 를 Secrets Manager에서 관리
  - EKS Pod → IRSA → Secrets Manager (VPC Endpoint 경유) → KMS CMK 복호화 → 시크릿 반환
  - `External Secrets Operator`로 K8s Secret 자동 동기화 (refreshInterval: 1h)
  - **Secrets Manager 암호화 키**: KMS CMK(`alias/tutum-secrets-key`) 지정 → AWS 관리형 키 대신 CMK 사용
    → IRSA에 `secretsmanager:GetSecretValue` + **`kms:Decrypt`** 두 권한 모두 필요
- **AWS KMS**: EBS 볼륨(PVC) + S3 버킷 + Secrets Manager 암호화. CMK(Customer Managed Key) 사용
  - `alias/tutum-secrets-key`: Secrets Manager 전용 CMK
  - EBS PVC 암호화: EKS StorageClass에 `encrypted: true` + kmsKeyId 지정
  - S3 버킷 SSE-KMS: `put-bucket-encryption --sse-algorithm aws:kms`
- **AWS Certificate Manager (ACM)**: `*.tutum.my` 와일드카드 인증서
  - ✅ 발급 신청 완료 (Route53 DNS validation CNAME 등록 완료)
  - ⬜ ISSUED 후 ALB Ingress에 `alb.ingress.kubernetes.io/certificate-arn` annotation 추가
- **ECR 이미지 스캔**: 푸시 시 자동 스캔 활성화 (✅ repo 생성 시 설정됨)

### 3-6. 위협 탐지 / 감사

- **AWS GuardDuty**: 비정상 API 호출, 악성 IP, 크립토마이닝 탐지
  - EKS 런타임 모니터링 활성화 (GuardDuty EKS Protection)
  - 탐지 결과 → SNS → Slack `#tutum-alerts` 연동
- **AWS CloudTrail**: 전체 API 호출 기록 → S3 저장 (90일 보관, lifecycle → Glacier)
- **AWS Organizations + SCP (Service Control Policy)**:
  - OU 단위로 계정 분리 (dev / staging / prod OU)
  - SCP: 특정 리전(ap-northeast-2) 외 리소스 생성 차단, 루트 계정 콘솔 로그인 차단

### 3-7. Security Groups / 내부 트래픽 설계

> EKS Auto Mode는 클러스터 생성 시 Cluster SG를 자동 생성한다. 용도에 따라 SG를 분리한다.

| SG | 생성 주체 | 역할 | 커스텀 규칙 |
|----|----------|------|------------|
| Cluster SG | EKS 자동 | Control Plane ↔ Node 통신 | EKS → Monitoring EC2 outbound 추가 |
| Monitoring EC2 SG | 수동 생성 | Grafana/Loki/Mimir/Tempo EC2 접근 | EKS 노드에서 push 포트 inbound 허용 |
| MariaDB SG (outbound) | 수동 추가 | EKS 노드 → 211.46.52.153:15432 | B-14 참고 |

**Internal Load Balancer(내부 ALB/NLB)가 불필요한 이유**:
- 서비스 간 내부 통신은 **Istio Envoy Sidecar(mTLS)** 가 담당 → 별도 Internal LB 계층 불필요
- EKS 노드 → Monitoring EC2 통신은 SG 규칙 + private subnet 직접 경로로 처리
- `kubernetes.io/role/internal-elb=1` subnet 태그는 향후 필요 시 내부 NLB 배치를 위한 예약 태그
- **트래픽 흐름**: 인터넷 → ALB(External, public subnet) → Istio Envoy → Pod (내부 LB 없음)

### 3-8. 이미지 보안 (공급망 보안)

- **Alpine Linux 기반**: `python:3.11-alpine`, `node:20-alpine` — ✅ 완료
  → 이미지 크기 대폭 감소 (예: `python:3.11` ~900MB → `python:3.11-alpine` ~50MB)
- **Trivy**: CI에서 CRITICAL/HIGH 취약점 발견 시 파이프라인 중단 — ✅ 완료
- **Cosign 서명**: ECR 기준 키 재발급 후 CI에서 자동 서명 — ✅ 완료
- **Kyverno**: 미서명 이미지 배포 차단 (Enforce) — ✅ on-prem 적용, EKS 이식 예정

---

## 4. 오토스케일링 선택 근거

### 4-1. HPA vs KEDA

| 항목 | HPA | KEDA |
|------|-----|------|
| 트리거 기준 | CPU/Memory만 | Kafka lag, Redis 큐, Cron 등 커스텀 메트릭 |
| Scale-to-Zero | 불가 (min 1) | 가능 |
| 외부 메트릭 연동 | 불가 | 가능 (Kafka, Prometheus 등) |
| HPA 호환성 | - | KEDA가 내부적으로 HPA 생성 (상위 호환) |
| 적합 워크로드 | 단순 웹 서버 | 이벤트 기반 워커 |

**→ KEDA 선택 이유**: price-consumer/news-consumer/elastic-consumer가 Kafka Consumer Lag 기반으로 스케일링 필요. HPA는 Kafka lag을 직접 트리거로 사용할 수 없음. KEDA는 HPA를 내부적으로 생성하므로 기존 HPA 기능도 포함.

### 4-2. Karpenter vs Cluster Autoscaler (CA)

| 항목 | Cluster Autoscaler | Karpenter |
|------|-------------------|-----------|
| 노드 프로비저닝 | ASG 기반 (느림, ~2-3분) | EC2 Fleet 직접 (빠름, ~30-60초) |
| 인스턴스 유형 | ASG에 미리 지정 | Pod 요구사항에 맞게 자동 선택 |
| Spot 지원 | 가능 (복잡한 설정) | 기본 지원 |
| EKS 최적화 | AWS 지원 | AWS 공식 지원 (EKS Blueprint 포함) |
| 학습 곡선 | 낮음 | 중간 |

**→ 현재 on-prem에서는 KEDA만 사용 (Node Autoscaling 없음)**.
EKS 전환 시 CA를 먼저 적용하고, 안정화 후 Karpenter 전환 검토.
초기에는 노드 수 고정(3개) 운영 후 필요 시 도입.

---

## 5. 관측성 (Observability) 설계

### 5-1. 모니터링 아키텍처

```
EKS 클러스터
  └── Alloy DaemonSet (각 노드)
        ├── 메트릭 → Mimir (Monitoring EC2)
        ├── 로그   → Loki  (Monitoring EC2)
        └── 트레이스 → Tempo (Monitoring EC2)

Monitoring EC2 (EKS VPC private subnet, ap-northeast-2c, t3.medium 이상)
  └── Docker Compose
        ├── Grafana   (대시보드)
        ├── Loki      (로그)
        ├── Tempo     (트레이스)
        ├── Mimir     (메트릭 장기 보관)
        └── AI 분석 서버 (Claude Bedrock 연동)
```

> 모니터링 도구는 EKS 내부 컨테이너에 올리지 않는다.
> 클러스터 장애 시 모니터링까지 영향받는 구조를 방지. 전용 EC2로 분리.
> EKS VPC 내 private subnet에 배치 — VPC Peering 불필요, Alloy → Monitoring EC2 직접 통신.
> ap-northeast-2c에 배치 시 프리티어(t3.micro) 활용 가능. 실사용은 t3.medium 권장.

### 5-2. 모니터링 대시보드 구성 (Grafana)

| 대시보드 | 내용 |
|---------|------|
| **클러스터 개요** | 노드 상태, CPU/Memory 전체, Pod 수, 네임스페이스별 리소스 |
| **파드 분석** | Pod별 CPU/Memory, 재시작 횟수, 컨테이너 상태, OOM 이벤트 |
| **메트릭 분석 (Mimir)** | API latency p50/p95/p99, 5xx 비율, Kafka lag, consumer lag |
| **로그 분석 (Loki)** | 에러 로그 집계, 서비스별 로그 스트림, 알람 연동 |
| **트레이스 분석 (Tempo)** | 분산 트레이싱, 느린 쿼리 추적, 서비스 의존성 맵 |
| **AI 분석** | Claude Bedrock 연동 — 이상 패턴 감지, 장애 원인 요약, 대응 제안 |
| **Kiali** | Istio 서비스 메시 트래픽 맵, mTLS 상태, Circuit Breaker 현황 |
| **k6 부하 테스트** | 부하 테스트 결과 (InfluxDB 연동) |

### 5-3. 로그 설계

| 레벨 | 대상 | 내용 |
|------|------|------|
| INFO | 모든 서비스 | 요청/응답 (method, path, status, latency) |
| WARN | backend, workers | 재시도, rate limit 초과, 캐시 미스 |
| ERROR | 모든 서비스 | 예외 스택, DB 연결 실패, Kafka 에러 |
| AUDIT | backend | 인증/인가 이벤트 (로그인, 토큰 발급, 권한 변경) |

**로그 포맷**: JSON 구조화 로그
```json
{
  "timestamp": "2026-03-04T12:00:00Z",
  "level": "ERROR",
  "service": "backend",
  "namespace": "tutum-app",
  "pod": "backend-xxx",
  "trace_id": "abc123",
  "message": "MongoDB connection timeout",
  "error": "dial tcp: i/o timeout"
}
```

### 5-4. 메트릭 설계

| 분류 | 메트릭 | 알람 조건 |
|------|--------|----------|
| **리소스** | CPU usage, Memory usage, Node 상태 | CPU > 80%, Memory > 85% |
| **API** | latency p95, 5xx rate, RPS | p95 > 2s, 5xx > 1% |
| **Kafka** | consumer lag, producer throughput | lag > 1000 |
| **DB** | MongoDB 응답시간, Redis hit율 | 응답 > 500ms, hit < 80% |
| **K8s** | Pod 재시작, OOMKilled, Pending | 재시작 > 5/5min |
| **비즈니스** | OCR 실패율, 시세 갱신 지연 | 실패율 > 5%, 갱신 지연 > 30s |

---

## 6. 리스크 분석

### R1: MariaDB 연결 방식

| 항목 | 내용 |
|------|------|
| 현황 | MariaDB는 학원 제공 서버 **공인 IP `211.46.52.153:15432`** 로 운영 중 |
| 연결 방식 | EKS worker → NAT GW → 인터넷 → `211.46.52.153:15432` **직접 연결** (VPN 불필요) |
| 보안 조치 | EKS worker SG: outbound `211.46.52.153:15432` only / MariaDB TLS 연결 권장 |
| 장기 계획 | 프로젝트 종료(학원 서버 반납) 이후 **AWS RDS(MariaDB)** 전환 검토 |
| 영향 | R1 리스크 대폭 해소 — VPN 구성/협의 불필요, Phase A 사전 작업 제거 |

### R2: Monitoring VM 접근 불가

| 항목 | 내용 |
|------|------|
| 현황 | LGTM 스택(Grafana/Loki/Tempo/Mimir)이 192.168.0.230에서 운영 |
| 문제 | EKS에서 해당 VM으로 메트릭/로그/트레이스 전송 불가 |
| **확정 해결 방안** | **LGTM을 전용 EC2(ap-northeast-2c)에 Docker Compose로 재구성** |
| 구성 | EKS VPC private subnet(10.0.4.0/24) 내 Monitoring EC2 → Alloy가 직접 push |
| 비용 추가 | t3.medium ~$30/월 |

### R3: Cosign + Kyverno ECR 재설정

| 항목 | 내용 |
|------|------|
| 현황 | Cosign 키가 GitLab CR(`registry.gitlab.com`) 기준으로 설정됨 |
| 문제 | ECR(`*.dkr.ecr.ap-northeast-2.amazonaws.com`)으로 변경 시 Kyverno verifyImages 정책 경로 불일치 |
| 영향 | 미서명 이미지 배포 차단 정책 무력화 또는 모든 배포 실패 |
| 조치 | Phase C에서 Cosign 재서명 + Kyverno policy registry 경로 수정 |

### R4: ALB + Istio 역할 분리

| 항목 | 내용 |
|------|------|
| 현황 | on-prem: MetalLB → Istio IngressGateway → 서비스 |
| EKS 방향 | ALB = 외부 진입점 / Istio Envoy = 내부 서비스 메시 |
| 구성 | `Route53 → ALB(ACM) → K8s Service → Istio Envoy Sidecar → Pod` |
| 주의 | Istio IngressGateway/Gateway/VirtualService 일부 리소스 정리 필요 |

### R5: 비용 900 USD 실현 가능성

| 항목 | 사양 | 예상 월 비용(USD) |
|------|------|-----------------|
| EKS Control Plane (tutum-stg-eks) | - | ~73 |
| EKS Auto Mode 노드 | Bottlerocket, private subnet | ~150 |
| EC2 Monitoring (t3.medium) | EKS VPC private subnet | ~30 |
| ALB | - | ~20 |
| EBS gp3 (EKS PVC) | - | ~24 |
| NAT Gateway | VPC Endpoint 적용 후 절감 | ~30 |
| S3 + Glacier + CloudTrail | - | ~15 |
| ECR (`tutum/*` 3개 리포) | - | ~5 |
| CloudWatch | - | ~15 |
| **AWS WAF** | WebACL + Managed Rules | ~10 |
| **GuardDuty** | EKS Protection 포함 | ~15 |
| **VPC Endpoints** | ECR×2(Interface), S3(Gateway 무료) | ~15 |
| **KMS CMK** | EBS + S3 암호화 | ~5 |
| VPN Gateway | ~~36~~ → **0** (MariaDB 공인 IP 직접 연결) | 0 |
| **합계** | | **~407** |

> VPC Endpoint(ECR DKR) 도입 시 이미지 pull NAT GW 트래픽 절감 → NAT GW 비용 ~$15 절감.
> tutum-prd-eks 추가 시 EKS Control Plane 비용 ×2 (stg+prd 각각 $73)
> 보안 서비스(WAF+GuardDuty+KMS+VPC Endpoint) 추가 ~$45/월 — 총 900 USD 이하 유지

> VPN Gateway 불필요(MariaDB 공인 IP 직접 연결)로 기존 대비 -$36 절감.
> RDS로 MariaDB 이전 시 추가 ~$30-50/월 발생 (현재 계획은 학원 서버 직접 연결 유지).

---

## 7. CI/CD 타깃 플로우 (GitLab → ECR → EKS)

1. `develop` — staging 성격
   - image tag: `stg-$CI_COMMIT_SHORT_SHA`

2. `main` — production 성격
   - image tag: `prod-$CI_COMMIT_SHORT_SHA`

3. 파이프라인 단계
   - `build`: Alpine Linux 기반 Docker image build
   - `scan`: Trivy (CRITICAL/HIGH → 파이프라인 중단)
   - `push`: ECR push
   - `sign`: Cosign 서명 (ECR 기준 키)
   - `deploy`: k8s-manifests image tag 갱신
   - `sync`: ArgoCD sync

---

## 8. 담당 목록

1. **보안 담당**
   - IAM/IRSA 설계
   - WAF 룰 설정
   - Cosign 키 재발급 + Kyverno policy 수정 (R3)
   - NetworkPolicy 이식 (on-prem → EKS)
   - CloudTrail 설정
   - AWS Organizations + SCP 설계

2. **플랫폼 담당**
   - EKS 클러스터/노드 그룹 운영 (단일 VPC)
   - ALB Ingress Controller + ACM 연동
   - EKS worker SG outbound 211.46.52.153:15432 허용 (MariaDB 직접 연결)
   - Session Manager 설정 (키페어 대체)
   - 장애 대응 runbook

3. **백엔드 담당**
   - ECR 기준 이미지/배포 정리
   - Alpine Linux 기반 Dockerfile 전환
   - Secret/Config 분리 (Secrets Manager 연동)
   - API smoke test + 구조화 로그 적용

4. **프론트엔드 담당**
   - ALB/도메인 경로 기준 API 연동 점검
   - Alpine Linux 기반 Dockerfile 전환
   - OAuth/실데이터 회귀 테스트

5. **데이터/모니터링 담당**
   - MinIO → S3 복제
   - S3 lifecycle(Glacier) 정책
   - DB 백업/복구 시나리오
   - Monitoring EC2 구성 (LGTM + AI 분석, R2)
   - Grafana 대시보드 구성 (클러스터 개요/파드 분석/3대 구성요소/AI)
   - 메트릭/로그 알람 정책

---

## 9. 단계별 실행

### Phase A (D+0 ~ D+3): 기반 준비 — ✅ 대부분 완료
1. ✅ ECR repo 생성 (`tutum/frontend`, `tutum/backend`, `tutum/workers`)
2. ✅ GitLab CI 변수 등록 (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `ECR_REGISTRY`)
3. ✅ VPC 생성 완료 (10.60.0.0/16, public/private 서브넷, NAT GW)
4. ✅ EKS 클러스터 생성 (`tutum-stg-eks`, `tutum-prd-eks`, Auto Mode, K8s v1.29)
5. ✅ Session Manager 설정 + MariaDB SSM 연결 검증 (`MARIADB_REACHABLE`)
6. ✅ ACM `*.tutum.my` 인증서 발급 신청 + Route53 DNS validation 등록
7. ⬜ AWS Organizations + SCP 초기 정책 (미완)

### Phase B (D+4 ~ D+7): EKS 구성 — 🔶 진행 중
1. ✅ 네임스페이스 생성 (tutum-app, tutum-data, tutum-storage, monitoring, keda)
2. ✅ ALB Ingress Controller v3.1.0 설치 + IRSA (2/2 Running)
3. ✅ ArgoCD 설치 (stable manifest kubectl apply, 7/7 Running)
4. ✅ NetworkPolicy 이식 (tutum-app, tutum-data)
5. ✅ Istio minimal profile 설치 (istiod, IngressGateway 제거) + 사이드카 주입 활성화
6. ⬜ **app-secrets 등 EKS 시크릿 재생성** (파이프라인 실행 전 필수)
7. ⬜ **KEDA 설치 + ScaledObject 적용**
8. ⬜ **Kyverno + ECR CronJob 설치 + 정책 적용**
9. ⬜ **ArgoCD GitLab 리포 연결 + staging-app.yaml destination 변경**
10. ⬜ **NACL 생성** (public subnet 10.60.1/2.0/24 — 80/443 inbound만 허용)
11. ⬜ **VPC Endpoint 생성** (ECR API, ECR DKR, S3 Gateway)
12. ⬜ **AWS WAF WebACL 생성 + ALB 연결** (AWSManagedRulesCommonRuleSet + Rate Limit)
13. ⬜ **GuardDuty 활성화** (EKS Protection 포함, SNS → Slack 알림 연동)
14. ⬜ **AWS KMS CMK 생성** (EBS PVC 암호화, S3 암호화용)
15. ⬜ **AWS Secrets Manager** 에 app-secrets 등록 + IRSA + External Secrets Operator

### Phase C (D+8 ~ D+12): 배포 전환 — 🔶 코드 완료, 파이프라인 미실행
1. ✅ `backend/workers/Dockerfile` Alpine Linux 전환 (`python:3.11-alpine`)
2. ✅ `.gitlab-ci.yml` ECR 전환 (build/scan/sign/deploy 전 구간)
3. ✅ `kustomization.yaml` ECR 이미지 경로 통일 (staging + production)
4. ✅ Cosign 키 재발급 (cp-2 `/tmp/cosign.key`, `/tmp/cosign.pub`) + Kyverno 정책 on-prem 적용
5. ⬜ **GitLab CI COSIGN_PRIVATE_KEY/PUBLIC_KEY 수동 업데이트** → 파이프라인 진행 차단
6. ⬜ 파이프라인 실행 + ECR push + ArgoCD EKS sync 확인
7. ⬜ 스테이징 E2E 검증 (로그인, 시세, 뉴스, AI, OCR, MariaDB)

### Phase D (D+13 ~ D+18): 데이터/관측/보안 강화 — ⬜ 미시작
1. S3 버킷 `tutum-prod-storage` 생성 + **KMS CMK 암호화** + 퍼블릭 액세스 차단
2. **VPC Endpoint(S3 Gateway)** 연결 확인 (S3 트래픽 내부망 통신 검증)
3. MinIO → S3 mc mirror (ocr-images, profile-images) + 파일 수 검증
4. Backend S3 IRSA 전환 (MINIO_* env 제거, 키리스 인증)
5. **Monitoring EC2** (EKS VPC private subnet, t3.medium, Docker Compose LGTM)
6. EKS Alloy DaemonSet remote_write → Monitoring EC2 내부 IP
7. Grafana 대시보드 구성 (클러스터 개요 / 파드 분석 / 메트릭+로그+트레이스)
8. **CloudTrail 활성화** + S3 저장 (90일) + Glacier lifecycle
9. **S3 Lifecycle** 설정 (ocr-images 180일 만료, backups/ Glacier 30일, CloudTrail 90일)

### Phase E (D+19 ~ D+24): 안정화 — ⬜ 미시작
1. ACM `*.tutum.my` ISSUED 확인 후 ALB Ingress 생성 (tutum.my 도메인 연결)
2. OAuth 콜백 URL → ALB DNS or tutum.my (Google, Naver)
3. 가비아 네임서버 → Route53 변경 (Cloudflare 제거, tutum.my 직접 ALB 라우팅)
4. canary/rollback 리허설
5. SCP/IAM 권한 최소화 최종 검토
6. AWS Budget Alert $700 설정
7. 운영 문서 확정

---

## 10. 비용 가드레일 (총 900 USD 이하)

1. 월간 비용 상한 관리: `EKS + EC2 + ALB + EBS + NAT + S3 + CloudWatch`
2. Spot 혼용 (비핵심 워크로드: news-consumer, elastic-consumer 등)으로 절감
3. S3 lifecycle으로 저장 비용 절감 (CloudTrail 포함)
4. 미사용 자원 정리 자동화 (EBS, ELB, NAT)
5. ap-northeast-2c 프리티어 활용 (Monitoring EC2 초기 비용 절감)
6. AWS Cost Explorer + Budget Alert ($700 임계값) 설정

---

## 11. Done 기준

1. Harbor 관련 항목이 문서/파이프라인/매니페스트에서 완전 제거됨
2. `develop → ECR(stg) → EKS` 배포 성공
3. `main → ECR(prod) → EKS` 배포 성공
4. OAuth, 시세, 뉴스, OCR, SES, MinIO E2E 통과
5. MariaDB 연결 정상 (211.46.52.153:15432 직접 연결, 회원/로그인 E2E 포함)
6. Cosign 서명 검증 정상 (Kyverno 미서명 이미지 차단 확인)
7. LGTM 대시보드 5종 + AI 분석 운영 가능 상태
8. CloudTrail 활성화, SCP 적용, Session Manager 접근 확인
9. 비용 월 900 USD 이하 유지 확인
