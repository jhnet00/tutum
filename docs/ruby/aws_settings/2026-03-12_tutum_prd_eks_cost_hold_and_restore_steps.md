# 2026-03-12 tutum-prd-eks 비용 홀드 및 재가동 절차

## 1) 현재 확정 상태

### Cluster
- Cluster name: `tutum-prd-eks`
- Status: `ACTIVE`
- Kubernetes version: `1.35`

### Managed NodeGroup
- `ng-prd-general`은 삭제 중(`DELETING`)
- 관련 `m6i.large` 2대는 `shutting-down`
- 즉, managed nodegroup 비용 절감은 이미 반영 중

### 현재 유지 중인 NodePool
- `system`: `c6g.large` 2대
- `general-purpose`: `c5a.large` 3대

### 현재 유지 중인 앱 상태
namespace: `tutum-app`

유지:
- `backend` 1
- `frontend` 1

중지:
- `elastic-consumer` 0
- `email-worker` 0
- `news-consumer` 0
- `news-producer` 0
- `ocr` 0
- `price-consumer` 0
- `price-producer` 0
- `cloudflared` 0

주의:
- `istiod`가 `general-purpose` 노드에 단독으로 올라가 있으며 PDB 때문에 강제 drain 불가
- 현재 구조상 `general-purpose` 3대는 최소 유지 수량으로 보는 것이 안전함

---

## 2) 지금 유지해야 하는 운영 원칙

현재 시점 기준 최적 상태:
1. managed nodegroup 삭제는 그대로 진행
2. `system` nodepool 2대 유지
3. `general-purpose` nodepool 3대 유지
4. `backend/frontend` 최소 replica 유지
5. 비핵심 워커는 0 유지

지금은 추가 비용 절감보다 안정 유지가 우선이다.

---

## 3) 현재 상태 유지용 확인 명령

```bash
kubectl --context tutum-prd-eks get nodepools,nodeclaims
kubectl --context tutum-prd-eks get nodes -L karpenter.sh/nodepool,node.kubernetes.io/instance-type
kubectl --context tutum-prd-eks get deploy -n tutum-app
kubectl --context tutum-prd-eks get pods -n tutum-app -o wide
kubectl --context tutum-prd-eks get pods -n istio-system -o wide
aws eks describe-nodegroup \
  --region ap-northeast-2 \
  --cluster-name tutum-prd-eks \
  --nodegroup-name ng-prd-general \
  --profile ruby
```

정상 기대값:
- `ng-prd-general`: `DELETING`
- `system`: 2대
- `general-purpose`: 3대
- `backend/frontend`: 1 replica 유지
- 나머지 비핵심 워커: 0

---

## 4) 서비스 유지형 축소의 현재 한계

현재 더 줄이지 않는 이유:
- `istiod`가 단일 replica라 drain 시 PDB 위반 발생
- `argocd`, `keda`, `istio`, 앱 일부가 `general-purpose`에 혼재
- 따라서 현재 구조에서는 `general-purpose`를 2대로 더 줄이면 장애 가능성이 높음

결론:
- 현재는 `general-purpose` 3대가 최소 안정 운영선

---

## 5) 나중에 다시 더 줄이고 싶을 때 선행 작업

추가 절감을 원하면 먼저 아래를 해야 한다.

1. `istiod` replica / PDB 재설계
2. `argocd`, `keda`, `istio`를 infra 전용 NodePool로 분리
3. 앱 파드와 인프라 파드의 `nodeSelector` / `taint` / `toleration` 정리
4. 그 이후에 `general-purpose`를 2대로 축소 재시도

즉, 구조 개선 없이 노드만 먼저 줄이는 방식은 다시 하지 않는 것이 맞다.

---

## 6) 다시 키는 절차(undo / restore)

현재는 이미 복구된 상태이므로, 이후 다시 조정할 때의 기준만 남긴다.

### Step 1. NodePool 확인
```bash
kubectl --context tutum-prd-eks get nodepools,nodeclaims
```

### Step 2. 필요 시 `general-purpose` NodePool 복구
백업 파일이 있으면:
```bash
kubectl --context tutum-prd-eks apply -f /tmp/general-purpose-nodepool.yaml
```

주의:
- live object를 다시 `apply`할 때 `metadata.resourceVersion` 오류가 날 수 있음
- 이미 NodePool이 존재하면 다시 생성할 필요 없음

### Step 3. cordon 해제
```bash
kubectl --context tutum-prd-eks uncordon <node-name>
```

### Step 4. 앱 replica 복구
필요 시:
```bash
kubectl --context tutum-prd-eks scale deploy backend --replicas=2 -n tutum-app
kubectl --context tutum-prd-eks scale deploy frontend --replicas=2 -n tutum-app
kubectl --context tutum-prd-eks scale deploy price-consumer --replicas=1 -n tutum-app
kubectl --context tutum-prd-eks scale deploy price-producer --replicas=1 -n tutum-app
kubectl --context tutum-prd-eks scale deploy news-consumer --replicas=1 -n tutum-app
kubectl --context tutum-prd-eks scale deploy news-producer --replicas=1 -n tutum-app
kubectl --context tutum-prd-eks scale deploy email-worker --replicas=1 -n tutum-app
kubectl --context tutum-prd-eks scale deploy elastic-consumer --replicas=1 -n tutum-app
kubectl --context tutum-prd-eks scale deploy ocr --replicas=1 -n tutum-app
```

### Step 5. 최종 확인
```bash
kubectl --context tutum-prd-eks get pods -A
kubectl --context tutum-prd-eks get nodes -L karpenter.sh/nodepool,node.kubernetes.io/instance-type
argocd app get tutum-production
```

---

## 7) 비용 요약

이미 반영된 절감:
- `m6i.large` 2대 제거 중
- 예상 절감: 하루 약 `$5.66/day`

현재 유지 비용(대략, compute 기준):
- `general-purpose` 3 x `c5a.large`
- `system` 2 x `c6g.large`
- 하루 약 `$9.89/day`

주의:
- NAT, EKS control plane, EBS, 트래픽 등은 별도다.
- 노드 비용만 줄인다고 총비용이 0이 되지는 않는다.

---

## 8) 현재 결론

- 지금 상태를 유지하는 것이 맞다.
- managed nodegroup 삭제는 그대로 두고,
- `general-purpose` 3대 + `system` 2대 + `backend/frontend` 최소 replica 조합으로 운영 유지
- 다음 비용 절감은 노드 삭제가 아니라 구조 분리 이후에 다시 검토
