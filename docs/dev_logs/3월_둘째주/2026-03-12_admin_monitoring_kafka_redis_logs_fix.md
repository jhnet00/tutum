# 2026-03-12 Admin 모니터링 페이지 Kafka/Redis/Logs/Traces 미표시 수정

## 작업자
박성준

## 증상
`https://tutum.my/admin` 에서 Kafka, Redis 메트릭, Logs, Traces 탭이 데이터 없이 빈 화면 표시.
다른 항목(노드/파드 현황, Overview 등)은 정상 동작.

---

## 원인 분석

### 1. Kafka/Redis 메트릭 — Istio prometheus annotation 덮어씌우기

`kafka-exporter`, `redis-exporter` pod에 Istio 사이드카가 주입되면서
`prometheus.io/port`, `prometheus.io/path` annotation이 Istio proxy 기준으로 덮어씌워짐:

```
# 매니페스트 원본
prometheus.io/port: "9308"   # kafka-exporter 실제 포트
prometheus.io/path: "/metrics"

# Istio 주입 후 실제 pod annotation
prometheus.io/port: "15020"  # Istio envoy proxy merged stats 포트
prometheus.io/path: "/stats/prometheus"
```

Alloy configmap의 `prometheus.scrape "kubernetes_pods"` 블록에 annotation 기반 relabeling이 없어서:
- pod 컨테이너 포트를 그대로 사용 → 9308 scrape 시도 → Istio mTLS STRICT 차단
- 올바른 Istio 15020 merged metrics endpoint를 사용하지 못함
- → Mimir에 kafka_consumergroup_lag 등 메트릭이 전혀 없음

### 2. Logs — Loki job 레이블 불일치

admin.py Loki 쿼리에 하드코딩된 job 이름이 Alloy가 실제 생성하는 레이블과 불일치:

```python
# admin.py (틀림)
job="loki.source.kubernetes.k8s_logs"

# Alloy loki.source.kubernetes "pods" 컴포넌트가 실제 생성하는 레이블
job="loki.source.kubernetes.pods"
```

→ Loki 쿼리가 빈 결과 반환, Logs 탭 비어있음

---

## 수정 내용

### Fix 1: `k8s-manifests/base/monitoring/alloy-config.yaml`

`prometheus.scrape "kubernetes_pods"` 에 `discovery.relabel "pods_scrape"` 블록 추가:
- `prometheus.io/scrape: "true"` annotation 있는 pod만 스크레이프
- `prometheus.io/path` annotation → `__metrics_path__` 오버라이드
- `prometheus.io/port` annotation → `__address__` 포트 오버라이드

이로써 Istio가 설정한 `port: 15020`, `path: /stats/prometheus` 를 정확히 사용,
Istio merged metrics endpoint에서 app 메트릭 + envoy stats 통합 수집.

### Fix 2: `backend/app/routers/admin.py`

Loki job 레이블 3곳 수정:
- `k8s_logs` → `pods`
- `instance=~"ns/.*"` → `namespace=~"ns"` (Alloy 레이블 구조에 맞게)

로그 파싱 코드도 `instance` 파싱 방식에서 `namespace`/`pod` 레이블 직접 사용으로 변경.

---

## 적용

```bash
# Alloy configmap 즉시 적용
kubectl apply -f k8s-manifests/base/monitoring/alloy-config.yaml

# Alloy DaemonSet 재시작 (새 config 반영)
kubectl rollout restart daemonset/alloy -n monitoring

# backend admin.py 즉시 반영 (컨테이너 내 직접 패치)
kubectl exec -n tutum-app deployment/backend -- \
  sed -i 's/loki.source.kubernetes.k8s_logs/loki.source.kubernetes.pods/g' \
  /app/app/routers/admin.py
```

backend는 다음 CI/CD 배포 시 이미지에 반영됨.

---

## Traces 미표시

Tempo 자체는 정상 동작 (`http://10.60.11.95:3200` 접근 가능).
backend가 OTLP trace를 Alloy로 전송하지 않아 Tempo에 데이터 없음.
→ 별도 이슈 (backend OpenTelemetry 계측 미설정), 향후 대응 예정.

---

## 커밋
- 이번 커밋: fix(monitoring): Alloy annotation relabeling + admin.py Loki job label fix
