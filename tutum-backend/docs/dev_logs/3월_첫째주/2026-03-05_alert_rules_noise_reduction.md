# Development Log Summary (2026-03-05)

## 1. Work Summary
- Work date: 2026-03-05
- Worker: Codex (operator-assisted)
- Branch: develop
- Objective:
  - Investigate recurring Slack alert noise pattern similar to `NodeDiskFull`
  - Tune alert rules that can produce false positives due broad selectors, invalid denominators, or stale-state semantics

## 2. Findings
- Active alert check before tuning:
  - `HighLatency` firing continuously
  - `RedisMemoryHigh` firing with `value=+Inf`
- Root cause patterns:
  - `RedisMemoryHigh`: division by zero (`redis_memory_max_bytes=0`) can produce `+Inf`
  - `HighLatency`: histogram quantile computed without proper bucket aggregation and too-sensitive threshold scope
  - `HighErrorRate`: no denominator guard / low-traffic guard
  - backup rules: stale or lifetime-total metric semantics prone to noisy or incorrect behavior

## 3. Changes Applied
- Live Grafana rule update (monitoring VM `192.168.0.230:3000`):
  - Updated rules:
    - `BackendDown`
    - `HighErrorRate`
    - `RedisMemoryHigh`
    - `HighLatency`
  - Result after live update:
    - active alert count `2 -> 0`

- Git changes:
  - File: `k8s-manifests/step3-lgtm/monitoring-vm/grafana/provisioning/alerting/alert-rules.yml`
    - `BackendDown`: scope to backend app in tutum namespaces
    - `HighErrorRate`: safe ratio with `clamp_min` + min traffic guard
    - `RedisMemoryHigh`: add `redis_memory_max_bytes > 0` guard
    - `HighLatency`: proper histogram aggregation (`sum by (le, namespace)`) + request-rate guard + threshold text update (`100ms -> 500ms`)
    - `BackupCronJobFailed`: use `increase(...[1h])` to avoid stale failure state
    - `MinIOStorageHigh`: add denominator validity guard
    - `BackupMissed3Days`: use 72h increase window (`sum(increase(...[72h])) < 1`)
  - File: `scripts/setup_alert_rules.py`
    - Synced core rule expressions (`BackendDown`, `HighErrorRate`, `RedisMemoryHigh`, `HighLatency`) with tuned logic

## 4. Verification
```bash
# Grafana alertmanager active alerts
active_count=0

# live rule expression checks (key rules)
BackendDown, HighErrorRate, RedisMemoryHigh, HighLatency, NodeDiskFull
# all confirmed with updated expressions

# cluster health baseline
kubectl get nodes
# all Ready
```

## 5. Follow-up Tasks / Risks
- [ ] Keep watching `worker1` root usage trend (~77%) for future real disk risk
- [ ] If latency alert is still noisy under real traffic, tune threshold and `for` duration with SLO baseline data
