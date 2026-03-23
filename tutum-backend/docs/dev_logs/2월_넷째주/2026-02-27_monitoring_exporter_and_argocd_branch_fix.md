# 2026-02-27 Redis/Kafka Exporter 배포 및 ArgoCD develop 브랜치 전환

## 작업자
박성준

## 작업 유형
Infra / 모니터링 / GitOps 개선

## 배경
Grafana CloudDX Overview 대시보드의 두 패널이 계속 "No data" 상태였음.
- **Panel 4 (Kafka Consumer Lag)**: `kafka_consumer_group_lag` 메트릭 없음 — Kafka exporter 미배포
- **Panel 5 (Redis Hit Ratio)**: `redis_keyspace_hits_total` 메트릭 없음 — Redis exporter 미배포

추가로 ArgoCD `tutum-app-gitops` 앱이 `ruby-backup0225` 브랜치를 바라보고 있어 `develop` 브랜치 커밋이 자동 배포되지 않는 문제도 함께 수정.

---

## 작업 1: Redis Exporter 배포

### 배포 이유
K8s 내 Redis(`redis.tutum-data.svc:6379`)의 Prometheus 메트릭을 노출하는 exporter가 없어
Alloy가 `redis_keyspace_hits_total`, `redis_keyspace_misses_total` 등을 수집 불가.

### 방식 결정
Alloy ConfigMap 수정 불필요 — 현재 Alloy의 `discovery.kubernetes "pods"` 설정이
전체 파드를 자동 발견 후 `/metrics` 엔드포인트 스크랩하므로,
exporter 파드를 배포하기만 하면 자동 수집됨.

### 매니페스트: `k8s-manifests/base/data/redis-exporter.yaml`
```yaml
image: oliver006/redis_exporter:v1.62.0
args:
  - --redis.addr=redis://redis.tutum-data.svc.cluster.local:6379
ports:
  - containerPort: 9121  # /metrics 엔드포인트
```
- namespace: `tutum-data`
- resources: requests 50m/32Mi, limits 100m/64Mi

---

## 작업 2: Kafka Exporter 배포

### 배포 이유
K8s 내 Kafka(`kafka.tutum-data.svc:9092`)의 consumer group lag 메트릭 수집 불가.

### 매니페스트: `k8s-manifests/base/data/kafka-exporter.yaml`
```yaml
image: danielqsj/kafka-exporter:latest
args:
  - --kafka.server=kafka.tutum-data.svc.cluster.local:9092
  - --kafka.version=3.5.0
ports:
  - containerPort: 9308  # /metrics 엔드포인트
```
- namespace: `tutum-data`
- resources: requests 50m/32Mi, limits 200m/128Mi

### 주요 발견: 메트릭 이름 불일치
대시보드에 하드코딩된 쿼리: `kafka_consumer_group_lag`
실제 exporter 메트릭명: **`kafka_consumergroup_lag`** (underline 1개 차이)

→ Grafana CloudDX Overview Panel 4 쿼리 수정:
```promql
# 수정 전
kafka_consumer_group_lag

# 수정 후
sum by (consumergroup, topic) (kafka_consumergroup_lag)
```

---

## 작업 3: ArgoCD develop 브랜치 전환

### 문제
```
ArgoCD app: tutum-app-gitops
source.repoURL: https://gitlab.com/tutum-project/tutum-app/backend.git
source.targetRevision: ruby-backup0225  ← 문제
source.path: k8s-manifests/base
```
팀이 `develop` 브랜치를 메인으로 사용 중이나, ArgoCD가 `ruby-backup0225` 브랜치를
감시 중이어서 `develop` 커밋이 K8s에 자동 반영되지 않음.

또한 `ruby-backup0225`에는 `news-producer` Deployment의 env 설정 오류가 있어
ArgoCD SyncError 발생 중이었음.

### 수정
```bash
kubectl patch application tutum-app-gitops -n argocd \
  --type='json' \
  -p='[{"op": "replace", "path": "/spec/source/targetRevision", "value": "develop"}]'
```

→ ArgoCD가 즉시 `develop` 브랜치 기반으로 자동 sync 시작.

---

## kustomization.yaml 업데이트

`k8s-manifests/base/kustomization.yaml`에 exporter 2개 추가:
```yaml
  - data/redis.yaml
  - data/redis-exporter.yaml   # 추가
  - data/kafka.yaml
  - data/kafka-exporter.yaml   # 추가
```

---

## 배포 결과

### K8s 파드 상태 (tutum-data ns)
```
redis-exporter-6f7f4d8778-tvh64   1/1   Running
kafka-exporter-5b44b49747-7zxrg   1/1   Running
```

### Mimir 메트릭 수집 확인
| 메트릭 | 값 | 상태 |
|--------|-----|------|
| `redis_keyspace_hits_total` | 603,360+ | ✅ |
| `redis_keyspace_misses_total` | 존재 | ✅ |
| `redis_keyspace_hits / (hits + misses)` | ~10.5% hit rate | ✅ |
| `kafka_consumergroup_lag{consumergroup="price-consumer-group"}` | **662,112** 🔴 | ✅ |
| `kafka_consumergroup_lag{consumergroup="clouddx-news-consumer-v1"}` | 0 | ✅ |
| `kafka_consumergroup_lag{consumergroup="indexer-consumer-group"}` | 0 | ✅ |

### Grafana CloudDX Overview 패널 최종 상태
| 패널 | 수정 전 | 수정 후 |
|------|--------|--------|
| Panel 1: Backend API RPS | No Data | ✅ 실시간 데이터 |
| Panel 2: Error Rate (5xx) | No Data | ✅ 0% |
| Panel 3: P95 Latency | ✅ 정상 | ✅ ~0.44s |
| Panel 4: Kafka Consumer Lag | No Data | ✅ 662,112 (price-consumer) |
| Panel 5: Redis Hit Ratio | No Data | ✅ ~10.5% |

---

## 주목할 이상 지표

### price-consumer-group Kafka Lag 662,112
`prices` 토픽 기준 price-consumer-group의 lag이 66만 이상으로 매우 큼.
- Producer(price-producer)가 Upbit 시세를 고빈도로 발행 중
- Consumer(price-consumer)가 처리 속도를 따라가지 못하는 상태
- 별도 조사 및 consumer 성능 튜닝 필요 (KEDA ScaledObject 확인 권장)

---

## 수정 파일
- `k8s-manifests/base/data/redis-exporter.yaml` (신규)
- `k8s-manifests/base/data/kafka-exporter.yaml` (신규)
- `k8s-manifests/base/kustomization.yaml` (exporter 2개 추가)
- Grafana CloudDX Overview 대시보드 v3 → v4 (API로 직접 수정)
- ArgoCD `tutum-app-gitops` targetRevision: `ruby-backup0225` → `develop` (kubectl patch)

## SSH 접속 정보 확인
- K8s VM 접속: `ssh cp-2` (SSH config 기반, `~/.ssh/id_rsa` 키 인증)
- 유저명: `clouddx`, 비밀번호: `tutum` (key 인증 성공 시 불필요)
