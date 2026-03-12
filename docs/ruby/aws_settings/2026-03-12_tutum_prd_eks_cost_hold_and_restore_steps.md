# 2026-03-12 tutum-prd-eks 비용 홀드 및 재가동 절차

## 1) 현재 확인된 상태

### Cluster
- Cluster name: `tutum-prd-eks`
- Status: `ACTIVE`
- Kubernetes version: `1.35`

### Managed NodeGroup
- 현재 없음
- 기존 `ng-prd-general`은 삭제 완료 상태

### 현재 남아 있는 Karpenter 노드
- `system`: `c6g.large` 2대, `on-demand`
- `general-purpose`: `c5a.large` 3대, `on-demand`

### 현재 남아 있는 주요 앱 워크로드
- namespace: `tutum-app`
- Running: `backend`, `frontend`, `price-consumer`
- Pending: `elastic-consumer`, `email-worker`, `frontend` 일부, `news-consumer`, `news-producer`, `ocr`, `price-producer`

의미:
- prod 비용은 완전히 멈춘 상태가 아니다.
- managed nodegroup 비용은 줄었지만, `tutum-app` 파드와 Pending 파드 때문에 Karpenter `general-purpose` 노드가 유지되고 있다.

---

## 2) 비용 홀드 목표

목표는 아래 3개를 동시에 만족하는 것이다.

1. prod cluster 자체는 보존
2. 불필요한 앱 워크로드와 일반 노드 비용 최소화
3. 나중에 다시 켤 때 빠르게 복구 가능

권장 원칙:
- `system` nodepool은 바로 건드리지 않는다.
- 먼저 `tutum-app` replica와 autoscaling 원인을 멈춘다.
- 그다음 `general-purpose` nodepool을 비운다.

---

## 3) 비용 홀드 전 확인

### 3-1. 현재 노드 확인
```bash
kubectl --context tutum-prd-eks get nodes -L karpenter.sh/nodepool,node.kubernetes.io/instance-type
```

### 3-2. 현재 prod 앱 상태 확인
```bash
kubectl --context tutum-prd-eks get deploy -n tutum-app
kubectl --context tutum-prd-eks get pods -n tutum-app -o wide
```

### 3-3. 일반 노드에 올라간 파드 확인
```bash
for node in $(kubectl --context tutum-prd-eks get nodes -l karpenter.sh/nodepool=general-purpose -o name | cut -d/ -f2); do
  echo "===== $node ====="
  kubectl --context tutum-prd-eks get pods -A --field-selector spec.nodeName=$node -o wide
done
```

---

## 4) 비용 홀드 실행 절차

### Step 1. ArgoCD 자동 복구 동작 확인/중지

prod app이 GitOps로 다시 살아나면 비용 절감이 유지되지 않는다.

우선 확인:
```bash
argocd app get tutum-production
```

권장 상태:
- `Sync Policy: Manual`

필요 시:
```bash
argocd app set tutum-production --sync-policy none
```

주의:
- 자동 sync나 self-heal이 켜져 있으면 scale down 후 다시 원복될 수 있다.

### Step 2. prod 앱 replica를 0으로 조정

```bash
kubectl --context tutum-prd-eks scale deploy backend --replicas=0 -n tutum-app
kubectl --context tutum-prd-eks scale deploy frontend --replicas=0 -n tutum-app
kubectl --context tutum-prd-eks scale deploy price-consumer --replicas=0 -n tutum-app
kubectl --context tutum-prd-eks scale deploy price-producer --replicas=0 -n tutum-app
kubectl --context tutum-prd-eks scale deploy news-consumer --replicas=0 -n tutum-app
kubectl --context tutum-prd-eks scale deploy news-producer --replicas=0 -n tutum-app
kubectl --context tutum-prd-eks scale deploy email-worker --replicas=0 -n tutum-app
kubectl --context tutum-prd-eks scale deploy elastic-consumer --replicas=0 -n tutum-app
kubectl --context tutum-prd-eks scale deploy ocr --replicas=0 -n tutum-app
```

이미 `cloudflared`가 0이면 그대로 둔다.

확인:
```bash
kubectl --context tutum-prd-eks get deploy -n tutum-app
kubectl --context tutum-prd-eks get pods -n tutum-app
```

### Step 3. autoscaling / pending 원인 제거 확인

파드가 남아 있으면 일반 노드가 다시 유지될 수 있다.

```bash
kubectl --context tutum-prd-eks get pods -A | grep Pending
kubectl --context tutum-prd-eks get hpa -A
kubectl --context tutum-prd-eks get scaledobject -A
```

만약 KEDA/HPA가 replica를 다시 올리면 해당 객체를 pause 또는 min 0 기준으로 조정해야 한다.

### Step 4. `general-purpose` nodepool 축소 또는 제거

앱 파드가 모두 사라진 뒤에 진행한다.

백업:
```bash
kubectl --context tutum-prd-eks get nodepool general-purpose -o yaml > /tmp/general-purpose-nodepool.yaml
```

삭제:
```bash
kubectl --context tutum-prd-eks delete nodepool general-purpose
kubectl --context tutum-prd-eks delete nodeclaims -l karpenter.sh/nodepool=general-purpose
```

확인:
```bash
kubectl --context tutum-prd-eks get nodepools,nodeclaims
kubectl --context tutum-prd-eks get nodes -L karpenter.sh/nodepool,node.kubernetes.io/instance-type
```

권장:
- `system` nodepool 2대는 유지
- `general-purpose`만 제거

### Step 5. 최종 비용 홀드 확인

```bash
kubectl --context tutum-prd-eks get nodes -o wide
kubectl --context tutum-prd-eks get pods -A
aws eks list-nodegroups --region ap-northeast-2 --cluster-name tutum-prd-eks --profile ruby
```

정상 기대값:
- managed nodegroup 없음
- `general-purpose` 노드 0
- `system` 최소 노드만 유지
- `tutum-app` workload 없음

---

## 5) 다시 켤 때(undo / restore) 절차

### Step 1. `general-purpose` nodepool 복구

삭제 전에 백업한 yaml이 있으면:
```bash
kubectl --context tutum-prd-eks apply -f /tmp/general-purpose-nodepool.yaml
```

GitOps로 관리 중이면 manifests/ArgoCD 기준으로 먼저 원복한다.

### Step 2. ArgoCD 대상 앱 상태 확인

```bash
argocd app get tutum-production
```

필요 시 prod 대상이 올바른지 재확인:
```bash
argocd app set tutum-production --dest-server https://2D522A207493F13377B8D32660928341.gr7.ap-northeast-2.eks.amazonaws.com
```

### Step 3. prod 배포 replica 복구

GitOps 기준이면 sync가 정답이다.

```bash
argocd app sync tutum-production
```

수동으로 되돌릴 경우:
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

### Step 4. autoscaling 복구

비용 홀드 중 pause했던 HPA/KEDA/Argo 옵션을 원복한다.

확인:
```bash
kubectl --context tutum-prd-eks get hpa -A
kubectl --context tutum-prd-eks get scaledobject -A
```

### Step 5. 복구 확인

```bash
kubectl --context tutum-prd-eks get pods -A
kubectl --context tutum-prd-eks get nodes -L karpenter.sh/nodepool,node.kubernetes.io/instance-type
argocd app get tutum-production
```

정상 기대값:
- `general-purpose` 노드가 필요한 만큼 다시 생성됨
- `tutum-app` 주요 파드 Running
- `tutum-production` app health / sync 상태 정상

---

## 6) 예상 비용 절감

현재 확인 기준:
- `general-purpose`: `c5a.large` 3대
- `system`: `c6g.large` 2대
- managed nodegroup: 0

대략 절감 대상:
- `general-purpose` 3대만 제거 시: 하루 약 `$7~9` 수준 절감 가능
- 이미 제거된 `m6i.large` 2대 managed nodegroup 기준: 하루 약 `$6` 전후 절감 반영됨

주의:
- 실제 청구는 NAT, EKS control plane, EBS, 트래픽 등 고정비가 추가된다.
- 따라서 노드를 다 줄여도 prod 비용이 완전 0이 되지는 않는다.

---

## 7) 현재 결론

- `ng-prd-general` 삭제는 완료된 상태
- 그러나 prod 앱이 `tutum-app`에 살아 있어서 `general-purpose` 노드 3대가 아직 비용을 발생시키는 상태
- 당분간 prod를 쓰지 않는다면 다음 실제 비용 절감 포인트는 `tutum-app` scale down + `general-purpose` nodepool 제거다
