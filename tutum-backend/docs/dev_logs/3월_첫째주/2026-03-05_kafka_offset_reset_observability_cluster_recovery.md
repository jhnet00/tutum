# Kafka Offset Reset, Admin Observability 확장, 클러스터 장애 복구

**날짜**: 2026-03-05
**작업자**: 김경윤
**브랜치**: develop

---

## 1. Kafka Offset Reset — indexer-consumer-group LAG 해소

### 배경

`indexer-consumer-group` (elastic-consumer)이 130,000+ 메시지 LAG 상태로 Elasticsearch 색인 불가.

### 장애 원인 체인

```
elastic-consumer 컨테이너 재시작(구 버전 이슈)
  → consumer group 오프셋 적재 누락
  → LAG 누적 130K+
  → 새 메시지 색인 불가
```

### 시도 및 차단

1차 시도: `kafka-consumer-groups --reset-offsets --to-latest` 실행
→ **KEDA ScaledObject**가 15초마다 elastic-consumer를 재시작 → consumer group이 `inactive` 상태가 되지 않아 reset 불가

2차 시도: KEDA ScaledObject 삭제 후 Deployment scale to 0
→ **ArgoCD tutum-staging auto-sync**가 수 초 내에 ScaledObject 재생성 → 다시 차단

### 최종 해결 순서

```bash
# 1. ArgoCD auto-sync 비활성화
kubectl patch application tutum-staging -n argocd --type merge \
  -p '{"spec":{"syncPolicy":null}}'

# 2. KEDA ScaledObject 삭제
kubectl delete scaledobject elastic-consumer-scaledobject -n tutum-app

# 3. Deployment scale to 0
kubectl scale deploy elastic-consumer -n tutum-app --replicas=0

# 4. 50초 대기 (Kafka session.timeout.ms=45s)
# → consumer group 상태: "no active members"

# 5. Offset reset to latest
kubectl exec -n tutum-data kafka-0 -- kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --group indexer-consumer-group \
  --topic finance-news \
  --reset-offsets --to-latest --execute
# → Offset: 137,319 (LAG=0)

# 6. ScaledObject 재적용
kubectl apply -f k8s-manifests/...

# 7. ArgoCD auto-sync 복원
kubectl patch application tutum-staging -n argocd --type merge \
  -p '{"spec":{"syncPolicy":{"automated":{"prune":true,"selfHeal":true}}}}'
```

### 결과

- LAG=0, elastic-consumer KEDA min=0 replicas (정상)
- ArgoCD tutum-staging: Synced Healthy

---

## 2. Admin Observability 확장 (`/admin` 페이지)

### 배경

`2026-03-05_admin_observability_expansion_plan.md` 계획에 따라 운영 가시성 부족 영역 개선.

### 구현 내용

#### 2-a. RBAC 확장 (`k8s-manifests/base/backend/rbac.yaml`)

백업 상태 조회를 위한 batch 권한 추가:
```yaml
- apiGroups: ["batch"]
  resources: ["cronjobs", "jobs"]
  verbs: ["get", "list"]
```

#### 2-b. Backend API 확장 (`backend/app/routers/admin.py`)

**`GET /api/v1/admin/data-metrics` 응답 확장**

| 항목 | 추가 필드 |
|------|-----------|
| Disk | `total_gb`, `used_gb`, `avail_gb`, `used_pct` |
| MongoDB | `queued_readers`, `queued_writers` |
| Elasticsearch | `search_qps`, `search_latency_ms`, `index_latency_ms`, `thread_rejected` |

Mimir 쿼리 추가:
```python
"disk_total_bytes": ['sum(node_filesystem_size_bytes{mountpoint="/"})'],
"disk_avail_bytes": ['sum(node_filesystem_avail_bytes{mountpoint="/"})'],
"es_search_qps":   ["sum(rate(elasticsearch_indices_search_query_total[5m]))"],
"es_search_time":  ["sum(rate(elasticsearch_indices_search_query_time_seconds[5m]))"],
"es_index_time":   ["sum(rate(elasticsearch_indices_indexing_index_time_seconds_total[5m]))"],
"es_thread_rejected": ['sum(increase(elasticsearch_thread_pool_rejected_count{type="write"}[5m]))'],
```

> **주의**: `node_filesystem_size_bytes`에 `fstype` 필터 사용 시 N/A 반환 → `mountpoint="/"` 만 사용.

MongoDB globalLock 조회:
```python
lock   = status.get("globalLock", {})
queued = lock.get("currentQueue", {})
# queued_readers, queued_writers
```

**`GET /api/v1/admin/backup-status` 신규**

대상 CronJob: `mongodb-backup`, `elasticsearch-backup`, `etcd-backup`
K8s API로 Job 목록 조회 후 `OK / WARN / ERROR / NO_RUN / RUNNING` 상태 반환.

**`GET /api/v1/admin/action-needed` 신규**

임계치 기반 경고 목록 생성:
- Disk used > 85% → CRITICAL
- ES JVM heap > 80% → CRITICAL
- Kafka consumer lag > 500 → WARN
- MongoDB queued > 10 → WARN
- Backup 실패 → WARN/ERROR

#### 2-c. Frontend 확장 (`frontend/app/admin/page.tsx`)

- **Action Needed 배너**: Pipeline 탭 상단, CRITICAL/WARN 항목 + 권장 조치 1줄
- **Disk Capacity 카드**: used/total GB, 사용률 바 (70% WARN amber / 85% CRITICAL red)
- **Elasticsearch 카드**: search QPS, search latency ms (>100ms amber), thread rejected
- **MongoDB I/O 카드**: queued readers/writers (>0일 때만 표시)
- **Backup Health 섹션**: MongoDB / Elasticsearch / etcd 3개 카드, 마지막 성공 시각/오류 표시

#### 커밋

```
feat(admin): observability expansion — disk capacity, ES search metrics, backup health, action-needed banner
```

---

## 3. 클러스터 연쇄 장애 및 복구

### 장애 발생 경위

```
worker2 kubelet 중단
  → backend 파드 5개 zombie (모두 worker2에 집중)
  → Ingress "no healthy upstream"
  → worker3에 workload=app 레이블 추가 → 파드 재스케줄 시도
  → worker3도 NotReady
  → cp-3으로 백엔드 파드 재배치 → cp-3 과부하
  → Kyverno webhook 불가 → kubectl 전체 일시 불가
  → MongoDB primary 소실 (quorum 2/3 실패)
  → backend 시작 불가 → 서비스 다운
```

### 복구 순서

#### 3-1. MongoDB 강제 복구

```javascript
// mongodb-2 (worker1 SECONDARY) 에서 단일 멤버 강제 reconfig
rs.reconfig({
  _id: "mongo-rs",
  members: [{ _id: 2, host: "mongodb-2.mongodb-headless.tutum-data.svc.cluster.local:27017" }]
}, { force: true })
// → mongodb-2 PRIMARY 승격
```

#### 3-2. Kyverno 정상화

worker2/3 복구 후 Kyverno admission controller 재스케줄 → kubectl 명령 정상 복원

#### 3-3. 노드 복구 및 MongoDB 복원

```bash
# worker2, worker3 uncordon
kubectl uncordon worker2 worker3

# MongoDB 멤버 재추가
rs.add("mongodb-0.mongodb-headless.tutum-data.svc.cluster.local:27017")
rs.add("mongodb-1.mongodb-headless.tutum-data.svc.cluster.local:27017")
# → 최종: PRIMARY(mongodb-2) + SECONDARY(mongodb-0) + SECONDARY(mongodb-1)
```

#### 3-4. 최종 상태

| 노드 | 상태 |
|------|------|
| cp-1 | Ready |
| cp-2 | Ready |
| cp-3 | NotReady (과부하) → 수동 재기동 후 Ready |
| worker1/2/3 | Ready |

---

## 4. cp-3 NotReady 진단 및 복구

### 원인

연쇄 장애 중 backend / kyverno / consumer 파드 대량 재스케줄 → cp-3 (RAM 4GB) 메모리 고갈 → kubelet 응답 중단

### 증상

- Ping 응답 ✓ (커널 TCP 정상)
- SSH 포트 22 열림 ✓, 但 banner exchange timeout (sshd 프로세스 fork 불가)
- `kube-apiserver-cp-3`: 0/1 Ready, Liveness probe HTTP 500
- `kubectl exec` / logs: TLS handshake timeout (kubelet 미응답)

### 복구

하이퍼바이저 콘솔에서 직접 접근 → `sudo systemctl restart kubelet` (또는 reboot)

### 예방

cp-3는 Control Plane 전용 — `workload=app` 레이블을 평시에 제거하여 애플리케이션 파드 재스케줄 대상에서 배제 권장.

---

## 5. 금일 교훈

| 항목 | 교훈 |
|------|------|
| KEDA + Kafka offset reset | KEDA ScaledObject 삭제 전 ArgoCD auto-sync 비활성화 필수 |
| MongoDB quorum | 2개 노드 동시 장애 시 primary 소실 — 초기 대응으로 `rs.reconfig(force)` 숙지 |
| Kyverno webhook | admission controller 파드가 다운 노드에 있으면 모든 kubectl mutating/validating 차단 |
| CP 노드 레이블 | Control Plane에 `workload=app` 레이블 미부여 원칙 유지 |
| cp-3 SSH 불가 | 물리/VM 콘솔 접근 경로 항상 확보 (Proxmox/BMC 등) |
