# 2026-02-27 /api/health 엔드포인트 Istio 게이트웨이 노출 수정

## 작업자
박성준

## 작업 유형
Backend 버그 수정

## 배경
Istio IngressGateway를 통한 외부 요청 시 `GET /api/health`가 404를 반환하는 문제 발견.
K8s liveness/readiness probe는 pod 내부에서 `/health`를 직접 호출하므로 정상이었으나,
게이트웨이를 통한 외부 health 체크는 불가능한 상태였음.

## 원인 분석

### Istio VirtualService 라우팅 규칙
```
/api  →  backend (port 8000)
/     →  frontend (port 3000)   ← /health 여기에 걸림!
```

### 요청별 결과 (수정 전)
| 경로 | 라우팅 | 결과 |
|------|--------|------|
| `GET /health` | prefix `/` → frontend | Next.js 404 |
| `GET /api/health` | prefix `/api` → backend | FastAPI 404 (route 없음) |

백엔드 실제 route는 `@app.get("/health")`로만 등록되어 있어서
게이트웨이를 통해 오는 `/api/health` 요청을 처리할 핸들러가 없었음.

## 수정 내용 — `backend/app/main.py`

```python
# 수정 전
@app.get("/health")
async def liveness():
    return {"status": "alive"}

# 수정 후
@app.get("/health")
@app.get("/api/health")    ← 추가
async def liveness():
    return {"status": "alive"}
```

- `/health`: K8s liveness/readiness probe용 (pod 내부 직접 호출) 유지
- `/api/health`: Istio 게이트웨이 통한 외부 health 체크용 추가

## 수정 방법 선택 이유

| 방법 | 설명 | 결정 |
|------|------|------|
| **옵션 A** Istio VirtualService 수정 | `/health` exact match 추가 | ❌ K8s 매니페스트 변경, ArgoCD sync 필요 |
| **옵션 B** Backend route 추가 | `/api/health` alias 추가 | ✅ 코드 1줄, 단순, 무중단 |

## 테스트 결과

| 테스트 | 수정 전 | 수정 후 |
|--------|--------|---------|
| `GET /api/health` via 게이트웨이 | `HTTP 404 {"detail":"Not Found"}` | `HTTP 200 {"status":"alive"}` ✅ |
| `GET /health` pod 내부 | `HTTP 200 {"status":"alive"}` | `HTTP 200 {"status":"alive"}` ✅ |
| `GET /api/v1/market/...` 기존 API | 정상 | 정상 ✅ |

## 배포 정보
- Image digest: `sha256:9b4e344e...` (신규 빌드 확인)
- Rollout restart: backend deployment (tutum-app ns)
- 다운타임: 없음 (rolling update)

## 수정 파일
- `backend/app/main.py` (decorator 1줄 추가)
