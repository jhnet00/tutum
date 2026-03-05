# AWS Migration Plan 2026-03-03 (EKS + ECR)

작성일: `2026-03-03`
최종 수정: `2026-03-05` (MariaDB 연결 방식 수정 — 공인 IP 직접 연결, StrongSwan VPN 불필요)

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

```
┌─────────────────────────────────────────────────────────────────┐
│  AWS ap-northeast-2                                             │
│                                                                  │
│  ┌── EKS VPC (10.0.0.0/16) ──────────────────────────────────┐ │
│  │  Public Subnet:  10.0.1.0/24 (ALB, NAT GW)                │ │
│  │  Private Subnet: 10.0.2.0/24 (EKS worker nodes)           │ │
│  │  Private Subnet: 10.0.3.0/24 (DB: MongoDB, Redis, Kafka)  │ │
│  │  AZ 분산: ap-northeast-2a / 2b / 2c                        │ │
│  └────────────────────────┬───────────────────────────────────┘ │
│                           │ VPC Peering (사설 IP, CIDR 비중복)  │
│  ┌── CI/CD VPC (10.1.0.0/16) ─────────────────────────────────┐ │
│  │  GitLab Runner EC2                                          │ │
│  │  ArgoCD                                                     │ │
│  │  Monitoring EC2 (LGTM + AI 분석)                           │ │
│  └────────────────────────┬───────────────────────────────────┘ │
│                           │ NAT GW → 인터넷 (공인 IP 직접 연결) │
└───────────────────────────┼─────────────────────────────────────┘
                            │ TCP 15432 (TLS 권장)
                    ┌───────┴──────────────────────┐
                    │ 학원 제공 서버 (공인 IP)        │
                    │ MariaDB 211.46.52.153:15432   │
                    │ (회원/인증)                    │
                    └──────────────────────────────┘
```

> **CIDR 비중복 원칙**: VPC Peering 시 각 VPC의 CIDR 대역이 겹치면 라우팅 불가.
> EKS VPC `10.0.0.0/16` / CI-CD VPC `10.1.0.0/16` — 겹치지 않음.

> **MariaDB 연결 방식**: 학원 제공 서버는 이미 공인 IP(`211.46.52.153`)로 외부 노출되어 있어
> EKS → NAT GW → 인터넷 → 211.46.52.153:15432 직접 연결 가능. VPN 불필요.
> 보안 강화: EKS worker 노드 Security Group에서 outbound 211.46.52.153:15432만 허용.

> **ap-northeast-2c**: 프리티어 혜택이 적용되는 AZ. Monitoring EC2(t3.micro) 배치 시 우선 고려.

### 2-2. MSA 서비스 구성

| 서비스 | 네임스페이스 | 역할 |
|--------|------------|------|
| frontend (Next.js) | tutum-app | 씬(Thin) 클라이언트: UI 렌더링, API 프록시 |
| backend (FastAPI) | tutum-app | REST API, 비즈니스 로직 |
| price-producer | tutum-app | 시세 수집 Kafka 생산자 |
| news-producer | tutum-app | 뉴스 수집 Kafka 생산자 |
| price-consumer | tutum-app | 시세 소비 → Redis 캐시 |
| news-consumer | tutum-app | 뉴스 소비 → Elasticsearch 인덱싱 |
| elastic-consumer | tutum-app | 검색 인덱스 처리 |
| MongoDB | tutum-data | 자산/포트폴리오/AI 결과 |
| Redis + Sentinel | tutum-data | 캐시, 세션, Rate Limiting |
| Kafka (KRaft) | tutum-data | 이벤트 스트리밍 |
| Elasticsearch | tutum-data | 뉴스 검색 |
| MariaDB | 학원 제공 서버 (공인 IP, 직접 연결) | 회원/인증 |

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
- **Kiali**: Istio 서비스 맵 시각화 — CI/CD VPC Monitoring EC2에서 운영

### 2-4. 개발/배포 흐름

```
GitLab CI (CI/CD VPC)
  → build (Alpine Linux 기반 이미지)
  → scan (Trivy)
  → push (ECR)
  → sign (Cosign)
  → deploy (k8s-manifests image tag 갱신)
  → sync (ArgoCD → EKS)
```

---

## 3. 네트워크 / 보안 원칙

### 3-1. 외부 접근

| 계층 | 기술 | 비고 |
|------|------|------|
| DNS | Route53 | A 레코드 → ALB |
| TLS 종료 | ACM + ALB | 와일드카드 인증서 권장 |
| WAF | AWS WAF | Managed Rule + Rate Limit |
| 서비스 간 mTLS | Istio (Envoy) | 내부 트래픽 암호화 |

### 3-2. NetworkPolicy (네임스페이스 단위 격리)

| 네임스페이스 | 기본 정책 | 허용 |
|------------|----------|------|
| tutum-app | Deny All Ingress | istio-system, monitoring, 내부 |
| tutum-data | Deny All Ingress | tutum-app, monitoring, keda, 내부 |
| monitoring | Deny All Ingress | 내부만 |
| argocd | Deny All Ingress | 내부만 |
| keda | Deny All Ingress | tutum-data(Kafka 조회용) |

> on-prem K8s에서 이미 적용된 NetworkPolicy 구조를 EKS에 그대로 이식.
> EKS CNI(VPC CNI 또는 Calico) 기반으로 동일하게 동작.

### 3-3. IAM / 접근 제어

- **IRSA (IAM Roles for Service Accounts)**: Pod별 최소 권한 IAM Role
- **Session Manager**: EC2 SSH 키페어 사용 금지. 포트 22 비허용. AWS SSM으로 쉘 접근.
- **Secrets Manager + External Secrets Operator**: K8s Secret을 AWS Secrets Manager에서 동기화
- **ECR 이미지 스캔**: 푸시 시 자동 스캔 활성화

### 3-4. 감사 / 거버넌스

- **AWS CloudTrail**: 전체 API 호출 기록 → S3 저장 (90일 보관, lifecycle → Glacier)
- **AWS Organizations + SCP (Service Control Policy)**:
  - OU 단위로 계정 분리 (dev / staging / prod OU)
  - SCP 예시: 특정 리전(ap-northeast-2) 외 리소스 생성 차단, 루트 계정 콘솔 로그인 차단
  - 주요 리소스(EKS, RDS) 삭제 방지 SCP 적용

### 3-5. 이미지 보안

- **Alpine Linux 기반**: 모든 서비스 Dockerfile에서 `python:3.11-alpine`, `node:20-alpine` 등 사용
  → 이미지 크기 대폭 감소 (예: `python:3.11` ~900MB → `python:3.11-alpine` ~50MB)
- **Cosign 서명**: ECR 기준 키 재발급 후 CI에서 자동 서명
- **Kyverno**: 미서명 이미지 배포 차단

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

Monitoring EC2 (ap-northeast-2c, t3.medium 이상)
  └── Docker Compose
        ├── Grafana   (대시보드)
        ├── Loki      (로그)
        ├── Tempo     (트레이스)
        ├── Mimir     (메트릭 장기 보관)
        └── AI 분석 서버 (Claude Bedrock 연동)
```

> 모니터링 도구는 EKS 내부 컨테이너에 올리지 않는다.
> 클러스터 장애 시 모니터링까지 영향받는 구조를 방지. 전용 EC2로 분리.
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
| 구성 | CI/CD VPC 내 Monitoring EC2 → EKS VPC Peering으로 Alloy가 push |
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

| 항목 | 예상 월 비용(USD) |
|------|-----------------|
| EKS Control Plane | ~72 |
| EC2 Worker (m5.large × 3, Spot 혼용) | ~215 |
| EC2 Monitoring (t3.medium, ap-northeast-2c) | ~30 |
| ALB | ~20 |
| EBS (gp3 300GB) | ~24 |
| NAT Gateway | ~45 |
| VPN Gateway | ~~36~~ → **0** (MariaDB 공인 IP 직접 연결) |
| S3 + Glacier + CloudTrail | ~15 |
| ECR | ~5 |
| CloudWatch | ~15 |
| **합계** | **~441** |

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
   - EKS 클러스터/노드 그룹 운영 (VPC 2개 + Peering)
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

### Phase A (D+0 ~ D+3): 기반 준비
1. ECR repo 생성
2. GitLab CI 변수 등록 (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `ECR_REGISTRY`)
3. AWS Organizations + OU 구성 + SCP 초기 정책 적용
4. EKS VPC / CI-CD VPC CIDR 설계 (비중복 확인)
5. MariaDB 연결 검증: EKS worker SG에 outbound `211.46.52.153:15432` 허용 설정

### Phase B (D+4 ~ D+7): EKS 구성
1. EKS VPC + CI-CD VPC 생성, VPC Peering 설정
2. EKS 클러스터 생성 (Managed Node Group, ap-northeast-2a/b/c 분산)
3. ALB Ingress Controller + ACM 인증서 연동
4. ArgoCD 연동 (CI-CD VPC)
5. NetworkPolicy 이식 (tutum-app, tutum-data, 네임스페이스별)
6. Session Manager 설정, EC2 키페어 미사용 확인
7. **Istio 재설치 (EKS 환경), IngressGateway 제거** (R4)

### Phase C (D+8 ~ D+12): 배포 전환
1. GitLab CI → ECR push 전환 + Alpine Linux 이미지 전환
2. Cosign 키 재발급 + Kyverno policy registry 경로 수정 (R3)
3. k8s-manifests image 경로 ECR 통일
4. MariaDB 연결 검증 (EKS → 211.46.52.153:15432 직접 연결, 회원/로그인 E2E)
5. staging E2E 검증

### Phase D (D+13 ~ D+18): 데이터/관측
1. MinIO → S3 복제 구성
2. S3 lifecycle → Glacier 적용
3. **Monitoring EC2 구성** (ap-northeast-2c, Docker Compose, LGTM + AI)
4. Grafana 대시보드 구성 (클러스터 개요 / 파드 분석 / 메트릭+로그+트레이스 / AI 분석)
5. CloudTrail 활성화 + S3 저장 설정
6. CloudWatch 알람 + Grafana 알람 정책 정리

### Phase E (D+19 ~ D+24): 안정화
1. canary/rollback 리허설
2. 장애 시나리오 점검 (MariaDB 서버 접근 불가, 노드 장애, Kafka lag 폭증)
3. SCP/IAM 권한 최소화 최종 검토
4. 운영 문서 확정

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
