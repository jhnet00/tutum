# Work Plan: Admin 대시보드 전면 개편 (모던 UI + 그래프 시각화)

> 작성일: 2026-03-03
> 브랜치: `develop`
> 담당: kyk02405

---

## 목표

현재 Admin 페이지를 Grafana/Datadog 수준의 실시간 모니터링 대시보드로 전면 개편한다.

| 항목 | 현재 | 목표 |
|------|------|------|
| UI 스타일 | 텍스트+게이지바 위주 | 모던 다크 대시보드, 카드+그래프 |
| 탭 구조 | 파드 \| 파이프라인 \| 로그 \| AI | **Overview \| Infra \| Pipeline \| Logs \| Traces \| AI** |
| 차트 | 없음 | Recharts 기반 라인/바/도넛 차트 |
| 메트릭 탭 | `/admin/metrics` 구현됐지만 미사용 | Overview 탭에서 RPS·레이턴시·에러율 시계열 표시 |
| 파이프라인 워커 | 3개 하드코딩 | 전체 7개 워커 (price/email/ocr 포함) |
| 스토리지 | 없음 | PVC 용량·사용률 카드 |
| 데이터 레이어 메트릭 | 없음 | Kafka/Redis/ES Mimir 쿼리 카드+그래프 |
| 트레이스 | 없음 | Tempo 쿼리 슬로우 요청 테이블 |

---

## 신규 탭 구조 및 화면 설계

```
┌─────────────────────────────────────────────────────────────────┐
│ ⬡ Tutum Admin          🟢 Cluster OK   02:15:34  ↺ 30s        │
├────────────────────────────────────────────────────────────────-┤
│ [Overview] [Infra] [Pipeline] [Logs] [Traces] [✦ AI]           │
├─────────────────────────────────────────────────────────────────┤
│  Overview 탭                                                     │
│  ┌─KPI────┐ ┌─KPI────┐ ┌─KPI────┐ ┌─KPI────┐                  │
│  │ RPS    │ │P95 ms  │ │Err %   │ │Kafka Lag│                  │
│  │ 24.3   │ │ 138    │ │ 0.2%   │ │   0    │                  │
│  │▁▂▃▄▃▂▁│ │▁▂▄▃▂▁▂│ │▁▁▁▁▁▂▁│ │▁▁▁▁▁▁▁│                  │
│  └────────┘ └────────┘ └────────┘ └────────┘                  │
│  ┌── RPS / Latency 60분 라인차트 ────────────────────────────┐  │
│  │  recharts <LineChart> - 두 Y축, 12포인트 5분 간격         │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌── 에러율 바차트 ──┐ ┌── Kafka Consumer Lag ──────────────┐  │
│  │  recharts BarChart│ │  recharts AreaChart               │  │
│  └───────────────────┘ └────────────────────────────────────┘  │
│                                                                  │
│  Infra 탭                                                        │
│  ┌── 노드 리소스 그리드 ──────────────────────────────────────┐  │
│  │  cp-1 ████░░ 42%CPU  ████████ 78%MEM  192.168.0.221      │  │
│  │  worker1 ██░░ 25%CPU ████░░░ 62%MEM   192.168.0.223      │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌── PVC 스토리지 ───┐ ┌── 파드 상태 도넛 ──────────────────┐  │
│  │  MongoDB  30Gi OK │ │  Running 88 / Pending 0 / Fail 0  │  │
│  │  Kafka    20Gi OK │ │  recharts PieChart                 │  │
│  │  Redis     5Gi OK │ │                                    │  │
│  │  ES       30Gi OK │ │                                    │  │
│  └───────────────────┘ └────────────────────────────────────┘  │
│  ┌── 파드 테이블 (namespace 필터) ────────────────────────────┐  │
│  │  이름 | 네임스페이스 | 상태 | Ready | Restart | Node | Age│  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Pipeline 탭 (7 워커 전체)                                       │
│  뉴스: 📡→🗄️→🔍  시세: 📈→💰  기타: 📧 OCR                    │
│  ┌── MongoDB stats ──┐ ┌── ES stats ────┐ ┌── Redis/Kafka ──┐  │
│  │ Total: 5,479      │ │ Indexed: 5,321 │ │ Lag: 0          │  │
│  │ +1h: 47           │ │ 97.1% sync     │ │ Hit rate: 94%   │  │
│  └───────────────────┘ └────────────────┘ └─────────────────┘  │
│                                                                  │
│  Traces 탭                                                       │
│  ┌── 최근 슬로우 요청 Top 10 ─────────────────────────────────┐  │
│  │  서비스 | 엔드포인트 | Duration | 상태 | 시각              │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 구현 범위

### Phase 1: Backend 보완 (admin.py)

#### 1-1. 전체 워커 목록 수정

**파일**: `backend/app/routers/admin.py`

`PIPELINE_WORKERS` 상수를 7개 전체로 확장:
```python
NEWS_WORKERS   = ["news-producer", "news-consumer", "elastic-consumer"]
PRICE_WORKERS  = ["price-producer", "price-consumer"]
OTHER_WORKERS  = ["email-worker", "ocr-worker"]
ALL_WORKERS    = NEWS_WORKERS + PRICE_WORKERS + OTHER_WORKERS
```

파이프라인 AI 진단 시스템 프롬프트도 전체 워커 반영.

#### 1-2. PVC 상태 엔드포인트 추가

**새 엔드포인트**: `GET /api/v1/admin/storage`

```python
# K8s API: core.list_persistent_volume_claim_for_all_namespaces()
# 반환:
{
  "pvcs": [
    {
      "name": "mongodb-pvc",
      "namespace": "tutum-data",
      "status": "Bound",        # Bound / Pending / Lost
      "capacity": "30Gi",
      "storage_class": "local-path",
      "volume": "pvc-xxxx"
    }
  ]
}
```

#### 1-3. 데이터 레이어 메트릭 엔드포인트 추가

**새 엔드포인트**: `GET /api/v1/admin/data-metrics`

Mimir에서 쿼리:
- **Redis**: `redis_memory_used_bytes`, `redis_memory_max_bytes`, `redis_connected_clients`, `redis_keyspace_hits_total/(hits+misses)` → hit rate
- **Kafka**: `kafka_consumer_group_lag` (sum by topic), `kafka_topic_partition_current_offset` → throughput
- **ES**: `elasticsearch_indices_indexing_index_total`, `elasticsearch_jvm_memory_used_bytes`

```python
# 반환:
{
  "redis": { "memory_used_gb": 0.3, "memory_max_gb": 1.0, "clients": 4, "hit_rate_pct": 94.2 },
  "kafka": { "consumer_lag": 0, "throughput_msg_per_min": 12 },
  "elasticsearch": { "indexing_rate": 0.5, "jvm_heap_pct": 42 }
}
```

#### 1-4. Traces 엔드포인트 추가

**새 엔드포인트**: `GET /api/v1/admin/traces`

Tempo HTTP API 쿼리 (`http://192.168.56.30:3200`):
```
GET /api/search?service.name=tutum-backend&limit=20&minDuration=100ms
```

```python
# 반환:
{
  "traces": [
    {
      "traceID": "abc123",
      "rootServiceName": "tutum-backend",
      "rootTraceName": "GET /api/v1/market",
      "durationMs": 342,
      "startTimeUnixNano": 1709000000000000000
    }
  ]
}
```

---

### Phase 2: Frontend 전면 개편 (page.tsx)

#### 2-1. 레이아웃 변경

현재: 단순 `div` 구조
목표: 사이드 레이아웃 없이 상단 헤더 + 탭 콘텐츠 풀스크린

**헤더 컴포넌트**:
- 좌: `⬡ Tutum Admin` 로고
- 중: 클러스터 전체 상태 배지 (OK/WARN/CRITICAL)
- 우: 실시간 시계 + 마지막 갱신 + 수동 새로고침 버튼

**탭 순서**: Overview | Infra | Pipeline | Logs | Traces | AI

#### 2-2. Overview 탭

KPI 카드 4개 (sparkline 포함):
- **RPS** (Mimir `/admin/metrics`)
- **P95 Latency (ms)**
- **Error Rate (%)**
- **Kafka Consumer Lag**

각 카드: 현재값 + 추세 아이콘 (↑↓→) + 미니 sparkline (Recharts ResponsiveContainer)

시계열 차트 (Recharts LineChart):
- X축: 시간 (5분 간격, 최근 1시간)
- 좌 Y축: RPS (파란선)
- 우 Y축: P95 Latency ms (보라선)

에러율 바차트 + Kafka 랙 AreaChart (2열 그리드)

#### 2-3. Infra 탭

**노드 카드 그리드** (기존 파드 탭에서 이동, 개선):
- 노드별 카드: 이름, 역할 배지, CPU/MEM 프로그레스바 (색상 동적)
- 클릭 시 해당 노드의 파드 필터

**PVC 스토리지 카드** (신규):
- `/admin/storage` 데이터
- 컴포넌트별 용량 배지 (Bound=초록, Lost=빨강)

**파드 상태 도넛 차트** (Recharts PieChart):
- Running / Pending / Failed / Evicted 비율

**파드 테이블**:
- 기존 파드 탭 테이블 유지, 네임스페이스 필터 드롭다운

#### 2-4. Pipeline 탭

**뉴스 파이프라인** (기존 3개):
- 📡 news-producer → 🗄️ news-consumer → 🔍 elastic-consumer

**시세 파이프라인** (신규):
- 📈 price-producer → 💰 price-consumer

**기타 워커** (신규):
- 📧 email-worker | 🔬 ocr-worker

각 워커 카드: 상태 배지 + 재시작 횟수 + 가동 시간

**데이터 레이어 메트릭 카드** (신규, `/admin/data-metrics`):
- MongoDB: 전체 뉴스 수, 최근 1h 추가
- Elasticsearch: 인덱싱된 문서, 동기화율
- Redis: Hit rate %, 메모리 사용
- Kafka: Consumer Lag, 처리량

#### 2-5. Traces 탭 (신규)

슬로우 요청 테이블 (`/admin/traces`):
| Trace ID | 엔드포인트 | Duration | 시각 |
|----------|-----------|---------|------|
| abc123   | GET /api/v1/market | 342ms | 02:10:33 |

- Duration에 따라 셀 색상 (>500ms=빨강, >200ms=노랑)
- Trace ID 클릭 → Grafana Tempo 링크 (새 탭)

#### 2-6. 공통 UX 개선

- **자동 폴링**: Overview 30초, Infra 30초, Pipeline 30초, Logs 10초(유지), Traces 60초
- **로딩 스켈레톤**: 모든 카드에 `<Skeleton>` 컴포넌트
- **에러 상태**: API 실패 시 카드에 `⚠ 데이터 없음` 표시
- **색상 팔레트 통일**:
  - 배경: `#0a0f1e` (기존 유지)
  - 카드: `rgba(255,255,255,0.04)` border `rgba(255,255,255,0.08)`
  - OK: `#10b981` (emerald-500)
  - WARN: `#f59e0b` (amber-400)
  - ERROR: `#ef4444` (red-500)
  - 차트 선 1: `#60a5fa` (blue-400)
  - 차트 선 2: `#a78bfa` (violet-400)

---

## 파일 변경 목록

```
수정:
  backend/app/routers/admin.py     ← 워커 목록 확장, 3개 신규 엔드포인트 추가
  frontend/app/admin/page.tsx      ← 전면 재작성 (탭 구조, 차트, 신규 타입/상태)

신규 없음 (기존 파일만 수정)
```

---

## 사용 라이브러리

| 라이브러리 | 용도 | 설치 여부 |
|-----------|------|---------|
| `recharts` | LineChart, BarChart, PieChart, AreaChart, sparkline | ✅ 설치됨 |
| `framer-motion` | 카드 등장 애니메이션 | ✅ 설치됨 |
| shadcn/ui components | Skeleton, Badge, Tabs | ✅ 설치됨 |

---

## 작업 순서

```
1. backend/app/routers/admin.py 수정
   1-a. 전체 워커 목록 확장 (ALL_WORKERS)
   1-b. GET /admin/storage 엔드포인트 추가
   1-c. GET /admin/data-metrics 엔드포인트 추가
   1-d. GET /admin/traces 엔드포인트 추가

2. frontend/app/admin/page.tsx 재작성
   2-a. 타입 정의 추가 (Storage, DataMetrics, Trace)
   2-b. WORKER_META 7개로 확장
   2-c. 헤더 컴포넌트 개선
   2-d. 탭 구조 변경 (6탭)
   2-e. Overview 탭: KPI 카드 + Recharts 차트
   2-f. Infra 탭: 노드 그리드 + PVC + 도넛차트 + 파드 테이블
   2-g. Pipeline 탭: 전체 워커 + 데이터 레이어 메트릭 카드
   2-h. Traces 탭: 슬로우 요청 테이블
   2-i. 기존 Logs / AI 탭 유지

3. 로컬 확인
   - kubectl port-forward svc/backend -n tutum-app 8000:8000
   - npm run dev

4. 커밋 & 푸시 → GitLab CI → 배포

5. dev_log 작성
```

---

## 고려 사항

- **Tempo API**: `http://192.168.56.30:3200/api/search` — CORS 없음(서버→서버), 백엔드에서만 쿼리
- **Mimir 데이터 없음 처리**: Redis/Kafka exporter가 배포됐지만 Mimir에 아직 데이터가 없을 수 있음 → `available: false` 반환 시 카드에 `N/A` 표시
- **Recharts SSR**: `"use client"` 이미 선언됨, `dynamic import` 불필요
- **PVC 용량 실사용량**: K8s API는 requested 용량만 반환, 실제 사용량은 metrics-server 미지원 → `capacity` + `status`만 표시
- **Traces 탭 빈 상태**: OTel 방금 활성화됨 — 초기에는 트레이스가 없을 수 있으니 빈 상태 UI 처리 필요
