# 2026-02-20 - 시장 상태 API 캔들 모니터링 지표 추가

## 작업 배경
- 차트 V2/V3 단계에서 남아 있던 항목인 `실시간 지연/누락 모니터링 지표 확보`를 운영 점검 가능 형태로 구현.
- 기존 `/api/v1/market/status`는 고정 문자열만 반환해서 실제 캔들 엔진 상태를 확인하기 어려웠음.

## 변경 사항
- `backend/app/routers/market.py`
  - `/api/v1/market/status` 응답 확장
  - `candle_monitor` 필드 추가:
    - `redis_connected`
    - `symbols_checked`, `symbols_with_data`
    - `stale_count`, `stale_symbols`
    - `max_lag_seconds`
    - `threshold_seconds` (stock/crypto)
    - `items` (심볼별 lag/stale 상세)
  - 모니터링 대상 심볼:
    - `STOCK_SYMBOLS`
    - `CRYPTO_MARKETS`
  - 최신 캔들 키:
    - `candles:{symbol}:1m:current`
  - stale 판단 기준:
    - `MAX_TICK_AGE_SECONDS_STOCK`
    - `MAX_TICK_AGE_SECONDS_CRYPTO`
- `docs/work-plans/2026-02-20_chart_v1_v3_execution_plan.md`
  - V2 완료 기준 `실시간 지연/누락 모니터링 지표 확보` 항목 완료 체크.

## 검증
- 재빌드: `docker compose up -d --build backend`
- 상태 확인:
  - `GET /api/v1/market/status`
  - `candle_monitor`가 실제 lag/stale 데이터를 포함해 반환되는 것 확인.

## 결과
- 운영 관점에서 캔들 엔진 상태를 API 한 번으로 확인 가능.
- stale/누락 심볼을 즉시 식별할 수 있어 장애 대응 속도 개선.
