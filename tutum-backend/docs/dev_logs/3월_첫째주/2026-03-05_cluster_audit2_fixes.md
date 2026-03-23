# K8s 클러스터 2차 점검 및 수정

**날짜**: 2026-03-05
**작업자**: 박성준
**브랜치**: develop

---

## 점검 계기

1차 점검 이후 팀원이 새 이미지(`2df8d9da`) 빌드/push 했고,
CI 서명 파이프라인이 아직 완전 자동화되지 않아 미서명 이미지가 발생.
전체 pod/PVC/ArgoCD 상태 재점검 실시.

---

## 발견된 이슈 및 조치

### 1. tutum-staging OutOfSync — 미서명 이미지 `2df8d9da` 로 Kyverno Enforce 차단

**증상**
```
ArgoCD: tutum-staging OutOfSync
Error: admission webhook "mutate.kyverno.svc-fail" denied the request:
  verify-image-signature: no signatures found
  → backend:2df8d9da, backend/frontend:2df8d9da, backend/workers:2df8d9da
```

**원인**: 팀원이 새 이미지를 빌드했으나 CI 서명 잡이 실행되지 않음 (sign:* 잡 조건 미충족 또는 tag 누락)

**조치**
```bash
# cp-1에서 직접 서명
export DOCKER_CONFIG=/tmp/cosign-docker
COSIGN_PASSWORD=tutum123 cosign sign --key /tmp/cosign.key \
  registry.gitlab.com/tutum-project/tutum-app/backend:2df8d9da --yes
  # tlog index: 1035009758

COSIGN_PASSWORD=tutum123 cosign sign --key /tmp/cosign.key \
  registry.gitlab.com/tutum-project/tutum-app/backend/frontend:2df8d9da --yes
  # tlog index: 1035011690

COSIGN_PASSWORD=tutum123 cosign sign --key /tmp/cosign.key \
  registry.gitlab.com/tutum-project/tutum-app/backend/workers:2df8d9da --yes
  # tlog index: 1035012643

# Kyverno 캐시 클리어 (이전 실패 결과 캐시 제거)
kubectl rollout restart deployment/kyverno-admission-controller -n kyverno

# ArgoCD sync 강제 실행
kubectl patch application tutum-staging -n argocd --type merge \
  -p '{"operation":{"initiatedBy":{"username":"admin"},"sync":{"revision":"HEAD"}}}'
```

**결과**: tutum-staging → **Synced / Healthy** ✅

---

### 2. mongodb-backup CronJob — CreateContainerConfigError

**증상**
```
pod/mongodb-backup-29544060-t2dkn   CreateContainerConfigError
이유: secret "minio-secret" not found (in tutum-data namespace)
```

**원인**: `minio-secret`이 `tutum-storage` 네임스페이스에만 존재.
mongodb-backup CronJob은 `tutum-data`에 있어 cross-namespace secret 참조 불가.

**조치**
```bash
# tutum-storage → tutum-data 시크릿 복제
kubectl get secret minio-secret -n tutum-storage -o json \
  | python3 -c "import json,sys; s=json.load(sys.stdin); \
    s['metadata']={'name':'minio-secret','namespace':'tutum-data'}; \
    print(json.dumps(s))" \
  | kubectl apply -f -

# 기존 실패 CronJob 잡 정리 후 재생성
kubectl delete cronjob mongodb-backup -n tutum-data
kubectl apply -f k8s-manifests/base/backup/mongodb-backup.yaml
```

**결과**: CronJob 정상 등록, 다음 실행(02:00 KST)에서 정상 동작 예상 ✅

> **참고**: etcd-backup은 `kube-system`에 별도 `minio-backup-secret` 생성해서 문제 없음.
> mongodb-backup만 이 처리가 누락되어 있었음.

---

### 3. ArgoCD ignoreDifferences 미반영

**증상**: backend, price-consumer가 KEDA 스케일 차이로 OutOfSync 표시

**원인**: `k8s-manifests/argocd/staging-app.yaml`에 `ignoreDifferences` 추가했으나
파일만 커밋됐고 클러스터에 `kubectl apply` 안 됨.

**조치**
```bash
kubectl apply -f k8s-manifests/argocd/staging-app.yaml
```

**결과**: `spec.ignoreDifferences` 반영 → KEDA replica drift OutOfSync 해소 ✅

---

### 4. 잔존 Evicted pods 정리

```bash
kubectl delete pods -n tutum-app --field-selector=status.phase=Failed
kubectl delete pod elasticsearch-exporter-6576db6778-dqz9l -n tutum-data
```

정리된 pod: backend×4 (Evicted), elasticsearch-exporter (ContainerStatusUnknown) ✅

---

## 현황 (수정 불필요)

| 항목 | 상태 | 비고 |
|------|------|------|
| worker1 메모리 85% | 🟡 모니터링 | SonarQube+ArgoCD+KEDA+Istio 집중, 정상 범위 |
| tutum-app pod → worker2 집중 | 🟡 | worker1 포화로 스케줄러가 선택, K8s가 장애 시 재스케줄 |
| tutum-production Unknown | 🟡 | main 브랜치 이슈 (`docs/issues/argocd_production_branch_mismatch.md`) |

---

## 최종 클러스터 상태

```
노드:             6/6 Ready (cp×3, worker×3)
tutum-staging:    Synced / Healthy ✅
tutum-production: Unknown / Healthy
비정상 Pod:       0개
PVC:              15/15 Bound
KEDA:             5/5 ScaledObject Ready
MinIO:            4/4 Running (분산 HA)
cert-manager:     2 ClusterIssuer Ready
```

---

## 향후 과제

- [ ] CI 서명 파이프라인 자동화 확인: 새 이미지 빌드 시 `sign:*` 잡 자동 실행 검증
- [ ] `minio-secret` tutum-data 복제를 매니페스트로 관리 (SealedSecret 또는 External Secrets 검토)
- [ ] tutum-production main 브랜치 이슈 팀 논의 후 결정
