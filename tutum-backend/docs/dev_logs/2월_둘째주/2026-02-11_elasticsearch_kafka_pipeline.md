# 개발 작업 완료 보고서 (2026-02-11)

## 작업 개요
- **작성자**: `kyk02405`
- **Branch**: `develop`
- **작업 내용**: Elasticsearch + Kafka 데이터 파이프라인 구축 및 시맨틱 검색 구현

---

## 1. 주요 변경 사항

### A. Elasticsearch 활성화 (`backend/app/main.py`, `backend/app/search.py`)
- `main.py`에서 주석 처리되어 있던 ES 관련 코드 활성화
  - `connect_to_elasticsearch()` / `close_elasticsearch()` lifespan 연동
  - 헬스체크 엔드포인트에 ES 상태 추가
- `search.py` 인덱스 매핑 업데이트
  - `embedding` 필드 추가 (dense_vector, 1024차원, cosine similarity)
  - `url`, `indexed_at` 필드 추가
  - 연결 실패 시 `es_client = None` 설정하도록 안전 처리

### B. 뉴스 검색 API (`backend/app/routers/news.py`)
- `GET /api/v1/news/search` - 키워드 검색
  - ES `multi_match` + fuzzy 검색 (title^3 가중치)
  - `source`, `asset` 필터링 지원
- `GET /api/v1/news/semantic-search` - 시맨틱 검색
  - Amazon Bedrock Titan Embeddings V2 (`amazon.titan-embed-text-v2:0`)로 쿼리 벡터화
  - ES knn + keyword 하이브리드 검색
- Pydantic 모델: `SearchNewsItem`, `SearchResponse` 추가

### C. Kafka 파이프라인 - News Producer (`backend/workers/news_producer.py`)
- mock 데이터 → 실제 크롤링으로 전환
  - `crawl_naver_finance_news()`: 네이버 금융 주요뉴스 (BeautifulSoup)
  - `crawl_hankyung_news()`: 한국경제 증권 뉴스
- `extract_related_assets()`: 본문에서 종목코드/티커 자동 태깅
  - 삼성전자→005930, NVIDIA→NVDA, 비트코인→BTC 등
- `save_to_mongodb()`: URL 기반 중복 방지 후 MongoDB Atlas 저장
- `asyncio.gather()`로 병렬 크롤링, 5분 간격 반복 실행

### D. Kafka 파이프라인 - Indexer Consumer (`backend/workers/indexer_consumer.py`)
- Bedrock Titan 임베딩 통합
  - `generate_embedding_sync()` + `asyncio.get_running_loop().run_in_executor()` 비동기 래퍼
  - 임베딩 실패 시 벡터 없이 인덱싱 계속 (graceful degradation)
- URL을 ES document ID로 사용하여 중복 방지
- 메시지별 개별 에러 핸들링 (한 건 실패해도 다음 메시지 처리 계속)

### E. MariaDB Portfolio 모델 (`backend/app/mariadb.py`)
- `Portfolio` ORM 모델 추가
  - `user_id` (FK → users), `asset_code`, `asset_name`, `asset_type` (enum: stock_kr/stock_us/crypto/etf)
  - `quantity`, `avg_buy_price`, `currency`
- User ↔ Portfolio 양방향 relationship 설정
- CRUD 함수: `get_user_portfolios`, `add_portfolio_item`, `update_portfolio_item`, `delete_portfolio_item`

### F. 의존성 추가
- `backend/requirements.txt`: `elasticsearch[async]==8.11.0`, `aiokafka==0.10.0` 주석 해제
- `backend/workers/requirements.txt`: `boto3>=1.34.0`, `beautifulsoup4==4.12.3` 추가

### G. 문서 업데이트
- `docs/work-plans/2026-02-11_elasticsearch_pipeline.md`
  - Monstache → Kafka 파이프라인으로 변경
  - VM 크롤링 담당자 가이드 섹션 추가 (Kafka 메시지 스키마, 필드 설명, 주의사항)

---

## 2. 버그 수정
- `asyncio.get_event_loop()` → `asyncio.get_running_loop()` 변경
  - `news.py`, `indexer_consumer.py`에서 deprecated 호출 수정
- `search.py`: ES 연결 실패 시 `es_client`가 None으로 설정되지 않는 문제 수정

---

## 3. 아키텍처 결정
- **Monstache 도입 대신 기존 Kafka 활용**: 이미 구축된 Kafka 인프라를 사용하여 별도 도구 도입 없이 파이프라인 구성
- **폴리글랏 저장소 전략**:
  - MongoDB Atlas: 비정형 뉴스 원문
  - MariaDB: 사용자 정보 + 포트폴리오
  - Elasticsearch: 키워드 + 벡터 검색
  - Redis: 캐싱/세션

---

## 4. 커밋 내역
```
1009de5 feat: Elasticsearch + Kafka 파이프라인 구축 및 시맨틱 검색 구현
```

---

## 5. 변경 파일 목록
| 파일 | 변경 유형 |
|------|-----------|
| `backend/app/main.py` | 수정 (ES 활성화) |
| `backend/app/search.py` | 수정 (인덱스 매핑 + 안전 처리) |
| `backend/app/routers/news.py` | 수정 (검색 API 추가) |
| `backend/app/mariadb.py` | 수정 (Portfolio 모델 추가) |
| `backend/workers/news_producer.py` | 수정 (실제 크롤링 구현) |
| `backend/workers/indexer_consumer.py` | 수정 (임베딩 + 인덱싱) |
| `backend/requirements.txt` | 수정 (ES, Kafka 주석 해제) |
| `backend/workers/requirements.txt` | 수정 (boto3, bs4 추가) |
| `docs/work-plans/2026-02-11_elasticsearch_pipeline.md` | 수정 (Kafka 전환 + 가이드) |

---

**결론**: Elasticsearch + Kafka 데이터 파이프라인 end-to-end 구축 완료. 뉴스 크롤링 → Kafka 발행 → Bedrock 임베딩 → ES 인덱싱 → 키워드/시맨틱 하이브리드 검색까지 전체 흐름 구현. MariaDB Portfolio 모델도 추가하여 AI 분석 시 사용자별 종목 조회 가능.
