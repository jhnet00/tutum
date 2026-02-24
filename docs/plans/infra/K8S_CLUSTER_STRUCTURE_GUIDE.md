# K8S 클러스터 구조/역할 가이드

## 1. 목적
- 팀원 누구나 현재 클러스터 구조를 빠르게 이해하고, 본인 담당 노드 역할을 명확히 파악하기 위한 운영 가이드
- 기준 문서:
  - `docs/plans/infra/K8S_CICD_LGTM_SETUP_PLAN.md`
  - `docs/plans/infra/K8S_MIGRATION_PLAN.md`

## 2. 한눈에 보는 구성

### 2-1. 물리 PC + VM 배치
| 물리 PC(호스트) | Host IP | VM | VM IP(브릿지) | 역할 |
|---|---|---|---|---|
| 서버 PC(1) | 192.168.0.28 | clouddx-cp-1 | 192.168.0.220 | 1차 Control Plane (기준 노드) |
| 서버 PC(1) | 192.168.0.28 | clouddx-monitoring | 192.168.0.230 | LGTM(관측) |
| 팀원 PC(2) | 192.168.0.13 | clouddx-cp-2 | 192.168.0.221 | 2차 Control Plane |
| 팀원 PC(3) | 192.168.0.98 | clouddx-cp-3 | 192.168.0.222 | 3차 Control Plane |
| 팀원 PC(4) | 192.168.0.3 | clouddx-worker1 | 192.168.0.223 | App Worker |
| 팀원 PC(4) | 192.168.0.3 | clouddx-mongodb | 192.168.0.231 | MongoDB 전용 VM |
| 팀원 PC(5) | 192.168.0.14 | clouddx-worker2 | 192.168.0.224 | App + Consumer Worker |
| 팀원 PC(5) | 192.168.0.14 | clouddx-worker3 | 192.168.0.225 | Data Worker |

### 2-2. 쿠버네티스 논리 구조
```text
[Control Plane]
  cp-1 (192.168.0.220)  <-- kubeadm init 기준
  cp-2 (192.168.0.221)
  cp-3 (192.168.0.222)

[Worker]
  worker1 (192.168.0.223) : 앱 중심 워크로드
  worker2 (192.168.0.224) : 앱 + 컨슈머 워크로드
  worker3 (192.168.0.225) : 데이터 중심 워크로드

[외부/부가]
  monitoring (192.168.0.230) : Grafana/Loki/Tempo/Mimir/InfluxDB
  mongodb    (192.168.0.231) : 앱 데이터 저장소
```

## 3. 노드별 기능(무엇을 하는지)

### 3-1. Control Plane (cp-1/2/3)
- 공통 기능:
  - API Server, Scheduler, Controller Manager 운영
  - etcd quorum(3노드)으로 클러스터 상태 저장
- cp-1 추가 기능:
  - `kubeadm init` 실행 기준 노드
  - 조인 토큰 발급 기준 노드
  - 운영 시 kubectl 기준 컨텍스트로 사용

### 3-2. Worker
- worker1 (App):
  - 프론트/백엔드 중심 앱 워크로드 우선 배치
- worker2 (App + Consumer):
  - 앱 워크로드 + 비동기 컨슈머(예: 메시지/파이프라인 소비)
- worker3 (Data):
  - 데이터 성격 워크로드 우선 배치 (리소스 사용량 높은 작업 분산)

### 3-3. MongoDB VM
- 역할:
  - Atlas 대체/보완용 로컬 MongoDB 운영
  - 애플리케이션 영속 데이터 저장
- 주의:
  - 백업/복구 정책을 별도 운영
  - 방화벽은 `192.168.0.0/24` 대역 중심으로 제한

### 3-4. Monitoring VM (LGTM)
- 구성:
  - Grafana / Loki / Tempo / Mimir / InfluxDB
- 역할:
  - 로그/메트릭/트레이스 통합 관측
  - 장애 분석 및 성능 추이 모니터링

## 4. 트래픽 구조(서비스 관점)
```text
사용자
  -> MetalLB VIP (192.168.0.240~250)
  -> Istio IngressGateway
  -> Frontend / Backend 서비스
  -> MongoDB(192.168.0.231)

클러스터 내부 텔레메트리
  -> monitoring(192.168.0.230)
```

## 5. 네트워크 운영 원칙
- 표준 네트워크: `어댑터1 NAT + 어댑터2 브릿지`
- 운영 대역: `192.168.0.0/24`
- MetalLB 대역: `192.168.0.240~192.168.0.250`
- API Endpoint 기준: `192.168.0.220:6443` (cp-1)

## 6. 왜 브릿지 표준인가
- Host-Only(`192.168.56.x`)는 물리 PC가 다르면 상호 라우팅이 자주 끊김
- 브릿지는 각 VM이 동일 LAN에 직접 붙어 팀원 PC 간 VM 통신이 안정적
- 실제 운영 검증(조인/헬스체크/모니터링 연동)이 브릿지 기준으로 재현성이 높음

## 7. 접속 기준

### 7-1. 브릿지 직접 접속(권장)
```bash
ssh clouddx@192.168.0.220   # cp-1
ssh clouddx@192.168.0.221   # cp-2
ssh clouddx@192.168.0.222   # cp-3
ssh clouddx@192.168.0.223   # worker1
ssh clouddx@192.168.0.224   # worker2
ssh clouddx@192.168.0.225   # worker3
ssh clouddx@192.168.0.230   # monitoring
ssh clouddx@192.168.0.231   # mongodb
```

### 7-2. NAT 포트포워딩 접속(대체)
```bash
ssh -p 2220 clouddx@192.168.0.28
ssh -p 2221 clouddx@192.168.0.13
ssh -p 2222 clouddx@192.168.0.98
ssh -p 2223 clouddx@192.168.0.3
ssh -p 2224 clouddx@192.168.0.3
ssh -p 2225 clouddx@192.168.0.14
ssh -p 2226 clouddx@192.168.0.14
ssh -p 2230 clouddx@192.168.0.28
```

## 8. 팀원 체크리스트(매일)
- `kubectl get nodes -o wide`에서 3CP + 3Worker `Ready` 확인
- `ping 192.168.0.220~225,230,231` 통신 확인
- API 엔드포인트(`192.168.0.220:6443`) 접속 가능 여부 확인
- MongoDB(27017), Monitoring(3000/3100/3200/9009) 포트 접근 확인

## 9. 장애 시 1차 분류
- A. 특정 노드만 통신 불가:
  - VM 전원/네트워크 어댑터/고정 IP(netplan) 확인
- B. cp-1 연결 불가:
  - `192.168.0.220:6443` 경로/방화벽/UFW 확인
- C. 서비스 외부 노출 불가:
  - MetalLB VIP 할당 상태, IngressGateway, 방화벽 확인
- D. 데이터 저장 이슈:
  - MongoDB VM 상태, 인증 계정, 애플리케이션 DB URI 확인

## 10. 관련 문서
- `docs/plans/infra/K8S_CICD_LGTM_SETUP_PLAN.md`
- `docs/plans/infra/K8S_MIGRATION_PLAN.md`
- `docs/plans/infra/K8S_TECH_STACK.md`
- `docs/plans/infra/DB_HA_STRATEGY.md`
