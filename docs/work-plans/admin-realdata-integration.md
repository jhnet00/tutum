# Work Plan: Admin 페이지 실시간 데이터 연동

> 작성일: 2026-02-27
> 브랜치: `feat/admin-realdata` (develop에서 분기)
> 담당: jhnet00

---

## 목표

현재 Admin 페이지의 하드코딩 Mock 데이터를 실제 클러스터 데이터로 교체한다.

| 항목 | 현재 | 목표 |
|------|------|------|
| 노드 목록/CPU/Memory | `MOCK_NODES` (3개 하드코딩) | K8s API 실시간 조회 |
| 파드 목록/상태/재시작 | `MOCK_PODS` (9개 하드코딩) | K8s API 실시간 조회 |
| RPS / Latency / Error Rate / Kafka Lag | `MOCK_METRICS` 배열 | Mimir Prometheus 쿼리 |
| 로그 스트림 | `MOCK_LOGS` 10개 순환 | 실제 pod log (kubectl 경유) |

---

## 아키텍처

```
Frontend (Admin page)
    ↓  GET /api/v1/admin/nodes
    ↓  GET /api/v1/admin/pods
    ↓  GET /api/v1/admin/metrics
Backend (FastAPI)
    ├─ kubernetes Python client → K8s API Server (in-cluster)
    └─ httpx → Mimir (192.168.56.30:9009/prometheus)
```

---

## 구현 범위

### Phase 1: Backend - Admin API 라우터

#### 1-1. `backend/requirements.txt`
```
kubernetes>=29.0.0    # K8s in-cluster client
```

#### 1-2. `backend/app/routers/admin.py` (신규)

| 엔드포인트 | 설명 | 데이터 소스 |
|-----------|------|-----------|
| `GET /api/v1/admin/nodes` | 노드 목록 + CPU/Memory 사용량 | K8s metrics-server (`kubectl top nodes`) |
| `GET /api/v1/admin/pods` | 파드 목록, 상태, 재시작 횟수, 노드 | K8s API (`kubectl get pods -A`) |
| `GET /api/v1/admin/metrics` | RPS, P95 Latency, Error Rate, Kafka Lag | Mimir Prometheus query |

**응답 스키마 예시:**

```json
// GET /api/v1/admin/nodes
{
  "nodes": [
    { "name": "worker1", "role": "worker", "status": "Ready",
      "cpu_percent": 35, "memory_percent": 64,
      "cpu_cores": 6, "memory_total_gi": 12, "ip": "192.168.0.223" }
  ]
}

// GET /api/v1/admin/pods
{
  "pods": [
    { "name": "backend-565557f57f-5qnrc", "namespace": "tutum-app",
      "status": "Running", "restarts": 0, "node": "worker2",
      "age": "2h", "ready": "1/1" }
  ]
}

// GET /api/v1/admin/metrics
{
  "rps": [12.3, 15.1, ...],          // 최근 12포인트 (5분 간격)
  "latency_p95": [120, 135, ...],    // ms
  "error_rate": [0.1, 0.0, ...],     // %
  "kafka_lag": [0, 2, ...]           // 전체 consumer lag 합계
}
```

#### 1-3. `backend/app/main.py`
- `from .routers import admin` 추가
- `app.include_router(admin.router)` 등록

### Phase 2: K8s RBAC

백엔드 파드가 K8s API를 읽으려면 ServiceAccount + ClusterRole 필요.

#### 2-1. `k8s-manifests/base/backend/rbac.yaml` (신규)

```yaml
ServiceAccount: backend-sa (namespace: tutum-app)
ClusterRole: backend-reader
  rules:
    - nodes, nodes/metrics → get, list
    - pods → get, list (all namespaces)
ClusterRoleBinding: backend-reader-binding
  → backend-sa에 backend-reader 부여
```

#### 2-2. `k8s-manifests/base/backend/deployment.yaml`
```yaml
spec:
  template:
    spec:
      serviceAccountName: backend-sa   # 추가
```

#### 2-3. `k8s-manifests/base/kustomization.yaml`
- `backend/rbac.yaml` 항목 추가

### Phase 3: Frontend - Mock 데이터 교체

#### 3-1. `frontend/app/admin/page.tsx`
- `MOCK_NODES` → `useEffect` + `fetch("/api/v1/admin/nodes")` 로 교체
- `MOCK_PODS` → `fetch("/api/v1/admin/pods")` 로 교체
- `MOCK_METRICS` → `fetch("/api/v1/admin/metrics")` 로 교체
- 로딩 스켈레톤 추가
- 에러 상태 처리 (API 실패 시 "--" 표시)
- 30초 자동 폴링 (`setInterval`)

> **Logs 탭**: Loki 연동은 복잡도가 높아 이번 scope 제외. Mock 유지.

---

## 작업 순서

```
1. feat/admin-realdata 브랜치 생성
2. backend/requirements.txt 수정
3. backend/app/routers/admin.py 작성
4. backend/app/main.py 라우터 등록
5. k8s-manifests/base/backend/rbac.yaml 작성
6. deployment.yaml serviceAccountName 추가
7. kustomization.yaml 업데이트
8. frontend/app/admin/page.tsx 실데이터 연동
9. 클러스터 적용 (kubectl apply)
10. 동작 확인
11. dev_log 작성 + develop 머지
```

---

## 고려 사항

- **인증**: Admin API는 현재 auth 미적용. 내부 서비스 간 통신이므로 일단 공개. 추후 JWT 또는 internal token 검토
- **Mimir 접근**: 백엔드 파드 → `http://192.168.56.30:9009` 직접 접근 (클러스터 외부 IP). 방화벽 허용 여부 확인 필요
- **metrics-server**: 이미 배포됨 (`kube-system/metrics-server`). `kubectl top nodes` 데이터 사용 가능
- **CORS**: 프론트에서 백엔드 호출 시 `/api/v1/admin/*` 경로가 Istio VirtualService에 라우팅되는지 확인
- **K8s client 버전**: K8s 1.29.15 클러스터 → `kubernetes>=29.0.0` 호환

---

## 파일 변경 목록 (예상)

```
수정:
  backend/requirements.txt
  backend/app/main.py
  k8s-manifests/base/backend/deployment.yaml
  k8s-manifests/base/kustomization.yaml
  frontend/app/admin/page.tsx

신규:
  backend/app/routers/admin.py
  k8s-manifests/base/backend/rbac.yaml
```
