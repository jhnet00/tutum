#!/bin/bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

AWS_REGION="${AWS_REGION:-ap-northeast-2}"
STAGING_CLUSTER_NAME="${STAGING_CLUSTER_NAME:-tutum-stg-eks}"
MONITORING_INSTANCE_ID="${MONITORING_INSTANCE_ID:-i-0a8cab5d5ce1cac60}"
START_MONITORING="${START_MONITORING:-1}"
KUBECTL_BIN="${KUBECTL_BIN:-$(command -v kubectl 2>/dev/null || command -v kubectl.exe 2>/dev/null || true)}"
AWS_BIN="${AWS_BIN:-$(command -v aws 2>/dev/null || command -v aws.exe 2>/dev/null || true)}"

log()  { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)]${NC} $*"; }
info() { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }
fail() { echo -e "${RED}[$(date +%H:%M:%S)]${NC} $*" >&2; exit 1; }

[[ -n "${KUBECTL_BIN}" ]] || fail "kubectl not found in PATH"
[[ -n "${AWS_BIN}" ]] || fail "aws CLI not found in PATH"

current_context="$("${KUBECTL_BIN}" config current-context 2>/dev/null || true)"
[[ -n "${current_context}" ]] || fail "kubectl current-context is empty"
[[ "${current_context}" == *"${STAGING_CLUSTER_NAME}"* ]] || fail "current context '${current_context}' is not ${STAGING_CLUSTER_NAME}"

scale_named_deployments() {
  local namespace="$1"
  local replicas="$2"
  shift 2

  for deploy in "$@"; do
    "${KUBECTL_BIN}" scale deployment "${deploy}" -n "${namespace}" --replicas="${replicas}" 2>/dev/null || true
  done
}

log "[1/6] Start monitoring EC2 when requested"
if [[ "${START_MONITORING}" == "1" ]]; then
  "${AWS_BIN}" ec2 start-instances \
    --instance-ids "${MONITORING_INSTANCE_ID}" \
    --region "${AWS_REGION}" \
    --output text \
    --query 'StartingInstances[0].CurrentState.Name' \
    >/dev/null 2>&1 \
    && log "monitoring EC2 start requested" \
    || warn "failed to start monitoring EC2; check AWS CLI credentials"
else
  warn "START_MONITORING=0, skipping monitoring EC2 start"
fi

log "[2/6] Restore cluster control-plane workloads"
scale_named_deployments kube-system 2 aws-load-balancer-controller metrics-server
scale_named_deployments external-secrets 1 external-secrets external-secrets-cert-controller external-secrets-webhook
scale_named_deployments keda 1 keda-operator keda-operator-metrics-apiserver keda-admission-webhooks
scale_named_deployments kyverno 1 kyverno-admission-controller kyverno-background-controller kyverno-cleanup-controller kyverno-reports-controller
scale_named_deployments gitlab-runner 1 gitlab-runner
scale_named_deployments istio-system 1 istiod kiali
scale_named_deployments kiali-operator 1 kiali-operator

log "[3/6] Restore ArgoCD core components"
"${KUBECTL_BIN}" scale statefulset argocd-application-controller -n argocd --replicas=1 2>/dev/null || true
scale_named_deployments argocd 1 \
  argocd-redis \
  argocd-repo-server \
  argocd-server \
  argocd-dex-server \
  argocd-applicationset-controller \
  argocd-notifications-controller

log "[4/6] Wait for ArgoCD control plane"
"${KUBECTL_BIN}" rollout status statefulset/argocd-application-controller -n argocd --timeout=240s
"${KUBECTL_BIN}" rollout status deployment/argocd-repo-server -n argocd --timeout=180s

log "[5/6] Resume KEDA and force staging app reconciliation"
for so in $("${KUBECTL_BIN}" get scaledobject -n tutum-app -o name 2>/dev/null || true); do
  "${KUBECTL_BIN}" annotate "${so}" -n tutum-app autoscaling.keda.sh/paused- >/dev/null 2>&1 || true
done
"${KUBECTL_BIN}" annotate application tutum-staging -n argocd argocd.argoproj.io/refresh=hard --overwrite >/dev/null 2>&1 || true

log "[6/6] Restore fixed-replica workloads that ArgoCD should not wait to heal"
scale_named_deployments tutum-app 2 auth
scale_named_deployments tutum-app 1 email-worker news-producer price-producer ocr
scale_named_deployments tutum-data 1 elasticsearch-exporter kafka-exporter redis-exporter

echo
echo "Staging full-up sequence completed."
echo "ArgoCD will restore application and stateful workloads to the manifest-defined state."
echo
info "Recommended checks:"
echo "  kubectl get app -n argocd tutum-staging"
echo "  kubectl get pods -A --watch"
echo "  kubectl get nodepool"
echo
info "Expected recovery window:"
echo "  Control-plane workloads: 2-4 minutes"
echo "  Karpenter nodes: 3-6 minutes"
echo "  Full workload recovery: 8-15 minutes"
