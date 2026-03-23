"""
============================================
Replay Candles -> Redis (V3 Backfill)
============================================

- MongoDB `candles_1m` 데이터를 Redis 캔들 키로 복원한다.
- 장애/재기동 후 캔들 캐시 복구용 스크립트
"""

import argparse
import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import redis.asyncio as redis
from motor.motor_asyncio import AsyncIOMotorClient

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "clouddx")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
CANDLE_KEEP = max(200, int(os.getenv("CANDLE_KEEP", "2000")))
LIST_TTL_SECONDS = max(3600, int(os.getenv("CANDLE_LIST_TTL_SECONDS", "1209600")))
CURRENT_TTL_SECONDS = max(300, int(os.getenv("CANDLE_CURRENT_TTL_SECONDS", "7200")))


def _normalize_symbol(token: str) -> str:
    text = str(token or "").strip().upper()
    if text.startswith("KRW-"):
        text = text.replace("KRW-", "", 1)
    return text


def _int_or_default(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


async def replay_symbol(
    mongo_col,
    redis_client: redis.Redis,
    symbol: str,
    from_bucket: int,
    reset: bool,
):
    key = f"candles:{symbol}:1m"
    current_key = f"candles:{symbol}:1m:current"

    if reset:
        await redis_client.delete(key, current_key)

    cursor = (
        mongo_col.find(
            {"symbol": symbol, "bucket_start": {"$gte": from_bucket}},
            {"_id": 0},
        )
        .sort("bucket_start", 1)
    )
    rows = await cursor.to_list(length=None)
    if not rows:
        print(f"[SKIP] {symbol}: no rows in Mongo")
        return

    serialized_rows: list[str] = []
    for row in rows:
        payload = {
            "symbol": symbol,
            "asset_type": row.get("asset_type"),
            "bucket_start": _int_or_default(row.get("bucket_start")),
            "date": row.get("date"),
            "open": float(row.get("open", 0)),
            "high": float(row.get("high", 0)),
            "low": float(row.get("low", 0)),
            "close": float(row.get("close", 0)),
            "volume": float(row.get("volume", 0)),
            "updated_at": row.get("updated_at") or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        serialized_rows.append(json.dumps(payload))

    if serialized_rows:
        await redis_client.rpush(key, *serialized_rows)
        await redis_client.ltrim(key, -CANDLE_KEEP, -1)
        await redis_client.expire(key, LIST_TTL_SECONDS)
        await redis_client.setex(current_key, CURRENT_TTL_SECONDS, serialized_rows[-1])

    print(f"[OK] {symbol}: replayed {len(serialized_rows)} rows")


async def main():
    parser = argparse.ArgumentParser(description="Replay Mongo candles_1m to Redis")
    parser.add_argument(
        "--symbols",
        default="BTC,ETH,SOL,XRP,005930,AAPL,NVDA,TSLA,MSFT",
        help="comma separated symbols",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=7,
        help="lookback days from now (default: 7)",
    )
    parser.add_argument(
        "--no-reset",
        action="store_true",
        help="append mode (do not clear existing redis keys)",
    )
    args = parser.parse_args()

    symbols = [_normalize_symbol(s) for s in args.symbols.split(",") if _normalize_symbol(s)]
    lookback = max(1, int(args.days))
    from_bucket = int((datetime.now(timezone.utc) - timedelta(days=lookback)).timestamp())
    from_bucket -= from_bucket % 60

    mongo_client = AsyncIOMotorClient(MONGODB_URL, serverSelectionTimeoutMS=5000)
    redis_client = redis.from_url(REDIS_URL, encoding="utf-8", decode_responses=True)

    try:
        await mongo_client.admin.command("ping")
        await redis_client.ping()
        db = mongo_client[MONGODB_DB_NAME]
        col = db["candles_1m"]

        print(f"[INFO] replay start symbols={symbols} days={lookback} reset={not args.no_reset}")
        for symbol in symbols:
            await replay_symbol(col, redis_client, symbol, from_bucket, reset=not args.no_reset)
        print("[DONE] replay complete")
    finally:
        mongo_client.close()
        await redis_client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
