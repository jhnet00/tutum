"""Redis cache/session helpers."""

import asyncio
import hashlib
import json
import logging

import redis.asyncio as redis

from .config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

redis_client: redis.Redis | None = None
REDIS_OP_TIMEOUT_SEC = 1.0


async def connect_to_redis():
    """Initialize Redis connection."""
    global redis_client

    redis_client = redis.from_url(
        settings.REDIS_URL,
        encoding="utf-8",
        decode_responses=True,
        socket_connect_timeout=1,
        socket_timeout=1,
        retry_on_timeout=False,
    )
    try:
        await asyncio.wait_for(redis_client.ping(), timeout=REDIS_OP_TIMEOUT_SEC)
        logger.info("Redis connected: %s", settings.REDIS_URL)
    except Exception as e:
        logger.warning("Redis connection failed (degraded mode): %s", e)
        try:
            await redis_client.close()
        except Exception:
            pass
        redis_client = None


async def close_redis_connection():
    """Close Redis connection."""
    global redis_client  # noqa: F824

    if redis_client:
        await redis_client.close()
        logger.info("Redis connection closed")


def get_redis() -> redis.Redis | None:
    """Return Redis client instance."""
    return redis_client


async def cache_get(key: str) -> str | None:
    if redis_client is None:
        return None
    try:
        return await asyncio.wait_for(redis_client.get(key), timeout=REDIS_OP_TIMEOUT_SEC)
    except Exception as e:
        logger.warning("Redis GET failed: %s", e)
        return None


async def cache_set(key: str, value: str, expire_seconds: int = 300):
    if redis_client is None:
        return
    try:
        await asyncio.wait_for(redis_client.setex(key, expire_seconds, value), timeout=REDIS_OP_TIMEOUT_SEC)
    except Exception as e:
        logger.warning("Redis SET failed: %s", e)


async def cache_delete(key: str):
    if redis_client is None:
        return
    try:
        await asyncio.wait_for(redis_client.delete(key), timeout=REDIS_OP_TIMEOUT_SEC)
    except Exception as e:
        logger.warning("Redis DELETE failed: %s", e)


async def rate_limit_increment(key: str, window_seconds: int = 60) -> int | None:
    if redis_client is None:
        return None
    try:
        pipe = redis_client.pipeline()
        pipe.incr(key)
        pipe.expire(key, window_seconds)
        results = await asyncio.wait_for(pipe.execute(), timeout=REDIS_OP_TIMEOUT_SEC)
        return results[0]
    except Exception as e:
        logger.warning("Redis INCR failed: %s", e)
        return None


async def rate_limit_get(key: str) -> int | None:
    if redis_client is None:
        return None
    try:
        count = await asyncio.wait_for(redis_client.get(key), timeout=REDIS_OP_TIMEOUT_SEC)
        return int(count) if count else 0
    except Exception as e:
        logger.warning("Redis GET failed: %s", e)
        return None


async def rate_limit_reset(key: str):
    await cache_delete(key)


async def cache_get_with_last_good(key: str) -> tuple[str | None, bool]:
    """신선 캐시 우선 조회 → 없으면 last_good 폴백.
    Returns: (value, is_stale) — is_stale=True면 last_good에서 반환된 것.
    """
    fresh = await cache_get(key)
    if fresh:
        return fresh, False
    stale = await cache_get(f"{key}:last_good")
    if stale:
        return stale, True
    return None, False


async def cache_set_with_last_good(key: str, value: str, expire_seconds: int = 300, backup_ttl: int = 86400):
    """단기 TTL 캐시 저장 + 24시간 last_good 백업 동시 저장."""
    await cache_set(key, value, expire_seconds)
    await cache_set(f"{key}:last_good", value, backup_ttl)


async def blacklist_token(token: str, expire_seconds: int = 1800):
    if redis_client is None:
        return
    try:
        token_hash = hashlib.sha256(token.encode()).hexdigest()[:32]
        key = f"blacklist:{token_hash}"
        await asyncio.wait_for(redis_client.setex(key, expire_seconds, "1"), timeout=REDIS_OP_TIMEOUT_SEC)
    except Exception as e:
        logger.warning("Redis blacklist add failed: %s", e)


async def is_token_blacklisted(token: str) -> bool:
    if redis_client is None:
        return False
    try:
        token_hash = hashlib.sha256(token.encode()).hexdigest()[:32]
        key = f"blacklist:{token_hash}"
        result = await asyncio.wait_for(redis_client.get(key), timeout=REDIS_OP_TIMEOUT_SEC)
        return result is not None
    except Exception as e:
        logger.warning("Redis blacklist lookup failed: %s", e)
        return False


PORTFOLIO_CACHE_TTL = 60


async def cache_portfolio(user_id: str, portfolio_data: dict):
    if redis_client is None:
        return
    try:
        key = f"portfolio:{user_id}"
        await asyncio.wait_for(
            redis_client.setex(key, PORTFOLIO_CACHE_TTL, json.dumps(portfolio_data, default=str)),
            timeout=REDIS_OP_TIMEOUT_SEC,
        )
    except Exception as e:
        logger.warning("Portfolio cache set failed: %s", e)


async def get_cached_portfolio(user_id: str) -> dict | None:
    if redis_client is None:
        return None
    try:
        key = f"portfolio:{user_id}"
        cached = await asyncio.wait_for(redis_client.get(key), timeout=REDIS_OP_TIMEOUT_SEC)
        if cached:
            return json.loads(cached)
    except Exception as e:
        logger.warning("Portfolio cache get failed: %s", e)
    return None


async def invalidate_portfolio_cache(user_id: str):
    await cache_delete(f"portfolio:{user_id}")
