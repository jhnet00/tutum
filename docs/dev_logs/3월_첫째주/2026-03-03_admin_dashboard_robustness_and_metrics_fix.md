# Admin Dashboard 안정화 + Alloy 메트릭 파이프라인 수정 + OpenTelemetry 트레이싱 활성화

**날짜**: 2026-03-03
**작업자**: Claude (AI)
**커밋**: `1815383`, `b544478`

---

## 1. 작업 개요

| 작업 | 내용 |
|------|------|
| Admin 백엔드 안정화 | httpx 클라이언트 풀링, K8s API 타임아웃, Loki 방어적 파싱 |
| Admin 프론트엔드 UX 개선 | 에러 토스트, 로그 자동 스크롤, Clock 컴포넌트 분리, 로딩 상태 |
| Alloy 메트릭 relabeling 수정 | `namespace` 레이블 누락으로 RPS/P95/Error Rate N/A 문제 해결 |
| HTTP 메트릭 쿼리 레이블 수정 | `status` → `status_code` (prometheus-fastapi-instrumentator v7) |
| OpenTelemetry 트레이싱 활성화 | FastAPI 자동 계측 → Alloy → Tempo → Grafana |

---

## 2. 백엔드 `admin.py` 안정화

### httpx 클라이언트 풀링
- 기존: 요청마다 `async with httpx.AsyncClient()` 생성 → TCP 연결 낭비
- 변경: 모듈 레벨 공유 클라이언트 3개 선언

```python
# Shared HTTP clients — reused across requests for connection pooling
_HTTP_MIMIR = httpx.AsyncClient(timeout=5.0)
_HTTP_LOKI  = httpx.AsyncClient(timeout=8.0)
_HTTP_MISC  = httpx.AsyncClient(timeout=8.0)
```

### K8s API 타임아웃 추가
- 기존: K8s Python SDK 호출에 타임아웃 없음 → 네트워크 문제 시 무한 대기
- 변경: 모든 K8s API 호출에 `_request_timeout=10` (파이프라인 내부 5초) 추가

```python
# 예시
v1.list_node(_request_timeout=10)
v1.list_pod_for_all_namespaces(_request_timeout=10)
v1.list_namespaced_pod(ns, _request_timeout=5)
v1.list_persistent_volume_claim_for_all_namespaces(_request_timeout=10)
```

### Loki 방어적 파싱
- 기존: `data["data"]["result"]` → Loki 응답 형식 다를 경우 KeyError
- 변경: `.get()` 체이닝으로 예외 방지

```python
# 전
results = data["data"]["result"]
# 후
results = data.get("data", {}).get("result", [])
# 각 스트림 values도
values = stream.get("values", [])
```

### Error Rate 쿼리 레이블 수정
- `prometheus-fastapi-instrumentator v7`은 `status_code` 레이블 사용 (이전 버전은 `status`)
- 모든 에러율 쿼리 수정:

```python
# 전
'sum(rate(http_requests_total{namespace="tutum-app",status=~"5.."}[2m]))'
# 후
'sum(rate(http_requests_total{namespace="tutum-app",status_code=~"5.."}[2m]))'
```

---

## 3. 프론트엔드 `admin/page.tsx` UX 개선

### Clock 컴포넌트 분리
- 1초마다 state 업데이트 → 전체 `AdminDashboard` 리렌더 방지
- `Clock` 독립 컴포넌트로 분리

```tsx
function Clock() {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString("ko-KR", { hour12: false })
  );
  useEffect(() => {
    const id = setInterval(
      () => setTime(new Date().toLocaleTimeString("ko-KR", { hour12: false })),
      1000
    );
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono">{time}</span>;
}
```

### 에러 토스트 + fetch 에러 핸들링
- 8개 fetch 콜백 모두 try/catch + 에러 메시지 state 추가
- 4초 자동 소멸 토스트 (우하단)

```tsx
const showError = (msg: string) => {
  setFetchError(msg);
  setTimeout(() => setFetchError(""), 4000);
};
```

### 기타 UX
- **로그 자동 스크롤**: 새 로그 도착 시 `logRef.current?.scrollTo({ top: 0 })`
- **네임스페이스 변경 → 필터 초기화**: `logNs` 변경 시 `logPod`, `logLevel` 리셋
- **탭 전환 → 필터 리셋**: `nsFilter`, `nodeFilter`, `logPod`, `logLevel` 모두 초기화
- **새로고침 로딩 상태**: `isRefreshing` state로 버튼 비활성화 + 텍스트 변경
- **PVC 용량 fallback**: `{p.capacity || "-"}` (undefined 방지)
- **Pod/로그 이름 툴팁**: `title={p.name}`, `title={log.pod}` 추가

---

## 4. Alloy 메트릭 파이프라인 수정 (핵심 버그)

### 문제
- Admin 대시보드 RPS, P95 Latency, Error Rate **모두 N/A**
- Kafka Lag만 정상 (Kafka exporter → 별도 scrape)
- 원인: Alloy `prometheus.scrape "k8s_pods"`가 `prometheus.remote_write`로 직접 전달
  → `__meta_kubernetes_namespace` 레이블이 실제 메트릭에 포함되지 않음
  → Mimir에서 `{namespace="tutum-app"}` 쿼리 시 빈 결과

### 해결: `prometheus.relabel "k8s_pods_meta"` 컴포넌트 추가

```alloy
prometheus.relabel "k8s_pods_meta" {
  forward_to = [prometheus.remote_write.mimir.receiver]

  rule {
    source_labels = ["__meta_kubernetes_namespace"]
    target_label  = "namespace"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_name"]
    target_label  = "pod"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_label_app"]
    target_label  = "app"
  }
}

prometheus.scrape "k8s_pods" {
  targets         = discovery.kubernetes.pods.targets
  forward_to      = [prometheus.relabel.k8s_pods_meta.receiver]  # ← 변경
  scrape_interval = "30s"
}
```

### Backend Deployment prometheus 어노테이션 추가

```yaml
annotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "8000"
  prometheus.io/path: "/metrics"
```

### 적용 방법 (수동 — SSH 불가로 직접 적용)
```bash
kubectl apply -f k8s-manifests/step3-lgtm/alloy/01-alloy-daemonset.yaml
kubectl rollout restart daemonset/alloy -n monitoring
kubectl rollout status daemonset/alloy -n monitoring
# → "daemon set 'alloy' successfully rolled out" 확인
```

---

## 5. OpenTelemetry 트레이싱 활성화

### `backend/requirements.txt` 추가
```
opentelemetry-sdk>=1.20.0
opentelemetry-exporter-otlp-proto-grpc>=1.20.0
opentelemetry-instrumentation-fastapi>=0.41b0
```

### `backend/app/main.py` 설정

```python
# OTel TracerProvider 설정 (Alloy → Tempo)
_otlp_endpoint = os.getenv("OTLP_ENDPOINT", "alloy.monitoring.svc.cluster.local:4317")
_resource = Resource.create({SERVICE_NAME: "tutum-backend"})
_tracer_provider = TracerProvider(resource=_resource)
_tracer_provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint=_otlp_endpoint, insecure=True))
)
trace.set_tracer_provider(_tracer_provider)

# ... app 생성 후 ...
FastAPIInstrumentor.instrument_app(app)
```

### 트레이스 흐름
```
Backend Pod
  └─ OTLPSpanExporter (gRPC :4317)
       └─> alloy.monitoring.svc.cluster.local:4317
             └─> Tempo (192.168.56.30:4317)
                   └─> Grafana Explore → Tempo
```

검증 방법:
```bash
curl https://tutum.my/api/v1/health
# → Grafana Explore → Tempo → 서비스명 "tutum-backend" 검색
```

---

## 6. 수정된 파일

| 파일 | 변경 유형 |
|------|----------|
| `backend/app/routers/admin.py` | httpx 클라이언트 풀링, K8s 타임아웃, Loki 방어 파싱, status_code 쿼리 수정 |
| `backend/app/main.py` | OTel TracerProvider + FastAPIInstrumentor 추가 |
| `backend/requirements.txt` | OTel 패키지 3개 추가 |
| `frontend/app/admin/page.tsx` | Clock 분리, 에러 토스트, 로그 스크롤, 필터 리셋, PVC fallback 등 |
| `k8s-manifests/step3-lgtm/alloy/01-alloy-daemonset.yaml` | prometheus.relabel 컴포넌트 추가 |
| `k8s-manifests/base/backend/deployment.yaml` | prometheus.io 스크레이프 어노테이션 추가 |

---

## 7. 이슈 & 해결

| 이슈 | 원인 | 해결 |
|------|------|------|
| RPS/P95/Error Rate N/A | Alloy relabeling 누락 → `namespace` 레이블 없음 | `prometheus.relabel` 컴포넌트 추가 |
| Error Rate 항상 0 | `status` 레이블 (v6 문법) vs `status_code` (v7) | 쿼리 레이블 수정 |
| SSH to cp1 실패 | `Permission denied (publickey,password)` | 변경 커밋 후 사용자 수동 적용 |
| Non-fast-forward push | 원격 develop에 CI 자동 커밋 존재 | `git stash && git pull --rebase && git stash pop && git push` |

---

## 8. 후속 과제

- [ ] Grafana Explore → Tempo에서 `tutum-backend` 트레이스 확인
- [ ] ArgoCD가 `deployment.yaml` 어노테이션 변경 sync 완료 확인
- [ ] Mimir에서 `namespace="tutum-app"` 레이블 정상 수집 확인
- [ ] Redis, Kafka 배포 (tutum-data 네임스페이스)
