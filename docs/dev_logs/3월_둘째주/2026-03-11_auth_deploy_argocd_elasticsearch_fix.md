# 2026-03-11 auth 배포 + ArgoCD 타임아웃 수정 + elasticsearch OOM 해결 + ArgoCD self-management 영구 반영

## 작업자
박성준

## 작업 배경
- auth 서비스 CORS 수정 커밋(`5b3ca9b`)의 빌드가 EKS private-only 노드 과부하로 실패
- 재시도 후 `679aba6f` 이미지 빌드·서명 성공했으나 `deploy:staging` 잡이 노드 불안정으로 실패
- ArgoCD가 kustomize build timeout으로 `a308139` 커밋을 반영하지 못하는 상태

## 발생한 문제 및 원인

### 1. ArgoCD kustomize build timeout (1m30s 초과)
- **증상**: `context deadline exceeded` — kustomize build가 90초 이내에 완료되지 못함
- **원인**: argocd-repo-server, argocd-redis, argocd-application-controller가 동일 4GB 노드(`i-0425cb76c9ad38956`)에 집중되어 메모리 89% 포화
- **해결**:
  - `ARGOCD_REPO_SERVER_TIMEOUT_SECONDS=300` 환경변수 추가 → repo-server가 새 노드로 이동
  - 직접 `kubectl apply -k`로 auth `679aba6f` 스테이징 반영 (kustomize v5.3.0 cp-2에 설치)

### 2. ArgoCD sync "context deadline exceeded" 반복
- **원인**: 동시에 3개 kustomize 빌드 프로세스가 실행되며 과부하
- **해결**: repo-server 타임아웃 증가(300s) + 노드 이동으로 단일 빌드 성공

### 3. elasticsearch OOM kill (exit code 137)
- **증상**: elasticsearch-0 pod가 3~5분마다 재시작 (OOM kill by node)
- **원인**:
  - 4GB c5a.large 노드에 elasticsearch(2Gi 한도) + backend(~800Mi) + kafka-1(~666Mi) 동시 배치
  - 노드 전체 메모리 100% 초과 → 노드 OOM killer가 elasticsearch 종료
- **해결 과정**:
  - `replicas-patch.yaml`의 elasticsearch memory request: `512Mi` → `2Gi` → `2750Mi`
  - limit: `2Gi` → `3Gi`
  - 2750Mi request는 4GB 노드 allocatable(~3.1Gi) + 데몬셋 오버헤드 초과
  - Karpenter가 8GB(`m5.large` 계열) 노드를 자동 프로비저닝 → elasticsearch 전용 배치

## 적용된 변경사항

### k8s-manifests/overlays/staging/replicas-patch.yaml
```yaml
# elasticsearch 섹션 변경
containers:
  - name: elasticsearch
    resources:
      requests:
        cpu: 200m
        memory: 2750Mi   # 512Mi → 2750Mi (8GB 노드 강제)
      limits:
        cpu: 2
        memory: 3Gi      # 2Gi → 3Gi
```

### 4. ArgoCD 전체 컴포넌트 private-only 고정 (영구 반영)
- **배경**: default nodeclass 노드는 NAT 없음 → 재시작 시 `quay.io`, `public.ecr.aws` ImagePullBackOff
- **해결**: 모든 ArgoCD 컴포넌트에 `nodeSelector: eks.amazonaws.com/nodeclass: private-only` 추가
- **영구화**: ArgoCD self-management Application(`argocd-config`) 생성
  - base: ArgoCD v3.3.2 upstream `install.yaml` + kustomize SMP 패치
  - `selfHeal: true` — 재배포 후 자동으로 재적용

## 적용된 변경사항

### k8s-manifests/overlays/staging/replicas-patch.yaml
```yaml
containers:
  - name: elasticsearch
    resources:
      requests:
        cpu: 200m
        memory: 2750Mi   # 512Mi → 2750Mi (8GB 노드 강제)
      limits:
        cpu: 2
        memory: 3Gi      # 2Gi → 3Gi
```

### k8s-manifests/apps/argocd/ (신규)
```
apps/argocd/
├── kustomization.yaml           # base: argoproj/argo-cd v3.3.2 install.yaml
├── node-selector-patch.yaml     # 전체 컴포넌트 private-only nodeSelector
└── repo-server-config-patch.yaml# timeout=300s, resource requests
```

### k8s-manifests/argocd/argocd-config-app.yaml (신규)
```yaml
# ArgoCD Application: path=k8s-manifests/apps/argocd
# selfHeal: true, prune: false, ApplyOutOfSyncOnly
```

## 결과

| 항목 | 변경 전 | 변경 후 |
|------|--------|--------|
| auth 이미지 | `latest` | `679aba6f` ✅ |
| ArgoCD kustomize | timeout 90s | timeout 300s ✅ |
| elasticsearch 노드 | 4GB (OOM) | 8GB (정상) ✅ |
| elastic-consumer | CrashLoopBackOff | 2/2 Running ✅ |
| ArgoCD sync | Unknown Error | Synced Healthy ✅ |
| ArgoCD nodeSelector | in-cluster 임시 패치 | git 영구 반영 ✅ |
| argocd-config App | 없음 | Synced Healthy ✅ |

## 커밋
- `f4624a5` — fix(staging): increase elasticsearch memory request to 2Gi to prevent OOM kills
- `accb1d4` — fix(staging): increase elasticsearch request/limit to 2750Mi/3Gi for 8GB node
- `6778399` — docs(dev_logs): record auth deploy, ArgoCD fix, elasticsearch OOM resolution
- `3e3c153` — feat(argocd): add self-management app to pin all components to private-only nodes
- `0bb4fc7` — fix(argocd): add required selector/labels fields for SSA validation
- `c85700c` — fix(argocd): fix kustomize patch namespace — remove explicit namespace from SMP

## 후속 과제
- 없음 (모두 완료)
