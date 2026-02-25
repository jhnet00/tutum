from __future__ import annotations
import logging

from datetime import datetime, timedelta
from typing import Dict

import httpx

from ..config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

# Base currency fallback rates (KRW base)
_FALLBACK_BASE_RATES: Dict[str, float] = {
    "KRW": 1.0,
    "USD": 1450.0,
    "JPY": 9.5,
    "EUR": 1570.0,
}
_CACHE_TTL = timedelta(minutes=10)
_cached_rates: Dict[str, float] | None = None
_cached_at: datetime | None = None


async def _fetch_live_rates() -> Dict[str, float] | None:
    """Fetch FX rates from a public API (base: KRW)."""
    url = f"{settings.EXCHANGE_RATE_API_URL}/KRW"
    timeout = float(settings.EXCHANGE_RATE_TIMEOUT_SECONDS)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(url)
            response.raise_for_status()
            payload = response.json()
            rates = payload.get("rates", {})
            if not rates:
                return None
            return {"KRW": 1.0, **{k.upper(): float(v) for k, v in rates.items()}}
    except Exception as e:
        logger.warning("Live exchange rate fetch failed: %s", e)
        return None


async def _get_rates() -> Dict[str, float]:
    """Return cached live rates or fallback rates."""
    global _cached_rates, _cached_at

    now = datetime.utcnow()
    if _cached_rates and _cached_at and now - _cached_at < _CACHE_TTL:
        return _cached_rates

    live = await _fetch_live_rates()
    if live:
        _cached_rates = live
        _cached_at = now
        return live

    return _FALLBACK_BASE_RATES


async def get_exchange_rate(from_currency: str, to_currency: str) -> float:
    """Return FX rate from `from_currency` to `to_currency`."""
    source = (from_currency or "").upper()
    target = (to_currency or "").upper()

    if not source or not target:
        raise ValueError("Currency code must not be empty")

    if source == target:
        return 1.0

    rates = await _get_rates()

    if source not in rates or target not in rates:
        raise ValueError(f"Unsupported exchange pair: {source} -> {target}")

    # rates are KRW-base: 1 KRW = rates[X] X-currency
    source_per_krw = rates[source]
    target_per_krw = rates[target]
    return target_per_krw / source_per_krw


