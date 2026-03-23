# 개발 로그 작업 요약 (2026-02-27)

## 1. 작업 요약
- 작업 일시: 2026-02-27
- 작업자: jhnet00
- 브랜치: `feat/k8s-availability` → `develop` 머지
- 작업 목적: 노드 자원 과부하 원인 파악 및 가용성 전략 구현 (OOMKill 수정, HPA 튜닝, PDB 추가)

---

## 2. 상세 변경 사항

### 2-1. 노드 자원 현황 확인 및 원인 분석

**이슈 발견:**

| 노드 | CPU | Memory |
|------|-----|--------|
| worker2 | **86%** 🚨 | 81% |
| worker1 | 35% | **86%** ⚠️ |

**원인:**
- backend 파드 5개(KEDA max) 중 4개가 worker2에 집중
- backend HPA: **222%/70%** → CPU requests(300m)가 실제 사용량(~670m)의 절반 → HPA가 늦게 반응
- backend 파드 17회 재시작 → OOMKilled (메모리 limit 2Gi 초과)
- news-consumer KEDA ScaledObject: `topic: news` 설정이지만 실제 토픽은 `news.raw` → Ready=False

### 2-2. backend 리소스 튜닝

**파일**: `k8s-manifests/base/backend/deployment.yaml`

| 항목 | 이전 | 이후 | 이유 |
|------|------|------|------|
| CPU requests | 300m | **600m** | HPA 기준값 현실화 (실제 ~670m 사용) |
| Memory requests | 768Mi | **1Gi** | 실제 사용량(1.4~1.8Gi) 반영 |
| Memory limits | 2Gi | **3Gi** | OOMKilled 방지 (50% 헤드룸 확보) |
| Pod anti-affinity | 없음 | **preferred** | worker1/2 분산 배치 유도 |

**적용 결과:**

| 항목 | 이전 | 이후 |
|------|------|------|
| worker2 CPU | 86% | **41%** |
| backend HPA | 222%/70% | **76%/70%** |
| backend 재시작 | 반복 OOMKilled | **0회** |

### 2-3. news-consumer KEDA ScaledObject 토픽 수정

**파일**: `k8s-manifests/base/autoscaling/keda-scaledobjects.yaml`

```yaml
# 수정 전
topic: news        ← 존재하지 않는 토픽

# 수정 후
topic: news.raw    ← 실제 구독 중인 토픽 (kafka-consumer-groups 확인)
```

**원인**: Kafka에 `news` 토픽이 없음 (실제 토픽: `news.raw`, `prices`, `price_tick`)
**결과**: news-consumer-scaledobject Ready=False → **Ready=True**

### 2-4. PodDisruptionBudget 추가

**파일**: `k8s-manifests/base/autoscaling/pdb.yaml` (신규)
**kustomization.yaml**: `autoscaling/pdb.yaml` 항목 추가

| PDB | 방식 | 값 | 보호 대상 |
|-----|------|-----|---------|
| backend-pdb | minAvailable | 2 | worker2 drain 시 5개 동시 삭제 방지 |
| frontend-pdb | minAvailable | 1 | 서비스 무중단 보장 |
| news-consumer-pdb | maxUnavailable | 1 | 순차 drain 허용 |
| price-consumer-pdb | maxUnavailable | 1 | 순차 drain 허용 |

**적용 결과:**
```
NAME                 MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS
backend-pdb          2               N/A               0 (현재 min 상태)
frontend-pdb         1               N/A               1
news-consumer-pdb    N/A             1                 1
price-consumer-pdb   N/A             1                 1
```

### 2-5. 가용성 전략 가이드 문서 작성

**파일**: `docs/guides/K8S_AVAILABILITY_GUIDE.md` (신규)

팀원을 위한 전체 가용성 전략 가이드 작성:
- KEDA HPA (CPU / Kafka lag 기반) 동작 원리
- PDB 동작 예시 및 노드 drain 절차
- Pod Anti-affinity 설정 설명
- Rolling Update 전략
- 현재 SPOF 및 한계 정리

---

## 3. 작업 중 발생 이슈 및 대응

### 이슈 1: SSH 접속 실패 (root 유저 시도)
- **내용**: `root@192.168.0.220` → Permission denied
- **대응**: `~/.ssh/config` 확인 → 유저명은 `clouddx`, 키는 `~/.ssh/id_claude_auto`

### 이슈 2: Kafka exec 명령 경로 오류
- **내용**: `kafka-topics.sh` → not found (Confluent 이미지는 `.sh` 없이 사용)
- **대응**: `kafka-topics` (suffix 없음)로 실행 → 정상

### 이슈 3: backend 메모리 requests 과도 설정 시도
- **내용**: 처음에 requests를 1536Mi로 설정 → worker1/2 잔여 메모리 부족으로 롤링 업데이트 중 스케줄링 실패 우려
- **대응**: 1Gi로 하향 조정 (스케줄링 여유 확보, OOMKill 방지는 limit 3Gi로 충분)

### 이슈 4: backend deployment heredoc SSH 전달 실패
- **내용**: `ssh ... << EOF` 방식으로 kubectl apply 시 timeout
- **대응**: `scp`로 파일 서버에 복사 후 `kubectl apply -f /tmp/...`로 적용

---

## 4. 결과

| 항목 | 결과 |
|------|------|
| worker2 CPU 과부하 해소 | ✅ 86% → 41% |
| backend OOMKilled 수정 | ✅ memory limit 3Gi로 확장 |
| HPA 정상화 | ✅ 222%/70% → 76%/70% |
| news-consumer KEDA 오류 수정 | ✅ Ready=True |
| PDB 4개 적용 | ✅ 클러스터 적용 완료 |
| 가용성 가이드 문서 | ✅ `docs/guides/K8S_AVAILABILITY_GUIDE.md` |

---

## 5. 커밋 로그

```
ff6123a fix(k8s): fix backend OOMKill, HPA tuning, and news-consumer KEDA topic
5310355 feat(k8s): add PodDisruptionBudgets for availability protection
```

---

## 6. 후속 작업 / 리스크

- **backend worker2 집중**: anti-affinity(preferred)가 적용됐지만 worker1 메모리 여유가 적어 현재 전부 worker2에 배치됨. KEDA scale-down(→2) 후 scale-up 시 자연스럽게 분산될 예정
- **단일 인스턴스 워커 SPOF**: news-producer, price-producer, email-worker는 replicas=1. 리소스 확보 후 2개로 증설 권장
- **backend maxReplicas=5**: app 노드(worker1/2) 메모리 제약으로 실질적으로 4~5개가 한계. 노드 증설 시 maxReplicas 상향 검토
- **backend-pdb ALLOWED DISRUPTIONS=0**: KEDA가 backend를 min(2)로 스케일 인한 상태. 노드 drain 전 `kubectl scale deploy backend --replicas=4` 권장 (가이드 참조)
