# 2026-03-04 MarketPriceContext — 전역 시세 단일 소스(SSoT) 구현

- **작업자**: 박성준
- **브랜치**: develop
- **연관 이슈**: 프론트엔드 가격 불일치 UX 개선

---

## 작업 요약

주요 지수(MarketSnapshot), 주식&코인 TOP10(WatchlistPreview), 관심종목 사이드바(WatchlistSidebar)가
각각 독립적인 API 엔드포인트와 캐시 TTL을 사용해 동일 종목의 가격이 다르게 표시되는 문제 해결.

`MarketPriceContext`를 Single Source of Truth로 도입,
모든 컴포넌트가 하나의 WebSocket 연결 + REST 폴백 + 단일 캐시를 공유하도록 통합.

---

## 1. 문제 원인 분석

| 컴포넌트 | API 엔드포인트 | 캐시 TTL |
|---------|--------------|---------|
| MarketSnapshot | `/price/domestic/005930`, `/price/crypto/KRW-BTC` (개별) | 3분 |
| WatchlistPreview | `/history/stock/{symbol}?timeframe=D&count=30` (전일 종가 사용) | 5분 |
| WatchlistSidebar | `/prices/stocks`, `/prices/crypto` (배치) | 없음, 30초 폴링 |

- 같은 종목이라도 서로 다른 API에서 가져오므로 시점 차이 발생
- WatchlistPreview는 전일 종가(OHLC history)를 현재가로 표시 → 실시간 대비 크게 다름
- 각 컴포넌트가 독립적으로 WebSocket/REST를 열어 연결 낭비

---

## 2. 해결 방법: MarketPriceContext

### 신규 파일: `frontend/context/MarketPriceContext.tsx`

- WebSocket 연결 → 실패 시 30초마다 REST 배치 API 폴백
- 단일 `sessionStorage` 캐시 키 `market_prices_unified` (2분 TTL)
- 커버 심볼: 주식 4종 + 코인 9종

```
streamStatus: "connecting" | "connected" | "reconnecting" | "fallback"
priceMap: Record<string, { price, changePercent, isKRW }>
lastUpdated: Date | null
refresh(): void
```

### `frontend/app/layout.tsx`

```tsx
<AssetProvider>
  <MarketPriceProvider>   // ← 추가
    {children}
  </MarketPriceProvider>
</AssetProvider>
```

---

## 3. 컴포넌트별 변경 내용

### MarketSnapshot.tsx

- 기존: 개별 스냅샷 API 30초 폴링 + 자체 3분 캐시
- 변경: `useMarketPriceContext()` → `priceMap["005930"]`, `priceMap["BTC"]` 직접 참조
- `isStale` = `streamStatus === "reconnecting"` (재연결 중일 때만 캐시 배지 표시)

### WatchlistSidebar.tsx

- 기존: `fetchWatchlistData` callback + 30초 interval
- 변경: `useMarketPriceContext()` + `useMemo`로 priceMap → WatchlistItem[] 파생
- mock 데이터를 fallback으로 유지 (priceMap 미수신 시)

### WatchlistPreview.tsx

- 기존: history API(전일 종가)를 현재가로 표시
- 변경: history API는 스파크라인·30일 변동률 계산에만 사용
  → `patchedData` useMemo로 `price`만 priceMap 값으로 덮어쓰기
- 30일 changePercent, 스파크라인 데이터는 기존 로직 유지

---

## 4. 변경 파일 목록

| 파일 | 변경 유형 |
|------|---------|
| `frontend/context/MarketPriceContext.tsx` | 신규 생성 |
| `frontend/app/layout.tsx` | MarketPriceProvider 래핑 추가 |
| `frontend/components/MarketSnapshot.tsx` | context 전환 (독립 fetch 제거) |
| `frontend/components/WatchlistSidebar.tsx` | context 전환 (30초 폴링 제거) |
| `frontend/components/WatchlistPreview.tsx` | patchedData로 현재가 통합 |

---

## 5. 기대 효과

- 동일 종목 가격 불일치 해소 (어느 컴포넌트에서나 동일한 priceMap 참조)
- WebSocket 연결 수 감소 (컴포넌트별 → 앱 전역 1개)
- sessionStorage 캐시 키 단일화 (3개 → 1개)
- 페이지 전환 시 빈 가격 표시 없음 (캐시 즉시 로드)
