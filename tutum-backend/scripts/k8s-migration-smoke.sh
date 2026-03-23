#!/usr/bin/env bash
set -euo pipefail

INGRESS_URL="${INGRESS_URL:-http://192.168.0.240}"
FAILED=0

pass() { echo "[PASS] $*"; }
fail() { echo "[FAIL] $*"; FAILED=1; }
section() { echo; echo "=== $* ==="; }

check_deploy_ready() {
  local ns="$1"
  local name="$2"

  if ! kubectl -n "$ns" get deploy "$name" >/dev/null 2>&1; then
    fail "deployment/$name not found in $ns"
    return
  fi

  local desired ready
  desired="$(kubectl -n "$ns" get deploy "$name" -o jsonpath='{.spec.replicas}')"
  ready="$(kubectl -n "$ns" get deploy "$name" -o jsonpath='{.status.readyReplicas}')"
  desired="${desired:-1}"
  ready="${ready:-0}"

  if [[ "$desired" == "$ready" ]]; then
    pass "$ns deployment/$name ready ($ready/$desired)"
  else
    fail "$ns deployment/$name not ready ($ready/$desired)"
  fi
}

check_sts_ready() {
  local ns="$1"
  local name="$2"

  if ! kubectl -n "$ns" get sts "$name" >/dev/null 2>&1; then
    fail "statefulset/$name not found in $ns"
    return
  fi

  local desired ready
  desired="$(kubectl -n "$ns" get sts "$name" -o jsonpath='{.spec.replicas}')"
  ready="$(kubectl -n "$ns" get sts "$name" -o jsonpath='{.status.readyReplicas}')"
  desired="${desired:-1}"
  ready="${ready:-0}"

  if [[ "$desired" == "$ready" ]]; then
    pass "$ns statefulset/$name ready ($ready/$desired)"
  else
    fail "$ns statefulset/$name not ready ($ready/$desired)"
  fi
}

check_no_stg_resources() {
  local ns="$1"
  if kubectl -n "$ns" get all --ignore-not-found | grep -q 'stg-'; then
    fail "$ns still has stg-* resources"
  else
    pass "$ns has no stg-* resources"
  fi
}

check_non_running_pods() {
  local ns="$1"
  local tmp
  tmp="$(mktemp)"

  if [[ "$ns" == "tutum-data" ]]; then
    kubectl -n "$ns" get pod --no-headers 2>/dev/null | awk '$3 != "Running" && $3 != "Completed" {print}' >"$tmp" || true
  else
    kubectl -n "$ns" get pod --no-headers 2>/dev/null | awk '$3 != "Running" {print}' >"$tmp" || true
  fi

  if [[ -s "$tmp" ]]; then
    fail "$ns has non-running pods"
    cat "$tmp"
  else
    pass "$ns pods are healthy"
  fi

  rm -f "$tmp"
}

check_http() {
  local path="$1"
  local expected="$2"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' "${INGRESS_URL}${path}")"
  if [[ "$code" == "$expected" ]]; then
    pass "HTTP ${path} -> ${code}"
  else
    fail "HTTP ${path} -> ${code} (expected ${expected})"
  fi
}

section "Core Workloads"
check_deploy_ready tutum-app backend
check_deploy_ready tutum-app frontend
check_deploy_ready tutum-app price-producer
check_deploy_ready tutum-app price-consumer
check_deploy_ready tutum-app email-worker
check_sts_ready tutum-data mongodb
check_sts_ready tutum-data kafka
check_sts_ready tutum-data redis
check_sts_ready tutum-storage minio

section "Namespace Health"
check_non_running_pods tutum-app
check_non_running_pods tutum-data
check_non_running_pods tutum-storage

section "Staging Cleanup"
check_no_stg_resources tutum-app
check_no_stg_resources tutum-data
check_no_stg_resources tutum-storage

section "Ingress Smoke"
check_http "/" "200"
check_http "/api/v1/market/price/crypto/KRW-BTC" "200"

section "Summary"
if [[ "$FAILED" -eq 0 ]]; then
  echo "All checks passed."
else
  echo "Some checks failed."
fi

exit "$FAILED"
