# K8s 파드 가용성 전략 가이드

> 최종 업데이트: 2026-02-27
> 적용 환경: tutum-app 네임스페이스, K8s 1.29.15 (kubeadm), KEDA 2.16.0

---

## 1. 개요

이 문서는 `tutum-app` 네임스페이스의 파드 가용성 전략을 설명합니다.
세 가지 메커니즘을 조합해 **트래픽 급증 대응 + 노드 장애/점검 시 서비스 유지**를 구현합니다.

| 메커니즘 | 목적 | 적용 대상 |
|---------|------|---------|
| **KEDA HPA** | 부하에 따른 자동 스케일 아웃/인 | backend, frontend, consumers |
| **PodDisruptionBudget** | 노드 drain/점검 시 최소 가용 파드 보장 | backend, frontend, consumers |
| **Pod Anti-Affinity** | 파드를 여러 노드에 분산 배치 | backend |

---

## 2. 노드 구성

```
[worker1]  workload=app   CPU 6코어  RAM ~8GB   ← 앱 워크로드
[worker2]  workload=app   CPU 6코어  RAM ~12GB  ← 앱 워크로드
[worker3]  workload=data  CPU 4코어  RAM ~8GB   ← 데이터 워크로드 전용
```

> `nodeSelector: workload: app`으로 backend/frontend/workers는 worker1, worker2에만 배치됩니다.

---

## 3. KEDA 자동 스케일링

### 3-1. CPU 기반 (backend, frontend)

```yaml
# backend: CPU 70% 초과 시 2 → 5개로 증가
minReplicaCount: 2
maxReplicaCount: 5
trigger: cpu 70%

# frontend: CPU 70% 초과 시 2 → 4개로 증가
minReplicaCount: 2
maxReplicaCount: 4
trigger: cpu 70%
```

- CPU `utilization` = 실제 사용량 / **requests** 기준 (limits 아님)
- backend requests: `cpu: 600m` → 파드당 600m 이상 사용 시 스케일 아웃 트리거

### 3-2. Kafka lag 기반 (consumers)

| 컴포넌트 | 토픽 | Consumer Group | lag 임계값 | min→max |
|---------|------|---------------|-----------|---------|
| news-consumer | `news.raw` | `clouddx-news-consumer-v1` | 30 | 1→4 |
| elastic-consumer | `news.raw` | `indexer-consumer-group` | 30 | 0→3 |
| price-consumer | `prices` | `price-consumer-group` | 50 | 1→5 |

- **elastic-consumer는 min=0**: 평소 파드 없음 → lag 발생 시 자동 기동 (유휴 비용 절감)
- pollingInterval: 15초마다 lag 체크
- cooldownPeriod: 스케일 인 전 대기 시간 (news/price: 60초, backend: 120초)

---

## 4. PodDisruptionBudget (PDB)

노드 drain, 클러스터 업그레이드, 점검 시 파드가 **한꺼번에 삭제되는 것을 방지**합니다.

### 4-1. minAvailable (최소 유지 파드 수)

```yaml
# backend: 최소 2개 항상 Running 상태 보장
backend-pdb:
  minAvailable: 2

# frontend: 최소 1개 항상 Running 상태 보장
frontend-pdb:
  minAvailable: 1
```

**동작 예시 (worker2 drain 시):**
```
backend 파드: worker2에 4개 + worker1에 1개 = 총 5개
minAvailable=2 → 최대 3개까지 동시 삭제 허용 (ALLOWED DISRUPTIONS=3)
worker2 drain → 순차적으로 3개 삭제, 나머지 2개 유지
→ 서비스 지속 가능
```

> ⚠️ KEDA가 backend를 minReplica(2)로 스케일 인한 상태에서는 ALLOWED DISRUPTIONS=0이 됩니다.
> 이때 노드 drain을 시도하면 PDB가 차단 → `kubectl drain --force` 또는 스케일 아웃 후 진행 필요.

### 4-2. maxUnavailable (최대 동시 중단 허용 수)

```yaml
# 단일 인스턴스 워커: drain은 허용하되 한 번에 1개씩만
news-consumer-pdb:
  maxUnavailable: 1

price-consumer-pdb:
  maxUnavailable: 1
```

단일 파드 워커는 어차피 1개뿐이라 서비스 중단 자체를 막을 수는 없지만,
다중 노드 동시 drain 시 **예상치 못한 병렬 eviction을 방지**합니다.

---

## 5. Pod Anti-Affinity (분산 배치)

backend 파드가 특정 노드에 집중되지 않도록 **동일 노드 배치를 비선호**합니다.

```yaml
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchLabels:
              app: backend
          topologyKey: kubernetes.io/hostname
```

- `preferred` (소프트 룰): 분산 배치를 선호하지만 리소스가 부족하면 같은 노드에도 배치 허용
- `required` (하드 룰)로 변경 시 노드당 최대 1개 배치 → 노드 2개 기준 최대 2개 파드만 가능

---

## 6. Rolling Update 전략

모든 Deployment에 `RollingUpdate` 전략 적용 (K8s 기본값):

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 25%        # 초과 생성 허용 비율 (올림 처리)
    maxUnavailable: 25%  # 동시 중단 허용 비율 (내림 처리)
```

| Deployment | replicas | maxSurge | maxUnavailable | 동작 |
|-----------|---------|---------|--------------|-----|
| backend | 2~5 | 1~2개 | 0~1개 | 순차 교체, 서비스 유지 |
| frontend | 2 | 1개 | 0개 | 무중단 교체 |
| 단일 워커 (1개) | 1 | 1개 | 0개 | 새 파드 Ready 후 구 파드 삭제 |

> replicas=1이고 maxUnavailable=25% → 내림하면 0 → 새 파드가 Ready 되기 전까지 구 파드 삭제 안 함 (사실상 무중단)

---

## 7. 현재 한계 및 SPOF

| 컴포넌트 | 상태 | 이유 |
|---------|------|------|
| news-producer | 단일 인스턴스 | 토픽 발행자, 중단 시 뉴스 수집 정지 |
| price-producer | 단일 인스턴스 | 가격 발행자, 중단 시 가격 수집 정지 |
| email-worker | 단일 인스턴스 | 이메일 발송, 큐가 없어 중단 시 유실 가능 |
| backend (worker2 집중) | 소프트 anti-affinity | 리소스 제약으로 worker1 배치 제한됨 |

---

## 8. 운영 참고

### 노드 drain 절차

```bash
# 1. drain 전 PDB 상태 확인
kubectl -n tutum-app get pdb

# 2. backend가 min 상태(2개)면 scale-out 먼저
kubectl -n tutum-app scale deploy backend --replicas=4

# 3. drain 실행 (PDB가 안전하게 순차 eviction)
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data

# 4. 작업 완료 후 uncordon
kubectl uncordon <node-name>
```

### 스케일 확인

```bash
# HPA 현황
kubectl -n tutum-app get hpa

# 파드 노드 분포
kubectl -n tutum-app get pods -o wide

# 노드 자원 현황
kubectl top nodes
```
