# 📅 개발 작업 완료 보고서 (2026-02-19)

## 📌 작업 개요
**작성자**: `kyk02405` (Kyung Yoon Kim)
**Jira Ticket**: `N/A`
**Branch**: `develop`
**작업 내용**: AI 채팅 파이프라인 고도화 - Elasticsearch 연동, BM25+kNN 하이브리드 검색, Bedrock 임베딩 활성화, 실시간 시세 패널 수정

---

## 1. 🔧 주요 변경 사항

### 1-1. ChartSidebar 실시간 시세 수정 (`frontend/components/ChartSidebar.tsx`)
- **문제**: `/portfolio/chart` 우측 패널 인기 종목 가격이 mock 데이터 고정값으로 표시됨
- **해결**: `fetchLivePrices()` 함수 추가 - 30초마다 백엔드 시세 API 폴링
  - `/api/proxy/api/v1/market/prices/stocks` (주식)
  - `/api/proxy/api/v1/market/prices/crypto` (코인)
- live 데이터 우선, 없으면 mock fallback 방식으로 구현

### 1-2. Elasticsearch 연동 (`backend/app/services/chat_service.py`)
- ES 클라이언트(`AsyncElasticsearch`) 초기화 추가
- `_ES_AVAILABLE` 플래그로 elasticsearch 패키지 미설치 시 graceful degradation
- `requirements.txt`에 `elasticsearch[async]==8.11.0` 추가
- `config.py`에 `ELASTICSEARCH_URL`, `ELASTICSEARCH_INDEX` 설정 추가

### 1-3. 유사어 확장 (Synonym Expansion)
- `FINANCIAL_SYNONYMS` 딕셔너리 구축 (35개 항목)
  - 코인: 비트코인↔BTC↔bitcoin, 이더리움↔ETH 등
  - 주식: 삼성전자↔005930↔samsung, 테슬라↔TSLA 등
  - 거시경제: 금리, 인플레이션, 반도체, AI 등
- `_expand_keywords()` 메서드로 쿼리 타임 유사어 확장

### 1-4. BM25 + kNN 하이브리드 검색 구현
- `_build_es_body()`: ES 쿼리 바디 동적 생성
  - **BM25 3단계 bool/should**: 구문일치(^5) > 단어일치(^3) > fuzzy(^0.5)
  - **kNN**: Bedrock Titan 임베딩 벡터 기반 (boost 0.4)
  - **하이브리드**: BM25(60%) + kNN(40%) 가중 결합
- `_generate_query_embedding()`: 사용자 질문을 Bedrock Titan으로 벡터화
- kNN 결과 없으면 BM25 단독 재시도 (임베딩 미존재 문서 대응)
- ES 전체 실패 시 MongoDB regex 검색으로 자동 fallback

### 1-5. Node3 Bedrock 임베딩 활성화
- `node3/.env.node3` 수정
  - `ENABLE_BEDROCK_EMBEDDING`: `0` → `1`
  - `BEDROCK_REGION`: `us-east-1` → `ap-northeast-2`
  - AWS 자격증명 추가 (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
- `docker-compose.node3.yml` consumer 섹션에 AWS 환경변수 추가
- consumer 컨테이너 재시작 → 이후 인덱싱 문서부터 임베딩 자동 생성 확인
  - 임베딩 문서: 0개 → 13개+ (증가 중)

### 1-6. AI 파이프라인 문서화 (`docs/guides/AI_PIPELINE_GUIDE.md`)
- 전체 파이프라인 흐름 다이어그램
- 각 기술 용어(Kafka, BM25, kNN, 임베딩 등) 쉬운 설명
- 하이브리드 검색 쿼리 구조 상세 설명
- 로그 확인 방법, 현재 설정값, 알려진 제한사항 포함

---

## 2. 🐛 버그 수정

### ChartSidebar 가격 고정 문제
- **문제**: 인기 종목 패널이 `allAssets` mock 데이터를 그대로 사용
- **원인**: 실시간 API 연동 없이 import한 정적 배열에서 가격을 읽음
- **해결**: `livePriceMap`, `liveChangeMap` state 추가 + 30초 폴링으로 실시간화

### Node3 consumer Bedrock 연결 실패
- **문제**: `ENABLE_BEDROCK_EMBEDDING=0`, AWS 자격증명 없음
- **원인**: `.env.node3`에 AWS 키 미설정, 리전이 `us-east-1`(ap-northeast-2 모델 미지원)
- **해결**: `.env.node3`에 키 추가, 리전 `ap-northeast-2`로 변경, docker-compose에 env 전달

---

## 3. 📸 UI 스크린샷
- ChartSidebar 실시간 시세 수정은 UI 변경이나 서버 환경에서 스크린샷 첨부 생략
- 인프라/백엔드 파이프라인 작업 위주로 UI 변경 없음

---

## 4. 📝 커밋 내역

```
feat: add live price polling to ChartSidebar (30s interval)
feat: connect Elasticsearch to chat_service with BM25+kNN hybrid search
feat: add financial synonym expansion (35 terms)
feat: add Bedrock Titan query embedding for kNN search
feat: enable Bedrock embedding on Node3 consumer
docs: add AI_PIPELINE_GUIDE.md with full pipeline explanation
```

---

## 5. 현재 파이프라인 상태

| 구성 요소 | 상태 |
|-----------|------|
| Node3 producer (뉴스 크롤링) | ✅ 정상 (60초마다 Naver+Coinness 10건) |
| Node3 Kafka | ✅ 정상 (topic: news.raw) |
| Node3 consumer (ES 인덱싱) | ✅ 정상 + 임베딩 생성 활성화 |
| Elasticsearch (Node3) | ✅ 정상 (801개+ 문서, 임베딩 증가 중) |
| chat_service ES 검색 | ✅ BM25+kNN 하이브리드 (임베딩 쌓이는 중) |
| MongoDB fallback | ✅ 정상 |
| Bedrock Claude 답변 | ✅ 정상 |

---

**✅ 결론**: AI 채팅 파이프라인이 MongoDB 단순 regex 검색에서 Elasticsearch BM25+kNN 하이브리드 검색으로 고도화됨. Node3에서 Bedrock 임베딩 생성이 활성화되어 시간이 지날수록 kNN 의미 기반 검색 품질이 향상될 예정.
