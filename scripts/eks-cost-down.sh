#!/bin/bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)]${NC} $*"; }

scale_namespace_zero() {
  local namespace="$1"

  if ! kubectl get namespace "${namespace}" >/dev/null 2>&1; then
    warn "namespace ${namespace} does not exist; skipping"
    return
  fi

  warn "  namespace: ${namespace}"
  kubectl scale deployment --all -n "${namespace}" --replicas=0 2>/dev/null || true
  kubectl scale statefulset --all -n "${namespace}" --replicas=0 2>/dev/null || true
}

log "[1/5] Scale down ArgoCD core components"
kubectl scale deployment argocd-server -n argocd --replicas=0 2>/dev/null || true
kubectl scale deployment argocd-repo-server -n argocd --replicas=0 2>/dev/null || true
kubectl scale deployment argocd-applicationset-controller -n argocd --replicas=0 2>/dev/null || true
kubectl scale deployment argocd-notifications-controller -n argocd --replicas=0 2>/dev/null || true
kubectl scale deployment argocd-dex-server -n argocd --replicas=0 2>/dev/null || true
kubectl scale deployment argocd-redis -n argocd --replicas=0 2>/dev/null || true
kubectl scale statefulset argocd-application-controller -n argocd --replicas=0 2>/dev/null || true

log "[2/5] Pause KEDA scaled objects"
for so in $(kubectl get scaledobject -n tutum-app -o name 2>/dev/null || true); do
  kubectl annotate "${so}" -n tutum-app autoscaling.keda.sh/paused=true --overwrite >/dev/null
done

log "[3/5] Scale application and data workloads to zero"
for namespace in tutum-app tutum-data; do
  scale_namespace_zero "${namespace}"
done

log "[4/5] Scale ancillary workloads to zero"
scale_namespace_zero gitlab-runner
scale_namespace_zero kyverno

if kubectl get deployment istio-ingressgateway -n istio-system >/dev/null 2>&1; then
  kubectl scale deployment istio-ingressgateway -n istio-system --replicas=0 2>/dev/null || true
fi

log "[5/5] Stop monitoring EC2 (i-0a8cab5d5ce1cac60)"
aws ec2 stop-instances \
  --instance-ids i-0a8cab5d5ce1cac60 \
  --region ap-northeast-2 \
  --output text \
  --query 'StoppingInstances[0].CurrentState.Name' \
  >/dev/null 2>&1 \
  && log "monitoring EC2 stop requested" \
  || warn "failed to stop monitoring EC2; check AWS CLI credentials"

echo
echo "Cost-down sequence completed."
echo "Remaining baseline cost still includes EKS control plane, NAT Gateway, and EBS volumes."
echo
echo "Recommended checks:"
echo "  kubectl get nodes --watch"
echo "  kubectl get pods -A | grep -v Running"
echo
echo "Restore command:"
echo "  bash scripts/eks-cost-up.sh"
