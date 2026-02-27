# Node1/2/3 -> K8s 마이그레이션 실행 런북

> 작성일: 2026-02-23  
> 최종 업데이트: 2026-02-25  
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

## 2. 현재 기준 클러스터 상태(2026-02-25 갱신)

- `cp-1` `192.168.0.220`
- `cp-2` `192.168.0.221`
- `cp-3` `192.168.0.222`
- `worker1` `192.168.0.223`
- `worker2` `192.168.0.224`
- `worker3` `192.168.0.225`
- 상태: 2026-02-23 점검 기준 `kubectl get nodes` 모두 `Ready`
- Istio Gateway EXTERNAL-IP: `192.168.0.240`
- 주의: 실제 작업 시작 전 `cp-1`에서 실시간 상태를 재확인한다.

### 2-1. 현재 진행 메모(2026-02-25)

1. `Phase 0`
   - 클러스터/게이트웨이 기준점 확인 이력은 있음.
   - Freeze SHA 고정/백업 완료를 체크리스트에 완료로 표기한 기록은 아직 없음.
2. `Phase 1`
   - `k8s-manifests/base`에 데이터 계층 매니페스트가 준비됨.
3. `Phase 2`
   - Atlas -> K8s MongoDB 복원 수행 로그 있음(복원 성공 로그 기준).
   - `worker2` Calico 안정화 후속 점검이 남아 있음.
4. `Phase 3`
   - node3 뉴스 파이프라인 K8s 매니페스트 초안 반영 완료.
   - 전체 worker 컷오버 완료 증빙은 아직 없음.
5. `Phase 4~6`
   - Backend 카나리, Frontend/Ingress 컷오버, 기존 node1/2/3 종료 완료 증빙 없음.
6. 세션 반영(2026-02-25 실시간)
   - `worker1/2/3` 라벨 반영 완료 (`app/app/data`)
   - `worker2` `SchedulingDisabled` 해제(`uncordon`) 완료
   - `tutum-data`: `mongodb/kafka/redis` `Running`
   - `tutum-storage`: `minio` `Running`
   - `price-producer`, `price-consumer`, `backend`, `frontend` `Running`
   - `email-worker` AWS 자격증명 패치 후 `Running` 복구 완료

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

### 3-1. Pod 배치 표준(worker1/2/3)

| 노드 | 라벨 표준 | 기본 역할 |
|---|---|---|
| `worker1` | `workload=app` | Frontend/Backend/App Worker |
| `worker2` | `workload=app` | App Worker + Consumer |
| `worker3` | `workload=data` | Kafka/Redis/MinIO/ES/Kibana 중심 |

- 스케줄링 원칙
  - `tutum-app`의 앱/워커 Pod는 기본 `workload=app`으로 제한.
  - `tutum-data`, `tutum-storage`의 Stateful 워크로드는 `local-path` PVC node affinity를 우선한다.
  - `redis/kafka/minio`에 `nodeSelector=workload=data`를 강제하면 PV 노드와 충돌해 Pending이 발생할 수 있으므로 기본값은 강제하지 않는다.
  - `mongodb`는 예외: 3-replica + `requiredDuringScheduling` anti-affinity를 유지하고 `worker1/2/3` 분산을 허용.

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
4. worker 라벨 표준화 (`workload=app|data`)
5. 현재 매니페스트의 `nodeSelector` 누락 리소스 목록 확정

### 검증
```bash
kubectl get nodes -o wide
kubectl -n istio-system get svc istio-ingressgateway
kubectl label node worker1 workload=app --overwrite
kubectl label node worker2 workload=app --overwrite
kubectl label node worker3 workload=data --overwrite
kubectl get nodes --show-labels | egrep "worker1|worker2|worker3|workload"
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
4. 스케줄링 고정 반영 후 재배포
   - app 계층: `frontend`, `backend`, `price-*`, `email-worker`, `news-*`, `elastic-consumer` -> `workload=app`
   - data/storage 계층: `elasticsearch`, `kibana` -> `workload=data`
   - `redis`, `kafka`, `minio`는 `local-path` PVC node affinity를 우선해 배치(강제 selector 금지)
   - `mongodb`는 anti-affinity 예외 정책 유지

### 검증 명령
```bash
kubectl get ns tutum-data tutum-storage
kubectl -n tutum-data get sts,pod,svc,pvc -o wide
kubectl -n tutum-storage get sts,pod,svc,pvc -o wide
kubectl -n tutum-app get pod -o wide
kubectl -n tutum-data get pod -o wide
kubectl -n tutum-storage get pod -o wide
```

### 합격 기준
- 각 데이터 컴포넌트 Pod가 `Running`
- PVC `Bound`
- 서비스 DNS로 접근 가능
- app Pod는 `worker1|worker2`에만 스케줄
- data/storage Pod는 PV node affinity 충돌 없이 `Running` 유지

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

1. `cp-1`에서 클러스터 실시간 상태 재확인
2. `worker1/2/3` 라벨 표준화(`workload=app|data`)
3. 누락된 `nodeSelector` 반영 계획 확정(앱/데이터 분리)
4. `tutum-data/tutum-storage` 상태 재검증 후 Phase 1 시작 승인

### 8-1. 시작 커맨드(Phase 0~1)

```bash
# 1) 기준 상태 확인
kubectl get nodes -o wide
kubectl -n istio-system get svc istio-ingressgateway

# 2) worker 라벨 표준화
kubectl label node worker1 workload=app --overwrite
kubectl label node worker2 workload=app --overwrite
kubectl label node worker3 workload=data --overwrite
kubectl get nodes --show-labels | egrep "worker1|worker2|worker3|workload"

# 3) 데이터 계층 상태 점검
kubectl get ns tutum-data tutum-storage
kubectl -n tutum-data get sts,pod,svc,pvc -o wide
kubectl -n tutum-storage get sts,pod,svc,pvc -o wide
```

---

## 9. 실행 체크리스트 (완료 표기)

- [x] worker 라벨 표준화 완료 (`worker1/2=app`, `worker3=data`)
- [ ] Phase 0 완료 (백업/기준점 확정)
- [x] Phase 1 완료 (데이터 계층 K8s 기동)
- [ ] Phase 2 완료 (데이터 이관 검증)
- [ ] Phase 3 완료 (worker 전환)
- [ ] Phase 4 완료 (backend 전환)
- [ ] Phase 5 완료 (frontend/ingress 전환)
- [ ] Phase 6 완료 (node1/2/3 종료)
- [ ] 24~48시간 안정화 확인

---

## 10. 2026-02-25 추가 진행 기록

1. 워커 이미지/배포 정리
   - `backend/workers/requirements.txt`에 `boto3` 추가.
   - `registry.gitlab.com/tutum-project/tutum-app/backend/workers:latest` 재빌드/재푸시 완료.
2. `email-worker` 장애 원인 정리
   - 1차 원인: workers 이미지에 `boto3` 누락.
   - 2차 원인: `app.config` import 구조상 `backend/workers` 전용 이미지와 불일치.
   - 조치: 실행 이미지를 `backend:latest`로 전환, 커맨드를 `python -u workers/email_worker.py`로 변경, `backend-secret` 환경 주입.
3. 블로커 처리 결과
   - `backend-secret`의 AWS 키가 placeholder(`'<KEY>'`, `'<SECRET>'`) 상태였음을 확인.
   - 로컬 기준 유효 키(STS 검증 완료)로 secret patch 후 `email-worker` `replicas=1` 정상 기동.
4. 현재 안정 상태(실시간)
   - `tutum-data`: `mongodb`, `kafka`, `redis` Running
   - `tutum-storage`: `minio` Running
   - `tutum-app`: `backend`, `frontend`, `price-producer`, `price-consumer`, `email-worker` Running

---

## 11. 2026-02-25 추가 진행 기록 (세션 후속)

1. `stg-*` 재생성 원인 확인
   - 원인: `argocd`의 `tutum-staging` Application 자동 동기화(`prune/selfHeal`)가 `tutum-*` 네임스페이스 리소스를 반복 생성.

2. 사고/복구 이력
   - `tutum-staging` 삭제 시 finalizer prune으로 `tutum-app/tutum-data/tutum-storage` 리소스가 함께 삭제됨.
   - 즉시 `/home/clouddx/clouddx-project/k8s-manifests/base` 재적용으로 전체 워크로드 재기동.
   - 누락된 시크릿(`backend-secret`, `harbor-secret`, `gitlab-registry-secret`) 복구.
   - `gitlab-registry-secret`은 실제 registry credential로 재생성 후 앱 롤아웃 정상화.

3. MongoDB 재복구
   - Namespace 재생성으로 Mongo PVC/PV가 신규 생성되어 데이터가 초기화됨.
   - ReplicaSet 재초기화(`rs.initiate`) 수행 후 Atlas -> K8s `mongodump | mongorestore` 재실행.
   - 복구 후 컬렉션 건수 일치 확인:
     - `assets:22`
     - `email_verification_tokens:7`
     - `users:11`
     - `news:6240`

4. 현재 운영 상태 (2026-02-25 UTC)
   - `tutum-data`: `mongodb(3/3)`, `kafka(1/1)`, `redis(1/1)` Running
   - `tutum-storage`: `minio(1/1)` Running
   - `tutum-app`: `backend(2/2)`, `frontend(2/2)`, `price-producer(1/1)`, `price-consumer(1/1)`, `email-worker(1/1)` Running
   - Ingress 검증:
     - `http://192.168.0.240/` -> `200`
     - `http://192.168.0.240/api/v1/market/price/crypto/KRW-BTC` -> `200`

5. 남은 이슈/주의
   - `news-producer`, `news-consumer`, `elastic-consumer`는 `192.168.56.12:8080` 레지스트리 접근 불가로 이미지 pull 실패.
   - 현재는 `replicas=0`으로 운영 영향 제거.
   - 추후 정식 조치:
     - 해당 이미지 접근 가능한 레지스트리로 이관 또는
     - GitLab Registry 이미지로 교체 후 재배포.
6. 매니페스트 반영
   - `k8s-manifests/base/kustomization.yaml`에 `backend/secret.yaml` 포함(재적용 시 `backend-secret/harbor-secret` 자동 생성).
   - `news-producer`, `news-consumer`, `elastic-consumer`는 기본 `replicas: 0`으로 조정(레지스트리 접근 복구 전까지 비활성).

## 12. 2026-02-25 Phase 6 선행 점검

1. 점검 목적
   - 기존 node1/2/3 방식 잔여 워크로드(Docker Compose) 잔존 여부 확인

2. 수행 내용
   - `kubectl debug node/worker1|2|3 -- chroot /host ...`로 호스트 레벨 점검
   - 확인 항목:
     - `/usr/bin/docker` 존재 여부
     - `/home/kafka/docker-compose.yml` 존재 여부

3. 점검 결과
   - `worker1/2/3` 모두 `no_docker_bin` 확인
   - `worker1/2/3` 모두 `no_compose_file` 확인
   - 결론: K8s worker 호스트 기준으로 기존 Docker Compose 런타임/실행 파일 잔존 징후 없음

4. 후속
   - 운영 관점에서는 Phase 6의 "기존 방식 병행 실행 중단" 조건을 상당 부분 충족
   - 다만 문서상 최종 완료 표기는 24~48시간 안정화 모니터링 종료 후 확정 권장

## 13. 2026-02-25 재발 이슈 조치 (stg 자동 재생성)

1. 증상
   - `tutum-staging` Application이 다시 생성되며 `stg-*` 리소스(Deployment/STS/PVC)가 재발.

2. 원인 단서
   - `metadata.managedFields.manager = kubectl-client-side-apply`
   - 즉, 외부에서 `kubectl apply`로 `tutum-staging`이 재생성되는 경로 존재.

3. 안전 조치
   - `tutum-staging` 삭제 전 finalizer 제거(네임스페이스 prune 사고 방지):
     - `kubectl -n argocd patch app tutum-staging --type json -p='[{"op":"remove","path":"/metadata/finalizers"}]'`
   - 이후 Application 삭제 및 `stg-*` 리소스/PVC 수동 정리 완료.

4. 재발 방지(클러스터 가드)
   - Kyverno `ClusterPolicy` 추가: `block-tutum-staging-application`
   - `argocd` 네임스페이스의 `Application/tutum-staging` `CREATE/UPDATE`를 Enforce로 차단.
   - 검증: `kubectl apply -f k8s-manifests/argocd/staging-app.yaml` 시 정책 거부 확인.

5. 안정화 스모크체크
   - 스크립트: `scripts/k8s-migration-smoke.sh` 추가
   - cp-1 실행 결과: Core workload / namespace health / stg-cleanup / ingress smoke 전체 PASS.
