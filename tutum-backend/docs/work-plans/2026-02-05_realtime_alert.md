# Work Plan: Real-time Crypto Price Alert System

**Date**: 2026-02-05
**Task**: Implement Real-time Price Monitoring and Alerting
**Branch**: `kyk/0205-alert-system`
**Depends On**: `kyk/0205-logo` (Notification Popover UI가 이미 구현되어 있어야 함)

## 1. Goal Description
The user wants to implement "Real-time Sharp Drop Alerts" for cryptocurrencies.
Instead of just static mock data, the system should:
1.  Monitor cryptocurrency prices in the background.
2.  Detect sharp drops (e.g., > 3% drop in 5 minutes).
3.  Generate notifications that appear in the frontend.

## 2. Architecture & Design

### 2.1 Backend Architecture
*   **Background Task**: Use `asyncio.create_task` within FastAPI `lifespan` to run a monitoring loop every 60 seconds.
    *   Why? Lightweight and requires no extra infrastructure (like Celery/Redis) for this MVP.
    *   **현재 상태**: `backend/app/main.py`에 lifespan이 이미 구현되어 있음 (`@asynccontextmanager async def lifespan`). MongoDB/Redis 연결 관리 중. 여기에 모니터링 태스크를 추가하면 됨.
*   **Data Source**: Reuse `crypto_client` singleton in `services/market_data.py` to fetch prices for major coins (BTC, ETH, XRP, SOL).
    *   **현재 상태**: `CryptoClient` 클래스가 이미 존재. `async def get_current_price(ticker)` 메서드가 Upbit API(`https://api.upbit.com/v1/ticker`)를 호출하여 현재가를 반환함. `httpx` (v0.26.0) 기반 비동기 HTTP 클라이언트 사용 중.
    *   **주의**: 현재 `get_current_price()`는 단일 티커만 지원. 모니터링 시 여러 코인을 한 번에 조회하려면 Upbit API의 `markets` 파라미터에 콤마 구분으로 여러 티커를 전달하는 배치 메서드 추가 권장.
*   **Logic**:
    *   Maintain a simple in-memory history of prices: `price_history = { "KRW-BTC": [ {price, time}, ... ] }`.
    *   Compare Current Price vs 5 minutes ago.
    *   If `(Current - Old) / Old < -0.03` (3% drop) -> Create Notification.
    *   **급등 알림도 고려**: 급락뿐 아니라 급등(> 3% 상승)도 유용한 알림. 단, MVP에서는 급락만 구현하고 추후 확장 가능하도록 threshold를 설정값으로 분리.
    *   **중복 알림 방지**: 동일 코인에 대해 연속으로 동일 알림이 생성되지 않도록, 마지막 알림 시각을 추적하고 cooldown (예: 10분) 적용 필요.
*   **Notification Storage**:
    *   For MVP, store in an in-memory list `global_notifications`.
    *   **메모리 관리**: 알림이 무한히 쌓이지 않도록 최대 100건 제한, FIFO 방식으로 오래된 알림 제거.
    *   Later, this will move to MongoDB `notifications` collection.

### 2.2 API Design
*   **Decision**: Use **Polling** (every 30s) for simplicity and robustness in MVP.
    *   **근거**: 현재 프론트엔드에 SSE/WebSocket 패턴이 없고, `useCoins` 훅이 이미 30초 간격 polling 패턴을 사용 중이므로 동일 패턴 적용이 일관성 있음.
*   **New Router**: `backend/app/routers/notifications.py`
    *   `GET /api/v1/notifications` — 알림 목록 반환 (최신순 정렬)
        *   Query params: `limit` (default: 20), `unread_only` (default: false)
        *   Response: `{ notifications: [...], unread_count: number }`
    *   `PATCH /api/v1/notifications/{id}/read` — 개별 알림 읽음 처리 (향후)
    *   `POST /api/v1/notifications/read-all` — 전체 읽음 처리 (향후)
*   **Router 등록**: `main.py`에 추가 필요
    ```python
    app.include_router(notifications.router, prefix=f"{settings.API_V1_PREFIX}/notifications", tags=["알림"])
    ```

### 2.3 Backend File Structure
```
backend/app/
├── services/
│   └── alert_service.py          # NEW - MarketMonitor 클래스
├── routers/
│   └── notifications.py          # NEW - 알림 API 엔드포인트
├── models/
│   └── notification.py           # NEW - Pydantic 스키마
└── main.py                       # MODIFY - lifespan에 모니터링 태스크 추가
```

### 2.4 Frontend Implementation
*   **File**: `frontend/components/PortfolioHeader.tsx`
    *   현재 `SAMPLE_NOTIFICATIONS` 상수를 API 호출로 교체.
    *   `useEffect` + `setInterval`(30초) 패턴 사용 (기존 `useCoins` 훅과 동일 패턴).
    *   **react-query 미설치** 상태이므로 네이티브 `fetch` + `useState`로 구현.
    *   API base URL: `process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'` (기존 패턴 동일)
*   **알림 데이터 타입 변경**:
    *   현재 mock: `{ id, title, message, time: string, read: boolean }`
    *   API 응답: `{ id, title, message, created_at: ISO string, is_read: boolean, type: string }`
    *   `time` 필드를 상대 시간 문자열로 변환하는 유틸 함수 필요 (e.g., "방금 전", "5분 전")
*   **"모두 읽음 표시" 버튼**: 현재 UI에 이미 존재하지만 기능 없음. MVP에서는 프론트엔드 로컬 상태로만 처리, 추후 API 연동.

## 3. Implementation Steps (구현 순서)

### Step 1: Backend - Notification Model (`backend/app/models/notification.py`)
*   Pydantic `BaseModel` 정의:
    ```python
    class Notification(BaseModel):
        id: str
        type: str  # "PRICE_DROP", "PRICE_SURGE", "SYSTEM"
        title: str
        message: str
        is_read: bool = False
        created_at: datetime

    class NotificationListResponse(BaseModel):
        notifications: list[Notification]
        unread_count: int
    ```

### Step 2: Backend - Alert Service (`backend/app/services/alert_service.py`)
*   `MarketMonitor` 클래스 구현:
    *   `__init__`: price_history dict, notifications list, cooldown tracker 초기화
    *   `start_monitoring()`: `while True` 비동기 루프, 60초 간격
    *   `_fetch_prices()`: `crypto_client`를 사용해 BTC, ETH, XRP, SOL 가격 조회
    *   `_check_price_drops()`: 5분 전 가격 대비 변동률 계산, 임계값 초과 시 알림 생성
    *   `_create_notification()`: 알림 객체 생성 및 리스트에 추가
    *   `get_notifications()`: 외부에서 알림 리스트 조회 (라우터에서 호출)
*   **에러 처리**: Upbit API 호출 실패 시 예외를 삼키고(swallow) 로그만 남기되, 모니터링 루프는 계속 실행
*   `main.py` lifespan에 통합:
    ```python
    async def lifespan(app: FastAPI):
        await connect_to_mongodb()
        monitor = MarketMonitor()
        monitor_task = asyncio.create_task(monitor.start_monitoring())
        app.state.market_monitor = monitor  # 라우터에서 접근용
        yield
        monitor_task.cancel()
        await close_mongodb_connection()
        await close_redis_connection()
    ```

### Step 3: Backend - Notification Router (`backend/app/routers/notifications.py`)
*   `GET /` 엔드포인트 구현
*   `app.state.market_monitor`에서 알림 리스트 가져오기
*   `main.py`에 라우터 등록

### Step 4: Frontend - Notification Polling (`frontend/components/PortfolioHeader.tsx`)
1.  `SAMPLE_NOTIFICATIONS` 상수 제거
2.  `notifications` state + `useEffect` polling 로직 추가
3.  상대 시간 변환 유틸 함수 작성 (인라인 또는 `lib/utils.ts`)
4.  "모두 읽음 표시" 버튼에 로컬 상태 업데이트 연결
5.  API 호출 실패 시 빈 배열 폴백 처리

### Step 5: 테스트용 임계값 환경변수 추가
*   `backend/app/core/config.py`에 `ALERT_THRESHOLD: float = 0.03` 추가
*   테스트 시 `.env`에서 `ALERT_THRESHOLD=0.0001`로 설정하여 쉽게 트리거 가능

## 4. Browsing Test Scenarios

### Scenario A: Backend Log Check
1.  Start backend server: `uvicorn app.main:app --reload`
2.  **Pass Criteria**: 터미널에 "Market Monitor: Checking prices..." 로그가 60초 간격으로 출력됨.

### Scenario B: API Endpoint Test
1.  `GET http://localhost:8000/api/v1/notifications`
2.  **Pass Criteria**: JSON 응답 `{ "notifications": [...], "unread_count": N }` 반환. 알림이 없으면 빈 배열.

### Scenario C: Trigger Alert (Low Threshold)
1.  `.env`에 `ALERT_THRESHOLD=0.0001` 설정 후 서버 재시작.
2.  2~3분 대기.
3.  `GET http://localhost:8000/api/v1/notifications`
4.  **Pass Criteria**: 가격 변동 알림이 1건 이상 생성되어 반환됨.

### Scenario D: Frontend Integration
1.  Navigate to `http://localhost:3000/portfolio/asset`.
2.  Bell 아이콘 클릭.
3.  **Pass Criteria**:
    *   Popover에 API에서 가져온 실시간 알림이 표시됨.
    *   30초 후 새 알림이 있으면 Bell 아이콘의 빨간 점이 업데이트됨.
    *   API 오류 시에도 UI가 깨지지 않음 (빈 상태 표시).

### Scenario E: Cooldown & Deduplication
1.  Low threshold 상태에서 5분 이상 대기.
2.  **Pass Criteria**: 동일 코인에 대해 cooldown 시간(10분) 내 중복 알림이 생성되지 않음.

## 5. Refinements by Claude

### 코드 리뷰 결과

1.  **CryptoClient 배치 조회 미지원**: 현재 `get_current_price()`는 단일 티커만 조회. Upbit API는 `?markets=KRW-BTC,KRW-ETH,KRW-XRP,KRW-SOL` 형태로 다중 조회를 지원하므로, 모니터링 효율을 위해 `get_multiple_prices(tickers: list[str])` 메서드 추가 권장. API 호출 횟수를 4회→1회로 줄일 수 있음.

2.  **In-memory 저장소의 한계**: 서버 재시작 시 알림이 모두 사라짐. MVP에서는 허용하되, 이를 사용자에게 명시하거나 서버 시작 시 "서비스가 재시작되었습니다" 시스템 알림을 자동 생성하는 것을 고려.

3.  **라우터에서 MonitorState 접근**: `app.state.market_monitor`를 통해 라우터에서 모니터 인스턴스에 접근하는 패턴은 FastAPI에서 공식적으로 지원되는 방식. 단, `Request` 객체를 통해 `request.app.state.market_monitor`로 접근해야 함.

4.  **프론트엔드 polling 최적화**: 브라우저 탭이 비활성(hidden) 상태일 때는 polling을 중단하고, 다시 활성화될 때 즉시 한 번 fetch하도록 `document.visibilitychange` 이벤트 활용 권장. 기존 `useCoins`에도 이 패턴이 없으므로, 이번에 도입하면 향후 다른 훅에도 적용 가능.

5.  **CORS 설정 확인 필요**: 프론트엔드(localhost:3000)→백엔드(localhost:8000) 호출 시 CORS가 필요. `main.py`에 이미 CORS 미들웨어가 있는지 확인 필요. 없으면 추가해야 함.

6.  **ccxt 라이브러리 활용 가능**: `requirements.txt`에 `ccxt==4.4.22`가 이미 설치되어 있음. Upbit 외에 다중 거래소 지원이 필요할 때 `crypto_client` 대신 ccxt를 활용할 수 있음. 단, MVP에서는 기존 `crypto_client`(Upbit 직접 호출)로 충분.
