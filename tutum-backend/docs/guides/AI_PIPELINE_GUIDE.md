# AI 뉴스 파이프라인 전체 흐름 가이드

기준일: 2026-03-05
대상: 운영/개발 공용
소스 오브 트루스: k8s-manifests + 실제 코드

> **2026-03-05 점검 결과: 파이프라인 전 구간 정상 작동 중**
> - MongoDB 신규 수집: 26건/시간
> - ES 임베딩 보유: 2,589건 / MongoDB 3,214건 (80.5%)
> - Bedrock 임베딩 오류 없음 (`[embed] failed` 로그 미확인)

---

## 1. 전체 아키텍처 요약

```
┌─────────────────────────────────────────────────────────────────────┐
│                         뉴스 수집 파이프라인                          │
│                                                                     │
│  [Naver Finance]  ─┐                                                │
│  [Coinness API]   ─┼─► news-producer ──► Kafka(news.raw) ─┬─► news-consumer ──► MongoDB
│  [Einfomax]       ─┘     (30s 폴링)                        │
│                                                             └─► elastic-consumer ──► Elasticsearch
│                                                                      (Bedrock 임베딩 포함)
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                          AI 응답 파이프라인                           │
│                                                                     │
│  사용자 질문                                                          │
│      │                                                              │
│      ▼                                                              │
│  키워드 추출 + 유사어 확장                                             │
│      │                                                              │
│      ├─► 실시간 시세 조회 (Exchange API)                              │
│      ├─► 포트폴리오 조회 (MariaDB → MongoDB fallback)                 │
│      └─► 뉴스 검색                                                   │
│              │                                                      │
│              ├─► ES: 하이브리드 검색 (BM25 60% + kNN 40%)            │
│              │       └─► 임베딩 없으면 BM25 단독                      │
│              └─► 실패 시 MongoDB fallback                            │
│      │                                                              │
│      ▼                                                              │
│  Bedrock Claude 스트리밍 응답 (RAG)                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 스테이지별 상세

### Stage 1: 뉴스 수집 (news-producer)

**파일**: `backend/workers/producer_news.py`
**K8s**: `k8s-manifests/base/workers/news-producer.yaml`
**폴링 주기**: 30초 (`PRODUCER_POLL_INTERVAL_SEC=30`)

#### 수집 소스 3개

| 소스 | 방식 | 키워드 필터 |
|------|------|------------|
| Naver Finance | HTML 스크래핑 (mainnews.naver, 5페이지) | 코인 관련 제목만 (`EINFOMAX_FILTER_COINS=true`) |
| Coinness | REST API 우선 → HTML fallback → sitemap fallback | 없음 (전체 코인 뉴스) |
| Einfomax | HTML 스크래핑 (쿼리: "가상자산", 3페이지) | 코인 키워드 필터 |

#### 처리 흐름

```
수집 → 중복 제거(seen_links JSON) → 시간 역순 정렬 → Kafka 발행
```

- `seen_links` 파일: Pod 재시작 시 초기화 (중복 방지가 무력화됨)
- Kafka topic: `news.raw`
- 발행 형식: JSON (url, title, content, published_at, source, crawled_at 등)

---

### Stage 2: MongoDB 저장 (news-consumer)

**파일**: `backend/workers/consumer_news.py`
**K8s**: `k8s-manifests/base/workers/news-consumer.yaml`

- Kafka `news.raw` consume (group: `clouddx-news-consumer-v1`)
- URL 기준 upsert → MongoDB `tutum.news` 컬렉션
- 중복 문서는 덮어쓰기 (title/content/published_at 변경 시)

---

### Stage 3: ES 인덱싱 + 임베딩 (elastic-consumer)

**파일**: `backend/workers/elastic_consumer.py`
**K8s**: `k8s-manifests/base/workers/elastic-consumer.yaml`
**현재 상태**: replicas=1 (활성), `ENABLE_BEDROCK_EMBEDDING=true`

#### 처리 흐름

```
Kafka consume (group: indexer-consumer-group)
    │
    ▼
normalize_message() → {url, title, content, summary, source, published_at, ...}
    │
    ▼ (ENABLE_BEDROCK_EMBEDDING=true)
Bedrock Titan v2 임베딩 생성
    모델: amazon.titan-embed-text-v2:0
    입력: title + summary + content (최대 8000자)
    출력: 1024차원 float 벡터
    │
    ▼
ES upsert (/_update/{url-encoded-id}, doc_as_upsert)
```

#### ES 인덱스 매핑

```json
{
  "url":           "keyword",
  "title":         "text",
  "content":       "text",
  "summary":       "text",
  "source":        "keyword",
  "published_at":  "date",
  "embedding":     "dense_vector(1024, cosine)"
}
```

> **주의**: Bedrock 호출 실패 시 임베딩 없이 ES 저장됨. 이 경우 kNN 검색 불가, BM25만 작동.

---

### Stage 4: AI 뉴스 검색 (chat_service)

**파일**: `backend/app/services/chat_service.py`

#### 유사어 확장 사전

사용자 입력 → 동의어 자동 확장 후 검색

```
"비트코인" → ["비트코인", "BTC", "bitcoin", "비트"]
"이더리움" → ["이더리움", "ETH", "ethereum", "이더"]
"ai"       → ["AI", "인공지능", "머신러닝"]
"금리"     → ["금리", "기준금리", "이자율", "금리인상", "금리인하"]
... (약 30개 항목)
```

#### 하이브리드 검색 (BM25 + kNN)

```
쿼리 임베딩 생성 (Bedrock Titan v2, 1024차원)
    │
    ├─ 성공 → BM25(60%) + kNN(40%) 하이브리드
    │          BM25: phrase > best_fields > fuzzy
    │          가중치: title^5/^3, content^2/1, summary^2/1
    │          kNN: cosine 유사도, k=limit, candidates=limit×4
    │
    └─ 실패/kNN 결과 없음 → BM25 단독
           (문서 임베딩이 없는 경우 자동 fallback)
```

#### ES → MongoDB Fallback

```
ES 검색 성공 → ES 결과 반환
ES 실패/결과 없음 → MongoDB text 검색 (fallback)
```

---

### Stage 5: RAG 응답 생성

```
[시스템 프롬프트] + [실시간 시세] + [포트폴리오] + [뉴스 검색 결과]
    └─► Bedrock Claude 스트리밍 응답
```

- 포트폴리오: MariaDB 우선 → MongoDB fallback
- 응답 형식: SSE 스트리밍

---

## 3. 현재 운영 설정값

| 항목 | 값 | 파일 |
|------|-----|------|
| 폴링 주기 | 30초 | news-configmap.yaml |
| ENABLE_NAVER | true | news-configmap.yaml |
| ENABLE_COINNESS | true | news-configmap.yaml |
| ENABLE_EINFOMAX | true | news-configmap.yaml |
| ENABLE_BEDROCK_EMBEDDING | **true** | news-configmap.yaml |
| BEDROCK_REGION | ap-northeast-2 | news-configmap.yaml |
| ES_INDEX | news | news-configmap.yaml |
| elastic-consumer replicas | **1 (활성)** | elastic-consumer.yaml |
| Bedrock 임베딩 모델 | amazon.titan-embed-text-v2:0 | elastic_consumer.py |
| 임베딩 차원 | 1024 | elastic_consumer.py |
| BM25:kNN 비율 | 60:40 | chat_service.py |

---

## 4. 파이프라인 점검 체크리스트

### 4-1. Pod 상태 확인

```bash
kubectl get pods -n tutum-app | grep -E "news|elastic"
```

**정상 상태:**
```
elastic-consumer-xxx   1/1  Running
news-consumer-xxx      1/1  Running
news-producer-xxx      1/1  Running
```

### 4-2. 뉴스 수집 확인 (ObjectId 기반 — 실제 삽입 시각 기준)

```bash
# 최근 1시간 MongoDB 삽입 건수
kubectl exec -n tutum-data mongodb-0 -- mongosh tutum --eval "
var oid = ObjectId.createFromTime(Math.floor((Date.now()-3600000)/1000));
print(db.news.countDocuments({_id: {\$gte: oid}}))" --quiet

# 전체 건수
kubectl exec -n tutum-data mongodb-0 -- mongosh tutum --eval "db.news.countDocuments({})" --quiet
```

### 4-3. ES 동기화 확인

```bash
# ES 문서 수
kubectl exec -n tutum-data mongodb-0 -- mongosh --eval "
var mongo = db.getSiblingDB('tutum').news.countDocuments({});
print('MongoDB:', mongo)" --quiet

curl -s http://elasticsearch.tutum-data.svc.cluster.local:9200/news/_count | python3 -c "import sys,json; d=json.load(sys.stdin); print('ES:', d['count'])"
```

### 4-4. 임베딩 생성 여부 확인

```bash
# ES에서 embedding 필드 있는 문서 수
curl -s "http://elasticsearch.tutum-data.svc.cluster.local:9200/news/_count" \
  -H "Content-Type: application/json" \
  -d '{"query":{"exists":{"field":"embedding"}}}'
```

### 4-5. Kafka Lag 확인

```bash
kubectl exec -n tutum-data kafka-0 -- kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe --group clouddx-news-consumer-v1

kubectl exec -n tutum-data kafka-0 -- kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe --group indexer-consumer-group
```

### 4-6. 로그 확인

```bash
# 수집 로그
kubectl logs -n tutum-app deploy/news-producer --tail=30

# MongoDB 저장 로그
kubectl logs -n tutum-app deploy/news-consumer --tail=30

# ES 인덱싱 + 임베딩 로그
kubectl logs -n tutum-app deploy/elastic-consumer --tail=30
```

---

## 5. 알려진 이슈 및 주의사항

| 이슈 | 원인 | 대처 |
|------|------|------|
| seen_links 초기화 | Pod 재시작 시 중복 방지 파일 소실 | Kafka upsert이므로 실제 중복 저장은 없음 |
| Bedrock 임베딩 실패 | AWS 자격증명 없거나 IAM 권한 부족 | elastic-consumer 로그에서 `[embed] bedrock invoke failed` 확인 |
| kNN 결과 0건 | 임베딩이 없는 기존 문서 | 자동으로 BM25 단독 검색으로 fallback |
| MongoDB 건수 감소 | 백업 복구 또는 컬렉션 재생성 | 백필 Job 재실행 필요 |
| ES sync rate 낮음 | elastic-consumer 이전에 수집된 뉴스 | backfill-es-job 실행으로 소급 인덱싱 |

---

## 6. 백필 (과거 데이터 ES 소급 인덱싱)

elastic-consumer 배포 이전 MongoDB 데이터는 ES에 없음.
소급 인덱싱이 필요할 경우:

```bash
# cp1에서 실행
kubectl delete job es-backfill -n tutum-app --ignore-not-found
kubectl apply -f k8s-manifests/base/workers/backfill-es-job.yaml
kubectl logs -n tutum-app -l app=es-backfill -f
```

> backfill-es-job은 kustomization.yaml에 포함되지 않음 (수동 실행 전용)

---

## 7. 풀 AI 모드 vs 안정화 모드

| 모드 | elastic-consumer | ENABLE_BEDROCK_EMBEDDING | 검색 방식 |
|------|-----------------|--------------------------|----------|
| 안정화 | replicas=0 | false | MongoDB text (fallback) |
| **풀 AI (현재)** | **replicas=1** | **true** | **BM25+kNN 하이브리드** |

모드 전환 시 dev log 기록 필수.
