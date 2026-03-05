# Development Log Summary (2026-03-05)

## 1. Work Summary
- Work date: 2026-03-05
- Worker: Codex (with operator-approved remote access)
- Branch: develop
- Objective:
  - Complete pending worker maintenance blocked by PDB during `worker3` drain
  - Increase `clouddx-worker3` VM memory safely and recover cluster scheduling
  - Re-run cluster-wide health checks to confirm stabilization

## 2. Detailed Changes
- Runtime operations (cluster):
  - Confirmed drain block root cause: `tutum-app/backend-pdb` had `minAvailable=2` with only 2 backend replicas
  - Temporarily changed `backend-pdb` to `minAvailable=1` to allow one safe eviction
  - Completed `kubectl drain worker3 --ignore-daemonsets --delete-emptydir-data --force`
  - `kubectl uncordon worker3` after node recovery
  - Restored `backend-pdb` to `minAvailable=2`

- Runtime operations (host/VM):
  - Powered off `clouddx-worker3` VM
  - Updated memory with VirtualBox: `8192 -> 10240` MB
  - Restarted VM and verified node rejoin

- GitOps fix (staging):
  - File: `k8s-manifests/overlays/staging/kustomization.yaml`
  - Re-pinned staging images from unsigned `450a887a` to signed `2df8d9da`
  - Purpose: remove Kyverno `verify-image-signature` admission block and recover Argo sync

## 3. Issues and Resolutions
- Issue:
  - Drain of `worker3` repeatedly timed out due PDB (`backend-pdb`) denying eviction
- Resolution:
  - Applied temporary PDB relaxation only for maintenance window, then restored original value

- Issue:
  - During worker reboot window, stateful/data pods on `worker3` were temporarily `Pending`
- Resolution:
  - Waited for kubelet/node readiness and confirmed all pending pods returned to `Running`

## 4. Result (with Verification)
- Verification result:
```bash
kubectl get nodes -o wide
# cp-1/cp-2/cp-3/worker1/worker2/worker3 all Ready

kubectl top nodes
# worker3 memory visible again (~35% at check time), no <unknown>

kubectl describe node worker3 | egrep -A4 'Capacity:|Allocatable:'
# Capacity memory: 10179976Ki (reflects 10GB class VM memory)

kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded
# No resources found

kubectl -n tutum-app get pdb backend-pdb -o wide
# MIN AVAILABLE = 2 (restored)

kubectl -n argocd get applications.argoproj.io
# tutum-production Synced/Healthy
# tutum-staging Synced/Healthy (after develop push + reconcile)
```

## 5. Commit Log
```bash
git log --oneline --since="2026-03-05" --until="2026-03-05 23:59:59"
```

## 6. Follow-up Tasks / Risks
- [ ] Consider pod spread/anti-affinity for critical app deployments (`backend`, `frontend`) to avoid single-worker concentration after maintenance drains
- [ ] Keep periodic checks for recurring warning noise: `DNSConfigForming` and historical high restart count on `kube-proxy` (worker2)
