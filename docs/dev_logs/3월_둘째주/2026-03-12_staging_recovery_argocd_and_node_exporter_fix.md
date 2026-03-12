# 개발 로그 작업 요약 (2026-03-12)

## 1. 작업 요약
- 작업 일시: 2026-03-12
- 작업자: 김정호
- 브랜치: develop
- 작업 목적: staging EKS에서 발생한 ArgoCD sync 불일치, backend rollout 실패, public registry 이미지 pull 실패를 정리하고 API/모니터링 경로를 다시 정상 상태로 복구한다.

## 2. 상세 변경 사항
- `k8s-manifests/argocd/argocd-config-app.yaml`
- `k8s-manifests/argocd/staging-app.yaml`
- `k8s-manifests/argocd/production-app.yaml`
  - ArgoCD repo-server가 `tutum-backend.git` 직접 URL로는 인증 없이 manifest compare를 수행하지 못해 `authentication required` 비교 오류가 발생했다.
  - live 운영 안정화를 우선해 기존 `backend.git` redirect URL을 유지하는 방향으로 되돌리고, 이후 repo credential을 별도로 등록해야 하는 상태임을 확인했다.
- live cluster 정리
  - stale revision을 물고 있던 `redis-2`, `kafka-2`, `mongodb-2`, `elasticsearch-0`를 재생성해 ECR 기준 최신 템플릿으로 교체했다.
  - 실수로 생성되었던 `tutum-production` orphan 리소스(`kibana`, `minio` 관련 잔여 리소스)를 정리했다.
  - `i-0195bd5c1f0653d50`는 `uncordon`해 여유 노드로 복귀시켰고, `i-06c54cac17f0de98c`는 메모리 과밀로 인해 `SchedulingDisabled` 상태를 유지했다.
- `k8s-manifests/base/backend/deployment.yaml`
- `k8s-manifests/overlays/staging/replicas-patch.yaml`
  - backend startup patch가 `admin.py`에 helper block을 주입할 때 문자열 `\\n\\n`를 그대로 삽입해 `SyntaxError`를 일으키는 문제를 수정했다.
  - 이 수정으로 `backend` 새 ReplicaSet이 더 이상 `/health 500`과 import 실패로 멈추지 않고 정상 기동되도록 복구했다.
- `k8s-manifests/base/monitoring/node-exporter.yaml`
- `k8s-manifests/step3-lgtm/node-exporter/node-exporter.yaml`
  - `prom/node-exporter:v1.8.2` Docker Hub pull timeout으로 인해 ArgoCD health가 계속 닫히지 않아, 먼저 `quay.io`로 바꿨다가 동일한 외부 레지스트리 timeout을 확인했다.
  - 이후 `quay.io/prometheus/node-exporter:v1.8.2`를 로컬 Docker에서 pull한 뒤 `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/prometheus/node-exporter:v1.8.2`로 ECR 미러링했다.
  - ECR 이미지가 `arm64` 노드(`c8g.large`)에서 `exec format error`를 일으켜, staging 운영 안정화 기준으로 `node-exporter`를 `kubernetes.io/arch=amd64` 노드에만 배포하도록 제한했다.

## 3. 작업 중 발생 이슈 및 대응
- 이슈: ArgoCD `tutum-staging`이 `ComparisonError`와 `SharedResourceWarning`을 번갈아 내며 sync/health가 불안정했다.
- 대응:
  - repo-server 로그와 Application 상태를 확인해 `tutum-backend.git` 직접 접근 인증 부재를 원인으로 확정했다.
  - live Application은 `backend.git` redirect URL로 되돌렸고, 잘못 생성된 `tutum-production` Application과 orphan 리소스를 제거했다.
- 이슈: data 파드 일부가 public registry 이미지를 끌어오다 `ImagePullBackOff`에 빠졌고, 이 때문에 staging health가 계속 흔들렸다.
- 대응:
  - stale StatefulSet pod를 삭제해 최신 ECR 템플릿으로 재생성시켰다.
  - backup/ES/data 리소스가 모두 다시 `Running` 상태로 수렴하는지 확인했다.
- 이슈: backend 새 rollout이 `/app/app/routers/admin.py` 패치 과정에서 `SyntaxError: unexpected character after line continuation character`로 실패했다.
- 대응:
  - `source.replace(anchor, anchor + "\n\n" + helper_block + "\n")` 형태로 개행 삽입 문자열을 바로잡고 `develop`에 반영했다.
  - live에는 `kubectl apply -k k8s-manifests/overlays/staging`로 즉시 덮어써 broken ReplicaSet을 정상 템플릿으로 교체했다.
- 이슈: `node-exporter`가 Docker Hub와 Quay 양쪽 모두에서 timeout 또는 `exec format error`로 실패했다.
- 대응:
  - ECR mirror 저장소 `prometheus/node-exporter`를 생성하고 이미지를 직접 push했다.
  - arm64 지원 멀티아키 이미지가 준비되기 전까지는 `amd64` 노드에만 DaemonSet이 배포되도록 제한했다.

## 4. 결과
- 검증 항목: `kubectl get application -n argocd`
- 검증 결과: `argocd-config`, `tutum-staging` 모두 `Synced / Healthy` 상태로 복구됐다.
- 검증 항목: `kubectl get deploy -n tutum-app`
- 검증 결과: `auth 2/2`, `backend 3/3`, `frontend 2/2`, `ocr 1/1`, `price-consumer 2/2` 등 핵심 앱 리소스가 정상 상태다.
- 검증 항목: `kubectl get daemonset node-exporter -n monitoring -o wide`
- 검증 결과: `node-exporter`가 `kubernetes.io/arch=amd64` 조건에서 `19/19 Ready`로 수렴했다.
- 검증 항목: `curl https://tutum.my/api/v1/market/prices/stocks?symbols=AAPL`
- 검증 결과: `200` 응답을 반환해 ALB 경유 backend API가 정상 동작함을 확인했다.
- 검증 항목: GitLab pipeline `2380180623`
- 검증 결과: `90861bb` 커밋 기준 pipeline이 `success` 상태이며 manifest 검증이 통과했다.
- 검증 항목: `git rev-list --left-right --count HEAD...origin/develop`
- 검증 결과: `0  0`으로 로컬 `develop`과 원격 `origin/develop`이 일치한다.

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-12 00:00:00" --until="2026-03-12 23:59:59"
```

- `9e30f45` `fix(argocd): keep legacy repo url for repo access`
- `8f4ec16` `fix(staging): restore backend admin patch newlines`
- `dde38bc` `fix(monitoring): mirror node-exporter to ecr`
- `90861bb` `fix(monitoring): limit node-exporter to amd64 nodes`

## 6. 후속 작업/리스크
- `i-06c54cac17f0de98c`는 현재도 메모리 사용률이 allocatable 기준 `100%+` 수준이라 `SchedulingDisabled`를 유지하고 있다. StatefulSet을 안전하게 재배치하거나 노드 자체를 교체하는 후속 판단이 필요하다.
- `node-exporter`는 현재 `amd64` 노드만 대상으로 제한되어 있다. `arm64` 노드까지 포함하려면 multi-arch 이미지를 ECR에 다시 미러링해야 한다.
- ArgoCD repo URL을 `tutum-backend.git` 직접 주소로 정리하려면 repo credential 또는 PAT 기반 repository 등록을 먼저 완료해야 한다.
