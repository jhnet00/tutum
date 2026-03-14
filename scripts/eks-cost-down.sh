#!/bin/bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

AWS_REGION="${AWS_REGION:-ap-northeast-2}"
STAGING_CLUSTER_NAME="${STAGING_CLUSTER_NAME:-tutum-stg-eks}"
MONITORING_INSTANCE_ID="${MONITORING_INSTANCE_ID:-i-0a8cab5d5ce1cac60}"
STOP_MONITORING="${STOP_MONITORING:-1}"
KUBECTL_BIN="${KUBECTL_BIN:-$(command -v kubectl 2>/dev/null || command -v kubectl.exe 2>/dev/null || true)}"
AWS_BIN="${AWS_BIN:-$(command -v aws 2>/dev/null || command -v aws.exe 2>/dev/null || true)}"

log()  { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)]${NC} $*"; }
fail() { echo -e "${RED}[$(date +%H:%M:%S)]${NC} $*" >&2; exit 1; }

[[ -n "${KUBECTL_BIN}" ]] || fail "kubectl not found in PATH"
[[ -n "${AWS_BIN}" ]] || fail "aws CLI not found in PATH"

current_context="$("${KUBECTL_BIN}" config current-context 2>/dev/null || true)"
[[ -n "${current_context}" ]] || fail "kubectl current-context is empty"
[[ "${current_context}" == *"${STAGING_CLUSTER_NAME}"* ]] || fail "current context '${current_context}' is not ${STAGING_CLUSTER_NAME}"

scale_namespace_zero() {
  local namespace="$1"

  if ! "${KUBECTL_BIN}" get namespace "${namespace}" >/dev/null 2>&1; then
    warn "namespace ${namespace} does not exist; skipping"
    return
  fi

  warn "  namespace: ${namespace}"
  "${KUBECTL_BIN}" scale deployment --all -n "${namespace}" --replicas=0 2>/dev/null || true
  "${KUBECTL_BIN}" scale statefulset --all -n "${namespace}" --replicas=0 2>/dev/null || true
}

scale_named_deployments_zero() {
  local namespace="$1"
  shift

  for deploy in "$@"; do
    "${KUBECTL_BIN}" scale deployment "${deploy}" -n "${namespace}" --replicas=0 2>/dev/null || true
  done
}

log "[1/7] Pause KEDA scaled objects"
for so in $("${KUBECTL_BIN}" get scaledobject -n tutum-app -o name 2>/dev/null || true); do
  "${KUBECTL_BIN}" annotate "${so}" -n tutum-app autoscaling.keda.sh/paused=true --overwrite >/dev/null
done

log "[2/7] Scale staging application and data namespaces to zero"
for namespace in tutum-app tutum-data; do
  scale_namespace_zero "${namespace}"
done

log "[3/7] Scale ancillary namespaces to zero"
scale_namespace_zero gitlab-runner
scale_named_deployments_zero kyverno \
  kyverno-admission-controller \
  kyverno-background-controller \
  kyverno-cleanup-controller \
  kyverno-reports-controller
scale_named_deployments_zero keda \
  keda-operator \
  keda-operator-metrics-apiserver \
  keda-admission-webhooks
scale_named_deployments_zero external-secrets \
  external-secrets \
  external-secrets-cert-controller \
  external-secrets-webhook
scale_named_deployments_zero istio-system \
  istiod \
  kiali
scale_named_deployments_zero kiali-operator \
  kiali-operator
scale_named_deployments_zero kube-system \
  aws-load-balancer-controller \
  metrics-server

log "[4/7] Scale down ArgoCD control plane"
scale_named_deployments_zero argocd \
  argocd-server \
  argocd-repo-server \
  argocd-applicationset-controller \
  argocd-notifications-controller \
  argocd-dex-server \
  argocd-redis
"${KUBECTL_BIN}" scale statefulset argocd-application-controller -n argocd --replicas=0 2>/dev/null || true

log "[5/7] Re-apply zero scale after ArgoCD shutdown"
for namespace in tutum-app tutum-data; do
  scale_namespace_zero "${namespace}"
done

log "[6/7] Stop monitoring EC2 when requested"
if [[ "${STOP_MONITORING}" == "1" ]]; then
  "${AWS_BIN}" ec2 stop-instances \
    --instance-ids "${MONITORING_INSTANCE_ID}" \
    --region "${AWS_REGION}" \
    --output text \
    --query 'StoppingInstances[0].CurrentState.Name' \
    >/dev/null 2>&1 \
    && log "monitoring EC2 stop requested" \
    || warn "failed to stop monitoring EC2; check AWS CLI credentials"
else
  warn "STOP_MONITORING=0, skipping monitoring EC2 stop"
fi

log "[7/7] Current node usage after full-down request"
"${KUBECTL_BIN}" get nodepool
"${KUBECTL_BIN}" get pods -A | grep -v Running || true

echo
echo "Staging full-down sequence completed."
echo "Remaining baseline cost still includes the staging EKS control plane, NAT Gateway, EBS volumes, and shared AWS services."
echo
echo "Restore command:"
echo "  bash scripts/eks-cost-up.sh"
