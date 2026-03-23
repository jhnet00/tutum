# 2026-02-27 시장 데이터 캐시 안정성 개선

## 작업자
박성준

## 작업 유형
Backend + Frontend 개선

## 배경
메인 페이지 첫 진입 시 주요 지수(MarketSnapshot)와 주식&코인 TOP 10(WatchlistPreview)의 데이터 로딩이 불안정하고, 잠시 API 오류 시 빈 화면 혹은 에러 텍스트가 표시되는 문제 발생. 차트 페이지 사이드바(ChartSidebar), 코인 상세 페이지, 코인 훅(useCoins)도 동일하게 오류 시 mock 데이터로 강제 전환되어 사용자 혼란 야기.

## 주요 변경 사항

### Backend — `backend/app/cache.py`
- `cache_get_with_last_good(key)` 함수 추가
  - 신선 캐시 조회 → 없으면 `{key}:last_good` 폴백
  - `(value, is_stale)` 반환
- `cache_set_with_last_good(key, value, expire_seconds, backup_ttl)` 함수 추가
  - 단기 TTL 캐시 저장 + 24시간 last_good 백업 동시 저장

### Backend — `backend/app/routers/market.py`
- `get_cached_price()` 헬퍼 → `cache_get_with_last_good` 적용
  - 신선 캐시 없으면 24h last_good 폴백, `stale: True` 플래그 포함
- 3개 가격 엔드포인트에 try/except + last_good 저장 패턴 적용
  - `GET /price/domestic/{code}` (KIS 국내 주식)
  - `GET /price/overseas/{ticker}` (KIS 해외 주식)
  - `GET /price/crypto/{ticker}` (Upbit 코인)
  - 성공 시 → `cache_set_with_last_good` (단기 + 24h 백업)
  - 실패 시 → `get_cached_price`로 last_good 폴백

### Frontend — `frontend/components/MarketSnapshot.tsx`
- `sessionStorage` 캐시 추가 (TTL: 3분)
  - 키: `market_snapshot_cache`
  - 성공 시 저장, 실패 시 stale 캐시 표시
- `isStale` 상태 + "캐시 데이터" Badge (AlertCircle 아이콘) 추가
- 오류 시 빈 화면 대신 마지막 정상 데이터 표시

### Frontend — `frontend/components/WatchlistPreview.tsx`
- `sessionStorage` 캐시 추가 (TTL: 5분)
  - 키: `watchlist_cache`
  - 마운트 즉시 캐시 표시 → 만료 시 백그라운드 갱신
- `isStale` 상태 + "캐시 데이터" Badge 추가
- 전체 API 장애 시 캐시 유지 (allEmpty 체크)

### Frontend — `frontend/components/ChartSidebar.tsx`
- `sessionStorage` 캐시 추가 (TTL: 5분)
  - 키: `chartsidebar_prices_cache`
  - `priceMap` + `changeMap` 함께 캐시
  - 마운트 시 캐시 즉시 로드 → 30초마다 갱신 후 저장
- 미사용 import 정리: `Button`, `TrendingUp`, `TrendingDown` 제거

### Frontend — `frontend/lib/hooks/useCoins.ts`
- `sessionStorage` 캐시 추가 (TTL: 5분)
  - 키: `coins_data_cache`
  - lazy 초기값: 캐시 → MOCK_COINS 순서 폴백
  - 성공 fetch 시 `saveCoinsCache` 저장

### Frontend — `frontend/app/coin/[symbol]/page.tsx`
- 심볼별 `sessionStorage` 캐시 추가 (TTL: 3분)
  - 키: `coin_detail_{symbol}`
  - 마운트 시 캐시 즉시 표시 → 백그라운드 갱신
  - 실패 시: sessionStorage 캐시 우선 → 없으면 MOCK_COINS 폴백

## 캐시 아키텍처 3계층

```
1. Redis last_good (백엔드)
   └ 단기 TTL 만료 후에도 24시간 stale 데이터 반환

2. sessionStorage (프론트엔드)
   └ 백엔드 전체 다운 시에도 마지막 정상 데이터 즉시 표시

3. isStale Badge (UI)
   └ 사용자에게 "캐시 데이터"임을 시각적으로 알림
```

## 테스트 포인트
- [ ] 백엔드 정상 시: 신선 데이터 표시, 캐시 저장 확인
- [ ] 백엔드 오류 시: sessionStorage 캐시 데이터 + "캐시 데이터" badge 표시
- [ ] 새로고침 시: sessionStorage에서 즉시 표시 후 백그라운드 갱신
- [ ] TTL 만료 후: 다시 fetch 시도 → 성공 시 badge 사라짐
