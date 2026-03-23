# 2026-03-12 EKS 퇴근/출근 비용 절감 스크립트

## 작업자
박성준

## 작업 배경
- EKS 스테이징 클러스터 비용이 과도하게 발생 중
- 야간/주말 등 미사용 시간에도 Karpenter 노드(EC2)가 계속 과금됨
- 퇴근 시 워크로드를 모두 0으로 내려 Karpenter 노드를 자동 제거하고, 출근 시 ArgoCD selfHeal로 자동 복구하는 워크플로우 필요

## 구현 내용

### 전략
- **ArgoCD selfHeal 활용**: git이 원천(source of truth), ArgoCD가 올라오면 git 상태대로 자동 복구
- **비용 절감 원리**: Deployment/StatefulSet 전체 replicas=0 → Karpenter 노드 자동 제거 (5~10분 내)
- **모니터링 EC2 포함**: i-0a8cab5d5ce1cac60 (SonarQube + Grafana/Loki/Tempo/Mimir/InfluxDB) aws stop/start

### 대상 컴포넌트 전체

| 위치 | 네임스페이스 | 리소스 |
|------|------------|-------|
| EKS Karpenter | `tutum-app` | backend, frontend, auth, elastic-consumer, news-consumer/producer, price-consumer/producer, email-worker, ocr (Deployment) |
| EKS Karpenter | `tutum-data` | mongodb, kafka, redis, elasticsearch (StatefulSet) + exporter들 (Deployment) |
| EKS Karpenter | `tutum-storage` | minio (StatefulSet) |
| EKS Karpenter | `gitlab-runner` | gitlab-runner (Deployment) |
| EKS Karpenter | `kyverno` | kyverno (Deployment/StatefulSet) |
| EKS Karpenter | `istio-system` | istio-ingressgateway (Deployment) |
| EKS Karpenter | `argocd` | argocd-server, repo-server, application-controller 등 |
| EKS Karpenter | `monitoring` | alloy (DaemonSet) → 노드 제거 시 자동 소멸, 직접 scale 불가 |
| EC2 Docker Compose | - | Grafana(:3000), Loki(:3100), Tempo(:3200), Mimir(:9009), InfluxDB(:8086), SonarQube(:9000) |

### 퇴근 순서 (eks-cost-down.sh)
1. **ArgoCD 먼저** 0으로 내리기 → selfHeal이 되돌리는 것을 차단
2. `tutum-app`, `tutum-data`, `tutum-storage` 전체 scale 0
   - MongoDB, Kafka, Redis, Elasticsearch, MinIO 포함
3. `gitlab-runner`, `kyverno`, `istio-ingressgateway` scale 0
4. 모니터링 EC2 중지 (Grafana/Loki/Tempo/Mimir/InfluxDB/SonarQube 포함)
5. Karpenter가 5~10분 내 빈 노드 자동 제거 (Alloy DaemonSet도 자동 소멸)

### 퇴근 순서 (eks-cost-down.sh) — 최신
1. **ArgoCD 먼저** scale 0 → selfHeal 차단
2. **KEDA ScaledObjects pause** → minReplicas 기준 자동 복구 방지
3. `tutum-app`, `tutum-data`, `tutum-storage` 전체 scale 0
4. `gitlab-runner`, `kyverno`, `istio-ingressgateway` scale 0
5. 모니터링 EC2 중지

### 출근 순서 (eks-cost-up.sh) — 최신
1. 모니터링 EC2 시작
2. ArgoCD 컴포넌트 scale 1
3. ArgoCD application-controller Ready 대기
4. **KEDA ScaledObjects resume** → selfHeal 복구 후 KEDA 정상 관리 재개
5. ArgoCD selfHeal → tutum-staging 전체 복구 → Karpenter 노드 자동 프로비저닝

### 남는 고정 비용 (절감 불가)
| 항목 | 비용 |
|------|------|
| EKS 컨트롤 플레인 | $0.10/hr (~$1.4/14hr) |
| NAT Gateway 기본료 | ~$0.045/hr/AZ |
| EBS PVC | GB 기준 고정 |
| kube-system 최소 노드 | Karpenter system NodePool |

## 생성된 파일

| 파일 | 설명 |
|------|------|
| `scripts/eks-cost-down.sh` | 퇴근 시 실행 — 전체 scale 0 + EC2 중지 |
| `scripts/eks-cost-up.sh` | 출근 시 실행 — EC2 시작 + ArgoCD 복구 → selfHeal |

## 사용법

```bash
# 퇴근 시 (cp-2에서 실행)
bash scripts/eks-cost-down.sh

# 출근 시 (cp-2에서 실행)
bash scripts/eks-cost-up.sh
```

## 예상 절감 효과
- Karpenter EC2 노드 과금 중단 (야간 14시간 기준)
- 4~5개 노드 × $0.096/hr × 14hr ≈ **$5~8/일** 절감
- 모니터링 EC2 중지 추가 절감

## 트러블슈팅

### KEDA가 scale=0 이후 pods 복구하는 문제 (발견 및 수정)
- **증상**: cost-down 실행 후 backend/frontend/news-consumer/price-consumer pods가 다시 올라옴
- **원인**: KEDA ScaledObjects의 `minReplicas` 설정이 scale=0을 override
- **부작용**: PDB(`news-consumer-pdb`, `price-consumer-pdb`)가 pods 존재로 인해 Karpenter 노드 제거 차단
- **해결**: cost-down에 `autoscaling.keda.sh/paused=true` annotation 추가, cost-up에 pause 해제 추가

## 커밋
- `6248643` — feat(scripts): add eks-cost-down/up scripts for daily cost saving
- `cf095a8` — docs(scripts): clarify all components covered by eks-cost-down
- `743d541` — fix(scripts): add KEDA ScaledObject pause/resume to cost down/up scripts
