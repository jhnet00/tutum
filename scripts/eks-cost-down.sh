#!/bin/bash
# ============================================================
#  eks-cost-down.sh — 퇴근 시 EKS 비용 절감 스크립트
#  실행 위치: cp-2 (kubectl + aws CLI 모두 준비됨)
#  사용법: bash scripts/eks-cost-down.sh
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)]${NC} $*"; }

# ─────────────────────────────────────────
# STEP 1: ArgoCD 먼저 내리기 (selfHeal 차단)
#   → ArgoCD가 없으면 이후 스케일다운을 되돌리지 못함
# ─────────────────────────────────────────
log "[1/5] ArgoCD 컴포넌트 스케일 다운 (selfHeal 차단)"

kubectl scale deployment argocd-server              -n argocd --replicas=0
kubectl scale deployment argocd-repo-server         -n argocd --replicas=0
kubectl scale deployment argocd-applicationset-controller -n argocd --replicas=0
kubectl scale deployment argocd-notifications-controller  -n argocd --replicas=0
kubectl scale deployment argocd-dex-server          -n argocd --replicas=0
kubectl scale deployment argocd-redis               -n argocd --replicas=0
kubectl scale statefulset argocd-application-controller   -n argocd --replicas=0

# ─────────────────────────────────────────
# STEP 2: 애플리케이션 워크로드 전체 0으로
# ─────────────────────────────────────────
log "[2/5] 애플리케이션 워크로드 스케일 다운"

for ns in tutum-app tutum-data tutum-storage; do
  warn "  → namespace: $ns"
  kubectl scale deployment   --all -n "$ns" --replicas=0 2>/dev/null || true
  kubectl scale statefulset  --all -n "$ns" --replicas=0 2>/dev/null || true
done

# ─────────────────────────────────────────
# STEP 3: 기타 네임스페이스
# ─────────────────────────────────────────
log "[3/5] gitlab-runner / kyverno 스케일 다운"

kubectl scale deployment --all -n gitlab-runner --replicas=0 2>/dev/null || true
kubectl scale deployment --all -n kyverno       --replicas=0 2>/dev/null || true
kubectl scale statefulset --all -n kyverno      --replicas=0 2>/dev/null || true

# Istio ingress gateway (외부 노출 불필요)
kubectl scale deployment istio-ingressgateway -n istio-system --replicas=0 2>/dev/null || true

# ─────────────────────────────────────────
# STEP 4: 모니터링 EC2 중지 (SonarQube + LGTM)
# ─────────────────────────────────────────
log "[4/5] 모니터링 EC2 인스턴스 중지 (i-0a8cab5d5ce1cac60)"
aws ec2 stop-instances \
  --instance-ids i-0a8cab5d5ce1cac60 \
  --region ap-northeast-2 \
  --output text --query 'StoppingInstances[0].CurrentState.Name' \
  2>/dev/null && log "  → EC2 중지 요청 완료" || warn "  → EC2 중지 실패 (AWS CLI 권한 확인)"

# ─────────────────────────────────────────
# STEP 5: 완료 안내
# ─────────────────────────────────────────
log "[5/5] 완료"
echo ""
echo "✅ 스케일다운 완료. Karpenter가 5~10분 내로 빈 노드를 자동 제거합니다."
echo ""
echo "  남아있는 고정 비용 (막을 수 없음):"
echo "    - EKS 컨트롤 플레인: \$0.10/hr  (~\$1.4 동안 14시간)"
echo "    - NAT Gateway 기본료: ~\$0.045/hr/AZ"
echo "    - EBS PVC: 사용량 기준 (변동 없음)"
echo "    - kube-system 최소 노드: Karpenter system NodePool 유지"
echo ""
echo "  노드 제거 확인: kubectl get nodes --watch"
echo "  아침에 복구:    bash scripts/eks-cost-up.sh"
