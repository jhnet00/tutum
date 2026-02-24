#!/usr/bin/env bash
set -euo pipefail

GRAFANA_URL="${GRAFANA_URL:-http://localhost:3000}"
GRAFANA_USER="${GRAFANA_USER:-admin}"
GRAFANA_PASSWORD="${GRAFANA_PASSWORD:-tutum2026!}"

ok() { printf "[OK] %s\n" "$1"; }
fail() { printf "[FAIL] %s\n" "$1"; exit 1; }

check_ready() {
  local name="$1"
  local url="$2"
  local body
  body="$(curl -fsS "$url" 2>/dev/null || true)"
  if [[ -n "$body" ]]; then
    ok "$name ready: $url"
  else
    fail "$name ready check failed: $url"
  fi
}

check_http_200() {
  local name="$1"
  local url="$2"
  local code
  code="$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || true)"
  if [[ "$code" == "200" ]]; then
    ok "$name HTTP 200: $url"
  else
    fail "$name unexpected HTTP code ($code): $url"
  fi
}

check_grafana_item() {
  local type="$1"
  local path="$2"
  local match="$3"
  local body
  body="$(curl -fsS -u "$GRAFANA_USER:$GRAFANA_PASSWORD" "$GRAFANA_URL$path" 2>/dev/null || true)"
  if [[ "$body" == *"$match"* ]]; then
    ok "Grafana $type found: $match"
  else
    fail "Grafana $type missing: $match"
  fi
}

echo "== LGTM readiness =="
check_ready "Loki" "http://localhost:3100/ready"
check_ready "Tempo" "http://localhost:3200/ready"
check_ready "Mimir" "http://localhost:9009/ready"
check_http_200 "Grafana" "$GRAFANA_URL/api/health"

echo
echo "== Grafana provisioning =="
check_grafana_item "datasource" "/api/datasources" "\"uid\":\"mimir\""
check_grafana_item "datasource" "/api/datasources" "\"uid\":\"loki\""
check_grafana_item "datasource" "/api/datasources" "\"uid\":\"tempo\""
check_grafana_item "datasource" "/api/datasources" "\"uid\":\"influxdb\""
check_grafana_item "dashboard" "/api/search?query=tutum" "\"uid\":\"tutum-k8s-overview\""
check_grafana_item "dashboard" "/api/search?query=tutum" "\"uid\":\"tutum-data-layer\""

echo
ok "LGTM stack is operational and dashboards are provisioned."
