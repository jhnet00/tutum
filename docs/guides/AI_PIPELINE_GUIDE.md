# AI 뉴스 파이프라인 완전 가이드

> **대상 독자**: 팀원 누구나 읽고 이해할 수 있도록 기술 용어를 쉽게 풀어서 설명합니다.

---

## 전체 흐름 한눈에 보기

```
[뉴스 수집 - Node3]
  Naver Finance / Coinness / Einfomax 뉴스 사이트
        ↓ 크롤링 (60초마다)
  producer_news.py
        ↓ Kafka (택배 컨베이어벨트)
  indexer_consumer.py
        ↓ Elasticsearch 저장 + 임베딩(벡터) 생성
  ES news 인덱스 (801개+ 문서, 임베딩 증가 중)

[AI 답변 - Node1]
  사용자 채팅 입력
        ↓
  chat_service.py
    ├── 키워드 추출 + 유사어 확장
    ├── ES 검색 (BM25 + kNN 하이브리드)
    ├── 실시간 시세 조회 (Upbit API)
    ├── 포트폴리오 조회 (MariaDB)
    └── AWS Bedrock Claude → 스트림 응답
```

---

## 1단계: 뉴스 수집 (producer_news.py)

### 어디서 뉴스를 가져오나?

| 출처 | 종류 | 수집량 |
|------|------|--------|
| Naver Finance | 국내 주식·경제 뉴스 | 5건/회 |
| Coinness | 암호화폐 뉴스 | 5건/회 |
| Einfomax | 경제 전문 뉴스 | 설정 가능 (현재 비활성) |

- **수집 주기**: 60초마다 자동 실행 (`POLL_INTERVAL_SEC=60`)
- **중복 방지**: 이미 본 URL은 건너뜀 (`SEEN_FILE` 관리)

### Kafka란?

> **택배 컨베이어벨트**라고 생각하면 됩니다.
> - producer(뉴스 수집기)가 뉴스를 컨베이어벨트(Kafka)에 올려놓음
> - consumer(인덱서)가 컨베이어벨트에서 뉴스를 하나씩 꺼내서 처리
> - 처리 속도가 달라도 데이터가 유실되지 않음 (버퍼 역할)

```
producer → [Kafka topic: news.raw] → consumer
```

**Kafka 설정 (Node3)**:
- Bootstrap: `kafka:19092` (내부 통신용)
- 외부 접근: `192.168.56.13:9092`
- Topic: `news.raw`

---

## 2단계: 뉴스 저장 + 임베딩 생성 (indexer_consumer.py)

### Elasticsearch란?

> **구글 검색엔진을 우리가 직접 운영**하는 것이라고 보면 됩니다.
> 수천 개의 뉴스 문서 중에서 "비트코인"을 검색하면 관련도 높은 순서로 즉시 결과를 줍니다.

**ES 위치**: Node3 (`192.168.56.13:9200`)
**인덱스 이름**: `news`
**현재 문서 수**: 801개+ (증가 중)

### 저장되는 뉴스 문서 구조

```json
{
  "url": "https://...",
  "title": "비트코인, 사상 최고가 경신",
  "content": "비트코인이 오늘...",
  "summary": "비트코인 최고가 경신 소식",
  "source": "coinness",
  "published_at": "2026-02-19T03:00:00Z",
  "tags": ["비트코인", "BTC"],
  "embedding": [0.023, -0.114, 0.891, ...]  // 1024개 숫자 (벡터)
}
```

### 임베딩(Embedding)이란?

> **뉴스의 의미를 1024개의 숫자로 표현**한 것입니다.
>
> 예를 들어:
> - "비트코인 상승" → [0.82, 0.31, -0.12, ...]
> - "BTC 가격 올라" → [0.80, 0.29, -0.11, ...]  ← 비슷한 의미 → 숫자도 비슷함
> - "삼성전자 실적" → [-0.45, 0.67, 0.23, ...]  ← 다른 의미 → 숫자도 다름
>
> 이 숫자들의 유사도를 계산하면 **단어가 달라도 의미가 같은 문서**를 찾을 수 있습니다.

**사용 모델**: AWS Bedrock - Amazon Titan Embed Text V2
- 모델 ID: `amazon.titan-embed-text-v2:0`
- 벡터 차원: 1024
- 유사도 계산 방식: 코사인 유사도 (방향이 비슷할수록 유사)

**임베딩 활성화 여부**: `ENABLE_BEDROCK_EMBEDDING=1` (현재 활성)

---

## 3단계: AI 검색 + 답변 (chat_service.py)

### 3-1. 키워드 추출

사용자가 "비트코인 요즘 어때?" 라고 입력하면:

```python
keywords = ["비트코인"]
tickers  = ["KRW-BTC"]  # 가격 조회용
```

지원하는 키워드:
- **코인**: 비트코인(BTC), 이더리움(ETH), 리플(XRP), 솔라나(SOL)
- **주식**: 삼성전자, SK하이닉스, 네이버, 카카오, 테슬라, 엔비디아 등 17종

---

### 3-2. 유사어 확장 (Synonym Expansion)

> 사용자가 "비트코인"이라고 검색해도 "BTC", "bitcoin"이 들어간 뉴스도 함께 찾아줍니다.

```
입력: ["비트코인"]
확장: ["비트코인", "BTC", "bitcoin", "비트"]
```

**유사어 사전 (35개 항목)**:

| 입력 | 확장 결과 |
|------|-----------|
| 비트코인 | 비트코인, BTC, bitcoin, 비트 |
| 삼성전자 | 삼성전자, 삼성, 005930, samsung |
| 엔비디아 | 엔비디아, NVDA, nvidia |
| 금리 | 금리, 기준금리, 이자율, 금리인상, 금리인하 |
| 인공지능 | 인공지능, AI, 머신러닝, 딥러닝 |
| 반도체 | 반도체, chip, semiconductor, 칩 |

---

### 3-3. Elasticsearch 검색 (BM25 + kNN 하이브리드)

#### BM25란?

> **전통적인 키워드 검색 방식**입니다. 구글이 초기에 사용하던 방식과 비슷합니다.
>
> - 문서에 검색어가 많이 등장할수록 점수 높음
> - 제목에 등장하면 본문보다 가중치 높음
> - 흔한 단어("의", "는", "이")는 점수에 적게 반영

**현재 BM25 쿼리 구조 (3단계 bool/should)**:

```
검색어: "비트코인 BTC bitcoin 비트" (유사어 확장 후)

1순위 (boost x5): 제목에 정확한 구문 일치
   예) 제목에 "비트코인 급등" 이 통째로 있으면 최고 점수

2순위 (boost x3): 제목/본문에 단어 일치 (BM25 best_fields)
   예) 제목에 "비트코인", 본문에 "BTC" 각각 있으면 높은 점수

3순위 (boost x0.5): 오타 허용 검색 (fuzzy)
   예) "비트코임" 처럼 오타가 있어도 검색됨
```

#### kNN이란?

> **의미 기반 유사도 검색**입니다. 단어가 달라도 뜻이 같으면 찾아줍니다.
>
> - 사용자 질문을 임베딩(숫자 벡터)으로 변환
> - ES에 저장된 뉴스 임베딩들과 거리 계산
> - 가장 가까운(의미가 비슷한) 뉴스 k개 반환

```
질문 벡터: [0.82, 0.31, ...]  ("비트코인 전망")
문서1 벡터: [0.80, 0.29, ...]  → 거리 0.03 (매우 유사) ← 반환
문서2 벡터: [-0.45, 0.67, ...] → 거리 0.89 (다름)     ← 제외
```

#### 하이브리드 검색 (BM25 60% + kNN 40%)

> 두 방식을 함께 써서 **정확도를 극대화**합니다.

```python
# 검색 쿼리 구조
{
    "knn": {
        "field": "embedding",
        "query_vector": [0.82, 0.31, ...],  # 질문 임베딩
        "k": 5,
        "num_candidates": 20,
        "boost": 0.4   # kNN 40% 반영
    },
    "query": {
        # BM25 bool/should 쿼리
        "boost": 0.6   # BM25 60% 반영
    }
}
```

**fallback 처리**:
1. kNN 시도 → 결과 없음 (임베딩 미존재 문서) → BM25 단독 재시도
2. ES 전체 실패 → MongoDB regex 검색으로 fallback

---

### 3-4. 실시간 시세 조회

```python
tickers = ["KRW-BTC"]
prices  = await upbit_api.get_current_price("KRW-BTC")
# → { "price": 142,500,000, "change_percent": +2.3, "volume": 1234.5 }
```

**지원 코인**: BTC, ETH, XRP, SOL

---

### 3-5. 포트폴리오 조회

```
MariaDB (학원 서버) → 실패 시 → MongoDB fallback
```

조회 내용: 보유 자산명, 심볼, 수량, 평균 매수가, 현재가, 통화

---

### 3-6. Claude에게 전달하는 컨텍스트 구조

```
[내 포트폴리오]
- 비트코인(BTC): 0.5개, 평균가 130,000,000, 현재가 142,500,000 (+9.6%) [암호화폐]
총 투자금: 65,000,000 | 총 평가금: 71,250,000 | 총 수익률: +9.6%

[실시간 시세]
- 비트코인(BTC): 142,500,000 (+2.30%), volume 1,234.50

[관련 뉴스]
1. [2026-02-19] 'BoA, 스트래티지 지분 확대...비트코인 신뢰 굳건' (coinness)
   Summary: 뱅크오브아메리카가 비트코인 보유 기업...
2. [2026-02-19] '비트코인 급등, 기관 매수세 영향' (naver_finance)
   ...

사용자 질문: 비트코인 요즘 어때?
```

---

### 3-7. AWS Bedrock Claude 스트림 응답

**모델**: `anthropic.claude-3-5-sonnet-20240620-v1:0`
**응답 방식**: SSE(Server-Sent Events) 스트리밍 - 글자 단위로 실시간 전송

```
설정값:
- max_tokens: 4096
- temperature: 0.7 (창의성 수준, 0=정확, 1=창의적)
- AWS Region: ap-northeast-2 (서울)
```

**Bedrock 없을 경우**: Mock 모드로 기본 응답 반환

---

## 전체 구성 요소 요약

| 구성 요소 | 역할 | 위치 | 기술 |
|-----------|------|------|------|
| producer_news.py | 뉴스 크롤링 | Node3 Docker | Python, BeautifulSoup |
| Kafka | 메시지 큐 (버퍼) | Node3 Docker | Apache Kafka 3.9 |
| indexer_consumer.py | ES 인덱싱 + 임베딩 | Node3 Docker | Python, boto3 |
| Elasticsearch | 뉴스 검색 엔진 | Node3 Docker | ES 8.17, dense_vector |
| Kibana | ES 모니터링 UI | Node3 Docker | Kibana 8.17 |
| chat_service.py | AI 파이프라인 오케스트레이터 | Node1 (백엔드) | Python, FastAPI |
| Bedrock Titan Embed | 임베딩 생성 모델 | AWS | amazon.titan-embed-text-v2:0 |
| Bedrock Claude | AI 답변 생성 | AWS | claude-3-5-sonnet |
| MongoDB | 뉴스 fallback DB | Node2 Docker | Motor (비동기) |
| MariaDB | 포트폴리오 DB | 학원 서버 | aiomysql, SQLAlchemy |
| Redis | 가격 캐시 | Node2 Docker | redis-py |

---

## 검색 품질 향상 원리

```
초기 (임베딩 0개)
  → BM25 키워드 검색만 가능
  → "비트코인" 단어가 있는 뉴스만 검색

현재 (임베딩 증가 중)
  → BM25(60%) + kNN(40%) 하이브리드
  → "암호화폐 시장 동향" 질문에 "비트코인 급등" 뉴스도 검색됨

미래 (임베딩 풍부)
  → 의미 기반 검색 품질 극대화
  → 사용자 질문 의도에 맞는 뉴스 자동 선별
```

---

## 로그 확인 방법

### Node3 접속

```bash
ssh -p 2213 clouddx@192.168.0.28
```

### 컨테이너 상태 확인

```bash
docker ps
```

### 뉴스 수집 현황 (producer)

```bash
docker logs node3-producer --tail 20 -f
# produce: 비트코인 급등... → Kafka로 전송 중
```

### 인덱싱 + 임베딩 현황 (consumer)

```bash
docker logs node3-consumer --tail 20 -f
# [indexed] 비트코인 급등... → ES 저장 완료
```

### ES 문서 수 확인

```bash
# 전체 문서
curl http://localhost:9200/news/_count

# 임베딩 있는 문서
curl 'http://localhost:9200/news/_count?q=embedding:*'
```

### Kibana UI (브라우저에서 ES 데이터 시각화)

```
http://192.168.56.13:5601
```

---

## 현재 설정값 (.env.node3)

```env
# 뉴스 소스
ENABLE_NAVER=1          # 네이버 파이낸스 활성
ENABLE_COINNESS=1       # 코인니스 활성
ENABLE_EINFOMAX=0       # 이인포맥스 비활성

# 수집량
PRODUCER_LIMIT=5        # 소스당 5건
PRODUCER_PAGES=3        # 3페이지까지 탐색
PRODUCER_POLL_INTERVAL_SEC=60  # 60초마다 반복

# 임베딩
ENABLE_BEDROCK_EMBEDDING=1     # Bedrock 임베딩 활성
BEDROCK_REGION=ap-northeast-2  # 서울 리전
```

---

## 알려진 제한사항

| 항목 | 내용 |
|------|------|
| 기존 801개 문서 | 임베딩 없음 (kNN 미적용) → 시간이 지나면서 새 문서에는 자동 적용 |
| 임베딩 백필 | 기존 문서에 임베딩을 붙이는 별도 스크립트 미구현 |
| 로컬 개발 시 ES | SSH 터널 필요: `ssh -p 2213 -fNL 19200:localhost:9200 clouddx@192.168.0.28` |
| Einfomax | 현재 비활성 (`ENABLE_EINFOMAX=0`) |
