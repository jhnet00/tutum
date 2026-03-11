#!/bin/bash
# ============================================================
#  eks-cost-up.sh — 출근 시 EKS 워크로드 복구 스크립트
#  실행 위치: cp-2 (kubectl + aws CLI 모두 준비됨)
#  사용법: bash scripts/eks-cost-up.sh
#
#  원리: ArgoCD를 올리면 git 상태(selfHeal: true)로 전부 자동 복구
#        직접 개별 서비스 replicas를 건드릴 필요 없음
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)]${NC} $*"; }
info() { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }

# ─────────────────────────────────────────
# STEP 1: 모니터링 EC2 시작 (시간 걸리므로 가장 먼저)
# ─────────────────────────────────────────
log "[1/4] 모니터링 EC2 인스턴스 시작 (i-0a8cab5d5ce1cac60)"
aws ec2 start-instances \
  --instance-ids i-0a8cab5d5ce1cac60 \
  --region ap-northeast-2 \
  --output text --query 'StartingInstances[0].CurrentState.Name' \
  2>/dev/null && log "  → EC2 시작 요청 완료 (부팅까지 약 1분)" || warn "  → EC2 시작 실패 (AWS CLI 권한 확인)"

# ─────────────────────────────────────────
# STEP 2: ArgoCD 핵심 컴포넌트 재시작
# ─────────────────────────────────────────
log "[2/4] ArgoCD 컴포넌트 재시작"

kubectl scale statefulset argocd-application-controller   -n argocd --replicas=1
kubectl scale deployment argocd-redis               -n argocd --replicas=1
kubectl scale deployment argocd-repo-server         -n argocd --replicas=1
kubectl scale deployment argocd-server              -n argocd --replicas=1
kubectl scale deployment argocd-dex-server          -n argocd --replicas=1
kubectl scale deployment argocd-applicationset-controller -n argocd --replicas=1
kubectl scale deployment argocd-notifications-controller  -n argocd --replicas=1

# ─────────────────────────────────────────
# STEP 3: ArgoCD Ready 대기
# ─────────────────────────────────────────
log "[3/4] ArgoCD application-controller 준비 대기 (최대 3분)"
kubectl rollout status statefulset/argocd-application-controller -n argocd --timeout=180s
kubectl rollout status deployment/argocd-repo-server -n argocd --timeout=120s

# ─────────────────────────────────────────
# STEP 4: 완료 안내
# ─────────────────────────────────────────
log "[4/4] 완료"
echo ""
echo "✅ ArgoCD 복구 완료. git 상태(selfHeal: true) 기준으로 자동 복구 시작됩니다."
echo ""
info "  진행 상황 확인:"
echo "    kubectl get applications -n argocd          # Synced/Healthy 대기"
echo "    kubectl get pods -n tutum-app --watch        # 앱 pods 복구 확인"
echo "    kubectl get nodes --watch                    # Karpenter 노드 프로비저닝"
echo ""
info "  복구 예상 시간:"
echo "    ArgoCD sync 완료:    ~2분"
echo "    Karpenter 노드 준비: ~3~5분"
echo "    전체 pods Running:   ~5~10분"
echo ""
warn "  Istio ingressgateway가 0이라면 수동 복구 필요:"
echo "    kubectl scale deployment istio-ingressgateway -n istio-system --replicas=1"
