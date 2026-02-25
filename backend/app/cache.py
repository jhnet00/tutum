"""Redis cache/session helpers."""

import hashlib
import json
import logging

import redis.asyncio as redis

from .config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

redis_client: redis.Redis | None = None


async def connect_to_redis():
    """Initialize Redis connection."""
    global redis_client

    redis_client = redis.from_url(settings.REDIS_URL, encoding="utf-8", decode_responses=True)
    try:
        await redis_client.ping()
        logger.info("Redis connected: %s", settings.REDIS_URL)
    except Exception as e:
        logger.warning("Redis connection failed (degraded mode): %s", e)


async def close_redis_connection():
    """Close Redis connection."""
    global redis_client

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
        return await redis_client.get(key)
    except Exception as e:
        logger.warning("Redis GET failed: %s", e)
        return None


async def cache_set(key: str, value: str, expire_seconds: int = 300):
    if redis_client is None:
        return
    try:
        await redis_client.setex(key, expire_seconds, value)
    except Exception as e:
        logger.warning("Redis SET failed: %s", e)


async def cache_delete(key: str):
    if redis_client is None:
        return
    try:
        await redis_client.delete(key)
    except Exception as e:
        logger.warning("Redis DELETE failed: %s", e)


async def rate_limit_increment(key: str, window_seconds: int = 60) -> int | None:
    if redis_client is None:
        return None
    try:
        pipe = redis_client.pipeline()
        pipe.incr(key)
        pipe.expire(key, window_seconds)
        results = await pipe.execute()
        return results[0]
    except Exception as e:
        logger.warning("Redis INCR failed: %s", e)
        return None


async def rate_limit_get(key: str) -> int | None:
    if redis_client is None:
        return None
    try:
        count = await redis_client.get(key)
        return int(count) if count else 0
    except Exception as e:
        logger.warning("Redis GET failed: %s", e)
        return None


async def rate_limit_reset(key: str):
    await cache_delete(key)


async def blacklist_token(token: str, expire_seconds: int = 1800):
    if redis_client is None:
        return
    try:
        token_hash = hashlib.sha256(token.encode()).hexdigest()[:32]
        key = f"blacklist:{token_hash}"
        await redis_client.setex(key, expire_seconds, "1")
    except Exception as e:
        logger.warning("Redis blacklist add failed: %s", e)


async def is_token_blacklisted(token: str) -> bool:
    if redis_client is None:
        return False
    try:
        token_hash = hashlib.sha256(token.encode()).hexdigest()[:32]
        key = f"blacklist:{token_hash}"
        result = await redis_client.get(key)
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
        await redis_client.setex(key, PORTFOLIO_CACHE_TTL, json.dumps(portfolio_data, default=str))
    except Exception as e:
        logger.warning("Portfolio cache set failed: %s", e)


async def get_cached_portfolio(user_id: str) -> dict | None:
    if redis_client is None:
        return None
    try:
        key = f"portfolio:{user_id}"
        cached = await redis_client.get(key)
        if cached:
            return json.loads(cached)
    except Exception as e:
        logger.warning("Portfolio cache get failed: %s", e)
    return None


async def invalidate_portfolio_cache(user_id: str):
    await cache_delete(f"portfolio:{user_id}")
