# CloudDX Kubernetes 마이그레이션 계획서

> 작성일: 2026-02-10
> 현재 상태: Docker Compose 기반 3-Node VM 운영
> 목표 상태: Kubernetes 클러스터 + Istio + LGTM + GitOps + KEDA

> **적용 기준(요약):** 본 문서는 Harbor를 필수 구성요소로 두지 않고, SonarQube는 모니터링 VM에서, 레지스트리는 GitLab Container Registry를 기본으로 적용합니다. Harbor 관련 항목은 과거 레거시/옵션으로 처리하세요.

---

## 1. 현재 아키텍처 (AS-IS)

```
┌─────────────────────────────────────────────────────────────┐
│                    VirtualBox 3-Node 구성                     │
│                                                             │
│  Node1 (4GB/2Core)    Node2 (4GB/2Core)   Node3 (8GB/3Core) │
│  ┌─────────────┐     ┌──────────────┐    ┌──────────────┐  │
│  │ Nginx       │     │ Redis        │    │ Elasticsearch│  │
│  │ Frontend    │     │ MinIO        │    │ Kafka        │  │
│  │ Backend     │     │              │    │ Workers      │  │
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
- Workers: price_producer, news_producer, indexer_consumer, price_consumer

---

## 2. MSA 아키텍처 패턴 선택

### 2.1 후보 패턴 비교

| 패턴                           | 통신 방식              | 데이터 일관성 | 복잡도    | CloudDX 적합도 |
| ------------------------------ | ---------------------- | ------------- | --------- | -------------- |
| **API Gateway + BFF**          | 동기 (REST/gRPC)       | 강한 일관성   | 낮음      | 부분 적합      |
| **Choreography (이벤트 기반)** | 비동기 (이벤트 브로커) | 최종 일관성   | 중간      | **적합**       |
| **Orchestration (Saga)**       | 동기+비동기 혼합       | 보상 트랜잭션 | 높음      | 과도           |
| **CQRS + Event Sourcing**      | 명령/조회 분리         | 이벤트 소싱   | 매우 높음 | 과도           |

### 2.2 선택: Choreography 기반 이벤트 드리븐 MSA

```
┌─────────────────────────────────────────────────────────────────┐
│             Choreography Event-Driven MSA                        │
│                                                                 │
│  ┌──────────┐    REST/SSE     ┌──────────┐                     │
│  │ Frontend │ ◄─────────────▶ │ Backend  │                     │
│  │ (Next.js)│                 │ (FastAPI) │                     │
│  └──────────┘                 └─────┬────┘                     │
│                                     │                           │
│                                     │ Produce / Consume         │
│                                     ▼                           │
│                            ┌────────────────┐                   │
│                            │     Kafka      │                   │
│                            │  (Event Bus)   │                   │
│                            └───┬────┬───┬───┘                   │
│                                │    │   │                       │
│                    ┌───────────┘    │   └───────────┐           │
│                    ▼                ▼               ▼           │
│             ┌────────────┐  ┌────────────┐  ┌────────────┐     │
│             │   Price    │  │    News    │  │  Indexer   │     │
│             │  Consumer  │  │  Producer  │  │  Consumer  │     │
│             │ → Redis    │  │ → Kafka    │  │ → ES       │     │
│             └────────────┘  └────────────┘  └────────────┘     │
│                                                                 │
│  각 서비스는 독립적으로 이벤트를 발행/구독하며                       │
│  중앙 오케스트레이터 없이 자율적으로 동작                            │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 선택 근거

**1. 기존 아키텍처와의 정합성**

- Kafka가 이미 메시지 브로커로 도입되어 있음
- Workers(price_producer, news_producer, indexer_consumer, price_consumer)가 이미 이벤트 기반으로 동작
- 추가 인프라 없이 현재 구조를 자연스럽게 MSA로 확장 가능

**2. 서비스 간 결합도**

- Orchestration(Saga)는 중앙 조율자가 필요 → 단일 장애점(SPOF)
- Choreography는 각 서비스가 자율적으로 이벤트를 발행/구독 → 느슨한 결합
- CloudDX의 데이터 흐름(시세 수집 → 캐싱 → 조회)은 단방향 파이프라인이므로 보상 트랜잭션이 불필요

**3. 복잡도 대비 효과**

- CQRS + Event Sourcing은 이벤트 저장소, 프로젝션 재구축 등 운영 복잡도가 매우 높음
- CloudDX 규모(서비스 5~7개)에서는 과도한 엔지니어링
- Choreography는 Kafka 토픽 설계만으로 충분한 이벤트 흐름 관리 가능

**4. 확장성**

- 새로운 Consumer 추가 시 기존 서비스 수정 불필요 (토픽 구독만 추가)
- KEDA와 연동하여 이벤트 볼륨에 따라 Consumer를 자동 스케일링
- 향후 AWS 마이그레이션 시 MSK(Managed Kafka)로 자연스럽게 전환 가능

### 2.4 서비스 분리 단위

| 서비스           | 역할                        | 통신 방식        | 데이터 저장소         |
| ---------------- | --------------------------- | ---------------- | --------------------- |
| Frontend         | UI 렌더링, BFF 역할         | REST → Backend   | -                     |
| Backend (API)    | 인증, 자산 CRUD, 시세 조회  | REST + SSE(채팅) | MongoDB, Redis        |
| Price Producer   | 외부 시세 수집 → Kafka 발행 | Kafka Produce    | 외부 API (KIS, Upbit) |
| Price Consumer   | Kafka 시세 → Redis 캐싱     | Kafka Consume    | Redis                 |
| News Producer    | 뉴스 수집 → Kafka 발행      | Kafka Produce    | 외부 API              |
| Indexer Consumer | Kafka 뉴스 → ES 인덱싱      | Kafka Consume    | Elasticsearch         |
| Chat Service     | AI 채팅 (Bedrock)           | SSE Stream       | Bedrock, ES(RAG)      |

### 2.5 Kafka 토픽 설계

| 토픽     | Producer       | Consumer              | 파티션 | 용도           |
| -------- | -------------- | --------------------- | ------ | -------------- |
| `prices` | price_producer | price_consumer        | 3      | 실시간 시세    |
| `news`   | news_producer  | indexer_consumer      | 3      | 뉴스 데이터    |
| `alerts` | backend        | (향후) notification   | 1      | 가격 알림      |
| `audit`  | backend        | (향후) audit_consumer | 1      | 거래 감사 로그 |

---

## 3. 목표 아키텍처 (TO-BE)

```
                         ┌──────────────────────────────────┐
                         │         GitLab CI/CD              │
                         │  ┌─────────┐ ┌────────┐ ┌────────────────┐│
                         │  │SonarQube│ │ Trivy  │ │GitLab Registry ││
                         │  │(품질)   │ │(보안)  │ │(이미지 저장소)   │
                         │  └────┬────┘ └───┬────┘ └──────┬───────┘│
                         │       └──────────┼────────────────┘    │
                         └──────────────────┼──────────────┘
                                            │ Cosign 서명
                         ┌──────────────────▼──────────────┐
                         │       ArgoCD (GitOps)            │
                         └──────────┬───────────────────────┘
                                    │ sync
  ┌─────────────────────────────────▼─────────────────────────────────────┐
  │                        Kubernetes Cluster                              │
  │                                                                        │
  │  ┌──────────────────────────────────────────────────────────────────┐  │
  │  │                    Istio Service Mesh (tutum-app)                 │  │
  │  │                                                                  │  │
  │  │  ┌──────────────────────────────────────────────────────────┐   │  │
  │  │  │              Istio Ingress Gateway (MetalLB)              │   │  │
  │  │  └──────────────┬────────────────────────┬──────────────────┘   │  │
  │  │                 │                        │                       │  │
  │  │     ┌───────────▼───┐        ┌───────────▼──────────┐           │  │
  │  │     │   Frontend    │        │      Backend         │           │  │
  │  │     │   (Next.js)   │        │     (FastAPI)        │           │  │
  │  │     │   x2 replicas │        │     x2 replicas      │           │  │
  │  │     └───────────────┘        └──┬─────┬─────┬───────┘           │  │
  │  │                                 │     │     │                    │  │
  │  └─────────────────────────────────┼─────┼─────┼────────────────────┘  │
  │                                    │     │     │                        │
  │  ┌─── tutum-data ─────────────────────────────────────────────────┐   │
  │  │                                 │     │     │                   │   │
  │  │     ┌──────────┐  ┌────────────▼┐   │   ┌─▼────────────┐     │   │
  │  │     │ MongoDB  │  │    Redis    │   │   │Elasticsearch │     │   │
  │  │     │  ┌─────┐ │  │ +Sentinel  │   │   └──────▲───────┘     │   │
  │  │     │  │Maria│ │  └────────────┘   │          │              │   │
  │  │     │  │ DB  │ │                   │          │              │   │
  │  │     │  │(외부)│ │    ┌─────────────▼─┐        │              │   │
  │  │     │  └─────┘ │    │     Kafka      │        │              │   │
  │  │     └──────────┘    │  (bootstrap)   │        │              │   │
  │  │                     └──┬──────────┬──┘        │              │   │
  │  │                        │          │           │              │   │
  │  └────────────────────────┼──────────┼───────────┼──────────────┘   │
  │                           │          │           │                   │
  │  ┌─── Kafka Data Pipeline (tutum-app Workers) ──────────────────┐   │
  │  │                        │          │           │               │   │
  │  │   ┌────────────────────▼──┐  ┌────▼───────────▼──────────┐   │   │
  │  │   │   Producers (KEDA)    │  │   Consumers (KEDA)         │   │   │
  │  │   │                       │  │                            │   │   │
  │  │   │  ┌─────────────────┐  │  │  ┌──────────────────────┐ │   │   │
  │  │   │  │ Price Producer  │──┼──┼─▶│ Price Consumer       │ │   │   │
  │  │   │  │ (KIS/Upbit API) │  │  │  │ Kafka→Redis 캐싱     │ │   │   │
  │  │   │  └─────────────────┘  │  │  └──────────────────────┘ │   │   │
  │  │   │  ┌─────────────────┐  │  │  ┌──────────────────────┐ │   │   │
  │  │   │  │ News Producer   │──┼──┼─▶│ Indexer Consumer     │ │   │   │
  │  │   │  │ (뉴스 수집 API) │  │  │  │ Kafka→Elasticsearch  │ │   │   │
  │  │   │  └─────────────────┘  │  │  └──────────────────────┘ │   │   │
  │  │   └───────────────────────┘  └────────────────────────────┘   │   │
  │  │                                                               │   │
  │  │   트리거: Kafka Lag / CPU    스케일: 0 ↔ 3 (Scale-to-Zero)     │   │
  │  └───────────────────────────────────────────────────────────────┘   │
  │                                                                      │
  │  ┌─── tutum-storage ──────┐       ┌─── Auto Scaling ────────────┐   │
  │  │  ┌──────┐              │       │  ┌──────┐   ┌───────────┐  │   │
  │  │  │MinIO │              │       │  │ KEDA │   │ Karpenter │  │   │
  │  │  │(S3)  │              │       │  │(Pod) │   │  (Node)   │  │   │
  │  │  └──────┘              │       │  └──────┘   └───────────┘  │   │
  │  └────────────────────────┘       └────────────────────────────┘   │
  │                                                                      │
  │  ┌─── Kyverno (Admission) ──┐  ┌─── Alloy (DaemonSet) ──────────┐  │
  │  │  Cosign 서명 검증 정책     │  │  메트릭/로그/트레이스 수집       │  │
  │  │  미서명 이미지 배포 차단    │  │  → 외부 Monitoring VM 전송      │  │
  │  └────────────────────────────┘  └──────────┬─────────────────────┘  │
  └──────────────────────────────────────────────┼───────────────────────┘
                                                 │ Alloy → 원격 전송
  ┌──────────────────────────────────────────────▼───────────────────────┐
  │               Monitoring VM (별도 서버, K8s 외부)                      │
  │                                                                      │
  │  ┌────────┐ ┌────────┐ ┌───────┐ ┌───────┐ ┌──────────┐            │
  │  │ Loki   │ │Grafana │ │ Tempo │ │ Mimir │ │InfluxDB  │            │
  │  │ (Logs) │ │(Dash)  │ │(Trace)│ │(Metr.)│ │(k6 결과) │            │
  │  └────────┘ └────────┘ └───────┘ └───────┘ └──────────┘            │
  │                                                                      │
  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                             │
  │  │  Kiali   │ │  Kibana  │ │    k6    │                             │
  │  │(Istio UI)│ │ (ES UI)  │ │(부하테스트)│                             │
  │  └──────────┘ └──────────┘ └──────────┘                             │
  │                                                                      │
  │  Docker Compose 운영 (K8s 클러스터에 부하 없음)                       │
  │  스펙: 4Core / 16GB / 200GB SSD                                      │
  └──────────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────────┐
  │              CI/CD: 외부 SaaS + SonarQube(모니터링 VM)              │
  │                                                                      │
  │  ┌──────────────┐  ┌─────────────┐  ┌─────────────────────────────┐ │
  │  │ gitlab.com   │  │ SonarQube   │  │ GitLab Container Registry   │ │
  │  │ (소스/CI/CD) │  │(코드 분석)   │  │ (registry.gitlab.com)       │ │
  │  └──────────────┘  └─────────────┘  └─────────────────────────────┘ │
  │                                                                      │
  │  GitLab Runner: K8s 클러스터 내 Helm chart (gitlab-runner ns)        │
  └──────────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────────┐
  │              External: 학원 MariaDB 서버 (온프레미스)                  │
  │                                                                      │
  │  ┌──────────────────────────┐                                        │
  │  │  MariaDB                 │  ◄── Backend가 IP:Port로 접속          │
  │  │  회원정보 / 인증 데이터    │      SQLAlchemy 드라이버 사용           │
  │  └──────────────────────────┘                                        │
  └──────────────────────────────────────────────────────────────────────┘
```

### 3.1 Kafka 데이터 파이프라인 상세

```
┌─────────────────────────────────────────────────────────────────┐
│                    실시간 데이터 파이프라인                        │
│                                                                 │
│   ┌─── Producers (외부 API → Kafka) ────────────────────────┐   │
│   │                                                         │   │
│   │   Price Producer          News Producer                 │   │
│   │   ┌─────────────┐        ┌─────────────┐               │   │
│   │   │ KIS API     │        │ 뉴스 API    │               │   │
│   │   │ (국내주식)   │        │ (경제뉴스)   │               │   │
│   │   │ Upbit API   │        │             │               │   │
│   │   │ (암호화폐)   │        │             │               │   │
│   │   └──────┬──────┘        └──────┬──────┘               │   │
│   │          │ 10초 간격             │ 5분 간격              │   │
│   │          ▼                      ▼                       │   │
│   │   ┌────────────┐        ┌────────────┐                 │   │
│   │   │Topic:prices│        │Topic: news │                 │   │
│   │   └──────┬─────┘        └──────┬─────┘                 │   │
│   └──────────┼─────────────────────┼────────────────────────┘   │
│              │                     │                             │
│   ┌──────────┼─────────────────────┼────────────────────────┐   │
│   │          ▼                     ▼                         │   │
│   │   Price Consumer         Indexer Consumer                │   │
│   │   ┌─────────────┐       ┌─────────────┐                │   │
│   │   │ Kafka 메시지 │       │ Kafka 메시지 │                │   │
│   │   │ → Redis 캐싱 │       │ → ES 인덱싱  │                │   │
│   │   │ (TTL: 30초)  │       │ (검색 가능)  │                │   │
│   │   └──────┬──────┘       └──────┬──────┘                │   │
│   │          │                     │                         │   │
│   │   Consumers (Kafka → 저장소)                             │   │
│   └──────────┼─────────────────────┼────────────────────────┘   │
│              ▼                     ▼                             │
│   ┌──────────────┐       ┌───────────────┐                     │
│   │    Redis     │       │ Elasticsearch │                     │
│   │ price:{code} │       │ news-{date}   │                     │
│   │ TTL: 30초    │       │ 검색 인덱스    │                     │
│   └──────────────┘       └───────────────┘                     │
│                                                                 │
│   KEDA 스케일링:                                                 │
│   - Producers: CPU 70% 기반 (min:1, max:3)                      │
│   - Consumers: Kafka Lag 기반 (min:0, max:3, Scale-to-Zero)     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Kubernetes 네임스페이스 설계

| 네임스페이스    | 용도                     | 포함 리소스                                     |
| --------------- | ------------------------ | ----------------------------------------------- |
| `tutum-app`     | 어플리케이션 핵심        | Frontend, Backend, Workers                      |
| `tutum-data`    | 데이터 레이어            | MongoDB, Redis, Kafka (KRaft), Elasticsearch |
| `tutum-storage` | 오브젝트 스토리지        | MinIO                                            |
| `istio-system`  | 서비스 메시              | Istio 컨트롤 플레인                             |
| `monitoring`    | 수집 에이전트 전용       | Grafana Alloy (DaemonSet만)                     |
| `keda`          | 이벤트 기반 오토스케일링 | KEDA Operator, Metrics Server                   |
| `karpenter`     | 노드 오토스케일링        | Karpenter Controller                            |
| `argocd`        | GitOps                   | ArgoCD 컨트롤러                                 |
| `kyverno`       | 보안 정책                | Kyverno Admission Controller                    |

> **Note:** LGTM 백엔드(Loki, Grafana, Tempo, Mimir), Kiali, Kibana, InfluxDB, k6는 **별도 Monitoring VM**에서 Docker Compose로 운영합니다. 모니터링 도구는 리소스 사용량이 크므로 K8s 클러스터에 부하를 주지 않기 위해 분리합니다. K8s 내부에는 수집기(Alloy DaemonSet)만 배치합니다.

> **외부 DB:** 회원정보/인증 데이터는 학원 온프레미스 **MariaDB 서버**에 저장합니다 (K8s 외부, IP:Port 접속). 자산/포트폴리오/AI 분석 등 비정형 데이터는 MongoDB에 저장합니다.

> **CI/CD 인프라:** gitlab.com (SaaS) + SonarQube (sonarqube.tutum.local:9000) + GitLab Container Registry를 사용합니다. 자체 CI/CD VM은 SonarQube 실행에 필요한 최소 인프라만 사용합니다. GitLab Runner는 K8s 클러스터 내에 Helm chart로 설치합니다.

---

## 5. Kubernetes 리소스 매핑

### 5.1 Deployment (Stateless 서비스)

| 서비스                   | 리소스 타입       | Replicas | CPU Request | Memory Request | CPU Limit | Memory Limit |
| ------------------------ | ----------------- | -------- | ----------- | -------------- | --------- | ------------ |
| Frontend                 | Deployment        | 2        | 200m        | 256Mi          | 500m      | 512Mi        |
| Backend                  | Deployment        | 2        | 300m        | 512Mi          | 1000m     | 1Gi          |
| Workers (price)          | Deployment + KEDA | 0~3      | 100m        | 128Mi          | 300m      | 256Mi        |
| Workers (news)           | Deployment + KEDA | 0~3      | 100m        | 128Mi          | 300m      | 256Mi        |
| Workers (indexer)        | Deployment + KEDA | 0~3      | 100m        | 128Mi          | 300m      | 256Mi        |
| Workers (price_consumer) | Deployment + KEDA | 0~3      | 100m        | 128Mi          | 300m      | 256Mi        |

### 5.2 StatefulSet (Stateful 서비스)

| 서비스         | 리소스 타입 | Replicas              | Storage | CPU Req/Lim | Memory Req/Lim |
| -------------- | ----------- | --------------------- | ------- | ----------- | -------------- |
| MongoDB        | StatefulSet | 1 (추후 ReplicaSet 3) | 30Gi    | 500m / 1    | 1Gi / 2Gi      |
| Redis          | StatefulSet | 1 (추후 Sentinel 3)   | 5Gi     | 200m / 500m | 256Mi / 512Mi  |
| Redis Sentinel | StatefulSet | 3                     | -       | 50m / 200m  | 128Mi / 256Mi  |
| Kafka          | StatefulSet | 1 (추후 3)            | 20Gi    | 500m / 1    | 1Gi / 2Gi      |
| Elasticsearch  | StatefulSet | 1 (추후 3)            | 30Gi    | 500m / 2    | 2Gi / 4Gi      |
| MinIO          | StatefulSet | 1                     | 20Gi    | 200m / 500m | 512Mi / 1Gi    |

### 5.3 Service 매핑

| 서비스                                | Service 타입 | 포트      | 비고                                        |
| ------------------------------------- | ------------ | --------- | ------------------------------------------- |
| frontend-svc                          | ClusterIP    | 80 → 3000 | Istio Gateway 통해 외부 노출                |
| backend-svc                           | ClusterIP    | 8000      | Istio Gateway 통해 외부 노출                |
| mongodb-svc                           | ClusterIP    | 27017     | 클러스터 내부만                             |
| mongodb-headless                      | Headless     | 27017     | StatefulSet DNS 용                          |
| redis-svc                             | ClusterIP    | 6379      | 클러스터 내부만                             |
| redis-sentinel-svc                    | ClusterIP    | 26379     | Sentinel Discovery                          |
| kafka-bootstrap                       | ClusterIP    | 9092      | 클라이언트 접속용                           |
| kafka-headless                        | Headless     | 9092      | StatefulSet DNS 용                          |
| elasticsearch-svc                     | ClusterIP    | 9200      | 클러스터 내부만                             |
| minio-api                             | ClusterIP    | 9000      | S3 API 엔드포인트                           |
| minio-console                         | ClusterIP    | 9001      | 관리 콘솔 (선택적 노출)                     |
| GitLab Container Registry (외부 SaaS) | -            | 443       | registry.gitlab.com (imagePullSecrets 필요) |
| istio-ingressgateway                  | LoadBalancer | 80/443    | MetalLB 통해 외부 트래픽 수신               |
| Kibana                                | -            | 5601      | Monitoring VM (Docker Compose)              |
| Grafana                               | -            | 3000      | Monitoring VM (Docker Compose)              |

---

## 6. Istio 서비스 메시

### 6.1 Istio 구성 요소

```
┌─────────────────────────────────────────────┐
│              Istio Control Plane             │
│                                             │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  │
│  │  istiod  │  │ Gateway  │  │  Kiali    │  │
│  │(Pilot+   │  │Controller│  │(Dashboard)│  │
│  │ Citadel) │  │          │  │           │  │
│  └─────────┘  └──────────┘  └───────────┘  │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│              Istio Data Plane               │
│                                             │
│  모든 Pod에 Envoy Sidecar 자동 주입          │
│                                             │
│  [Frontend Pod]      [Backend Pod]          │
│  ┌──────┬────────┐  ┌──────┬────────┐      │
│  │ App  │ Envoy  │  │ App  │ Envoy  │      │
│  │      │Sidecar │  │      │Sidecar │      │
│  └──────┴────────┘  └──────┴────────┘      │
└─────────────────────────────────────────────┘
```

### 6.2 Istio Gateway 설정

```yaml
# Istio Gateway - 외부 트래픽 진입
apiVersion: networking.istio.io/v1beta1
kind: Gateway
metadata:
  name: tutum-gateway
  namespace: tutum-app
spec:
  selector:
    istio: ingressgateway
  servers:
    - port:
        number: 443
        name: https
        protocol: HTTPS
      tls:
        mode: SIMPLE
        credentialName: tutum-tls-cert
      hosts:
        - "tutum.example.com"
        - "api.tutum.example.com"
    - port:
        number: 80
        name: http
        protocol: HTTP
      hosts:
        - "tutum.example.com"
      tls:
        httpsRedirect: true
```

### 6.3 VirtualService 라우팅

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: tutum-routing
  namespace: tutum-app
spec:
  hosts:
    - "tutum.example.com"
  gateways:
    - tutum-gateway
  http:
    # Backend API 라우팅
    - match:
        - uri:
            prefix: /api/
      route:
        - destination:
            host: backend-svc
            port:
              number: 8000
      retries:
        attempts: 3
        retryOn: 5xx
      timeout: 30s

    # Frontend 라우팅 (기본)
    - route:
        - destination:
            host: frontend-svc
            port:
              number: 3000
```

### 6.4 Istio 트래픽 정책

```yaml
# mTLS 강제 적용
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: tutum-app
spec:
  mtls:
    mode: STRICT

---
# Circuit Breaker (Backend)
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: backend-circuit-breaker
  namespace: tutum-app
spec:
  host: backend-svc
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        h2UpgradePolicy: DEFAULT
        http1MaxPendingRequests: 50
        http2MaxRequests: 100
    outlierDetection:
      consecutive5xxErrors: 5
      interval: 30s
      baseEjectionTime: 60s
      maxEjectionPercent: 50
```

### 6.5 Istio 사이드카 제외 대상

데이터 레이어 네임스페이스는 사이드카 오버헤드를 줄이기 위해 선택적으로 적용합니다.

```yaml
# tutum-data 네임스페이스에는 사이드카 비활성화
apiVersion: v1
kind: Namespace
metadata:
  name: tutum-data
  labels:
    istio-injection: disabled
```

---

## 7. NetworkPolicy (네임스페이스 격리)

Istio mTLS와 별개로 Kubernetes NetworkPolicy를 적용하여 네임스페이스 간 통신을 L3/L4 수준에서 제한합니다.

### 7.1 정책 개요

```
┌─────────────────────────────────────────────────────────────┐
│                 NetworkPolicy 통신 매트릭스                    │
│                                                             │
│                tutum-app   tutum-data   monitoring   외부   │
│  tutum-app     ✅ 허용    ✅ 허용         ✅ 허용     ❌    │
│  tutum-data  ❌ 차단    ✅ 허용         ✅ 허용     ❌    │
│  monitoring    ✅ 허용    ✅ 허용         ✅ 허용     ❌    │
│  외부(Ingress) ✅ GW만    ❌ 차단         ❌ 차단     -     │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 기본 정책: Deny All (네임스페이스별)

```yaml
# tutum-data 네임스페이스 - 기본 모든 인그레스 차단
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: tutum-data
spec:
  podSelector: {}
  policyTypes:
    - Ingress
```

### 7.3 허용 정책: 앱 → 데이터 레이어

```yaml
# tutum-app 네임스페이스의 Pod만 Redis/Kafka/ES 접근 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-app-to-data
  namespace: tutum-data
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    # tutum-app 앱에서의 접근 허용
    - from:
        - namespaceSelector:
            matchLabels:
              name: tutum-app
      ports:
        - port: 6379 # Redis
          protocol: TCP
        - port: 9092 # Kafka
          protocol: TCP
        - port: 9200 # Elasticsearch
          protocol: TCP
    # monitoring (Alloy) 에서의 메트릭 수집 허용
    - from:
        - namespaceSelector:
            matchLabels:
              name: monitoring
```

### 7.4 허용 정책: Alloy → 전체 스크래핑

```yaml
# Alloy DaemonSet이 모든 네임스페이스의 메트릭 수집 가능
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-alloy-scrape
  namespace: tutum-app
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: monitoring
        - podSelector:
            matchLabels:
              app: alloy
```

### 7.5 허용 정책: Istio Ingress → Frontend/Backend만

```yaml
# 외부에서는 Istio Gateway를 통해 Frontend/Backend만 접근 가능
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress-to-app
  namespace: tutum-app
spec:
  podSelector:
    matchExpressions:
      - key: app
        operator: In
        values: ["frontend", "backend"]
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: istio-system
```

---

## 8. LGTM 옵저버빌리티 스택 (Grafana Alloy)

### 8.1 LGTM 아키텍처 (별도 VM 분리)

모니터링 도구(Loki, Grafana, Tempo, Mimir)는 리소스 사용량이 크므로 K8s 클러스터 내부가 아닌 **별도 Monitoring VM**에서 Docker Compose로 운영합니다.

```
┌────────────────────────────────┐    ┌────────────────────────────────────┐
│    Kubernetes Cluster          │    │      Monitoring VM (별도 서버)       │
│                                │    │                                    │
│  ┌──────────────────────────┐  │    │  ┌─────────────┐                  │
│  │  Grafana Alloy           │  │    │  │   Grafana   │ ◄── 대시보드     │
│  │  (DaemonSet)             │──┼────┼─▶│  (Port 3000)│                  │
│  │                          │  │    │  └──────┬──────┘                  │
│  │  모든 K8s 노드에서 수집   │  │    │         │ 쿼리                     │
│  │  - 컨테이너 로그          │  │    │  ┌──────┼──────┐                  │
│  │  - Pod 메트릭             │  │    │  │      │      │                  │
│  │  - Istio Envoy 트레이스   │  │    │  ▼      ▼      ▼                  │
│  └──────────────────────────┘  │    │ ┌────┐┌─────┐┌─────┐             │
│                                │    │ │Loki││Tempo││Mimir│             │
│                                │    │ │Log ││Trace││Metr.│             │
│                                │    │ └────┘└─────┘└─────┘             │
│                                │    │                                    │
│                                │    │  ┌──────────┐ ┌──────────┐        │
│                                │    │  │  Kiali   │ │  Kibana  │        │
│                                │    │  │(Istio UI)│ │ (ES UI)  │        │
│                                │    │  └──────────┘ └──────────┘        │
│                                │    │                                    │
│                                │    │  운영: Docker Compose              │
│                                │    │  스펙: 4Core / 16GB+ / 200GB SSD  │
└────────────────────────────────┘    └────────────────────────────────────┘
```

### 8.2 별도 VM 분리 근거

모니터링 도구를 K8s 클러스터 내부가 아닌 **별도 VM**에 배치한 이유:

| 관점            | K8s 내부 배치                                                 | 별도 VM 분리 (채택)                              |
| --------------- | ------------------------------------------------------------- | ------------------------------------------------ |
| **장애 독립성** | K8s 클러스터 다운 시 모니터링도 중단 → 장애 원인 분석 불가    | K8s 다운 시에도 직전까지의 로그/메트릭 조회 가능 |
| **리소스 경합** | Loki+Mimir+Tempo가 앱 워크로드와 CPU/Memory 경쟁              | 앱 성능에 영향 없음                              |
| **리소스 비중** | 3~4노드 소규모 클러스터에서 모니터링이 전체의 **20~30%** 점유 | 0% (Alloy DaemonSet만 경량 수집, 노드당 ~128Mi)  |
| **디스크 I/O**  | 로그/메트릭 저장이 앱 스토리지와 I/O 경쟁                     | 별도 200GB SSD 사용                              |
| **유지보수**    | K8s 업그레이드 시 모니터링도 영향                             | 독립적 업데이트 가능                             |
| **AWS 전환**    | -                                                             | AWS 마이그레이션 시 별도 VPC로 자연스럽게 전환   |

> **결론:** 온프레미스 4노드 클러스터에서 LGTM 풀스택을 내부에 배치하면 실질적으로 Worker 1개 분량(4Core/8GB)의 리소스를 소모합니다. AWS에서 모니터링 VPC를 분리하는 것과 동일한 논리를 온프레미스에서도 적용하여, K8s 내부에는 수집기(Alloy)만 두고 백엔드는 외부 VM에서 운영합니다.

### 8.3 Grafana Alloy 구성 (K8s 내부 DaemonSet)

Alloy는 기존의 Promtail + OTel Collector + Prometheus Agent를 하나로 통합한 수집기입니다.

```hcl
// alloy-config.alloy - Grafana Alloy 설정

// ============================================
// 1. Metrics 수집 (Mimir로 전송)
// ============================================

// Kubernetes Pod Metrics 스크래핑
prometheus.scrape "k8s_pods" {
  targets    = discovery.kubernetes.pods.targets
  forward_to = [prometheus.remote_write.mimir.receiver]

  scrape_interval = "30s"
}

// Istio Envoy Metrics
prometheus.scrape "istio_envoy" {
  targets = discovery.kubernetes.pods.targets
  metrics_path = "/stats/prometheus"
  forward_to   = [prometheus.remote_write.mimir.receiver]

  scrape_interval = "15s"
}

// Node Exporter Metrics
prometheus.scrape "node_exporter" {
  targets    = discovery.kubernetes.nodes.targets
  forward_to = [prometheus.remote_write.mimir.receiver]
}

prometheus.remote_write "mimir" {
  endpoint {
    url = "http://<MONITORING_VM_IP>:9009/api/v1/push"
  }
}

// ============================================
// 2. Logs 수집 (Loki로 전송)
// ============================================

// 컨테이너 로그 수집
loki.source.kubernetes "k8s_logs" {
  targets    = discovery.kubernetes.pods.targets
  forward_to = [loki.write.default.receiver]
}

loki.write "default" {
  endpoint {
    url = "http://<MONITORING_VM_IP>:3100/loki/api/v1/push"
  }
}

// ============================================
// 3. Traces 수집 (Tempo로 전송)
// ============================================

// OTLP gRPC 수신 (앱에서 보내는 트레이스)
otelcol.receiver.otlp "default" {
  grpc {
    endpoint = "0.0.0.0:4317"
  }
  http {
    endpoint = "0.0.0.0:4318"
  }

  output {
    traces = [otelcol.exporter.otlp.tempo.input]
  }
}

otelcol.exporter.otlp "tempo" {
  client {
    endpoint = "<MONITORING_VM_IP>:4317"
    tls {
      insecure = true
    }
  }
}
```

### 8.3 Monitoring VM Docker Compose 배포

**Monitoring VM (Docker Compose):**

```yaml
# monitoring-vm/docker-compose.yml
services:
  loki:
    image: grafana/loki:3.0.0
    ports:
      - "3100:3100"
    volumes:
      - loki_data:/loki
      - ./loki-config.yml:/etc/loki/config.yml
    command: -config.file=/etc/loki/config.yml

  tempo:
    image: grafana/tempo:2.4.0
    ports:
      - "4317:4317" # OTLP gRPC
      - "4318:4318" # OTLP HTTP
      - "3200:3200" # Tempo API
    volumes:
      - tempo_data:/var/tempo
      - ./tempo-config.yml:/etc/tempo/config.yml

  mimir:
    image: grafana/mimir:2.12.0
    ports:
      - "9009:9009"
    volumes:
      - mimir_data:/data
      - ./mimir-config.yml:/etc/mimir/config.yml
    command: -config.file=/etc/mimir/config.yml

  grafana:
    image: grafana/grafana:11.0.0
    ports:
      - "3000:3000"
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana/provisioning:/etc/grafana/provisioning
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD}
      - GF_USERS_ALLOW_SIGN_UP=false

  kiali:
    image: quay.io/kiali/kiali:v1.82
    ports:
      - "20001:20001"
    environment:
      - KUBERNETES_SERVICE_HOST=<K8S_API_SERVER_IP>
      - KUBERNETES_SERVICE_PORT=6443

  kibana:
    image: docker.elastic.co/kibana/kibana:8.11.0
    ports:
      - "5601:5601"
    environment:
      - ELASTICSEARCH_HOSTS=http://<K8S_ES_NODEPORT_IP>:9200

volumes:
  loki_data:
  tempo_data:
  mimir_data:
  grafana_data:
```

**K8s 클러스터 내 Alloy만 Helm 설치:**

```bash
# K8s 클러스터 안에는 수집기(Alloy)만 설치
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update

helm install alloy grafana/alloy \
  --namespace monitoring \
  --create-namespace \
  --set alloy.configMap.content="$(cat alloy-config.alloy)"
```

### 8.4 모니터링 대시보드 구성

| 대시보드         | 데이터소스    | 용도                             |
| ---------------- | ------------- | -------------------------------- |
| CloudDX Overview | Mimir         | 서비스 상태, 요청량, 에러율      |
| API Performance  | Mimir + Tempo | API 응답시간, P95/P99, 트레이스  |
| Kafka Monitoring | Mimir         | 토픽 Lag, Producer/Consumer 상태 |
| Redis Dashboard  | Mimir         | 히트율, 메모리, 커넥션           |
| Istio Mesh       | Mimir         | 메시 트래픽, mTLS 상태           |
| Log Explorer     | Loki          | 로그 검색, 에러 추적             |
| Trace Explorer   | Tempo         | 분산 트레이싱, 병목 분석         |

### 8.5 알림 규칙

```yaml
# Mimir Alerting Rules
groups:
  - name: tutum-alerts
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "높은 에러율 감지 ({{ $value }})"

      - alert: BackendDown
        expr: up{job="backend"} == 0
        for: 1m
        labels:
          severity: critical

      - alert: KafkaConsumerLag
        expr: kafka_consumer_group_lag > 1000
        for: 10m
        labels:
          severity: warning

      - alert: RedisMemoryHigh
        expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.8
        for: 5m
        labels:
          severity: warning

      - alert: HighLatency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
        for: 5m
        labels:
          severity: warning
```

---

## 9. GitLab CI/CD 파이프라인

### 9.1 파이프라인 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                     GitLab CI/CD Pipeline                        │
│                                                                 │
│  ┌──────┐ ┌────────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌─────┐│
│  │ Lint │▶│SonarQube│▶│ Test │▶│Build │▶│Trivy │▶│Cosign│▶│Push ││
│  │      │ │ Scan    │ │      │ │Image │ │ Scan │ │ Sign │ │Reg. ││
│  └──────┘ └────────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──┬──┘│
│                                                              │   │
└──────────────────────────────────────────────────────────────┼───┘
                                                          │
                                              Git Commit (tag)
                                                          │
                                                  ┌───────▼───────┐
                                                  │  K8s Manifests│
                                                  │  Git Repo     │
                                                  │ (image tag    │
                                                  │  업데이트)      │
                                                  └───────┬───────┘
                                                          │
                                                  ┌───────▼───────┐
                                                  │    ArgoCD     │
                                                  │  (Auto Sync)  │
                                                  └───────┬───────┘
                                                          │
                                                  ┌───────▼───────┐
                                                  │  Kubernetes   │
                                                  │  Cluster      │
                                                  └───────────────┘
```

### 9.2 `.gitlab-ci.yml`

> ⚠️ **운영 기준 반영:** 샘플의 `HARBOR_*` 값은 과거/옵션 항목입니다. 현재 기준은 **GitLab Container Registry** 중심이며, 빌드·스캔 단계에서는 `CI_REGISTRY_IMAGE`/`CI_REGISTRY`를 사용합니다.

```yaml
stages:
  - lint
  - test
  - scan        # SonarQube 품질 스캔
  - build
  - security    # Trivy 취약점 스캔
  - sign        # Cosign 이미지 서명
  - deploy

variables:
  CI_IMAGE_REPO: "$CI_REGISTRY_IMAGE"
  SONAR_HOST_URL: "http://sonarqube.tutum.local:9000"

# ============================================
# Stage 1: Lint
# ============================================
lint:backend:
  stage: lint
  image: python:3.11-slim
  script:
    - pip install ruff
    - cd backend && ruff check .
  rules:
    - changes:
        - backend/**/*

lint:frontend:
  stage: lint
  image: node:20-alpine
  script:
    - cd frontend && npm ci && npm run lint
  rules:
    - changes:
        - frontend/**/*

# ============================================
# Stage 2: Test
# ============================================
test:backend:
  stage: test
  image: python:3.11-slim
  services:
    - redis:7-alpine
    - mongo:7
  variables:
    REDIS_URL: "redis://redis:6379"
    MONGODB_URL: "mongodb://mongo:27017"
    MONGODB_DB_NAME: "tutum_test"
  script:
    - cd backend
    - pip install -r requirements.txt
    - pip install pytest pytest-asyncio httpx
    - pytest tests/ -v --junitxml=report.xml
  artifacts:
    reports:
      junit: backend/report.xml

test:frontend:
  stage: test
  image: node:20-alpine
  script:
    - cd frontend && npm ci && npm run test -- --ci
  rules:
    - changes:
        - frontend/**/*

# ============================================
# Stage 3: SonarQube Scan
# ============================================
sonarqube:backend:
  stage: scan
  image:
    name: sonarsource/sonar-scanner-cli:latest
    entrypoint: [""]
  variables:
    SONAR_USER_HOME: "${CI_PROJECT_DIR}/.sonar"
  script:
    - >
      sonar-scanner
      -Dsonar.projectKey=tutum-backend
      -Dsonar.sources=backend/app
      -Dsonar.host.url=$SONAR_HOST_URL
      -Dsonar.token=$SONAR_TOKEN
      -Dsonar.python.version=3.11
      -Dsonar.qualitygate.wait=true
  allow_failure: false

sonarqube:frontend:
  stage: scan
  image:
    name: sonarsource/sonar-scanner-cli:latest
    entrypoint: [""]
  script:
    - >
      sonar-scanner
      -Dsonar.projectKey=tutum-frontend
      -Dsonar.sources=frontend/app,frontend/components,frontend/lib
      -Dsonar.host.url=$SONAR_HOST_URL
      -Dsonar.token=$SONAR_TOKEN
      -Dsonar.qualitygate.wait=true
  allow_failure: false

# ============================================
# Stage 4: Build & Push Docker Images
# ============================================
.build_template: &build_template
  stage: build
  image: docker:24-dind
  services:
    - docker:24-dind
  before_script:
    - echo "$CI_REGISTRY_PASSWORD" | docker login $CI_REGISTRY -u "$CI_REGISTRY_USER" --password-stdin

build:backend:
  <<: *build_template
  script:
    - docker build -t $CI_IMAGE_REPO/backend:$CI_COMMIT_SHORT_SHA -f backend/Dockerfile.prod backend/
    - docker push $CI_IMAGE_REPO/backend:$CI_COMMIT_SHORT_SHA
    - docker tag $CI_IMAGE_REPO/backend:$CI_COMMIT_SHORT_SHA $CI_IMAGE_REPO/backend:latest
    - docker push $CI_IMAGE_REPO/backend:latest
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      changes:
        - backend/**/*

build:frontend:
  <<: *build_template
  script:
    - docker build -t $CI_IMAGE_REPO/frontend:$CI_COMMIT_SHORT_SHA -f frontend/Dockerfile.prod frontend/
    - docker push $CI_IMAGE_REPO/frontend:$CI_COMMIT_SHORT_SHA
    - docker tag $CI_IMAGE_REPO/frontend:$CI_COMMIT_SHORT_SHA $CI_IMAGE_REPO/frontend:latest
    - docker push $CI_IMAGE_REPO/frontend:latest
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      changes:
        - frontend/**/*

build:workers:
  <<: *build_template
  script:
    - docker build -t $CI_IMAGE_REPO/workers:$CI_COMMIT_SHORT_SHA -f backend/workers/Dockerfile.prod backend/workers/
    - docker push $CI_IMAGE_REPO/workers:$CI_COMMIT_SHORT_SHA
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      changes:
        - backend/workers/**/*

# ============================================
# Stage 5: Deploy (ArgoCD 매니페스트 업데이트)
# ============================================
deploy:staging:
  stage: deploy
  image: alpine:latest
  before_script:
    - apk add --no-cache git
  script:
    # K8s 매니페스트 레포에서 이미지 태그 업데이트
    - git clone https://$DEPLOY_TOKEN@gitlab.com/tutum-project/k8s-manifests.git
    - cd k8s-manifests/overlays/staging
    - |
      sed -i "s|image: .*backend:.*|image: $CI_IMAGE_REPO/backend:$CI_COMMIT_SHORT_SHA|g" backend-deployment.yaml
      sed -i "s|image: .*frontend:.*|image: $CI_IMAGE_REPO/frontend:$CI_COMMIT_SHORT_SHA|g" frontend-deployment.yaml
      sed -i "s|image: .*workers:.*|image: $CI_IMAGE_REPO/workers:$CI_COMMIT_SHORT_SHA|g" workers-deployment.yaml
    - git add . && git commit -m "deploy: $CI_COMMIT_SHORT_SHA" && git push
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
  environment:
    name: staging

deploy:production:
  stage: deploy
  image: alpine:latest
  before_script:
    - apk add --no-cache git
  script:
    - git clone https://$DEPLOY_TOKEN@gitlab.com/tutum-project/k8s-manifests.git
    - cd k8s-manifests/overlays/production
    - |
      sed -i "s|image: .*backend:.*|image: $CI_IMAGE_REPO/backend:$CI_COMMIT_SHORT_SHA|g" backend-deployment.yaml
      sed -i "s|image: .*frontend:.*|image: $CI_IMAGE_REPO/frontend:$CI_COMMIT_SHORT_SHA|g" frontend-deployment.yaml
      sed -i "s|image: .*workers:.*|image: $CI_IMAGE_REPO/workers:$CI_COMMIT_SHORT_SHA|g" workers-deployment.yaml
    - git add . && git commit -m "deploy: $CI_COMMIT_SHORT_SHA [production]" && git push
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      when: manual
  environment:
    name: production
```

### 9.3 SonarQube Quality Gate 기준

| 항목              | 기준          | 설명             |
| ----------------- | ------------- | ---------------- |
| Coverage          | >= 60%        | 테스트 커버리지  |
| Duplications      | < 5%          | 중복 코드 비율   |
| Bugs              | 0 (New)       | 새로 발견된 버그 |
| Vulnerabilities   | 0 (New)       | 새 보안 취약점   |
| Code Smells       | A등급         | 코드 품질        |
| Security Hotspots | 100% Reviewed | 보안 핫스팟 검토 |

---

## 10. ArgoCD GitOps 배포

### 10.1 ArgoCD 구성

```
┌──────────────────────────────────────────────────────┐
│                    ArgoCD                             │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │          Application 정의                    │    │
│  │                                              │    │
│  │  tutum-staging                             │    │
│  │    Source: gitlab/k8s-manifests              │    │
│  │    Path: overlays/staging                    │    │
│  │    Sync: Auto (3분 간격)                      │    │
│  │                                              │    │
│  │  tutum-production                          │    │
│  │    Source: gitlab/k8s-manifests              │    │
│  │    Path: overlays/production                 │    │
│  │    Sync: Manual (승인 후 배포)                 │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │          Sync Policy                        │    │
│  │                                              │    │
│  │  - Auto-Prune: 삭제된 리소스 자동 정리        │    │
│  │  - Self-Heal: Drift 자동 복구                 │    │
│  │  - Sync Window: 업무시간 외 자동배포 제한      │    │
│  └─────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

### 10.2 K8s 매니페스트 레포 구조 (Kustomize)

```
k8s-manifests/
├── base/
│   ├── kustomization.yaml
│   ├── namespace.yaml
│   ├── frontend/
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   ├── backend/
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   ├── workers/
│   │   ├── price-producer.yaml
│   │   ├── news-producer.yaml
│   │   ├── indexer-consumer.yaml
│   │   └── price-consumer.yaml
│   ├── mongodb/
│   │   ├── statefulset.yaml
│   │   ├── service.yaml
│   │   ├── configmap.yaml
│   │   └── secret.yaml
│   ├── redis/
│   │   ├── statefulset.yaml
│   │   ├── service.yaml
│   │   └── configmap.yaml
│   ├── kafka/
│   │   ├── statefulset.yaml
│   │   ├── service.yaml
│   ├── elasticsearch/
│   │   ├── statefulset.yaml
│   │   └── service.yaml
│   ├── minio/
│   │   ├── statefulset.yaml
│   │   └── service.yaml
│   ├── istio/
│   │   ├── gateway.yaml
│   │   ├── virtual-service.yaml
│   │   ├── destination-rules.yaml
│   │   └── peer-authentication.yaml
│   ├── keda/
│   │   ├── price-consumer-scaler.yaml
│   │   ├── indexer-consumer-scaler.yaml
│   │   ├── backend-http-scaler.yaml
│   │   └── trigger-auth.yaml
│   └── karpenter/
│       ├── app-nodepool.yaml
│       ├── data-nodepool.yaml
│       ├── monitoring-nodepool.yaml
│       └── nodeclass.yaml
│
├── overlays/
│   ├── staging/
│   │   ├── kustomization.yaml
│   │   ├── backend-deployment.yaml    # 이미지 태그 오버라이드
│   │   ├── frontend-deployment.yaml
│   │   ├── workers-deployment.yaml
│   │   ├── configmap-patch.yaml       # staging 환경 변수
│   │   └── replicas-patch.yaml        # staging replica 수
│   │
│   └── production/
│       ├── kustomization.yaml
│       ├── backend-deployment.yaml
│       ├── frontend-deployment.yaml
│       ├── workers-deployment.yaml
│       ├── configmap-patch.yaml       # production 환경 변수
│       ├── replicas-patch.yaml        # production replica 수
│       └── resource-limits-patch.yaml # production 리소스 제한
│
└── argocd/
    ├── staging-app.yaml
    └── production-app.yaml
```

### 10.3 ArgoCD Application 정의

```yaml
# argocd/staging-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: tutum-staging
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://gitlab.com/tutum-project/k8s-manifests.git
    targetRevision: main
    path: overlays/staging
  destination:
    server: https://kubernetes.default.svc
    namespace: tutum-app
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
    retry:
      limit: 3
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m

---
# argocd/production-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: tutum-production
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://gitlab.com/tutum-project/k8s-manifests.git
    targetRevision: main
    path: overlays/production
  destination:
    server: https://kubernetes.default.svc
    namespace: tutum-app
  syncPolicy:
    # production은 수동 배포
    syncOptions:
      - CreateNamespace=true
    retry:
      limit: 3
```

### 10.4 배포 전략

| 서비스   | 전략          | 설정                           |
| -------- | ------------- | ------------------------------ |
| Frontend | RollingUpdate | maxSurge: 1, maxUnavailable: 0 |
| Backend  | RollingUpdate | maxSurge: 1, maxUnavailable: 0 |
| Workers  | Recreate      | 중복 소비 방지                 |
| Redis    | OnDelete      | 수동 업데이트 (데이터 안전)    |
| Kafka    | OnDelete      | 수동 업데이트 (데이터 안전)    |

---

## 11. 마이그레이션 단계별 진행 계획

### Phase 0: 사전 준비

```
┌──────────────────────────────────────────────┐
│ Phase 0: 사전 준비                            │
│                                              │
│ 1. Production Dockerfile 작성                 │
│    - frontend/Dockerfile.prod (multi-stage)  │
│    - backend/Dockerfile.prod (multi-stage)   │
│    - workers/Dockerfile.prod                 │
│                                              │
│ 2. GitLab Registry 이미지 빌드 및 푸시 검증    │
│    - 모든 서비스 이미지 정상 빌드 확인           │
│    - registry.gitlab.com에서 이미지 Pull 테스트    │
│                                              │
│ 3. 환경 변수 정리                              │
│    - ConfigMap/Secret으로 분리할 항목 정리      │
│    - 하드코딩된 URL/값 환경변수화               │
│                                              │
│ 4. Health Check 엔드포인트 정비                 │
│    - /healthz (liveness)                     │
│    - /readyz (readiness)                     │
└──────────────────────────────────────────────┘
```

**체크리스트:**

- [ ] Frontend Dockerfile.prod 작성 (Next.js standalone)
- [ ] Backend Dockerfile.prod 작성 (multi-stage, non-root)
- [ ] Workers Dockerfile.prod 작성
- [ ] 모든 하드코딩 URL 환경변수화 (OAuth callback 등)
- [ ] Backend `/healthz`, `/readyz` 엔드포인트 추가
- [ ] Frontend `/api/health` 엔드포인트 추가
- [ ] `next.config.js` output: 'standalone' 설정

---

### Phase 1: Kubernetes 클러스터 구축

```
┌──────────────────────────────────────────────┐
│ Phase 1: K8s 클러스터 구축                     │
│                                              │
│ 1. K8s 클러스터 설치                           │
│    - kubeadm 또는 k3s 기반                    │
│    - Control Plane: 3 노드 (k8s-cp-1 ~ k8s-cp-3)                 │
│    - Worker Node: 3 노드 (App + Consumer + Data)                    │
│                                              │
│ 2. 필수 컴포넌트 설치                          │
│    - CNI: Calico 또는 Cilium                  │
│    - StorageClass: local-path 또는 NFS        │
│    - MetalLB (Bare Metal LoadBalancer)        │
│    - Cert-Manager (TLS 인증서)                │
│                                              │
│ 3. 네임스페이스 생성                           │
│    - tutum-app, tutum-data, tutum-storage  │
│    - istio-system, monitoring, argocd         │
└──────────────────────────────────────────────┘
```

**노드 구성 (조정값 기준 통일):**

| 물리 PC(호스트) | Host IP | VM | CPU | RAM | VM 내부 IP | 비고 |
|----------------|---------|----|-----|-----|------------|------|
| 서버-PC(1) | 192.168.0.28 | clouddx-cp-1 | 4 Core | 4 GB | 192.168.0.220 | Control Plane(etcd+Kubernetes API) |
| 서버-PC(1) | 192.168.0.28 | clouddx-monitoring | 2 Core | 4 GB | 192.168.0.230 | LGTM VM(Phase 3) |
| 팀원-PC(2) | 192.168.0.13 | clouddx-cp-2 | 4 Core | 4 GB | 192.168.0.221 | Control Plane |
| 팀원-PC(3) | 192.168.0.98 | clouddx-cp-3 | 4 Core | 4 GB | 192.168.0.222 | Control Plane |
| 팀원-PC(4) | 192.168.0.3 | clouddx-worker1 | 6 Core | 6 GB | 192.168.0.223 | Worker (App) |
| 팀원-PC(4) | 192.168.0.3 | clouddx-mongodb | 2 Core | 4 GB | 192.168.0.231 | MongoDB 보조 VM |
| 팀원-PC(5) | 192.168.0.14 | clouddx-worker2 | 6 Core | 6 GB | 192.168.0.224 | Worker (App+Consumer) |
| 팀원-PC(5) | 192.168.0.14 | clouddx-worker3 | 4 Core | 4 GB | 192.168.0.225 | Worker (Data) |

> **사양 기준:** 5대 문서는 조정값 기준으로 통일.
#### 5대 운영 체크리스트(HA)

- [ ] 3개 CP 노드가 동시에 `kubectl get nodes`에서 `Ready` 상태 유지
- [ ] etcd peer quorum 3/3, 포트 `2379/2380` 건강 체크
- [ ] CP 간 API/제어 통신: `6443`, `10250`, `10257`, `10259` 방화벽/ufw 허용 상태 확인
- [ ] App/Data 분리 노드 스케줄링: Pod affinity/anti-affinity 및 `nodeSelector` 정책 적용
 - [ ] 노드 장애 Drill: 1 CP 또는 1 Worker 종료 후 재조정 시간(TTR) 기록 및 복구 문서 갱신

#### 운영 공지 템플릿(요약)

```text
[조정 운영] 기준
1) 조정값 기준 통일(임시 변경 금지)
2) 피크 구간: 19:00~23:00
3) 동시 빌드/테스트 2개 초과 금지
4) 192.168.0.14(worker2/3): 빌드 heavy 1개 제한
5) 192.168.0.28(cp1/monitoring): SonarQube+LGTM 동시 피크 시 신규 빌드 5분 지연
6) 알림 임계치: CPU>80% 또는 Mem>85% 3분 지속, loadavg>8 연속 3회
7) 일일 점검: kubectl get nodes/top node + worker2/3 상태 + NAT 포트 + 192.168.0.{220,221,222,223,224,225,230,231} ping
```

**권장 실행형 점검(공통):**

```powershell
# 물리 PC 5대에서 각각 실행 (자기 PC에 할당된 포트만 체크)
$checkMap = @{
  "192.168.0.28" = @(2220, 2230)
  "192.168.0.13" = @(2221)
  "192.168.0.98" = @(2222)
  "192.168.0.3"  = @(2223, 2224)
  "192.168.0.14" = @(2225, 2226)
}

foreach ($entry in $checkMap.GetEnumerator()) {
  $ip = $entry.Key
  foreach ($port in $entry.Value) {
    $ok = Test-NetConnection -ComputerName $ip -Port $port -InformationLevel Quiet
    "{0}:{1} => {2}" -f $ip, $port, ($(if($ok){"OPEN"}else{"CLOSED"}))
  }
}
```

```bash
# monitoring VM 또는 cp1에서 192.168.0.0/24 단방향 통신 확인
for ip in 192.168.0.{220,221,222,223,224,225,230,231}; do
  ping -c 1 "$ip" >/dev/null && echo "$ip OK" || echo "$ip FAIL"
done

# HA 핵심 상태 점검
kubectl get nodes -o wide
kubectl get ns tutum-app tutum-data tutum-storage monitoring istio-system argocd kyverno || true
kubectl get svc -n kube-system kube-dns
kubectl get pods -n metallb-system -o wide
kubectl get pods -n istio-system -o wide
kubectl -n tutum-app get pods --no-headers | head
kubectl -n tutum-data get pods --no-headers | head
kubectl get svc -n istio-system istio-ingressgateway
```

### Phase 2: Istio 서비스 메시 설치

```
┌──────────────────────────────────────────────┐
│ Phase 2: Istio 설치                           │
│                                              │
│ 1. Istio 설치 (istioctl)                      │
│    $ istioctl install --set profile=default  │
│                                              │
│ 2. tutum-app 네임스페이스 Sidecar 활성화         │
│    $ kubectl label namespace tutum-app \       │
│      istio-injection=enabled                 │
│                                              │
│ 3. Kiali 대시보드 설치                         │
│    $ kubectl apply -f kiali.yaml             │
│                                              │
│ 4. Istio Gateway + VirtualService 배포        │
│                                              │
│ 5. mTLS PeerAuthentication 적용               │
└──────────────────────────────────────────────┘
```

---

### Phase 3: LGTM 옵저버빌리티 구축

```
┌──────────────────────────────────────────────┐
│ Phase 3: LGTM + Alloy 설치                    │
│                                              │
│ 1. monitoring 네임스페이스 생성                │
│                                              │
│ 2. Helm으로 LGTM 스택 설치                     │
│    - Loki (로그)                              │
│    - Grafana (대시보드)                        │
│    - Tempo (트레이싱)                          │
│    - Mimir (메트릭)                           │
│                                              │
│ 3. Grafana Alloy DaemonSet 배포               │
│    - 메트릭 + 로그 + 트레이스 수집             │
│                                              │
│ 4. 대시보드 프로비저닝                          │
│    - CloudDX Overview                        │
│    - Istio Mesh Dashboard                    │
│    - Redis/Kafka/ES Monitoring               │
│                                              │
│ 5. 알림 규칙 설정                              │
│    - Slack/Email 알림 연동                     │
└──────────────────────────────────────────────┘
```

---

### Phase 4: GitLab CI/CD + SonarQube 구성

```
┌──────────────────────────────────────────────┐
│ Phase 4: CI/CD 파이프라인 구축                 │
│                                              │
│ 1. GitLab Runner 설치 (K8s Executor)          │
│    - K8s 클러스터 내 Runner Pod 실행           │
│                                              │
│ 2. SonarQube 설치                             │
│    - Helm 또는 Docker로 설치                   │
│    - GitLab 연동 설정                         │
│    - Quality Gate 기준 설정                    │
│                                              │
│ 3. .gitlab-ci.yml 작성                        │
│    - lint → test → scan → build → deploy     │
│                                              │
│ 4. GitLab Registry 연동                        │
│    - GitLab Runner에서 registry.gitlab.com 푸시 자동화 │
│                                              │
│ 5. 파이프라인 테스트                           │
│    - Feature Branch 빌드 검증                  │
│    - Main Branch 자동 배포 검증                │
└──────────────────────────────────────────────┘
```

---

### Phase 5: ArgoCD GitOps 배포 구성

```
┌──────────────────────────────────────────────┐
│ Phase 5: ArgoCD 설치 및 GitOps 구성            │
│                                              │
│ 1. ArgoCD 설치                                │
│    $ kubectl create namespace argocd         │
│    $ kubectl apply -n argocd -f \            │
│      https://...install.yaml                 │
│                                              │
│ 2. K8s 매니페스트 Git 레포 생성                │
│    - base/ + overlays/ 구조 (Kustomize)      │
│                                              │
│ 3. ArgoCD Application 등록                    │
│    - tutum-staging (Auto Sync)             │
│    - tutum-production (Manual Sync)        │
│                                              │
│ 4. GitLab CI → 매니페스트 레포 연동            │
│    - CI에서 이미지 태그 업데이트 → Git Push     │
│    - ArgoCD 감지 → 자동 배포                   │
│                                              │
│ 5. Rollback 테스트                            │
│    - ArgoCD UI에서 이전 버전 롤백 확인          │
└──────────────────────────────────────────────┘
```

---

### Phase 5.5: KEDA + Karpenter 설치

```
┌──────────────────────────────────────────────┐
│ Phase 5.5: KEDA + Karpenter 구성              │
│                                              │
│ 1. KEDA 설치 (Helm)                           │
│    $ helm install keda kedacore/keda \       │
│      --namespace keda --create-namespace     │
│                                              │
│ 2. KEDA ScaledObject 배포                     │
│    - Workers: Kafka Lag 기반 스케일링          │
│    - Backend: HTTP RPS 기반 스케일링           │
│    - Scale-to-Zero 정책 설정                  │
│                                              │
│ 3. Karpenter 설치 (Helm)                      │
│    $ helm install karpenter karpenter/...    │
│      --namespace karpenter                   │
│                                              │
│ 4. NodePool 정의 배포                          │
│    - app-pool (App 워크로드)                  │
│    - data-pool (Data 워크로드, Taint)         │
│    - monitoring-pool (모니터링, Taint)        │
│                                              │
│ 5. 부하 테스트로 동작 검증                      │
│    - KEDA Pod 스케일 업/다운 확인              │
│    - Karpenter Node 프로비저닝 확인            │
│    - Scale-to-Zero → Scale-from-Zero 확인    │
└──────────────────────────────────────────────┘
```

---

### Phase 6: 데이터 레이어 마이그레이션

```
┌──────────────────────────────────────────────┐
│ Phase 6: Stateful 서비스 K8s 이전             │
│                                              │
│ 1. MongoDB StatefulSet 배포                    │
│    - Atlas → 로컬 K8s 전환                    │
│    - PVC 30Gi, mongodump → mongorestore      │
│    - 연결 URI 환경변수 변경                     │
│                                              │
│ 2. Redis StatefulSet 배포                     │
│    - PersistentVolumeClaim 설정               │
│    - 기존 Redis → K8s Redis 전환              │
│                                              │
│ 3. Kafka(KRaft) StatefulSet 배포               │
│    - PVC 설정 (데이터 보존)                    │
│    - Topic 재생성/마이그레이션                  │
│                                              │
│ 4. Elasticsearch StatefulSet 배포             │
│    - PVC 설정                                │
│    - 인덱스 재생성                             │
│                                              │
│ 5. MinIO StatefulSet 배포                     │
│    - PVC 설정                                │
│    - 버킷/데이터 마이그레이션                   │
│                                              │
│ 6. (옵션) 이미지 레지스트리 마이그레이션 검토      │
│    - Harbor가 도입된 경우 VM Harbor → K8s 이전│
└──────────────────────────────────────────────┘
```

---

### Phase 7: 어플리케이션 마이그레이션

```
┌──────────────────────────────────────────────┐
│ Phase 7: App 서비스 K8s 이전                   │
│                                              │
│ 1. Backend Deployment 배포                    │
│    - ConfigMap (환경 변수)                     │
│    - Secret (API 키, DB 비밀번호)              │
│    - KEDA ScaledObject (Auto Scaling)         │
│    - Readiness/Liveness Probe                │
│                                              │
│ 2. Frontend Deployment 배포                   │
│    - ConfigMap (API URL 등)                   │
│    - KEDA ScaledObject                        │
│                                              │
│ 3. Workers Deployment 배포                    │
│    - 각 Worker 별도 Deployment                │
│    - Kafka 연결 설정                          │
│                                              │
│ 4. Istio 라우팅 적용                          │
│    - Gateway → VirtualService → Service      │
│                                              │
│ 5. DNS 전환                                   │
│    - 기존 VM IP → K8s Ingress IP              │
└──────────────────────────────────────────────┘
```

---

### Phase 8: 검증 및 최적화

```
┌──────────────────────────────────────────────┐
│ Phase 8: 검증 및 최적화                        │
│                                              │
│ 1. E2E 테스트                                 │
│    - 전체 플로우 정상 동작 확인                  │
│    - OAuth 로그인/로그아웃                      │
│    - 자산 CRUD + 매수/매도                     │
│    - 시세 조회 (캐시 동작)                      │
│    - AI 챗봇                                  │
│                                              │
│ 2. 부하 테스트 (k6 + InfluxDB + Grafana)        │
│    - k6 시나리오: 점진적 부하/스파이크 테스트      │
│    - InfluxDB로 결과 저장, Grafana 시각화        │
│    - KEDA 동작 확인 (Pod 스케일아웃)              │
│    - Karpenter Node 프로비저닝 확인             │
│    - Istio Circuit Breaker 동작 확인           │
│                                              │
│ 3. 스케일링 시나리오 테스트                      │
│    - KEDA: Kafka Lag 증가 → Worker 확장       │
│    - KEDA: Lag 해소 → Scale-to-Zero           │
│    - Karpenter: Pending Pod → 신규 노드 생성  │
│    - Karpenter: 유휴 노드 Consolidation       │
│                                              │
│ 4. 장애 시나리오 테스트                         │
│    - Pod 강제 종료 → 자동 복구 확인             │
│    - Node 장애 → Karpenter 재프로비저닝 확인    │
│    - ArgoCD 롤백 테스트                        │
│                                              │
│ 4. 모니터링 검증                               │
│    - Grafana 대시보드 데이터 확인               │
│    - 알림 수신 테스트                           │
│    - 로그/트레이스 검색 확인                     │
│                                              │
│ 5. 기존 VM 인프라 정리                         │
│    - Docker Compose 서비스 중지                │
│    - VM 리소스 회수                            │
└──────────────────────────────────────────────┘
```

---

## 12. 전체 배포 플로우 요약

```
┌──────────┐     ┌──────────┐     ┌───────────┐     ┌──────────┐
│Developer │────▶│  GitLab  │────▶│ SonarQube │────▶│  Registry │
│ git push │     │  CI/CD   │     │   Scan    │     │  (이미지) │
└──────────┘     └──────────┘     └───────────┘     └─────┬────┘
                                                          │
                      ┌───────────────────────────────────┘
                      │ 이미지 태그 업데이트
                      ▼
              ┌──────────────┐
              │  K8s Manifest│
              │  Git Repo    │
              └──────┬───────┘
                     │ ArgoCD 감지
                     ▼
              ┌──────────────┐     ┌───────────┐
              │    ArgoCD    │────▶│Kubernetes │
              │  (GitOps)   │     │  Cluster  │
              └──────────────┘     └─────┬─────┘
                                         │
                     ┌───────────────────┼───────────────────┐
                     │                   │                   │
               ┌──────────┼──────────┼──────────┐
               │          │          │          │
               ▼          ▼          ▼          ▼
        ┌──────────┐┌──────────┐┌────────┐┌──────────┐
        │  Istio   ││   LGTM   ││  KEDA  ││Karpenter │
        │(Traffic) ││(Monitor) ││(Pod AS)││(Node AS) │
        └──────────┘└──────────┘└────────┘└──────────┘
```

**플로우:**

1. 개발자가 코드를 GitLab에 Push
2. GitLab CI가 Lint → Test → SonarQube Scan 실행
3. 품질 게이트 통과 시 Docker 이미지 빌드
4. **Trivy가 컨테이너 취약점 스캔** (CRITICAL/HIGH 발견 시 중단)
5. **Cosign이 이미지 서명** (서명 키로 디지털 서명)
6. 서명된 이미지를 GitLab Registry에 Push
7. CI가 K8s 매니페스트 레포의 이미지 태그를 업데이트
8. ArgoCD가 변경 감지 → Kubernetes에 배포 요청
9. **Kyverno가 이미지 서명 검증** (미서명 이미지 배포 차단)
10. Istio가 트래픽 관리 (라우팅, mTLS, Circuit Breaker)
11. LGTM + Alloy가 메트릭/로그/트레이스 수집 및 시각화
12. KEDA가 이벤트(Kafka Lag, HTTP RPS) 기반 Pod 오토스케일링
13. Karpenter가 Pending Pod 감지 시 최적 Node 자동 프로비저닝/회수

---

## 13. Secret 관리

| Secret                          | 저장 위치                       | 용도                       |
| ------------------------------- | ------------------------------- | -------------------------- |
| MongoDB URI/Password            | K8s Secret                      | DB 연결 (로컬 StatefulSet) |
| KIS API Key/Secret              | K8s Secret                      | 주식 시세 API              |
| JWT Secret Key                  | K8s Secret                      | 토큰 서명                  |
| OAuth Client Secrets            | K8s Secret                      | Google/Kakao/Naver         |
| AWS Bedrock Credentials         | K8s Secret                      | AI 챗봇                    |
| GitLab Registry Credentials     | K8s Secret                      | 이미지 Pull                |
| Redis Password                  | K8s Secret                      | 캐시 접근                  |
| MariaDB Host/Port/User/Password | K8s Secret                      | 회원/인증 DB (외부 서버)   |
| Cosign Private Key              | K8s Secret + GitLab CI Variable | 이미지 서명                |
| SonarQube Token                 | GitLab CI Variable              | 코드 스캔                  |
| GitLab Deploy Token             | GitLab CI Variable              | 매니페스트 레포 접근       |

> 향후 HashiCorp Vault 또는 Sealed Secrets 도입 고려

---

## 14. Pod 오토스케일링: KEDA 단독 선택

### 14.1 HPA vs KEDA 객관적 비교

| 항목                | HPA                           | KEDA                                                        | 판정                 |
| ------------------- | ----------------------------- | ----------------------------------------------------------- | -------------------- |
| **트리거 소스**     | CPU, Memory만 (기본)          | CPU, Memory + Kafka Lag, HTTP RPS, Redis, Prometheus 등 50+ | **KEDA 압도적**      |
| **Scale-to-Zero**   | 불가 (minReplicas >= 1)       | 가능 (minReplicas = 0)                                      | **KEDA** (비용 절감) |
| **반응 속도**       | 15~30초 (메트릭 수집 주기)    | 10~15초 (pollingInterval 설정)                              | **KEDA** 약간 빠름   |
| **설치 복잡도**     | K8s 내장 (추가 설치 없음)     | Helm 설치 필요 (KEDA Operator)                              | HPA 단순             |
| **커스텀 메트릭**   | Prometheus Adapter 별도 필요  | 내장 지원                                                   | **KEDA** 편리        |
| **안정성/성숙도**   | K8s 핵심 컴포넌트 (매우 안정) | CNCF Graduated (안정)                                       | 동등                 |
| **리소스 오버헤드** | 없음                          | KEDA Operator Pod (~128Mi)                                  | HPA 가벼움           |

### 14.2 선택: KEDA 단독 (HPA 미사용)

**KEDA는 내부적으로 HPA를 자동 생성**하여 CPU/Memory 기반 스케일링도 지원합니다. 즉, KEDA는 HPA의 **상위 호환**이므로 별도로 HPA를 운영할 필요가 없습니다.

**선택 근거:**

1. **HPA 기능 완전 포함**: KEDA의 CPU/Memory 트리거는 HPA와 동일하게 동작하며, KEDA가 내부적으로 HPA 오브젝트를 생성/관리함. 따라서 KEDA만으로 HPA의 모든 기능을 대체 가능
2. **Workers 필수**: Workers(Producer/Consumer)는 CPU 사용률이 낮아도 Kafka Lag가 쌓이면 스케일 업 필요 → HPA로는 감지 불가, KEDA 필수
3. **Scale-to-Zero**: Consumer Workers는 야간/주말 유휴 시 Pod 0으로 축소하여 리소스 절약 → HPA에서는 불가능, KEDA만 지원
4. **스케일링 정책 단일화**: HPA + KEDA를 혼용하면 두 시스템의 설정을 각각 관리해야 함. KEDA로 통일하면 ScaledObject 하나로 모든 서비스의 스케일링을 일관되게 관리 가능
5. **운영 단순성**: 오토스케일링 관련 설정이 KEDA ScaledObject로 일원화되어 디버깅과 모니터링이 간편

| 서비스                 | KEDA 트리거                                 | min | max | 비고                        |
| ---------------------- | ------------------------------------------- | --- | --- | --------------------------- |
| **Frontend**           | CPU Utilization (70%)                       | 2   | 4   | 기존 HPA 역할 대체          |
| **Backend**            | CPU Utilization (70%) + Prometheus HTTP RPS | 2   | 6   | CPU 기본 + HTTP 트래픽 보조 |
| **Workers (Producer)** | CPU Utilization (70%)                       | 1   | 3   | 항상 1 이상 실행            |
| **Workers (Consumer)** | Kafka Consumer Lag                          | 0   | 3   | **Scale-to-Zero 적용**      |

---

## 15. KEDA (Kubernetes Event-Driven Autoscaling)

### 15.1 KEDA 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                     KEDA 동작 흐름                            │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ Event Source │    │    KEDA      │    │  Kubernetes  │  │
│  │              │───▶│   Operator   │───▶│   HPA/Pod    │  │
│  │ - Kafka Lag  │    │              │    │  Scale Up/   │  │
│  │ - Redis Len  │    │ ScaledObject │    │  Scale Down  │  │
│  │ - HTTP Rate  │    │   정의 기반   │    │  (0까지 축소) │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 Scale to Zero                        │   │
│  │                                                      │   │
│  │  이벤트 없음 → Replica 0 (리소스 절약)                 │   │
│  │  이벤트 발생 → Replica 1+ (자동 확장)                  │   │
│  │  Kafka Lag 증가 → Replica 추가 (처리량 확보)           │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 15.2 KEDA 설치

```bash
# KEDA Helm 설치
helm repo add kedacore https://kedacore.github.io/charts
helm repo update

helm install keda kedacore/keda \
  --namespace keda \
  --create-namespace \
  --set metricsServer.useHostNetwork=false
```

### 15.3 KEDA 서비스별 스케일링 전략 (HPA 미사용)

| 대상               | 트리거                          | min | max | 비고                          |
| ------------------ | ------------------------------- | --- | --- | ----------------------------- |
| Frontend           | CPU Utilization (70%)           | 2   | 4   | CPU 기반 (기존 HPA 역할 대체) |
| Backend            | CPU (70%) + Prometheus HTTP RPS | 2   | 6   | CPU 기본 + HTTP 트래픽 보조   |
| Workers (Producer) | CPU Utilization (70%)           | 1   | 3   | 항상 1 이상 실행              |
| Workers (Consumer) | Kafka Consumer Lag              | 0   | 3   | Scale-to-Zero 적용            |

### 15.4 ScaledObject 정의 - Frontend/Backend (HPA 대체)

```yaml
# KEDA ScaledObject - Frontend (HPA 대체)
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: frontend-scaler
  namespace: tutum-app
spec:
  scaleTargetRef:
    name: frontend
  pollingInterval: 15
  cooldownPeriod: 60
  minReplicaCount: 2
  maxReplicaCount: 4
  triggers:
    - type: cpu
      metadata:
        type: Utilization
        value: "70"
```

### 15.5 ScaledObject 정의 - Kafka Workers

```yaml
# KEDA ScaledObject - Price Producer Worker
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: price-producer-scaler
  namespace: tutum-app
spec:
  scaleTargetRef:
    name: price-producer
  pollingInterval: 15 # 15초마다 메트릭 확인
  cooldownPeriod: 60 # 스케일다운 대기 60초
  minReplicaCount: 1 # 최소 1 (항상 실행)
  maxReplicaCount: 3
  triggers:
    - type: cpu
      metadata:
        type: Utilization
        value: "70"

---
# KEDA ScaledObject - Price Consumer Worker
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: price-consumer-scaler
  namespace: tutum-app
spec:
  scaleTargetRef:
    name: price-consumer
  pollingInterval: 15
  cooldownPeriod: 120 # Consumer는 더 긴 쿨다운
  minReplicaCount: 0 # Scale to Zero 허용
  maxReplicaCount: 3
  triggers:
    - type: kafka
      metadata:
        bootstrapServers: kafka-bootstrap.tutum-data.svc.cluster.local:9092
        consumerGroup: price-consumer-group
        topic: prices
        lagThreshold: "100" # Lag 100 이상이면 스케일 업
        offsetResetPolicy: latest

---
# KEDA ScaledObject - News Producer Worker
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: news-producer-scaler
  namespace: tutum-app
spec:
  scaleTargetRef:
    name: news-producer
  pollingInterval: 30
  cooldownPeriod: 300
  minReplicaCount: 1
  maxReplicaCount: 2
  triggers:
    - type: cpu
      metadata:
        type: Utilization
        value: "70"

---
# KEDA ScaledObject - Indexer Consumer Worker
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: indexer-consumer-scaler
  namespace: tutum-app
spec:
  scaleTargetRef:
    name: indexer-consumer
  pollingInterval: 15
  cooldownPeriod: 120
  minReplicaCount: 0 # Scale to Zero 허용
  maxReplicaCount: 3
  triggers:
    - type: kafka
      metadata:
        bootstrapServers: kafka-bootstrap.tutum-data.svc.cluster.local:9092
        consumerGroup: indexer-consumer-group
        topic: news
        lagThreshold: "50"
        offsetResetPolicy: latest
```

### 15.5 ScaledObject 정의 - Backend HTTP 기반

```yaml
# KEDA ScaledObject - Backend (HTTP 요청 기반 추가 스케일링)
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: backend-http-scaler
  namespace: tutum-app
spec:
  scaleTargetRef:
    name: backend
  pollingInterval: 10
  cooldownPeriod: 120
  minReplicaCount: 2 # 최소 2 유지 (가용성)
  maxReplicaCount: 6
  triggers:
    # Prometheus/Mimir 메트릭 기반
    - type: prometheus
      metadata:
        serverAddress: http://mimir.monitoring.svc:9009
        query: |
          sum(rate(istio_requests_total{
            destination_service_name="backend-svc",
            reporter="destination"
          }[2m]))
        threshold: "50" # 초당 50 요청 이상이면 스케일 업
        activationThreshold: "5"
    # Redis 기반 (Rate Limit 카운터 활용)
    - type: redis
      metadata:
        address: redis-svc.tutum-data.svc:6379
        listName: "request_queue"
        listLength: "100"
```

### 15.6 KEDA TriggerAuthentication (Kafka 인증 시)

```yaml
# Kafka 인증이 필요한 경우
apiVersion: keda.sh/v1alpha1
kind: TriggerAuthentication
metadata:
  name: kafka-trigger-auth
  namespace: tutum-app
spec:
  secretTargetRef:
    - parameter: sasl
      name: kafka-credentials
      key: sasl
    - parameter: username
      name: kafka-credentials
      key: username
    - parameter: password
      name: kafka-credentials
      key: password
```

---

## 16. Karpenter (노드 오토스케일링)

### 16.1 Karpenter 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                   Karpenter 동작 흐름                         │
│                                                             │
│                                                             │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │ Pending  │    │  Karpenter   │    │  새 Node 프로비저닝 │  │
│  │  Pods    │───▶│  Controller  │───▶│  (적정 사양 선택)   │  │
│  │(스케줄링 │    │              │    │                    │  │
│  │ 불가)    │    │ NodePool     │    │  Pod 스케줄링      │  │
│  └──────────┘    │ 정의 기반     │    │  → Node 배치      │  │
│                  └──────────────┘    └──────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Node Lifecycle 관리                      │   │
│  │                                                      │   │
│  │  1. Provisioning: Pending Pod → 최적 Node 생성       │   │
│  │  2. Consolidation: 유휴 Node 통합 → 비용 절감         │   │
│  │  3. Drift Detection: 스펙 변경 → Node 교체           │   │
│  │  4. Expiration: TTL 기반 Node 자동 교체              │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 16.2 노드 오토스케일링: Karpenter 단독 선택 (Cluster Autoscaler 미사용)

**객관적 지표 비교:**

| 항목                | Cluster Autoscaler (CA)              | Karpenter                             | 판정                      |
| ------------------- | ------------------------------------ | ------------------------------------- | ------------------------- |
| **프로비저닝 속도** | 3~5분 (ASG → EC2)                    | 30초~1분 (직접 API)                   | **Karpenter** 3~5배 빠름  |
| **스케일링 단위**   | Node Group 단위 (고정 인스턴스 타입) | 개별 Node (동적 인스턴스 선택)        | **Karpenter** 유연        |
| **Scale-Down 지연** | 기본 10분 대기                       | Consolidation 즉시 감지               | **Karpenter** 비용 절감   |
| **Bin Packing**     | Node Group 내 제한적                 | 전체 클러스터 최적화                  | **Karpenter** 효율        |
| **비용 최적화**     | 같은 타입만 사용                     | Spot/On-Demand 혼합, 최저가 자동 선택 | **Karpenter** 20~40% 절감 |
| **노드 다양성**     | Node Group별 1타입 고정              | 수십 가지 인스턴스 중 동적 선택       | **Karpenter** 적응적      |
| **멀티 아키텍처**   | 별도 Node Group 필요                 | 자동 (arm64/amd64 혼합)               | **Karpenter** 간편        |
| **설정 복잡도**     | ASG + Launch Template 필요           | NodePool CR 하나로 완료               | **Karpenter** 단순        |
| **Drift Detection** | 없음 (수동 교체)                     | 자동 감지 → 교체                      | **Karpenter** 운영 편의   |
| **Node 통합**       | 없음                                 | Consolidation (유휴 노드 자동 통합)   | **Karpenter**             |
| **커뮤니티/성숙도** | 오래된 표준 (2016~)                  | AWS 공식 지원 (2021~, GA)             | 동등                      |

**선택 근거:**

1. **KEDA와의 시너지**: KEDA가 Kafka Lag 기반으로 Worker Pod를 0→3으로 급격히 스케일 업할 때, CA는 Node Group의 ASG 조정에 3~5분이 걸리지만, Karpenter는 30초~1분 내에 최적 노드를 프로비저닝하여 KEDA의 빠른 Pod 스케일링에 즉시 대응
2. **비용 효율**: CloudDX는 주간(시세 조회 활발)과 야간(유휴)의 트래픽 차이가 크므로, Karpenter의 Consolidation이 야간 유휴 노드를 빠르게 통합하여 비용 절감
3. **운영 단순성**: CA는 Node Group × 인스턴스 타입별로 ASG를 관리해야 하나, Karpenter는 NodePool 하나로 app/data/monitoring 워크로드를 분리 관리
4. **10개 항목 중 9개에서 Karpenter 우위**: CA가 유일하게 앞서는 것은 '설치 불필요'뿐이나, Karpenter도 Helm 한 줄로 설치 가능하여 실질적 차이 미미

### 16.3 Karpenter 설치

```bash
# Karpenter Helm 설치
helm repo add karpenter https://charts.karpenter.sh
helm repo update

helm install karpenter karpenter/karpenter \
  --namespace karpenter \
  --create-namespace \
  --set settings.clusterName=tutum-cluster \
  --set settings.clusterEndpoint=https://<k8s-api-endpoint> \
  --set controller.resources.requests.cpu=0.5 \
  --set controller.resources.requests.memory=512Mi
```

### 16.4 NodePool 정의

```yaml
# Karpenter NodePool - 어플리케이션 워크로드
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: app-pool
spec:
  template:
    metadata:
      labels:
        workload-type: application
    spec:
      requirements:
        # CPU 아키텍처
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64"]
        # 인스턴스 카테고리 (베어메탈 환경은 capacity-type 조정)
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["on-demand"]
        # 노드 크기 제한
        - key: node.kubernetes.io/instance-type
          operator: In
          values: ["m5.large", "m5.xlarge", "m6i.large", "m6i.xlarge"]
      nodeClassRef:
        group: karpenter.sh
        kind: NodeClass
        name: default

  # 리소스 제한 (전체 NodePool)
  limits:
    cpu: "32" # 최대 32 코어
    memory: "64Gi" # 최대 64GB

  # Node 통합(Consolidation) 정책
  disruption:
    consolidationPolicy: WhenEmptyOrUnderutilized
    consolidateAfter: 60s

  # Node TTL (자동 교체)
  expireAfter: 720h # 30일마다 노드 교체

---
# Karpenter NodePool - 데이터 워크로드 (StatefulSet용)
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: data-pool
spec:
  template:
    metadata:
      labels:
        workload-type: data
    spec:
      requirements:
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64"]
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["on-demand"]
        - key: node.kubernetes.io/instance-type
          operator: In
          values: ["r5.large", "r5.xlarge", "r6i.large"] # 메모리 최적화
      # 데이터 노드는 Taint 적용
      taints:
        - key: workload-type
          value: data
          effect: NoSchedule

  limits:
    cpu: "16"
    memory: "64Gi"

  disruption:
    consolidationPolicy: WhenEmpty # 데이터 노드는 보수적으로
    consolidateAfter: 300s

  expireAfter: 2160h # 90일

---
# Karpenter NodePool - 모니터링 워크로드
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: monitoring-pool
spec:
  template:
    metadata:
      labels:
        workload-type: monitoring
    spec:
      requirements:
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64"]
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["on-demand"]
        - key: node.kubernetes.io/instance-type
          operator: In
          values: ["m5.large", "m5.xlarge"]
      taints:
        - key: workload-type
          value: monitoring
          effect: NoSchedule

  limits:
    cpu: "8"
    memory: "32Gi"

  disruption:
    consolidationPolicy: WhenEmptyOrUnderutilized
    consolidateAfter: 120s
```

### 16.5 NodeClass 정의

```yaml
apiVersion: karpenter.sh/v1
kind: NodeClass
metadata:
  name: default
spec:
  # AMI (클라우드 환경 시) 또는 베어메탈 OS 이미지
  amiSelectorTerms:
    - tags:
        karpenter.sh/discovery: tutum-cluster

  # 보안 그룹
  securityGroupSelectorTerms:
    - tags:
        karpenter.sh/discovery: tutum-cluster

  # 서브넷
  subnetSelectorTerms:
    - tags:
        karpenter.sh/discovery: tutum-cluster

  # Block Device (스토리지)
  blockDeviceMappings:
    - deviceName: /dev/xvda
      ebs:
        volumeSize: 100Gi
        volumeType: gp3
        iops: 3000
        throughput: 125
        encrypted: true
```

### 16.6 워크로드별 Node 배치 전략 (NodeSelector + Toleration)

```yaml
# Backend Deployment - app-pool에 배치
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: tutum-app
spec:
  template:
    spec:
      nodeSelector:
        workload-type: application
      containers:
        - name: backend
          # ...

---
# Elasticsearch StatefulSet - data-pool에 배치
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: elasticsearch
  namespace: tutum-data
spec:
  template:
    spec:
      nodeSelector:
        workload-type: data
      tolerations:
        - key: workload-type
          value: data
          effect: NoSchedule
      containers:
        - name: elasticsearch
          # ...

---
# Grafana Deployment - monitoring-pool에 배치
apiVersion: apps/v1
kind: Deployment
metadata:
  name: grafana
  namespace: monitoring
spec:
  template:
    spec:
      nodeSelector:
        workload-type: monitoring
      tolerations:
        - key: workload-type
          value: monitoring
          effect: NoSchedule
      containers:
        - name: grafana
          # ...
```

### 16.7 Karpenter + KEDA 연동 시나리오

```
트래픽 급증 시나리오:

1. 사용자 트래픽 증가
   │
2. KEDA가 Backend Pod 스케일 업 (2 → 6)
   │
3. 기존 Node에 리소스 부족 → Pending Pod 발생
   │
4. Karpenter가 Pending Pod 감지
   │
5. 최적 사양의 새 Node 프로비저닝 (약 60초)
   │
6. Pending Pod → 새 Node에 스케줄링
   │
7. 서비스 정상 처리

트래픽 감소 시나리오:

1. 사용자 트래픽 감소
   │
2. KEDA가 Backend Pod 스케일 다운 (6 → 2)
   │
3. Kafka Consumer Lag 0 → KEDA가 Worker 0으로 축소
   │
4. Node 리소스 사용률 저하
   │
5. Karpenter Consolidation 감지
   │
6. Pod를 다른 Node로 이동 (Cordon → Drain)
   │
7. 유휴 Node 제거 → 비용 절감
```

---

## 17. KEDA + Karpenter 스케일링 전체 구조

```
┌─────────────────────────────────────────────────────────────────┐
│                    오토스케일링 계층 구조                          │
│                                                                 │
│  ┌──── Pod Level (KEDA 단독 관리) ────────────────────────┐    │
│  │                                                         │    │
│  │  ┌──────────────────────────────────────────────────┐  │    │
│  │  │              KEDA (HPA 대체)                      │  │    │
│  │  │                                                   │  │    │
│  │  │  - Frontend (CPU 70%)                             │  │    │
│  │  │  - Backend (CPU 70% + HTTP RPS)                   │  │    │
│  │  │  - Workers Producer (CPU 70%)                     │  │    │
│  │  │  - Workers Consumer (Kafka Lag, Scale-to-Zero)    │  │    │
│  │  └──────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              │ Pending Pods 발생                  │
│                              ▼                                   │
│  ┌──── Node Level (인프라 확장) ──────────────────────────┐     │
│  │                                                         │     │
│  │  ┌──────────────────────────────────────────────────┐  │     │
│  │  │              Karpenter                            │  │     │
│  │  │                                                   │  │     │
│  │  │  NodePool: app-pool      → App 워크로드 노드       │  │     │
│  │  │  NodePool: data-pool     → Data 워크로드 노드      │  │     │
│  │  │  NodePool: monitoring-pool → 모니터링 노드          │  │     │
│  │  │                                                   │  │     │
│  │  │  - 최적 인스턴스 자동 선택                          │  │     │
│  │  │  - Consolidation (유휴 노드 통합)                  │  │     │
│  │  │  - Drift Detection (스펙 변경 감지)                │  │     │
│  │  └──────────────────────────────────────────────────┘  │     │
│  └─────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

| 스케일링 계층   | 도구      | 대상               | 트리거                    |
| --------------- | --------- | ------------------ | ------------------------- |
| Pod 수평 확장   | KEDA      | Frontend           | CPU > 70%                 |
| Pod 수평 확장   | KEDA      | Backend            | CPU > 70% + HTTP RPS > 50 |
| Pod 이벤트 확장 | KEDA      | Workers (Producer) | CPU > 70%                 |
| Pod 이벤트 확장 | KEDA      | Workers (Consumer) | Kafka Consumer Lag > 100  |
| Pod → Zero      | KEDA      | Workers (Consumer) | Lag = 0 → 0 replica       |
| Node 확장       | Karpenter | 전체 클러스터      | Pending Pod 발생          |
| Node 축소       | Karpenter | 전체 클러스터      | Node 유휴/저활용          |

---

## 18. 운영 협업: Slack + Jira 연동

### 18.1 알림/장애 플로우

```
┌─────────────────────────────────────────────────────────────────┐
│                    운영 이벤트 흐름                                │
│                                                                 │
│  ┌──────────┐    ┌───────────┐    ┌──────────┐    ┌─────────┐ │
│  │ Grafana  │───▶│   Slack   │───▶│   Jira   │───▶│ 담당자  │ │
│  │ Alert    │    │  Webhook  │    │  Ticket  │    │ 대응    │ │
│  │ Manager  │    │ #ops-alert│    │ 자동 생성 │    │         │ │
│  └──────────┘    └───────────┘    └──────────┘    └─────────┘ │
│                                                                 │
│  ┌──────────┐    ┌───────────┐                                 │
│  │ ArgoCD   │───▶│   Slack   │  배포 완료/실패 알림              │
│  │ Webhook  │    │ #deploys  │                                 │
│  └──────────┘    └───────────┘                                 │
│                                                                 │
│  ┌──────────┐    ┌───────────┐                                 │
│  │ GitLab   │───▶│   Slack   │  빌드/테스트 결과 알림            │
│  │ CI/CD    │    │ #ci-cd    │                                 │
│  └──────────┘    └───────────┘                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 18.2 Slack 채널 구조

| 채널            | 용도             | 알림 소스             |
| --------------- | ---------------- | --------------------- |
| `#ops-alert`    | 장애/경고 알림   | Grafana Alert Manager |
| `#deploys`      | 배포 알림        | ArgoCD Webhook        |
| `#ci-cd`        | 빌드/테스트 결과 | GitLab CI/CD          |
| `#daily-report` | 일일 운영 리포트 | Grafana 스케줄 리포트 |

### 18.3 Grafana → Slack 알림 설정

```yaml
# Grafana alerting - contact points
apiVersion: 1
contactPoints:
  - orgId: 1
    name: slack-ops
    receivers:
      - uid: slack-ops-alert
        type: slack
        settings:
          url: ${SLACK_WEBHOOK_URL}
          recipient: "#ops-alert"
          title: |
            [{{ .Status | toUpper }}] {{ .GroupLabels.alertname }}
          text: |
            *심각도:* {{ .CommonLabels.severity }}
            *서비스:* {{ .CommonLabels.job }}
            *요약:* {{ .CommonAnnotations.summary }}
            *Grafana:* {{ .ExternalURL }}
```

### 18.4 Jira 자동 티켓 생성

Grafana Alert → Slack 알림 → Slack Workflow → Jira API로 티켓 자동 생성

```
Critical 알림 발생 시:
1. Grafana → Slack #ops-alert 알림
2. Slack Workflow 자동 트리거
3. Jira REST API 호출 → 장애 티켓 생성
   - Project: CLOUDDX-OPS
   - Issue Type: Bug (Critical) / Task (Warning)
   - Priority: 알림 severity에 따라 자동 설정
   - Assignee: 당번 (Jira Automation Rule)
4. Slack 스레드에 Jira 티켓 링크 자동 회신
```

---

## 19. Kiali 대시보드 + AI 모니터링 요약

### 19.1 Kiali (Istio 시각화)

Kiali는 Monitoring VM에서 Docker로 운영하며, K8s API Server에 접근하여 Istio 메시 트래픽을 시각화합니다.

| 기능                    | 설명                                       |
| ----------------------- | ------------------------------------------ |
| Service Graph           | 서비스 간 트래픽 흐름 실시간 시각화        |
| Traffic Animation       | 요청 흐름 애니메이션 (성공/에러 색상 구분) |
| Health Check            | Pod/Service/Workload 상태 대시보드         |
| Istio Config Validation | VirtualService/DestinationRule 설정 검증   |
| mTLS 상태               | 서비스 간 mTLS 적용 여부 확인              |

### 19.2 AI 모니터링 요약 기능 (운영 페이지)

CloudDX 운영 페이지에 **AI 모니터링 요약 버튼**을 제공하여 운영자가 현재 시스템 상태를 자연어로 확인할 수 있게 합니다.

```
┌─────────────────────────────────────────────────┐
│              운영 대시보드                         │
│                                                 │
│  [메트릭 요약]  [로그 요약]  [트레이스 요약]  [통합 요약] │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │  AI 요약 결과:                              │  │
│  │                                            │  │
│  │  "현재 Backend API 평균 응답시간은 120ms로   │  │
│  │   정상 범위입니다. 최근 1시간 내 에러율은     │  │
│  │   0.02%이며, Kafka Consumer Lag는 0으로     │  │
│  │   모든 메시지가 정상 처리되고 있습니다.       │  │
│  │   Redis 히트율은 94%로 캐시 효율이 양호합니다."│  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

**구현 방식:**

1. Frontend 운영 페이지에서 요약 버튼 클릭
2. Backend가 Grafana API / Mimir API / Loki API를 호출하여 메트릭/로그 수집
3. 수집된 데이터를 Bedrock(Claude)에 프롬프트와 함께 전달
4. AI가 자연어로 요약하여 운영자에게 반환

| 요약 타입     | 데이터 소스        | 프롬프트 예시                                      |
| ------------- | ------------------ | -------------------------------------------------- |
| 메트릭 요약   | Mimir (Prometheus) | "최근 1시간 CPU/메모리/응답시간/에러율을 요약해줘" |
| 로그 요약     | Loki               | "최근 ERROR 레벨 로그를 분석하고 패턴을 요약해줘"  |
| 트레이스 요약 | Tempo              | "P95 응답시간이 긴 상위 5개 엔드포인트를 분석해줘" |
| 통합 요약     | 전체               | "전체 시스템 상태를 운영자 관점에서 브리핑해줘"    |

---

## 20. 하이브리드 데이터베이스 전략 (MariaDB + MongoDB)

### 20.1 데이터베이스 역할 분리

| 데이터                              | 저장소                        | 이유                                  |
| ----------------------------------- | ----------------------------- | ------------------------------------- |
| 회원정보 (이메일, 비밀번호, 닉네임) | **MariaDB** (외부 서버)       | ACID 보장, 유니크 제약, 관계형 무결성 |
| OAuth 연동 정보                     | **MariaDB** (외부 서버)       | 사용자 테이블과 외래키 관계           |
| 세션/로그인 이력                    | **MariaDB** (외부 서버)       | 트랜잭션 처리, 로그인 시도 횟수 제한  |
| 자산 포트폴리오                     | **MongoDB** (K8s StatefulSet) | 유연한 스키마, 자산별 다른 필드 구조  |
| AI 분석 결과                        | **MongoDB** (K8s StatefulSet) | 비정형 JSON 데이터, 문서 기반         |
| 거래 내역                           | **MongoDB** (K8s StatefulSet) | 문서형 저장, 자산과 같은 컬렉션       |
| 뉴스/시세 캐시                      | **Redis** / **Elasticsearch** | 실시간 캐싱 / 검색 인덱싱             |

### 20.2 MariaDB 접속 구성

```
┌─────────────────────────────────────┐
│        Kubernetes Cluster            │
│                                     │
│  ┌──────────────────┐               │
│  │  Backend Pod     │               │
│  │  (FastAPI)       │               │
│  │                  │   K8s Secret   │
│  │  SQLAlchemy ─────┼──(mariadb-    │
│  │  + PyMySQL       │   credentials)│
│  └────────┬─────────┘               │
│           │                          │
└───────────┼──────────────────────────┘
            │ TCP (IP:3306)
┌───────────▼──────────────────────────┐
│   학원 온프레미스 MariaDB 서버        │
│                                      │
│   Host: {학원 서버 IP}                │
│   Port: 3306                         │
│   Database: tutum_auth               │
│                                      │
│   Tables:                            │
│   ├── users (회원정보)                │
│   ├── oauth_providers (소셜 연동)     │
│   └── login_history (로그인 이력)     │
└──────────────────────────────────────┘
```

### 20.3 K8s에서 외부 MariaDB 접근

```yaml
# mariadb-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: mariadb-credentials
  namespace: tutum-app
type: Opaque
stringData:
  MARIADB_HOST: "{학원서버IP}"
  MARIADB_PORT: "3306"
  MARIADB_USER: "tutum_app"
  MARIADB_PASSWORD: "{password}"
  MARIADB_DATABASE: "tutum_auth"
---
# Backend Deployment에서 envFrom으로 주입
# SQLALCHEMY_DATABASE_URL = "mysql+pymysql://{user}:{password}@{host}:{port}/{db}"
```

### 20.4 데이터 흐름

```
[사용자] → Frontend → Backend
                        ├── 로그인/회원가입 → MariaDB (외부 서버, ACID)
                        ├── 자산 CRUD     → MongoDB (K8s StatefulSet)
                        ├── AI 분석       → MongoDB + Bedrock
                        ├── 시세 조회      → Redis 캐시 → KIS/Upbit API
                        └── 뉴스 검색      → Elasticsearch
```

---

## 21. 컨테이너 보안: Trivy + Cosign + Kyverno

### 21.1 보안 파이프라인 개요

```
┌─────────────────────────────────────────────────────────────────────┐
│                  Supply Chain Security Pipeline                      │
│                                                                     │
│  ┌──────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│  │Build │───▶│  Trivy   │───▶│  Cosign  │───▶│Registry  │          │
│  │Image │    │  Scan    │    │  Sign    │    │  Push    │          │
│  └──────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘          │
│                   │               │               │                 │
│            취약점 발견 시     서명 키로         서명+이미지           │
│            파이프라인 중단    이미지 서명       함께 저장             │
│                                                   │                 │
└───────────────────────────────────────────────────┼─────────────────┘
                                                    │ ArgoCD 배포
┌───────────────────────────────────────────────────▼─────────────────┐
│                    Kubernetes Cluster                                │
│                                                                     │
│  ┌──────────────────────────────────────────┐                      │
│  │  Kyverno Admission Controller             │                      │
│  │                                          │                      │
│  │  Policy: verify-image-signature           │                      │
│  │  - GitLab CR 이미지 서명 검증              │                      │
│  │  - 미서명 이미지 → 배포 차단 (DENY)        │                      │
│  │  - 서명 검증 통과 → 배포 허용 (ALLOW)      │                      │
│  └──────────────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 21.2 Trivy 취약점 스캔 (GitLab CI 스테이지)

```yaml
# .gitlab-ci.yml에 추가
# ============================================
# Stage: Security Scan (Trivy)
# ============================================
scan:trivy:backend:
  stage: scan
  image:
    name: aquasec/trivy:latest
    entrypoint: [""]
  script:
    # 이미지 취약점 스캔
    - trivy image --exit-code 1 --severity CRITICAL,HIGH
      --ignore-unfixed
      --format table
      $CI_IMAGE_REPO/backend:$CI_COMMIT_SHORT_SHA
    # SBOM(Software Bill of Materials) 생성
    - trivy image --format cyclonedx
      --output backend-sbom.json
      $CI_IMAGE_REPO/backend:$CI_COMMIT_SHORT_SHA
  artifacts:
    paths:
      - backend-sbom.json
    when: always
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      changes:
        - backend/**/*
  allow_failure: false # CRITICAL/HIGH 발견 시 파이프라인 중단

scan:trivy:frontend:
  stage: scan
  image:
    name: aquasec/trivy:latest
    entrypoint: [""]
  script:
    - trivy image --exit-code 1 --severity CRITICAL,HIGH
      --ignore-unfixed
      --format table
      $CI_IMAGE_REPO/frontend:$CI_COMMIT_SHORT_SHA
    - trivy image --format cyclonedx
      --output frontend-sbom.json
      $CI_IMAGE_REPO/frontend:$CI_COMMIT_SHORT_SHA
  artifacts:
    paths:
      - frontend-sbom.json
    when: always
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      changes:
        - frontend/**/*
  allow_failure: false
```

> **참고(옵션):** 기존 Harbor를 유지하는 조직은 Harbor의 통합 스캔을 보조로 병행할 수 있습니다. 본 문서 기준은 GitLab Registry 중심입니다.

### 21.3 Cosign 이미지 서명 (GitLab CI 스테이지)

```yaml
# .gitlab-ci.yml에 추가
# ============================================
# Stage: Image Signing (Cosign)
# ============================================
sign:backend:
  stage: sign # scan 다음 단계
  image: bitnami/cosign:latest
  script:
    - echo "$COSIGN_PRIVATE_KEY" > /tmp/cosign.key
    - cosign sign --key /tmp/cosign.key
      --yes
      $CI_IMAGE_REPO/backend:$CI_COMMIT_SHORT_SHA
    - rm -f /tmp/cosign.key
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      changes:
        - backend/**/*

sign:frontend:
  stage: sign
  image: bitnami/cosign:latest
  script:
    - echo "$COSIGN_PRIVATE_KEY" > /tmp/cosign.key
    - cosign sign --key /tmp/cosign.key
      --yes
      $CI_IMAGE_REPO/frontend:$CI_COMMIT_SHORT_SHA
    - rm -f /tmp/cosign.key
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      changes:
        - frontend/**/*
```

**Cosign 키 생성 (최초 1회):**

```bash
cosign generate-key-pair
# → cosign.key (Private, GitLab CI Variable에 저장)
# → cosign.pub (Public, Kyverno 정책에 사용)
```

### 21.4 Kyverno Admission Policy (서명 검증)

```yaml
# kyverno-policy.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-image-signature
spec:
  validationFailureAction: Enforce # 위반 시 배포 차단
  background: false
  rules:
    - name: verify-registry-images
      match:
        any:
          - resources:
              kinds:
                - Pod
              namespaces:
                - tutum-app
                - tutum-data
                - tutum-storage
      verifyImages:
        - imageReferences:
            - "registry.gitlab.com/tutum-project/*"
          attestors:
            - entries:
                - keys:
                    publicKeys: |-
                      -----BEGIN PUBLIC KEY-----
                      {cosign.pub 내용}
                      -----END PUBLIC KEY-----
          required: true
---
# 추가 정책: 취약점 있는 이미지 차단
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: block-vulnerable-images
spec:
  validationFailureAction: Audit # 초기에는 감사 모드, 이후 Enforce
  rules:
    - name: check-trivy-scan
      match:
        any:
          - resources:
              kinds:
                - Pod
              namespaces:
                - tutum-app
      validate:
        message: "이미지에 CRITICAL 취약점이 존재합니다. Trivy 스캔 통과 후 배포하세요."
        deny:
          conditions:
            any:
              - key: "{{request.object.metadata.labels.trivy-scan}}"
                operator: NotEquals
                value: "passed"
```

### 21.5 CI/CD 파이프라인 전체 스테이지 (보안 포함)

```
lint → test → scan(SonarQube) → build → scan(Trivy) → sign(Cosign) → push(Registry) → deploy(ArgoCD)
                                                                                          │
                                                                          Kyverno 서명 검증 후 배포 허용
```

| 스테이지    | 도구         | 차단 기준            |
| ----------- | ------------ | -------------------- |
| lint        | ESLint, Ruff | 문법/스타일 오류     |
| test        | pytest, Jest | 테스트 실패          |
| scan (품질) | SonarQube    | Quality Gate 미달    |
| build       | Docker       | 빌드 실패            |
| scan (보안) | Trivy        | CRITICAL/HIGH 취약점 |
| sign        | Cosign       | 서명 실패            |
| push        | GitLab Registry Push | Push 실패            |
| deploy      | ArgoCD       | -                    |
| admission   | Kyverno      | 미서명 이미지 차단   |

---

## 22. 부하 테스트: k6 + InfluxDB + Grafana

### 22.1 k6 vs ngrinder 비교 및 선택 근거

| 항목                | k6                                  | ngrinder                       | 판정                            |
| ------------------- | ----------------------------------- | ------------------------------ | ------------------------------- |
| **언어**            | JavaScript/TypeScript               | Jython/Groovy (JVM)            | **k6** (프론트엔드 개발자 친화) |
| **아키텍처**        | 단일 Go 바이너리 (~50MB)            | Controller + Agent (JVM, 1GB+) | **k6** (경량)                   |
| **CI/CD 통합**      | CLI 한 줄 (`k6 run test.js`)        | 별도 웹 UI 필요, REST API 연동 | **k6** (GitLab CI 네이티브)     |
| **메트릭 출력**     | InfluxDB, Prometheus, JSON 네이티브 | 자체 DB, CSV 수동 추출         | **k6** (Grafana 직접 연동)      |
| **Grafana 연동**    | 공식 k6 대시보드 제공               | 수동 설정 필요                 | **k6**                          |
| **스크립트 관리**   | Git 버전관리 (JS 파일)              | 웹 UI에서 관리                 | **k6** (GitOps 호환)            |
| **분산 테스트**     | k6-operator (K8s), k6 Cloud         | Controller-Agent 분산          | ngrinder 약간 우세              |
| **시나리오 유연성** | Stages, Scenarios, Thresholds       | 단순 증감 패턴                 | **k6**                          |
| **한국 커뮤니티**   | 글로벌 성장 중                      | 네이버 기반, 한국 대기업 사용  | ngrinder (한국 한정)            |
| **리소스 사용**     | ~50MB 메모리, 저부하                | JVM 기반 1GB+ 메모리           | **k6**                          |
| **Scale-to-Zero**   | 테스트 시에만 실행, 종료 후 자원 0  | Agent 상시 가동 필요           | **k6**                          |

**k6 선택 이유:**

1. **스택 통합**: 이미 사용 중인 Grafana + InfluxDB와 네이티브 연동 (대시보드 즉시 사용)
2. **CI/CD 호환**: GitLab CI에서 `k6 run` 한 줄로 실행, 테스트 스크립트도 Git 관리
3. **경량성**: Monitoring VM에 추가 부담 없음 (ngrinder는 JVM Controller + Agent로 1GB+ 필요)
4. **JavaScript 기반**: 프론트엔드 개발자도 테스트 시나리오 작성 가능
5. **Thresholds**: 성능 기준 미달 시 CI 파이프라인 자동 실패 가능

### 22.2 k6 테스트 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                    Monitoring VM                                 │
│                                                                 │
│  ┌──────────┐    ┌────────────┐    ┌──────────────────────────┐ │
│  │    k6    │───▶│  InfluxDB  │───▶│       Grafana            │ │
│  │ (테스트  │    │ (k6 결과   │    │  ┌──────────────────┐   │ │
│  │  실행기) │    │  저장소)   │    │  │  k6 Dashboard    │   │ │
│  └────┬─────┘    └────────────┘    │  │  - VU 수          │   │ │
│       │                            │  │  - RPS            │   │ │
│       │ HTTP Requests              │  │  - Response Time  │   │ │
│       │                            │  │  - Error Rate     │   │ │
└───────┼────────────────────────────│  │  - P95/P99        │   │ │
        │                            │  └──────────────────┘   │ │
        ▼                            └──────────────────────────┘ │
┌───────────────────────┐                                         │
│  Kubernetes Cluster   │                                         │
│  Istio Ingress GW     │                                         │
│  → Frontend/Backend   │                                         │
└───────────────────────┘                                         │
                                                                   │
│  결과 비교 대시보드:                                              │
│  - Before/After 성능 비교                                        │
│  - KEDA 스케일링 반응 시각화                                      │
│  - Circuit Breaker 트리거 확인                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 22.3 k6 테스트 시나리오

```javascript
// tests/load/api-load-test.js
import http from "k6/http";
import { check, sleep } from "k6";

// InfluxDB로 결과 전송: k6 run --out influxdb=http://localhost:8086/k6

export const options = {
  scenarios: {
    // 시나리오 1: 점진적 부하 증가
    ramp_up: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 50 }, // 2분간 50 VU까지 증가
        { duration: "5m", target: 50 }, // 5분간 50 VU 유지
        { duration: "2m", target: 100 }, // 100 VU까지 증가 (KEDA 트리거)
        { duration: "5m", target: 100 }, // 100 VU 유지
        { duration: "2m", target: 0 }, // 0으로 감소 (Scale-to-Zero 확인)
      ],
    },
    // 시나리오 2: 스파이크 테스트
    spike: {
      executor: "ramping-vus",
      startVUs: 0,
      startTime: "16m", // ramp_up 끝난 후 시작
      stages: [
        { duration: "10s", target: 200 }, // 갑작스러운 부하
        { duration: "1m", target: 200 },
        { duration: "10s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"], // P95 < 500ms, P99 < 1s
    http_req_failed: ["rate<0.05"], // 에러율 < 5%
    http_reqs: ["rate>100"], // 최소 100 RPS
  },
};

const BASE_URL = __ENV.BASE_URL || "https://tutum.local";

export default function () {
  // 1. 메인 페이지 로드
  const mainPage = http.get(`${BASE_URL}/`);
  check(mainPage, { "메인페이지 200": (r) => r.status === 200 });

  // 2. 시세 조회 (Redis 캐시 테스트)
  const price = http.get(`${BASE_URL}/api/v1/market/price/domestic/005930`);
  check(price, { "시세조회 200": (r) => r.status === 200 });

  // 3. 로그인 (Rate Limiting 테스트)
  const login = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({
      email: `test${__VU}@test.com`,
      password: "TestPassword123!",
    }),
    { headers: { "Content-Type": "application/json" } },
  );

  if (login.status === 200) {
    const token = JSON.parse(login.body).access_token;
    const headers = { Authorization: `Bearer ${token}` };

    // 4. 자산 목록 조회 (포트폴리오 캐시 테스트)
    const assets = http.get(`${BASE_URL}/api/v1/assets?user_id=test_user`, {
      headers,
    });
    check(assets, { "자산조회 200": (r) => r.status === 200 });

    // 5. AI 챗봇 (Bedrock Rate Limiting 테스트)
    const chat = http.post(
      `${BASE_URL}/api/v1/chat`,
      JSON.stringify({
        message: "삼성전자 분석해줘",
      }),
      { headers: { ...headers, "Content-Type": "application/json" } },
    );
    check(chat, { "챗봇 200": (r) => r.status === 200 });
  }

  sleep(1);
}
```

### 22.4 k6 실행 및 Grafana 연동

```bash
# Monitoring VM에서 실행

# 1. InfluxDB 설치 (Docker Compose에 추가)
# docker-compose.yml에 influxdb 서비스 추가

# 2. k6 실행 (결과를 InfluxDB로 전송)
k6 run --out influxdb=http://localhost:8086/k6 tests/load/api-load-test.js

# 3. Grafana에서 k6 공식 대시보드 임포트 (Dashboard ID: 2587)
# Data Source: InfluxDB (http://localhost:8086, DB: k6)
```

### 22.5 k6 + CI/CD 통합

```yaml
# .gitlab-ci.yml에 추가
load-test:
  stage: test
  image: grafana/k6:latest
  script:
    - k6 run
      --out influxdb=http://${MONITORING_VM_IP}:8086/k6
      --tag testrun=$CI_PIPELINE_ID
      tests/load/api-load-test.js
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      when: manual # 수동 트리거
  allow_failure: true # 부하 테스트 실패가 배포를 막지 않음 (리포트 목적)
```

### 22.6 검증 시나리오

| 시나리오      | k6 설정         | 검증 항목                        |
| ------------- | --------------- | -------------------------------- |
| 일반 부하     | 50 VU, 5분      | P95 응답시간 < 500ms             |
| KEDA 트리거   | 100 VU, 5분     | Backend Pod 2→6 스케일아웃       |
| Scale-to-Zero | 0 VU, 5분       | Worker Pod 자동 종료             |
| 스파이크      | 0→200 VU, 10초  | Circuit Breaker 작동 확인        |
| Karpenter     | 200 VU 유지     | 신규 노드 프로비저닝 (30초 이내) |
| Rate Limiting | 동일 IP 10회/분 | 429 Too Many Requests 반환       |

---

## 23. MetalLB (Bare-Metal LoadBalancer)

### 23.1 MetalLB 필요성

온프레미스(Bare-Metal) 환경에서는 AWS ELB/NLB 같은 클라우드 LoadBalancer가 없으므로, `Service type: LoadBalancer`를 사용하려면 **MetalLB**가 필요합니다.

### 23.2 IP 풀 설계

K8s 클러스터의 호스트 네트워크가 `192.168.0.0/24`이므로, 사용하지 않는 IP 대역을 MetalLB에 할당합니다.

```
현재 사용 중인 IP:
  192.168.0.1    - Gateway/Router
  192.168.0.220  - k8s-cp-1 (Control Plane)
  192.168.0.221  - k8s-cp-2 (Control Plane)
  192.168.0.222  - k8s-cp-3 (Control Plane)
  192.168.0.223  - k8s-worker1 (Worker)
  192.168.0.224  - k8s-worker2 (Worker)
  192.168.0.225  - k8s-worker3 (Worker)
  192.168.0.230  - monitoring (LGTM VM)
  192.168.0.231  - mongodb (MongoDB VM)
   (CI/CD: gitlab.com SaaS + monitoring VM(192.168.0.28)에 SonarQube 운영)
```

### 5대 환경용 포트/방화벽 가이드

| 항목 | 포트 | 허용 위치 | 비고 |
| --- | --- | --- | --- |
| 클러스터 API | 6443 | CP(3대) ↔ 워커/관리 Host | 클러스터 초기화/관리
| etcd peer | 2379~2380 | CP 간 내부 통신(192.168.0.0/24) | quorum 필수
| kubelet/Control APIs | 10250, 10257, 10259 | CP↔Worker | kubelet 상태 확인 및 노드 제어
| Kubernetes CNI | 179, 4789/udp | CP↔Worker | Calico VXLAN/BGP 운영
| MetalLB | 7946 | CP↔Worker | L2 Announce 동기화
| NodePort/서비스 | 80,443,30000-32767 | Ingress + API/포트포워딩 | 사용자/모니터링 접근
| SSH | 22 | 팀원/서버 관리망 | 운영 전용, 필요시만 개방

> 5대 분산 운영 기준: 각 VM은 내부 전용망(예: 192.168.0.0/24)에서 1:N 통신 가능해야 하며, 사내 방화벽에서 80/443(외부 공개) 외 포트를 최소화합니다.

> NAT가 불가피한 경우(PC 바깥 접근 필요):
> - SSH만 외부에 개방: `ssh -p 2220~2226` 형태로 host 포트 고정
>   - 2220: k8s-cp-1
>   - 2221: k8s-cp-2
>   - 2222: k8s-cp-3
>   - 2223: k8s-worker1
>   - 2224: mongodb
>   - 2225: k8s-worker2
>   - 2226: k8s-worker3
>   - 2230: monitoring
> - 물리 IP(접속 라우팅 예시): 192.168.0.28:2220/2230, 192.168.0.13:2221, 192.168.0.98:2222, 192.168.0.3:2223/2224, 192.168.0.14:2225/2226
> - 내부 서비스(80/443) 노출은 Ingress/방화벽 정책에 따라 1~2개 노드만 고정 개방

MetalLB 할당 대역: 192.168.0.240 ~ 192.168.0.250 (11개 IP)

### 23.3 MetalLB 설치 및 구성

```yaml
# metallb-system namespace에 설치
# helm install metallb metallb/metallb --namespace metallb-system --create-namespace

# metallb-config.yaml
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: tutum-pool
  namespace: metallb-system
spec:
  addresses:
    - 192.168.0.240-192.168.0.250
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: tutum-l2
  namespace: metallb-system
spec:
  ipAddressPools:
    - tutum-pool
```

> **L2 모드 선택 이유:** BGP 모드는 별도 라우터 설정이 필요하지만, L2 모드는 ARP 응답만으로 동작하므로 온프레미스 VirtualBox 환경에 적합합니다.

### 23.4 IP 할당 계획

| 서비스               | Service 타입 | 할당 IP            | 포트       | 용도                                  |
| -------------------- | ------------ | ------------------ | ---------- | ------------------------------------- |
| istio-ingressgateway | LoadBalancer | 192.168.0.240     | 80, 443    | 외부 트래픽 진입점 (Frontend/Backend) |
| registry-lb(optional) | LoadBalancer | 192.168.0.241     | 443         | registry 접근(옵션)                   |
| argocd-server        | LoadBalancer | 192.168.0.242     | 80, 443    | ArgoCD 웹 UI 접근                     |
| grafana-external     | LoadBalancer | 192.168.0.243     | 3000       | Monitoring VM Grafana 대시보드 접근   |
| 예비                 | -            | 192.168.0.244~250 | -          | 향후 확장용                           |

### 23.5 서비스별 LoadBalancer 설정

```yaml
# istio-ingressgateway (이미 Istio 설치 시 생성, IP 고정)
apiVersion: v1
kind: Service
metadata:
  name: istio-ingressgateway
  namespace: istio-system
  annotations:
    metallb.universe.tf/address-pool: tutum-pool
    metallb.universe.tf/loadBalancerIPs: "192.168.0.240"
spec:
  type: LoadBalancer
  ports:
    - name: http
      port: 80
      targetPort: 8080
    - name: https
      port: 443
      targetPort: 8443
  selector:
    istio: ingressgateway
---
# GitLab Registry LB (옵션: 외부에서 registry 접근이 필요한 경우)
apiVersion: v1
kind: Service
metadata:
  name: registry-lb
  namespace: kube-system
  annotations:
    metallb.universe.tf/loadBalancerIPs: "192.168.0.241"
spec:
  type: LoadBalancer
  ports:
    - name: https
      port: 443
      targetPort: 5005
  selector:
    app: gitlab-registry
---
# ArgoCD Server LoadBalancer
apiVersion: v1
kind: Service
metadata:
  name: argocd-server-lb
  namespace: argocd
  annotations:
    metallb.universe.tf/loadBalancerIPs: "192.168.0.242"
spec:
  type: LoadBalancer
  ports:
    - name: http
      port: 80
      targetPort: 8080
    - name: https
      port: 443
      targetPort: 8080
  selector:
    app.kubernetes.io/name: argocd-server
```

### 23.6 MetalLB + Istio 트래픽 흐름

```
[사용자 브라우저]
      │
      │ http://192.168.0.240 (tutum.local)
      ▼
┌──────────────────────────────┐
│  MetalLB L2 Advertisement    │
│  ARP 응답: 192.168.0.240    │
│  → Worker Node로 라우팅      │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│  istio-ingressgateway Pod    │
│  (LoadBalancer Service)      │
│  Port 80/443                 │
└──────────────┬───────────────┘
               │ Istio VirtualService 라우팅
         ┌─────┴──────┐
         │            │
         ▼            ▼
   ┌──────────┐ ┌──────────┐
   │ Frontend │ │ Backend  │
   │ /*, port │ │ /api/*,  │
   │ 3000     │ │ port 8000│
   └──────────┘ └──────────┘
```

---

## 24. Canary / Blue-Green 배포 전략

### 24.1 배포 전략 비교

| 전략               | 원리                               | 장점                   | 단점                 | 적용 대상            |
| ------------------ | ---------------------------------- | ---------------------- | -------------------- | -------------------- |
| **Rolling Update** | Pod를 순차적으로 교체              | 간단, K8s 기본 지원    | 롤백 느림, 전체 전환 | Workers, StatefulSet |
| **Canary**         | 신규 버전에 일부 트래픽만 전달     | 점진적 검증, 빠른 롤백 | Istio 설정 필요      | **Backend (채택)**   |
| **Blue-Green**     | 구/신 버전 동시 운영, 한 번에 전환 | 즉시 롤백 가능         | 2배 리소스 필요      | **Frontend (채택)**  |

### 24.2 Backend: Canary 배포 (Istio 기반)

Backend는 API 서버이므로 Canary로 **일부 트래픽을 신규 버전에 보내 검증** 후 전환합니다.

```yaml
# backend-canary-virtualservice.yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: backend-canary
  namespace: tutum-app
spec:
  hosts:
    - backend-svc
  http:
    - route:
        # 90% → 기존 안정 버전 (v1)
        - destination:
            host: backend-svc
            subset: stable
          weight: 90
        # 10% → 신규 Canary 버전 (v2)
        - destination:
            host: backend-svc
            subset: canary
          weight: 10
---
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: backend-subsets
  namespace: tutum-app
spec:
  host: backend-svc
  subsets:
    - name: stable
      labels:
        version: stable
    - name: canary
      labels:
        version: canary
```

**Canary 배포 절차:**

```
1. 신규 이미지 빌드 + Trivy/Cosign → Registry Push
2. Canary Deployment 배포 (label: version=canary, replicas: 1)
3. VirtualService weight 조정: stable 90% / canary 10%
4. Grafana 대시보드에서 canary 에러율/응답시간 모니터링
5. 정상 → weight 변경: 70/30 → 50/50 → 0/100
6. 이상 → canary Deployment 삭제, weight 100/0 복구
7. 완료 → stable Deployment 이미지 업데이트, canary 삭제
```

```yaml
# backend-canary-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend-canary
  namespace: tutum-app
spec:
  replicas: 1 # Canary는 최소 1개만 운영
  selector:
    matchLabels:
      app: backend
      version: canary
  template:
    metadata:
      labels:
        app: backend
        version: canary
    spec:
      containers:
        - name: backend
          image: registry.gitlab.com/tutum-project/tutum-app/backend:v2.0.0-rc1
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: 300m
              memory: 512Mi
            limits:
              cpu: 1000m
              memory: 1Gi
```

### 24.3 Frontend: Blue-Green 배포

Frontend는 정적 빌드물이므로 Blue-Green으로 **즉시 전환/롤백**합니다.

```yaml
# frontend-blue-green.yaml
# Blue (현재 운영 버전)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend-blue
  namespace: tutum-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
      version: blue
  template:
    metadata:
      labels:
        app: frontend
        version: blue
    spec:
      containers:
        - name: frontend
          image: registry.gitlab.com/tutum-project/tutum-app/frontend:v1.0.0
          ports:
            - containerPort: 3000
---
# Green (신규 버전, 대기)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend-green
  namespace: tutum-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
      version: green
  template:
    metadata:
      labels:
        app: frontend
        version: green
    spec:
      containers:
        - name: frontend
          image: registry.gitlab.com/tutum-project/tutum-app/frontend:v2.0.0
          ports:
            - containerPort: 3000
```

```yaml
# frontend-virtualservice.yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: frontend-bluegreen
  namespace: tutum-app
spec:
  hosts:
    - frontend-svc
  http:
    - route:
        # 전환: blue 100% → green 100%로 한 번에 변경
        - destination:
            host: frontend-svc
            subset: blue # ← 전환 시 green으로 변경
          weight: 100
---
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: frontend-subsets
  namespace: tutum-app
spec:
  host: frontend-svc
  subsets:
    - name: blue
      labels:
        version: blue
    - name: green
      labels:
        version: green
```

**Blue-Green 배포 절차:**

```
1. Green Deployment 배포 (신규 버전, replicas: 2)
2. Green Pod 정상 기동 확인 (Readiness Probe 통과)
3. 내부 테스트: Green subset으로 직접 트래픽 보내 검증
4. VirtualService 전환: blue → green (즉시 전환)
5. 이상 시 즉시 롤백: green → blue (1초 이내)
6. 안정화 후 Blue Deployment 삭제하여 리소스 회수
```

### 24.4 서비스별 배포 전략 요약

| 서비스           | 배포 전략          | 이유                                        |
| ---------------- | ------------------ | ------------------------------------------- |
| Frontend         | **Blue-Green**     | 정적 빌드물, 즉시 전환/롤백, UI 일관성      |
| Backend          | **Canary**         | API 서버, 점진적 검증 필요, 에러율 모니터링 |
| Workers          | **Rolling Update** | 백그라운드 처리, 사용자 영향 없음           |
| StatefulSet (DB) | **Rolling Update** | K8s 기본, 데이터 무결성 (OrderedReady)      |

### 24.5 Canary 모니터링 (Grafana 대시보드)

Canary 배포 시 Grafana에서 아래 메트릭을 비교 모니터링합니다:

| 메트릭       | Stable (v1) | Canary (v2)         | 판단 기준                   |
| ------------ | ----------- | ------------------- | --------------------------- |
| 에러율 (5xx) | 0.1%        | **> 1%** → 롤백     | Canary가 10x 이상이면 중단  |
| P95 응답시간 | 200ms       | **> 500ms** → 롤백  | Canary가 2.5x 이상이면 중단 |
| P99 응답시간 | 400ms       | **> 1000ms** → 롤백 | 1초 초과 시 중단            |
| CPU 사용률   | 30%         | **> 80%** → 롤백    | 비정상 리소스 소모          |

```promql
# Grafana에서 사용할 Canary 비교 쿼리 (Istio 메트릭)
# Stable 에러율
sum(rate(istio_requests_total{destination_version="stable",response_code=~"5.."}[5m]))
/ sum(rate(istio_requests_total{destination_version="stable"}[5m]))

# Canary 에러율
sum(rate(istio_requests_total{destination_version="canary",response_code=~"5.."}[5m]))
/ sum(rate(istio_requests_total{destination_version="canary"}[5m]))
```

---

## 25. Backup / Disaster Recovery 전략

### 25.1 백업 대상 및 주기

| 대상          | 백업 방식                    | 주기        | 보관 기간 | 저장 위치                      |
| ------------- | ---------------------------- | ----------- | --------- | ------------------------------ |
| MongoDB       | mongodump → gzip → MinIO     | 매일 02:00  | 30일      | MinIO `backups/mongodb/`       |
| MariaDB       | mysqldump → gzip → MinIO     | 매일 02:00  | 30일      | MinIO `backups/mariadb/`       |
| Redis         | RDB 스냅샷 (BGSAVE)          | 매 6시간    | 7일       | PV 내 + MinIO 복사             |
| Elasticsearch | Snapshot API → MinIO         | 매일 03:00  | 14일      | MinIO `backups/elasticsearch/` |
| etcd          | etcdctl snapshot save        | 매일 01:00  | 14일      | MinIO `backups/etcd/`          |
| K8s Manifests | Git (ArgoCD 매니페스트 레포) | 커밋 단위   | 무제한    | GitLab                         |
| (옵션) Harbor        | 이미지+DB 백업(레거시)        | 매주 일요일 | 4주       | MinIO `backups/harbor/`        |

### 25.2 MongoDB 자동 백업 (CronJob)

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: mongodb-backup
  namespace: tutum-data
spec:
  schedule: "0 2 * * *" # 매일 02:00 UTC
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: mongo:7
              command:
                - /bin/sh
                - -c
                - |
                  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
                  BACKUP_FILE="mongodb_${TIMESTAMP}.gz"

                  # mongodump 실행
                  mongodump \
                    --host=mongodb-svc.tutum-data.svc.cluster.local:27017 \
                    --username=$MONGO_USER \
                    --password=$MONGO_PASSWORD \
                    --db=tutum \
                    --archive=/tmp/${BACKUP_FILE} \
                    --gzip

                  # MinIO에 업로드 (mc 클라이언트)
                  mc alias set minio http://minio-api.tutum-storage.svc:9000 \
                    $MINIO_ACCESS_KEY $MINIO_SECRET_KEY
                  mc cp /tmp/${BACKUP_FILE} minio/backups/mongodb/${BACKUP_FILE}

                  # 30일 이전 백업 삭제
                  mc rm --older-than 30d --recursive minio/backups/mongodb/

                  echo "[OK] MongoDB backup completed: ${BACKUP_FILE}"
              envFrom:
                - secretRef:
                    name: mongodb-credentials
                - secretRef:
                    name: minio-credentials
          restartPolicy: OnFailure
```

### 25.3 MariaDB 자동 백업 (CronJob)

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: mariadb-backup
  namespace: tutum-app
spec:
  schedule: "0 2 * * *" # 매일 02:00 UTC
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: mariadb:11
              command:
                - /bin/sh
                - -c
                - |
                  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
                  BACKUP_FILE="mariadb_tutum_auth_${TIMESTAMP}.sql.gz"

                  # mysqldump 실행 (외부 MariaDB 서버)
                  mysqldump \
                    -h $MARIADB_HOST \
                    -P $MARIADB_PORT \
                    -u $MARIADB_USER \
                    -p"$MARIADB_PASSWORD" \
                    --single-transaction \
                    --routines \
                    --triggers \
                    $MARIADB_DATABASE | gzip > /tmp/${BACKUP_FILE}

                  # MinIO에 업로드
                  mc alias set minio http://minio-api.tutum-storage.svc:9000 \
                    $MINIO_ACCESS_KEY $MINIO_SECRET_KEY
                  mc cp /tmp/${BACKUP_FILE} minio/backups/mariadb/${BACKUP_FILE}

                  # 30일 이전 백업 삭제
                  mc rm --older-than 30d --recursive minio/backups/mariadb/

                  echo "[OK] MariaDB backup completed: ${BACKUP_FILE}"
              envFrom:
                - secretRef:
                    name: mariadb-credentials
                - secretRef:
                    name: minio-credentials
          restartPolicy: OnFailure
```

### 25.4 etcd 백업 (Control Plane)

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: etcd-backup
  namespace: kube-system
spec:
  schedule: "0 1 * * *" # 매일 01:00
  jobTemplate:
    spec:
      template:
        spec:
          nodeSelector:
            node-role.kubernetes.io/control-plane: ""
          tolerations:
            - key: node-role.kubernetes.io/control-plane
              effect: NoSchedule
          hostNetwork: true
          containers:
            - name: backup
              image: registry.k8s.io/etcd:3.5.12-0
              command:
                - /bin/sh
                - -c
                - |
                  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
                  etcdctl snapshot save /backup/etcd_${TIMESTAMP}.db \
                    --endpoints=https://127.0.0.1:2379 \
                    --cacert=/etc/kubernetes/pki/etcd/ca.crt \
                    --cert=/etc/kubernetes/pki/etcd/server.crt \
                    --key=/etc/kubernetes/pki/etcd/server.key

                  etcdctl snapshot status /backup/etcd_${TIMESTAMP}.db --write-out=table
                  echo "[OK] etcd backup: etcd_${TIMESTAMP}.db"
              volumeMounts:
                - name: etcd-certs
                  mountPath: /etc/kubernetes/pki/etcd
                  readOnly: true
                - name: backup-dir
                  mountPath: /backup
          volumes:
            - name: etcd-certs
              hostPath:
                path: /etc/kubernetes/pki/etcd
            - name: backup-dir
              hostPath:
                path: /var/backups/etcd
          restartPolicy: OnFailure
```

### 25.5 복구 절차 (Disaster Recovery)

| 장애 시나리오           | 복구 절차                                   | RTO    | RPO                        |
| ----------------------- | ------------------------------------------- | ------ | -------------------------- |
| **Pod 비정상 종료**     | K8s 자동 재시작 (RestartPolicy)             | ~30초  | 0 (무손실)                 |
| **Node 장애**           | Karpenter 신규 노드 프로비저닝 → Pod 재배치 | ~1분   | 0 (무손실)                 |
| **MongoDB 데이터 손실** | MinIO에서 최근 백업 다운로드 → mongorestore | ~15분  | 최대 24시간                |
| **MariaDB 데이터 손실** | MinIO에서 최근 백업 → mysql import          | ~10분  | 최대 24시간                |
| **Redis 데이터 손실**   | 자동 복구 (캐시이므로 재생성) 또는 RDB 복원 | ~1분   | 6시간 (캐시 특성상 무손실) |
| **etcd 손상**           | etcdctl snapshot restore → 클러스터 재구성  | ~30분  | 최대 24시간                |
| **전체 클러스터 손실**  | ArgoCD 매니페스트 레포에서 클러스터 재구축  | ~2시간 | Git 기준 무손실            |
| **잘못된 배포**         | ArgoCD 롤백 또는 Canary 트래픽 0% 전환      | ~1분   | 0 (무손실)                 |

### 25.6 백업 모니터링

```yaml
# Grafana Alert: 백업 실패 시 Slack 알림
# CronJob 실패 감지 쿼리 (Mimir/Prometheus)
# kube_job_status_failed{namespace=~"tutum-.*", job_name=~".*backup.*"} > 0
```

| 알림 조건          | 심각도   | 채널                          |
| ------------------ | -------- | ----------------------------- |
| CronJob 실패       | Critical | Slack #ops-alerts             |
| 백업 파일 크기 0   | Warning  | Slack #ops-alerts             |
| MinIO 사용량 > 80% | Warning  | Slack #ops-alerts             |
| 3일 연속 백업 누락 | Critical | Slack #ops-alerts + Jira 티켓 |

---

## 참고사항

- MongoDB는 Atlas(임시)에서 K8s 로컬 StatefulSet으로 전환 (AWS 마이그레이션 시 별도 EC2에 배치 예정)
- MariaDB는 학원 온프레미스 서버를 사용 (회원/인증 전용, AWS 마이그레이션 시 RDS로 전환 예정)
- Harbor는 레거시/옵션 구성으로만 별도 운영 검토(필수 아키텍처에서 제외)
- 각 Phase는 이전 Phase 완료 후 순차 진행
- Stateful 서비스 마이그레이션 시 데이터 백업 필수 (Section 25 참조)
- 프로덕션 전환 전 Staging 환경에서 충분한 검증 필요
- 컨테이너 이미지는 Trivy 스캔 + Cosign 서명을 통과해야 배포 가능
- MetalLB IP 풀: 192.168.0.240~250 (Section 23 참조)
- Backend는 Canary 배포, Frontend는 Blue-Green 배포 전략 적용 (Section 24 참조)



