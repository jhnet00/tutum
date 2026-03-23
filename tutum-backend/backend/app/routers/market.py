import logging
"""
============================================
Market Data Router
============================================

二쇱떇 諛??뷀샇?뷀룓 ?쒖꽭 議고쉶 API?낅땲??
Redis 罹먯떆 ?곗꽑 議고쉶 ??罹먯떆 誘몄뒪 ???몃? API ?몄텧.
"""

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from typing import Any
import json
import asyncio
import os
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import httpx

from ..services.market_data import kis_client, crypto_client
from ..services.exchange_rate import get_exchange_rate
from ..services.stock_search import search_stocks_v2
from ..cache import cache_get_with_last_good, cache_set_with_last_good, get_redis
from ..config import get_settings

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()

# /market/ws 캐시 전용 모드: true 시 cache miss → no_data 반환 (REST fallback 금지)
# KIS WS 안정화 확인 후 true로 전환 권장
MARKET_WS_CACHE_ONLY = os.getenv("MARKET_WS_CACHE_ONLY", "false").lower() in {"1", "true", "yes", "on"}

# 통화(현금) 코드 목록 - 주식/코인 시세 조회에서 제외
CURRENCY_CODES = {
    "USD", "EUR", "JPY", "GBP", "CNY", "CHF", "CAD", "AUD",
    "HKD", "SGD", "NZD", "TWD", "THB", "VND", "KRW",
}
KST = timezone(timedelta(hours=9))
ET = ZoneInfo("America/New_York")
PUBLIC_INDEX_TARGETS = [
    {"id": "kospi", "name": "코스피", "symbol": "KOSPI", "yahoo_symbol": "^KS11"},
    {"id": "sp500", "name": "미국 대표 지수", "symbol": "S&P 500", "yahoo_symbol": "^GSPC"},
    {"id": "nasdaq100", "name": "나스닥 100", "symbol": "NASDAQ 100", "yahoo_symbol": "^NDX"},
]
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
PUBLIC_INDEX_CACHE_TTL_SECONDS = 180
PUBLIC_INDEX_LAST_GOOD_TTL_SECONDS = 6 * 60 * 60


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _latest_non_null(values: list[Any] | None) -> float | None:
    if not values:
        return None
    for value in reversed(values):
        if value is None:
            continue
        try:
            return float(value)
        except Exception:
            continue
    return None


def _format_index_price(value: Any) -> float | None:
    try:
        return round(float(value), 2)
    except Exception:
        return None


def _format_index_change(price: float | None, previous_close: float | None) -> tuple[float | None, float | None]:
    if price is None or previous_close in (None, 0):
        return None, None
    change = price - previous_close
    change_percent = (change / previous_close) * 100
    return round(change, 2), round(change_percent, 2)


def _to_iso_utc(raw_ts: Any) -> str | None:
    try:
        return datetime.fromtimestamp(int(raw_ts), tz=timezone.utc).isoformat()
    except Exception:
        return None


def _market_status_from_meta(meta: dict[str, Any]) -> str:
    regular = ((meta.get("currentTradingPeriod") or {}).get("regular") or {})
    start_ts = regular.get("start")
    end_ts = regular.get("end")
    now_ts = int(_now_utc().timestamp())
    try:
        if start_ts is not None and end_ts is not None and int(start_ts) <= now_ts <= int(end_ts):
            return "open"
    except Exception:
        pass
    return "closed"


def _is_index_stale(updated_at: str | None) -> bool:
    if not updated_at:
        return True
    parsed = _parse_iso_datetime(updated_at)
    if parsed is None:
        return True
    return (_now_utc() - parsed) > timedelta(days=3)


def _unavailable_index_item(target: dict[str, str], source: str = "error") -> dict[str, Any]:
    return {
        "id": target["id"],
        "symbol": target["symbol"],
        "name": target["name"],
        "price": None,
        "change": None,
        "changePercent": None,
        "currency": "KRW" if target["id"] == "kospi" else "USD",
        "marketStatus": "unknown",
        "updatedAt": None,
        "stale": True,
        "available": False,
        "source": source,
    }


async def _fetch_public_index_item(target: dict[str, str]) -> dict[str, Any]:
    cache_key = f"market:index:{target['id']}"
    cache_hit, cache_is_stale = await cache_get_with_last_good(cache_key)

    try:
        async with httpx.AsyncClient(
            timeout=10.0,
            headers={"User-Agent": "Mozilla/5.0 TutumMarketMonitor/1.0"},
        ) as client:
            response = await client.get(
                YAHOO_CHART_URL.format(symbol=target["yahoo_symbol"]),
                params={"interval": "1d", "range": "5d"},
            )
            response.raise_for_status()

        payload = response.json()
        result = ((payload.get("chart") or {}).get("result") or [None])[0]
        if not isinstance(result, dict):
            raise ValueError("missing chart result")

        meta = result.get("meta") or {}
        indicators = (((result.get("indicators") or {}).get("quote") or [None])[0] or {})

        price = _format_index_price(meta.get("regularMarketPrice"))
        if price is None:
            price = _format_index_price(_latest_non_null(indicators.get("close")))

        previous_close = _format_index_price(meta.get("chartPreviousClose"))
        if previous_close is None:
            closes = indicators.get("close") or []
            if isinstance(closes, list):
                non_null = [float(v) for v in closes if v is not None]
                if len(non_null) >= 2:
                    previous_close = round(non_null[-2], 2)

        change, change_percent = _format_index_change(price, previous_close)
        updated_at = _to_iso_utc(meta.get("regularMarketTime"))

        item = {
            "id": target["id"],
            "symbol": target["symbol"],
            "name": target["name"],
            "price": price,
            "change": change,
            "changePercent": change_percent,
            "currency": meta.get("currency") or ("KRW" if target["id"] == "kospi" else "USD"),
            "marketStatus": _market_status_from_meta(meta),
            "updatedAt": updated_at,
            "stale": _is_index_stale(updated_at),
            "available": price is not None,
            "source": "yahoo",
        }

        await cache_set_with_last_good(
            cache_key,
            json.dumps(item),
            expire_seconds=PUBLIC_INDEX_CACHE_TTL_SECONDS,
            backup_ttl=PUBLIC_INDEX_LAST_GOOD_TTL_SECONDS,
        )
        return item
    except Exception as exc:
        logger.warning("public index fetch failed (%s): %s", target["id"], exc)
        if cache_hit:
            try:
                cached = json.loads(cache_hit)
                cached["source"] = "last_good" if cache_is_stale else "cache"
                cached["stale"] = True if cache_is_stale else bool(cached.get("stale", False))
                return cached
            except Exception:
                logger.warning("public index cache decode failed (%s)", target["id"])
        return _unavailable_index_item(target)


async def _build_public_indices_payload() -> dict[str, Any]:
    items = await asyncio.gather(*[_fetch_public_index_item(target) for target in PUBLIC_INDEX_TARGETS])
    return {
        "generatedAt": _now_utc().isoformat(),
        "items": items,
    }


def _signed_percent_text(value: float | None) -> str:
    if value is None:
        return "변동 데이터가 아직 없습니다."
    sign = "+" if value > 0 else ""
    return f"{sign}{value:.2f}%"


def _tone_from_change(value: float | None) -> str:
    if value is None:
        return "neutral"
    if value >= 0.6:
        return "positive"
    if value <= -0.6:
        return "caution"
    return "neutral"


def _build_index_brief_card(
    item: dict[str, Any],
    *,
    title: str,
    positive_template: str,
    negative_template: str,
    neutral_template: str,
) -> dict[str, Any]:
    change_percent = item.get("changePercent")
    status = item.get("marketStatus") or "unknown"

    if item.get("available") is not True:
        body = f"{item.get('name')} 데이터가 아직 수집되지 않아 잠시 후 다시 확인하는 편이 좋습니다."
        tone = "neutral"
    elif change_percent is not None and float(change_percent) > 0.6:
        body = positive_template.format(change_text=_signed_percent_text(change_percent), status=status)
        tone = "positive"
    elif change_percent is not None and float(change_percent) < -0.6:
        body = negative_template.format(change_text=_signed_percent_text(change_percent), status=status)
        tone = "caution"
    else:
        body = neutral_template.format(change_text=_signed_percent_text(change_percent), status=status)
        tone = "neutral"

    return {
        "id": f"brief-{item.get('id')}",
        "title": title,
        "body": body,
        "tone": tone,
    }


# ============================================================
# 종목 검색 엔드포인트
# ============================================================

@router.get("/search")
async def search_market(
    q: str = Query(..., min_length=1, description="검색어 (이름, 심볼, 종목코드)"),
    type: str = Query("all", description="자산 유형: all | stock | crypto"),
    limit: int = Query(20, ge=1, le=100, description="최대 결과 수"),
    cursor: str | None = Query(None, description="다음 페이지 커서"),
):
    """
    종목/코인 검색 API

    - 국내 주식: KRX 전체 상장 종목 (이름/종목코드 검색)
    - 해외 주식: S&P500/NASDAQ 주요 종목 (이름/심볼 검색)
    - 코인: 주요 암호화폐 (이름/심볼 검색)
    """
    search_data = await search_stocks_v2(q=q, asset_type=type, limit=limit, cursor=cursor)
    results = search_data.get("items", [])
    return {
        "results": results,
        "total": int(search_data.get("total", len(results))),
        "query": q,
        "next_cursor": search_data.get("next_cursor"),
        "has_more": bool(search_data.get("next_cursor")),
    }


async def get_cached_price(symbol: str) -> dict | None:
    """Redis 캐시에서 최신 가격 조회. 신선 캐시 없으면 last_good(24h) 폴백."""
    try:
        value, is_stale = await cache_get_with_last_good(f"price:{symbol}")
        if value:
            data = json.loads(value)
            if is_stale:
                data["stale"] = True
            return data
    except Exception as e:
        logger.warning("캐시 조회 실패: %s", e)
    return None


def _extract_positive_price(payload: dict | None) -> float | None:
    if not isinstance(payload, dict):
        return None
    try:
        price = float(payload.get("price", 0) or 0)
    except Exception:
        return None
    return price if price > 0 else None


def _build_stock_price_from_cache(symbol: str, cached: dict) -> dict:
    is_domestic = symbol.isdigit() and len(symbol) == 6
    response = {
        "code": symbol,
        "price": float(cached.get("price")),
        "change": float(cached.get("change", 0) or 0),
        "currency": cached.get("currency") or ("KRW" if is_domestic else "USD"),
        "asset_type": "stock",
        "updated_at": cached.get("timestamp") or cached.get("cached_at"),
        "source": "last_good" if cached.get("stale") else "cache",
    }
    if cached.get("market"):
        response["market"] = cached.get("market")
    return response


def normalize_symbol(raw: str) -> str:
    token = (raw or "").strip().upper()
    if token.startswith("KRW-"):
        token = token.replace("KRW-", "", 1)
    return token


def _is_overseas_stock(symbol: str) -> bool:
    """6자리 숫자가 아닌 알파벳 심볼은 해외 주식으로 판단"""
    return symbol.isalpha() and len(symbol) <= 6 and not (symbol.isdigit() and len(symbol) == 6)


def _parse_history_date(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None

    if raw.endswith("Z"):
        raw = f"{raw[:-1]}+00:00"

    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        pass

    for fmt in ("%Y-%m-%d", "%Y%m%d", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue

    return None


def _aggregate_yearly_ohlcv(history: list[dict[str, Any]], year_count: int) -> list[dict[str, Any]]:
    if not history:
        return []

    buckets: dict[int, dict[str, Any]] = {}

    for row in history:
        dt = _parse_history_date(row.get("date"))
        if dt is None:
            continue

        year = dt.year
        open_p = float(row.get("open", 0) or 0)
        high_p = float(row.get("high", 0) or 0)
        low_p = float(row.get("low", 0) or 0)
        close_p = float(row.get("close", 0) or 0)
        volume_p = float(row.get("volume", 0) or 0)

        if year not in buckets:
            buckets[year] = {
                "date": f"{year}-01-01",
                "open": open_p,
                "high": high_p,
                "low": low_p,
                "close": close_p,
                "volume": volume_p,
            }
            continue

        bucket = buckets[year]
        bucket["high"] = max(float(bucket["high"]), high_p)
        bucket["low"] = min(float(bucket["low"]), low_p)
        bucket["close"] = close_p
        bucket["volume"] = float(bucket["volume"]) + volume_p

    years = sorted(buckets.keys())
    aggregated = [buckets[y] for y in years]

    if year_count > 0 and len(aggregated) > year_count:
        aggregated = aggregated[-year_count:]

    return aggregated


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _timeframe_to_minute_unit(timeframe: str) -> int:
    raw = str(timeframe or "").strip()
    if not raw:
        return 0

    # 대문자 M은 월봉이므로 분봉으로 해석하면 안 된다.
    if raw in {"D", "W", "M", "Y"}:
        return 0

    token = raw.lower()
    if token in {"m", "minutes"}:
        return 1
    if token.startswith("minutes/"):
        try:
            return max(1, int(token.split("/", 1)[1]))
        except Exception:
            return 1
    try:
        return max(1, int(raw))
    except Exception:
        return 0


def _bucket_iso_kst(bucket_start: int) -> str:
    return datetime.fromtimestamp(bucket_start, tz=timezone.utc).astimezone(KST).isoformat(timespec="seconds")


def _is_us_regular_session_open(now_utc: datetime | None = None) -> bool:
    now = (now_utc or datetime.now(timezone.utc)).astimezone(ET)
    if now.weekday() >= 5:
        return False
    hhmm = now.hour * 60 + now.minute
    return 9 * 60 + 30 <= hhmm < 16 * 60


def _aggregate_intraday_ohlcv(history: list[dict[str, Any]], minute_unit: int) -> list[dict[str, Any]]:
    if minute_unit <= 1 or not history:
        return history

    bucket_seconds = minute_unit * 60
    aggregated: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    for row in history:
        bucket_start = int(row.get("bucket_start", 0) or 0)
        if bucket_start <= 0:
            dt = _parse_history_date(row.get("date"))
            if dt is None:
                continue
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            bucket_start = int(dt.timestamp())
        group_start = bucket_start - (bucket_start % bucket_seconds)

        if current is None or int(current["bucket_start"]) != group_start:
            if current is not None:
                aggregated.append(current)
            current = {
                "bucket_start": group_start,
                "date": _bucket_iso_kst(group_start),
                "open": _safe_float(row.get("open", 0)),
                "high": _safe_float(row.get("high", 0)),
                "low": _safe_float(row.get("low", 0)),
                "close": _safe_float(row.get("close", 0)),
                "volume": _safe_float(row.get("volume", 0)),
            }
        else:
            current["high"] = max(_safe_float(current["high"]), _safe_float(row.get("high", 0)))
            current["low"] = min(_safe_float(current["low"]), _safe_float(row.get("low", 0)))
            current["close"] = _safe_float(row.get("close", 0))
            current["volume"] = _safe_float(current.get("volume", 0)) + _safe_float(row.get("volume", 0))

    if current is not None:
        aggregated.append(current)

    return aggregated


async def _get_cached_intraday_history(symbol: str, timeframe: str, count: int) -> list[dict[str, Any]]:
    minute_unit = _timeframe_to_minute_unit(timeframe)
    if minute_unit <= 0:
        return []

    redis_client = get_redis()
    if redis_client is None:
        return []

    base_symbol = normalize_symbol(symbol)
    if not base_symbol:
        return []

    history_key = f"candles:{base_symbol}:1m"
    current_key = f"candles:{base_symbol}:1m:current"

    # 5분/60분 집계를 고려해 1분 캔들을 넉넉하게 읽는다.
    take = max(120, count * minute_unit * 3)
    rows: list[dict[str, Any]] = []
    try:
        history_raw = await redis_client.lrange(history_key, -take, -1)
        for item in history_raw:
            try:
                row = json.loads(item)
                row["bucket_start"] = int(row.get("bucket_start", 0) or 0)
                rows.append(row)
            except Exception:
                continue

        current_raw = await redis_client.get(current_key)
        if current_raw:
            try:
                current_row = json.loads(current_raw)
                current_row["bucket_start"] = int(current_row.get("bucket_start", 0) or 0)
                rows.append(current_row)
            except Exception:
                pass
    except Exception as e:
        logger.debug("Failed to load cached intraday candles (%s): %s", base_symbol, e)
        return []

    if not rows:
        return []

    dedup: dict[int, dict[str, Any]] = {}
    for row in rows:
        bucket_start = int(row.get("bucket_start", 0) or 0)
        if bucket_start <= 0:
            dt = _parse_history_date(row.get("date"))
            if dt is None:
                continue
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            bucket_start = int(dt.timestamp())
            row["bucket_start"] = bucket_start
        dedup[bucket_start] = row

    ordered = [dedup[key] for key in sorted(dedup.keys())]
    aggregated = _aggregate_intraday_ohlcv(ordered, minute_unit)
    if aggregated:
        last_bucket = int(aggregated[-1].get("bucket_start", 0) or 0)
        # 너무 오래된 캐시(기동 중단 후 잔존 데이터)는 사용하지 않는다.
        if last_bucket > 0:
            now_unix = int(datetime.now(timezone.utc).timestamp())
            if now_unix - last_bucket > 6 * 60 * 60:
                return []

    if count > 0 and len(aggregated) > count:
        aggregated = aggregated[-count:]

    clean_history = []
    for row in aggregated:
        clean_history.append(
            {
                "date": row.get("date"),
                "open": _safe_float(row.get("open", 0)),
                "high": _safe_float(row.get("high", 0)),
                "low": _safe_float(row.get("low", 0)),
                "close": _safe_float(row.get("close", 0)),
                "volume": _safe_float(row.get("volume", 0)),
            }
        )
    return clean_history


async def _convert_to_krw(data: dict) -> dict:
    """해외 주식 가격(USD)을 KRW로 변환"""
    price = data.get("price")
    if price and price > 0:
        try:
            rate = await get_exchange_rate("USD", "KRW")
            data["price_usd"] = price
            data["price"] = round(price * rate, 2)
            data["exchange_rate"] = rate
            data["currency"] = "KRW"
            if "change" in data and data["change"]:
                data["change_usd"] = data["change"]
                data["change"] = round(float(data["change"]) * rate, 2)
        except Exception as e:
            logger.warning("환율 변환 실패, USD 가격 유지: %s", e)
    return data


async def get_price_snapshot(symbol: str) -> dict:
    normalized = normalize_symbol(symbol)
    if not normalized:
        return {"symbol": symbol, "error": "empty symbol"}

    # 통화(현금) 심볼은 환율로 처리
    if normalized in CURRENCY_CODES:
        try:
            if normalized == "KRW":
                rate = 1.0
            else:
                rate = await get_exchange_rate(normalized, "KRW")
            return {
                "symbol": normalized, "price": rate,
                "currency": "KRW", "source": "exchange_rate", "asset_type": "cash",
            }
        except Exception as e:
            return {"symbol": normalized, "error": str(e), "source": "error"}

    cached = await get_cached_price(normalized)
    if cached:
        cached["source"] = "cache"
        cached["symbol"] = normalized
        return cached

    # Cache miss: MARKET_WS_CACHE_ONLY=true 시 REST fallback 금지
    if MARKET_WS_CACHE_ONLY:
        return {
            "symbol": normalized,
            "status": "no_data",
            "reason": "cache_miss",
            "source": "ws_cache_only",
        }

    # Cache miss fallback: stock(KIS) / crypto(Upbit)
    try:
        is_overseas = _is_overseas_stock(normalized)
        if normalized.isdigit() and len(normalized) == 6:
            data = await kis_client.get_current_price(normalized, market="KR")
        elif is_overseas:
            data = await kis_client.get_current_price(normalized, market="US")
            data = await _convert_to_krw(data)
        else:
            data = await crypto_client.get_current_price(normalized)
        data["source"] = "api"
        data["symbol"] = normalized
        return data
    except Exception as e:
        return {"symbol": normalized, "error": str(e), "source": "error"}


def parse_symbol_list(raw: str | None) -> set[str]:
    if not raw:
        return set()
    out: set[str] = set()
    for token in raw.split(","):
        sym = normalize_symbol(token)
        if sym:
            out.add(sym)
    return out


def _parse_iso_datetime(raw: Any) -> datetime | None:
    text = str(raw or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def _status_symbol_targets() -> list[tuple[str, str]]:
    targets: list[tuple[str, str]] = []

    stock_env = os.getenv("STOCK_SYMBOLS", "005930,AAPL,NVDA,MSFT,TSLA")
    for token in stock_env.split(","):
        symbol = normalize_symbol(token)
        if symbol:
            targets.append((symbol, "stock"))

    crypto_env = os.getenv("CRYPTO_MARKETS", "KRW-BTC,KRW-ETH,KRW-SOL,KRW-XRP")
    for token in crypto_env.split(","):
        symbol = normalize_symbol(token)
        if symbol:
            targets.append((symbol, "crypto"))

    seen: set[str] = set()
    deduped: list[tuple[str, str]] = []
    for symbol, asset_type in targets:
        key = f"{asset_type}:{symbol}"
        if key in seen:
            continue
        seen.add(key)
        deduped.append((symbol, asset_type))
    return deduped


@router.get("/price/domestic/{code}")
async def get_domestic_stock_price(code: str):
    """
    援?궡 二쇱떇 ?꾩옱媛 議고쉶 (KIS)
    - Redis 罹먯떆 ?곗꽑 議고쉶
    - code: 醫낅ぉ肄붾뱶 (?? 005930)
    """
    # 罹먯떆 ?뺤씤
    cached = await get_cached_price(code)
    if cached:
        cached["source"] = "cache"
        return cached

    # cache miss: KIS API 호출. 성공 시 last_good 백업, 실패 시 last_good 폴백
    try:
        result = await kis_client.get_current_price(code, market="KR")
        result["source"] = "api"
        import json as _j
        await cache_set_with_last_good(f"price:{code}", _j.dumps(result))
        return result
    except Exception as e:
        logger.warning("KIS domestic API 실패 (%s): %s", code, e)
        last_good = await get_cached_price(code)
        if last_good:
            last_good["source"] = "last_good"
            last_good.setdefault("stale", True)
            return last_good
        return {"code": code, "error": str(e), "source": "error"}


@router.get("/price/overseas/{ticker}")
async def get_overseas_stock_price(ticker: str):
    """
    ?댁쇅 二쇱떇 ?꾩옱媛 議고쉶 (KIS)
    - Redis 罹먯떆 ?곗꽑 議고쉶
    - ticker: ?곗빱 (?? AAPL)
    """
    # 罹먯떆 ?뺤씤
    cached = await get_cached_price(ticker.upper())
    if cached:
        cached["source"] = "cache"
        return cached

    # cache miss: KIS API 호출. 성공 시 last_good 백업, 실패 시 last_good 폴백
    try:
        result = await kis_client.get_current_price(ticker, market="US")
        result["source"] = "api"
        import json as _j
        await cache_set_with_last_good(f"price:{ticker.upper()}", _j.dumps(result))
        return result
    except Exception as e:
        logger.warning("KIS overseas API 실패 (%s): %s", ticker, e)
        last_good = await get_cached_price(ticker.upper())
        if last_good:
            last_good["source"] = "last_good"
            last_good.setdefault("stale", True)
            return last_good
        return {"ticker": ticker, "error": str(e), "source": "error"}


@router.get("/price/crypto/{ticker}")
async def get_crypto_price(ticker: str):
    """
    ?뷀샇?뷀룓 ?꾩옱媛 議고쉶 (Upbit)
    - Redis 罹먯떆 ?곗꽑 議고쉶
    - ticker: 留덉폆肄붾뱶 (?? KRW-BTC ?먮뒗 BTC)
    """
    # ?щ낵 ?뺢퇋??
    symbol = ticker.replace("KRW-", "").replace("/", "").upper()

    # 罹먯떆 ?뺤씤
    cached = await get_cached_price(symbol)
    if cached:
        cached_currency = str(cached.get("currency", "")).upper()
        cached_asset_type = str(cached.get("asset_type", "")).lower()

        # Node3 mock producer가 넣는 USD 캐시(crypto)는 단건 crypto API와 단위가 달라서 사용하지 않는다.
        # 이 API는 KRW 기준(Upbit) 응답을 보장해야 한다.
        is_crypto_cache = cached_asset_type in ("", "crypto")
        is_krw_or_unknown = cached_currency in ("", "KRW")
        if is_crypto_cache and is_krw_or_unknown:
            cached["source"] = "cache"
            cached["symbol"] = symbol
            cached.setdefault("asset_type", "crypto")
            cached.setdefault("currency", "KRW")
            return cached

        logger.info(
            "Skip mismatched crypto cache for %s (asset_type=%s, currency=%s)",
            symbol,
            cached_asset_type or "unknown",
            cached_currency or "unknown",
        )

    # cache miss: Upbit API 호출. 성공 시 last_good 백업, 실패 시 last_good 폴백
    try:
        result = await crypto_client.get_current_price(ticker)
        result["symbol"] = symbol
        result.setdefault("asset_type", "crypto")
        result.setdefault("currency", "KRW")
        result["source"] = "api"
        import json as _j
        await cache_set_with_last_good(f"price:{symbol}", _j.dumps(result))
        return result
    except Exception as e:
        logger.warning("Upbit crypto API 실패 (%s): %s", symbol, e)
        last_good = await get_cached_price(symbol)
        if last_good:
            last_good["source"] = "last_good"
            last_good.setdefault("stale", True)
            return last_good
        return {"ticker": ticker, "error": str(e), "source": "error"}


@router.get("/prices/crypto")
async def get_multiple_crypto_prices(
    tickers: str | None = Query(None, description="?쇳몴濡?援щ텇???곗빱 紐⑸줉 (?? BTC,ETH,SOL)"),
    symbols: str | None = Query(None, description="tickers ?泥댁슜 ?뚯씪誘명꽣 (?? BTC,ETH,SOL)"),
):
    """
    ?щ윭 ?뷀샇?뷀룓 ?꾩옱媛 ?쇨큵 議고쉶 (Upbit)
    - tickers: ?쇳몴濡?援щ텇???곗빱 紐⑸줉 (?? BTC,ETH,SOL)
    """
    raw_tickers = tickers or symbols
    if not raw_tickers:
        raise HTTPException(status_code=422, detail="tickers or symbols query parameter is required")

    ticker_list = [t.strip() for t in raw_tickers.split(",") if t.strip()]
    results = []

    for ticker in ticker_list:
        try:
            symbol = normalize_symbol(ticker)
            cached = await get_cached_price(symbol)
            if cached:
                cached_asset_type = str(cached.get("asset_type", "")).lower()
                cached_currency = str(cached.get("currency", "")).upper()
                is_crypto_cache = cached_asset_type in ("", "crypto")
                is_krw_or_unknown = cached_currency in ("", "KRW")
                if is_crypto_cache and is_krw_or_unknown:
                    data = {
                        "ticker": f"KRW-{symbol}",
                        "price": cached.get("price"),
                        "change_percent": cached.get("change_percent", 0),
                        "volume": cached.get("volume", 0),
                        "updated_at": cached.get("timestamp") or cached.get("cached_at"),
                        "asset_type": "crypto",
                        "currency": "KRW",
                        "source": "cache",
                    }
                else:
                    data = await crypto_client.get_current_price(ticker)
            else:
                data = await crypto_client.get_current_price(ticker)
            data.setdefault("asset_type", "crypto")
            data.setdefault("currency", "KRW")
            results.append(data)
        except Exception as e:
            results.append({"ticker": ticker, "error": str(e)})

    return {"prices": results, "count": len(results)}


@router.get("/prices/stocks")
async def get_multiple_stock_prices(symbols: str = Query(..., description="?쇳몴濡?援щ텇??醫낅ぉ肄붾뱶 紐⑸줉")):
    """
    ?щ윭 二쇱떇 ?꾩옱媛 ?쇨큵 議고쉶 (KIS)
    - symbols: ?쇳몴濡?援щ텇??醫낅ぉ肄붾뱶 紐⑸줉 (援?궡: 005930, ?댁쇅: AAPL)
    """
    symbol_list = [s.strip() for s in symbols.split(",") if s.strip()]
    results = []

    for symbol in symbol_list:
        try:
            upper_sym = symbol.strip().upper()
            # 통화 코드는 환율로 처리
            if upper_sym in CURRENCY_CODES:
                if upper_sym == "KRW":
                    results.append({"code": upper_sym, "price": 1.0, "currency": "KRW", "source": "exchange_rate"})
                else:
                    rate = await get_exchange_rate(upper_sym, "KRW")
                    results.append({"code": upper_sym, "price": rate, "currency": "KRW", "source": "exchange_rate"})
                continue

            cached = await get_cached_price(upper_sym)
            if _extract_positive_price(cached) is not None:
                results.append(_build_stock_price_from_cache(upper_sym, cached))
                continue

            # 숫자 6자리면 국내, 아니면 해외로 간주
            if symbol.isdigit() and len(symbol) == 6:
                data = await kis_client.get_current_price(symbol, market="KR")
                await cache_set_with_last_good(f"price:{upper_sym}", json.dumps(data))
            else:
                raw_data = await kis_client.get_current_price(symbol, market="US")
                await cache_set_with_last_good(f"price:{upper_sym}", json.dumps(raw_data))
                data = raw_data
                data = await _convert_to_krw(data)
            if _extract_positive_price(data) is None:
                raise ValueError("stock price unavailable")
            results.append(data)
        except Exception as e:
            results.append({"code": symbol, "error": str(e)})

    return {"prices": results, "count": len(results)}


@router.get("/exchange-rate")
async def get_exchange_rate_api(
    from_currency: str = Query("USD", alias="from"),
    to_currency: str = Query("KRW", alias="to"),
):
    """환율 조회 (예: /api/v1/market/exchange-rate?from=USD&to=KRW)"""
    try:
        rate = await get_exchange_rate(from_currency.upper(), to_currency.upper())
        return {"from": from_currency.upper(), "to": to_currency.upper(), "rate": rate}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
async def get_market_status():
    """
    시장 데이터/캔들 엔진 상태 요약 조회
    """
    now_dt = datetime.now(timezone.utc)
    now = now_dt.isoformat()

    redis_client = get_redis()
    targets = _status_symbol_targets()
    stock_threshold = max(60, int(os.getenv("MAX_TICK_AGE_SECONDS_STOCK", "900")))
    crypto_threshold = max(60, int(os.getenv("MAX_TICK_AGE_SECONDS_CRYPTO", "180")))

    candle_items: list[dict[str, Any]] = []
    stale_symbols: list[str] = []
    symbols_with_data = 0
    max_lag_seconds = 0

    if redis_client is not None and targets:
        keys = [f"candles:{symbol}:1m:current" for symbol, _ in targets]
        try:
            values = await redis_client.mget(keys)
            for idx, raw in enumerate(values):
                symbol, asset_type = targets[idx]
                if not raw:
                    candle_items.append(
                        {
                            "symbol": symbol,
                            "asset_type": asset_type,
                            "has_data": False,
                            "lag_seconds": None,
                            "stale": True,
                            "threshold_seconds": stock_threshold if asset_type == "stock" else crypto_threshold,
                        }
                    )
                    stale_symbols.append(symbol)
                    continue

                try:
                    payload = json.loads(raw)
                except Exception:
                    candle_items.append(
                        {
                            "symbol": symbol,
                            "asset_type": asset_type,
                            "has_data": False,
                            "lag_seconds": None,
                            "stale": True,
                            "threshold_seconds": stock_threshold if asset_type == "stock" else crypto_threshold,
                            "error": "invalid_payload",
                        }
                    )
                    stale_symbols.append(symbol)
                    continue

                ts = _parse_iso_datetime(payload.get("updated_at")) or _parse_iso_datetime(payload.get("date"))
                bucket_start = int(payload.get("bucket_start", 0) or 0)
                if ts is None and bucket_start > 0:
                    ts = datetime.fromtimestamp(bucket_start, tz=timezone.utc)
                lag_seconds = None
                if ts is not None:
                    lag_seconds = max(0, int((now_dt - ts).total_seconds()))
                    max_lag_seconds = max(max_lag_seconds, lag_seconds)

                threshold = stock_threshold if asset_type == "stock" else crypto_threshold
                stale = lag_seconds is None or lag_seconds > threshold
                if stale:
                    stale_symbols.append(symbol)

                symbols_with_data += 1
                candle_items.append(
                    {
                        "symbol": symbol,
                        "asset_type": asset_type,
                        "has_data": True,
                        "lag_seconds": lag_seconds,
                        "stale": stale,
                        "threshold_seconds": threshold,
                        "updated_at": payload.get("updated_at"),
                        "bucket_start": bucket_start,
                    }
                )
        except Exception as e:
            logger.warning("market status candle monitor failed: %s", e)

    status_level = "healthy"
    if redis_client is None:
        status_level = "degraded"
    elif stale_symbols:
        status_level = "degraded"

    return {
        "priceUpdate": now,
        "newsUpdate": now,
        "aiUpdate": now,
        "status": status_level,
        "candle_monitor": {
            "redis_connected": redis_client is not None,
            "symbols_checked": len(targets),
            "symbols_with_data": symbols_with_data,
            "stale_count": len(stale_symbols),
            "stale_symbols": stale_symbols,
            "max_lag_seconds": max_lag_seconds,
            "threshold_seconds": {
                "stock": stock_threshold,
                "crypto": crypto_threshold,
            },
            "items": candle_items,
        },
    }


@router.get("/indices")
async def get_market_indices():
    """홈페이지 공개 시장 지수 카드용 요약 데이터."""
    return await _build_public_indices_payload()


@router.get("/insights")
async def get_market_insights():
    """홈페이지 시장 브리핑 카드용 간단 인사이트."""
    payload = await _build_public_indices_payload()
    item_map = {item.get("id"): item for item in payload.get("items", []) if isinstance(item, dict)}

    cards = [
        _build_index_brief_card(
            item_map.get("kospi", _unavailable_index_item(PUBLIC_INDEX_TARGETS[0])),
            title="국내 증시 한줄 요약",
            positive_template="코스피가 {change_text} 흐름으로 마감하며 국내 증시 분위기가 상대적으로 견조합니다. 현재 상태는 {status} 기준입니다.",
            negative_template=(
                "코스피가 {change_text} 움직이며 국내 증시가 눌린 모습입니다. "
                "추격 매수보다는 보유 비중 점검이 더 중요합니다. 현재 상태는 {status} 기준입니다."
            ),
            neutral_template="코스피 변동폭이 {change_text} 수준으로 크지 않아 국내 증시는 방향 탐색 구간에 가깝습니다. 현재 상태는 {status} 기준입니다.",
        ),
        _build_index_brief_card(
            item_map.get("sp500", _unavailable_index_item(PUBLIC_INDEX_TARGETS[1])),
            title="미국 대표 지수 흐름",
            positive_template="S&P 500이 {change_text} 움직이며 미국 대형주 전반의 투자 심리가 비교적 안정적인 편입니다. 현재 상태는 {status} 기준입니다.",
            negative_template="S&P 500이 {change_text}로 밀리면서 미국 시장 전반의 위험 선호가 다소 약해진 상태입니다. 현재 상태는 {status} 기준입니다.",
            neutral_template="S&P 500 변동폭이 {change_text} 수준이라 미국 대표 지수는 뚜렷한 방향성보다 관망 흐름에 가깝습니다. 현재 상태는 {status} 기준입니다.",
        ),
        _build_index_brief_card(
            item_map.get("nasdaq100", _unavailable_index_item(PUBLIC_INDEX_TARGETS[2])),
            title="기술주 온도 체크",
            positive_template=(
                "나스닥100이 {change_text} 흐름으로 기술주가 상대적으로 강한 날입니다. "
                "성장주 선호 심리가 유지되는지 함께 보는 게 좋습니다. 현재 상태는 {status} 기준입니다."
            ),
            negative_template=(
                "나스닥100이 {change_text} 움직이며 기술주 변동성이 커진 모습입니다. "
                "레버리지나 고변동 자산은 보수적으로 접근하는 편이 낫습니다. 현재 상태는 {status} 기준입니다."
            ),
            neutral_template=(
                "나스닥100 변동폭이 {change_text} 수준이라 기술주는 아직 뚜렷한 방향보다 "
                "숨 고르기 구간으로 볼 수 있습니다. 현재 상태는 {status} 기준입니다."
            ),
        ),
    ]

    return {
        "generatedAt": payload["generatedAt"],
        "cacheHit": any(str(item.get("source")) in {"cache", "last_good"} for item in payload.get("items", [])),
        "cards": cards,
    }


@router.websocket("/ws")
async def market_price_ws(
    websocket: WebSocket,
):
    """
    실시간 시세 스트림(WebSocket)

    - 연결 URL 예시: /api/v1/market/ws?symbols=005930,AAPL,BTC&interval_ms=2000
    - 메시지(선택):
      {"action":"subscribe","symbols":["TSLA","ETH"]}
      {"action":"unsubscribe","symbols":["AAPL"]}
      {"action":"set","symbols":["005930","BTC"]}
      {"action":"ping"}
    """
    params = websocket.query_params
    symbols = parse_symbol_list(params.get("symbols"))

    try:
        interval_ms = int(params.get("interval_ms", "2000"))
    except ValueError:
        interval_ms = 2000
    interval_sec = max(0.5, min(interval_ms / 1000.0, 30.0))

    await websocket.accept()
    await websocket.send_json(
        {
            "type": "connected",
            "symbols": sorted(symbols),
            "interval_ms": int(interval_sec * 1000),
        }
    )

    try:
        while True:
            # Handle client control message with timeout.
            try:
                message = await asyncio.wait_for(websocket.receive_text(), timeout=interval_sec)
                try:
                    payload = json.loads(message)
                except json.JSONDecodeError:
                    await websocket.send_json({"type": "error", "message": "invalid json"})
                    continue

                action = str(payload.get("action", "")).lower()
                incoming = payload.get("symbols") or []
                incoming_set = {normalize_symbol(str(s)) for s in incoming if normalize_symbol(str(s))}

                if action == "subscribe":
                    symbols |= incoming_set
                    await websocket.send_json({"type": "subscribed", "symbols": sorted(symbols)})
                elif action == "unsubscribe":
                    symbols -= incoming_set
                    await websocket.send_json({"type": "subscribed", "symbols": sorted(symbols)})
                elif action == "set":
                    symbols = incoming_set
                    await websocket.send_json({"type": "subscribed", "symbols": sorted(symbols)})
                elif action == "ping":
                    await websocket.send_json({"type": "pong"})
                else:
                    await websocket.send_json({"type": "error", "message": "unknown action"})

            except asyncio.TimeoutError:
                # Periodic push interval
                pass

            if not symbols:
                await websocket.send_json({"type": "prices", "items": [], "ts": datetime.now(timezone.utc).isoformat()})
                continue

            tasks = [get_price_snapshot(sym) for sym in sorted(symbols)]
            items = await asyncio.gather(*tasks)
            await websocket.send_json(
                {
                    "type": "prices",
                    "items": items,
                    "ts": datetime.now(timezone.utc).isoformat(),
                }
            )

    except WebSocketDisconnect:
        logger.info("market websocket client disconnected")


@router.get("/history/{market_type}/{symbol}")
async def get_market_history(market_type: str, symbol: str, timeframe: str = "D", count: int = 30):
    """
    ?쒖옣 ?곗씠???대젰(OHLCV) 議고쉶
    - market_type: stock, crypto
    - symbol: 醫낅ぉ肄붾뱶 ?먮뒗 ?곗빱
    - timeframe: D(?쇰큺), m(遺꾨큺) - 二쇱떇 / days, minutes/1 ??- 肄붿씤
    """
    if market_type == "stock":
        # Stock (KIS) timeframe mapping.
        normalized_symbol = normalize_symbol(symbol)
        minute_unit = _timeframe_to_minute_unit(timeframe)
        if minute_unit > 0:
            cached_history = await _get_cached_intraday_history(normalized_symbol, timeframe, count)
            if cached_history:
                return {
                    "code": normalized_symbol or symbol,
                    "history": cached_history,
                    "market": "US" if _is_overseas_stock(normalized_symbol) else "KR",
                    "source": "candle_aggregator",
                    "timeframe": timeframe,
                }

        kis_tf = timeframe
        actual_count = count
        year_count = max(1, min(count, 30))
        is_yearly = timeframe == "Y"

        if timeframe == "Y":
            # KIS does not provide yearly candles directly.
            # Fetch monthly candles and aggregate to yearly OHLCV.
            kis_tf = "M"
            actual_count = year_count * 12

        res = await kis_client.get_historical_data(symbol, timeframe=kis_tf, count=actual_count)

        if is_yearly and isinstance(res, dict) and isinstance(res.get("history"), list):
            res["history"] = _aggregate_yearly_ohlcv(res.get("history", []), year_count)

        history = res.get("history") if isinstance(res, dict) else []
        is_minute_tf = kis_tf not in ("D", "W", "M")

        # V1: 주식 분봉(1/5/60)은 mock fallback을 만들지 않는다.
        # 실데이터가 없으면 빈 배열 + 안내 메시지를 그대로 반환한다.
        if (not history or len(history) == 0) and is_minute_tf:
            is_overseas_intraday = _is_overseas_stock(normalized_symbol)
            if is_overseas_intraday:
                if _is_us_regular_session_open():
                    no_data_reason = "overseas_intraday_vendor_delay_or_unavailable"
                    message = "해외 분봉 데이터 없음(벤더 지연/미지원)"
                else:
                    no_data_reason = "overseas_market_closed"
                    message = "미국 정규장 외 시간/분봉 데이터 없음"
            else:
                no_data_reason = "intraday_unavailable_or_market_closed"
                message = "장시간 외/분봉 데이터 없음"

            logger.info("KIS %s minute history empty; return no-data message (no mock)", symbol)
            return {
                "code": symbol,
                "history": [],
                "market": res.get("market", "KR") if isinstance(res, dict) else "KR",
                "mock": False,
                "no_data_reason": no_data_reason,
                "message": message,
            }

        # Sandbox?먯꽌 鍮?媛믪씠 ??寃쎌슦瑜??鍮꾪븳 Mock Fallback
        if not history or len(history) == 0:
            if not settings.DEBUG:
                raise HTTPException(status_code=503, detail="시세 데이터를 가져올 수 없습니다")
            from datetime import datetime, timedelta
            import random
            logger.warning("KIS %s history empty; providing mock fallback", symbol)
            mock_history = []
            # ?꾩옱媛 API?먯꽌 湲곗? 媛寃?議고쉶 (?ъ씠?쒕컮? ?쇱튂?쒗궎湲??꾪빐)
            try:
                market = "KR" if symbol.isdigit() and len(symbol) == 6 else "US"
                current = await kis_client.get_current_price(symbol, market=market)
                base_p = float(current.get("price", 0))
                if base_p <= 0:
                    base_p = 75000 if symbol == "005930" else 300
            except Exception:
                base_p = 75000 if symbol == "005930" else 300
            # ?꾩옱媛 ??怨쇨굅 諛⑺뼢?쇰줈 ??궛?섏뿬 留덉?留??곗씠??= ?꾩옱媛
            prices = [base_p]
            for i in range(actual_count - 1):
                change = prices[-1] * random.uniform(-0.015, 0.015)
                prices.append(prices[-1] - change)
            prices.reverse()  # 怨쇨굅?믫쁽???쒖꽌

            is_minute_tf = kis_tf not in ("D", "W", "M")
            minute_step = 1
            if is_minute_tf:
                try:
                    minute_step = max(1, int(kis_tf))
                except (TypeError, ValueError):
                    minute_step = 1

            for i in range(actual_count):
                if is_minute_tf:
                    date = (
                        datetime.now() - timedelta(minutes=(actual_count - i) * minute_step)
                    ).strftime("%Y-%m-%dT%H:%M:%S")
                elif kis_tf == "W":
                    date = (datetime.now() - timedelta(weeks=actual_count - i)).strftime("%Y-%m-%d")
                elif kis_tf == "M":
                    date = (datetime.now() - timedelta(days=(actual_count - i) * 30)).strftime("%Y-%m-%d")
                else:
                    date = (datetime.now() - timedelta(days=actual_count - i)).strftime("%Y-%m-%d")
                p = prices[i]
                mock_history.append({
                    "date": date,
                    "open": round(p * random.uniform(0.995, 1.005), 2),
                    "high": round(p * random.uniform(1.005, 1.015), 2),
                    "low": round(p * random.uniform(0.985, 0.995), 2),
                    "close": round(p, 2),
                    "volume": random.randint(1000, 100000)
                })

            if is_yearly:
                mock_history = _aggregate_yearly_ohlcv(mock_history, year_count)

            return {"code": symbol, "history": mock_history, "mock": True}
        return res
    elif market_type == "crypto":
        # Upbit timeframe mapping.
        normalized_symbol = normalize_symbol(symbol)
        minute_unit = _timeframe_to_minute_unit(timeframe)
        if minute_unit > 0:
            cached_history = await _get_cached_intraday_history(normalized_symbol, timeframe, count)
            if cached_history:
                return {
                    "ticker": f"KRW-{normalized_symbol}",
                    "history": cached_history,
                    "source": "candle_aggregator",
                    "timeframe": timeframe,
                }

        actual_count = count
        year_count = max(1, min(count, 30))
        is_yearly = timeframe == "Y"

        if timeframe == "D" or timeframe == "days":
            upbit_tf = "days"
        elif timeframe == "W" or timeframe == "weeks":
            upbit_tf = "weeks"
        elif timeframe == "M" or timeframe == "months":
            upbit_tf = "months"
        elif timeframe == "Y":
            upbit_tf = "months"
            actual_count = year_count * 12
        elif timeframe == "m" or timeframe == "minutes":
            upbit_tf = "minutes/1"
        elif timeframe.startswith("minutes/"):
            upbit_tf = timeframe
        elif timeframe.isdigit():
            upbit_tf = f"minutes/{timeframe}"
        else:
            upbit_tf = "days"

        res = await crypto_client.get_historical_data(symbol, timeframe=upbit_tf, count=actual_count)
        if is_yearly and isinstance(res, dict) and isinstance(res.get("history"), list):
            res["history"] = _aggregate_yearly_ohlcv(res.get("history", []), year_count)
        return res
    else:
        raise HTTPException(status_code=400, detail="Invalid market type")
