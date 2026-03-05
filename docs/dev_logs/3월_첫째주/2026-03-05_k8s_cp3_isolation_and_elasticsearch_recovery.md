# Development Log Summary (2026-03-05)

## 1. Work Summary
- Work date: 2026-03-05
- Worker: Kyung Yoon Kim
- Branch: develop
- Objective:
  - Re-check K8s cluster stability after migration
  - Isolate `cp-3` impact and recover staging/production app availability
  - Recover ArgoCD repo-server crash and data-plane Redis failure
  - Make Elasticsearch scheduling/probe policy stable in GitOps source

## 2. Detailed Changes
- Runtime operations (cluster):
  - `cp-3` cordoned and restored control-plane taint to stop new workload placement
  - Force-evicted app pods stuck on unreachable `cp-3` so controllers re-scheduled on worker nodes
  - Recovered `argocd-repo-server` by patching init symlink behavior (`ln -s` -> `ln -sf`) and restarting rollout
  - Recovered `redis-1` CrashLoop caused by corrupted AOF by recreating the replica path via StatefulSet scale cycle
  - Recreated workload pods for `tutum-app` and `tutum-prod-app` on healthy workers

- Git changes:
  - File: `k8s-manifests/base/data/elasticsearch.yaml`
  - Changed `nodeSelector.workload` from `data` to `app` to match current available worker labels
  - Increased Elasticsearch startup probe windows:
    - `readinessProbe.initialDelaySeconds`: `20 -> 60`
    - `readinessProbe.failureThreshold`: `3 -> 6`
    - `livenessProbe.initialDelaySeconds`: `30 -> 120`
    - `livenessProbe.failureThreshold`: `3 -> 6`

## 3. Issues and Resolutions
- Issue:
  - `cp-3` node remained `NotReady` and still held stale workload pods, causing partial availability and skewed readiness
- Resolution:
  - Isolated node scheduling and force-evicted impacted pods for relocation to `worker1/2/3`

- Issue:
  - `argocd-repo-server` init container failed with `ln: Already exists`, leaving Argo apps in `Unknown/Progressing`
- Resolution:
  - Patched init command to idempotent symlink creation (`ln -sf`) and restarted deployment

- Issue:
  - `redis-1` failed with AOF corruption (`Bad file format ... appendonly.aof...`)
- Resolution:
  - Rebuilt replica through StatefulSet scale and PVC recreation path

- Issue:
  - Elasticsearch could not settle under current cluster constraints and probe timing
- Resolution:
  - Updated GitOps manifest for scheduling compatibility and slower startup health windows

## 4. Result (with Verification)
- Verification items:
  - Node/Argo/workload health
  - Data StatefulSet health
  - Ingress smoke tests
- Verification result:
```bash
kubectl get nodes -o wide
# cp-1/cp-2/worker1/worker2/worker3 Ready, cp-3 NotReady,SchedulingDisabled

kubectl -n tutum-app get deploy
# all Ready except elastic-consumer (dependent on elasticsearch stabilization)

kubectl -n tutum-prod-app get deploy
# backend/email-worker/frontend/price-consumer/price-producer all Ready

kubectl -n tutum-data get sts
# kafka 3/3, mongodb 3/3, redis 3/3, elasticsearch pending stabilization

kubectl -n argocd get applications.argoproj.io
# tutum-production OutOfSync/Healthy
# tutum-staging OutOfSync/Progressing

curl -I http://192.168.0.240/
# 200
curl -I http://192.168.0.240/api/v1/market/price/crypto/KRW-BTC
# 200
```

## 5. Commit Log
```bash
git log --oneline --since="2026-03-05" --until="2026-03-05 23:59:59"
```

## 6. Follow-up Tasks / Risks
- [ ] Recover `cp-3` host-level SSH/kubelet/containerd and return node to `Ready`
- [ ] Confirm Argo staging app reaches `Synced/Healthy` after develop branch push
- [ ] Verify `elastic-consumer` transitions to Ready after Elasticsearch fully stabilizes
- [ ] Revisit final node role/label policy (`workload=app|data`) to avoid future selector conflicts
