🏗️ AI 자산 관리 프로젝트 데이터 파이프라인
1. 데이터 수집 및 원천 저장 (Collection & Raw Storage)
컴포넌트: Python Crawler + MongoDB Atlas

흐름: 크롤러가 금융 뉴스 및 ETF 정보를 수집 → MongoDB Atlas에 원문(Raw Data) 저장.

선택 근거: 뉴스 데이터의 비정형 특성을 수용하기 위해 스키마가 자유로운 NoSQL을 선택했습니다. (50GB 용량 활용)

2. 서비스 운영 데이터 저장 (Structured Storage)
컴포넌트: MariaDB

흐름: 회원가입 정보, 개인별 포트폴리오(종목, 수량), AI 분석 이력 저장.

선택 근거: 금융 서비스 특성상 데이터 무결성이 중요한 사용자 정보는 RDBMS인 MariaDB에서 관리하는 '폴리글랏 저장소' 전략을 채택했습니다.

3. 실시간 동기화 및 가공 (Sync & Transform)
컴포넌트: Apache Kafka (KRaft + Producer/Consumer)

흐름: 크롤러(news_producer)가 수집한 뉴스를 Kafka 토픽("news")에 발행 → indexer_consumer가 소비하여 Elasticsearch에 인덱싱.

선택 근거: 이미 프로젝트에 Kafka 인프라(KRaft, Producer, Consumer)가 구축되어 있으므로 별도의 Monstache 도입 없이 기존 파이프라인을 활용합니다. Kafka는 메시지 내구성(durability)과 재처리(replay)가 가능하여 데이터 유실 방지에 유리하고, Consumer를 확장하여 임베딩 변환 등 추가 가공 단계를 유연하게 삽입할 수 있습니다.

4. 고속 검색 및 벡터 엔진 (Search & Vector Engine)
컴포넌트: Elasticsearch (ES)

흐름: * 키워드 검색: 주식 종목명, 티커(Ticker) 등 정확한 단어 매칭.

벡터 검색: 뉴스 본문의 의미(Semantic)를 벡터화하여 저장.

선택 근거: 오타 교정(Fuzzy Search)과 의미 기반 검색을 결합한 하이브리드 검색을 통해 RAG 답변의 정확도를 극대화합니다.

5. AI 분석 및 서비스 제공 (Intelligence Layer)
컴포넌트: Amazon Bedrock (Claude 3.5 Sonnet)

흐름: 1. 사용자가 분석 요청을 하면 백엔드가 MariaDB에서 사용자 포트폴리오를 읽어옴. 2. 해당 종목 키워드로 ES에서 관련 최신 뉴스를 검색. 3. 뉴스 조각들을 Bedrock에 전달하여 맞춤형 자산 분석 리포트 생성 및 전송.

⚠️ 현재 가장 시급한 체크리스트
Kafka 파이프라인 활성화: news_producer의 실제 크롤링 로직 구현 및 indexer_consumer의 ES 인덱싱 로직을 점검하여 end-to-end 파이프라인을 동작시켜야 합니다.

Elasticsearch 활성화: main.py에서 주석 처리된 ES 관련 코드를 해제하고, 인덱스 매핑(키워드 + 벡터 필드)을 확정해야 합니다.

Embedding 전략: S3를 쓰지 않기로 하셨으므로, Python 백엔드(LangChain 등)에서 Bedrock API를 직접 호출하여 ES에 벡터 데이터를 밀어넣는 코드를 구성해야 합니다.

MariaDB 설계: 사용자 포트폴리오 테이블이 잘 짜여 있어야 AI가 정확히 "어떤 종목"을 분석할지 판단할 수 있습니다.

---

## 📋 VM 크롤링 담당자 가이드

### Kafka 메시지 스키마 (토픽: "news")
Producer가 Kafka에 발행하는 JSON 포맷입니다. **이 구조를 반드시 맞춰주세요.**

```json
{
  "title": "기사 제목 (필수)",
  "content": "기사 본문 전체 텍스트 (필수)",
  "summary": "요약 200자 이내 (필수)",
  "source": "출처명 - 네이버 금융 | 한국경제 등 (필수)",
  "url": "기사 원문 URL (필수 - 중복 방지 키로 사용됨)",
  "published_at": "2026-02-11T09:30:00 ISO 8601 형식 (필수)",
  "tags": ["finance", "stock"],
  "related_assets": ["005930", "NVDA"]
}
```

### 필드별 상세

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| title | string | O | 기사 제목 |
| content | string | O | 본문 (길어도 OK, ES에서 text로 인덱싱) |
| summary | string | O | 본문 요약 (최대 200자) |
| source | string | O | 출처 (keyword로 필터링에 사용) |
| url | string | O | **중복 방지 키** - indexer가 이걸 ES doc ID로 씀 |
| published_at | string | O | ISO 8601 날짜 형식 |
| tags | string[] | - | 분류 태그 (자유 형식) |
| related_assets | string[] | - | 관련 종목코드/티커 (005930, NVDA 등) |

### 주의사항

1. **url 필드가 핵심** - indexer_consumer가 URL을 ES document ID로 사용하여 중복을 방지합니다. 같은 URL의 뉴스는 덮어쓰기됩니다.

2. **ES 인덱스를 기존에 만들었다면 삭제 후 재생성 필요**
   - embedding 벡터 필드(1024차원)가 추가됨
   - VM에서 실행: `curl -X DELETE "localhost:9200/news"` → indexer_consumer 재시작하면 자동 생성

3. **workers 의존성 변경**
   ```bash
   pip install -r backend/workers/requirements.txt
   ```
   추가된 패키지: `beautifulsoup4==4.12.3`

4. **직렬화 방식**: JSON UTF-8 (한글 지원)
   ```python
   value_serializer=lambda v: json.dumps(v, ensure_ascii=False).encode("utf-8")
   ```

### 데이터 흐름 요약
```
[VM 크롤러] → MongoDB Atlas (원문 보관)
     ↓
Kafka "news" 토픽 발행
     ↓
indexer_consumer (자동 소비)
     ↓
Elasticsearch "news" 인덱스 (키워드 + 벡터 검색)
```
