# 현재 API 아키텍처 맵 (코드 기준)

작성일: 2026-02-19  
기준: `clouddx-project` 현재 코드 스캔 결과

## 1) 한눈에 보는 구조

```text
[Frontend (Next.js)]
  - app/components/hooks/context
  - /api/proxy/[...path] (백엔드 프록시)
  - /api/public/news (뉴스 전용 BFF)
            |
            v
[Backend (FastAPI, /api/v1/*)]
  - routers: auth, portfolio, assets, market, news, transactions, notifications, chat
  - services: market_data, stock_search, chat_service, exchange_rate, alert_service
            |
            +--> MariaDB (users, portfolios)
            +--> MongoDB (news, assets, transactions, email_verification_tokens)
            +--> Redis (session/refresh/portfolio/price cache, monitor state)
            +--> Kafka prices topic (workers producer/consumer)
            +--> Elasticsearch(news index, chat RAG 검색)
            +--> External API (KIS, Upbit, 환율, KRX/SEC/CoinGecko, OAuth)
```

## 2) 엔드포인트-사용처 매핑

| 기능 영역 | 프론트 사용 위치 | 호출 경로 | 백엔드 라우터 | 주 저장소/서비스 |
|---|---|---|---|---|
| 인증 | `frontend/contexts/AuthContext.tsx`, `frontend/app/login/page.tsx` | `/api/proxy/api/v1/auth/*` | `backend/app/routers/auth.py` | MariaDB + Redis + SQS + Mongo(token) |
| 포트폴리오(신규) | `frontend/context/AssetContext.tsx` | `/api/proxy/api/v1/portfolio*` | `backend/app/routers/portfolio.py` | MariaDB |
| 자산(레거시) | `frontend/app/confirm-input/page.tsx`, `frontend/components/SellAssetDialog.tsx` | `http://localhost:8000/api/v1/assets*` | `backend/app/routers/assets.py` | MongoDB + 시세 API |
| 시세/검색 | `AssetContext`, `ChartSidebar`, `Watchlist*` | `/api/proxy/api/v1/market/*` | `backend/app/routers/market.py` | Redis(cache) + KIS/Upbit + stock_search |
| 추천 뉴스 | `frontend/components/PersonalizedNewsCarousel.tsx` -> `frontend/app/api/public/news/route.ts` | `/api/public/news?mode=recommended` -> `/api/v1/news/recommended` | `backend/app/routers/news.py` | MariaDB(portfolio) + Mongo(news) |
| 일반 뉴스 | `frontend/components/NewsSection.tsx` -> `frontend/app/api/public/news/route.ts` | `/api/public/news` -> `/api/v1/news` | `backend/app/routers/news.py` | Mongo(news) |
| 거래내역/분석 | `frontend/app/portfolio/trading-analysis/page.tsx` | `/api/v1/transactions*` | `backend/app/routers/transactions.py` | Mongo(transactions) |
| 알림 | `frontend/components/PortfolioHeader.tsx` | `.../api/v1/notifications` | `backend/app/routers/notifications.py` | in-memory + Redis(alert state) |
| AI 채팅 | `frontend/hooks/useChat.ts` | `/api/proxy/api/v1/chat` (SSE) | `backend/app/routers/chat.py` | Bedrock + ES/Mongo RAG + MariaDB portfolio |

## 3) 핵심 흐름

### A. `/portfolio/asset` 화면

1. 보유자산 로드: `AssetContext`가 `GET /api/v1/portfolio` 호출  
2. 실시간 시세: `WS /api/v1/market/ws?symbols=...` 구독  
3. WS 실패 시 REST 폴백:  
   - `GET /api/v1/market/prices/stocks`  
   - `GET /api/v1/market/prices/crypto`  
   - `GET /api/v1/market/exchange-rate`  
4. 추천 뉴스: `PersonalizedNewsCarousel`가 `GET /api/public/news?mode=recommended` 호출

### B. 사용자 자산 기반 추천 뉴스

파일: `backend/app/routers/news.py`

1. 현재 사용자 포트폴리오 조회: `get_user_portfolios` (MariaDB)
2. 노출금액(수량 x 평단) 기준 상위 종목 추출
3. 종목명/코드 + 동의어 확장(예: 삼성전자/005930, 애플/AAPL, MSFT 등)
4. Mongo `news` 컬렉션에서 정규식 매칭
5. `term hit 수 + 최신성` 기준 정렬 후 반환
6. 실패/미일치 시 최신 뉴스로 fallback (`is_fallback=true`)

### C. 시세 API의 캐시 우선 전략

파일: `backend/app/routers/market.py`

1. `price:{symbol}` Redis 캐시 조회
2. 캐시 hit면 `source=cache`
3. miss면 외부 API 직접 호출
   - 주식: KIS (`market_data.kis_client`)
   - 코인: Upbit (`market_data.crypto_client`)
4. 응답 `source=api`

### D. Kafka -> Redis -> Market API 경로

파일:
- `backend/workers/price_producer.py`
- `backend/workers/price_consumer.py`
- `backend/app/routers/market.py`

흐름:
1. producer가 `prices` 토픽으로 발행
2. consumer가 수신 후 Redis `price:{symbol}` TTL 30초 저장
3. market 라우터가 동일 키를 읽어 API 응답에 사용

중요:
- 현재 producer 구현은 `TODO` 상태이며 mock 가격을 발행함

### E. AI 채팅 RAG 경로

파일: `backend/app/services/chat_service.py`

1. 사용자 질문 수신 (`POST /api/v1/chat`, SSE)
2. 포트폴리오 조회 (MariaDB 우선, Mongo fallback)
3. 키워드 추출 (질문 + 포트폴리오 종목)
4. 뉴스 검색:
   - ES(BM25 + 선택적 kNN 임베딩) 우선
   - 실패 시 Mongo 뉴스 fallback
5. Bedrock 스트리밍 응답 생성
6. `event: sources`, `event: delta`, `event: done` 순서로 반환

## 4) 저장소 책임 분리(현재 코드)

| 저장소 | 실제 사용 |
|---|---|
| MariaDB | 사용자 계정, 포트폴리오 (`users`, `portfolios`) |
| MongoDB | 뉴스, 거래내역, 레거시 자산, 이메일 인증 토큰 |
| Redis | 세션/리프레시 토큰, 포트폴리오 캐시, 시세 캐시, 알림 상태 |
| Kafka | 시세 이벤트 토픽(`prices`) |
| Elasticsearch | 채팅 RAG 뉴스 검색 인덱스(`news`) |

## 5) 현재 코드 기준 불일치/정리 포인트

1. 포트폴리오 API 이원화
- `portfolio` 라우터(MariaDB)와 `assets` 라우터(MongoDB)가 동시에 사용됨
- 화면/기능별로 서로 다른 저장소를 타고 있어 데이터 일관성 관리가 필요

2. 매도 API 경로 혼재
- `AssetContext`는 `portfolio` 기반인데 `SellAssetDialog`는 `assets/{id}/sell` 호출

3. 트레이딩 분석 페이지 경로
- `frontend/app/portfolio/trading-analysis/page.tsx`는 `/api/v1/...`를 직접 호출(프록시 미사용)
- 같은 페이지에서 `/api/v1/chat/bedrock` 호출하지만 백엔드 라우터에는 해당 엔드포인트가 없음 (`/api/v1/chat`만 존재)

4. 시세 워커 데이터 신뢰도
- Kafka producer가 mock 가격 발행 중이므로 Redis 캐시 기반 응답이 실제 시세와 다를 수 있음

5. 인증 검증 플로우 점검 필요
- `auth.py`는 `user.is_verified`를 참조하지만 `mariadb.py` User 모델 정의에서 필드 확인 필요

## 6) 빠른 검증 체크리스트

```bash
# 백엔드 라우터 목록 확인
rg "app.include_router|@router\\.(get|post|put|patch|delete|websocket)" backend/app -n

# 프론트 API 호출 위치 확인
rg "/api/v1|/api/proxy|/api/public/news" frontend -n

# market cache key 확인(실행 중)
docker exec -it clouddx-redis redis-cli KEYS "price:*"

# Kafka 토픽 확인(실행 중)
docker exec -it clouddx-kafka kafka-topics --bootstrap-server localhost:9092 --list
```

## 7) 2026-02-19 Node1 런타임 점검 결과

- 백엔드 컨테이너 재생성 후 환경변수 정상 반영 확인
  - `SECRET_KEY`, `MARIADB_PASSWORD`, `REDIS_URL=redis://redis:6379`
- 백엔드 헬스체크 정상
  - `GET /health` -> `{"status":"alive"}`
  - `GET /ready` -> `{"status":"ready","services":{"mongodb":"connected","mariadb":"connected","redis":"connected"}}`
- 추천뉴스 데이터 상태 확인 (1차)
  - Node1 로컬 Mongo `clouddx.news` 문서 수: `0`
  - Node1 Mongo DB: `admin`, `config`, `local` (앱 뉴스 데이터 미적재)
- 추천뉴스 데이터 소스 전환 (2차)
  - 조치: `docker-compose.yml` backend의 `MONGODB_URL=mongodb://mongodb:27017` 강제값 제거
  - 결과: backend `MONGODB_URL`이 Atlas(`mongodb+srv://...`)로 반영됨
  - 검증: `GET /api/v1/news?limit=3` 응답 `total=4064` 확인
- 검색/RAG 참고 상태
  - Node1 `localhost:19200` Elasticsearch 연결 거부
  - 채팅 RAG는 ES 실패 시 Mongo fallback 경로를 탐 (Atlas 연결 상태에 의존)

---

이 문서는 "현재 코드에 구현된 실제 호출 경로" 기준이며, 인프라 노드 상태와 무관하게 구조 점검용으로 사용하면 됩니다.
