# Kafka 이전 가이드 (API/Worker 중심)

이 문서는 팀 인프라 설계자가 `clouddx-project`의 Kafka 확장 구조를 빠르게 설계할 수 있도록,
현재 사용 현황과 Kafka 이전 우선순위, 토픽/컨슈머 그룹 설계 기준을 정리한 가이드입니다.

## 1. 현재 Kafka 사용 현황 (코드 기준)

### 1.1 운영 중인 파이프라인
- `backend/workers/news_producer.py`
  - 뉴스 크롤링 결과를 `news` 토픽으로 발행
- `backend/workers/indexer_consumer.py`
  - `news` 토픽 소비 -> Elasticsearch `news` 인덱싱
- `backend/workers/price_producer.py`
  - 시세를 `prices` 토픽으로 발행
- `backend/workers/price_consumer.py`
  - `prices` 토픽 소비 -> Redis 캐시 업데이트

### 1.2 compose 반영 상태
- `frontend/docker-compose.yml`에 Kafka(KRaft) 및 아래 워커 서비스 존재
  - `price-producer`
  - `news-producer`
  - `indexer-consumer`
- `price_consumer.py` 코드는 있으나 compose 서비스 등록은 없음 (추가 필요)

### 1.3 API 계층 현황
- Backend API는 Kafka를 "직접 동기 처리"에 사용하지 않음
- OCR API(`backend/app/ocr-api/app/main.py`)는 `KAFKA_AVAILABLE = False`로 비활성

## 2. Kafka로 이전/확장하면 좋은 영역

### 2.1 1순위: 무거운 비동기 작업 큐
- 대상
  - OCR 처리
  - 리포트 생성
  - 뉴스 요약/임베딩 생성
- 이유
  - API p95 지연 감소
  - 재시도/백프레셔/수평 확장이 쉬움
- 권장 토픽
  - `ai.jobs.request`
  - `ai.jobs.result`
  - `ai.jobs.dlq`

### 2.2 2순위: 알림 이벤트 분리
- 대상
  - 가격 급등락, 조건 충족, 관심 종목 관련 뉴스 발생
- 이유
  - 알림 채널(푸시/이메일/슬랙) fan-out 분리
- 권장 토픽
  - `alert.events`
  - `alert.delivery`
  - `alert.dlq`

### 2.3 3순위: 감사 로그/분석 이벤트
- 대상
  - 로그인 성공/실패, 자산 CRUD, AI 분석 실행
- 이유
  - 보안 감사 추적성 + 행동 데이터 기반 기능 개선
- 권장 토픽
  - `audit.events`
  - `user.events`

### 2.4 4순위: 캐시 무효화 이벤트
- 대상
  - 자산/뉴스/알림 상태 변경 시 Redis key invalidation
- 이유
  - 멀티 서비스 환경에서 캐시 정합성 확보
- 권장 토픽
  - `cache.invalidate`

## 3. API에 Kafka 적용 원칙

### 3.1 적용 원칙
- 동기 API(즉시 조회/인증)는 REST + DB/Redis 직접 조회 유지
- 느린 작업은 API가 Kafka에 위임하고 `202 Accepted + job_id` 반환

### 3.2 권장 요청 처리 플로우
1. API가 요청 검증 + `job_id` 생성
2. Kafka `*.request` 토픽에 이벤트 발행
3. Worker 소비 후 처리 결과를 DB 저장 또는 `*.result` 발행
4. API는 `GET /jobs/{job_id}`로 상태 조회 제공

### 3.3 반드시 필요한 안정성 장치
- Idempotency key (`event_id`, `job_id`) 기반 중복 처리 방지
- DLQ + 재시도 정책(지수 백오프)
- 스키마 버전(`schema_version`) 필드 유지
- 프로듀서 `acks=all`, 적절한 retry 설정

## 4. 권장 토픽/컨슈머 그룹 설계안

| 도메인 | Topic | Producer | Consumer Group | 비고 |
|---|---|---|---|---|
| 뉴스 수집 | `news` | `news-producer` | `indexer-consumer-group` | 기존 운영 |
| 시세 원본 | `prices.raw` | `price-producer` | `price-normalizer-group` | 기존 `prices`를 점진 전환 권장 |
| 시세 정규화 | `prices.normalized` | `price-normalizer` | `price-cache-group`, `signal-engine-group` | 캐시/신호 분리 |
| AI 작업 요청 | `ai.jobs.request` | backend API | `ai-worker-group` | OCR/요약/리포트 |
| AI 작업 결과 | `ai.jobs.result` | ai workers | `job-status-group` | job 상태 반영 |
| 알림 이벤트 | `alert.events` | signal-engine | `alert-router-group` | 채널 fan-out |
| 감사 로그 | `audit.events` | backend API | `audit-storage-group` | append-only 권장 |
| 캐시 무효화 | `cache.invalidate` | backend API/workers | `cache-invalidator-group` | Redis 일관성 |

## 5. 메시지 스키마 가이드 (최소 표준)

### 5.1 공통 envelope
```json
{
  "event_id": "uuid-v7",
  "event_type": "ai.job.requested",
  "schema_version": "v1",
  "occurred_at": "2026-02-12T10:30:00Z",
  "producer": "backend-api",
  "trace_id": "...",
  "payload": {}
}
```

### 5.2 AI 작업 요청 예시
```json
{
  "event_id": "01J...",
  "event_type": "ai.job.requested",
  "schema_version": "v1",
  "occurred_at": "2026-02-12T10:30:00Z",
  "producer": "backend-api",
  "trace_id": "req-abc",
  "payload": {
    "job_id": "job-123",
    "user_id": "u-1",
    "job_kind": "OCR_PARSE",
    "input": {
      "object_key": "uploads/2026/02/img1.png"
    }
  }
}
```

### 5.3 DLQ 메시지 최소 필드
```json
{
  "failed_event": {"...": "원본 이벤트"},
  "error_code": "EMBEDDING_TIMEOUT",
  "error_message": "...",
  "failed_at": "2026-02-12T10:35:00Z",
  "retry_count": 3
}
```

## 6. 파티션/키/보존기간 기본 정책

- key 전략
  - `ai.jobs.*`: `job_id`
  - `prices.*`: `symbol`
  - `alert.*`: `user_id` 또는 `alert_id`
  - `audit.events`: `user_id`
- partition 수
  - 시작: 3 (개발/초기 운영)
  - 처리량 증가 시 topic별 확장
- retention
  - `prices.raw`: 1~3일
  - `prices.normalized`: 1일
  - `ai.jobs.request/result`: 7일
  - `audit.events`: 30~90일 (컴플라이언스 따라 조정)

## 7. 단계별 이전 로드맵 (권장)

### Phase 1 (빠른 적용)
- `price-consumer` compose 서비스 추가
- `prices` -> `prices.raw`/`prices.normalized` 2단계 토픽 분리
- Job status 테이블 도입 (`job_id`, `status`, `result_ref`, `error`)

### Phase 2
- OCR/리포트 요청을 `ai.jobs.request`로 이전
- API는 `202 + job_id`, worker 비동기 처리
- `ai.jobs.dlq` 운영 시작

### Phase 3
- `alert.events` + 알림 라우터 구성
- `audit.events` 수집/보관 파이프라인 구성
- `cache.invalidate` 이벤트 기반 캐시 정합성 적용

## 8. 운영 체크리스트

- 모니터링
  - consumer lag, rebalance 빈도, 처리량, 실패율
- 장애 대응
  - DLQ 적재량 임계치 알림
  - poison message 분리 및 재처리 스크립트
- 배포
  - producer/consumer 계약 변경 시 `schema_version` 증가
  - 하위 호환 기간 운영 후 구버전 제거

## 9. 팀 합의가 필요한 의사결정

- 메시지 스키마 관리 방식
  - JSON + 문서 계약 유지 vs Schema Registry 도입
- Exactly-once 수준
  - at-least-once + idempotency로 충분한지
- 토픽 naming 규칙
  - `<domain>.<entity>.<event>` 또는 `<domain>.<purpose>` 중 통일

## 10. 바로 실행 가능한 액션 아이템

1. `frontend/docker-compose.yml`에 `price-consumer` 서비스 추가
2. `docs/policies/09_KAFKA_CONTRACT.md`에 신규 토픽(`ai.jobs.*`, `alert.*`, `audit.events`) 계약 초안 추가
3. Backend API에 `POST /jobs` + `GET /jobs/{job_id}` 엔드포인트 설계 반영
4. 공통 이벤트 envelope(`event_id`, `schema_version`, `trace_id`)를 전 토픽에 적용

---
이 문서는 인프라 설계 시작점입니다. 실제 배포 시점에는 처리량/지연/SLA 기준으로 파티션 수와 리텐션을 재조정하세요.
