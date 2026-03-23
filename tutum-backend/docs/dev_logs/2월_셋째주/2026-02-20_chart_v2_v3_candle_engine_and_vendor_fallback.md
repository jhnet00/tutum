# 개발 작업 완료 보고서 (2026-02-20)

## 1. 작업 개요
- 작성일: 2026-02-20
- 브랜치: `kyk/realtime-chart-stream`
- 작업 범위:
  - V1 안정화 마무리 (분봉 no-data 명시, 차트 과도한 갱신 완화)
  - V2 1차 구현 (`price_tick` + `candle-aggregator` + API 캔들 우선 조회)
  - V3 1차 구현 (해외 분봉 벤더 fallback: Finnhub/Polygon)

## 2. 주요 변경 사항
- 백엔드
  - `backend/app/routers/market.py`
    - 분봉 요청 시 Redis 캔들(`candles:{symbol}:1m`) 우선 조회
    - 1분 원천으로 5분/60분 파생 집계 로직 추가
    - 분봉 데이터 없을 때 `no_data_reason` + `message` 명시 유지
  - `backend/app/services/market_data.py`
    - 해외 분봉 벤더 fallback 추가
      - Finnhub 우선, Polygon 대체
      - 벤더 미설정/무데이터 시 no-data 반환
  - `backend/app/config.py`
    - `STOCK_VENDOR`, `FINNHUB_API_KEY`, `POLYGON_API_KEY` 설정 추가

- 워커/인프라
  - `backend/workers/price_producer.py`
    - `prices` + `price_tick` 동시 발행
    - Upbit/Finnhub/Polygon 수집 구조 반영
    - `ALLOW_MOCK_PRICE_FEED` 옵션화
    - `httpx` 로그 레벨 조정(키 노출 방지)
  - `backend/workers/candle_aggregator.py` (신규)
    - `price_tick` 소비 후 1분 OHLCV 집계
    - Redis 최근 캔들 + Mongo 장기 저장(upsert)
  - `backend/workers/requirements.txt`
    - `pymongo==4.6.3` 고정(모터 호환)
  - `docker-compose.yml`
    - `candle-aggregator` 서비스 추가
    - producer 관련 환경변수 wiring(`PRICE_TICK_TOPIC`, `PRICE_POLL_INTERVAL_SECONDS` 등)

- 프론트
  - `frontend/components/AdvancedChart.tsx`
    - 분/시간봉만 실시간 갱신
    - 일/주/월/년은 고정 히스토리 표시로 화면 흔들림 완화
    - no-data overlay 유지

- 문서
  - `docs/work-plans/2026-02-20_chart_v1_v3_execution_plan.md` 진행 상태 갱신
  - `docs/guides/CANDLE_ENGINE_V2_V3_GUIDE.md` 신규 작성

## 3. 이슈 및 해결
- 이슈: `candle-aggregator`가 `motor`/`pymongo` 호환 문제로 재시작 루프
  - 해결: `backend/workers/requirements.txt`에 `pymongo==4.6.3` 고정 후 재빌드

- 이슈: 로그에 Finnhub 요청 URL이 그대로 출력되어 토큰 노출 위험
  - 해결: `price_producer`에서 `httpx` 로그 레벨을 `WARNING`으로 하향

## 4. 검증
- 정적 검증
  - `python -m compileall app/routers/market.py app/services/market_data.py app/config.py`
  - `python -m compileall price_producer.py price_consumer.py candle_aggregator.py`
  - `npm run lint` / `npm run build` (frontend)

- 런타임 검증
  - `docker compose up -d --build backend workers price-consumer candle-aggregator frontend`
  - `GET /api/v1/market/history/crypto/KRW-BTC?timeframe=1` -> `source: candle_aggregator` 확인
  - `GET /api/v1/market/history/crypto/KRW-BTC?timeframe=5|60` -> 파생 집계 응답 확인
  - `GET /api/v1/market/history/stock/AAPL?timeframe=1` -> 벤더/시장상태 기준 no-data 응답 확인

## 5. 결과
- V1: 완료
- V2: 1차 구현 완료
- V3: 1차 구현 완료
- 남은 작업:
  - 해외 분봉 벤더별 세션/휴장 처리 강화
  - replay/backfill 파이프라인
  - 프론트 WS 델타 표준화(REST 초기 로드 + WS 업데이트 완전 분리)
