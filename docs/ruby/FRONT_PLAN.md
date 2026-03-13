# TUTUM Dashboard Real-Data + UX Refresh Plan

## Summary
이번 작업은 프론트 리디자인만이 아니라, `실제 지수 데이터`, `실제 자산 기반 인사이트`, `Bedrock/Elasticsearch 기반 요약`, `빈 상태/장애 상태 기본 UX`를 같이 정리하는 작업으로 잡습니다.

핵심 방향은 다음과 같습니다.

- `주요지수`는 실제 지수 API로 분리합니다.
- `AI forecast`와 `인사이트`는 프론트 mock이 아니라 백엔드에서 `holdings + ES 뉴스 + Bedrock`로 생성합니다.
- 비용/지연 제어를 위해 AI 결과는 사용자별 `5분 캐시`를 둡니다.
- 랜딩 페이지 비로그인 상태는 `시장 인사이트 일반형`으로 보여줍니다.
- `portfolio/asset` 대시보드는 더 크고, 더 읽기 쉽고, 더 젊은 톤으로 재구성합니다.
- holdings가 없거나 API가 실패하면 가짜 위젯 대신 일관된 empty/error CTA를 보여줍니다.

## Current State Confirmed
현재 확인된 사실입니다.

- [MarketSnapshot.tsx](D:\dev\tutum-frontend\frontend\components\MarketSnapshot.tsx)는 실제 지수가 아니라 `005930`와 `BTC`를 `priceMap`에서 꺼내는 샘플 카드입니다.
- [MarketPriceContext.tsx](D:\dev\tutum-frontend\frontend\context\MarketPriceContext.tsx)는 이미 `WS 우선 + REST fallback` 구조를 갖고 있습니다.
- [page.tsx](D:\dev\tutum-frontend\frontend\app\portfolio\asset\page.tsx)의 `benchmarkRows`, `forecastStates`, `focusKeywords`는 프론트 계산 mock입니다.
- [InsightPreview.tsx](D:\dev\tutum-frontend\frontend\components\InsightPreview.tsx)는 `/api/public/insights/sample` 샘플 데이터를 씁니다.
- [AIInsightsModal.tsx](D:\dev\tutum-frontend\frontend\components\AIInsightsModal.tsx)는 하드코딩 데이터입니다.
- 뉴스 추천은 이미 [news.py](D:\dev\tutum-backend\backend\app\routers\news.py)에서 보유 자산 기반 `recommended_assets`, `recommended_keywords`를 만들고 있습니다.
- Bedrock + ES 하이브리드 검색은 이미 [chat_service.py](D:\dev\tutum-backend\backend\app\services\chat_service.py) 내부에 존재합니다.

## Backend Design

### 1. 실제 주요지수 API 추가
새 endpoint를 추가합니다.

- `GET /api/v1/market/indices`

응답:
```ts
type MarketIndexItem = {
  id: "kospi" | "sp500" | "nasdaq";
  symbol: "^KS11" | "^GSPC" | "^IXIC";
  name: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  currency: "KRW" | "USD";
  marketStatus: "open" | "closed" | "unknown";
  updatedAt: string | null;
  stale: boolean;
  available: boolean;
  source: "yahoo" | "cache" | "last_good" | "error";
};
```

구현 결정:
- 데이터 소스는 Yahoo Finance quote/chart 계열을 별도 service로 호출합니다.
- 대상은 고정:
  - `KOSPI` = `^KS11`
  - `S&P 500` = `^GSPC`
  - `NASDAQ` = `^IXIC`
- Redis 캐시:
  - fresh TTL `60초`
  - `last_good` fallback `15분`
- 실패 시 fake 수치 생성 금지
- 반환은 `available=false`, `stale=true`, `source=error|last_good`

변경 파일:
- [market.py](D:\dev\tutum-backend\backend\app\routers\market.py)
- 신규 service 예: `backend/app/services/market_indices.py`

### 2. 사용자 대시보드 AI 인사이트 API 추가
새 endpoint를 추가합니다.

- `GET /api/v1/portfolio/dashboard-insights`

목적:
- `portfolio/asset` overview용 AI forecast
- `포트폴리오 키워드`
- `인사이트 카드`
- `상위/하위 자산 설명`
- `empty/error fallback metadata`

입력:
- JWT current user
- MariaDB portfolio
- 가격 데이터
- ES 뉴스 추천
- Bedrock summarization

응답:
```ts
type DashboardInsightsResponse = {
  generatedAt: string;
  cacheHit: boolean;
  holdingsState: "ready" | "empty" | "error";
  insights: {
    forecast: {
      level: "얼음" | "비" | "흐림" | "맑음" | "아주 맑음";
      title: string;
      summary: string;
      bullets: string[];
    };
    cards: Array<{
      id: string;
      title: string;
      body: string;
      tone: "positive" | "neutral" | "caution";
    }>;
    hashtags: string[];
    topMovers: Array<{
      symbol: string;
      name: string;
      rank: 1 | 2 | 3;
      profitPercent: number;
    }>;
    marketContext: {
      recommendedAssets: string[];
      recommendedKeywords: string[];
      newsCount: number;
    };
  };
};
```

구현 결정:
- 서비스는 새 파일로 분리:
  - 예: `backend/app/services/dashboard_ai_service.py`
- 내부 데이터 흐름:
  1. `get_user_portfolios`
  2. 현재가 보강
  3. `news/recommended`와 동일 기준의 추천 키워드 산출
  4. ES에서 관련 뉴스 6~10건 검색
  5. Bedrock에 구조화 JSON 응답 요청
- Bedrock 프롬프트는 JSON only 응답 강제
- JSON parse 실패 시 deterministic rule fallback 사용
- 캐시:
  - key: `dashboard-insights:{user_id}:{portfolio_fingerprint}`
  - TTL: `5분`
- fingerprint:
  - symbol / quantity / average_price / current_price 기반 sha-like string
- holdings 없음:
  - Bedrock 호출하지 않음
  - `holdingsState=empty`
- holdings 조회 실패:
  - Bedrock 호출하지 않음
  - `holdingsState=error`

### 3. 일반 시장 인사이트 API 추가
비로그인 랜딩 페이지용 endpoint를 추가합니다.

- `GET /api/v1/market/insights`

입력:
- 실제 주요지수
- 최근 일반 뉴스
- ES 최근 금융 뉴스 상위 5~8건

응답:
```ts
type MarketInsightsResponse = {
  generatedAt: string;
  cacheHit: boolean;
  cards: Array<{
    id: string;
    title: string;
    body: string;
    tone: "positive" | "neutral" | "caution";
  }>;
};
```

구현 결정:
- Bedrock 사용
- 캐시 TTL `5분`
- ES unavailable이면 Mongo fallback
- Bedrock unavailable이면 rule-based fallback

## Frontend Design

### 4. 랜딩 페이지 실제화
대상:
- [page.tsx](D:\dev\tutum-frontend\frontend\app\page.tsx)
- [MarketSnapshot.tsx](D:\dev\tutum-frontend\frontend\components\MarketSnapshot.tsx)
- [InsightPreview.tsx](D:\dev\tutum-frontend\frontend\components\InsightPreview.tsx)

변경:
- `MarketSnapshot`:
  - 기존 `005930/BTC` 샘플 제거
  - `/api/public/indices` 사용
  - 3개 지수 카드로 고정
  - `Domestic/Crypto` 뱃지 제거
- `InsightPreview`:
  - `/api/public/insights/sample` 제거
  - 로그인 여부와 관계없이 일반 시장 인사이트 카드 표시
  - 로그인 + holdings 있음이면 개인화 카드로 교체 가능하게 설계
- 랜딩의 static badge/live tag 중 non-click hover 제거

### 5. portfolio/asset first row 재설계
대상:
- [page.tsx](D:\dev\tutum-frontend\frontend\app\portfolio\asset\page.tsx)

구조 변경:
- 첫 row를 3-card 구조로 정리
  - `총 손익`
  - `Top 3 수익률`
  - `실제 주요지수`
- 제거:
  - 현재 fake benchmark carousel
  - 현재 주간/월간/연간 mock 수익 dropdown
- 유지:
  - 현재 holdings 기반 실제 총평가/총손익 계산

스타일 결정:
- 메인 숫자:
  - desktop `60-72px`
  - mobile `42-48px`
- 플러스 수익:
  - purple to magenta accent gradient
- 마이너스:
  - neutral gray
- `Top 3 수익률`:
  - 1위만 accent
  - 차트 제거
  - 순위형 typography 강조

### 6. typography / responsiveness 전면 조정
원칙:
- mobile에서도 읽히는 게 우선
- card 밖으로 text가 튀지 않게 `clamp`, `truncate`, `leading-tight`, `min-w-0` 정리
- 불필요하게 작은 `text-[10px]`, `text-xs` 남발 축소

적용 대상:
- first row
- allocation card
- forecast card
- keyword card
- heatmap labels
- 뉴스 카드 내 보조 text

### 7. non-click hover 제거
규칙:
- 클릭 가능한 요소만 hover 유지
- static label, badge, decorative chip은 hover 색상 변화 제거

적용 대상:
- LIVE/상태 배지
- static legend chip
- forecast decorative elements
- asset overview 내 informational badges

예외:
- 버튼
- 링크
- 드롭다운 trigger
- 탭
- CTA

### 8. 비중 그래프(Quota / Allocation) 개편
대상:
- [AssetAllocationChart.tsx](D:\dev\tutum-frontend\frontend\components\AssetAllocationChart.tsx)
- overview 상단 allocation wrapper

변경:
- 높이 확대:
  - compact mode도 현재보다 `+20~24px`
- pie mode 기본 강화:
  - hover 없이 항상 식별 가능한 name tag 제공
  - outer label 또는 상단/하단 persistent tag rail 사용
- card pair sizing 확대:
  - allocation card와 adjacent card 모두 최소 높이 증대
- `평가 금액`, `현금 비중`가 box 밖으로 밀리는 현상 수정
- 모바일:
  - chart + label rail 2단 레이아웃
  - tag 수가 많으면 horizontal wrap로 정리

### 9. AI Forecast 카드 재정리
대상:
- [page.tsx](D:\dev\tutum-frontend\frontend\app\portfolio\asset\page.tsx)

삭제:
- `Portfolio Climate`
- 우측 상단 날씨 badge
- `4/5` 표기
- `Forecast Note`

유지/추가:
- 큰 상태명
- 짧은 summary
- 핵심 bullet 2~3개
- 오른쪽 화살표 1개
  - local/dev에서만 상태 preview
  - production 숨김

데이터:
- 기본은 `/api/v1/portfolio/dashboard-insights`의 `forecast`
- API 실패 시 local rule fallback
- holdings 없음/오류면 empty state

### 10. 포트폴리오 키워드 해시태그화
대상:
- 기존 `포트폴리오 키워드` 카드

변경:
- grid summary box 제거
- hashtag chip cluster로 전환
- 데이터 소스:
  - holdings symbol/name
  - ES 뉴스 추천 키워드
  - AI summary에서 나온 핵심 태그
- 예시:
  - `#BTC비중확대`
  - `#미국기술주강세`
  - `#현금완충필요`

### 11. holdings-dependent 공통 empty/error state
신규 공통 컴포넌트 추가:
- 예: `frontend/components/dashboard/EmptyPortfolioState.tsx`

표시 조건:
- holdings 없음
- holdings fetch 실패
- required supporting data unavailable

표현:
- 회색 surface
- 메시지: `자산을 등록해주세요`
- subtext:
  - empty: `등록 후 히트맵, 키워드, AI 분석이 활성화됩니다.`
  - error: `데이터를 불러오지 못했습니다. 자산 등록 또는 새로고침 후 다시 확인해주세요.`
- CTA:
  - `/direct-input`

적용 대상:
- allocation
- heatmap
- forecast
- keywords
- allocation pulse
- 기타 holdings 필수 위젯

### 12. Heatmap / keyword / forecast 숨김 대신 empty state
현재 [PortfolioHeatmap.tsx](D:\dev\tutum-frontend\frontend\components\PortfolioHeatmap.tsx)는 데이터 없으면 `null` 반환합니다. 이 동작을 제거하고 상위에서 empty component를 렌더링하도록 바꿉니다.

원칙:
- 아무것도 안 보이는 상태 금지
- fake 채우기 금지
- 명시적 CTA 노출

### 13. favicon 교체
대상:
- [icon.png](D:\dev\tutum-frontend\frontend\app\icon.png)
- [layout.tsx](D:\dev\tutum-frontend\frontend\app\layout.tsx)

변경:
- 제공 이미지로 favicon 교체
- radius 약 `5px`
- metadata 경로는 그대로 유지

## Frontend Data Flow

### 14. 프론트 API 레이어
신규 proxy/public routes:
- `frontend/app/api/public/indices/route.ts`
- `frontend/app/api/public/market-insights/route.ts`
- 필요 시 `frontend/app/api/proxy/api/v1/portfolio/dashboard-insights`는 기존 proxy 경유 재사용

### 15. 기존 context 활용 원칙
- holdings: [AssetContext.tsx](D:\dev\tutum-frontend\frontend\context\AssetContext.tsx)
- real-time prices: [MarketPriceContext.tsx](D:\dev\tutum-frontend\frontend\context\MarketPriceContext.tsx)
- user-specific AI: server fetch
- UI fallback: local deterministic fallback

`context`/`contexts` 혼재는 현재 [contexts/AssetContext.tsx](D:\dev\tutum-frontend\frontend\contexts\AssetContext.tsx)가 re-export 하는 구조라 당장 깨지는 문제는 아니지만, 이번 작업 중 신규 코드는 `@/context/*` 기준으로 통일합니다.

## Public APIs / Types
추가/변경될 주요 인터페이스입니다.

### Backend
- `GET /api/v1/market/indices`
- `GET /api/v1/market/insights`
- `GET /api/v1/portfolio/dashboard-insights`

### Frontend types
```ts
type DashboardInsightsResponse = {
  generatedAt: string;
  cacheHit: boolean;
  holdingsState: "ready" | "empty" | "error";
  insights: {
    forecast: {
      level: "얼음" | "비" | "흐림" | "맑음" | "아주 맑음";
      title: string;
      summary: string;
      bullets: string[];
    };
    cards: Array<{
      id: string;
      title: string;
      body: string;
      tone: "positive" | "neutral" | "caution";
    }>;
    hashtags: string[];
    topMovers: Array<{
      symbol: string;
      name: string;
      rank: 1 | 2 | 3;
      profitPercent: number;
    }>;
    marketContext: {
      recommendedAssets: string[];
      recommendedKeywords: string[];
      newsCount: number;
    };
  };
};
```

## Test Cases
1. 랜딩 페이지 `주요지수`가 실제 3개 지수로 표시된다.
2. `주요지수 API` 실패 시 fake 값이 아니라 stale/error state가 보인다.
3. 로그인 + holdings 있음:
   - `forecast`, `hashtags`, `top movers`가 API 응답 기반으로 렌더링된다.
4. holdings 없음:
   - heatmap/allocation/forecast/keywords가 모두 동일 empty state를 보여준다.
5. holdings API 실패:
   - 동일 empty/error state가 보이고 layout이 유지된다.
6. mobile viewport:
   - 메인 metric 숫자, allocation label, forecast text가 잘리지 않는다.
7. non-click element:
   - hover 시 색상 변화가 없다.
8. clickable element:
   - hover/active가 유지된다.
9. Bedrock unavailable:
   - deterministic fallback으로 카드가 계속 렌더링된다.
10. ES unavailable:
   - Mongo fallback 또는 reduced-summary fallback으로 동작한다.
11. dashboard-insights:
   - 같은 holdings fingerprint에서 5분 내 재호출 시 cache hit가 난다.
12. favicon:
   - 탭 아이콘이 새 이미지로 교체된다.

## Assumptions And Defaults
- Bedrock는 적극 사용하되 사용자별 AI 결과는 `5분 캐시`합니다.
- 비로그인 랜딩은 `시장 인사이트 일반형`을 보여줍니다.
- 실제 지수는 `KOSPI`, `S&P 500`, `NASDAQ` 3개만 사용합니다.
- 대시보드 AI는 `Bedrock + ES`, 실패 시 `rule fallback` 구조로 갑니다.
- 주간/월간/연간 손익처럼 현재 데이터로 정직하게 계산 불가능한 mock 값은 제거합니다.
- holdings-dependent CTA는 `/direct-input`으로 고정합니다.
- admin dashboard는 범위 밖입니다.
- 이번 작업은 로컬 확인 기준으로 설계합니다. 배포는 후속 단계입니다.
