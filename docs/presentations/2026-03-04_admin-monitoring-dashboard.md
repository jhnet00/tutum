# Admin 모니터링 대시보드 — 작업 흐름 설명

> **멘토링 발표용** · 2026-03-04
> 작업자: Kyung Yoon Kim

---

## 1. 왜 만들었나?

Tutum 프로젝트는 **K8s 6노드 클러스터** 위에서 운영됩니다.
서비스가 커질수록 "지금 클러스터가 정상인가?" 를 Grafana, kubectl을 번갈아 열지 않고
**한 화면에서** 볼 수 있는 내부 도구가 필요했습니다.

목표: 개발팀이 매일 확인해야 하는 것들을 하나의 페이지에서 해결

| 항목 | 이전 방식 | 대시보드 |
|------|-----------|----------|
| 파드 상태 확인 | kubectl get pods | Infra 탭 |
| API 성능 지표 | Grafana 접속 | Overview 탭 |
| 실시간 로그 | kubectl logs | Logs 탭 |
| 뉴스 파이프라인 상태 | 각 워커 개별 확인 | Pipeline 탭 |
| 클러스터 이상 진단 | 수동 분석 | AI 분석 탭 |

---

## 2. 전체 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                   K8s Cluster (6노드)                    │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ backend  │  │ frontend │  │ workers  │  ...          │
│  │ :8000    │  │ :3000    │  │          │              │
│  └────┬─────┘  └──────────┘  └──────────┘              │
│       │ OTel gRPC                │                       │
│       │                         │ /metrics               │
│  ┌────▼──────────────────────────▼──────────────────┐   │
│  │         Grafana Alloy DaemonSet (노드마다 1개)     │   │
│  │  • Pod 메트릭 스크레이핑 (prometheus.io/scrape)    │   │
│  │  • K8s 로그 수집 (loki.source.kubernetes)         │   │
│  │  • OTel 트레이스 수신 (OTLP gRPC :4317)           │   │
│  └───────┬────────────────────────────────────────────┘  │
└──────────│──────────────────────────────────────────────┘
           │ remote_write / push
           ▼
┌──────────────────────────────────┐
│   모니터링 VM (192.168.0.230)     │
│                                  │
│  ┌────────┐ ┌──────┐ ┌───────┐  │
│  │ Mimir  │ │ Loki │ │ Tempo │  │
│  │ :9009  │ │ :3100│ │ :3200 │  │
│  └────┬───┘ └──┬───┘ └───┬───┘  │
└───────│────────│──────────│──────┘
        │        │          │  QueryAPI
        └────────┴──────────┘
                 │
           ┌─────▼──────────────────────┐
           │  FastAPI Backend           │
           │  /api/v1/admin/*           │
           │                            │
           │  + K8s Python SDK          │
           │  + AWS Bedrock (AI 진단)   │
           └─────────────────────────────┘
                 │ fetch
           ┌─────▼──────────────────────┐
           │  Next.js Admin Page        │
           │  https://tutum.my/admin    │
           └────────────────────────────┘
```

---

## 3. 메트릭 수집 흐름 (핵심)

### Alloy → Mimir 파이프라인

```
① Pod 어노테이션 설정 (deployment.yaml)
   prometheus.io/scrape: "true"
   prometheus.io/port: "8000"
   prometheus.io/path: "/metrics"

② Alloy discovery.relabel (스크레이핑 전 타겟 변환)
   __meta_kubernetes_pod_annotation_prometheus_io_scrape == "true" → keep
   __meta_kubernetes_namespace → namespace 레이블
   __meta_kubernetes_pod_name  → pod 레이블

③ Alloy prometheus.scrape
   타겟: discovery.relabel.pod_meta.output
   → 30초마다 /metrics 엔드포인트 스크레이핑

④ prometheus.remote_write → Mimir :9009/api/v1/push

⑤ Backend QueryAPI 호출
   GET http://192.168.0.230:9009/prometheus/api/v1/query_range
   query: sum(rate(http_requests_total{namespace="tutum-app"}[2m]))
```

### 핵심 트러블슈팅 포인트

> `prometheus.relabel` vs `discovery.relabel` 차이

| 컴포넌트 | 실행 시점 | `__meta_kubernetes_*` 접근 |
|----------|-----------|--------------------------|
| `prometheus.relabel` | 스크레이핑 **후** (메트릭 처리) | ❌ 불가 |
| `discovery.relabel` | 스크레이핑 **전** (타겟 처리) | ✅ 가능 |

처음에 `prometheus.relabel`을 사용해서 `namespace` 레이블이 메트릭에 붙지 않아
`{namespace="tutum-app"}` 쿼리가 빈 결과를 반환했습니다.
→ `discovery.relabel`로 교체해서 해결

---

## 4. 백엔드 API 구조

**파일**: `backend/app/routers/admin.py`

| 엔드포인트 | 데이터 소스 | 반환 데이터 |
|-----------|-------------|-------------|
| `GET /admin/nodes` | K8s Python SDK | 노드 목록, CPU/Memory 사용량 |
| `GET /admin/pods` | K8s Python SDK | 파드 목록, 상태, 재시작 횟수 |
| `GET /admin/metrics` | Mimir QueryAPI | RPS, P95 Latency, Error Rate, Kafka Lag |
| `GET /admin/logs` | Loki QueryAPI | 실시간 로그 (네임스페이스/파드 필터) |
| `GET /admin/pipeline` | K8s + MongoDB + ES + Loki | 파이프라인 3대 워커 상태 |
| `GET /admin/traces` | Tempo HTTP API | 최근 트레이스 목록 |
| `GET /admin/diagnose` | Bedrock Claude | 클러스터 AI 진단 |
| `GET /admin/pipeline-diagnose` | Bedrock Claude | 파이프라인 AI 진단 |
| `GET /admin/storage` | K8s Python SDK | PVC 목록 및 용량 |

### K8s SDK 사용 방식

```python
# 클러스터 내부에서 in-cluster 설정으로 자동 인증
config.load_incluster_config()
v1 = client.CoreV1Api()

# 타임아웃 필수 (없으면 네트워크 장애 시 무한 대기)
nodes = v1.list_node(_request_timeout=10)
```

### Mimir 쿼리 예시

```python
# RPS: 분당 요청 수
'sum(rate(http_requests_total{namespace="tutum-app"}[2m]))'

# P95 응답시간 (ms)
'histogram_quantile(0.95, sum by(le) '
'(rate(http_request_duration_seconds_bucket{namespace="tutum-app"}[2m]))) * 1000'

# Kafka Consumer Lag
'sum(kafka_consumergroup_lag)'
```

---

## 5. 프론트엔드 구조

**파일**: `frontend/app/admin/page.tsx`

```
AdminDashboard
│
├── <Clock />          ← 별도 컴포넌트 (1초마다 전체 리렌더 방지)
├── Header             ← Cluster OK/WARN 배지, 마지막 갱신 시각
│
├── [Overview 탭]
│   ├── 지표 카드 4개: RPS / P95 Latency / Error Rate / Kafka Lag
│   ├── API 처리량 & 응답시간 꺾은선 차트 (최근 1시간)
│   └── 요약 카드: 노드 수 / 파드 수 / PVC 수
│
├── [Infra 탭]
│   ├── 노드 카드 (CPU%, Memory% GaugeBar)
│   ├── 파드 분포 도넛 차트 (Running/Pending/Failed/Evicted)
│   └── 파드 테이블 (네임스페이스 · 노드 필터, 문제 행 색상)
│
├── [Pipeline 탭]
│   ├── news-producer → news-consumer → elastic-consumer 플로우
│   ├── 각 워커: 상태, 재시작 횟수, 최근 Loki 로그 스니펫
│   └── MongoDB news 건수 / ES 인덱싱 비율
│
├── [Logs 탭]
│   ├── 네임스페이스 · 파드 · 레벨(INFO/WARN/ERROR) 필터
│   └── 실시간 로그 스트림 (자동 스크롤)
│
├── [Traces 탭]
│   └── 최근 트레이스 목록 (서비스명, duration, Grafana 링크)
│
└── [AI 분석 탭]
    ├── 클러스터 전체 진단 (Bedrock Claude)
    └── 파이프라인 워커별 개별 진단
```

### 성능 최적화 포인트

```tsx
// 문제: 1초마다 setClock → AdminDashboard 전체 리렌더
// 해결: Clock을 독립 컴포넌트로 분리
function Clock() {
  const [time, setTime] = useState(...);
  useEffect(() => {
    const id = setInterval(() => setTime(...), 1000);
    return () => clearInterval(id);
  }, []);
  return <span>{time}</span>;
}
```

---

## 6. OpenTelemetry 트레이싱

```python
# backend/app/main.py
_otlp_endpoint = os.getenv("OTLP_ENDPOINT",
    "alloy.monitoring.svc.cluster.local:4317")

_tracer_provider = TracerProvider(
    resource=Resource.create({SERVICE_NAME: "tutum-backend"})
)
_tracer_provider.add_span_processor(
    BatchSpanProcessor(
        OTLPSpanExporter(endpoint=_otlp_endpoint, insecure=True)
    )
)
trace.set_tracer_provider(_tracer_provider)

# FastAPI 자동 계측 (모든 HTTP 요청 자동 추적)
FastAPIInstrumentor.instrument_app(app)
```

```
Backend → Alloy :4317 (OTLP gRPC) → Tempo → Grafana Explore
```

---

## 7. GitOps 배포 흐름

```
코드 수정 (로컬)
    │
    ▼
git push origin develop
    │
    ▼
GitLab CI Pipeline
  ├── lint (flake8, eslint)
  ├── build (Docker image)
  ├── push (GitLab Registry)
  └── kustomize patch (image tag 업데이트)
    │
    ▼
ArgoCD (K8s 내부)
  └── Git 변경 감지 → 자동 sync → kubectl apply
```

---

## 8. 주요 기술 스택

| 영역 | 기술 |
|------|------|
| 컨테이너 오케스트레이션 | Kubernetes 1.29 (kubeadm, Calico CNI) |
| 메트릭 수집 에이전트 | Grafana Alloy v1.13 (DaemonSet) |
| 메트릭 저장 | Grafana Mimir (장기 보존) |
| 로그 저장 | Grafana Loki |
| 트레이싱 | Grafana Tempo + OpenTelemetry |
| Backend | FastAPI (Python) + K8s SDK |
| Frontend | Next.js 14 (App Router) |
| CI/CD | GitLab CI + ArgoCD (GitOps) |
| AI 진단 | AWS Bedrock (Claude) |

---

## 9. 작업하면서 배운 것

1. **`discovery.relabel` vs `prometheus.relabel`**
   Prometheus/Alloy에서 레이블 변환 위치(타겟 단계 vs 메트릭 단계)에 따라
   `__meta_kubernetes_*` 메타데이터 접근 가능 여부가 달라진다.

2. **K8s in-cluster 인증**
   파드 내부에서는 ServiceAccount 토큰으로 자동 인증되므로
   `load_incluster_config()`만 호출하면 K8s API를 바로 사용할 수 있다.

3. **React 렌더링 최적화**
   상태 변경이 잦은 컴포넌트(시계)를 부모와 분리하면
   자식의 업데이트가 부모 전체 리렌더를 유발하지 않는다.

4. **GitOps 실제 운영**
   코드 변경이 Git → CI → Registry → ArgoCD → K8s 순서로 자동 배포되는
   파이프라인이 실제로 동작하는 것을 경험했다.
