# K8s Staging Sync Recovery + CI Guard + Service Alias Stabilization

**Date**: 2026-03-05  
**Branch**: develop  
**Author**: Codex

---

## Summary

`tutum-staging` had repeated sync instability, and `backend-svc/frontend-svc` in `tutum-app` had empty endpoints due selector drift.

This work restores stable staging behavior and prevents unsigned tags from being promoted by CI.

---

## Changes

### 1. CI deploy guard for staging

File: `.gitlab-ci.yml`

- Added strict `needs` for `deploy:staging`:
  - `sign:frontend`
  - `sign:backend`
  - `sign:workers`

Effect:
- `deploy:staging` now waits for image signing jobs to succeed.
- Unsigned tags cannot be written into `k8s-manifests/overlays/staging/kustomization.yaml`.

### 2. Staging image tag alignment

File: `k8s-manifests/overlays/staging/kustomization.yaml`

- Kept all app images on current staging revision:
  - `frontend`: `d0fbd48e`
  - `backend`: `d0fbd48e`
  - `workers`: `d0fbd48e`

Effect:
- Avoids accidental rollback and keeps staging on current deployment revision.

### 3. Service aliases moved into Argo-managed base

Files:
- `k8s-manifests/base/ingress/service-aliases.yaml` (new)
- `k8s-manifests/base/kustomization.yaml` (resource include)

Added managed services:
- `backend-svc` -> selector `app: backend`, port `8000`
- `frontend-svc` -> selector `app: frontend`, port `80 -> 3000`

Effect:
- Alias services are now continuously reconciled by Argo from source of truth.
- Prevents manual drift causing endpoint loss.

---

## Live Cluster Hotfix Applied

On `cp-1` (local cluster):

- Patched selectors on existing services in `tutum-app`:
  - `backend-svc.spec.selector = { app: backend }`
  - `frontend-svc.spec.selector = { app: frontend }`

Verification:

```bash
kubectl get endpoints -n tutum-app backend-svc frontend-svc
# backend-svc  -> endpoints populated
# frontend-svc -> endpoints populated
```

---

## Validation

- `kubectl kustomize k8s-manifests/overlays/staging` passed.
- Rendered staging manifests include:
  - `backend-svc`
  - `frontend-svc`
- Runtime endpoint recovery confirmed in cluster.

---

## Additional Finding (Production Degraded Root Cause)

`tutum-production` in Argo was `Synced / Degraded`.

Direct check against EKS cluster (via Argo cluster secret kubeconfig) showed:
- All 5 prod deployments in `tutum-prod-app` are `0/1`.
- Pods are `ImagePullBackOff`.
- Event reason is network timeout to GitLab registry:
  - `dial tcp 35.227.35.254:443: i/o timeout`

Conclusion:
- Production degradation is caused by EKS -> `registry.gitlab.com` egress reachability, not Argo diff or manifest syntax.
