import logging
"""
AI Chat Service - AWS Bedrock + RAG (??? + ? + ????
"""
import asyncio
import uuid
import json
import re
import boto3
from botocore.config import Config
from typing import AsyncGenerator, List, Dict, Optional, Tuple
from datetime import datetime

from .market_data import crypto_client, kis_client
from ..config import get_settings
from ..database import get_news_collection, get_assets_collection
from ..services.exchange_rate import get_exchange_rate
from ..mariadb import get_user_portfolios

try:
    from elasticsearch import AsyncElasticsearch
    _ES_AVAILABLE = True
except ImportError:
    _ES_AVAILABLE = False

logger = logging.getLogger(__name__)

RAG_NEWS_LIMIT = 12
RAG_NEWS_BODY_MAX_CHARS = 700
RAG_NEWS_RECENT_DAYS = 14
PORTFOLIO_KEYWORD_ASSET_LIMIT = 5
PORTFOLIO_QUERY_HINTS = (
    "포트폴리오",
    "내 포트폴리오",
    "내 자산",
    "내 종목",
    "보유",
    "보유중",
    "가지고 있는",
    "가지고있",
    "리밸런싱",
    "비중",
    "분산",
    "추가 매수",
    "추가매수",
)

MARKET_SYMBOL_ALIASES: Dict[str, Tuple[str, str]] = {
    "tqqq": ("TQQQ", "US"),
    "qqq": ("QQQ", "US"),
    "spy": ("SPY", "US"),
    "soxl": ("SOXL", "US"),
    "soxx": ("SOXX", "US"),
    "schd": ("SCHD", "US"),
    "voo": ("VOO", "US"),
    "vti": ("VTI", "US"),
    "iwm": ("IWM", "US"),
    "aapl": ("AAPL", "US"),
    "apple": ("AAPL", "US"),
    "애플": ("AAPL", "US"),
    "msft": ("MSFT", "US"),
    "microsoft": ("MSFT", "US"),
    "마이크로소프트": ("MSFT", "US"),
    "nvda": ("NVDA", "US"),
    "nvidia": ("NVDA", "US"),
    "엔비디아": ("NVDA", "US"),
    "tsla": ("TSLA", "US"),
    "tesla": ("TSLA", "US"),
    "테슬라": ("TSLA", "US"),
    "amzn": ("AMZN", "US"),
    "amazon": ("AMZN", "US"),
    "아마존": ("AMZN", "US"),
    "googl": ("GOOGL", "US"),
    "google": ("GOOGL", "US"),
    "구글": ("GOOGL", "US"),
    "알파벳": ("GOOGL", "US"),
    "meta": ("META", "US"),
    "메타": ("META", "US"),
    "005930": ("005930", "KR"),
    "삼성전자": ("005930", "KR"),
    "000660": ("000660", "KR"),
    "sk하이닉스": ("000660", "KR"),
    "에스케이하이닉스": ("000660", "KR"),
}

NON_MARKET_ALPHA_TOKENS = {
    "ETF",
    "USD",
    "KRW",
    "KRW",
    "BTC",
    "ETH",
    "XRP",
    "SOL",
}

# 코인 키워드 매핑
COIN_KEYWORDS = {
    "비트코인": "KRW-BTC",
    "btc": "KRW-BTC",
    "이더리움": "KRW-ETH",
    "eth": "KRW-ETH",
    "이더": "KRW-ETH",
    "리플": "KRW-XRP",
    "xrp": "KRW-XRP",
    "솔라나": "KRW-SOL",
    "sol": "KRW-SOL",
}

# 코인 한글 이름
COIN_NAMES = {
    "KRW-BTC": "비트코인(BTC)",
    "KRW-ETH": "이더리움(ETH)",
    "KRW-XRP": "리플(XRP)",
    "KRW-SOL": "솔라나(SOL)",
}

# 금융 유사어 사전 (쿼리 타임 확장용)
# 키: 사용자가 입력할 수 있는 표현, 값: ES에 함께 검색할 동의어 목록
FINANCIAL_SYNONYMS: Dict[str, List[str]] = {
    "비트코인":     ["비트코인", "BTC", "bitcoin", "비트"],
    "btc":          ["BTC", "비트코인", "bitcoin"],
    "이더리움":     ["이더리움", "ETH", "ethereum", "이더"],
    "eth":          ["ETH", "이더리움", "ethereum"],
    "리플":         ["리플", "XRP", "ripple"],
    "xrp":          ["XRP", "리플", "ripple"],
    "솔라나":       ["솔라나", "SOL", "solana"],
    "sol":          ["SOL", "솔라나", "solana"],
    "도지":         ["도지코인", "DOGE", "dogecoin"],
    "doge":         ["DOGE", "도지코인", "dogecoin"],
    "삼성전자":     ["삼성전자", "삼성", "005930", "samsung"],
    "삼성":         ["삼성전자", "삼성", "005930"],
    "카카오":       ["카카오", "035720", "kakao"],
    "sk하이닉스":  ["SK하이닉스", "하이닉스", "000660"],
    "하이닉스":     ["SK하이닉스", "하이닉스", "000660"],
    "엔비디아":     ["엔비디아", "NVDA", "nvidia"],
    "nvda":         ["NVDA", "엔비디아", "nvidia"],
    "테슬라":       ["테슬라", "TSLA", "tesla"],
    "tsla":         ["TSLA", "테슬라", "tesla"],
    "애플":         ["애플", "AAPL", "apple"],
    "aapl":         ["AAPL", "애플", "apple"],
    "마이크로소프트": ["마이크로소프트", "MSFT", "microsoft"],
    "msft":         ["MSFT", "마이크로소프트", "microsoft"],
    "구글":         ["구글", "알파벳", "GOOGL", "google"],
    "googl":        ["GOOGL", "구글", "알파벳", "google"],
    "아마존":       ["아마존", "AMZN", "amazon"],
    "amzn":         ["AMZN", "아마존", "amazon"],
    "메타":         ["메타", "META", "meta", "페이스북"],
    "tqqq":         ["TQQQ", "QQQ", "나스닥100", "NASDAQ 100"],
    "qqq":          ["QQQ", "나스닥100", "NASDAQ 100", "Invesco QQQ"],
    "spy":          ["SPY", "S&P500", "SPDR S&P 500"],
    "soxl":         ["SOXL", "반도체 3배", "semiconductor bull 3x"],
    "soxx":         ["SOXX", "반도체 ETF", "semiconductor etf"],
    "금리":         ["금리", "기준금리", "이자율", "금리인상", "금리인하"],
    "인플레이션":   ["인플레이션", "물가", "cpi", "소비자물가"],
    "반도체":       ["반도체", "chip", "semiconductor", "칩"],
    "ai":           ["AI", "인공지능", "인공 지능", "머신러닝"],
    "인공지능":     ["인공지능", "AI", "머신러닝", "딥러닝"],
    "코스피":       ["코스피", "KOSPI", "한국증시", "국내증시"],
    "나스닥":       ["나스닥", "NASDAQ", "나스닥100"],
    "s&p":          ["S&P", "S&P500", "sp500"],
}


# 시스템 프롬프트
SYSTEM_PROMPT = """당신은 "tutum AI"라는 금융 AI 어시스턴트입니다.

## 역할
- 사용자의 암호화폐 및 주식 포트폴리오 분석을 도와주는 전문 어시스턴트
- 실시간 시세 데이터와 뉴스를 기반으로 시장 분석 및 투자 인사이트 제공

## 지원 기능
1. **시세 조회**: 비트코인(BTC), 이더리움(ETH), 리플(XRP), 솔라나(SOL) 등 암호화폐 실시간 가격 분석
2. **포트폴리오 분석**: 사용자 자산 구성, 수익률, 리스크 점수 분석
3. **리밸런싱 추천**: 자산 배분 최적화 제안
4. **시장 동향 분석**: 뉴스 기반 분석 및 거시경제 동향
5. **뉴스 기반 추론**: 제공된 뉴스 데이터를 근거로 가격 변동 원인 분석

## 응답 규칙
- 한국어로 응답하세요
- 금액은 원(₩) 단위로, 소수점 없이 표시하세요 (예: ₩95,702,000)
- 마크다운 볼드(**텍스트**)를 활용하여 가독성 좋게 구성하세요
- 모든 응답 마지막에 반드시 다음 면책 문구를 포함하세요: "본 정보는 투자 조언이 아닙니다. 투자 결정은 신중하게 내려주세요."
- 답변은 간결하되 핵심 정보를 빠짐없이 포함하세요
- 금융과 관련 없는 질문에는 정중히 금융 관련 질문으로 안내하세요

## 컨텍스트
사용자 메시지와 함께 [내 포트폴리오], [실시간 시세 데이터], [관련 뉴스]가 제공될 수 있습니다. 이 데이터를 활용하여 정확한 정보 기반으로 응답하세요.
- [내 포트폴리오]가 있으면 사용자의 실제 보유 자산을 기반으로 분석하세요, 리밸런싱 추천 시 현재 비중과 수익률을 고려하세요"""


def _next_stream_event(iterator):
    try:
        return next(iterator), False
    except StopIteration:
        return None, True


class ChatService:
    """AI  ???(Bedrock + ??? + ? RAG)"""

    def __init__(self):
        self.crypto_client = crypto_client
        self.settings = get_settings()
        self.bedrock_client = None
        self.es_client = None

        # Elasticsearch 클라이언트 초기화
        if _ES_AVAILABLE:
            try:
                self.es_client = AsyncElasticsearch(
                    hosts=[self.settings.ELASTICSEARCH_URL],
                    request_timeout=5,
                )
                logger.info("Elasticsearch client initialized: %s", self.settings.ELASTICSEARCH_URL)
            except Exception as e:
                logger.warning("Elasticsearch 초기화 실패: %s", e)

        # Bedrock ??????
        if self.settings.AWS_ACCESS_KEY_ID and self.settings.AWS_SECRET_ACCESS_KEY:
            try:
                self.bedrock_client = boto3.client(
                    "bedrock-runtime",
                    region_name=self.settings.AWS_REGION,
                    aws_access_key_id=self.settings.AWS_ACCESS_KEY_ID,
                    aws_secret_access_key=self.settings.AWS_SECRET_ACCESS_KEY,
                    config=Config(
                        connect_timeout=getattr(self.settings, "BEDROCK_CONNECT_TIMEOUT_SECONDS", 10),
                        read_timeout=getattr(self.settings, "BEDROCK_READ_TIMEOUT_SECONDS", 60),
                        retries={"max_attempts": 3, "mode": "standard"},
                    ),
                )
                logger.info("Bedrock client initialized")
            except Exception as e:
                logger.warning("Bedrock ???????: %s", e)
        else:
            logger.info("AWS credentials not configured; running in mock mode")

    def _extract_portfolio_keywords(self, portfolio: Optional[List[dict]]) -> List[str]:
        """포트폴리오 종목 기반 키워드 후보 생성"""
        if not portfolio:
            return []

        ranked_assets = []
        for asset in portfolio:
            try:
                qty = float(asset.get("quantity", 0) or 0)
                current_price = float(asset.get("current_price", 0) or 0)
                avg_price = float(asset.get("average_price", 0) or 0)
            except Exception:
                qty, current_price, avg_price = 0.0, 0.0, 0.0

            exposure = qty * (current_price or avg_price)
            ranked_assets.append((exposure, asset))

        ranked_assets.sort(key=lambda x: x[0], reverse=True)

        extracted: List[str] = []
        seen: set[str] = set()

        def add_kw(value: str) -> None:
            token = str(value or "").strip()
            if len(token) < 2:
                return
            low = token.lower()
            if low in seen:
                return
            seen.add(low)
            extracted.append(token)

        for _, asset in ranked_assets[:PORTFOLIO_KEYWORD_ASSET_LIMIT]:
            name = str(asset.get("name", "")).strip()
            symbol = str(asset.get("symbol", "")).strip()

            if name:
                add_kw(name)
            if symbol:
                add_kw(symbol)
                if "-" in symbol:
                    add_kw(symbol.split("-")[-1])

        return extracted

    def _extract_query_keywords(self, query: str) -> List[str]:
        """질문 본문만 기준으로 키워드 추출"""
        query_lower = query.lower()
        keywords: List[str] = []
        seen: set[str] = set()

        def add_keyword(value: str) -> None:
            token = str(value or "").strip()
            if len(token) < 2:
                return
            low = token.lower()
            if low in seen:
                return
            seen.add(low)
            keywords.append(token)

        #  ???
        for keyword in COIN_KEYWORDS:
            if keyword in query_lower:
                add_keyword(keyword)

        # ?  ???(???  ? ? )
        stock_keywords = [
            "삼성전자",
            "SK하이닉스",
            "네이버",
            "카카오",
            "LG에너지솔루션",
            "현대차",
            "기아",
            "셀트리온",
            "포스코",
            "삼성SDI",
            "애플",
            "테슬라",
            "엔비디아",
            "마이크로소프트",
            "아마존",
            "구글",
            "메타",
            "TQQQ",
            "QQQ",
            "SPY",
            "SOXL",
            "SOXX",
        ]
        for kw in stock_keywords:
            if kw in query:
                add_keyword(kw)

        # 영문 티커/종목코드 직접 입력 케이스 (예: NVDA, TSLA, 005930)
        for token in re.findall(r"(?<!\d)(\d{4,6})(?!\d)", query):
            add_keyword(token)

        for token in re.findall(r"(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9\-]{1,9})(?![A-Za-z0-9])", query):
            if token.isalpha() and token.isupper() and 2 <= len(token) <= 6:
                add_keyword(token.upper())

        return keywords

    def _should_include_portfolio_keywords(
        self,
        query: str,
        query_keywords: List[str],
        crypto_tickers: List[str],
        market_symbols: List[Tuple[str, str]],
    ) -> bool:
        query_lower = query.lower()
        portfolio_intent = any(hint in query_lower for hint in PORTFOLIO_QUERY_HINTS)
        explicit_asset = bool(query_keywords or crypto_tickers or market_symbols)
        return portfolio_intent or not explicit_asset

    def _extract_keywords(
        self,
        query: str,
        portfolio: Optional[List[dict]] = None,
        include_portfolio_keywords: bool = True,
    ) -> List[str]:
        """질문 키워드에 필요할 때만 포트폴리오 키워드를 보강"""
        keywords = self._extract_query_keywords(query)
        seen = {keyword.lower() for keyword in keywords}

        def add_keyword(value: str) -> None:
            token = str(value or "").strip()
            if len(token) < 2:
                return
            lowered = token.lower()
            if lowered in seen:
                return
            seen.add(lowered)
            keywords.append(token)

        if not include_portfolio_keywords:
            return keywords

        for kw in self._extract_portfolio_keywords(portfolio):
            add_keyword(kw)

        return keywords

    def _extract_tickers(self, query: str) -> List[str]:
        """?  ? """
        query_lower = query.lower()
        found = []
        for keyword, ticker in COIN_KEYWORDS.items():
            if keyword in query_lower and ticker not in found:
                found.append(ticker)
        return found

    def _extract_market_symbols(self, query: str) -> List[Tuple[str, str]]:
        """주식/ETF 심볼 추출 (질문 종목이 명확할 때만 가격 문맥에 사용)"""
        found: List[Tuple[str, str]] = []
        seen: set[tuple[str, str]] = set()
        query_lower = query.lower()

        def add_symbol(symbol: str, market: str) -> None:
            key = (symbol.upper(), market.upper())
            if key in seen:
                return
            seen.add(key)
            found.append(key)

        for alias, (symbol, market) in MARKET_SYMBOL_ALIASES.items():
            if alias in query_lower:
                add_symbol(symbol, market)

        for token in re.findall(r"(?<!\d)(\d{4,6})(?!\d)", query):
            add_symbol(token, "KR")

        for token in re.findall(r"(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9\-]{1,9})(?![A-Za-z0-9])", query):
            upper = token.upper()
            if upper in NON_MARKET_ALPHA_TOKENS:
                continue
            if upper in {value.split("-")[-1] for value in COIN_KEYWORDS.values()}:
                continue
            if token.isupper():
                add_symbol(upper, "US")

        return found

    async def _fetch_prices(
        self,
        crypto_tickers: List[str],
        market_symbols: Optional[List[Tuple[str, str]]] = None,
    ) -> Dict[str, dict]:
        """코인 + 주식/ETF 현재가 컨텍스트 수집"""
        prices: Dict[str, dict] = {}

        for ticker in crypto_tickers:
            try:
                data = await self.crypto_client.get_current_price(ticker)
                prices[ticker] = {
                    **data,
                    "kind": "crypto",
                    "label": COIN_NAMES.get(ticker, ticker),
                }
            except Exception as e:
                logger.warning("Failed to fetch price for {ticker}: %s", e)

        for symbol, market in market_symbols or []:
            try:
                data = await kis_client.get_current_price(symbol, market=market)
                price = float(data.get("price", 0) or 0)
                if price <= 0:
                    continue
                raw_output = data.get("raw", {}).get("output", {}) if isinstance(data.get("raw"), dict) else {}
                change_percent = raw_output.get("prdy_ctrt") or raw_output.get("rate")
                try:
                    change_percent = float(change_percent) if change_percent is not None else None
                except (TypeError, ValueError):
                    change_percent = None

                prices[symbol] = {
                    **data,
                    "kind": "market",
                    "label": symbol,
                    "market": market,
                    "change_percent": change_percent,
                }
            except Exception as e:
                logger.warning("Failed to fetch market price for %s (%s): %s", symbol, market, e)

        return prices

    def _recent_news_filter(self) -> dict:
        cutoff = datetime.utcnow().timestamp() - (RAG_NEWS_RECENT_DAYS * 86400)
        return {"published_at_ts": {"$gte": cutoff}}

    async def _fetch_news(
        self,
        keywords: List[str],
        limit: int = RAG_NEWS_LIMIT,
        recent_only: bool = True,
    ) -> List[dict]:
        """MongoDB??? ??????? ????"""
        try:
            news_col = get_news_collection()
            if news_col is None:
                return []

            filters = []
            if recent_only:
                filters.append(self._recent_news_filter())

            if keywords:
                search_conditions = []
                for kw in keywords:
                    regex = {"$regex": kw, "$options": "i"}
                    search_conditions.append({"$or": [
                        {"title": regex},
                        {"body": regex},
                        {"content": regex},
                    ]})
                filters.append({"$or": search_conditions})
            else:
                pass

            query_filter = {"$and": filters} if filters else {}

            cursor = news_col.find(query_filter).sort("published_at", -1).limit(limit)

            news_list = []
            async for doc in cursor:
                body = doc.get("body") or doc.get("content") or doc.get("description") or ""
                body_truncated = (
                    body[:RAG_NEWS_BODY_MAX_CHARS] + "..."
                    if len(body) > RAG_NEWS_BODY_MAX_CHARS
                    else body
                )

                pub_at = doc.get("published_at")
                if isinstance(pub_at, datetime):
                    pub_at = pub_at.strftime("%Y-%m-%d")
                else:
                    pub_at = str(pub_at or "")[:10]

                news_list.append({
                    "title": doc.get("title", ""),
                    "body": body_truncated,
                    "source": doc.get("source", ""),
                    "published_at": pub_at,
                    "url": doc.get("link") or doc.get("url"),
                })

            if not news_list and recent_only:
                return await self._fetch_news(keywords, limit=limit, recent_only=False)

            return news_list
        except Exception as e:
            logger.warning("??? ???????: %s", e)
            return []

    def _expand_keywords(self, keywords: List[str]) -> List[str]:
        """유사어 사전으로 키워드 확장 (중복 제거)"""
        expanded: List[str] = []
        seen = set()
        for kw in keywords:
            synonyms = FINANCIAL_SYNONYMS.get(kw.lower(), [kw])
            for s in synonyms:
                if s.lower() not in seen:
                    expanded.append(s)
                    seen.add(s.lower())
        return expanded

    async def _generate_query_embedding(self, query: str) -> Optional[List[float]]:
        """Bedrock Titan으로 쿼리 임베딩 생성 (kNN용)"""
        if not self.bedrock_client:
            return None
        try:
            loop = asyncio.get_running_loop()
            response = await loop.run_in_executor(
                None,
                lambda: self.bedrock_client.invoke_model(
                    modelId="amazon.titan-embed-text-v2:0",
                    body=json.dumps({"inputText": query, "dimensions": 1024, "normalize": True}),
                    contentType="application/json",
                    accept="application/json",
                ),
            )
            body = json.loads(response["body"].read())
            return body.get("embedding")
        except Exception as e:
            logger.warning("쿼리 임베딩 생성 실패: %s", e)
            return None

    def _build_es_body(
        self,
        expanded_terms: List[str],
        embedding: Optional[List[float]],
        limit: int,
        recent_only: bool = True,
    ) -> dict:
        """ES 검색 바디 구성 (BM25 bool/should + 선택적 kNN 하이브리드)"""
        source_fields = ["title", "content", "summary", "source", "press", "published_at", "url", "finance_origin_link"]
        recent_range = {"range": {"published_at": {"gte": f"now-{RAG_NEWS_RECENT_DAYS}d/d"}}}

        if not expanded_terms:
            # 키워드 없음 → 최신순
            query: dict = {"match_all": {}}
            if recent_only:
                query = {"bool": {"filter": [recent_range]}}
            return {
                "query": query,
                "sort": [{"published_at": "desc"}],
                "size": limit,
                "_source": source_fields,
            }

        joined = " ".join(expanded_terms)

        # BM25 bool/should: 정확한 구문 > 단어 > fuzzy
        bm25_query = {
            "bool": {
                "should": [
                    # 구문 일치 (가장 높은 가중치)
                    {
                        "multi_match": {
                            "query": joined,
                            "fields": ["title^5", "content^2", "summary^2"],
                            "type": "phrase",
                        }
                    },
                    # 단어 일치 (BM25 best_fields)
                    {
                        "multi_match": {
                            "query": joined,
                            "fields": ["title^3", "content", "summary"],
                            "type": "best_fields",
                            "operator": "or",
                        }
                    },
                    # fuzzy 오타 허용 (낮은 가중치)
                    {
                        "multi_match": {
                            "query": joined,
                            "fields": ["title^2", "content", "summary"],
                            "type": "best_fields",
                            "fuzziness": "AUTO",
                            "boost": 0.5,
                        }
                    },
                ],
                "minimum_should_match": 1,
            }
        }

        # kNN: 문서 임베딩이 있을 때만 하이브리드, 없으면 BM25만
        if embedding:
            query = bm25_query
            if recent_only:
                query = {
                    "bool": {
                        "must": [bm25_query],
                        "filter": [recent_range],
                        "boost": 0.6,
                    }
                }
            else:
                query["bool"]["boost"] = 0.6

            knn = {
                "field": "embedding",
                "query_vector": embedding,
                "k": limit,
                "num_candidates": limit * 4,
                "boost": 0.4,  # BM25 60% : kNN 40%
            }
            if recent_only:
                knn["filter"] = recent_range

            return {
                "knn": knn,
                "query": query,
                "size": limit,
                "_source": source_fields,
            }
        else:
            query = bm25_query
            if recent_only:
                query = {
                    "bool": {
                        "must": [bm25_query],
                        "filter": [recent_range],
                    }
                }
            return {
                "query": query,
                "sort": [{"_score": "desc"}, {"published_at": "desc"}],
                "size": limit,
                "_source": source_fields,
            }

    async def _fetch_news_es(
        self,
        keywords: List[str],
        limit: int = RAG_NEWS_LIMIT,
        recent_only: bool = True,
    ) -> List[dict]:
        """ES 뉴스 검색: 유사어 확장 + BM25 bool/should + kNN 하이브리드"""
        if not self.es_client:
            return []
        try:
            # 1. 유사어 확장
            expanded = self._expand_keywords(keywords) if keywords else []

            # 2. 쿼리 임베딩 생성 (Bedrock 사용 가능 + 키워드 있을 때)
            embedding = None
            if keywords:
                query_text = " ".join(expanded)
                embedding = await self._generate_query_embedding(query_text)

            # 3. ES 검색 바디 구성 및 실행
            body = self._build_es_body(expanded, embedding, limit, recent_only=recent_only)
            resp = await self.es_client.search(index=self.settings.ELASTICSEARCH_INDEX, body=body)

            # 4. kNN 사용했지만 결과 없으면 (문서 임베딩 미존재) BM25 단독 재시도
            if embedding and not resp["hits"]["hits"]:
                logger.info("kNN 결과 없음 (문서 임베딩 미존재), BM25 단독 재시도")
                body_bm25 = self._build_es_body(expanded, None, limit, recent_only=recent_only)
                resp = await self.es_client.search(index=self.settings.ELASTICSEARCH_INDEX, body=body_bm25)

            news_list = []
            for hit in resp["hits"]["hits"]:
                src = hit["_source"]
                body_text = src.get("summary") or src.get("content") or ""
                body_truncated = (
                    body_text[:RAG_NEWS_BODY_MAX_CHARS] + "..."
                    if len(body_text) > RAG_NEWS_BODY_MAX_CHARS
                    else body_text
                )
                pub_at = str(src.get("published_at", ""))[:10]
                news_list.append({
                    "title": src.get("title", ""),
                    "body": body_truncated,
                    "source": src.get("press") or src.get("source", ""),
                    "published_at": pub_at,
                    "url": src.get("finance_origin_link") or src.get("url"),
                })

            mode = "hybrid(BM25+kNN)" if embedding else "BM25"
            if not news_list and recent_only:
                return await self._fetch_news_es(keywords, limit=limit, recent_only=False)
            logger.info("ES 뉴스 검색 성공: %d건 | mode=%s | expanded=%s", len(news_list), mode, expanded[:5])
            return news_list
        except Exception as e:
            logger.warning("ES 뉴스 검색 실패, MongoDB fallback: %s", e)
            return []

    async def _fetch_portfolio(self, user_id: str) -> tuple[List[dict], bool]:
        """MariaDB ???? (MongoDB fallback)"""
        try:
            # FX rate (KRW base)
            try:
                usd_to_krw = await get_exchange_rate("USD", "KRW")
            except Exception:
                usd_to_krw = 1.0

            # 1) MariaDB
            try:
                items = await get_user_portfolios(int(user_id))
                if items:
                    portfolio = []
                    for item in items:
                        currency = (item.currency or "KRW").upper()
                        avg_price = float(item.avg_buy_price or 0)
                        cur_price = avg_price  # ???? API? ??

                        if currency == "USD":
                            avg_price = avg_price * usd_to_krw
                            cur_price = cur_price * usd_to_krw
                            currency = "KRW"

                        portfolio.append({
                            "name": item.asset_name or "",
                            "symbol": item.asset_code or "",
                            "asset_type": item.asset_type or "",
                            "quantity": float(item.quantity or 0),
                            "average_price": avg_price,
                            "current_price": cur_price,
                            "currency": currency,
                        })
                    return portfolio, False
            except Exception as e:
                logger.warning("MariaDB portfolio lookup failed, trying MongoDB: %s", e)

            # 2) MongoDB fallback
            assets_col = get_assets_collection()
            if assets_col is None:
                return [], True

            cursor = assets_col.find({"user_id": user_id})
            portfolio = []
            async for doc in cursor:
                currency = (doc.get("currency") or "KRW").upper()
                avg_price = doc.get("average_price", 0)
                cur_price = doc.get("current_price", 0)

                if currency == "USD":
                    avg_price = avg_price * usd_to_krw
                    cur_price = cur_price * usd_to_krw
                    currency = "KRW"

                portfolio.append({
                    "name": doc.get("name", ""),
                    "symbol": doc.get("symbol", ""),
                    "asset_type": doc.get("asset_type", ""),
                    "quantity": doc.get("quantity", 0),
                    "average_price": avg_price,
                    "current_price": cur_price,
                    "currency": currency,
                })
            return portfolio, False
        except Exception as e:
            logger.warning("Portfolio fetch failed: %s", e)
            return [], True

    def _build_price_context(self, prices: Dict[str, dict]) -> str:
        """Build price RAG context (ASCII safe)."""
        if not prices:
            return ""

        lines = ["[PRICE DATA]"]
        for key, data in prices.items():
            name = data.get("label") or COIN_NAMES.get(key, key)
            price = data.get("price", 0)
            change = data.get("change_percent")
            volume = data.get("volume", 0)
            if isinstance(change, (int, float)):
                change_str = f"+{change:.2f}" if change >= 0 else f"{change:.2f}"
                if data.get("kind") == "crypto":
                    lines.append(f"- {name}: {price:,.0f} ({change_str}%), volume {volume:,.2f}")
                else:
                    lines.append(f"- {name}: {price:,.2f} ({change_str}%)")
                continue

            abs_change = data.get("change")
            if isinstance(abs_change, (int, float)):
                change_str = f"+{abs_change:,.2f}" if abs_change >= 0 else f"{abs_change:,.2f}"
                lines.append(f"- {name}: {price:,.2f} (change {change_str})")
            else:
                lines.append(f"- {name}: {price:,.2f}")

        return "\n".join(lines)

    def _build_news_context(self, news_list: List[dict]) -> str:
        """Build news RAG context (ASCII safe)."""
        if not news_list:
            return ""

        lines = ["\n[NEWS]"]
        for i, news in enumerate(news_list, 1):
            lines.append(
                f"{i}. [{news.get('published_at', '')}]"
                f" '{news.get('title', '')}' ({news.get('source', '')})"
            )
            body = news.get("body") or ""
            if body:
                lines.append(f"   Summary: {body}")

        return "\n".join(lines)

    def _build_portfolio_context(
        self,
        portfolio: List[dict],
        prices: Dict[str, dict],
        portfolio_fetch_failed: bool = False,
    ) -> str:
        """????RAG ? ?"""
        if portfolio_fetch_failed:
            return "\n[PORTFOLIO]\n- Portfolio lookup failed. Continue analysis without holdings data."

        if not portfolio:
            return ""

        lines = ["\n[??????"]
        total_eval = 0
        total_invested = 0

        for asset in portfolio:
            name = asset["name"] or asset["symbol"]
            qty = asset["quantity"]
            avg = asset["average_price"]
            cur = asset["current_price"]

            #  ? ????? ??
            for ticker, price_data in prices.items():
                if asset["symbol"].upper() in ticker.upper():
                    cur = price_data.get("price", cur)

            invested = avg * qty
            evaluation = cur * qty
            total_invested += invested
            total_eval += evaluation

            if avg > 0:
                profit_pct = ((cur - avg) / avg) * 100
                profit_str = f"+{profit_pct:.1f}" if profit_pct >= 0 else f"{profit_pct:.1f}"
            else:
                profit_str = "N/A"

            asset_type_kr = {"crypto": "암호화폐", "stock": "주식", "etf": "ETF"}.get(
                asset["asset_type"], asset["asset_type"]
            )
            lines.append(
                f"- {name}({asset['symbol']}): {qty}개, 평균가 {avg:,.0f}, 현재가 {cur:,.0f} ({profit_str}%) [{asset_type_kr}]"
            )

        if total_invested > 0:
            total_profit_pct = ((total_eval - total_invested) / total_invested) * 100
            total_str = f"+{total_profit_pct:.1f}" if total_profit_pct >= 0 else f"{total_profit_pct:.1f}"
        else:
            total_str = "N/A"

        lines.append(
            f"총 투자금: {total_invested:,.0f} | 총 평가금: {total_eval:,.0f} | 총 수익률: {total_str}%"
        )

        return "\n".join(lines)

    def _build_sources(
        self,
        prices: Dict[str, dict],
        news_list: List[dict],
        portfolio: Optional[List[dict]] = None,
        portfolio_fetch_failed: bool = False,
    ) -> List[dict]:
        """?? ?? ??"""
        sources: List[dict] = []

        if prices:
            for ticker in prices.keys():
                name = COIN_NAMES.get(ticker, ticker)
                sources.append({
                    "type": "price",
                    "title": f"{name} ??? ?? (Upbit)",
                })

        for news in news_list[:3]:
            sources.append({
                "type": "news",
                "title": news.get("title", "")[:40],
                "url": news.get("url"),
            })

        if portfolio:
            sources.append({
                "type": "portfolio",
                "title": f"?? ?? {len(portfolio)}?? ??",
            })
        elif portfolio_fetch_failed:
            sources.append({
                "type": "portfolio",
                "title": "Portfolio lookup failed (no holdings context)",
            })

        return sources

    def _generate_mock_response(self, query: str, prices: Dict[str, dict]) -> str:
        """Mock ? ? (Bedrock ???Fallback)"""
        query_lower = query.lower()

        if any(kw in query_lower for kw in ["가격", "시세", "얼마", "현재"]):
            if prices:
                ticker = list(prices.keys())[0]
                data = prices[ticker]
                name = COIN_NAMES.get(ticker, ticker)
                price = data.get("price", 0)
                change = data.get("change_percent", 0)
                change_str = f"+{change:.2f}" if change >= 0 else f"{change:.2f}"
                return f"현재 **{name}** 가격은 {price:,.0f} ({change_str}%) 입니다.\n\n본 정보는 투자 조언이 아닙니다."

        return "안녕하세요. tutum AI 금융 어시스턴트입니다. 현재 Mock 모드로 동작 중입니다.\n\n본 정보는 투자 조언이 아닙니다."

    async def _call_bedrock_stream(self, user_message: str) -> AsyncGenerator[str, None]:
        """Bedrock InvokeModelWithResponseStream ?"""
        invoke_timeout = int(getattr(self.settings, "BEDROCK_INVOKE_TIMEOUT_SECONDS", 30))
        chunk_timeout = int(getattr(self.settings, "BEDROCK_STREAM_CHUNK_TIMEOUT_SECONDS", 30))

        body = json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": self.settings.BEDROCK_MAX_TOKENS,
            "temperature": self.settings.BEDROCK_TEMPERATURE,
            "system": SYSTEM_PROMPT,
            "messages": [
                {"role": "user", "content": user_message}
            ]
        })

        response = await asyncio.wait_for(
            asyncio.to_thread(
                self.bedrock_client.invoke_model_with_response_stream,
                modelId=self.settings.BEDROCK_MODEL_ID,
                contentType="application/json",
                accept="application/json",
                body=body,
            ),
            timeout=invoke_timeout,
        )

        stream = response.get("body")
        stream_iter = iter(stream)
        while True:
            event, done = await asyncio.wait_for(
                asyncio.to_thread(_next_stream_event, stream_iter),
                timeout=chunk_timeout,
            )
            if done:
                break
            chunk = event.get("chunk")
            if chunk:
                data = json.loads(chunk.get("bytes").decode())
                if data.get("type") == "content_block_delta":
                    delta = data.get("delta", {})
                    if delta.get("type") == "text_delta":
                        yield delta.get("text", "")

    async def chat_stream(
        self,
        message: str,
        conversation_id: Optional[str] = None,
        user_id: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """SSE stream response"""

        conv_id = conversation_id or str(uuid.uuid4())
        msg_id = str(uuid.uuid4())

        # 1. Start event
        yield f"event: start\ndata: {json.dumps({'conversation_id': conv_id, 'message_id': msg_id})}\n\n"

        # 2. RAG: keywords -> prices/news/portfolio
        try:
            portfolio = []
            portfolio_fetch_failed = False
            if user_id:
                portfolio, portfolio_fetch_failed = await self._fetch_portfolio(user_id)

            tickers = self._extract_tickers(message)
            market_symbols = self._extract_market_symbols(message)
            query_keywords = self._extract_query_keywords(message)
            for symbol, _ in market_symbols:
                if symbol.lower() not in {keyword.lower() for keyword in query_keywords}:
                    query_keywords.append(symbol)
            include_portfolio_keywords = self._should_include_portfolio_keywords(
                message,
                query_keywords,
                tickers,
                market_symbols,
            )
            keywords = self._extract_keywords(
                message,
                portfolio=portfolio,
                include_portfolio_keywords=include_portfolio_keywords,
            )

            prices = await self._fetch_prices(tickers, market_symbols)

            # ES 우선 검색, 실패 시 MongoDB fallback
            news_list = await self._fetch_news_es(keywords, limit=RAG_NEWS_LIMIT)
            if not news_list:
                news_list = await self._fetch_news(keywords, limit=RAG_NEWS_LIMIT)

            sources = self._build_sources(prices, news_list, portfolio, portfolio_fetch_failed)
        except Exception as e:
            logger.error("Chat pre-processing failed: %s", e)
            yield f"event: error\ndata: {json.dumps({'message': '?? ??? ??????. ?? ? ?? ??????.'})}\n\n"
            return

        # 3. Sources event
        yield f"event: sources\ndata: {json.dumps({'sources': sources})}\n\n"

        # 4. Build context + LLM
        price_context = self._build_price_context(prices)
        news_context = self._build_news_context(news_list)
        portfolio_context = self._build_portfolio_context(portfolio, prices, portfolio_fetch_failed)
        user_message = f"{portfolio_context}\n{price_context}\n{news_context}\n\n??? ??: {message}".strip()

        # 5. Bedrock stream or Mock fallback
        if self.bedrock_client:
            try:
                async for token in self._call_bedrock_stream(user_message):
                    yield f"event: delta\ndata: {json.dumps({'content': token})}\n\n"
            except Exception as e:
                logger.error("Bedrock ?? ??: %s", e)
                response = self._generate_mock_response(message, prices)
                for word in response.split(' '):
                    yield f"event: delta\ndata: {json.dumps({'content': word + ' '})}\n\n"
                    await asyncio.sleep(0.03)
        else:
            response = self._generate_mock_response(message, prices)
            for word in response.split(' '):
                yield f"event: delta\ndata: {json.dumps({'content': word + ' '})}\n\n"
                await asyncio.sleep(0.03)

        # 6. Done event
        yield f"event: done\ndata: {json.dumps({'status': 'complete'})}\n\n"


chat_service = ChatService()
