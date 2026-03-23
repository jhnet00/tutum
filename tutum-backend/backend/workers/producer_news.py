#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import json
import time
import random
from datetime import datetime, timezone, timedelta
from urllib.parse import urljoin, urlparse, parse_qs, quote_plus

import requests
from bs4 import BeautifulSoup
from kafka import KafkaProducer


NAVER_FINANCE_BASE = "https://finance.naver.com"
NAVER_FINANCE_MAINNEWS_URL = "https://finance.naver.com/news/mainnews.naver"
NAVER_NEWS_SEARCH_URL = "https://search.naver.com/search.naver"
COINNESS_BASE = os.getenv("COINNESS_BASE", "https://coinness.com")
COINNESS_ARTICLE_URL = os.getenv("COINNESS_ARTICLE_URL", f"{COINNESS_BASE}/article")
COINNESS_SITEMAP_URL = os.getenv("COINNESS_SITEMAP_URL", f"{COINNESS_BASE}/sitemap.xml")
COINNESS_API_BASE = os.getenv("COINNESS_API_BASE", "https://api.coinness.com")
EINFOMAX_BASE = os.getenv("EINFOMAX_BASE", "https://news.einfomax.co.kr")
EINFOMAX_ARTICLE_LIST_URL = os.getenv(
    "EINFOMAX_ARTICLE_LIST_URL",
    f"{EINFOMAX_BASE}/news/articleList.html",
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://finance.naver.com/news/",
    "Connection": "keep-alive",
}

GENERIC_ARTICLE_BODY_SELECTORS = (
    "[itemprop='articleBody']",
    "#articleBody",
    "#article-view-content-div",
    "#newsct_article",
    "#dic_area",
    ".article_body",
    ".article-body",
    ".articleBody",
    ".article-content",
    ".article_content",
    ".post-content",
    ".entry-content",
    ".news-content",
    ".news_text",
    ".article_txt",
    ".view_cont",
    ".view_conts",
    "main article",
    "article",
)

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
TOPIC = os.getenv("KAFKA_TOPIC", "news.raw")


def _env_raw(*keys: str) -> str | None:
    for key in keys:
        value = os.getenv(key)
        if value is not None and str(value).strip() != "":
            return str(value).strip()
    return None


def env_bool(*keys: str, default: bool = False) -> bool:
    value = _env_raw(*keys)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "y", "on"}


def env_int(*keys: str, default: int) -> int:
    value = _env_raw(*keys)
    if value is None:
        return default
    try:
        return int(value)
    except Exception:
        return default


# 하위 호환용 기본값: source별 limit이 없으면 LIMIT 사용
LIMIT = env_int("LIMIT", "PRODUCER_LIMIT", default=5)
PAGES = env_int("PAGES", "PRODUCER_PAGES", default=3)        # ✅ 여러 페이지 훑기
SEEN_FILE = os.getenv("SEEN_FILE", "/home/kafka/seen_finance_mainnews.json")
ENABLE_NAVER = env_bool("ENABLE_NAVER", default=True)
ENABLE_COINNESS = env_bool("ENABLE_COINNESS", default=True)
COINNESS_PAGES = env_int("COINNESS_PAGES", default=3)
COINNESS_SITEMAP_LIMIT = env_int("COINNESS_SITEMAP_LIMIT", default=120)
COINNESS_API_SECTION = os.getenv("COINNESS_API_SECTION", "latest")
COINNESS_API_CATEGORY_ID = os.getenv("COINNESS_API_CATEGORY_ID", "0")
COINNESS_API_LANGUAGE_CODE = os.getenv("COINNESS_API_LANGUAGE_CODE", "ko")
COINNESS_API_PAGE_LIMIT = env_int("COINNESS_API_PAGE_LIMIT", default=20)
NAVER_LIMIT = env_int("NAVER_LIMIT", default=LIMIT)
COINNESS_LIMIT = env_int("COINNESS_LIMIT", default=LIMIT)
EINFOMAX_LIMIT = env_int("EINFOMAX_LIMIT", default=LIMIT)
ENABLE_COIN_FALLBACK = env_bool("ENABLE_COIN_FALLBACK", default=False)
COIN_FALLBACK_LIMIT = env_int("COIN_FALLBACK_LIMIT", default=COINNESS_LIMIT)
COIN_FALLBACK_PAGES = env_int("COIN_FALLBACK_PAGES", default=2)
ENABLE_EINFOMAX = env_bool("ENABLE_EINFOMAX", default=False)
EINFOMAX_PAGES = env_int("EINFOMAX_PAGES", default=3)
EINFOMAX_QUERY = os.getenv("EINFOMAX_QUERY", "가상자산")
EINFOMAX_FILTER_COINS = env_bool("EINFOMAX_FILTER_COINS", default=True)
RUN_FOREVER = env_bool("RUN_FOREVER", "PRODUCER_RUN_FOREVER", default=False)
POLL_INTERVAL_SEC = env_int("POLL_INTERVAL_SEC", "PRODUCER_POLL_INTERVAL_SEC", default=60)
COIN_KEYWORDS = [
    kw.strip()
    for kw in os.getenv("COIN_KEYWORDS", "비트코인,이더리움,암호화폐,가상자산").split(",")
    if kw.strip()
]
COIN_FILTER_KEYWORDS = [
    kw.strip()
    for kw in os.getenv(
        "COIN_FILTER_KEYWORDS",
        "코인,비트코인,이더리움,암호화폐,가상자산,디지털자산,가상화폐,거래소,빗썸,업비트",
    ).split(",")
    if kw.strip()
]

session = requests.Session()
session.headers.update(HEADERS)

producer = KafkaProducer(
    bootstrap_servers=[KAFKA_BOOTSTRAP],
    value_serializer=lambda v: json.dumps(v, ensure_ascii=False).encode("utf-8"),
)
KST = timezone(timedelta(hours=9))


def is_http_status(exc: Exception, status_code: int) -> bool:
    return isinstance(exc, requests.HTTPError) and getattr(exc.response, "status_code", None) == status_code


def parse_published_at(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str):
        return None
    s = value.strip()
    try:
        if s.endswith("Z"):
            return datetime.fromisoformat(s[:-1] + "+00:00")
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=KST)
    except Exception:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y.%m.%d %H:%M"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=KST)
        except Exception:
            continue
    return None


def news_sort_key(x: dict) -> datetime:
    ts = x.get("sort_ts")
    if isinstance(ts, (int, float)):
        try:
            tie_dt = (
                parse_published_at(x.get("ingested_at"))
                or parse_published_at(x.get("crawled_at"))
                or datetime(1970, 1, 1, tzinfo=timezone.utc)
            )
            return (float(ts), tie_dt.timestamp(), str(x.get("url") or x.get("link") or ""))
        except Exception:
            pass
    main_dt = (
        parse_published_at(x.get("published_at_dt"))
        or parse_published_at(x.get("published_at"))
        or parse_published_at(x.get("crawled_at"))
        or datetime(1970, 1, 1, tzinfo=timezone.utc)
    )
    tie_dt = (
        parse_published_at(x.get("ingested_at"))
        or parse_published_at(x.get("crawled_at"))
        or datetime(1970, 1, 1, tzinfo=timezone.utc)
    )
    return (main_dt.timestamp(), tie_dt.timestamp(), str(x.get("url") or x.get("link") or ""))


def apply_event_time_fields(event: dict) -> dict:
    base_dt = (
        parse_published_at(event.get("published_at"))
        or parse_published_at(event.get("published_at_dt"))
        or parse_published_at(event.get("crawled_at"))
        or datetime.now(timezone.utc)
    )
    utc_iso = base_dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    event["published_at_dt"] = utc_iso
    event["sort_ts"] = float(base_dt.timestamp())
    event["published_at_ts"] = float(base_dt.timestamp())
    # 표시 문자열도 통일
    event["published_at"] = utc_iso
    return event


def load_seen() -> set[str]:
    try:
        with open(SEEN_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return set(data)
        return set()
    except FileNotFoundError:
        return set()
    except Exception:
        return set()


def save_seen(seen: set[str], max_keep: int = 5000) -> None:
    # 너무 커지지 않게 최근 것만 유지
    data = list(seen)
    if len(data) > max_keep:
        data = data[-max_keep:]
    try:
        with open(SEEN_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def make_soup(markup: str | bytes, parser: str = "lxml", **kwargs) -> BeautifulSoup:
    try:
        return BeautifulSoup(markup, parser, **kwargs)
    except Exception:
        fallback_kwargs = dict(kwargs)
        fallback_kwargs.pop("from_encoding", None)
        return BeautifulSoup(markup, "html.parser", **fallback_kwargs)


def get_finance_soup(url: str, timeout: int = 10) -> BeautifulSoup:
    res = session.get(url, timeout=timeout)
    res.raise_for_status()
    return make_soup(res.content, "lxml", from_encoding="euc-kr")


def safe_get_text(url: str, timeout: int = 10) -> str:
    res = session.get(url, timeout=timeout)
    res.raise_for_status()
    if not res.encoding or res.encoding.lower() in ("iso-8859-1", "ascii"):
        res.encoding = "utf-8"
    return res.text


def normalize_href(href: str) -> str | None:
    if not href:
        return None
    href = href.strip()
    if href.startswith("//"):
        return "https:" + href
    if href.startswith("http://") or href.startswith("https://"):
        return href
    return urljoin(NAVER_FINANCE_BASE, href)


def normalize_coinness_href(href: str) -> str | None:
    if not href:
        return None
    href = href.strip()
    if href.startswith("//"):
        return "https:" + href
    if href.startswith("http://") or href.startswith("https://"):
        return href
    return urljoin(COINNESS_BASE, href)


def normalize_einfomax_href(href: str) -> str | None:
    if not href:
        return None
    href = href.strip()
    if href.startswith("//"):
        return "https:" + href
    if href.startswith("http://") or href.startswith("https://"):
        return href
    return urljoin(EINFOMAX_BASE, href)


def is_coin_related_title(title: str | None) -> bool:
    if not title:
        return False
    return any(kw in title for kw in COIN_FILTER_KEYWORDS)


def is_coinness_article_url(url: str) -> bool:
    if not url:
        return False
    host = (urlparse(url).hostname or "").lower()
    if host not in ("coinness.com", "www.coinness.com"):
        return False
    path = urlparse(url).path.rstrip("/")
    if path == "/article":
        return False
    if "/article" in url:
        return True
    if "/news/" in url:
        return True
    return False


def coinness_article_page_urls(pages: int) -> list[str]:
    urls: list[str] = []
    base_urls = [COINNESS_ARTICLE_URL]
    if "://coinness.com" in COINNESS_ARTICLE_URL:
        base_urls.append(COINNESS_ARTICLE_URL.replace("://coinness.com", "://www.coinness.com"))
    elif "://www.coinness.com" in COINNESS_ARTICLE_URL:
        base_urls.append(COINNESS_ARTICLE_URL.replace("://www.coinness.com", "://coinness.com"))

    for base in list(dict.fromkeys(base_urls)):
        for page in range(1, pages + 1):
            urls.append(f"{base}?page={page}")
    return urls


def coinness_sitemap_urls() -> list[str]:
    urls = [COINNESS_SITEMAP_URL]
    if "://coinness.com" in COINNESS_SITEMAP_URL:
        urls.append(COINNESS_SITEMAP_URL.replace("://coinness.com", "://www.coinness.com"))
    elif "://www.coinness.com" in COINNESS_SITEMAP_URL:
        urls.append(COINNESS_SITEMAP_URL.replace("://www.coinness.com", "://coinness.com"))
    return list(dict.fromkeys(urls))


def crawl_naver_coin_items_multi_pages(keywords: list[str], pages: int) -> list[dict]:
    all_items: list[dict] = []
    for kw in keywords:
        for page in range(1, pages + 1):
            start = 1 + (page - 1) * 10
            url = (
                f"{NAVER_NEWS_SEARCH_URL}?where=news&query={quote_plus(kw)}"
                f"&sm=tab_pge&start={start}"
            )
            try:
                html = safe_get_text(url)
            except Exception as e:
                print(f"[debug] coin fallback list fetch fail: kw={kw} page={page} err={e!r}")
                continue

            soup = make_soup(html, "lxml")
            nodes = soup.select("a.news_tit[href], a[href*='n.news.naver.com/mnews/article/']")
            print(f"[debug] coin fallback kw={kw} page={page} nodes={len(nodes)}")

            for a in nodes:
                raw_href = a.get("href", "")
                link = normalize_coinness_href(raw_href)
                if not link:
                    continue
                if "n.news.naver.com/mnews/article/" not in link:
                    continue

                title = a.get("title") or a.get_text(" ", strip=True) or None
                all_items.append(
                    {
                        "link": link,
                        "title": title,
                        "source_list_url": url,
                        "keyword": kw,
                    }
                )
            time.sleep(0.12)

    seen = set()
    uniq: list[dict] = []
    for it in all_items:
        link = it["link"]
        if link in seen:
            continue
        seen.add(link)
        uniq.append(it)

    print("[debug] coin fallback uniq_items_total=", len(uniq))
    return uniq


def to_mobile_news_url(url: str) -> str:
    # finance news_read -> mobile article
    if "finance.naver.com/news/" in url and "news_read.naver" in url:
        qs = parse_qs(urlparse(url).query)
        article_id = qs.get("article_id", [None])[0]
        office_id = qs.get("office_id", [None])[0]
        if article_id and office_id:
            return f"https://n.news.naver.com/mnews/article/{office_id}/{article_id}"
    return url


def crawl_mainnews_items_multi_pages(pages: int) -> list[dict]:
    """
    mainnews.naver?page=1..pages 를 훑어서 목록을 최대한 많이 모음
    """
    all_items: list[dict] = []

    for page in range(1, pages + 1):
        url = f"{NAVER_FINANCE_MAINNEWS_URL}?page={page}"
        soup = get_finance_soup(url)

        nodes = soup.select("ul.newsList dd.articleSubject a[href]")
        print(f"[debug] page={page} nodes={len(nodes)}")

        for a in nodes:
            raw_href = a.get("href", "")
            finance_origin_link = normalize_href(raw_href)
            if not finance_origin_link:
                continue

            mobile_link = to_mobile_news_url(finance_origin_link)
            if "n.news.naver.com/mnews/article/" not in mobile_link:
                continue

            title = a.get_text(strip=True)

            li = a.find_parent("li")
            summary_dd = li.select_one("dd.articleSummary") if li else None
            press = (
                summary_dd.select_one("span.press").get_text(strip=True)
                if summary_dd and summary_dd.select_one("span.press")
                else None
            )
            wdate = (
                summary_dd.select_one("span.wdate").get_text(strip=True)
                if summary_dd and summary_dd.select_one("span.wdate")
                else None
            )
            summary = summary_dd.get_text(" ", strip=True) if summary_dd else None

            all_items.append(
                {
                    "finance_origin_link": finance_origin_link,
                    "link": mobile_link,
                    "title": title,
                    "press": press,
                    "wdate": wdate,
                    "summary": summary,
                    "source_list_url": url,
                }
            )

        time.sleep(0.15)

    # dedupe keep order by link
    seen = set()
    uniq = []
    for it in all_items:
        if it["link"] in seen:
            continue
        seen.add(it["link"])
        uniq.append(it)

    print("[debug] uniq_items_total=", len(uniq))
    return uniq


def parse_json_ld_article(soup: BeautifulSoup) -> dict:
    for script in soup.select('script[type="application/ld+json"]'):
        raw = script.get_text(strip=True)
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except Exception:
            continue

        blocks = data if isinstance(data, list) else [data]
        for block in blocks:
            if not isinstance(block, dict):
                continue
            typ = block.get("@type")
            if isinstance(typ, list):
                type_names = {str(t).lower() for t in typ}
            else:
                type_names = {str(typ).lower()} if typ else set()

            if "article" not in type_names and "newsarticle" not in type_names:
                continue

            return {
                "title": block.get("headline"),
                "published_at": block.get("datePublished"),
                "body": block.get("articleBody"),
            }
    return {}


def _meta_content(soup: BeautifulSoup, attr: str, value: str) -> str | None:
    node = soup.select_one(f'meta[{attr}="{value}"]')
    if not node:
        return None
    content = node.get("content")
    if not isinstance(content, str):
        return None
    text = " ".join(content.split()).strip()
    return text or None


def _normalize_lines(text: str | None) -> str | None:
    if not text:
        return None

    lines: list[str] = []
    blank_pending = False
    seen_paragraphs: set[str] = set()
    for raw in text.replace("\r", "\n").split("\n"):
        line = " ".join(raw.split()).strip()
        if not line:
            blank_pending = True
            continue
        if line in seen_paragraphs:
            continue
        if blank_pending and lines:
            lines.append("")
        blank_pending = False
        lines.append(line)
        seen_paragraphs.add(line)

    cleaned = "\n".join(lines).strip()
    return cleaned or None


def _text_from_node(node: BeautifulSoup) -> str | None:
    paragraph_nodes = node.select("p")
    paragraphs: list[str] = []
    for paragraph in paragraph_nodes:
        text = " ".join(paragraph.get_text(" ", strip=True).split()).strip()
        if len(text) >= 20:
            paragraphs.append(text)

    if paragraphs:
        joined = _normalize_lines("\n\n".join(paragraphs))
        if joined and len(joined) >= 120:
            return joined

    return _normalize_lines(node.get_text("\n", strip=True))


def _looks_like_full_article(body: str | None, summary: str | None = None, title: str | None = None) -> bool:
    body_text = (body or "").strip()
    if len(body_text) >= 240:
        return True
    baseline = max(len((summary or "").strip()), len((title or "").strip()))
    return len(body_text) >= max(120, baseline + 60)


def crawl_generic_article_detail(url: str) -> dict | None:
    html = safe_get_text(url)
    soup = make_soup(html, "lxml")
    json_ld = parse_json_ld_article(soup)

    title = (
        _meta_content(soup, "property", "og:title")
        or _meta_content(soup, "name", "twitter:title")
        or (soup.select_one("h1").get_text(" ", strip=True) if soup.select_one("h1") else None)
        or (soup.title.get_text(" ", strip=True) if soup.title else None)
        or json_ld.get("title")
    )

    published_at = (
        _meta_content(soup, "property", "article:published_time")
        or _meta_content(soup, "name", "article:published_time")
        or _meta_content(soup, "property", "og:article:published_time")
        or (soup.select_one("time[datetime]").get("datetime") if soup.select_one("time[datetime]") else None)
        or json_ld.get("published_at")
    )

    body = None
    for selector in GENERIC_ARTICLE_BODY_SELECTORS:
        node = soup.select_one(selector)
        if not node:
            continue
        text = _text_from_node(node)
        if text and len(text) > 80:
            body = text
            break

    if not body:
        best_candidate = ""
        for node in soup.select("article, main, section, div[id], div[class]")[:250]:
            text = _text_from_node(node)
            if text and len(text) > len(best_candidate):
                best_candidate = text
        body = best_candidate or json_ld.get("body")

    body = _normalize_lines(body)
    title = _normalize_lines(title)

    if not title or not body:
        return None

    return {
        "title": title,
        "published_at": published_at,
        "body": body,
    }


def crawl_article_detail(url: str) -> dict | None:
    hostname = (urlparse(url).hostname or "").lower()

    if "naver.com" in hostname:
        return crawl_mobile_article_detail(to_mobile_news_url(url))
    if hostname.endswith("coinness.com"):
        return crawl_coinness_article_detail(url)
    if hostname.endswith("einfomax.co.kr"):
        return crawl_einfomax_article_detail(url)
    return crawl_generic_article_detail(url)


def crawl_coinness_items_multi_pages(pages: int) -> list[dict]:
    api_url = f"{COINNESS_API_BASE}/feed/v1/articles"
    items: list[dict] = []
    last_id = None
    last_at = None
    last_view = None

    for page in range(1, max(pages, 1) + 1):
        params = {
            "limit": COINNESS_API_PAGE_LIMIT,
            "section": COINNESS_API_SECTION,
            "categoryId": COINNESS_API_CATEGORY_ID,
            "languageCode": COINNESS_API_LANGUAGE_CODE,
        }
        if last_id is not None:
            params["lastId"] = str(last_id)
        if last_at:
            params["lastAt"] = str(last_at)
        if last_view is not None:
            params["lastView"] = str(last_view)

        try:
            raw = session.get(api_url, params=params, timeout=10).text
            data = json.loads(raw)
        except Exception as e:
            print(f"[debug] coinness api fetch fail: page={page} err={e!r}")
            break

        if not isinstance(data, list):
            print(f"[debug] coinness api unexpected payload: page={page} type={type(data).__name__}")
            break
        if not data:
            break

        print(f"[debug] coinness api page={page} items={len(data)}")
        for row in data:
            if not isinstance(row, dict):
                continue
            link = row.get("link")
            if not link:
                article_id = row.get("id")
                if article_id is not None:
                    link = f"{COINNESS_BASE}/article/{article_id}"
            link = normalize_coinness_href(link) if link else None
            if not link:
                continue

            title = row.get("title")
            summary = row.get("description")
            published_at = row.get("publishAt")
            article_id = row.get("id")
            view_count = row.get("view")
            items.append(
                {
                    "link": link,
                    "title": title,
                    "summary": summary,
                    "published_at": published_at,
                    "coinness_id": article_id,
                    "coinness_view": view_count,
                    "source_list_url": COINNESS_ARTICLE_URL,
                    "body_hint": summary or title,
                }
            )

        tail = data[-1]
        last_id = tail.get("id")
        last_at = tail.get("publishAt")
        last_view = tail.get("view")
        if last_id is None:
            break

    seen = set()
    uniq: list[dict] = []
    for it in items:
        key = it.get("coinness_id") or it["link"]
        if key in seen:
            continue
        seen.add(key)
        uniq.append(it)

    print("[debug] coinness api_items_total=", len(uniq))
    if uniq:
        return uniq

    # API 실패 시에만 구 방식 fallback
    all_items: list[dict] = []
    failed_pages = 0
    page_urls = coinness_article_page_urls(pages)
    for url in page_urls:
        try:
            html = safe_get_text(url)
        except Exception as e:
            failed_pages += 1
            print(f"[debug] coinness list fetch fail: {url} err={e!r}")
            continue
        soup = make_soup(html, "lxml")
        nodes = soup.select("a[href]")
        print(f"[debug] coinness list={url} nodes={len(nodes)}")
        for a in nodes:
            raw_href = a.get("href", "")
            link = normalize_coinness_href(raw_href)
            if not link or not is_coinness_article_url(link):
                continue
            title = a.get_text(" ", strip=True) or None
            all_items.append({"link": link, "title": title, "source_list_url": url})
        time.sleep(0.15)

    seen2 = set()
    uniq2: list[dict] = []
    for it in all_items:
        link = it["link"]
        if link in seen2:
            continue
        seen2.add(link)
        uniq2.append(it)
    print("[debug] coinness html_items_total=", len(uniq2))
    if uniq2:
        return uniq2

    sitemap_items = crawl_coinness_items_from_sitemap(COINNESS_SITEMAP_LIMIT)
    print("[debug] coinness sitemap_items_total=", len(sitemap_items))
    if failed_pages == len(page_urls):
        print("[debug] coinness all list pages failed; check DNS/network for coinness domain")
    return sitemap_items


def crawl_coinness_items_from_sitemap(limit: int) -> list[dict]:
    sitemap_queue = coinness_sitemap_urls()
    visited = set()
    urls: list[str] = []

    while sitemap_queue and len(urls) < max(limit, 1) * 4:
        sitemap_url = sitemap_queue.pop(0)
        if sitemap_url in visited:
            continue
        visited.add(sitemap_url)

        try:
            xml_text = safe_get_text(sitemap_url)
        except Exception as e:
            print(f"[debug] coinness sitemap fetch fail: {sitemap_url} err={e!r}")
            continue

        soup = make_soup(xml_text, "xml")

        index_nodes = soup.select("sitemap > loc")
        if index_nodes:
            for loc in index_nodes:
                child_url = (loc.get_text(strip=True) or "").strip()
                if child_url.startswith("http"):
                    sitemap_queue.append(child_url)
            continue

        for loc in soup.select("url > loc"):
            link = (loc.get_text(strip=True) or "").strip()
            if not is_coinness_article_url(link):
                continue
            urls.append(link)

    # sitemap은 오래된 항목부터 오는 경우가 많아 최신 가능성이 큰 뒤쪽부터 사용
    urls = list(dict.fromkeys(urls))  # dedupe keep order
    picked = list(reversed(urls))[: max(limit, 1)]

    items: list[dict] = []
    for link in picked:
        items.append(
            {
                "link": link,
                "title": None,
                "source_list_url": COINNESS_SITEMAP_URL,
            }
        )
    return items


def crawl_mobile_article_detail(url: str) -> dict | None:
    html = safe_get_text(url)
    soup = make_soup(html, "lxml")

    title_tag = soup.select_one("h2#title_area")
    body_tag = soup.select_one("div#newsct_article")
    time_tag = soup.select_one("span.media_end_head_info_datestamp_time")

    if not title_tag or not body_tag:
        return None

    return {
        "title": title_tag.get_text(strip=True),
        "published_at": time_tag.get("data-date-time") if time_tag else None,
        "body": body_tag.get_text("\n", strip=True),
    }


def crawl_coinness_article_detail(url: str) -> dict | None:
    html = safe_get_text(url)
    soup = make_soup(html, "lxml")

    json_ld = parse_json_ld_article(soup)

    title = (
        (soup.select_one("meta[property='og:title']") or {}).get("content")
        or (soup.select_one("meta[name='twitter:title']") or {}).get("content")
        or (soup.select_one("h1") or {}).get_text(strip=True)
        or json_ld.get("title")
    )

    published_at = (
        (soup.select_one("meta[property='article:published_time']") or {}).get("content")
        or (soup.select_one("time[datetime]") or {}).get("datetime")
        or json_ld.get("published_at")
    )

    body_selectors = [
        "[data-testid='article-content']",
        ".article_body",
        "div.article-content",
        "div.post-content",
        "div.news-content",
        "section article",
        "article",
    ]
    body = None
    for selector in body_selectors:
        node = soup.select_one(selector)
        if node:
            text = node.get_text("\n", strip=True)
            if len(text) > 80:
                body = text
                break

    if not body:
        body = json_ld.get("body")

    if not title or not body:
        return None

    return {
        "title": title.strip(),
        "published_at": published_at,
        "body": body.strip(),
    }


def crawl_einfomax_items_multi_pages(query: str, pages: int) -> list[dict]:
    all_items: list[dict] = []

    for page in range(1, pages + 1):
        url = (
            f"{EINFOMAX_ARTICLE_LIST_URL}?sc_word={quote_plus(query)}"
            f"&view_type=sm&page={page}"
        )
        try:
            html = safe_get_text(url)
        except Exception as e:
            print(f"[debug] einfomax list fetch fail: page={page} err={e!r}")
            continue

        soup = make_soup(html, "lxml")
        nodes = soup.select("#section-list ul.type2 > li")
        print(f"[debug] einfomax query={query} page={page} nodes={len(nodes)}")

        for li in nodes:
            a = li.select_one("h4.titles a[href]")
            if not a:
                continue

            link = normalize_einfomax_href(a.get("href", ""))
            if not link or "articleView.html?idxno=" not in link:
                continue

            title = a.get_text(" ", strip=True) or None
            if EINFOMAX_FILTER_COINS and not is_coin_related_title(title):
                continue

            em_nodes = li.select("span.byline em")
            press = em_nodes[0].get_text(" ", strip=True) if em_nodes else None
            published_at = em_nodes[-1].get_text(" ", strip=True) if em_nodes else None

            summary_node = li.select_one("p.lead a")
            summary = summary_node.get_text(" ", strip=True) if summary_node else None

            all_items.append(
                {
                    "link": link,
                    "title": title,
                    "press": press,
                    "published_at": published_at,
                    "summary": summary,
                    "source_list_url": url,
                }
            )

        time.sleep(0.15)

    seen = set()
    uniq = []
    for it in all_items:
        link = it["link"]
        if link in seen:
            continue
        seen.add(link)
        uniq.append(it)

    print("[debug] einfomax uniq_items_total=", len(uniq))
    return uniq


def crawl_einfomax_article_detail(url: str) -> dict | None:
    html = safe_get_text(url)
    soup = make_soup(html, "lxml")

    title = (
        (soup.select_one("meta[property='og:title']") or {}).get("content")
        or (soup.select_one("h3#article-title") or {}).get_text(strip=True)
        or (soup.select_one("h3.titles") or {}).get_text(strip=True)
    )
    published_at = (
        (soup.select_one("meta[property='article:published_time']") or {}).get("content")
        or (soup.select_one("ul.article-head-info li") or {}).get_text(" ", strip=True)
    )

    body_node = (
        soup.select_one("#article-view-content-div")
        or soup.select_one("article[itemprop='articleBody']")
        or soup.select_one("div.article-body")
    )
    body = body_node.get_text("\n", strip=True) if body_node else None

    if not title or not body:
        return None

    return {
        "title": title.strip(),
        "published_at": published_at.strip() if isinstance(published_at, str) else published_at,
        "body": body.strip(),
    }


def run_once() -> tuple[int, dict[str, int]]:
    # ✅ 실행 간 중복 전송 줄이기(크론에서도 효과)
    seen_links = load_seen()
    produced_by_source: dict[str, int] = {}
    total_produced = 0
    pending_events: list[dict] = []

    if ENABLE_NAVER and NAVER_LIMIT > 0:
        items = crawl_mainnews_items_multi_pages(PAGES)
        for it in items:
            if produced_by_source.get("naver_finance", 0) >= NAVER_LIMIT:
                break

            link = it["link"]
            if link in seen_links:
                continue

            print("fetch:", link)
            try:
                detail = crawl_mobile_article_detail(link)
            except Exception as e:
                if is_http_status(e, 429):
                    print(f"  warn: naver detail rate-limited, skip: {link}")
                    time.sleep(1.5 + random.random() * 1.5)
                else:
                    print(f"  warn: naver detail fetch fail err={e!r}")
                continue
            if not detail:
                print("  skip: no title/body")
                continue

            event = {
                "source": "naver_finance",
                "section": "증권/주요뉴스",
                "source_list_url": it.get("source_list_url"),
                "finance_origin_link": it.get("finance_origin_link"),
                "url": link,
                "link": link,  # legacy alias
                "title": detail["title"],
                "published_at": detail["published_at"] or it.get("wdate"),
                "content": detail["body"],
                "body": detail["body"],  # legacy alias
                "press": it.get("press"),
                "summary": it.get("summary"),
                "crawled_at": datetime.now(timezone.utc).isoformat(),
            }
            event = apply_event_time_fields(event)

            pending_events.append(event)
            print("queue:", detail["title"][:60])

            seen_links.add(link)
            produced_by_source["naver_finance"] = produced_by_source.get("naver_finance", 0) + 1
            total_produced += 1
            time.sleep(0.35 + random.random() * 0.55)

    if ENABLE_COINNESS and COINNESS_LIMIT > 0:
        items = crawl_coinness_items_multi_pages(COINNESS_PAGES)
        for it in items:
            if produced_by_source.get("coinness", 0) >= COINNESS_LIMIT:
                break

            link = it["link"]
            if link in seen_links:
                continue

            print("fetch:", link)
            detail = None

            try:
                detail = crawl_article_detail(link)
            except Exception as e:
                print(f"  warn: coinness origin detail fetch fail err={e!r}")

            if (
                not detail
                or not _looks_like_full_article(
                    detail.get("body"),
                    it.get("summary"),
                    it.get("title"),
                )
            ):
                coinness_article_id = it.get("coinness_id")
                if coinness_article_id is not None:
                    coinness_detail_url = f"{COINNESS_BASE}/article/{coinness_article_id}"
                    try:
                        coinness_detail = crawl_coinness_article_detail(coinness_detail_url)
                        if coinness_detail and _looks_like_full_article(
                            coinness_detail.get("body"),
                            it.get("summary"),
                            it.get("title"),
                        ):
                            detail = coinness_detail
                    except Exception as e:
                        print(f"  warn: coinness detail page fetch fail err={e!r}")

            if not detail:
                fallback_body = it.get("body_hint") or it.get("summary") or it.get("title")
                if not fallback_body:
                    print("  skip: no title/body")
                    continue
                detail = {
                    "title": it.get("title"),
                    "published_at": it.get("published_at"),
                    "body": fallback_body,
                }

            event = {
                "source": "coinness",
                "section": "코인/전체뉴스",
                "source_list_url": it.get("source_list_url"),
                "url": link,
                "link": link,  # legacy alias
                "title": detail.get("title") or it.get("title"),
                "published_at": detail.get("published_at") or it.get("published_at"),
                "content": detail["body"],
                "body": detail["body"],  # legacy alias
                "press": "coinness",
                "summary": it.get("summary") or it.get("title"),
                "coinness_id": it.get("coinness_id"),
                "crawled_at": datetime.now(timezone.utc).isoformat(),
            }
            event = apply_event_time_fields(event)

            pending_events.append(event)
            print("queue:", detail["title"][:60])

            seen_links.add(link)
            produced_by_source["coinness"] = produced_by_source.get("coinness", 0) + 1
            total_produced += 1
            time.sleep(0.35 + random.random() * 0.55)

    if ENABLE_EINFOMAX and EINFOMAX_LIMIT > 0:
        items = crawl_einfomax_items_multi_pages(EINFOMAX_QUERY, EINFOMAX_PAGES)
        for it in items:
            if produced_by_source.get("einfomax_coin", 0) >= EINFOMAX_LIMIT:
                break

            link = it["link"]
            if link in seen_links:
                continue

            print("fetch:", link)
            try:
                detail = crawl_einfomax_article_detail(link)
            except Exception as e:
                print(f"  skip: einfomax detail fetch fail err={e!r}")
                continue
            if not detail:
                print("  skip: no title/body")
                continue

            event = {
                "source": "einfomax_coin",
                "section": "코인/연합인포맥스",
                "source_list_url": it.get("source_list_url"),
                "url": link,
                "link": link,  # legacy alias
                "title": detail["title"],
                "published_at": detail.get("published_at") or it.get("published_at"),
                "content": detail["body"],
                "body": detail["body"],  # legacy alias
                "press": it.get("press") or "연합인포맥스",
                "summary": it.get("summary"),
                "crawled_at": datetime.now(timezone.utc).isoformat(),
            }
            event = apply_event_time_fields(event)

            pending_events.append(event)
            print("queue:", detail["title"][:60])

            seen_links.add(link)
            produced_by_source["einfomax_coin"] = produced_by_source.get("einfomax_coin", 0) + 1
            total_produced += 1
            time.sleep(0.35 + random.random() * 0.55)

    if (
        ENABLE_COIN_FALLBACK
        and COIN_FALLBACK_LIMIT > 0
        and produced_by_source.get("coinness", 0) < COINNESS_LIMIT
    ):
        fallback_items = crawl_naver_coin_items_multi_pages(COIN_KEYWORDS, COIN_FALLBACK_PAGES)
        for it in fallback_items:
            if produced_by_source.get("coin_fallback", 0) >= COIN_FALLBACK_LIMIT:
                break

            link = it["link"]
            if link in seen_links:
                continue

            print("fetch:", link)
            try:
                detail = crawl_mobile_article_detail(link)
            except Exception as e:
                if is_http_status(e, 429):
                    print(f"  warn: naver coin fallback rate-limited, skip: {link}")
                    time.sleep(1.5 + random.random() * 1.5)
                else:
                    print(f"  warn: naver coin fallback detail fail err={e!r}")
                continue
            if not detail:
                print("  skip: no title/body")
                continue

            event = {
                "source": "naver_coin_fallback",
                "section": "코인/검색뉴스",
                "source_list_url": it.get("source_list_url"),
                "url": link,
                "link": link,  # legacy alias
                "title": detail["title"],
                "published_at": detail.get("published_at"),
                "content": detail["body"],
                "body": detail["body"],  # legacy alias
                "press": "naver",
                "summary": it.get("title"),
                "keyword": it.get("keyword"),
                "crawled_at": datetime.now(timezone.utc).isoformat(),
            }
            event = apply_event_time_fields(event)

            pending_events.append(event)
            print("queue:", detail["title"][:60])

            seen_links.add(link)
            produced_by_source["coin_fallback"] = produced_by_source.get("coin_fallback", 0) + 1
            total_produced += 1
            time.sleep(0.35 + random.random() * 0.55)

    # 소스별 수집 완료 후, 한 번에 시간순 정렬해서 반영
    if pending_events:
        pending_events.sort(key=news_sort_key, reverse=True)
        for event in pending_events:
            producer.send(TOPIC, value=event)
        for event in pending_events:
            print("produce:", event.get("title", "")[:60])

    producer.flush()
    save_seen(seen_links)
    print(
        f"done. produced_total={total_produced} "
        f"naver_limit={NAVER_LIMIT} coinness_limit={COINNESS_LIMIT} einfomax_limit={EINFOMAX_LIMIT} "
        f"naver_pages={PAGES} coinness_pages={COINNESS_PAGES} einfomax_pages={EINFOMAX_PAGES} "
        f"by_source={produced_by_source}"
    )
    return total_produced, produced_by_source


def main():
    if not RUN_FOREVER:
        run_once()
        return

    print(f"run_forever=1 poll_interval_sec={POLL_INTERVAL_SEC}")
    while True:
        started = datetime.now(timezone.utc).isoformat()
        try:
            total_produced, produced_by_source = run_once()
            print(
                f"[loop] started={started} produced_total={total_produced} "
                f"by_source={produced_by_source}"
            )
        except Exception as e:
            print(f"[loop] started={started} error={e!r}")
        time.sleep(max(POLL_INTERVAL_SEC, 5))


if __name__ == "__main__":
    main()
