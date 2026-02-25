import logging
import re
from datetime import datetime, timezone
from typing import Any, Iterable, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from pymongo import DESCENDING

from ..database import get_news_collection
from ..mariadb import get_user_portfolios
from .auth import UserResponse, get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

NEWS_TEXT_FIELDS = ("title", "body", "content", "description", "summary", "article", "text")
NEWS_BODY_FIELDS = ("body", "content", "description", "summary", "article", "text")
NEWS_SORT = [
    ("published_at_ts", DESCENDING),
    ("ingested_at", DESCENDING),
    ("_id", DESCENDING),
]

# Lightweight synonym map for common assets. The user's own asset name/code are always included.
ASSET_TERM_SYNONYMS: dict[str, tuple[str, ...]] = {
    "BTC": ("btc", "bitcoin", "KRW-BTC"),
    "ETH": ("eth", "ethereum", "KRW-ETH"),
    "XRP": ("xrp", "ripple", "KRW-XRP"),
    "SOL": ("sol", "solana", "KRW-SOL"),
    "NVDA": ("nvda", "nvidia", "엔비디아"),
    "TSLA": ("tsla", "tesla", "테슬라"),
    "AAPL": ("aapl", "apple", "애플"),
    "MSFT": ("msft", "microsoft", "마이크로소프트"),
    "GOOGL": ("googl", "google", "alphabet"),
    "AMZN": ("amzn", "amazon"),
    "005930": ("005930", "samsung", "samsung electronics", "\uc0bc\uc131\uc804\uc790"),
    "000660": ("000660", "hynix", "sk hynix", "\uc5d0\uc2a4\ucf00\uc774\ud558\uc774\ub2c9\uc2a4", "sk\ud558\uc774\ub2c9\uc2a4"),
    # Asset-name key fallback (when asset_code is absent or not normalized)
    "\uc0bc\uc131\uc804\uc790": ("005930", "samsung", "samsung electronics", "\uc0bc\uc131\uc804\uc790"),
    "sk\ud558\uc774\ub2c9\uc2a4": ("000660", "hynix", "sk hynix", "\uc5d0\uc2a4\ucf00\uc774\ud558\uc774\ub2c9\uc2a4", "sk\ud558\uc774\ub2c9\uc2a4"),
    "\uc5d0\uc2a4\ucf00\uc774\ud558\uc774\ub2c9\uc2a4": ("000660", "hynix", "sk hynix", "\uc5d0\uc2a4\ucf00\uc774\ud558\uc774\ub2c9\uc2a4", "sk\ud558\uc774\ub2c9\uc2a4"),
    "\uc560\ud50c": ("aapl", "apple", "\uc560\ud50c"),
    "\ub9c8\uc774\ud06c\ub85c\uc18c\ud504\ud2b8": ("msft", "microsoft", "\ub9c8\uc774\ud06c\ub85c\uc18c\ud504\ud2b8"),
}


class NewsItem(BaseModel):
    id: str
    title: str
    content: str
    source: str
    url: Optional[str]
    published_at: str
    section: Optional[str]


class PaginatedNewsResponse(BaseModel):
    items: List[NewsItem]
    total: int
    page: int
    limit: int
    total_pages: int


class RecommendedNewsResponse(BaseModel):
    items: List[NewsItem]
    recommended_assets: List[str]
    recommended_keywords: List[str]
    is_fallback: bool


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _build_base_filter() -> dict[str, Any]:
    return {
        "$and": [
            {"title": {"$exists": True, "$ne": ""}},
            {"$or": [{field: {"$exists": True, "$ne": ""}} for field in NEWS_BODY_FIELDS]},
        ]
    }


def _append_query_filter(query_filter: dict[str, Any], query: str) -> None:
    search_regex = {"$regex": re.escape(query), "$options": "i"}
    query_filter["$and"].append(
        {"$or": [{field: search_regex} for field in NEWS_TEXT_FIELDS]}
    )


def _to_timestamp(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, datetime):
        return value.timestamp()
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return 0.0
        if raw.endswith("Z"):
            raw = f"{raw[:-1]}+00:00"
        try:
            parsed = datetime.fromisoformat(raw)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.timestamp()
        except ValueError:
            return 0.0
    return 0.0


def _news_body_from_doc(doc: dict[str, Any]) -> str:
    for field in NEWS_BODY_FIELDS:
        value = doc.get(field)
        if isinstance(value, str) and value:
            return value
    return ""


def _to_news_item(doc: dict[str, Any]) -> NewsItem:
    published_at = doc.get("published_at")
    if isinstance(published_at, datetime):
        published_at_str = published_at.isoformat()
    else:
        published_at_str = str(published_at or "")

    return NewsItem(
        id=str(doc.get("_id", "")),
        title=_normalize_text(doc.get("title")),
        content=_news_body_from_doc(doc),
        source=_normalize_text(doc.get("source")) or "unknown",
        url=doc.get("link") or doc.get("url"),
        published_at=published_at_str,
        section=_normalize_text(doc.get("section")) or "general",
    )


async def _fetch_latest_items(news_col, limit: int) -> list[NewsItem]:
    cursor = news_col.find(_build_base_filter()).sort(NEWS_SORT).limit(limit)
    items: list[NewsItem] = []
    async for doc in cursor:
        items.append(_to_news_item(doc))
    return items


def _expand_asset_terms(asset_code: str, asset_name: str) -> list[str]:
    candidates: list[str] = []
    code = asset_code.strip().upper()
    name = asset_name.strip()

    if name:
        candidates.append(name)
    if code:
        candidates.append(code)
        if "-" in code:
            code_suffix = code.split("-")[-1]
            if code_suffix:
                candidates.append(code_suffix)

    synonym_keys = {code}
    if "-" in code:
        synonym_keys.add(code.split("-")[-1])
    if name:
        synonym_keys.add(name.lower())

    for key in synonym_keys:
        for synonym in ASSET_TERM_SYNONYMS.get(key, ()):
            candidates.append(synonym)

    deduped: list[str] = []
    seen: set[str] = set()
    for term in candidates:
        clean = term.strip()
        if len(clean) < 2:
            continue
        if not re.search(r"[A-Za-z0-9\uac00-\ud7a3]", clean):
            continue
        lowered = clean.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        deduped.append(clean)
    return deduped


def _build_portfolio_terms(
    portfolios: Iterable[Any],
    max_assets: int = 5,
    max_terms: int = 20,
) -> tuple[list[str], list[str]]:
    ranked_assets: list[tuple[float, str, str]] = []
    for item in portfolios:
        asset_code = _normalize_text(getattr(item, "asset_code", "")).upper()
        asset_name = _normalize_text(getattr(item, "asset_name", ""))
        if not asset_code and not asset_name:
            continue

        try:
            quantity = float(getattr(item, "quantity", 0) or 0)
        except (TypeError, ValueError):
            quantity = 0.0

        try:
            avg_buy_price = float(getattr(item, "avg_buy_price", 0) or 0)
        except (TypeError, ValueError):
            avg_buy_price = 0.0

        exposure = max(quantity, 0.0) * max(avg_buy_price, 0.0)
        if exposure <= 0:
            exposure = max(quantity, 0.0)

        ranked_assets.append((exposure, asset_code, asset_name))

    ranked_assets.sort(key=lambda row: row[0], reverse=True)

    recommended_assets: list[str] = []
    terms: list[str] = []
    seen_assets: set[str] = set()
    seen_terms: set[str] = set()

    for _, asset_code, asset_name in ranked_assets[:max_assets]:
        label = asset_name or asset_code
        label_key = label.lower()
        if label and label_key not in seen_assets:
            seen_assets.add(label_key)
            recommended_assets.append(label)

        for term in _expand_asset_terms(asset_code, asset_name):
            term_key = term.lower()
            if term_key in seen_terms:
                continue
            seen_terms.add(term_key)
            terms.append(term)
            if len(terms) >= max_terms:
                break

        if len(terms) >= max_terms:
            break

    return recommended_assets, terms


def _build_terms_filter(terms: list[str]) -> dict[str, Any]:
    query_filter = _build_base_filter()
    if not terms:
        return query_filter

    term_or_conditions: list[dict[str, Any]] = []
    for term in terms:
        regex = {"$regex": re.escape(term), "$options": "i"}
        term_or_conditions.extend([{field: regex} for field in NEWS_TEXT_FIELDS])

    query_filter["$and"].append({"$or": term_or_conditions})
    return query_filter


def _count_term_hits(doc: dict[str, Any], terms: list[str]) -> int:
    chunks: list[str] = []
    for field in NEWS_TEXT_FIELDS:
        value = doc.get(field)
        if isinstance(value, str) and value:
            chunks.append(value.lower())
    haystack = " ".join(chunks)
    if not haystack:
        return 0

    hits = 0
    for term in terms:
        if term.lower() in haystack:
            hits += 1
    return hits


@router.get("", response_model=PaginatedNewsResponse)
async def get_latest_news(
    query: Optional[str] = Query(None, description="Search query"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(5, ge=1, le=50, description="Page size"),
):
    news_col = get_news_collection()

    if news_col is None:
        return PaginatedNewsResponse(items=[], total=0, page=page, limit=limit, total_pages=0)

    try:
        query_filter = _build_base_filter()
        if query:
            _append_query_filter(query_filter, query)

        total = await news_col.count_documents(query_filter)
        total_pages = (total + limit - 1) // limit
        skip = (page - 1) * limit

        cursor = news_col.find(query_filter).sort(NEWS_SORT).skip(skip).limit(limit)
        items: list[NewsItem] = []
        async for doc in cursor:
            items.append(_to_news_item(doc))

        logger.info(
            "News API page=%s/%s items=%s query=%s",
            page,
            total_pages,
            len(items),
            bool(query),
        )

        return PaginatedNewsResponse(
            items=items,
            total=total,
            page=page,
            limit=limit,
            total_pages=total_pages,
        )
    except Exception as exc:
        logger.error("News API error: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to fetch news data")


@router.get("/recommended", response_model=RecommendedNewsResponse)
async def get_recommended_news(
    limit: int = Query(6, ge=1, le=20, description="Recommendation size"),
    current_user: UserResponse = Depends(get_current_user),
):
    news_col = get_news_collection()
    if news_col is None:
        return RecommendedNewsResponse(
            items=[],
            recommended_assets=[],
            recommended_keywords=[],
            is_fallback=True,
        )

    try:
        portfolios = await get_user_portfolios(int(current_user.id))
        recommended_assets, terms = _build_portfolio_terms(portfolios)

        if not terms:
            fallback_items = await _fetch_latest_items(news_col, limit)
            return RecommendedNewsResponse(
                items=fallback_items,
                recommended_assets=recommended_assets,
                recommended_keywords=[],
                is_fallback=True,
            )

        candidate_limit = max(limit * 6, 24)
        query_filter = _build_terms_filter(terms)
        cursor = news_col.find(query_filter).sort(NEWS_SORT).limit(candidate_limit)

        scored_docs: list[tuple[int, float, dict[str, Any]]] = []
        async for doc in cursor:
            hits = _count_term_hits(doc, terms)
            if hits <= 0:
                continue

            published_ts = (
                _to_timestamp(doc.get("published_at_ts"))
                or _to_timestamp(doc.get("published_at"))
                or _to_timestamp(doc.get("ingested_at"))
            )
            scored_docs.append((hits, published_ts, doc))

        if not scored_docs:
            fallback_items = await _fetch_latest_items(news_col, limit)
            return RecommendedNewsResponse(
                items=fallback_items,
                recommended_assets=recommended_assets,
                recommended_keywords=terms[:10],
                is_fallback=True,
            )

        # Keep portfolio-term filtering via hit-count, but return results in strict recency order.
        scored_docs.sort(key=lambda row: row[1], reverse=True)

        selected: list[NewsItem] = []
        seen_titles: set[str] = set()
        for _, _, doc in scored_docs:
            title_key = _normalize_text(doc.get("title")).lower()
            if not title_key or title_key in seen_titles:
                continue
            seen_titles.add(title_key)
            selected.append(_to_news_item(doc))
            if len(selected) >= limit:
                break

        if not selected:
            selected = await _fetch_latest_items(news_col, limit)
            return RecommendedNewsResponse(
                items=selected,
                recommended_assets=recommended_assets,
                recommended_keywords=terms[:10],
                is_fallback=True,
            )

        return RecommendedNewsResponse(
            items=selected,
            recommended_assets=recommended_assets,
            recommended_keywords=terms[:10],
            is_fallback=False,
        )
    except Exception as exc:
        logger.error("News recommendation API error: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to fetch recommended news")
