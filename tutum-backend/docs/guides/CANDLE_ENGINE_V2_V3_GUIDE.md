# V2/V3 캔들 엔진 가이드

## 개요
- V2: `price_tick` 스트림 기반 1분 캔들 집계(`candle-aggregator`)
- V3: 해외 분봉 벤더 fallback(Finnhub/Polygon)

## 구성요소
- Producer: `backend/workers/price_producer.py`
  - 토픽 발행: `prices`, `price_tick`
- Consumer: `backend/workers/price_consumer.py`
  - `prices` -> Redis `price:{symbol}` 캐시
- Candle Aggregator: `backend/workers/candle_aggregator.py`
  - `price_tick` -> Redis `candles:{symbol}:1m` + Mongo `candles_1m`
- API: `backend/app/routers/market.py`
  - 분봉 조회 시 Redis 캔들 우선
  - 없으면 기존 KIS/Upbit fallback

## 필수 환경변수
- `KAFKA_BOOTSTRAP_SERVERS`
- `REDIS_URL`
- `MONGODB_URL`
- `MONGODB_DB_NAME`

## 벤더 환경변수 (선택)
- `STOCK_VENDOR=auto|finnhub|polygon|mock`
- `FINNHUB_API_KEY=...`
- `POLYGON_API_KEY=...`
- `ALLOW_MOCK_PRICE_FEED=false` (기본 권장)
- `MAX_TICK_AGE_SECONDS_STOCK=900` (해외장 종료 후 stale tick 차단)
- `MAX_TICK_AGE_SECONDS_CRYPTO=180`

## 실행
```bash
docker compose up -d --build backend workers price-consumer candle-aggregator frontend
```

## 점검 포인트
1. 컨테이너 상태
```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
```

2. 캔들 캐시 확인
```bash
redis-cli LRANGE candles:BTC:1m -5 -1
redis-cli GET candles:BTC:1m:current
```

3. API 확인
```bash
curl "http://localhost:8000/api/v1/market/history/crypto/KRW-BTC?timeframe=1&count=30"
curl "http://localhost:8000/api/v1/market/history/stock/AAPL?timeframe=1&count=30"
```

## 백필/복구 (Replay)
- Mongo `candles_1m` -> Redis 캔들 키 복구
```bash
docker compose --profile ops run --rm candle-replay
```
- 심볼/기간 지정
```bash
docker compose --profile ops run --rm candle-replay \
  python -u replay_candles_to_redis.py --symbols BTC,ETH,AAPL --days 14
```

## 동작 원칙
- 분봉 데이터가 있으면 캔들 엔진 데이터 우선
- 데이터가 없으면 명확한 no-data 응답
- fake 분봉 노출 방지를 위해 `ALLOW_MOCK_PRICE_FEED=false` 권장
- 해외 주식 분봉은 벤더 tick 시간이 오래된 경우(stale) 캔들 집계 제외
