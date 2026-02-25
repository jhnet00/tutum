# KIS_WEBSOCKET_PLAN

> 작성일: 2026-02-23  
> 목적: 주식/코인 시세 수집을 WebSocket 중심으로 전환하고, Kafka/Redis/차트 파이프라인 정합성을 보장한다.

---

## 1. 결론 먼저

- 추천 방향은 **"수집은 WebSocket, API는 캐시 조회"** 이다.
- 현재 구조를 크게 깨지 않고도 진행하려면:
  1. `price_producer`에 KIS 국내주식 WS 루프 추가
  2. `/api/v1/market/ws`는 cache-only 기본으로 전환
  3. Kafka 메시지 키/스키마를 표준화해서 중복과 순서 문제를 줄인다.

---

## 2. 현재 코드 기준 상태

### 2.1 이미 동작 중

- 코인: `backend/workers/price_producer.py` 업비트 WebSocket 수집
- Kafka 발행: `prices`, `price_tick`
- Redis 캐시: `backend/workers/price_consumer.py` (`price:{symbol}`)
- 캔들 집계: `backend/workers/candle_aggregator.py` (`price_tick` 소비)

### 2.2 병목/리스크

- 주식은 현재 HTTP 폴링(Finnhub/Polygon) 중심
- 국내 6자리 종목은 폴링 경로에서 제외되는 구간 존재
- `backend/app/routers/market.py`의 `/market/ws`는 cache miss 시 REST fallback 가능
  - 사용자 증가 시 외부 API 중복 호출, rate limit 리스크 증가

---

## 3. 목표 아키텍처 (프로젝트 구조 반영)

```text
[Upbit WS] ----\
                \
[KIS WS] --------> price_producer ----> Kafka(prices, price_tick)
                /
[US fallback] --/   (Phase A는 HTTP fallback 유지)

Kafka(prices)     -> price_consumer    -> Redis price:{symbol}
Kafka(price_tick) -> candle_aggregator -> Redis candles:* + Mongo(candles_1m)

API /market/ws         -> Redis cache-only (기본)
API /market/prices/*   -> Redis 우선 + 제한적 fallback
```

핵심 원칙:

- 실시간 화면(`/market/ws`)에서는 외부 REST 직접 호출 금지
- 외부 벤더 호출은 수집 계층(`price_producer`)에만 집중
- UI/백엔드 조회는 Redis/Kafka 결과만 사용

---

## 4. Kafka 설계 기준 (중요)

### 4.1 토픽 유지 + 규칙 강화

- 유지 토픽:
  - `prices`: 최신가 캐시용
  - `price_tick`: 캔들 집계용
- 발행 키(`key`)는 `symbol`로 통일 권장
  - 종목별 순서 보장, 동일 심볼 처리 안정화

### 4.2 메시지 표준 스키마

```json
{
  "event_id": "uuid-or-hash",
  "symbol": "005930",
  "asset_type": "stock",
  "market": "KR",
  "price": 68000.0,
  "currency": "KRW",
  "timestamp": "2026-02-23T03:00:00+00:00",
  "source": "kis_ws",
  "change_percent": 0.74,
  "volume": 1234567.0
}
```

### 4.3 운영 권장값

- `acks=all`, `enable_idempotence=true` (가능한 범위에서 적용)
- producer 재시도/backoff 설정 고정
- consumer group 분리:
  - `price-consumer-group`
  - `candle-aggregator-group`

---

## 5. 구현 단계

## 5.1 Phase A (이번 주, 최소 변경)

1. `price_producer.py`에 KIS 국내주식 WS 루프 추가
2. 업비트 WS + KIS WS + 해외 HTTP fallback을 병렬 운영
3. `/market/ws`를 cache-only 기본값으로 전환
4. cache miss 시 `no_data/stale` 상태를 명시적으로 반환

산출물:

- 가짜 데이터 없이 "있으면 실시간 표시, 없으면 이유 안내"
- REST 중복호출 감소

## 5.2 Phase B (다음 1~2주)

1. 분봉/실시간 품질 개선
   - `price_tick` 기반 1분 캔들 안정화
   - 5분/1시간은 집계 파생
2. 해외 주식 WS 벤더 도입 검토
   - Polygon/Finnhub WS 요금제/채널 제약 확인
3. 장애 대응 강화
   - 재연결 상태 메트릭/알람

## 5.3 Phase C (토스형에 근접)

1. 벤더 다중화 + failover
2. 장세션/휴장/시간대 처리 고도화
3. 백필(replay) 파이프라인 정식화

---

## 5.4 KIS WebSocket 적용 판단 (국내/해외)

| 구분 | 적용 판단 | 근거 |
| --- | --- | --- |
| 국내주식 KIS WS | **Phase A 우선 적용** | `/market/ws` 중복 REST 호출 감소, 장중 체감 품질 개선 효과가 즉시 큼 |
| 해외주식 KIS WS | Phase B 이후 검토 | 미국장 시간대 제약(한국시간 표준시 23:30~06:00, 서머타임 22:30~05:00), 운영 복잡도 대비 이득 제한적 |

실무 권장:

- 국내: KIS WS로 실시간 수집 고정
- 해외: 당장은 Finnhub/Polygon 폴링 + 캐시 유지, 필요 시 전용 WS 벤더로 확장

---

## 6. `price_producer.py` 구체 변경안

추가 함수:

- `_get_kis_ws_approval_key()`
- `_make_kis_subscribe_message(symbol)`
- `_parse_kis_domestic_tick(raw)`
- `_kis_ws_loop(producer)`

`main()` 구조:

```python
await asyncio.gather(
    _upbit_ws_loop(producer),      # crypto ws
    _kis_ws_loop(producer),        # kr stock ws
    _stock_poll_loop(producer),    # overseas fallback (phase a)
)
```

필수 포인트:

- KIS approval key 재발급/재연결 backoff (max 60s)
- WS ping/pong 처리
- 심볼 리스트 환경변수화
- 심볼 정규화 통일 (`KRW-BTC -> BTC`, `005930` 유지)
- Kafka publish는 단일 함수로 공통화

---

## 7. API 정책 정리

## 7.1 `/api/v1/market/ws`

- 기본: Redis cache-only
- 권장 응답:

```json
{
  "symbol": "005930",
  "status": "no_data",
  "reason": "cache_miss",
  "source": "ws_cache_only"
}
```

## 7.2 `/api/v1/market/prices/*`

- Redis 우선
- 운영 플래그로 제한적 fallback 허용

권장 플래그:

- `MARKET_WS_CACHE_ONLY=true`
- `MARKET_API_REST_FALLBACK=true`

---

## 8. 환경변수 제안

```env
# 수집 심볼
CRYPTO_MARKETS=KRW-BTC,KRW-ETH,KRW-SOL,KRW-XRP
KIS_DOMESTIC_SYMBOLS=005930,000660,035720,051910
STOCK_SYMBOLS=AAPL,NVDA,TSLA,MSFT,005930

# 동작 제어
MARKET_WS_CACHE_ONLY=true
MARKET_API_REST_FALLBACK=true

# kafka
KAFKA_BOOTSTRAP_SERVERS=...
PRICE_TOPIC=prices
PRICE_TICK_TOPIC=price_tick

# vendor
KIS_MODE=real
FINNHUB_API_KEY=...
POLYGON_API_KEY=...
```

---

## 9. 관측/알람 기준

필수 메트릭:

- `producer_ticks_total{source,symbol}`
- `producer_reconnect_total{source}`
- `price_cache_hit_ratio`
- `ws_cache_miss_total`
- `tick_to_cache_latency_ms`

장애 판단 예:

- reconnect 급증
- 특정 source tick 0 지속
- cache miss율 급증

---

## 10. 테스트 체크리스트

- [ ] 업비트 WS만 활성화 시 코인 가격이 `price:{symbol}`에 갱신
- [ ] KIS WS만 활성화 시 `price:005930` 등 국내주식 갱신
- [ ] `/market/ws` 호출 증가 시 외부 REST 호출 로그가 늘지 않음
- [ ] `price_tick`으로 1분/5분/1시간 캔들이 정상 파생
- [ ] WS 강제 종료 후 자동 재연결 및 데이터 복구

---

## 11. 변경 대상 파일

필수:

- `backend/workers/price_producer.py`
- `backend/app/routers/market.py`

선택:

- `backend/app/services/market_data.py`
- `docs/dev_logs/...`

---

## 12. 최종 판단

- 지금 프로젝트에서 가장 리스크가 낮고 효과가 큰 방법은:
  - **WS 수집 일원화 + Kafka 표준화 + `/market/ws` cache-only**
- 이 방향이면, 주식/코인 모두 실시간성은 올리고 rate limit/중복호출 문제는 줄일 수 있다.
