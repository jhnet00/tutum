#!/bin/bash
# ============================================================
#  eks-cost-up.sh — 출근 시 EKS 워크로드 복구 스크립트
#  실행 위치: cp-2 (kubectl + aws CLI 모두 준비됨)
#  사용법: bash scripts/eks-cost-up.sh
#
#  원리: ArgoCD를 올리면 git 상태(selfHeal: true)로 전부 자동 복구
#        단, ArgoCD는 ignoreDifferences: /spec/replicas 설정으로
#        비KEDA deployment replicas를 복구하지 않으므로 수동 복구 필요
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
log "[3/5] ArgoCD application-controller 준비 대기 (최대 3분)"
kubectl rollout status statefulset/argocd-application-controller -n argocd --timeout=180s
kubectl rollout status deployment/argocd-repo-server -n argocd --timeout=120s

# ─────────────────────────────────────────
# STEP 4: KEDA ScaledObjects 재개
#   ArgoCD selfHeal이 replicas를 복구하기 전에 KEDA pause 해제
#   → KEDA가 정상적으로 min/max replica 관리 재개
# ─────────────────────────────────────────
log "[4/5] KEDA ScaledObjects 재개"
for so in $(kubectl get scaledobject -n tutum-app -o name 2>/dev/null); do
  kubectl annotate "$so" -n tutum-app autoscaling.keda.sh/paused- --overwrite 2>/dev/null || true
done

# ─────────────────────────────────────────
# STEP 5: 비KEDA Deployment 수동 복구
#   ArgoCD ignoreDifferences: /spec/replicas 로 인해
#   아래 서비스는 selfHeal이 replicas를 복구하지 않음
# ─────────────────────────────────────────
log "[5/6] 비KEDA Deployment 수동 복구"

# tutum-app: KEDA 없는 워크로드
kubectl scale deployment auth         -n tutum-app --replicas=2 2>/dev/null || true
kubectl scale deployment email-worker -n tutum-app --replicas=1 2>/dev/null || true
kubectl scale deployment news-producer  -n tutum-app --replicas=1 2>/dev/null || true
kubectl scale deployment price-producer -n tutum-app --replicas=1 2>/dev/null || true
kubectl scale deployment ocr          -n tutum-app --replicas=1 2>/dev/null || true

# tutum-data: 모니터링 exporter
kubectl scale deployment elasticsearch-exporter -n tutum-data --replicas=1 2>/dev/null || true
kubectl scale deployment kafka-exporter         -n tutum-data --replicas=1 2>/dev/null || true
kubectl scale deployment redis-exporter         -n tutum-data --replicas=1 2>/dev/null || true

# kyverno
kubectl scale deployment kyverno-admission-controller  -n kyverno --replicas=1 2>/dev/null || true
kubectl scale deployment kyverno-background-controller -n kyverno --replicas=1 2>/dev/null || true
kubectl scale deployment kyverno-cleanup-controller    -n kyverno --replicas=1 2>/dev/null || true
kubectl scale deployment kyverno-reports-controller    -n kyverno --replicas=1 2>/dev/null || true

# gitlab-runner
kubectl scale deployment --all -n gitlab-runner --replicas=1 2>/dev/null || true

# ─────────────────────────────────────────
# STEP 6: 완료 안내
# ─────────────────────────────────────────
log "[6/6] 완료"
echo ""
echo "✅ 복구 완료. KEDA 서비스는 자동, 비KEDA 서비스는 수동 복구 완료."
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
