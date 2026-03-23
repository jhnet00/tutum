# 2026-03-10 Admin 대시보드 Mimir/Loki 테넌트 헤더 수정

- 작업자: 박성준
- 작업 시간: 2026-03-10 (오후)

## 문제

`tutum.my/admin` 대시보드에서 모든 KPI 메트릭이 N/A로 표시되고,
"Mimir 데이터 없음" 메시지가 나타남. 또한 "Cluster UNKNOWN" 배지 표시.

## 원인 분석

`backend/app/routers/admin.py` 내 공유 HTTP 클라이언트 초기화 시
Mimir와 Loki 요청에 필수 멀티테넌트 헤더 누락:

```python
# 수정 전 (헤더 없음)
_HTTP_MIMIR = httpx.AsyncClient(timeout=5.0)
_HTTP_LOKI  = httpx.AsyncClient(timeout=8.0)
```

- Mimir: `X-Scope-OrgID` 헤더 없이 요청 → `401 Unauthorized: no org id`
  - `/admin/metrics` 엔드포인트 모든 PromQL 쿼리 실패 → 전체 KPI N/A
- Loki: 동일하게 `X-Scope-OrgID` 없으면 `401` → `/admin/logs` 로그 조회 실패

현장 검증 (backend pod 내):
```bash
# 헤더 없음 → 401
curl -s http://10.60.11.95:9009/api/v1/query?query=up
# → 401 Unauthorized: no org id

# 헤더 포함 → 200
curl -s -H "X-Scope-OrgID: tutum" http://10.60.11.95:9009/api/v1/query?query=up
# → {"status":"success","data":{"resultType":"vector","result":[...]}}
```

## 수정

`backend/app/routers/admin.py` 라인 98~100:

```python
# 수정 후 — X-Scope-OrgID: tutum 헤더 포함
_HTTP_MIMIR = httpx.AsyncClient(timeout=5.0, headers={"X-Scope-OrgID": "tutum"})
_HTTP_LOKI  = httpx.AsyncClient(timeout=8.0, headers={"X-Scope-OrgID": "tutum"})
_HTTP_MISC  = httpx.AsyncClient(timeout=8.0)
```

## 영향 범위

| 엔드포인트 | 사용 클라이언트 | 수정 효과 |
|-----------|---------------|----------|
| `/admin/metrics` | `_HTTP_MIMIR` | KPI (RPS, P95, Error Rate, Kafka Lag) 정상 표시 |
| `/admin/node-history` | `_HTTP_MIMIR` | 노드 CPU/MEM 시계열 정상 |
| `/admin/data-metrics` | `_HTTP_MIMIR` | Kafka lag, MongoDB, Disk 메트릭 정상 |
| `/admin/infra-diagnose` | `_HTTP_MIMIR` | 인프라 진단 Mimir 쿼리 정상 |
| `/admin/logs` | `_HTTP_LOKI` | 실시간 로그 + 에러 이력 정상 |
| `/admin/log-diagnose` | `_HTTP_LOKI` | 로그 진단 정상 |

## 참고

- Mimir 테넌트 설정: `alloy-config` ConfigMap에 `X-Scope-OrgID: tutum` 이미 설정됨 (Phase B 수정)
- Loki 테넌트 설정: `alloy-config`의 `tenant_id = "tutum"` 이미 설정됨 (Phase B 수정)
- 백엔드 코드에서만 누락되어 있었음
