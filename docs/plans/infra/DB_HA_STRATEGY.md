# MariaDB + MongoDB 이중화/고가용성(HA) 전략 가이드

이 문서는 현재 `clouddx-project`가 MariaDB(정형/핵심 데이터)와 MongoDB(문서/원본 데이터)를 분리 운영하는 구조에서,
장애 대응력과 운영 안정성을 확보하기 위한 이중화/고가용성 전략을 정리한 가이드입니다.

## 1. 왜 지금 필요한가

- DB를 이원화하면 장애 도메인도 2개로 늘어남
- 한쪽 DB 장애가 특정 기능(로그인/포트폴리오/뉴스 파이프라인 등)을 즉시 중단시킬 수 있음
- Kafka/Worker 구조를 쓰는 경우에도 최종 저장소(DB) 장애 시 파이프라인 적체가 발생함

결론: 분리 운영 자체가 맞는 선택이지만, 운영 단계에서는 DB별 HA + 백업 복구 전략이 반드시 필요합니다.

## 2. 목표 SLO/SLA 초안 (팀 합의 필요)

- MariaDB
  - RPO: 5분 이내
  - RTO: 15분 이내
- MongoDB
  - RPO: 5~15분 이내
  - RTO: 15~30분 이내
- 공통
  - 단일 노드 장애 시 서비스 전체 다운 방지
  - 정기 복구 리허설 월 1회

## 3. 권장 아키텍처

### 3.1 MariaDB (우선순위 1)

- 최소 구성
  - Primary 1
  - Read Replica 1 이상
- 권장 구성(운영)
  - Primary 1 + Replica 2 (AZ 분산)
  - ProxySQL/HAProxy 같은 DB 프록시 계층 도입
  - 자동 failover 도구(예: Orchestrator) 또는 Managed DB 사용

핵심 포인트
- 애플리케이션은 "프록시 endpoint"로만 접속
- 쓰기는 Primary, 읽기는 Replica로 분리 가능
- 복제 지연(Replication Lag) 임계치 초과 시 읽기 라우팅 제한

### 3.2 MongoDB (우선순위 2)

- 최소 구성
  - Replica Set 3노드 (Primary 1, Secondary 2)
- 비용 제약 시
  - Primary 1, Secondary 1, Arbiter 1

핵심 포인트
- 앱 connection string에 replica set 명시
- `writeConcern: majority`, `readPreference` 정책을 워크로드별 설정
- Secondary lag 모니터링과 선거(Election) 시간 측정 필수

## 4. 백업/복구 전략

### 4.1 MariaDB

- 일간 Full Backup + Binlog 보존(PITR)
- 백업 저장소 분리(다른 디스크/다른 VM/오브젝트 스토리지)
- 복구 테스트 항목
  - 특정 시점 복구(PITR)
  - Replica 재동기화 시간

### 4.2 MongoDB

- 일간 스냅샷 + Oplog 기반 시점 복구 전략
- Replica Set 재구성(runbook) 사전 문서화
- 복구 테스트 항목
  - Primary 장애 후 자동 승격 시간
  - 데이터 정합성 검증

### 4.3 공통 원칙

- 백업 파일 암호화 + 접근제어
- 보존 정책(예: 7일/30일/90일) 정의
- 복구 리허설 결과를 운영 문서에 기록

## 5. 애플리케이션 레벨 대응 (필수)

- DB timeout/retry/circuit breaker 설정
- idempotent 처리(특히 Kafka consumer)
- 장애 시 degraded mode 정의
  - 예: 뉴스 인덱싱 지연 허용, 핵심 거래/인증 기능 우선
- DB 장애가 API 전체 장애로 번지지 않도록 도메인 분리

## 6. 모니터링/알림 항목

### 6.1 MariaDB
- replication lag
- replica IO/SQL thread 상태
- deadlock/slow query 증가
- connection pool 고갈

### 6.2 MongoDB
- replication lag
- primary election 발생 횟수/시간
- oplog window
- lock/queue 지표

### 6.3 공통
- 디스크 사용량/IOPS
- CPU/메모리
- 백업 성공/실패
- failover 이벤트 감지

알림은 최소 3단계로 운영
- Warning: 추세 이상
- Critical: 장애 임박
- Emergency: 이미 장애

## 7. 장애 시 운영 Runbook (요약)

1. 장애 탐지
- 모니터링 경보 확인, 영향 범위 식별

2. 쓰기 경로 보호
- 불안정 노드로 라우팅 차단
- 프록시/앱 설정으로 안전 노드만 사용

3. failover 수행
- MariaDB: replica 승격 + 프록시 endpoint 전환
- MongoDB: election 상태 확인 + 앱 연결 복구 확인

4. 데이터 정합성 검증
- 최근 트랜잭션/문서 샘플 검증
- 큐 적체(Kafka lag) 확인 및 재처리

5. 사후 조치
- 원인 분석(RCA)
- 재발 방지 액션 및 임계치 조정

## 8. 단계별 도입 로드맵

### Phase 1 (즉시, 1~2주)
- MariaDB Replica 최소 1대 추가
- MongoDB Replica Set 3노드 구성(또는 Arbiter 포함)
- 백업 자동화 + 복구 테스트 1회 수행
- 모니터링 대시보드/알림 구축

### Phase 2 (2~4주)
- DB 프록시 계층 도입(읽기/쓰기 라우팅)
- 장애 전환 runbook 확정
- 애플리케이션 retry/circuit breaker 표준화

### Phase 3 (4주+)
- 멀티 AZ/멀티 VM 분산 강화
- 정기 게임데이(장애훈련) 월 1회
- SLA/SLO 실제 지표 기반 재조정

## 9. 권장 의사결정

- 현재 단계에서 "무조건 필요한 것"
  - MariaDB Replica + MongoDB Replica Set + 백업 복구 리허설
- "추가하면 좋은 것"
  - DB 프록시 계층, 자동 failover 고도화
- "나중에 해도 되는 것"
  - 고급 샤딩/멀티리전(트래픽 증가 시)

## 10. 팀 체크리스트

- [ ] MariaDB 복제 구성 완료
- [ ] MongoDB Replica Set 구성 완료
- [ ] 앱 커넥션 설정(재시도/타임아웃) 반영
- [ ] 백업 자동화 + 복구 테스트 완료
- [ ] 장애 runbook 문서화
- [ ] 모니터링/알림 임계치 확정

---
핵심 메시지: MariaDB/MongoDB 분리 자체는 올바른 구조이지만, 운영 안정성을 위해서는 "이중화 + 복구 검증"이 함께 가야 합니다.
