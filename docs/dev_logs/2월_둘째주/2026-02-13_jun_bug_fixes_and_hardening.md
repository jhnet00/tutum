# 개발 작업 완료 보고서 (2026-02-13)

## 작업 개요
**작성자**: `jun`
**Branch**: `jun/dev0210` (← `origin/kyk/0213` 머지 후 추가 수정)
**작업 내용**: kyk/0213 머지 후 발견된 3건의 주요 버그 수정 + 추가 코드 안정성 강화 (6건)

---

## 1. 주요 버그 수정 (사용자 보고 3건)

### 1-1. 보유자산 삼성전자 중복 표시 문제

**증상**: 포트폴리오에서 동일 종목(삼성전자)이 두 행으로 분리되어 표시됨

**원인**:
- `backend/app/mariadb.py`의 `add_portfolio_item()`이 동일 `user_id + asset_code` 조합 검사 없이 항상 INSERT 수행
- 프론트엔드 테이블 key가 `asset.symbol` (undefined) 사용으로 React 렌더링 경고

**해결**:
1. **`backend/app/mariadb.py`** - `add_portfolio_item()` 수정
   - 동일 `user_id + asset_code` 존재 시 수량/평단가 가중평균 병합 (UPSERT 패턴)
   - `merge_duplicate_portfolios()` 함수 추가: 기존 DB 중복 데이터 일괄 정리

2. **`backend/app/main.py`** - startup에서 `merge_duplicate_portfolios()` 1회 실행

3. **`frontend/app/portfolio/asset/page.tsx`** - 테이블 key를 `asset.id || asset.symbol`로 수정

```python
# 핵심 로직: 가중평균 병합
if existing:
    total_cost = (existing.quantity * existing.avg_buy_price) + (quantity * avg_buy_price)
    new_quantity = existing.quantity + quantity
    existing.quantity = new_quantity
    existing.avg_buy_price = total_cost / new_quantity if new_quantity > 0 else 0
```

---

### 1-2. 사용자 자산 기준 추천뉴스 깜빡거림

**증상**: PersonalizedNewsCarousel이 지속적으로 re-fetch하며 화면이 깜빡거림

**원인**:
- `useEffect` 의존성 배열이 `[keywords]`(배열 참조)를 사용
- `holdings.map()`이 매 가격 업데이트마다 새 배열 참조를 생성하여 무한 re-render 발생

**해결**: **`frontend/components/PersonalizedNewsCarousel.tsx`**
- 배열 참조 대신 직렬화된 문자열(`keywords.join(",")`)을 의존성으로 사용

```typescript
const keywordsKey = keywords.join(",");
useEffect(() => {
    const fetchNews = async () => {
        const kws = keywordsKey.split(",").filter(Boolean);
        // ...
    };
    fetchNews();
}, [keywordsKey]);  // 안정적인 문자열 비교
```

---

### 1-3. 로그아웃 미작동

**증상**: 로그아웃 버튼 클릭 후 세션이 유지되며 로그아웃되지 않음

**원인**:
- `frontend/app/api/proxy/[...path]/route.ts`에서 `new Headers(upstream.headers)`가 다중 `Set-Cookie`를 comma-join하여 쿠키 파싱 실패
- 백엔드가 보낸 쿠키 삭제 명령(max-age=0)이 브라우저에 전달되지 않음

**해결**:
1. **`frontend/app/api/proxy/[...path]/route.ts`**
   - `Headers.getSetCookie()` API로 개별 Set-Cookie 헤더 전달

2. **`frontend/contexts/AuthContext.tsx`**
   - 클라이언트 접근 가능한 `csrf_token` 쿠키 직접 삭제
   - `sessionStorage.clear()`로 전체 세션 데이터 정리

```typescript
// Set-Cookie 개별 전달
const setCookies = upstream.headers.getSetCookie?.() ?? [];
for (const cookie of setCookies) {
    responseHeaders.append("set-cookie", cookie);
}
```

---

## 2. 추가 코드 안정성 강화 (3건)

### 2-1. 매도 완료 후 전체 페이지 리로드 → API 재조회로 개선

**파일**: `frontend/app/portfolio/asset/page.tsx`
**변경**: `window.location.reload()` → `fetchHoldings()` 호출
**이유**: F20 이슈 수정 과정에서 발생한 regression - 전체 리로드 시 UX 저하

### 2-2. Bulk 포트폴리오 생성 DoS 방어

**파일**: `backend/app/routers/portfolio.py`
**변경**: `BulkPortfolioCreate.assets`에 `Field(..., max_length=100)` 추가
**이유**: 제한 없는 배열 크기로 서버 리소스 고갈 가능

### 2-3. WebSocket 재연결 타이머 누적 방지

**파일**:
- `frontend/context/AssetContext.tsx`
- `frontend/components/WatchlistSidebar.tsx`

**변경**: `setTimeout` 전에 기존 `reconnectTimerRef`를 `clearTimeout`
**이유**: WebSocket close 이벤트가 반복 발생 시 타이머가 누적되어 다수의 동시 재연결 시도 발생

---

## 3. 버그 수정 이력 요약

| 증상 | 원인 | 해결 |
|------|------|------|
| 삼성전자 두 줄 표시 | `add_portfolio_item` INSERT 중복 | UPSERT 패턴 + startup 병합 |
| 추천뉴스 깜빡거림 | useEffect 배열 참조 불안정 | 직렬화 문자열 의존성 |
| 로그아웃 미작동 | Set-Cookie comma-join 깨짐 | `getSetCookie()` 개별 전달 |
| 매도 후 전체 리로드 | F20 regression | `fetchHoldings()` 호출 |
| Bulk 생성 무제한 | max_length 미설정 | 100건 제한 |
| WS 재연결 폭주 | clearTimeout 누락 | setTimeout 전 정리 |

---

## 4. 수정된 파일 목록

### Backend (3 files)
- `backend/app/mariadb.py` - UPSERT + merge_duplicate_portfolios()
- `backend/app/main.py` - startup 중복 병합 호출
- `backend/app/routers/portfolio.py` - bulk max_length 제한

### Frontend (5 files)
- `frontend/components/PersonalizedNewsCarousel.tsx` - useEffect 의존성 안정화
- `frontend/app/api/proxy/[...path]/route.ts` - Set-Cookie 개별 전달
- `frontend/contexts/AuthContext.tsx` - logout 쿠키/세션 정리
- `frontend/app/portfolio/asset/page.tsx` - key 수정 + fetchHoldings
- `frontend/context/AssetContext.tsx` - WS reconnect timer 정리
- `frontend/components/WatchlistSidebar.tsx` - WS reconnect timer 정리

---

---

## 5. 2차 코드리뷰 후 추가 수정 (5건)

코드리뷰 재스캔을 통해 발견된 기능 오류 및 안전성 이슈 추가 수정.

### 5-1. chat_service.py 한글 인코딩 손실 복원 (CRITICAL)

**증상**: AI 챗봇에서 "비트코인 시세 알려줘" 등 한글 키워드 매칭 불가

**원인**:
- `COIN_KEYWORDS` 딕셔너리의 한글 키가 모두 빈 문자열(`""`)로 손실
- `COIN_NAMES` 한글 이름도 손실 (예: `"비트코인(BTC)"` → `"(BTC)"`)
- `SYSTEM_PROMPT` 전체 한글 깨짐 (`?` 문자로 치환)
- git history 확인: `b2ba0fd` 커밋에서는 정상, `a8ddd97` 커밋에서 인코딩 손실

**해결**: `backend/app/services/chat_service.py`
- git history(`b2ba0fd`)에서 원본 한글 텍스트 복원
- COIN_KEYWORDS: 비트코인, 이더리움, 이더, 리플, 솔라나 키 복원
- COIN_NAMES: 한글 코인명 복원
- SYSTEM_PROMPT: 전체 한글 프롬프트 복원

### 5-2. assets.py `return_document` 명시적 상수 사용

**파일**: `backend/app/routers/assets.py`
**변경**: `return_document=True` → `return_document=ReturnDocument.AFTER`
**이유**: `True`는 동작하지만(`ReturnDocument.AFTER == True`) pymongo 공식 상수 사용이 명확

### 5-3. SellAssetDialog JSON 파싱 안전성 추가

**파일**: `frontend/components/SellAssetDialog.tsx`
**변경**: 에러 응답의 `response.json()` 호출을 try-catch로 감싸기
**이유**: 서버가 JSON이 아닌 에러 응답(502, HTML 에러 페이지 등) 반환 시 파싱 실패 방지

### 5-4. AdvancedChart response.ok 체크 추가

**파일**: `frontend/components/AdvancedChart.tsx`
**변경**: `response.json()` 호출 전 `response.ok` 체크 추가
**이유**: 서버 에러(500 등) 시 잘못된 데이터 파싱 시도 방지

### 5-5. await session.delete() 호환성 확인

**파일**: `backend/app/mariadb.py`, `backend/app/routers/portfolio.py`
**결과**: SQLAlchemy 2.0.46 `AsyncSession.delete()`는 async 메서드 → `await` 정상. 수정 불필요.

---

## 6. 2차 수정 파일 목록

### Backend (2 files)
- `backend/app/services/chat_service.py` - COIN_KEYWORDS/NAMES/SYSTEM_PROMPT 한글 복원
- `backend/app/routers/assets.py` - `ReturnDocument.AFTER` 명시적 사용

### Frontend (2 files)
- `frontend/components/SellAssetDialog.tsx` - JSON parse try-catch
- `frontend/components/AdvancedChart.tsx` - response.ok 체크

---

## 7. 실행 테스트 결과 (2차)

| 항목 | 결과 |
|------|------|
| Backend 시작 | ✅ uvicorn 정상 (Redis/ES degraded mode) |
| Frontend 시작 | ✅ next dev 정상 (.env.local 로드) |
| 프록시 API | ✅ `/api/proxy` → `localhost:8000` 정상 |
| 삼성전자 시세 | ✅ 180,200원 (KIS 실시간) |
| BTC 시세 | ✅ 97,648,000원 (Upbit 실시간) |
| ETH 시세 | ✅ 2,856,000원 (Upbit 실시간) |
| 뉴스 조회 | ✅ MongoDB Atlas 정상 |
| 뉴스 프록시 | ✅ `/api/public/news` 정상 |
| COIN_KEYWORDS | ✅ 한글 UTF-8 바이트 정상 저장 확인 |

---

---

## 8. Mock 데이터 사용 현황 스캔

전체 코드베이스에서 mock/dummy/sample/test 데이터 사용 현황을 스캔하여 운영 환경 안전성을 점검.

### 8-1. 스캔 결과 요약

| 구분 | mock 참조 수 | 비고 |
|------|-------------|------|
| Frontend | 36건 | fallback/placeholder 포함 |
| Backend | 10건 | test/fallback 포함 |

### 8-2. 즉시 제거 필요 (3건)

| 위치 | 내용 | 위험도 |
|------|------|--------|
| `frontend/app/testflight/` | 테스트 전용 페이지 (mockHoldings 등) | 중 - 운영 빌드에 포함됨 |
| `backend/app/routers/insights.py` `/sample` 엔드포인트 | 하드코딩된 샘플 인사이트 반환 | 중 - 운영 API로 노출 |
| `backend/app/routers/market.py` | 차트 데이터 없을 때 random 생성 fallback | 높 - 실제 데이터로 오인 가능 |

### 8-3. 허용 가능한 fallback 패턴

- `mockHoldings`, `MOCK_COINS` - 개발/테스트용 초기값 (빌드에 미포함 또는 조건부 사용)
- `mock_response` - AI 서비스 장애 시 기본 응답 (정상적인 graceful degradation)
- 컴포넌트 내 placeholder 텍스트 - UI 렌더링용 기본값

---

## 9. 인증 플로우 개선 (Back/Forward 네비게이션)

로그인/비로그인 상태에서 브라우저 뒤로가기/앞으로가기 시 비정상적인 페이지 이동 문제 수정.

### 9-1. 문제점

- 로그인 성공 후 `router.push()` 사용으로 로그인 페이지가 히스토리에 남음
- 뒤로가기 시 로그인 페이지로 돌아가 혼란 유발
- OAuth 콜백 페이지도 히스토리에 남아 뒤로가기 시 재진입
- 홈 페이지에서 로그인 상태 리다이렉트도 히스토리 오염

### 9-2. 수정 내역

#### `frontend/app/login/page.tsx`
- `router.push(callbackUrl)` → `router.replace(callbackUrl)` (로그인 성공 시)
- 이미 로그인된 상태에서 `/login` 접근 시 자동 리다이렉트 추가
- OAuth 에러 쿼리 파라미터(`?error=oauth_failed`) 처리 추가

```typescript
// 이미 로그인된 상태면 포트폴리오로 리다이렉트
useEffect(() => {
  if (!authLoading && user) {
    router.replace(callbackUrl);
  }
}, [user, authLoading, router, callbackUrl]);
```

#### `frontend/app/page.tsx` (홈)
- `router.push("/portfolio/asset")` → `router.replace("/portfolio/asset")`
- 로그인 상태에서 홈 접근 시 히스토리에 홈이 남지 않음

#### `frontend/app/auth/callback/page.tsx` (OAuth 콜백)
- `router.push('/portfolio')` → `router.replace('/portfolio/asset')`
- `router.push('/login')` → `router.replace('/login?error=oauth_failed')`
- 콜백 페이지가 히스토리에 남지 않도록 개선

### 9-3. 기존 정상 동작 확인 (수정 불필요)

| 파일 | 상태 | 비고 |
|------|------|------|
| `frontend/middleware.ts` | ✅ 정상 | 서버사이드 라우트 보호 정상 동작 |
| `frontend/contexts/AuthContext.tsx` | ✅ 정상 | logout에서 `window.location.replace("/")` 사용 |
| `frontend/app/register/page.tsx` | ✅ 정상 | middleware가 로그인 상태 리다이렉트 처리 |

### 9-4. 개선된 인증 플로우

```
비로그인 상태:
  / (홈) → 정상 표시
  /portfolio/* → middleware 307 → /login
  /login → 정상 표시
  뒤로가기 → 이전 공개 페이지로 이동

로그인 상태:
  / (홈) → replace → /portfolio/asset (히스토리에 홈 없음)
  /login → replace → /portfolio/asset (히스토리에 로그인 없음)
  /portfolio/* → 정상 표시
  뒤로가기 → 이전 포트폴리오 페이지로 이동 (로그인/홈 스킵)

로그아웃:
  window.location.replace("/") → 히스토리 초기화, 홈으로 이동
```

---

## 10. 3차 수정 파일 목록

### Frontend (3 files)
- `frontend/app/login/page.tsx` - push→replace, 로그인 상태 가드, OAuth 에러 처리
- `frontend/app/page.tsx` - push→replace
- `frontend/app/auth/callback/page.tsx` - push→replace, 에러 리다이렉트

---

**결론**: kyk/0213 머지 후 사용자에게 직접 보이는 3건의 주요 버그(포트폴리오 중복, 뉴스 깜빡임, 로그아웃 불가) 수정 완료. 추가로 코드 스캔을 통해 발견된 DoS 방어, WebSocket 안정성, UX regression 3건 함께 수정. 2차 코드리뷰에서 AI 챗봇 한글 키워드 인코딩 손실(CRITICAL), API 안전성 강화 등 5건 추가 수정. 3차 작업으로 mock 데이터 현황 스캔(즉시 제거 3건 식별) 및 인증 플로우 개선(push→replace 전환 3파일)으로 브라우저 네비게이션 UX 정상화. 전체 API 실행 테스트 2회 통과.
