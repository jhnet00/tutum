# 개발 로그 작업 요약 (2026-02-27)

## 1. 작업 요약
- 작업 일시: 2026-02-27
- 작업자: jhnet00
- 브랜치: `feat/admin-realdata` → `develop` 머지
- 작업 목적: Admin 대시보드 Mock 데이터 → K8s API / Mimir 실데이터 연동

---

## 2. 배경

기존 `/admin` 페이지는 전부 하드코딩 Mock 데이터 사용:
- 노드 3개 고정 (실제: cp1~3 + worker1~3)
- 파드 9개 고정 (실제: 13개+)
- 메트릭 배열 하드코딩
- 클러스터 IP 오기재 (56.20 → 실제 0.220)

---

## 3. 상세 변경 사항

### 3-1. Backend - Admin API 라우터

**파일**: `backend/app/routers/admin.py` (신규)

| 엔드포인트 | 데이터 소스 | 응답 |
|-----------|-----------|------|
| `GET /api/v1/admin/nodes` | K8s metrics-server (CustomObjectsApi) | 노드별 CPU%, Memory%, status, role |
| `GET /api/v1/admin/pods` | K8s CoreV1Api (all namespaces) | 파드 목록, status, restarts, ready, node, age |
| `GET /api/v1/admin/metrics` | Mimir `http://192.168.56.30:9009/prometheus` | RPS, P95 latency, Error rate, Kafka lag (최근 1시간, 5분 간격 12포인트) |

**Mimir 쿼리:**
```
rps:         sum(rate(http_requests_total{namespace="tutum-app"}[2m]))
latency_p95: histogram_quantile(0.95, ...) * 1000
error_rate:  5xx비율 * 100
kafka_lag:   sum(kafka_consumergroup_lag)
```

**K8s 파드 필터링**: `tutum-app`, `tutum-data`, `monitoring`, `keda` 네임스페이스만 표시

### 3-2. Backend - 의존성 및 라우터 등록

**파일**: `backend/requirements.txt`
```
kubernetes>=29.0.0    # K8s in-cluster client 추가
```

**파일**: `backend/app/main.py`
```python
from .routers import admin
app.include_router(admin.router, prefix=f"{settings.API_V1_PREFIX}", tags=["admin"])
```

### 3-3. K8s RBAC

**파일**: `k8s-manifests/base/backend/rbac.yaml` (신규)

```
ServiceAccount: backend-sa (tutum-app)
ClusterRole: backend-cluster-reader
  - nodes, pods: get, list
  - metrics.k8s.io/nodes, pods: get, list
ClusterRoleBinding: backend-cluster-reader-binding
```

**파일**: `k8s-manifests/base/backend/deployment.yaml`
- `serviceAccountName: backend-sa` 추가 (K8s API 접근 권한 부여)

**파일**: `k8s-manifests/base/kustomization.yaml`
- `backend/rbac.yaml` 항목 추가

### 3-4. Frontend - 실데이터 연동

**파일**: `frontend/app/admin/page.tsx`

**교체된 항목:**
| 이전 | 이후 |
|------|------|
| `MOCK_NODES` 하드코딩 | `GET /api/v1/admin/nodes` fetch |
| `MOCK_PODS` 하드코딩 | `GET /api/v1/admin/pods` fetch |
| `MOCK_METRICS` 배열 | `GET /api/v1/admin/metrics` fetch + MiniChart |
| Grafana iframe 스파크라인 | SVG MiniChart (실데이터) |
| 노드 IP 192.168.56.x | 실제 노드 IP 동적 표시 |

**추가된 UX:**
- 로딩 중 텍스트 ("노드 정보 로딩 중...")
- API 실패 시 에러 메시지 표시
- 30초 자동 폴링 + "updated HH:MM:SS" 헤더 표시
- Pods 탭에 `Ready` 컬럼 추가 (`1/1` 형태)
- Pods 탭 파드 수 동적 표시

**유지된 항목:**
- Logs 탭: Mock 유지 (Loki 연동은 추후 과제)
- Monitoring 탭: Grafana iframe 그대로 (실제 Grafana 패널 표시)
- Services 섹션: 정적 서비스 목록 (K8s Service 조회 추후 과제)

---

## 4. 작업 중 이슈 및 대응

### 이슈 1: backend deployment heredoc SSH 전달 지연
- `ssh "kubectl apply -f - << EOF"` 방식이 timeout
- **대응**: `scp`로 파일 복사 후 `kubectl apply -f /tmp/...`

### 이슈 2: metrics-server CustomObjectsApi group 경로
- K8s metrics-server는 `metrics.k8s.io/v1beta1` Custom API 사용
- **대응**: `CustomObjectsApi.list_cluster_custom_object(group="metrics.k8s.io", version="v1beta1", plural="nodes")`

---

## 5. 결과

| 항목 | 결과 |
|------|------|
| Admin API 3개 엔드포인트 | ✅ 구현 완료 |
| K8s RBAC 클러스터 적용 | ✅ ServiceAccount + ClusterRoleBinding |
| frontend 실데이터 연동 | ✅ nodes/pods/metrics 모두 교체 |
| 30초 자동 폴링 | ✅ |
| 로딩/에러 상태 처리 | ✅ |

---

## 6. 커밋 로그

```
d8547fc feat(admin): connect real K8s and Mimir data to admin dashboard
```

---

## 7. 후속 작업 / 리스크

- **Mimir 접근 가능 여부**: 백엔드 파드에서 `192.168.56.30:9009` 접근 확인 필요. 방화벽 이슈 시 Mimir metrics는 빈 배열로 폴백
- **CORS**: admin 엔드포인트가 Istio VirtualService 라우팅에 포함되는지 확인 필요 (`/api/v1/admin/*`)
- **kubernetes 패키지 설치**: 다음 CI 빌드 시 이미지에 반영됨 (requirements.txt 변경)
- **Logs 탭 Loki 연동**: 이번 scope 제외. `loki.tutum.my/loki/api/v1/query_range` 사용 가능
- **Services 섹션**: 현재 정적 목록. K8s `list_service_for_all_namespaces()` 로 동적 조회 가능
