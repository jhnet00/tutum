"""
============================================
Price Producer - 시세 데이터 수집/발행
============================================

수집 경로:
  - 크립토:    업비트 WebSocket (wss://api.upbit.com/websocket/v1)
  - 국내주식:  KIS WebSocket   (ws://ops.koreainvestment.com:21000)
  - 해외주식:  Finnhub / Polygon HTTP 폴링 (fallback, Phase A)

발행 토픽:
  - prices    : price_consumer → Redis price:{symbol}
  - price_tick: candle_aggregator → Redis candles + MongoDB
"""

import asyncio
import json
import logging
import os
import uuid
from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import websockets
from aiokafka import AIOKafkaProducer

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("websockets").setLevel(logging.WARNING)

KST = ZoneInfo("Asia/Seoul")

# ─── Kafka ────────────────────────────────────────────────────────────────────
KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
PRICE_TOPIC = os.getenv("PRICE_TOPIC", "prices")
PRICE_TICK_TOPIC = os.getenv("PRICE_TICK_TOPIC", "price_tick")
MAX_RECONNECT_DELAY = 60

# ─── 크립토 (업비트) ──────────────────────────────────────────────────────────
DEFAULT_CRYPTO_MARKETS = "KRW-BTC,KRW-ETH,KRW-SOL,KRW-XRP"
CRYPTO_MARKETS = [
    t.strip().upper()
    for t in os.getenv("CRYPTO_MARKETS", DEFAULT_CRYPTO_MARKETS).split(",")
    if t.strip()
]
UPBIT_WS_URL = "wss://api.upbit.com/websocket/v1"

# ─── 국내주식 (KIS) ───────────────────────────────────────────────────────────
KIS_APP_KEY = os.getenv("KIS_APP_KEY", "").strip()
KIS_APP_SECRET = os.getenv("KIS_APP_SECRET", "").strip()
KIS_MODE = os.getenv("KIS_MODE", "real").lower()

DEFAULT_KIS_DOMESTIC = "005930,000660,035720,051910"
KIS_DOMESTIC_SYMBOLS = [
    t.strip()
    for t in os.getenv("KIS_DOMESTIC_SYMBOLS", DEFAULT_KIS_DOMESTIC).split(",")
    if t.strip()
]

KIS_WS_URL = (
    "ws://ops.koreainvestment.com:31000"
    if KIS_MODE == "virtual"
    else "ws://ops.koreainvestment.com:21000"
)
KIS_APPROVAL_URL = (
    "https://openapivts.koreainvestment.com:29443/oauth2/Approval"
    if KIS_MODE == "virtual"
    else "https://openapi.koreainvestment.com:9443/oauth2/Approval"
)

# ─── 해외주식 (Finnhub / Polygon) ────────────────────────────────────────────
STOCK_POLL_INTERVAL = max(5, int(os.getenv("PRICE_POLL_INTERVAL_SECONDS", "5")))
STOCK_VENDOR = os.getenv("STOCK_VENDOR", "auto").lower()
FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY", "").strip()
POLYGON_API_KEY = os.getenv("POLYGON_API_KEY", "").strip()
ALLOW_MOCK_PRICE_FEED = os.getenv("ALLOW_MOCK_PRICE_FEED", "false").lower() in {"1", "true", "yes", "on"}

DEFAULT_STOCK_SYMBOLS = "AAPL,NVDA,TSLA,MSFT"
STOCK_SYMBOLS = [
    t.strip().upper()
    for t in os.getenv("STOCK_SYMBOLS", DEFAULT_STOCK_SYMBOLS).split(",")
    if t.strip() and not (t.strip().isdigit() and len(t.strip()) == 6)  # 국내 6자리는 KIS WS로
]

_mock_seed_price: dict[str, float] = {}


# ─────────────────────────────────────────────────────────────────────────────
# 공통 유틸
# ─────────────────────────────────────────────────────────────────────────────

def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _normalize_symbol(value: str) -> str:
    token = str(value or "").strip().upper()
    return token.replace("KRW-", "", 1) if token.startswith("KRW-") else token


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


# ─────────────────────────────────────────────────────────────────────────────
# Kafka
# ─────────────────────────────────────────────────────────────────────────────

async def _create_producer() -> AIOKafkaProducer:
    delay = 1
    while True:
        try:
            producer = AIOKafkaProducer(
                bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
                value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            )
            await producer.start()
            logger.info("Kafka 연결 완료 (topics=%s,%s)", PRICE_TOPIC, PRICE_TICK_TOPIC)
            return producer
        except Exception as exc:
            logger.warning("Kafka 연결 실패 (%s), %ss 후 재시도", exc, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, MAX_RECONNECT_DELAY)


async def _publish(producer: AIOKafkaProducer, row: dict[str, Any]) -> None:
    """Kafka 발행. key=symbol로 파티션 순서 보장."""
    key = row.get("symbol", "").encode("utf-8") or None
    await producer.send_and_wait(PRICE_TOPIC, row, key=key)
    await producer.send_and_wait(PRICE_TICK_TOPIC, row, key=key)


# ─────────────────────────────────────────────────────────────────────────────
# 크립토: 업비트 WebSocket
# ─────────────────────────────────────────────────────────────────────────────

def _parse_upbit_ws_message(raw: dict) -> dict[str, Any] | None:
    if raw.get("type") != "ticker":
        return None
    market = str(raw.get("code", "")).upper()
    symbol = _normalize_symbol(market)
    price = _safe_float(raw.get("trade_price"), 0.0)
    if not symbol or price <= 0:
        return None
    ts_ms = raw.get("timestamp") or raw.get("trade_timestamp")
    ts = (
        datetime.fromtimestamp(int(ts_ms) / 1000, tz=timezone.utc).isoformat(timespec="seconds")
        if ts_ms else _utc_iso_now()
    )
    return {
        "symbol":         symbol,
        "asset_type":     "crypto",
        "market":         "CRYPTO",
        "price":          price,
        "currency":       "KRW",
        "timestamp":      ts,
        "source":         "upbit",
        "change_percent": _safe_float(raw.get("signed_change_rate"), 0.0) * 100.0,
        "volume":         _safe_float(raw.get("acc_trade_volume_24h"), 0.0),
    }


async def _upbit_ws_loop(producer: AIOKafkaProducer) -> None:
    """업비트 WebSocket 실시간 코인 시세 수집."""
    delay = 1
    while True:
        subscribe_msg = json.dumps([
            {"ticket": str(uuid.uuid4())},
            {"type": "ticker", "codes": CRYPTO_MARKETS, "isOnlyRealtime": True},
        ])
        try:
            logger.info("업비트 WS 연결: %s", UPBIT_WS_URL)
            async with websockets.connect(UPBIT_WS_URL, ping_interval=30, ping_timeout=10) as ws:
                await ws.send(subscribe_msg)
                logger.info("업비트 WS 구독 완료: %s", CRYPTO_MARKETS)
                delay = 1
                async for message in ws:
                    try:
                        raw = json.loads(message)
                        row = _parse_upbit_ws_message(raw)
                        if row:
                            await _publish(producer, row)
                            logger.debug("Upbit tick: %s = %s", row["symbol"], row["price"])
                    except Exception as exc:
                        logger.warning("업비트 WS 메시지 처리 실패: %s", exc)
        except Exception as exc:
            logger.warning("업비트 WS 끊김 (%s), %ss 후 재연결", exc, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, MAX_RECONNECT_DELAY)


# ─────────────────────────────────────────────────────────────────────────────
# 국내주식: KIS WebSocket
# ─────────────────────────────────────────────────────────────────────────────

async def _get_kis_approval_key() -> str:
    """KIS WebSocket 접속 승인키 발급 (REST 1회 호출)."""
    if not KIS_APP_KEY or not KIS_APP_SECRET:
        raise ValueError("KIS_APP_KEY / KIS_APP_SECRET 미설정")
    body = {
        "grant_type": "client_credentials",
        "appkey":     KIS_APP_KEY,
        "secretkey":  KIS_APP_SECRET,
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(KIS_APPROVAL_URL, json=body)
        resp.raise_for_status()
        data = resp.json()
    key = data.get("approval_key", "")
    if not key:
        raise ValueError(f"KIS 승인키 발급 실패: {data}")
    return key


def _make_kis_subscribe_msg(approval_key: str, symbol: str) -> str:
    return json.dumps({
        "header": {
            "approval_key": approval_key,
            "custtype":     "P",
            "tr_type":      "1",
            "content-type": "utf-8",
        },
        "body": {
            "input": {
                "tr_id":  "H0STCNT0",
                "tr_key": symbol,
            }
        },
    })


def _parse_kis_domestic_tick(raw: str) -> dict[str, Any] | None:
    """
    KIS H0STCNT0 파이프 응답 파싱.
    형식: 0|H0STCNT0|{count}|{field0}^{field1}^...
    주요 필드 (0-based):
      0: 종목코드, 1: 체결시각(HHMMSS KST), 2: 현재가,
      3: 전일대비부호(1=상한 2=상승 3=보합 4=하한 5=하락),
      4: 전일대비, 5: 전일대비율(%), 13: 누적거래량
    """
    parts = raw.split("|")
    if len(parts) < 4 or parts[0] != "0" or parts[1] != "H0STCNT0":
        return None

    fields = parts[3].split("^")
    if len(fields) < 14:
        return None

    symbol = fields[0].strip()
    price = _safe_float(fields[2], 0.0)
    if not symbol or price <= 0:
        return None

    # 전일대비율 부호 적용
    sign = fields[3]
    change_pct = _safe_float(fields[5], 0.0)
    if sign in ("4", "5"):
        change_pct = -abs(change_pct)
    elif sign in ("1", "2"):
        change_pct = abs(change_pct)

    volume = _safe_float(fields[13], 0.0)

    # 체결시각 KST HHMMSS → UTC ISO
    time_str = fields[1]
    try:
        today = date.today()
        dt_kst = datetime(
            today.year, today.month, today.day,
            int(time_str[0:2]), int(time_str[2:4]), int(time_str[4:6]),
            tzinfo=KST,
        )
        ts = dt_kst.astimezone(timezone.utc).isoformat(timespec="seconds")
    except Exception:
        ts = _utc_iso_now()

    return {
        "symbol":         symbol,
        "asset_type":     "stock",
        "market":         "KR",
        "price":          price,
        "currency":       "KRW",
        "timestamp":      ts,
        "source":         "kis_ws",
        "change_percent": change_pct,
        "volume":         volume,
    }


async def _kis_ws_loop(producer: AIOKafkaProducer) -> None:
    """KIS WebSocket 실시간 국내주식 체결 수집. 재연결 시 승인키 재발급."""
    if not KIS_APP_KEY or not KIS_APP_SECRET:
        logger.warning("KIS_APP_KEY/SECRET 미설정 → KIS WS 루프 비활성화")
        return
    if not KIS_DOMESTIC_SYMBOLS:
        logger.info("KIS_DOMESTIC_SYMBOLS 미설정 → KIS WS 루프 비활성화")
        return

    delay = 1
    while True:
        try:
            logger.info("KIS 승인키 발급 중...")
            approval_key = await _get_kis_approval_key()
            logger.info("KIS WS 연결: %s", KIS_WS_URL)

            # KIS는 프로토콜 레벨 ping 미사용 → ping_interval=None
            async with websockets.connect(KIS_WS_URL, ping_interval=None) as ws:
                for symbol in KIS_DOMESTIC_SYMBOLS:
                    await ws.send(_make_kis_subscribe_msg(approval_key, symbol))
                logger.info("KIS WS 구독 완료: %s", KIS_DOMESTIC_SYMBOLS)
                delay = 1

                async for message in ws:
                    # KIS 애플리케이션 레벨 PINGPONG 처리
                    if message == "PINGPONG":
                        await ws.send("PINGPONG")
                        continue
                    try:
                        row = _parse_kis_domestic_tick(message)
                        if row:
                            await _publish(producer, row)
                            logger.debug("KIS WS tick: %s = %s", row["symbol"], row["price"])
                    except Exception as exc:
                        logger.warning("KIS WS 메시지 처리 실패: %s", exc)

        except Exception as exc:
            logger.warning("KIS WS 끊김 (%s), %ss 후 재연결 (승인키 재발급 포함)", exc, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, MAX_RECONNECT_DELAY)


# ─────────────────────────────────────────────────────────────────────────────
# 해외주식: Finnhub / Polygon HTTP 폴링 (Phase A fallback)
# ─────────────────────────────────────────────────────────────────────────────

def _build_mock_price(symbol: str, asset_type: str, currency: str) -> dict[str, Any]:
    prev = _mock_seed_price.get(symbol)
    if prev is None:
        base = 100.0 + (hash(symbol) % 1000)
        _mock_seed_price[symbol] = base
        prev = base
    step = ((hash(f"{symbol}:{datetime.now(timezone.utc).second}") % 200) - 100) / 1000.0
    next_price = max(0.1, prev * (1.0 + step / 100.0))
    _mock_seed_price[symbol] = next_price
    return {
        "symbol": symbol, "asset_type": asset_type,
        "price": round(next_price, 6), "currency": currency,
        "timestamp": _utc_iso_now(), "source": "mock",
    }


async def _fetch_stock_finnhub(symbols: list[str]) -> list[dict[str, Any]]:
    if not FINNHUB_API_KEY:
        return []
    out: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=8.0) as client:
        for symbol in symbols:
            try:
                resp = await client.get(
                    "https://finnhub.io/api/v1/quote",
                    params={"symbol": symbol, "token": FINNHUB_API_KEY},
                )
                resp.raise_for_status()
                row = resp.json()
                price = _safe_float(row.get("c"), 0.0)
                if price <= 0:
                    continue
                ts_unix = int(_safe_float(row.get("t"), 0))
                ts = (
                    datetime.fromtimestamp(ts_unix, tz=timezone.utc).isoformat(timespec="seconds")
                    if ts_unix > 0 else _utc_iso_now()
                )
                out.append({
                    "symbol": symbol, "asset_type": "stock", "market": "US",
                    "price": price, "currency": "USD", "timestamp": ts,
                    "source": "finnhub",
                    "change": _safe_float(row.get("d"), 0.0),
                    "change_percent": _safe_float(row.get("dp"), 0.0),
                })
            except Exception as exc:
                logger.debug("Finnhub fetch 실패 (%s): %s", symbol, exc)
    return out


async def _fetch_stock_polygon(symbols: list[str]) -> list[dict[str, Any]]:
    if not POLYGON_API_KEY:
        return []
    out: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=8.0) as client:
        for symbol in symbols:
            try:
                resp = await client.get(
                    f"https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/{symbol}",
                    params={"apiKey": POLYGON_API_KEY},
                )
                resp.raise_for_status()
                payload = resp.json()
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
                change_pct = (change / prev_close * 100.0) if prev_close > 0 else 0.0
                out.append({
                    "symbol": symbol, "asset_type": "stock", "market": "US",
                    "price": price, "currency": "USD", "timestamp": _utc_iso_now(),
                    "source": "polygon",
                    "change": change, "change_percent": change_pct,
                    "volume": _safe_float(day.get("v"), 0.0),
                })
            except Exception as exc:
                logger.debug("Polygon fetch 실패 (%s): %s", symbol, exc)
    return out


async def _stock_poll_loop(producer: AIOKafkaProducer) -> None:
    """해외주식 HTTP 폴링 루프 (Finnhub / Polygon)."""
    logger.info("해외주식 폴링 시작 (interval=%ss, vendor=%s)", STOCK_POLL_INTERVAL, STOCK_VENDOR)
    while True:
        try:
            items: list[dict[str, Any]] = []
            if STOCK_VENDOR in ("auto", "finnhub"):
                items = await _fetch_stock_finnhub(STOCK_SYMBOLS)
            if not items and STOCK_VENDOR in ("auto", "polygon"):
                items = await _fetch_stock_polygon(STOCK_SYMBOLS)

            if ALLOW_MOCK_PRICE_FEED:
                fetched = {r["symbol"] for r in items}
                for sym in STOCK_SYMBOLS:
                    if sym not in fetched:
                        items.append(_build_mock_price(sym, "stock", "USD"))

            source_count: dict[str, int] = {}
            for row in items:
                await _publish(producer, row)
                src = str(row.get("source", "unknown"))
                source_count[src] = source_count.get(src, 0) + 1

            if items:
                logger.info("해외주식 발행: count=%d sources=%s", len(items), source_count)

        except Exception as exc:
            logger.error("해외주식 폴링 사이클 실패: %s", exc)

        await asyncio.sleep(STOCK_POLL_INTERVAL)


# ─────────────────────────────────────────────────────────────────────────────
# 진입점
# ─────────────────────────────────────────────────────────────────────────────

async def main():
    logger.info(
        "Price Producer 시작 | crypto=%s | domestic=%s | overseas=poll(%ss, %s) | mock=%s",
        CRYPTO_MARKETS, KIS_DOMESTIC_SYMBOLS, STOCK_POLL_INTERVAL, STOCK_VENDOR, ALLOW_MOCK_PRICE_FEED,
    )
    producer = await _create_producer()
    try:
        await asyncio.gather(
            _upbit_ws_loop(producer),    # 크립토: 업비트 WS
            _kis_ws_loop(producer),      # 국내주식: KIS WS
            _stock_poll_loop(producer),  # 해외주식: Finnhub/Polygon 폴링
        )
    except KeyboardInterrupt:
        logger.info("종료 요청")
    finally:
        await producer.stop()
        logger.info("Producer 종료")


if __name__ == "__main__":
    asyncio.run(main())
