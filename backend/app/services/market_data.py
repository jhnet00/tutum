import logging
"""
============================================
Market Data Service
============================================

?쒓뎅?ъ옄利앷텒(KIS) 諛?Upbit API ?곕룞???대떦?⑸땲??
- KIS: 援?궡/?댁쇅 二쇱떇 ?쒖꽭 (Access Token 愿由??ы븿)
- Upbit: ?뷀샇?뷀룓 ?쒖꽭 (CCXT ?ъ슜)
"""

import httpx
import asyncio
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import HTTPException

try:
    import ccxt.async_support as ccxt
except ImportError:
    ccxt = None


import os
import json
from pathlib import Path
from ..config import get_settings
from ..cache import cache_get, cache_set

settings = get_settings()
logger = logging.getLogger(__name__)
TOKEN_FILE = str(Path(__file__).resolve().parents[2] / ".cache" / ".kis_token")
KST = ZoneInfo("Asia/Seoul")


class KISClient:
    """KIS Open API client."""

    def __init__(self):
        self.base_url = (
            "https://openapivts.koreainvestment.com:29443"
            if settings.KIS_MODE == "virtual"
            else "https://openapi.koreainvestment.com:9443"
        )
        self.app_key = settings.KIS_APP_KEY
        self.app_secret = settings.KIS_APP_SECRET
        self.token = None
        self.token_expired_at = None
        self._token_lock = asyncio.Lock()

    async def _invalidate_token_cache(self):
        """Invalidate cached KIS token (memory/redis/file)"""
        self.token = None
        self.token_expired_at = None
        try:
            await cache_set("kis_access_token", "", expire_seconds=1)
        except Exception:
            pass
        try:
            if os.path.exists(TOKEN_FILE):
                os.remove(TOKEN_FILE)
        except Exception:
            pass

    async def _get_access_token(self):
        """접근 토큰 발급/갱신 (동시 요청 안전)"""
        now = datetime.now().timestamp()
        if self.token and self.token_expired_at and now < self.token_expired_at:
            return self.token

        async with self._token_lock:
            now = datetime.now().timestamp()
            if self.token and self.token_expired_at and now < self.token_expired_at:
                return self.token

            try:
                cached_data = await cache_get("kis_access_token")
                if cached_data:
                    data = json.loads(cached_data)
                    if now < data.get("expired_at", 0):
                        self.token = data["token"]
                        self.token_expired_at = data["expired_at"]
                        logger.info("KIS token restored (from Redis)")
                        return self.token
            except Exception as e:
                logger.warning("KIS Redis Cache Load Error: %s", e)

            if os.path.exists(TOKEN_FILE):
                try:
                    with open(TOKEN_FILE, "r") as f:
                        data = json.load(f)
                        if now < data.get("expired_at", 0):
                            self.token = data["token"]
                            self.token_expired_at = data["expired_at"]
                            logger.info("KIS token restored (from file)")
                            return self.token
                except Exception as e:
                    logger.warning("KIS File Cache Load Error: %s", e)

            url = f"{self.base_url}/oauth2/tokenP"
            headers = {"content-type": "application/json"}
            body = {
                "grant_type": "client_credentials",
                "appkey": self.app_key,
                "appsecret": self.app_secret,
            }

            async with httpx.AsyncClient(timeout=10.0) as client:
                try:
                    response = await client.post(url, headers=headers, json=body)
                    response.raise_for_status()
                    data = response.json()

                    new_token = data["access_token"]
                    expires_in = int(data.get("expires_in", 86400))
                    expired_at = now + expires_in - 60

                    self.token = new_token
                    self.token_expired_at = expired_at

                    cache_payload_dict = {"token": new_token, "expired_at": expired_at}
                    cache_payload_str = json.dumps(cache_payload_dict)

                    try:
                        await cache_set(
                            "kis_access_token", cache_payload_str, expire_seconds=expires_in
                        )
                    except Exception as e:
                        logger.warning("Kis Redis Cache Save Error: %s", e)

                    try:
                        with open(TOKEN_FILE, "w") as f:
                            json.dump(cache_payload_dict, f)
                    except Exception as e:
                        logger.warning("Failed to save KIS token to file: %s", e)

                    logger.info("New KIS token issued (expires_in=%s)", expires_in)
                    return self.token
                except Exception as e:
                    if settings.DEBUG:
                        logger.warning("KIS Token Error (Using Mock): %s", e)
                        return "MOCK_TOKEN"
                    logger.error("KIS Token Error: %s", e)
                    raise HTTPException(status_code=500, detail="증권사 API 연동 실패")

    async def get_current_price(self, code: str, market: str = "KR"):
        """????? ??? (???: KR, ???: US)"""
        headers = {
            "content-type": "application/json",
            "appkey": self.app_key,
            "appsecret": self.app_secret,
            "tr_id": "FHKST01010100"
            if market == "KR"
            else "HHDFS00000300",  # ???/??? TR ID ??? (???)
        }
        # Path & Params setup based on Market
        if market == "US":
            path = "/uapi/overseas-price/v1/quotations/price"
            params = {
                "AUTH": "",
                "EXCD": "NAS",  # default; will retry with NYS/AMS if needed
                "SYMB": code,
            }
        else:
            path = "/uapi/domestic-stock/v1/quotations/inquire-price"
            params = {"fid_cond_mrkt_div_code": "J", "fid_input_iscd": code}

        # Mock Mode for initial dev without keys
        if not self.app_key:
            return {"code": code, "price": 75000, "change": 1.5}

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                for attempt in range(2):
                    token = await self._get_access_token()
                    headers["authorization"] = f"Bearer {token}"
                    if market == "US":
                        exch_list = ["NAS", "NYS", "AMS"]
                    else:
                        exch_list = [None]

                    data = None
                    for ex in exch_list:
                        req_params = dict(params)
                        if ex:
                            req_params["EXCD"] = ex
                        response = await client.get(
                            f"{self.base_url}{path}", headers=headers, params=req_params
                        )
                        data = response.json()
                        logger.debug("KIS response: %s", data)

                        if data.get("msg_cd") == "EGW00121" and attempt == 0:
                            # invalid token; retry after invalidation
                            break

                        output = data.get("output", {})
                        price = output.get("stck_prpr") or output.get("last")
                        if price:
                            break

                    # Invalid token -> invalidate cache and retry once
                    if data and data.get("msg_cd") == "EGW00121" and attempt == 0:
                        await self._invalidate_token_cache()
                        continue

                    output = (data or {}).get("output", {})
                    # KIS API: Domestic uses 'stck_prpr', Overseas uses 'last'
                    price = output.get("stck_prpr") or output.get("last")
                    return {
                        "code": code,
                        "price": float(price) if price else 0,
                        "change": float(output.get("prdy_vrss", 0)),
                        "raw": data,
                    }
            except Exception as e:
                logger.error("KIS API Error: %s", e)
                return {"code": code, "error": str(e)}

    async def _fetch_finnhub_intraday(
        self, symbol: str, minute_unit: int, count: int
    ) -> list[dict]:
        api_key = (settings.FINNHUB_API_KEY or "").strip()
        if not api_key:
            return []

        resolution = str(minute_unit if minute_unit in (1, 5, 15, 30, 60) else 1)
        to_ts = int(datetime.now(timezone.utc).timestamp())
        lookback_minutes = max(count * minute_unit + 60, 180)
        from_ts = to_ts - lookback_minutes * 60

        url = "https://finnhub.io/api/v1/stock/candle"
        params = {
            "symbol": symbol.upper(),
            "resolution": resolution,
            "from": from_ts,
            "to": to_ts,
            "token": api_key,
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
            if resp.status_code != 200:
                logger.debug("Finnhub intraday status=%s symbol=%s", resp.status_code, symbol)
                return []
            payload = resp.json()

        if payload.get("s") != "ok":
            logger.debug("Finnhub intraday no data symbol=%s payload=%s", symbol, payload.get("s"))
            return []

        t = payload.get("t") or []
        o = payload.get("o") or []
        h = payload.get("h") or []
        l = payload.get("l") or []
        c = payload.get("c") or []
        v = payload.get("v") or []

        size = min(len(t), len(o), len(h), len(l), len(c), len(v))
        history: list[dict] = []
        for i in range(size):
            ts = int(t[i])
            dt_kst = datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(KST)
            history.append(
                {
                    "date": dt_kst.isoformat(timespec="seconds"),
                    "open": float(o[i]),
                    "high": float(h[i]),
                    "low": float(l[i]),
                    "close": float(c[i]),
                    "volume": float(v[i]),
                }
            )

        return history[-count:] if count > 0 else history

    async def _fetch_polygon_intraday(
        self, symbol: str, minute_unit: int, count: int
    ) -> list[dict]:
        api_key = (settings.POLYGON_API_KEY or "").strip()
        if not api_key:
            return []

        end_dt = datetime.now(timezone.utc)
        lookback_minutes = max(count * minute_unit + 120, 240)
        start_dt = end_dt - timedelta(minutes=lookback_minutes)

        url = (
            f"https://api.polygon.io/v2/aggs/ticker/{symbol.upper()}"
            f"/range/{minute_unit}/minute/{start_dt:%Y-%m-%d}/{end_dt:%Y-%m-%d}"
        )
        params = {"adjusted": "true", "sort": "asc", "limit": 50000, "apiKey": api_key}

        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(url, params=params)
            if resp.status_code != 200:
                logger.debug("Polygon intraday status=%s symbol=%s", resp.status_code, symbol)
                return []
            payload = resp.json()

        rows = payload.get("results") or []
        if not rows:
            return []

        history: list[dict] = []
        for row in rows:
            ts_ms = int(row.get("t", 0))
            if ts_ms <= 0:
                continue
            dt_kst = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).astimezone(KST)
            history.append(
                {
                    "date": dt_kst.isoformat(timespec="seconds"),
                    "open": float(row.get("o", 0)),
                    "high": float(row.get("h", 0)),
                    "low": float(row.get("l", 0)),
                    "close": float(row.get("c", 0)),
                    "volume": float(row.get("v", 0)),
                }
            )

        return history[-count:] if count > 0 else history

    async def _get_overseas_intraday_from_vendor(
        self, symbol: str, minute_unit: int, count: int
    ) -> tuple[list[dict], str]:
        vendor = (settings.STOCK_VENDOR or "auto").lower()
        errors: list[str] = []

        async def try_finnhub() -> tuple[list[dict], str]:
            try:
                rows = await self._fetch_finnhub_intraday(symbol, minute_unit, count)
                return rows, "finnhub"
            except Exception as exc:
                errors.append(f"finnhub:{exc}")
                return [], "finnhub"

        async def try_polygon() -> tuple[list[dict], str]:
            try:
                rows = await self._fetch_polygon_intraday(symbol, minute_unit, count)
                return rows, "polygon"
            except Exception as exc:
                errors.append(f"polygon:{exc}")
                return [], "polygon"

        candidates: list[str]
        if vendor == "finnhub":
            candidates = ["finnhub"]
        elif vendor == "polygon":
            candidates = ["polygon"]
        elif vendor == "mock":
            candidates = []
        else:
            candidates = ["finnhub", "polygon"]

        for item in candidates:
            if item == "finnhub":
                rows, source = await try_finnhub()
            else:
                rows, source = await try_polygon()
            if rows:
                return rows, source

        if errors:
            logger.debug("Overseas intraday vendor fallback failed symbol=%s errors=%s", symbol, errors)
        return [], "unavailable"

    async def get_historical_data(
        self, code: str, timeframe: str = "D", market: str = "KR", count: int = 200
    ):
        """Fetch OHLCV historical data."""
        token = await self._get_access_token()
        now_kst = datetime.now(KST)

        is_overseas = not (code.isdigit() and len(code) == 6) or market == "US"
        is_minute = timeframe not in ("D", "W", "M")
        minute_unit = 1
        if is_minute:
            try:
                minute_unit = max(1, int(timeframe))
            except (TypeError, ValueError):
                minute_unit = 1

        if is_overseas:
            if is_minute:
                # V3: 해외 분봉은 벤더(Finnhub/Polygon) fallback으로 조회
                vendor_history, vendor_source = await self._get_overseas_intraday_from_vendor(
                    code, minute_unit=minute_unit, count=count
                )
                if vendor_history:
                    return {
                        "code": code,
                        "history": vendor_history,
                        "market": "US",
                        "source": vendor_source,
                    }
                return {
                    "code": code,
                    "history": [],
                    "market": "US",
                    "error": "Overseas minute candles unavailable (vendor not configured or no data)",
                }

            # ?댁쇅 二쇱떇 ??二??붾큺
            gubn_map = {"D": "0", "W": "1", "M": "2"}
            tr_id = "HHDFS76240000"
            path = "/uapi/overseas-price/v1/quotations/dailyprice"
            params = {
                "AUTH": "",
                "EXCD": "NAS",
                "SYMB": code,
                "GUBN": gubn_map.get(timeframe, "0"),
                "BYMD": now_kst.strftime("%Y%m%d"),
                "MODP": "1",
            }
        else:
            # 援?궡 二쇱떇
            if is_minute:
                # 분봉 API (1분/5분/10분/30분/60분)
                tr_id = "FHKST03010200"
                path = "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice"
                # 조회 시간은 KST 기준으로 보정한다.
                query_time = now_kst.strftime("%H%M%S")
                params = {
                    "fid_cond_mrkt_div_code": "J",
                    "fid_input_iscd": code,
                    "fid_etc_cls_code": "",
                    "fid_pw_data_incu_yn": "N",
                    "fid_input_hour_1": query_time,
                }
            else:
                # ??二??붾큺 API
                tr_id = "FHKST03010100"
                path = "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice"
                end_date = now_kst.strftime("%Y%m%d")
                requested = max(1, int(count or 1))
                if timeframe == "M":
                    # monthly candles: expand lookback window by requested count
                    months_back = max(requested + 12, 60)
                    start_date = (now_kst - timedelta(days=months_back * 30)).strftime("%Y%m%d")
                elif timeframe == "W":
                    # weekly candles
                    weeks_back = max(requested + 12, 104)
                    start_date = (now_kst - timedelta(weeks=weeks_back)).strftime("%Y%m%d")
                else:
                    # daily candles
                    days_back = max(requested + 30, 365)
                    start_date = (now_kst - timedelta(days=days_back)).strftime("%Y%m%d")
                params = {
                    "fid_cond_mrkt_div_code": "J",
                    "fid_input_iscd": code,
                    "fid_input_date_1": start_date,
                    "fid_input_date_2": end_date,
                    "fid_period_div_code": timeframe,
                    "fid_org_adj_prc": "1",
                }

        headers = {
            "content-type": "application/json",
            "authorization": f"Bearer {token}",
            "appkey": self.app_key,
            "appsecret": self.app_secret,
            "tr_id": tr_id,
            "custtype": "P",
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                if is_overseas:
                    # ?댁쇅: ?щ윭 嫄곕옒???쒕룄 (NAS ??NYS ??AMS)
                    exch_list = ["NAS", "NYS", "AMS"]
                    data = {}
                    for excd in exch_list:
                        params["EXCD"] = excd
                        response = await client.get(
                            f"{self.base_url}{path}", headers=headers, params=params
                        )
                        if not response.text.strip():
                            logger.warning("KIS history empty response (%s, EXCD=%s, status=%s, url=%s)", code, excd, response.status_code, response.url)
                            continue
                        data = response.json()
                        output2 = data.get("output2", [])
                        logger.debug("KIS History ({code}, EXCD={excd}): rt_cd={data.get('rt_cd')}, msg={data.get('msg1','')[:60]}, rows=%s", len(output2))
                        if output2:
                            break
                else:
                    response = await client.get(
                        f"{self.base_url}{path}", headers=headers, params=params
                    )
                    if not response.text.strip():
                        logger.warning("KIS history empty response (%s, tf=%s)", code, timeframe)
                        return {
                            "code": code,
                            "history": [],
                            "market": "KR",
                            "error": "Empty response from KIS history endpoint",
                        }
                    data = response.json()
                    logger.debug("KIS History ({code}, tf={timeframe}): rt_cd={data.get('rt_cd')}, msg={data.get('msg1','')[:60]}, rows=%s", len(data.get('output2', [])))

                history = []
                if is_overseas:
                    for item in data.get("output2", []):
                        history.append({
                            "date": f"{item['xymd'][:4]}-{item['xymd'][4:6]}-{item['xymd'][6:]}",
                            "open": float(item["open"]),
                            "high": float(item["high"]),
                            "low": float(item["low"]),
                            "close": float(item["clos"]),
                            "volume": float(item["tvol"]),
                        })
                else:
                    items = data.get("output2", [])
                    if items:
                        logger.debug("KIS domestic first item keys: %s", list(items[0].keys()))
                    for item in items:
                        if is_minute:
                            # 분봉: stck_bsop_date + stck_cntg_hour 를 KST ISO datetime으로 변환
                            date_part = str(item.get("stck_bsop_date", now_kst.strftime("%Y%m%d")))
                            time_part = str(item.get("stck_cntg_hour", "000000")).zfill(6)
                            try:
                                dt_kst = datetime.strptime(
                                    f"{date_part}{time_part}", "%Y%m%d%H%M%S"
                                ).replace(tzinfo=KST)
                                formatted_date = dt_kst.isoformat(timespec="seconds")
                            except ValueError:
                                formatted_date = (
                                    f"{date_part[:4]}-{date_part[4:6]}-{date_part[6:]}"
                                    f"T{time_part[:2]}:{time_part[2:4]}:{time_part[4:6]}"
                                )
                        else:
                            # ??二??붾큺: YYYYMMDD ??YYYY-MM-DD
                            date_str = item.get("stck_bsop_date", "")
                            formatted_date = (
                                f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
                                if date_str and len(date_str) == 8
                                else date_str
                            )
                        # 분봉: stck_prpr(현재가), cntg_vol(체결량)
                        # 일봉: stck_clpr(종가), acml_vol(누적거래량)
                        close_key = "stck_prpr" if is_minute else "stck_clpr"
                        vol_key = "cntg_vol" if is_minute else "acml_vol"
                        history.append({
                            "date": formatted_date,
                            "open": float(item.get("stck_oprc", 0)),
                            "high": float(item.get("stck_hgpr", 0)),
                            "low": float(item.get("stck_lwpr", 0)),
                            "close": float(item.get(close_key, 0)),
                            "volume": float(item.get(vol_key, 0)),
                        })

                # Convert to chronological order.
                history = history[::-1]

                # KIS domestic minute endpoint is effectively 1-minute stream.
                # Aggregate to requested bucket (e.g., 5/60) so each timeframe differs.
                if is_minute and minute_unit > 1 and history:
                    aggregated = []
                    current = None
                    for row in history:
                        dt = datetime.fromisoformat(str(row.get("date", "")))
                        bucket_dt = dt.replace(
                            minute=(dt.minute // minute_unit) * minute_unit,
                            second=0,
                            microsecond=0,
                        )
                        bucket_key = bucket_dt.isoformat(timespec="seconds")

                        if current is None or current["date"] != bucket_key:
                            if current is not None:
                                aggregated.append(current)
                            current = {
                                "date": bucket_key,
                                "open": float(row.get("open", 0)),
                                "high": float(row.get("high", 0)),
                                "low": float(row.get("low", 0)),
                                "close": float(row.get("close", 0)),
                                "volume": float(row.get("volume", 0)),
                            }
                        else:
                            current["high"] = max(current["high"], float(row.get("high", 0)))
                            current["low"] = min(current["low"], float(row.get("low", 0)))
                            current["close"] = float(row.get("close", 0))
                            current["volume"] += float(row.get("volume", 0))

                    if current is not None:
                        aggregated.append(current)
                    history = aggregated

                if count and count > 0 and len(history) > count:
                    history = history[-count:]

                return {
                    "code": code,
                    "history": history,
                    "market": "US" if is_overseas else "KR",
                }
            except Exception as e:
                logger.error("KIS History API Error ({code}): %s", e)
                return {"code": code, "error": str(e), "history": []}


class CryptoClient:
    """Upbit 吏곸젒 ?몄텧 ?대씪?댁뼵??(ccxt ???httpx ?ъ슜)"""

    def __init__(self):
        self.base_url = "https://api.upbit.com/v1"
        self.access_key = settings.UPBIT_ACCESS_KEY
        self.secret_key = settings.UPBIT_SECRET_KEY

    async def get_current_price(self, ticker: str = "KRW-BTC"):
        """Upbit ?쒖꽭 議고쉶 (Public API ?곗꽑)"""
        # ?곗빱 ?뺤떇 蹂댁젙 (BTC/KRW -> KRW-BTC)
        ticker_formatted = ticker.replace("/", "-")
        if "-" not in ticker_formatted:
            ticker_formatted = f"KRW-{ticker_formatted}"

        url = f"{self.base_url}/ticker"
        params = {"markets": ticker_formatted}

        async with httpx.AsyncClient(timeout=5.0) as client:
            try:
                response = await client.get(url, params=params)

                # Upbit Public API?????놁씠??議고쉶媛 媛?ν븿
                if response.status_code == 200:
                    data = response.json()
                    if not data:
                        raise ValueError(f"No data for ticker: {ticker_formatted}")

                    ticker_data = data[0]
                    return {
                        "ticker": ticker_formatted,
                        "price": float(ticker_data["trade_price"]),
                        "change_percent": float(ticker_data["signed_change_rate"])
                        * 100,
                        "volume": float(ticker_data["acc_trade_volume_24h"]),
                        "updated_at": datetime.fromtimestamp(
                            ticker_data["timestamp"] / 1000
                        ).isoformat(),
                    }
                else:
                    error_data = response.json()
                    raise Exception(f"Upbit API Error: {error_data}")

            except Exception as e:
                logger.error("Upbit API Error Details: %s", e)
                # Fallback: API ?ㅺ? ?녿뒗 媛쒕컻 ?섍꼍??紐⑥쓽 ?곗씠??
                if not self.access_key or settings.DEBUG:
                    return {
                        "ticker": ticker_formatted,
                        "price": 100000000.0 if "BTC" in ticker_formatted else 50000.0,
                        "mock": True,
                        "note": "Upbit API ?곌껐 ?ㅽ뙣 ?먮뒗 媛쒕컻 紐⑤뱶",
                    }
                raise HTTPException(
                    status_code=500, detail=f"Upbit Service Unavailable: {str(e)}"
                )

    async def get_historical_data(
        self, ticker: str = "KRW-BTC", timeframe: str = "days", count: int = 30
    ):
        """Fetch Upbit OHLCV historical data."""
        ticker_formatted = ticker.replace("/", "-")
        if "-" not in ticker_formatted:
            ticker_formatted = f"KRW-{ticker_formatted}"

        # timeframe: days, minutes/1, minutes/60 ??
        path = f"/candles/{timeframe}"
        url = f"{self.base_url}{path}"
        params = {"market": ticker_formatted, "count": count}

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(url, params=params)
                if response.status_code == 200:
                    data = response.json()
                    history = []
                    for item in data:
                        history.append(
                            {
                                "date": item["candle_date_time_kst"],
                                "open": float(item["opening_price"]),
                                "high": float(item["high_price"]),
                                "low": float(item["low_price"]),
                                "close": float(item["trade_price"]),
                                "volume": float(item["candle_acc_trade_volume"]),
                            }
                        )
                    return {"ticker": ticker_formatted, "history": history[::-1]}
                else:
                    return {
                        "ticker": ticker_formatted,
                        "error": response.text,
                        "history": [],
                    }
            except Exception as e:
                logger.error("Upbit History API Error: %s", e)
                return {"ticker": ticker_formatted, "error": str(e), "history": []}


# Singleton Instances
kis_client = KISClient()
crypto_client = CryptoClient()


async def get_exchange_rates():
    """
    二쇱슂 ?듯솕 ?섏쑉 議고쉶 (Base: KRW)
    - 諛섑솚: {"USD": 1450.0, "JPY": 9.5, "CNY": 200.0, "EUR": 1550.0}
    """
    # 1. Redis 罹먯떆 ?뺤씤 (1?쒓컙)
    cache_key = "market:exchange_rates"
    try:
        cached_data = await cache_get(cache_key)
        if cached_data:
            return json.loads(cached_data)
    except Exception as e:
        logger.warning("Cache Error: %s", e)

    # Fallback Values
    fallback_rates = {
        "USD": 1450.0,
        "JPY": 9.5,  # 1??湲곗?
        "CNY": 200.0,
        "EUR": 1550.0,
        "GBP": 1800.0,
    }

    # 2. ?몃? API ?몄텧 (Open Exchange Rate API - USD Base)
    url = "https://open.er-api.com/v6/latest/USD"

    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            response = await client.get(url)
            if response.status_code == 200:
                data = response.json()
                rates = data.get("rates", {})

                usd_to_krw = rates.get("KRW", 1450.0)
                usd_to_jpy = rates.get("JPY", 150.0)
                usd_to_cny = rates.get("CNY", 7.2)
                usd_to_eur = rates.get("EUR", 0.92)
                usd_to_gbp = rates.get("GBP", 0.79)

                # Cross Rate Calculation (X to KRW)
                # 1 USD = usd_to_krw KRW
                # 1 USD = usd_to_jpy JPY
                # -> 1 JPY = usd_to_krw / usd_to_jpy KRW

                new_rates = {
                    "USD": float(usd_to_krw),
                    "JPY": float(usd_to_krw / usd_to_jpy) if usd_to_jpy else fallback_rates["JPY"],
                    "CNY": float(usd_to_krw / usd_to_cny) if usd_to_cny else fallback_rates["CNY"],
                    "EUR": float(usd_to_krw / usd_to_eur) if usd_to_eur else fallback_rates["EUR"],
                    "GBP": float(usd_to_krw / usd_to_gbp) if usd_to_gbp else fallback_rates["GBP"],
                }

                # 3. 罹먯떆 ???
                await cache_set(cache_key, json.dumps(new_rates), expire_seconds=3600)
                return new_rates

        except Exception as e:
            logger.error("Exchange Rate API Error: %s", e)

    return fallback_rates




