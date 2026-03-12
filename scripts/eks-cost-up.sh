#!/bin/bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)]${NC} $*"; }
info() { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }

log "[1/5] Start monitoring EC2 (i-0a8cab5d5ce1cac60)"
aws ec2 start-instances \
  --instance-ids i-0a8cab5d5ce1cac60 \
  --region ap-northeast-2 \
  --output text \
  --query 'StartingInstances[0].CurrentState.Name' \
  >/dev/null 2>&1 \
  && log "monitoring EC2 start requested" \
  || warn "failed to start monitoring EC2; check AWS CLI credentials"

log "[2/5] Restore ArgoCD core components"
kubectl scale statefulset argocd-application-controller -n argocd --replicas=1 2>/dev/null || true
kubectl scale deployment argocd-redis -n argocd --replicas=1 2>/dev/null || true
kubectl scale deployment argocd-repo-server -n argocd --replicas=1 2>/dev/null || true
kubectl scale deployment argocd-server -n argocd --replicas=1 2>/dev/null || true
kubectl scale deployment argocd-dex-server -n argocd --replicas=1 2>/dev/null || true
kubectl scale deployment argocd-applicationset-controller -n argocd --replicas=1 2>/dev/null || true
kubectl scale deployment argocd-notifications-controller -n argocd --replicas=1 2>/dev/null || true

log "[3/5] Wait for ArgoCD control plane"
kubectl rollout status statefulset/argocd-application-controller -n argocd --timeout=180s
kubectl rollout status deployment/argocd-repo-server -n argocd --timeout=120s

log "[4/5] Resume KEDA scaled objects"
for so in $(kubectl get scaledobject -n tutum-app -o name 2>/dev/null || true); do
  kubectl annotate "${so}" -n tutum-app autoscaling.keda.sh/paused- --overwrite 2>/dev/null || true
done

log "[5/5] Restore non-KEDA workloads"
kubectl scale deployment auth -n tutum-app --replicas=2 2>/dev/null || true
kubectl scale deployment email-worker -n tutum-app --replicas=1 2>/dev/null || true
kubectl scale deployment news-producer -n tutum-app --replicas=1 2>/dev/null || true
kubectl scale deployment price-producer -n tutum-app --replicas=1 2>/dev/null || true
kubectl scale deployment ocr -n tutum-app --replicas=1 2>/dev/null || true

kubectl scale deployment elasticsearch-exporter -n tutum-data --replicas=1 2>/dev/null || true
kubectl scale deployment kafka-exporter -n tutum-data --replicas=1 2>/dev/null || true
kubectl scale deployment redis-exporter -n tutum-data --replicas=1 2>/dev/null || true

kubectl scale deployment kyverno-admission-controller -n kyverno --replicas=1 2>/dev/null || true
kubectl scale deployment kyverno-background-controller -n kyverno --replicas=1 2>/dev/null || true
kubectl scale deployment kyverno-cleanup-controller -n kyverno --replicas=1 2>/dev/null || true
kubectl scale deployment kyverno-reports-controller -n kyverno --replicas=1 2>/dev/null || true

kubectl scale deployment --all -n gitlab-runner --replicas=1 2>/dev/null || true

if kubectl get deployment istio-ingressgateway -n istio-system >/dev/null 2>&1; then
  info "legacy istio-ingressgateway detected; scaling it back to 1"
  kubectl scale deployment istio-ingressgateway -n istio-system --replicas=1 2>/dev/null || true
fi

echo
echo "Cost-up sequence completed."
echo "KEDA-managed workloads will recover after ArgoCD sync and metric polling."
echo
info "Recommended checks:"
echo "  kubectl get applications -n argocd"
echo "  kubectl get pods -n tutum-app --watch"
echo "  kubectl get nodes --watch"
echo
info "Expected recovery window:"
echo "  ArgoCD control plane: 2-3 minutes"
echo "  Karpenter nodes: 3-5 minutes"
echo "  Full workload recovery: 5-10 minutes"
