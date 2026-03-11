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
- **모니터링 EC2 포함**: i-0a8cab5d5ce1cac60 (SonarQube + LGTM) aws stop/start

### 퇴근 순서 (eks-cost-down.sh)
1. **ArgoCD 먼저** 0으로 내리기 → selfHeal이 되돌리는 것을 차단
2. `tutum-app`, `tutum-data`, `tutum-storage` 전체 scale 0
3. `gitlab-runner`, `kyverno`, `istio-ingressgateway` scale 0
4. 모니터링 EC2 중지

### 출근 순서 (eks-cost-up.sh)
1. 모니터링 EC2 시작 (병렬로 시작해두기)
2. ArgoCD 컴포넌트 scale 1
3. ArgoCD application-controller Ready 대기
4. selfHeal이 tutum-staging 전체 복구 → Karpenter 노드 자동 프로비저닝

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
| `scripts/eks-cost-down.sh` | 퇴근 시 실행 — 전체 scale 0 |
| `scripts/eks-cost-up.sh` | 출근 시 실행 — ArgoCD 복구 → selfHeal |

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
- 모니터링 EC2 (t3.small 또는 동급) 중지 추가 절감

## 커밋
- `현재 커밋` — feat(scripts): add eks-cost-down/up scripts for daily cost saving
