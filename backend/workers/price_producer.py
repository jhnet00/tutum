"""
============================================
Price Producer - 시세 데이터 수집/발행
============================================

- 외부 벤더에서 가격을 수집
- Kafka `prices` + `price_tick` 토픽으로 발행
- `price_tick`은 candle-aggregator(V2) 입력 스트림으로 사용
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx
from aiokafka import AIOKafkaProducer

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)
logging.getLogger("httpx").setLevel(logging.WARNING)

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
PRICE_TOPIC = os.getenv("PRICE_TOPIC", "prices")
PRICE_TICK_TOPIC = os.getenv("PRICE_TICK_TOPIC", "price_tick")
MAX_RECONNECT_DELAY = 60
POLL_INTERVAL_SECONDS = max(1, int(os.getenv("PRICE_POLL_INTERVAL_SECONDS", "5")))
ALLOW_MOCK_PRICE_FEED = os.getenv("ALLOW_MOCK_PRICE_FEED", "false").lower() in {"1", "true", "yes", "on"}

STOCK_VENDOR = os.getenv("STOCK_VENDOR", "auto").lower()  # auto|finnhub|polygon|mock
FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY", "").strip()
POLYGON_API_KEY = os.getenv("POLYGON_API_KEY", "").strip()

DEFAULT_CRYPTO_MARKETS = "KRW-BTC,KRW-ETH,KRW-SOL,KRW-XRP"
DEFAULT_STOCK_SYMBOLS = "AAPL,NVDA,TSLA,MSFT,005930"

CRYPTO_MARKETS = [
    token.strip().upper()
    for token in os.getenv("CRYPTO_MARKETS", DEFAULT_CRYPTO_MARKETS).split(",")
    if token.strip()
]
STOCK_SYMBOLS = [
    token.strip().upper()
    for token in os.getenv("STOCK_SYMBOLS", DEFAULT_STOCK_SYMBOLS).split(",")
    if token.strip()
]

_mock_seed_price: dict[str, float] = {}
_last_good_prices: dict[str, dict[str, Any]] = {}


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _normalize_symbol(value: str) -> str:
    token = str(value or "").strip().upper()
    if token.startswith("KRW-"):
        return token.replace("KRW-", "", 1)
    return token


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _build_mock_price(symbol: str, asset_type: str, currency: str) -> dict[str, Any]:
    prev = _mock_seed_price.get(symbol)
    if prev is None:
        base = 100.0 + (hash(symbol) % 1000)
        if asset_type == "crypto":
            base = 50_000_000.0 + (hash(symbol) % 5_000_000)
        _mock_seed_price[symbol] = base
        prev = base

    # 단순 랜덤 워크 대체(결정론적 변화)
    step = ((hash(f"{symbol}:{datetime.now(timezone.utc).second}") % 200) - 100) / 1000.0
    next_price = max(0.1, prev * (1.0 + step / 100.0))
    _mock_seed_price[symbol] = next_price

    return {
        "symbol": symbol,
        "asset_type": asset_type,
        "price": round(next_price, 6),
        "currency": currency,
        "timestamp": _utc_iso_now(),
        "source": "mock",
    }


async def _fetch_crypto_upbit(markets: list[str]) -> list[dict[str, Any]]:
    if not markets:
        return []

    url = "https://api.upbit.com/v1/ticker"
    params = {"markets": ",".join(markets)}

    async with httpx.AsyncClient(timeout=8.0) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        payload = response.json()

    out: list[dict[str, Any]] = []
    for row in payload:
        market = str(row.get("market", "")).upper()
        symbol = _normalize_symbol(market)
        price = _safe_float(row.get("trade_price"), 0.0)
        if not symbol or price <= 0:
            continue
        out.append(
            {
                "symbol": symbol,
                "asset_type": "crypto",
                "price": price,
                "currency": "KRW",
                "timestamp": _utc_iso_now(),
                "source": "upbit",
                "market": market,
                "change_percent": _safe_float(row.get("signed_change_rate"), 0.0) * 100.0,
                "volume": _safe_float(row.get("acc_trade_volume_24h"), 0.0),
            }
        )
    return out


async def _fetch_stock_finnhub(symbols: list[str]) -> list[dict[str, Any]]:
    if not FINNHUB_API_KEY:
        return []

    out: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=8.0) as client:
        for symbol in symbols:
            if symbol.isdigit() and len(symbol) == 6:
                # Finnhub는 국내 6자리 종목코드 직접 미지원
                continue
            try:
                response = await client.get(
                    "https://finnhub.io/api/v1/quote",
                    params={"symbol": symbol, "token": FINNHUB_API_KEY},
                )
                response.raise_for_status()
                row = response.json()
                price = _safe_float(row.get("c"), 0.0)
                if price <= 0:
                    continue
                ts_unix = int(_safe_float(row.get("t"), 0))
                if ts_unix > 0:
                    ts = datetime.fromtimestamp(ts_unix, tz=timezone.utc).isoformat(timespec="seconds")
                else:
                    ts = _utc_iso_now()
                out.append(
                    {
                        "symbol": symbol,
                        "asset_type": "stock",
                        "price": price,
                        "currency": "USD",
                        "timestamp": ts,
                        "source": "finnhub",
                        "change": _safe_float(row.get("d"), 0.0),
                        "change_percent": _safe_float(row.get("dp"), 0.0),
                    }
                )
            except Exception as exc:
                logger.debug("Finnhub quote fetch failed (%s): %s", symbol, exc)
    return out


async def _fetch_stock_polygon(symbols: list[str]) -> list[dict[str, Any]]:
    if not POLYGON_API_KEY:
        return []

    out: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=8.0) as client:
        for symbol in symbols:
            if symbol.isdigit() and len(symbol) == 6:
                continue
            try:
                response = await client.get(
                    f"https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/{symbol}",
                    params={"apiKey": POLYGON_API_KEY},
                )
                response.raise_for_status()
                payload = response.json()
                row = payload.get("ticker") or {}
                day = row.get("day") or {}
                prev = row.get("prevDay") or {}
                price = _safe_float(row.get("lastTrade", {}).get("p"), 0.0)
                if price <= 0:
                    price = _safe_float(day.get("c"), 0.0)
                if price <= 0:
                    continue
                prev_close = _safe_float(prev.get("c"), 0.0)
                change = price - prev_close if prev_close > 0 else 0.0
                change_percent = (change / prev_close * 100.0) if prev_close > 0 else 0.0
                out.append(
                    {
                        "symbol": symbol,
                        "asset_type": "stock",
                        "price": price,
                        "currency": "USD",
                        "timestamp": _utc_iso_now(),
                        "source": "polygon",
                        "change": change,
                        "change_percent": change_percent,
                        "volume": _safe_float(day.get("v"), 0.0),
                    }
                )
            except Exception as exc:
                logger.debug("Polygon quote fetch failed (%s): %s", symbol, exc)
    return out


def _index_by_symbol(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in items:
        symbol = _normalize_symbol(str(row.get("symbol", "")))
        if symbol:
            row["symbol"] = symbol
            out[symbol] = row
    return out


async def fetch_prices() -> list[dict[str, Any]]:
    prices: list[dict[str, Any]] = []

    # 1) Crypto: Upbit 우선
    crypto_errors = False
    try:
        prices.extend(await _fetch_crypto_upbit(CRYPTO_MARKETS))
    except Exception as exc:
        logger.warning("Upbit fetch failed: %s", exc)
        crypto_errors = True

    # 2) Stock: 벤더 우선순위
    stock_items: list[dict[str, Any]] = []
    if STOCK_VENDOR in ("auto", "finnhub"):
        stock_items = await _fetch_stock_finnhub(STOCK_SYMBOLS)
    if (not stock_items) and STOCK_VENDOR in ("auto", "polygon"):
        stock_items = await _fetch_stock_polygon(STOCK_SYMBOLS)
    prices.extend(stock_items)

    # 3) 누락 심볼 mock 보강 (선택: 개발 모드)
    by_symbol = _index_by_symbol(prices)
    if ALLOW_MOCK_PRICE_FEED:
        for market in CRYPTO_MARKETS:
            symbol = _normalize_symbol(market)
            if symbol and symbol not in by_symbol:
                prices.append(_build_mock_price(symbol, "crypto", "KRW"))

        for symbol in STOCK_SYMBOLS:
            token = _normalize_symbol(symbol)
            if token and token not in by_symbol:
                prices.append(_build_mock_price(token, "stock", "USD"))

    if prices:
        indexed = _index_by_symbol(prices)
        for symbol, row in indexed.items():
            _last_good_prices[symbol] = dict(row)
    elif _last_good_prices:
        # 벤더 일시 장애 시 마지막 정상 가격으로 heartbeat 유지
        stale_rows: list[dict[str, Any]] = []
        for symbol, row in _last_good_prices.items():
            stale = dict(row)
            stale["symbol"] = symbol
            stale["timestamp"] = _utc_iso_now()
            stale["source"] = f"{row.get('source', 'cached')}_stale"
            stale_rows.append(stale)
        prices = stale_rows

    if crypto_errors:
        logger.warning("Crypto feed degraded (upbit failed)")

    return prices


async def create_producer() -> AIOKafkaProducer:
    """Kafka producer 연결 (지수 백오프)."""
    delay = 1
    while True:
        try:
            producer = AIOKafkaProducer(
                bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
                value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            )
            await producer.start()
            logger.info("Kafka connected (topics=%s,%s)", PRICE_TOPIC, PRICE_TICK_TOPIC)
            return producer
        except Exception as exc:
            logger.warning("Kafka connect failed (%s), retry in %ss", exc, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, MAX_RECONNECT_DELAY)


async def main():
    logger.info(
        "Price Producer start bootstrap=%s interval=%ss stock_vendor=%s allow_mock=%s",
        KAFKA_BOOTSTRAP_SERVERS,
        POLL_INTERVAL_SECONDS,
        STOCK_VENDOR,
        ALLOW_MOCK_PRICE_FEED,
    )
    producer = await create_producer()

    try:
        while True:
            try:
                prices = await fetch_prices()
                for row in prices:
                    await producer.send_and_wait(PRICE_TOPIC, row)
                    await producer.send_and_wait(PRICE_TICK_TOPIC, row)

                source_count: dict[str, int] = {}
                for row in prices:
                    src = str(row.get("source", "unknown"))
                    source_count[src] = source_count.get(src, 0) + 1
                logger.info("Published prices=%d sources=%s", len(prices), source_count)
            except Exception as exc:
                logger.error("Publish cycle failed: %s", exc)
                try:
                    await producer.stop()
                except Exception:
                    pass
                producer = await create_producer()

            await asyncio.sleep(POLL_INTERVAL_SECONDS)
    except KeyboardInterrupt:
        logger.info("Stop requested")
    finally:
        await producer.stop()
        logger.info("Producer stopped")


if __name__ == "__main__":
    asyncio.run(main())
