"""
============================================
Candle Aggregator - 1분 캔들 집계 서비스 (V2)
============================================

- Kafka `price_tick` 토픽 소비
- 심볼별 1분 OHLCV 캔들 생성
- Redis: 최근 캔들 저장 (REST 초기 로드용)
- MongoDB: 장기 저장(upsert) - 복구/백필 기반
"""

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import redis.asyncio as redis
from aiokafka import AIOKafkaConsumer
from motor.motor_asyncio import AsyncIOMotorClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
KAFKA_TICK_TOPIC = os.getenv("KAFKA_TICK_TOPIC", "price_tick")
KAFKA_GROUP_ID = os.getenv("KAFKA_CANDLE_GROUP_ID", "candle-aggregator-group")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "clouddx")

CANDLE_KEEP = max(200, int(os.getenv("CANDLE_KEEP", "2000")))
CURRENT_TTL_SECONDS = max(300, int(os.getenv("CANDLE_CURRENT_TTL_SECONDS", "7200")))
LIST_TTL_SECONDS = max(3600, int(os.getenv("CANDLE_LIST_TTL_SECONDS", "1209600")))  # 14 days
MAX_TICK_AGE_SECONDS_STOCK = max(60, int(os.getenv("MAX_TICK_AGE_SECONDS_STOCK", "900")))
MAX_TICK_AGE_SECONDS_CRYPTO = max(60, int(os.getenv("MAX_TICK_AGE_SECONDS_CRYPTO", "180")))

KST = ZoneInfo("Asia/Seoul")


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _normalize_symbol(raw: Any) -> str:
    token = str(raw or "").strip().upper()
    if token.startswith("KRW-"):
        token = token.replace("KRW-", "", 1)
    return token


def _parse_timestamp(raw: Any) -> datetime:
    if isinstance(raw, (int, float)):
        return datetime.fromtimestamp(float(raw), tz=timezone.utc)

    text = str(raw or "").strip()
    if not text:
        return datetime.now(timezone.utc)

    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"

    try:
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def _minute_bucket_start(dt_utc: datetime) -> int:
    unix_sec = int(dt_utc.timestamp())
    return unix_sec - (unix_sec % 60)


def _bucket_to_kst_iso(bucket_start: int) -> str:
    return datetime.fromtimestamp(bucket_start, tz=timezone.utc).astimezone(KST).isoformat(timespec="seconds")


@dataclass
class CandleState:
    symbol: str
    asset_type: str
    bucket_start: int
    open: float
    high: float
    low: float
    close: float
    volume: float

    def to_payload(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "asset_type": self.asset_type,
            "bucket_start": self.bucket_start,
            "date": _bucket_to_kst_iso(self.bucket_start),
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
            "volume": self.volume,
            "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }


class CandleAggregator:
    def __init__(self):
        self.consumer: AIOKafkaConsumer | None = None
        self.redis_client: redis.Redis | None = None
        self.mongo_client: AsyncIOMotorClient | None = None
        self.mongo_collection = None
        self.states: dict[str, CandleState] = {}
        self.running = False

    async def connect(self):
        self.consumer = AIOKafkaConsumer(
            KAFKA_TICK_TOPIC,
            bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
            group_id=KAFKA_GROUP_ID,
            value_deserializer=lambda v: json.loads(v.decode("utf-8")),
            auto_offset_reset="latest",
            enable_auto_commit=True,
        )
        await self.consumer.start()
        logger.info("Kafka consumer connected topic=%s", KAFKA_TICK_TOPIC)

        self.redis_client = redis.from_url(REDIS_URL, encoding="utf-8", decode_responses=True)
        await self.redis_client.ping()
        logger.info("Redis connected url=%s", REDIS_URL)

        try:
            self.mongo_client = AsyncIOMotorClient(MONGODB_URL, serverSelectionTimeoutMS=3000)
            await self.mongo_client.admin.command("ping")
            db = self.mongo_client[MONGODB_DB_NAME]
            self.mongo_collection = db["candles_1m"]
            await self.mongo_collection.create_index(
                [("symbol", 1), ("bucket_start", 1)],
                unique=True,
                name="uq_symbol_bucket",
            )
            await self.mongo_collection.create_index([("updated_at", -1)], name="idx_updated_at")
            logger.info("Mongo connected db=%s collection=candles_1m", MONGODB_DB_NAME)
        except Exception as exc:
            logger.warning("Mongo disabled (connect/index failed): %s", exc)
            self.mongo_collection = None

    async def _persist_current(self, state: CandleState):
        if self.redis_client is None:
            return
        key = f"candles:{state.symbol}:1m:current"
        await self.redis_client.setex(key, CURRENT_TTL_SECONDS, json.dumps(state.to_payload()))

    async def _persist_finalized(self, state: CandleState):
        payload = state.to_payload()

        if self.redis_client is not None:
            key = f"candles:{state.symbol}:1m"
            await self.redis_client.rpush(key, json.dumps(payload))
            await self.redis_client.ltrim(key, -CANDLE_KEEP, -1)
            await self.redis_client.expire(key, LIST_TTL_SECONDS)

        if self.mongo_collection is not None:
            await self.mongo_collection.update_one(
                {"symbol": state.symbol, "bucket_start": state.bucket_start},
                {"$set": payload},
                upsert=True,
            )

    async def process_tick(self, message: dict[str, Any]):
        symbol = _normalize_symbol(
            message.get("symbol") or message.get("ticker") or message.get("code")
        )
        if not symbol:
            return

        price = _safe_float(message.get("price"), 0.0)
        if price <= 0:
            return

        asset_type = str(message.get("asset_type") or "unknown").lower()
        ts = _parse_timestamp(message.get("timestamp"))
        now_utc = datetime.now(timezone.utc)
        tick_age = (now_utc - ts).total_seconds()

        # 세션 종료 후 과거 체결시각이 긴 틱은 집계하지 않는다.
        if asset_type == "stock":
            if tick_age > MAX_TICK_AGE_SECONDS_STOCK:
                return
        elif tick_age > MAX_TICK_AGE_SECONDS_CRYPTO:
            return

        bucket_start = _minute_bucket_start(ts)
        volume = _safe_float(message.get("volume"), 0.0)
        if volume <= 0:
            volume = 1.0  # tick count fallback

        current = self.states.get(symbol)
        if current is None:
            current = CandleState(
                symbol=symbol,
                asset_type=asset_type,
                bucket_start=bucket_start,
                open=price,
                high=price,
                low=price,
                close=price,
                volume=volume,
            )
            self.states[symbol] = current
            await self._persist_current(current)
            return

        if bucket_start < current.bucket_start:
            # late/out-of-order tick
            return

        if bucket_start == current.bucket_start:
            current.high = max(current.high, price)
            current.low = min(current.low, price)
            current.close = price
            current.volume += volume
            await self._persist_current(current)
            return

        # New minute started -> finalize previous candle and start new state
        await self._persist_finalized(current)

        next_state = CandleState(
            symbol=symbol,
            asset_type=asset_type,
            bucket_start=bucket_start,
            open=current.close,
            high=max(current.close, price),
            low=min(current.close, price),
            close=price,
            volume=volume,
        )
        self.states[symbol] = next_state
        await self._persist_current(next_state)

    async def run(self):
        self.running = True
        logger.info("Candle Aggregator started")
        try:
            async for msg in self.consumer:
                if not self.running:
                    break
                try:
                    await self.process_tick(msg.value)
                except Exception as exc:
                    logger.warning("Tick process failed: %s", exc)
        finally:
            await self.stop()

    async def stop(self):
        self.running = False

        if self.consumer is not None:
            await self.consumer.stop()
            self.consumer = None
            logger.info("Kafka consumer stopped")

        if self.redis_client is not None:
            await self.redis_client.aclose()
            self.redis_client = None
            logger.info("Redis connection closed")

        if self.mongo_client is not None:
            self.mongo_client.close()
            self.mongo_client = None
            logger.info("Mongo connection closed")


async def main():
    worker = CandleAggregator()
    try:
        await worker.connect()
        await worker.run()
    except KeyboardInterrupt:
        logger.info("Stop requested")
    finally:
        await worker.stop()


if __name__ == "__main__":
    asyncio.run(main())
