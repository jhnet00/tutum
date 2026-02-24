# Node1/2/3 -> K8s 마이그레이션 실행 런북

> 작성일: 2026-02-23  
> 목적: 기존 Docker Compose 기반 `node1/2/3` 기능을 Kubernetes로 단계적으로 이관  
> 원칙: Big-bang 금지, 병행 구동(Parallel Run) 후 점진 컷오버

---

## 1. 범위

- 이관 대상
  - Node1: Nginx, Frontend, Backend
  - Node2: MongoDB, Redis, MinIO
  - Node3: Kafka, Workers, Elasticsearch/Kibana(운영 정책에 따라 분리)
- 이관 제외
  - 학원 외부 MariaDB(기존 그대로 유지)

---

## 2. 현재 기준 클러스터 상태(2026-02-23)

- `cp-1` `192.168.0.220`
- `cp-2` `192.168.0.221`
- `cp-3` `192.168.0.222`
- `worker1` `192.168.0.223`
- `worker2` `192.168.0.224`
- `worker3` `192.168.0.225`
- 상태: `kubectl get nodes` 기준 모두 `Ready`
- Istio Gateway EXTERNAL-IP: `192.168.0.240`

---

## 3. 이관 아키텍처 매핑

1. Node1 기능
   - 기존: `Nginx + Frontend + Backend`
   - K8s: `Istio Ingress + frontend Deployment + backend Deployment`
2. Node2 기능
   - 기존: `MongoDB + Redis + MinIO`
   - K8s: `tutum-data/tutum-storage`의 StatefulSet + Service + PVC
3. Node3 기능
   - 기존: `Kafka + price/news workers + ES/Kibana`
   - K8s: `Kafka StatefulSet + workers Deployment`
   - ES/Kibana: 팀 운영 정책에 따라 `tutum-data` 또는 `monitoring VM` 유지

---

## 4. 핵심 원칙

1. 데이터 계층을 먼저 올리고, 앱 계층은 나중에 전환한다.
2. 기존 node1/2/3는 즉시 내리지 않는다.
3. backend는 1개 Pod 카나리 전환 후 전체 전환한다.
4. 장애 시 즉시 롤백 가능해야 한다.
5. 각 단계는 검증 명령 통과 후 다음 단계로 이동한다.

---

## 5. 단계별 실행 순서

## Phase 0. 사전 고정(Freeze) + 백업

### 목적
- 이관 중 데이터 유실/중복을 막기 위한 기준점 생성

### 작업
1. `develop` 기준 커밋 SHA 고정
2. 기존 node1/2/3 compose 스택 상태 캡처
3. MongoDB/Redis/Kafka 최소 백업 수행

### 검증
```bash
kubectl get nodes -o wide
kubectl -n istio-system get svc istio-ingressgateway
```

---

## Phase 1. 데이터 계층 K8s 배포

### 목적
- app 전환 전에 K8s 내부 데이터 서비스 준비

### 대상
- MongoDB, Redis, Kafka, MinIO

### 작업
1. `tutum-data`, `tutum-storage` 네임스페이스 확인
2. StatefulSet/PVC/Service 배포
3. 내부 DNS/포트 접근 확인

### 검증 명령
```bash
kubectl get ns tutum-data tutum-storage
kubectl -n tutum-data get sts,pod,svc,pvc -o wide
kubectl -n tutum-storage get sts,pod,svc,pvc -o wide
```

### 합격 기준
- 각 데이터 컴포넌트 Pod가 `Running`
- PVC `Bound`
- 서비스 DNS로 접근 가능

---

## Phase 2. 데이터 마이그레이션

### 목적
- Atlas/기존 노드 데이터를 K8s 데이터 계층으로 이관

### 작업
1. MongoDB 덤프/복원
2. Redis 키(필요 데이터만) 이관
3. Kafka 토픽/컨슈머 오프셋 확인(재처리 전략 확정)

### 검증 명령
```bash
# 예: Mongo 컬렉션 카운트 비교
# source/target 양쪽에서 동일 컬렉션 카운트 확인
```

### 합격 기준
- 핵심 컬렉션(document count) 편차 0 또는 승인된 범위
- API 주요 조회 경로 데이터 누락 없음

---

## Phase 3. Worker 전환 (Kafka 파이프라인)

### 목적
- 시세/뉴스 파이프라인을 K8s worker로 전환

### 작업
1. `price-producer`, `price-consumer`, `candle-aggregator` 순차 전환
2. 기존 node3 worker는 즉시 중지하지 않고 대기
3. 중복 발행 방지를 위해 producer 단일 활성화 원칙 적용

### 검증 명령
```bash
kubectl -n tutum-app get deploy,pod | egrep "price|consumer|candle|email"
kubectl -n tutum-app logs deploy/price-producer --tail=100
kubectl -n tutum-app logs deploy/price-consumer --tail=100
```

### 합격 기준
- Kafka lag 증가 없이 안정
- Redis 최신 시세 키 갱신 정상

---

## Phase 4. Backend 카나리 전환

### 목적
- 앱 핵심 API를 K8s 데이터 계층으로 안전 전환

### 작업
1. backend 1개 Pod 카나리(새 env) 기동
2. `/health`, `/ready`, 핵심 API 점검
3. 문제 없으면 backend 전체 rollout

### 검증 명령
```bash
kubectl -n tutum-app get deploy backend -o wide
kubectl -n tutum-app logs deploy/backend --tail=200
```

### 합격 기준
- 인증/포트폴리오/추천뉴스/시세/차트 API 정상
- 오류율 급증 없음

---

## Phase 5. Frontend + Ingress 컷오버

### 목적
- 사용자 트래픽을 K8s 경로로 전환

### 작업
1. Istio 라우팅 최종 반영
2. Frontend 환경변수/API 프록시 경로 검증
3. 실사용 페이지 스모크 테스트

### 검증 체크
1. `/portfolio/asset` 추천뉴스 노출
2. `/portfolio/chart` 타임프레임 동작
3. 실시간 시세 갱신

---

## Phase 6. 기존 node1/2/3 축소/종료

### 목적
- 중복 비용/중복 처리 제거

### 작업
1. node3 worker 중지
2. node1 backend/frontend 중지
3. node2 data 서비스 read-only 후 종료

### 합격 기준
- K8s 단독 운영 24~48시간 안정

---

## 6. 롤백 계획 (필수)

1. backend 오류 급증 시:
   - 즉시 기존 node1 backend로 트래픽 복귀
2. 시세/파이프라인 장애 시:
   - node3 producer/consumer 재활성화
3. Mongo 이관 이슈 시:
   - Atlas(또는 기존 소스)로 read 경로 임시 복귀

---

## 7. 팀원 역할 분배(실행 기준)

1. 김경윤
   - 전체 컷오버 오너, cp-1 기준 검증, Mongo 연결 정책 승인
2. 박성준
   - cp-2 안정화, Kafka/worker 운영 지표 점검
3. 김루비
   - cp-3 안정화, Mongo 이관 실행/검증
4. 김정호
   - worker1/2/3 자원 상태, 배포/스케줄링 상태 점검

---

## 8. 오늘 바로 할 작업(우선순위)

1. `tutum-data/tutum-storage`에 데이터 계층 매니페스트 확정
2. MongoDB 이관 리허설(샘플 컬렉션)
3. Worker producer 단일화(중복 발행 방지)
4. Backend 카나리 env 전환 테스트

---

## 9. 실행 체크리스트 (완료 표기)

- [ ] Phase 0 완료 (백업/기준점 확정)
- [ ] Phase 1 완료 (데이터 계층 K8s 기동)
- [ ] Phase 2 완료 (데이터 이관 검증)
- [ ] Phase 3 완료 (worker 전환)
- [ ] Phase 4 완료 (backend 전환)
- [ ] Phase 5 완료 (frontend/ingress 전환)
- [ ] Phase 6 완료 (node1/2/3 종료)
- [ ] 24~48시간 안정화 확인

