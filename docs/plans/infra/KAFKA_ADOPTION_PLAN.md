# CloudDX Kafka 적용 계획 (주식/시세 API 중심)

기준일: 2026-02-12

## 1. 목표

- 백엔드 API가 외부 시세 API(KIS/Upbit)에 직접 의존하는 비중을 줄인다.
- Kafka 기반 비동기 파이프라인으로 수집/가공/알림을 분리한다.
- 사용자 요청 API는 캐시/저장소 기반으로 빠르게 응답한다.

## 2. 적용 원칙

- 동기 API 유지:
  - 인증/회원/포트폴리오 CRUD
  - 필수 조회 API(단, 캐시/DB 우선)
- Kafka 전환:
  - 시세 수집
  - 뉴스 수집/인덱싱
  - 가격 알림 평가
  - 집계/분석성 배치

## 3. 현재 코드 기준 적용 위치

- 시세 producer: `backend/workers/price_producer.py`
- 시세 consumer(캐시): `backend/workers/price_consumer.py`
- 뉴스 producer: `news_producer.py`
- 뉴스 elastic consumer: `elastic_consumer.py`
- API 조회 경로(개선 대상): `backend/app/routers/market.py`
- 알림 로직 연계 후보: `backend/app/services/alert_service.py`

## 4. 토픽/그룹 설계안

### 4.1 Topic

- `market.prices.raw`
- `market.alerts.triggered`
- `news.raw`
- `news.index.request`
- `news.indexed`
- `market.prices.dlq`
- `news.raw.dlq`
- `news.index.request.dlq`

### 4.2 Consumer Group

- `price-cache-consumer-group`
- `price-history-writer-group`
- `alert-evaluator-group`
- `news-indexer-group`

## 5. 메시지 스키마 초안

### 5.1 `market.prices.raw`

```json
{
  "schema_version": "1.0",
  "event_id": "uuid",
  "source": "kis|upbit",
  "symbol": "005930",
  "asset_type": "stock|crypto",
  "price": 70100.12,
  "currency": "KRW",
  "ts": "2026-02-12T03:15:00Z"
}
```

### 5.2 `market.alerts.triggered`

```json
{
  "schema_version": "1.0",
  "event_id": "uuid",
  "user_id": 123,
  "symbol": "005930",
  "rule_type": "threshold_up|threshold_down",
  "trigger_price": 70000,
  "current_price": 70100.12,
  "ts": "2026-02-12T03:15:05Z"
}
```

## 6. 단계별 구현 계획

### Phase 1 (우선순위 최고): 시세 파이프라인 안정화

- 목표:
  - 시세 조회 API를 캐시 우선 구조로 전환
- 작업:
  - `backend/workers/price_producer.py`:
    - 토픽명을 `prices` -> `market.prices.raw`로 전환
    - Mock 데이터 의존 구간 분리(TODO 명확화)
  - `backend/workers/price_consumer.py`:
    - key 전략 통일 (`price:{symbol}`)
    - `schema_version` 검증 추가
    - 실패 메시지 DLQ 발행 처리
  - `backend/app/routers/market.py`:
    - Redis 우선 조회
    - 캐시 미스 시 제한적 외부 API fallback
- 완료 기준:
  - API P95 응답 시간 감소
  - 외부 API 호출 비율 감소(캐시 hit rate 상승)

### Phase 2: 알림 분리

- 목표:
  - 가격 변동 감시를 API 프로세스에서 분리
- 작업:
  - 신규 워커 `backend/workers/alert_consumer.py`
  - `market.prices.raw` 소비 후 조건 충족 시 `market.alerts.triggered` 발행
  - 알림 저장/전달 로직과 연결(`notifications` 라우터/서비스)
- 완료 기준:
  - 알림 처리량 증가 시에도 API latency 안정

### Phase 3: 뉴스 파이프라인 정리

- 목표:
  - 뉴스 수집/인덱싱 계약 통일 및 실패 복구 체계 확립
- 작업:
  - `news_producer.py` -> `news.raw` 표준 이벤트 발행
  - `elastic_consumer.py`에서 스키마 검증/버전 분기
  - DLQ + 재처리 스크립트 도입
- 완료 기준:
  - 인덱싱 실패 데이터 유실 0에 수렴
  - 장애 시 재처리 가능

## 7. 운영/품질 체크리스트

- [ ] 브로커 모드 단일화 (KRaft 권장)
- [ ] 토픽 명명 규칙 통일 (`domain.entity.stage`)
- [ ] 메시지 스키마 버전 필드 강제
- [ ] idempotency 키 적용 (`symbol+ts` or `event_id`)
- [ ] 재시도 정책/백오프 정의
- [ ] DLQ 및 재처리 절차 문서화
- [ ] Consumer lag/실패율 모니터링 대시보드 구성
- [ ] 헬스체크 엔드포인트에 Kafka 상태 추가

## 8. 리스크와 대응

- 리스크: 토픽 전환 중 기존 consumer와 호환성 이슈
  - 대응: 이행 기간 동안 듀얼 토픽 발행 또는 브리지 consumer 운영
- 리스크: 외부 API 장애 시 price producer 실패 누적
  - 대응: circuit breaker + fallback + DLQ
- 리스크: 중복 메시지로 인한 캐시/알림 중복 처리
  - 대응: idempotency 키와 최근 처리 event_id 캐시

## 9. 즉시 실행 항목 (이번 스프린트)

1. `market.prices.raw` 토픽 도입
2. `price_consumer.py`에 스키마 검증 + DLQ 추가
3. `market.py` 캐시 우선 조회로 전환
4. 운영 문서에 토픽/그룹/재처리 절차 반영
