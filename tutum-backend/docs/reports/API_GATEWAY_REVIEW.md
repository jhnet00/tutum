# API Gateway 현황 분석 및 이관 제안

> CloudDX(Tutum) K8s 마이그레이션 — API Gateway 기능 리뷰
>
> 기준 코드: `develop` 브랜치 (2026-02-12, commit `12d882a`)
>
> 목적: 실무자 리뷰 및 아키텍처 의사결정을 위한 참고 문서

---

## 1. 현재 구조 요약

```
클라이언트 (브라우저)
    │
    ▼
┌──────────────────────────────────────────────────────┐
│  Istio Ingress Gateway (MetalLB 192.168.56.100)       │
│  - TLS 종료 (443 → HTTPS)                             │
│  - HTTP → HTTPS 리다이렉트                             │
│  - 경로 라우팅 (/api/* → Backend, 나머지 → Frontend)    │
│  - mTLS (서비스 간), Circuit Breaker, 재시도/타임아웃   │
└───────────────┬──────────────────────────────────────┘
                │
          ┌─────┴──────┐
          ▼            ▼
     Backend         Frontend
    (FastAPI)       (Next.js)
    ┌──────────┐    ┌──────────┐
    │ Gateway  │    │ 미들웨어  │
    │ 기능 직접 │    │ 쿠키 기반 │
    │ 처리 중:  │    │ 라우트   │
    │          │    │ 보호     │
    │ • CORS   │    └──────────┘
    │ • JWT    │
    │ • Rate   │
    │   Limit  │
    │ • Health │
    │   Check  │
    └──────────┘
         │
    ┌────┴────────────┐
    │  데이터 레이어    │
    │ MariaDB (회원)   │
    │ MongoDB (자산)   │
    │ Redis (캐시)     │
    │ Elasticsearch   │
    └─────────────────┘
```

Istio Ingress Gateway는 **TLS 종료 + 경로 라우팅 + mTLS**를 담당하고,
API Gateway가 일반적으로 처리하는 횡단 관심사(Cross-Cutting Concerns)는 **FastAPI 백엔드에 직접 구현**되어 있습니다.

---

## 2. Backend에서 API Gateway 역할을 대신하고 있는 기능들

### 2.1 CORS (Cross-Origin Resource Sharing)

| 항목 | 현재 상태 |
|------|-----------|
| **파일** | `backend/app/main.py:72-78` |
| **구현** | FastAPI `CORSMiddleware` |
| **설정** | `localhost:3000`, `127.0.0.1:3000` 하드코딩 |

```python
# main.py:72-78
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**문제점:**
- Origin이 개발 환경 전용으로 하드코딩 — 프로덕션 도메인(`tutum.example.com`) 없음
- `allow_methods=["*"]`, `allow_headers=["*"]` — 프로덕션에서는 명시적 화이트리스트 권장
- Backend Pod가 여러 개일 때 각 Pod마다 동일 설정 유지 필요

---

### 2.2 인증/인가 (JWT)

| 항목 | 현재 상태 |
|------|-----------|
| **파일** | `backend/app/routers/auth.py:126-156` |
| **구현** | `get_current_user()` → FastAPI `Depends()` 데코레이터 |
| **방식** | JWT HS256 디코딩 → MariaDB에서 사용자 조회 |
| **적용** | `assets`, `portfolio`, `transactions`, `chat`, `auth/me` |

```python
# auth.py:126-156
async def get_current_user(token: str = Depends(oauth2_scheme)):
    # 1. JWT 디코딩 + 검증
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    user_id_str = payload.get("sub")

    # 2. MariaDB에서 사용자 조회 (정수 ID)
    user = await get_user_by_id(int(user_id_str))
    return _user_to_response(user)
```

**특이사항 (최근 변경):**
- MongoDB → MariaDB로 인증 DB 전환 완료 (`commit 7fbfb6b`)
- **토큰 블랙리스트 미사용** — `cache.py`에 `blacklist_token()`, `is_token_blacklisted()` 함수는 존재하지만, `get_current_user()`에서 호출하지 않음
- 로그아웃은 쿠키 삭제만 수행 (`auth.py:486-489`)
- 매 인증 요청마다 MariaDB 조회 발생 (user_id로 `SELECT`)

**문제점:**
- 모든 인증 요청이 Backend Pod까지 도달한 후에야 검증됨
- 유효하지 않은 토큰도 Backend 리소스(CPU, DB 커넥션)를 소비
- 토큰 탈취 시 무효화 수단 없음 (블랙리스트 미활성)

---

### 2.3 Rate Limiting

| 항목 | 현재 상태 |
|------|-----------|
| **파일** | `backend/app/middleware/rate_limit.py` |
| **구현** | Redis INCR + TTL, 엔드포인트별 수동 호출 |
| **정의** | `login` (5회/5분), `register` (3회/시간), `chat` (10회/분) |
| **실제 호출** | **`chat` 엔드포인트 1개에서만 사용** |

```python
# rate_limit.py:19-23 — 3개 엔드포인트 정의
RATE_LIMITS = {
    "login":    {"max_requests": 5,  "window_seconds": 300},
    "register": {"max_requests": 3,  "window_seconds": 3600},
    "chat":     {"max_requests": 10, "window_seconds": 60},
}
```

```python
# chat.py:31 — 실제 호출 (유일한 곳)
await check_rate_limit(request, "chat", user_id=current_user.id)
```

**문제점:**
- `login`, `register`에 대한 Rate Limit이 **정의만 되어 있고 실제 호출되지 않음** (최근 MariaDB 전환 시 제거됨)
- 전체 8개 라우터 중 1개(`chat`)에만 적용 — 나머지 API는 무제한
- 글로벌 Rate Limit(전체 API 대상) 없음 → DDoS에 무방비
- Redis 미연결 시 모든 Rate Limit 비활성화 (graceful fallback이지만 보안 공백)

---

### 2.4 외부 API 타임아웃/재시도

| 항목 | 현재 상태 |
|------|-----------|
| **파일** | `backend/app/services/market_data.py` |
| **구현** | `httpx.AsyncClient(timeout=N)` + 수동 재시도 |
| **대상** | KIS API (주식), Upbit API (암호화폐), 환율 API |

```python
# market_data.py — 타임아웃 현황
KIS 토큰 발급:    httpx.AsyncClient(timeout=10.0)   # :104
KIS 시세 조회:    httpx.AsyncClient(timeout=10.0)   # :168
KIS 차트 데이터:  httpx.AsyncClient(timeout=10.0)   # :287
Upbit 시세 조회:  httpx.AsyncClient(timeout=5.0)    # :389
Upbit 차트 데이터: httpx.AsyncClient(timeout=10.0)  # :441
환율 API 조회:    httpx.AsyncClient(timeout=5.0)    # :501
```

```python
# market_data.py:170-201 — KIS 재시도 로직
for attempt in range(2):
    token = await self._get_access_token()
    ...
    if data.get("msg_cd") == "EGW00121" and attempt == 0:
        await self._invalidate_token_cache()  # 토큰 무효화 후 재시도
        continue
```

**문제점:**
- Circuit Breaker 패턴 없음 → 외부 API 장애 시 Backend 전체가 느려짐
- 재시도 횟수/간격이 하드코딩 (KIS만 1회 재시도, Upbit/환율은 재시도 없음)
- KIS 토큰 캐싱은 4단계 폴백 (메모리 → Redis → 파일 → API), 복잡도 높음

---

### 2.5 헬스체크

| 항목 | 현재 상태 |
|------|-----------|
| **파일** | `backend/app/main.py:86-112` |
| **구현** | `GET /health` 단일 엔드포인트 |
| **검사 대상** | MongoDB, MariaDB, Redis, Elasticsearch (4개 서비스) |

```python
# main.py:86-112
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "services": {
            "mongodb": "connected" if mongo_client else "disconnected",
            "mariadb": "connected" if mariadb_engine else "disconnected",
            "redis": "connected" if redis_client else "disconnected",
            "elasticsearch": "connected" if es_client else "disconnected",
        },
    }
```

**문제점:**
- Liveness/Readiness Probe가 분리되지 않음 (K8s에서는 별도 필요)
- 에러 시 `traceback`을 응답에 포함 → 프로덕션 보안 위험
- MongoDB/Redis 등 장애 시에도 HTTP 200 반환 (status 필드만 다름)
- 4개 DB 중 어느 하나라도 끊기면 Readiness에서 빠져야 하는데, 현재는 항상 200

---

### 2.6 프론트엔드 라우트 보호 (참고)

| 항목 | 현재 상태 |
|------|-----------|
| **파일** | `frontend/middleware.ts` |
| **구현** | Next.js Middleware (쿠키 기반) |

```typescript
// middleware.ts:4-41
export function middleware(request: NextRequest) {
    const authToken = request.cookies.get('auth_token');
    const isAuthenticated = !!authToken;

    // Protected routes → 미인증 시 /login으로 리다이렉트
    const protectedRoutes = ['/portfolio', '/direct-input', '/confirm-input', '/asset-upload'];

    // Auth routes → 인증 시 /portfolio/asset으로 리다이렉트
    const authRoutes = ['/login', '/register'];
}
```

이것은 API Gateway 기능은 아니지만, **프론트엔드에서 쿠키 존재 여부만으로 라우트를 보호**하고 있어 토큰 유효성 검증은 하지 않는다는 점 참고.

---

## 3. Istio Gateway 레벨에서 이미 처리 중인 기능

| 기능 | Istio 리소스 | K8S_MIGRATION_PLAN.md |
|------|-------------|----------------------|
| TLS 종료 (HTTPS) | `Gateway` | Section 6.2 |
| HTTP → HTTPS 리다이렉트 | `Gateway` | Section 6.2 |
| 경로 기반 라우팅 (`/api/*` → Backend) | `VirtualService` | Section 6.3 |
| 재시도 (5xx, 3회) | `VirtualService` | Section 6.3 |
| 요청 타임아웃 (30s) | `VirtualService` | Section 6.3 |
| mTLS (서비스 간 암호화) | `PeerAuthentication` | Section 6 |
| Circuit Breaker | `DestinationRule` | Section 6 |
| Canary/Blue-Green 배포 | `VirtualService` | Section 24 |
| 네임스페이스 격리 | `NetworkPolicy` | Section 7 |

---

## 4. Gateway로 이관하면 좋을 기능 (제안)

### 4.1 CORS → Istio VirtualService로 이관 (권장도: ★★★)

**이유:**
- CORS는 브라우저 ↔ 서버 간 정책이므로 진입점(Gateway)에서 처리하는 것이 자연스러움
- Backend Pod 수와 무관하게 한 곳에서 관리
- 환경(dev/staging/prod)별 Origin을 Kustomize overlay로 분리 가능

**Istio 구현 방법:**

```yaml
# VirtualService에 CorsPolicy 추가
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: tutum-routing
  namespace: tutum-app
spec:
  hosts:
    - "tutum.example.com"
  gateways:
    - tutum-gateway
  http:
    - match:
        - uri:
            prefix: /api/
      corsPolicy:
        allowOrigins:
          - exact: "https://tutum.example.com"
          # staging overlay에서는 localhost:3000 추가 가능
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
        allowHeaders: ["Authorization", "Content-Type"]
        allowCredentials: true
        maxAge: "86400s"
      route:
        - destination:
            host: backend-svc
            port:
              number: 8000
```

**이관 시 Backend 변경:**
- `main.py`에서 `CORSMiddleware` 제거
- 개발 환경은 Kustomize staging overlay에서 `localhost:3000` Origin 추가

---

### 4.2 글로벌 Rate Limiting → Istio EnvoyFilter (권장도: ★★★)

**이유:**
- 현재 실제 적용된 Rate Limit은 `chat` 1개뿐 — 나머지 모든 API가 무방비
- `login`/`register`의 Rate Limit이 코드에서 제거된 상태 (MariaDB 전환 후)
- Gateway 레벨 글로벌 방어선이 없으면 DDoS/Brute-force에 취약

**Istio 구현 방법:**

```yaml
apiVersion: networking.istio.io/v1alpha3
kind: EnvoyFilter
metadata:
  name: global-rate-limit
  namespace: istio-system
spec:
  workloadSelector:
    labels:
      istio: ingressgateway
  configPatches:
    - applyTo: HTTP_FILTER
      match:
        context: GATEWAY
      patch:
        operation: INSERT_BEFORE
        value:
          name: envoy.filters.http.local_ratelimit
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.filters.http.local_ratelimit.v3.LocalRateLimit
            stat_prefix: http_local_rate_limiter
            token_bucket:
              max_tokens: 100
              tokens_per_fill: 100
              fill_interval: 60s     # IP당 분당 100회
```

**이관 후 역할 분담:**

| 계층 | 역할 | 예시 |
|------|------|------|
| **Gateway (Istio)** | 글로벌 Rate Limit (1차 방어) | IP당 분당 100회 |
| **Backend (FastAPI)** | 비즈니스 Rate Limit (2차) | 채팅 10회/분/유저 |

> Backend의 `chat` Rate Limit은 비즈니스 로직이므로 유지.
> 제거된 `login`/`register` Rate Limit은 Gateway 글로벌 제한으로 커버하거나, Backend에서 재활성화.

---

### 4.3 JWT 검증 → Istio RequestAuthentication (권장도: ★★☆)

**이유:**
- 유효하지 않은 토큰을 Gateway에서 조기 차단 → Backend 부하 감소
- 인증 실패 트래픽이 MariaDB `SELECT` 쿼리를 발생시키지 않음

**Istio 구현 방법:**

```yaml
# JWT 토큰 형식 검증 (Gateway 레벨)
apiVersion: security.istio.io/v1
kind: RequestAuthentication
metadata:
  name: jwt-auth
  namespace: tutum-app
spec:
  selector:
    matchLabels:
      app: backend
  jwtRules:
    - issuer: "tutum-auth"
      jwksUri: "http://backend-svc.tutum-app:8000/.well-known/jwks.json"
      forwardOriginalToken: true   # Backend에도 원본 토큰 전달
---
# 미인증 요청 차단 (public 경로 제외)
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: require-jwt
  namespace: tutum-app
spec:
  selector:
    matchLabels:
      app: backend
  rules:
    # JWT 통과한 요청 허용
    - from:
        - source:
            requestPrincipals: ["*"]
    # Public 경로 허용 (인증 불필요)
    - to:
        - operation:
            paths:
              - "/api/v1/auth/login"
              - "/api/v1/auth/register"
              - "/api/v1/auth/google/*"
              - "/api/v1/auth/kakao/*"
              - "/api/v1/auth/naver/*"
              - "/api/v1/market/*"
              - "/api/v1/news/*"
              - "/health"
              - "/docs"
              - "/redoc"
```

**주의사항 (논의 필요):**
- HS256 → RS256 전환이 필요할 수 있음 (Istio는 JWKS 기반 검증을 권장)
- Backend `get_current_user()`의 MariaDB 조회는 여전히 필요 (사용자 정보 취득)
- 현재 `market`, `news` 라우터는 인증 없이 접근 가능 → public 경로로 등록 필요

---

### 4.4 요청 로깅 / 분산 트레이싱 (권장도: ★★☆)

**현재 상태:**
- 구조화된 요청 로깅 없음 (각 라우터에서 `print()` 산재)
- 분산 트레이싱 미적용
- Request ID 없음 → 장애 시 요청 추적 불가

**Istio가 자동 제공하는 것:**
- Envoy 사이드카가 모든 요청에 대해 access log 자동 생성
- `x-request-id` 헤더 자동 주입
- Kiali로 서비스 간 트래픽 흐름 시각화
- Tempo 연동 시 분산 트레이싱 (LGTM 스택에 이미 포함)

**Backend에서 추가하면 좋을 것:**
- FastAPI 미들웨어로 `x-request-id`를 로그에 포함
- OpenTelemetry SDK 연동 → Tempo로 트레이스 전송
- `print()` → 구조화 로깅(structlog 등)으로 전환

---

### 4.5 이관하지 않고 Backend에 유지할 기능

| 기능 | 유지 이유 |
|------|-----------|
| **`chat` Rate Limit** | 사용자별 AI 호출 제한은 비즈니스 로직 |
| **Pydantic 요청 검증** | 스키마 기반 검증은 서비스 레이어 역할 |
| **OAuth 콜백 처리** | 각 제공자별(Google/Kakao/Naver) 비즈니스 로직 |
| **외부 API 재시도** | KIS/Upbit 토큰 갱신 등 도메인 특화 로직 |
| **MariaDB 사용자 조회** | JWT 검증 통과 후 사용자 정보 취득은 Backend 역할 |
| **Redis 캐싱** | 포트폴리오/시세 캐시는 비즈니스 레이어 |

---

## 5. 현재 발견된 보안 공백 (참고)

최신 코드 기준으로 확인된 보안 관련 미비 사항입니다.

| 항목 | 상태 | 위험도 | 설명 |
|------|------|:------:|------|
| **login Rate Limit 미적용** | 정의만 존재, 호출 안 됨 | 높음 | `auth.py:189` — MariaDB 전환 시 `check_rate_limit()` 호출 제거됨 |
| **register Rate Limit 미적용** | 정의만 존재, 호출 안 됨 | 높음 | `auth.py:164` — 동일 |
| **토큰 블랙리스트 미사용** | 함수 존재, 호출 안 됨 | 중간 | `cache.py:144-181`에 구현 있으나 `get_current_user()`에서 미호출 |
| **헬스체크 traceback 노출** | HTTP 200 + 스택트레이스 | 중간 | `main.py:106-111` — 에러 시 traceback 응답에 포함 |
| **OAuth 콜백 timeout 없음** | `httpx.AsyncClient()` 기본값 | 낮음 | Google/Kakao/Naver 콜백에서 timeout 미지정 |
| **글로벌 Rate Limit 없음** | — | 높음 | 전체 API에 대한 DDoS 방어선 없음 |

---

## 6. 이관 전/후 비교

```
[현재 - AS-IS]                         [제안 - TO-BE]

Client                                  Client
  │                                       │
  ▼                                       ▼
Istio Gateway                           Istio Gateway
  ├─ TLS 종료                             ├─ TLS 종료
  ├─ 경로 라우팅                           ├─ 경로 라우팅
  ├─ mTLS (서비스 간)                      ├─ mTLS (서비스 간)
  ├─ Circuit Breaker                      ├─ Circuit Breaker
  └─ (CORS/인증/Rate Limit 없음)          ├─ ★ CORS 정책
                                          ├─ ★ 글로벌 Rate Limit (IP당)
  │                                       ├─ ★ JWT 형식 검증 (유효성만)
  ▼                                       ├─ ★ Access Log + Request ID
                                          └─ ★ 분산 트레이싱 (자동)
Backend (FastAPI)                           │
  ├─ CORS (개발용 하드코딩)                  ▼
  ├─ JWT 검증 + MariaDB 조회
  ├─ Rate Limit (chat만 활성)             Backend (FastAPI)
  ├─ 타임아웃/재시도 (하드코딩)              ├─ JWT → MariaDB 사용자 조회 (유지)
  ├─ 헬스체크 (Probe 미분리)                ├─ chat Rate Limit (유지)
  └─ Pydantic 검증                         ├─ 타임아웃/재시도 (유지)
                                           ├─ 헬스체크 (Liveness/Readiness 분리)
Frontend (Next.js)                         ├─ Pydantic 검증 (유지)
  └─ 미들웨어 (쿠키 기반 라우트 보호)         └─ CORS 제거 ★

                                         Frontend (Next.js)
                                           └─ 미들웨어 (유지)
```

---

## 7. 실무자에게 질문할 내용

### 아키텍처 결정

**Q1. CORS를 Istio VirtualService로 이관하는 게 맞는지?**
- 현재 Backend `CORSMiddleware`에 개발용 Origin만 하드코딩되어 있습니다.
- Istio `CorsPolicy`로 옮기고 Kustomize overlay로 환경별 분리하려 합니다.
- Backend `CORSMiddleware`를 완전히 제거해도 문제가 없는지?
- 로컬 개발 시에는 어떻게 처리하는 것이 좋은지? (kubectl port-forward 시 CORS 등)

**Q2. JWT 검증을 Gateway 레벨로 올릴 때, HS256 → RS256 전환이 필요한지?**
- 현재 JWT 알고리즘이 HS256(대칭키)입니다.
- Istio `RequestAuthentication`은 JWKS 엔드포인트 기반(RS256)을 권장합니다.
- 소규모 서비스에서 전환 비용 대비 효과가 있는지?
- HS256 유지하면서 Istio에서 검증하는 방법이 실무에서 사용되는지?

**Q3. Rate Limiting 이중 구조(Gateway 글로벌 + Backend 비즈니스)가 일반적인 패턴인지?**
- Gateway에서 IP당 글로벌 제한, Backend에서 사용자별 비즈니스 제한을 분리하려 합니다.
- Istio `EnvoyFilter` Local Rate Limit vs 외부 Rate Limit 서비스(Redis 기반) 중 어떤 것을 권장하는지?
- 현재 `login`/`register` Rate Limit이 코드에서 빠진 상태인데, Gateway 글로벌로 커버되는지 아니면 Backend에서 재적용해야 하는지?

### 운영/보안

**Q4. 토큰 블랙리스트를 다시 활성화해야 하는지?**
- 현재 로그아웃이 쿠키 삭제만 수행하고, JWT 자체는 만료까지 유효합니다.
- `cache.py`에 `blacklist_token()`/`is_token_blacklisted()` 구현은 있으나, `get_current_user()`에서 호출하지 않습니다.
- 토큰 탈취 대응을 위해 블랙리스트를 재활성화하는 것이 좋은지?
- 대안으로 토큰 만료 시간을 짧게 (예: 15분) 하고 Refresh Token 패턴을 쓰는 것이 나은지?

**Q5. 헬스체크에서 에러 시 traceback을 응답에 포함하는 것을 어떻게 처리하는 것이 좋은지?**
- K8s Liveness Probe와 Readiness Probe를 분리할 때 권장 패턴이 있는지?
- 현재는 DB 연결 실패 시에도 HTTP 200 반환 — Readiness에서 빠지지 않음

**Q6. 외부 API(KIS, Upbit) 호출에 Circuit Breaker를 적용한다면?**
- Istio `ServiceEntry` + `DestinationRule` vs 애플리케이션 레벨 (tenacity 등) 중 어떤 것이 적절한지?
- 외부 API는 K8s 클러스터 밖이라 Istio 사이드카가 관여하려면 `ServiceEntry` 등록이 필요한 것으로 알고 있는데 맞는지?

**Q7. 분산 트레이싱(OpenTelemetry + Tempo) 도입 시 최소 설정은?**
- Istio 사이드카가 자동 수집하는 범위와, 애플리케이션에서 추가해야 하는 부분의 경계가 어디인지?
- FastAPI에서 OpenTelemetry SDK를 붙이면 어떤 수준까지 트레이스가 잡히는지?

### 규모/비용

**Q8. 우리 규모에서 Istio Gateway만으로 충분한지?**
- Backend 2 replicas, 소규모 사용자 기준입니다.
- 별도 API Gateway(Kong, APISIX 등)가 필요한 시점이 언제인지?
- Istio Gateway로 부족해지는 기능이 구체적으로 무엇인지?

---

## 8. 현재 코드 위치 정리

| 기능 | 파일 | 라인 |
|------|------|------|
| CORS 설정 | `backend/app/main.py` | 72-78 |
| JWT 인증 (get_current_user) | `backend/app/routers/auth.py` | 126-156 |
| OAuth 공통 헬퍼 | `backend/app/routers/auth.py` | 234-273 |
| 로그아웃 (쿠키 삭제만) | `backend/app/routers/auth.py` | 485-489 |
| Rate Limit 정의 | `backend/app/middleware/rate_limit.py` | 19-23 |
| Rate Limit 호출 (chat만) | `backend/app/routers/chat.py` | 31 |
| 토큰 블랙리스트 (미사용) | `backend/app/cache.py` | 144-181 |
| 헬스체크 | `backend/app/main.py` | 86-112 |
| MariaDB ORM/CRUD | `backend/app/mariadb.py` | 전체 |
| KIS 타임아웃/재시도 | `backend/app/services/market_data.py` | 104, 168, 287 |
| Upbit 타임아웃 | `backend/app/services/market_data.py` | 389, 441 |
| 프론트엔드 미들웨어 | `frontend/middleware.ts` | 전체 |
| Istio Gateway 정의 | `docs/plans/infra/K8S_MIGRATION_PLAN.md` | Section 6.2 |
| Istio VirtualService | `docs/plans/infra/K8S_MIGRATION_PLAN.md` | Section 6.3 |
| NetworkPolicy | `docs/plans/infra/K8S_MIGRATION_PLAN.md` | Section 7 |

### API 라우터별 인증/Rate Limit 적용 현황

| 라우터 | Prefix | 인증 (`get_current_user`) | Rate Limit | 비고 |
|--------|--------|:---:|:---:|------|
| `auth` | `/api/v1/auth` | `/me`만 | 없음 | login/register에 Rate Limit 미적용 |
| `assets` | `/api/v1/assets` | 전체 | 없음 | MongoDB CRUD |
| `portfolio` | `/api/v1/portfolio` | 전체 | 없음 | MariaDB CRUD |
| `transactions` | `/api/v1/transactions` | 전체 | 없음 | |
| `chat` | `/api/v1/chat` | 전체 | 10회/분/유저 | 유일하게 Rate Limit 적용 |
| `market` | `/api/v1/market` | 없음 | 없음 | 공개 API |
| `news` | `/api/v1/news` | 없음 | 없음 | 공개 API |
| `notifications` | `/api/v1/notifications` | — | 없음 | |
