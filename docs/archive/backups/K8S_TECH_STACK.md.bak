# Tutum K8s 기술 스택

> 현재 상태: Docker Compose 기반 3-Node VM 운영
> 목표 상태: Kubernetes 클러스터 + Istio + LGTM + GitOps + KEDA + Karpenter


## 현재 아키텍처 (AS-IS)

```
┌─────────────────────────────────────────────────────────────┐
│                    VirtualBox 3-Node 구성                     │
│                                                             │
│  Node1 (4GB/2Core)    Node2 (4GB/2Core)   Node3 (8GB/3Core) │
│  ┌─────────────┐     ┌──────────────┐    ┌──────────────┐  │
│  │ Nginx       │     │ Redis        │    │ Elasticsearch│  │
│  │ Frontend    │     │ MinIO        │    │ Kafka(KRaft) │  │
│  │ Backend     │     │ Harbor       │    │ Workers      │  │
│  └─────────────┘     └──────────────┘    └──────────────┘  │
│                       MongoDB Atlas       └──────────────┘  │
│                     (임시, K8s에서 로컬 전환)                  │
└─────────────────────────────────────────────────────────────┘
```

**현재 구성 요소:**
- Frontend: Next.js (포트 3000)
- Backend: FastAPI (포트 8000)
- Nginx: 리버스 프록시 (포트 80/443)
- MongoDB: Atlas Cloud (외부 SRV)
- Redis: 캐싱/세션 (포트 6379)
- Kafka (KRaft): 메시지 브로커
- Elasticsearch + Kibana: 검색/로그
- MinIO: 오브젝트 스토리지
- Harbor: 컨테이너 레지스트리
- Workers: price_producer, news_producer, indexer_consumer, price_consumer

## 한눈에 보기

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GitLab CI/CD Pipeline                        │
│  SonarQube(품질) → Trivy(보안) → Cosign(서명) → Harbor(레지스트리)   │
└────────────────────────────┬────────────────────────────────────────┘
                             │ ArgoCD (GitOps, Kustomize)
┌────────────────────────────▼────────────────────────────────────────┐
│                   Kubernetes Cluster (kubeadm)                      │
│                                                                     │
│  ┌── Istio Service Mesh ──────────────────────────────────────┐    │
│  │  mTLS │ Canary/Blue-Green │ Circuit Breaker │ Gateway      │    │
│  │                                                            │    │
│  │  Frontend (Next.js)        Backend (FastAPI)               │    │
│  │  Blue-Green 배포            Canary 배포                     │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌── Data Layer ──────────────────────────────────────────────┐    │
│  │  MongoDB │ Redis+Sentinel │ Kafka(KRaft) │ Elasticsearch       │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌── Workers (Kafka Pipeline) ────────────────────────────────┐    │
│  │  Price Producer → Kafka → Price Consumer → Redis            │    │
│  │  News Producer  → Kafka → Indexer Consumer → Elasticsearch  │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌── Storage ─────────┐  ┌── Auto Scaling ──┐  ┌── Security ──┐  │
│  │  MinIO │ Harbor     │  │  KEDA (Pod)      │  │  Kyverno     │  │
│  └────────────────────┘  │  Karpenter (Node) │  │  (Admission) │  │
│                           └──────────────────┘  └──────────────┘  │
│                                                                     │
│  Calico (CNI) │ MetalLB (LB) │ Alloy (수집) │ CronJob (백업)      │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────────┐
│  Monitoring VM (별도 서버)          │  External DB                   │
│  Grafana │ Loki │ Tempo │ Mimir    │  MariaDB (회원/인증)            │
│  Kiali │ Kibana │ k6 │ InfluxDB   │  학원 온프레미스 서버            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 기술 스택 상세

### 클러스터 기반

| 기술 | 역할 | 선택 이유 |
|------|------|----------|
| **kubeadm** | K8s 클러스터 설치 | 공식 도구, 표준 환경, EKS 전환 용이 |
| **containerd** | 컨테이너 런타임 | K8s 표준, 경량 |
| **Calico** | CNI + NetworkPolicy | 네임스페이스 간 트래픽 격리 |
| **MetalLB** | Bare-Metal LoadBalancer | L2 모드, Istio Gateway IP 할당 |

### 서비스 메시 & 트래픽

| 기술 | 역할 | 선택 이유 |
|------|------|----------|
| **Istio** | 서비스 메시 | mTLS, 라우팅, Circuit Breaker |
| **Canary 배포** | Backend 점진적 전환 | Istio VirtualService weight 기반 |
| **Blue-Green 배포** | Frontend 즉시 전환 | Istio subset, 1초 이내 롤백 |

### 오토스케일링

| 기술 | 역할 | 선택 이유 |
|------|------|----------|
| **KEDA** | Pod 오토스케일링 | HPA 상위 호환, Kafka Lag 트리거, Scale-to-Zero |
| **Karpenter** | Node 오토스케일링 | CA 대비 3~5배 빠른 프로비저닝, Consolidation |

### CI/CD & 보안

| 기술 | 역할 | 선택 이유 |
|------|------|----------|
| **GitLab CI** | CI 파이프라인 | lint → test → scan → build → security → sign → deploy |
| **ArgoCD** | GitOps 배포 | Kustomize 기반, 자동 Sync / 수동 Sync |
| **SonarQube** | 코드 품질 | Quality Gate (커버리지, 버그, 취약점) |
| **Trivy** | 컨테이너 취약점 스캔 | CRITICAL/HIGH 발견 시 파이프라인 중단 |
| **Cosign** | 이미지 서명 | 빌드 무결성 보장, Harbor에 서명 저장 |
| **Kyverno** | K8s Admission 정책 | 미서명 이미지 배포 차단 |
| **Harbor** | 컨테이너 레지스트리 | 프라이빗 이미지 저장, 내장 Trivy 스캔 |

### 데이터 레이어

| 기술 | 역할 | 선택 이유 |
|------|------|----------|
| **MongoDB** | 자산/포트폴리오/AI 결과 | 유연한 스키마, 문서 기반 |
| **MariaDB** | 회원/인증 (외부 서버) | ACID, 관계형 무결성, 학원 인프라 활용 |
| **Redis + Sentinel** | 캐시, 세션, Rate Limiting | TTL 기반 캐싱, HA 구성 |
| **Kafka (KRaft 모드)** | 이벤트 스트리밍 | Zookeeper 제거, Kafka 자체 합의 프로토콜 |
| **Elasticsearch** | 뉴스 검색 인덱싱 | 전문 검색, 형태소 분석 |
| **MinIO** | S3 호환 오브젝트 스토리지 | 백업 저장, 파일 업로드 |

### 모니터링 & 테스트

| 기술 | 역할 | 선택 이유 |
|------|------|----------|
| **Grafana** | 대시보드 | 메트릭/로그/트레이스 통합 시각화 |
| **Loki** | 로그 수집 | Grafana 네이티브, 경량 |
| **Tempo** | 분산 트레이싱 | Grafana 네이티브, OpenTelemetry |
| **Mimir** | 메트릭 저장 | Prometheus 호환, 장기 보관 |
| **Grafana Alloy** | K8s 내 수집기 (DaemonSet) | Promtail + OTel Collector 통합 |
| **Kiali** | Istio 서비스 맵 | 트래픽 흐름 시각화 |
| **k6** | 부하 테스트 | ngrinder 대비 경량, Grafana 네이티브 연동 |
| **InfluxDB** | k6 결과 저장 | 시계열 DB, k6 공식 지원 |

### AI

| 기술 | 역할 | 선택 이유 |
|------|------|----------|
| **AWS Bedrock (Claude)** | AI 챗봇 | 자산 분석, 투자 조언 |

### 백업 & DR

| 기술 | 역할 | 선택 이유 |
|------|------|----------|
| **CronJob** | 자동 백업 스케줄링 | MongoDB, MariaDB, etcd 매일 백업 |
| **MinIO** | 백업 저장소 | S3 호환, 30일 보관 |
| **ArgoCD 매니페스트 Git** | 클러스터 복구 | GitOps 기반 무손실 재구축 |
