# 기능 정상화 및 환경설정 수정 보고서 (2026-02-13 오후)

## 작업 개요
**작성자**: `jun`
**Branch**: `jun/dev0210`
**작업 내용**: 프로젝트 실행 시 전체 기능 미동작 문제 해결 (7건 수정)

---

## 1. 근본 원인 (ROOT CAUSE)

### 1-1. frontend/.env.local 누락 → 전체 API 500 에러

**증상**: 프로젝트 실행 시 로그인, 시세, 뉴스, 포트폴리오 등 **모든 기능이 동작하지 않음**

**원인**:
- `frontend/.env.local` 파일이 존재하지 않음
- 프론트엔드 프록시 라우트(`/api/proxy/[...path]`)가 `process.env.API_BASE_URL`을 읽는데, 값이 undefined
- `getBackendBaseUrl()` → `null` → 즉시 500 에러 반환
- 모든 프론트엔드 API 호출이 이 프록시를 거치므로 **전체 기능 마비**

**해결**: `frontend/.env.local` 생성
```env
API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 1-2. frontend/next.config.mjs 누락

**증상**: Next.js 설정 파일 자체가 없음

**해결**: `frontend/next.config.mjs` 생성
```javascript
const nextConfig = {
  reactStrictMode: false,
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  env: { API_BASE_URL: process.env.API_BASE_URL || "http://localhost:8000" },
};
```

---

## 2. SellAssetDialog API 미스매치 (MongoDB → MariaDB)

**증상**: 매도 기능 실행 시 "유효하지 않은 자산 ID" 에러

**원인**:
- `SellAssetDialog.tsx`가 `POST /api/v1/assets/${id}/sell` (MongoDB 자산 API) 호출
- 하지만 포트폴리오 데이터는 MariaDB로 마이그레이션 완료 → `asset.id`는 정수형(예: "5")
- MongoDB assets 엔드포인트는 ObjectId 형식을 기대 → 정수 ID로 요청 시 실패

**해결**:
1. **`backend/app/routers/portfolio.py`** - 매도 API 신규 추가
   - `POST /api/v1/portfolio/{item_id}/sell` 엔드포인트
   - 전량 매도 시 항목 삭제, 부분 매도 시 수량 차감
   - 실현손익 및 수익률 계산 반환

2. **`frontend/components/SellAssetDialog.tsx`** - API 경로 변경
   - `/api/v1/assets/${id}/sell` → `/api/v1/portfolio/${id}/sell`
   - CSRF 헤더 추가 (`withCsrfHeader`)
   - `credentials: "include"` 추가

```python
# 백엔드 매도 핵심 로직
remaining = item.quantity - payload.quantity
if remaining <= 0:
    await session.delete(item)  # 전량 매도 → 삭제
else:
    item.quantity = remaining   # 부분 매도 → 차감
realized_profit = (payload.sell_price - item.avg_buy_price) * payload.quantity
```

---

## 3. AdvancedChart.tsx 프록시 우회 문제

**증상**: 차트 데이터 로드 시 CORS 에러 또는 연결 실패 가능

**원인**: `process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"`으로 백엔드 직접 접근
- 다른 모든 컴포넌트는 `/api/proxy` 경유 → 이 파일만 불일치

**해결**: `frontend/components/AdvancedChart.tsx` 수정
```typescript
// Before: const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
// After:
const API_URL = "/api/proxy";
```

---

## 4. MongoDB Null Safety (news, transactions)

**증상**: MongoDB 미연결 시 뉴스/거래이력 API에서 500 에러 (NoneType.count_documents())

**원인**: `get_news_collection()`, `get_transactions_collection()` → `None` 반환 시 null 체크 없이 바로 사용

**해결**:
1. **`backend/app/routers/news.py`** - `news_col is None` 시 빈 결과 반환
2. **`backend/app/routers/transactions.py`**
   - `get_transactions_collection()` 내부에 `db is None` 체크 추가
   - 3개 엔드포인트(POST, GET list, GET analysis) 모두 null guard 추가

---

## 5. 수정 파일 목록

### 신규 생성 (2 files)
- `frontend/.env.local` - 백엔드 API URL 환경변수
- `frontend/next.config.mjs` - Next.js 설정

### Backend 수정 (3 files)
- `backend/app/routers/portfolio.py` - PortfolioSell 모델 + `POST /{id}/sell` 엔드포인트
- `backend/app/routers/news.py` - MongoDB null guard 추가
- `backend/app/routers/transactions.py` - MongoDB null guard 추가 (3곳)

### Frontend 수정 (2 files)
- `frontend/components/SellAssetDialog.tsx` - API 경로 변경 + CSRF 추가
- `frontend/components/AdvancedChart.tsx` - 프록시 경유로 변경

---

## 6. API 전수 스캔 결과

프론트엔드 60+ 파일, 24개 API 호출 파일을 전수 스캔한 결과:

| 분류 | 엔드포인트 | 상태 |
|------|-----------|------|
| Auth | login, register, me, refresh, logout, OAuth | ✅ 정상 |
| Portfolio | GET, POST, POST/bulk, PATCH, DELETE, **POST/sell** | ✅ 정상 |
| Market | price/domestic, price/overseas, price/crypto, prices/*, ws, history | ✅ 정상 |
| News | GET /news, /api/public/news | ✅ 정상 |
| Chat | POST /chat, POST /chat/bedrock | ✅ 정상 |
| Transactions | GET, POST, GET /analysis | ✅ 정상 |
| Notifications | GET /notifications | ✅ 정상 |

---

## 7. 실행 확인 결과

| 항목 | 결과 |
|------|------|
| Backend 시작 | ✅ uvicorn 정상 (Redis/ES degraded mode) |
| Frontend 시작 | ✅ next dev 정상 (.env.local 로드 확인) |
| 프록시 API | ✅ `/api/proxy` → `localhost:8000` 정상 |
| 삼성전자 시세 | ✅ 180,600원 (KIS 실시간) |
| BTC 시세 | ✅ 97,548,000원 (Upbit 실시간) |
| 뉴스 조회 | ✅ 2,043건 (MongoDB Atlas) |
| MariaDB 연결 | ✅ 외부 서버 정상 |

---

**결론**: `.env.local` 누락이 근본 원인으로, 프로젝트 실행 시 모든 API가 500을 반환하는 문제 해결. 추가로 매도 API 미스매치(MongoDB→MariaDB), 차트 프록시 우회, MongoDB null safety 등 기능 오류 7건 수정 완료. 전체 API 전수 스캔 및 실행 테스트로 정상 동작 확인.
