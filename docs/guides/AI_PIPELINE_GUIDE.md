# AI 파이프라인 운영 가이드 (K8s 기준)

기준일: 2026-02-27  
대상: 운영/개발 공용

## 1. 결론 (먼저 확인)

- 현재 운영 기준에서 맞는 구조는 **Kubernetes 매니페스트 기준**입니다.
- 현재 모드는 안정화 모드로, 뉴스 파이프라인은 아래와 같습니다.
  - `news-producer`: 활성 (`replicas: 1`)
  - `news-consumer`: 활성 (`replicas: 1`)
  - `elastic-consumer`: 비활성 (`replicas: 0`)
  - `ENABLE_BEDROCK_EMBEDDING`: `false`
- 즉, 지금은 **뉴스 수집/저장(Mongo) 중심**으로 운영되고, AI 채팅은 ES 우선 조회 후 Mongo fallback으로 동작합니다.

## 2. 현재 운영 아키텍처

```text
사용자
  -> /api/v1/chat
  -> backend chat_service
      -> 실시간 시세 조회
      -> 포트폴리오 조회(MariaDB, 실패 시 Mongo fallback)
      -> 뉴스 조회(ES 우선, 실패/결과 없음 시 Mongo fallback)
      -> Bedrock Claude 스트리밍 응답(자격증명 없으면 mock fallback)

뉴스 파이프라인
  news-producer (producer_news.py)
    -> Kafka topic: news.raw
  news-consumer (consumer_news.py)
    -> MongoDB(news 컬렉션)
  elastic-consumer (elastic_consumer.py)
    -> 현재 replicas=0 (비활성)
```

## 3. 현재 운영값 (소스 오브 트루스)

다음 파일 값을 기준으로 판단합니다.

- `news-producer` 활성: [news-producer.yaml](C:/Users/CloudDX/Documents/GitHub/clouddx-project/k8s-manifests/base/workers/news-producer.yaml)
- `news-consumer` 활성: [news-consumer.yaml](C:/Users/CloudDX/Documents/GitHub/clouddx-project/k8s-manifests/base/workers/news-consumer.yaml)
- `elastic-consumer` 비활성: [elastic-consumer.yaml](C:/Users/CloudDX/Documents/GitHub/clouddx-project/k8s-manifests/base/workers/elastic-consumer.yaml)
- 뉴스 파이프라인 설정: [news-configmap.yaml](C:/Users/CloudDX/Documents/GitHub/clouddx-project/k8s-manifests/base/workers/news-configmap.yaml)

핵심 설정:

- `KAFKA_TOPIC`: `news.raw`
- `PRODUCER_POLL_INTERVAL_SEC`: `"30"`
- `ENABLE_EINFOMAX`: `"true"`
- `ENABLE_BEDROCK_EMBEDDING`: `"false"`
- `ELASTICSEARCH_URL`: `http://elasticsearch.tutum-data.svc.cluster.local:9200`

## 4. AI 채팅 경로(코드 기준)

AI 채팅 서비스는 아래 로직으로 동작합니다.

- 위치: [chat_service.py](C:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/app/services/chat_service.py)
- 주요 흐름:
  1. 질문에서 티커/키워드 추출
  2. 시세 조회
  3. 포트폴리오 조회 (MariaDB 우선, 실패 시 Mongo)
  4. 뉴스 조회 (ES 우선, 실패/결과 없음 시 Mongo)
  5. Bedrock 스트리밍 응답 (`invoke_model_with_response_stream`)

참고: ES 검색 로직은 BM25 + (가능 시) kNN 하이브리드로 구현돼 있습니다.

## 5. 기존 문서와 실제 운영 차이

기존 설명 중 현재와 다른 대표 항목:

1. 수집 주기 60초 설명 -> 현재 30초
2. `ENABLE_EINFOMAX=0` 설명 -> 현재 `true`
3. `ENABLE_BEDROCK_EMBEDDING=1` 설명 -> 현재 `false`
4. 인덱서 상시 가동 설명 -> 현재 `elastic-consumer replicas=0`
5. Node1/Node3 Docker 중심 서술 -> 현재는 K8s 배포 기준

## 6. 어떤 방식이 맞는가

운영 기준으로는 다음이 정답입니다.

1. **기본은 안정화 모드 유지**  
   (현재 매니페스트 값 유지)
2. **풀 AI 모드는 별도 전환 절차로 활성화**  
   (검증 후 단계 반영)

## 7. 풀 AI 모드 전환 체크리스트

목표: 뉴스 인덱싱 + 임베딩 기반 검색을 상시화

1. `elastic-consumer` 활성화
   - [elastic-consumer.yaml](C:/Users/CloudDX/Documents/GitHub/clouddx-project/k8s-manifests/base/workers/elastic-consumer.yaml)  
   - `replicas: 0 -> 1`
2. 임베딩 활성화
   - [news-configmap.yaml](C:/Users/CloudDX/Documents/GitHub/clouddx-project/k8s-manifests/base/workers/news-configmap.yaml)  
   - `ENABLE_BEDROCK_EMBEDDING: "false" -> "true"`
3. AWS 자격증명 확인
   - [news-secret.yaml](C:/Users/CloudDX/Documents/GitHub/clouddx-project/k8s-manifests/base/workers/news-secret.yaml)의
     `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` 값 주입
4. 배포/동기화
   - GitOps(ArgoCD) sync 또는 `kubectl apply`
5. 롤아웃 확인
   - `kubectl -n tutum-app rollout status deploy/elastic-consumer`
6. 인덱싱/임베딩 확인
   - `kubectl -n tutum-app logs deploy/elastic-consumer --tail=200`
   - ES에서 `embedding` 필드 문서 증가 확인

## 8. 운영 검증 체크리스트

1. API 헬스
   - `GET /api/v1/chat/health` -> 200
2. 뉴스 데이터 확인
   - `GET /api/v1/news?limit=3` -> 최근 뉴스 반환
3. 파이프라인 상태
   - `kubectl -n tutum-app get deploy news-producer news-consumer elastic-consumer`
4. Kafka/DB 적재 확인
   - producer 로그에서 발행 확인
   - consumer 로그에서 Mongo upsert 확인
5. AI 응답 품질
   - 키워드 질문(예: BTC) 시 뉴스 근거 포함 응답 확인

## 9. 권장 운영 정책

1. 문서 기준은 항상 `k8s-manifests`와 실제 배포 상태로 맞춥니다.
2. 모드 변경(안정화 <-> 풀 AI)은 체크리스트/검증 로그와 함께 dev log에 기록합니다.
3. AI 관련 설정 변경은 한 번에 여러 개 바꾸지 말고
   - `replicas` -> `embedding` -> `AWS credential` 순서로 단계 적용합니다.
