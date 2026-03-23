# 📊 LGTM Migration 진척 보고서

> **Author**: Ruby Kim  
> **기준일**: 2026-02-26  
> **기간**: 2026-02-19 멘토링 이후 ~ 현재  
> **대상**: Tutum 프로젝트 K8s 마이그레이션 (LGTM 스택 포함)  
> ⚠️ **원격 저장소**: **GitLab 단일 운영** — 소스코드 / 레지스트리 / CI/CD 전부 GitLab

---

## 전체 마이그레이션 로드맵

```
Phase 0: 설계 (완료)
    ↓
Phase 1: 클러스터 기반 (완료 ✅)
    MetalLB + Namespace + Istio Gateway
    ↓
Phase 2: 앱 배포/레지스트리 전환 (진행 중 🔄)
    ArgoCD + GitLab CI/CD + Registry 전환(GitLab CR -> AWS ECR) + Backend/Frontend
    ↓
Phase 3: 모니터링 (진행 중 🔄)
    LGTM Stack (Loki / Grafana / Tempo / Mimir)
    ↓
Phase 4: 고도화 (예정)
    SonarQube / Kyverno / Cloudflare
```

---

## Phase 1: 클러스터 기반 구성 ✅

### 1-1. MetalLB + Namespace

| 항목            | 내용                                                                          |
| --------------- | ----------------------------------------------------------------------------- |
| IP Pool         | `192.168.56.100 - 192.168.56.110` (VirtualBox Host-only)                      |
| Ingress 외부 IP | `192.168.56.100` (MetalLB 자동 할당)                                          |
| 생성 Namespace  | `tutum-app`, `tutum-data`, `tutum-storage`, `monitoring`, `argocd`, `kyverno` |

```
k8s-manifests/step1-metallb/
├── 01-metallb-ippool.yaml     ← IPAddressPool + L2Advertisement
├── 02-namespaces.yaml         ← 6개 네임스페이스
└── README.md
```

**상태**: ✅ 클러스터에 적용 완료

---

### 1-2. Istio Gateway + Ingress

| 항목               | 내용                                                       |
| ------------------ | ---------------------------------------------------------- |
| Ingress Controller | Istio Gateway (Nginx에서 전환)                             |
| 도메인             | `tutum.my` (Cloudflare DNS 연동)                           |
| 라우팅             | `/api/*` → `backend-svc:8000` / `/*` → `frontend-svc:3000` |
| WebSocket          | `upgrade`, `connection` 헤더 pass-through 설정             |

```
k8s-manifests/base/networking/
├── gateway.yaml               ← Istio Gateway (80/443)
├── virtualservice.yaml        ← 경로 라우팅 규칙
└── destination-rule.yaml      ← 트래픽 정책
```

**주요 이슈**: VirtualService rewrite 중복으로 403 발생 → prefix rewrite 단순화로 해결  
**상태**: ✅ 완료 (`tutum.my` 정상 접근 확인)

---

## Phase 2: 앱 배포 및 GitOps ✅

### 2-1. 레지스트리 운영 전환 이력

| 단계 | 레지스트리 | 상태 |
| --- | --- | --- |
| 초기 온프레 단계 | Harbor(온프레미스) | 종료 |
| 현재 운영 단계 | GitLab Container Registry | 운영 중 |
| AWS 이행 단계 | Amazon ECR (`903913341620.dkr.ecr.ap-northeast-2.amazonaws.com`) | 진행 중 |

**현재 원칙**:
- 소스코드/CI-CD: GitLab 단일 운영
- AWS 배포 레지스트리: ECR 고정 (`develop/main -> ECR -> EKS`)
- Harbor: 신규 운영 미사용(히스토리 기록만 유지)

**이미지 경로 기준**:

| 서비스 | GitLab(현행) | ECR(목표/이행 중) |
| --- | --- | --- |
| frontend | `registry.gitlab.com/<group>/<project>/frontend:<tag>` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/tutum/frontend:<tag>` |
| backend | `registry.gitlab.com/<group>/<project>/backend:<tag>` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/tutum/backend:<tag>` |
| workers | `registry.gitlab.com/<group>/<project>/<worker>:<tag>` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/tutum/<worker>:<tag>` |

---

### 2-2. ArgoCD GitOps

```
k8s-manifests/argocd/
├── staging-app.yaml      ← tutum-staging: 자동 sync (prune + selfHeal)
└── production-app.yaml   ← tutum-production: 수동 승인 후 sync
```

| 환경       | 네임스페이스       | Sync 정책               | Git 소스 (GitLab) |
| ---------- | ------------------ | ----------------------- | ----------------- |
| staging    | `tutum-staging`    | 자동 (ArgoCD auto-sync) | `develop` 브랜치  |
| production | `tutum-production` | **수동** (운영 안전)    | `main` 브랜치     |

> ArgoCD Git 소스: `http://192.168.56.12:8929/root/k8s-manifests.git` **(GitLab)**

**상태**: ✅ staging 자동 배포 운영 중

---

### 2-3. 뉴스 파이프라인 K8s 이관

node3에서 Docker Compose로 운영되던 뉴스 파이프라인을 K8s 매니페스트로 이관.

```
k8s-manifests/base/workers/
├── news-producer.yaml      ← workload=app 노드 고정
├── news-consumer.yaml      ← workload=app
├── elastic-consumer.yaml   ← workload=app
├── news-configmap.yaml     ← Kafka 토픽/엔드포인트 설정
└── news-secret.yaml        ← AWS/Mongo 민감 정보

k8s-manifests/base/data/
├── elasticsearch.yaml      ← StatefulSet + Service, workload=data
└── kibana.yaml             ← Deployment + Service, workload=data
```

| 항목            | 값                         |
| --------------- | -------------------------- |
| Kafka 토픽      | `news.raw`                 |
| Consumer 그룹 1 | `clouddx-news-consumer-v1` |
| Consumer 그룹 2 | `indexer-consumer-group`   |

**상태**: ✅ 매니페스트 작성 완료, 클러스터 적용 확인 중

---

## Phase 3: LGTM 모니터링 스택 🔄

### 3-1. 모니터링 VM 구성 (192.168.56.30)

> Docker Compose 기반으로 모니터링 전용 VM에 배포

| 서비스      | 포트      | 역할                               | 상태       |
| ----------- | --------- | ---------------------------------- | ---------- |
| **Loki**    | 3100      | 로그 수집/저장 (30일 보존)         | ✅ 운영 중 |
| **Grafana** | 3000      | 시각화 대시보드                    | ✅ 운영 중 |
| **Tempo**   | 4317/4318 | 분산 트레이싱 (OTLP gRPC/HTTP)     | ✅ 운영 중 |
| **Mimir**   | 9009      | 메트릭 장기 저장 (Prometheus 호환) | ✅ 운영 중 |
| InfluxDB    | 8086      | 시계열 DB (보조)                   | ✅ 운영 중 |

```
k8s-manifests/step3-lgtm/monitoring-vm/
├── docker-compose.yml
├── loki/config.yml
├── tempo/config.yml
├── mimir/config.yml
└── grafana/
    ├── provisioning/datasources/datasources.yml   ← 자동 프로비저닝
    └── provisioning/dashboards/
        ├── tutum-k8s-overview.json               ← K8s 클러스터 전체 현황
        └── tutum-data-layer.json                 ← DB/Kafka/Redis 모니터링
```

---

### 3-2. K8s 클러스터 → 모니터링 VM 수집 구조

```
┌─────────────────────────────────────────────────────┐
│              K8s 클러스터 (192.168.56.0/24)          │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │  node1   │  │  node2   │  │  node3   │            │
│  │          │  │          │  │          │            │
│  │ [Alloy]  │  │ [Alloy]  │  │ [Alloy]  │  DaemonSet │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
│       │              │              │                  │
│       └──────────────┴──────────────┘                  │
│                       │                               │
│              메트릭/로그/트레이스 수집                  │
└───────────────────────┼─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│          모니터링 VM (192.168.56.30)                 │
│                                                       │
│  Loki ←── 로그   Tempo ←── 트레이스  Mimir ←── 메트릭 │
│                           ↓                          │
│                      Grafana (시각화)                 │
└─────────────────────────────────────────────────────┘
```

---

### 3-3. Grafana 대시보드 구성

#### 📊 tutum-k8s-overview.json — K8s 클러스터 전체 현황

| 패널                 | 데이터소스 | 설명                       |
| -------------------- | ---------- | -------------------------- |
| Pod 상태 카운트      | Mimir      | Running / Failed / Pending |
| 노드 CPU/메모리      | Mimir      | 노드별 사용률              |
| API RPS              | Mimir      | 초당 요청 수               |
| 5xx 에러율           | Mimir      | 에러 비율                  |
| P50/P95/P99 레이턴시 | Mimir      | 응답 시간 분포             |
| Kafka Consumer Lag   | Mimir      | 파이프라인 지연            |
| Backend 로그         | Loki       | 실시간 로그 스트림         |

#### 📊 tutum-data-layer.json — 데이터 레이어

| 패널               | 데이터소스 | 설명                      |
| ------------------ | ---------- | ------------------------- |
| Redis 메모리       | Mimir      | 사용량 / 히트율 / 연결 수 |
| Kafka Lag (토픽별) | Mimir      | `news.raw` 토픽 lag       |
| ES 인덱싱 처리량   | Mimir      | 초당 인덱싱 건수          |
| ES JVM 힙 메모리   | Mimir      | GC 압박 여부 모니터링     |

---

### 3-4. 현재 미완료 항목 (Phase 3)

| 항목                           | 상태       | 비고                            |
| ------------------------------ | ---------- | ------------------------------- |
| Alloy DaemonSet 클러스터 배포  | 🔄 진행 중 | 모든 노드 수집 확인 필요        |
| Grafana 대시보드 실데이터 연동 | 🔄 진행 중 | Mock → 실 Mimir 데이터 전환     |
| Tempo 트레이싱 앱 연동         | ⏳ 예정    | FastAPI OpenTelemetry 설정 필요 |

---

## Phase 4: 고도화 (예정)

| 항목                        | 우선순위 | 설명                               |
| --------------------------- | -------- | ---------------------------------- |
| SonarQube 안정화            | 높음     | K8s 내 배포, CI 연동               |
| Kyverno Cosign 정책         | 중간     | 이미지 서명 검증 (키 쌍 생성 필요) |
| Cloudflare 도메인 정식 반영 | 높음     | `tutum.my` DNS/SSL 최종 점검       |
| AWS SES/SQS 온프레미스 대체 | 중간     | 이메일 인증 경로 검토              |

---

## 전체 진척 요약

```
Phase 1 (기반)     ████████████████████ 100% ✅
Phase 2 (앱 배포)  ████████████████░░░░  80% 🔄 (뉴스 파이프라인 클러스터 검증 중)
Phase 3 (LGTM)    ████████████░░░░░░░░  60% 🔄 (Alloy 수집 → 대시보드 실연동 남음)
Phase 4 (고도화)   ████░░░░░░░░░░░░░░░░  20% ⏳ (SonarQube 기동 확인 완료)
```
