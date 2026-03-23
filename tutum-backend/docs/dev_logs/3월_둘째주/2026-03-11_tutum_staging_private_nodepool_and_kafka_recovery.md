# Tutum Staging Private NodePool 및 Kafka 복구 작업 요약 (2026-03-11)

## 1. 작업 요약
- 작업 일시: 2026-03-11
- 작업자: 김경윤
- 브랜치: develop
- 작업 목적: `tutum.my`의 반복 `504 Gateway Time-out` 재발 원인을 제거하고, `frontend/backend/auth` 및 Kafka 기반 워커가 private subnet 기반으로 다시 동작하도록 스케줄 경로와 운영 리소스를 정리한다.

## 2. 상세 변경 사항
- `tutum.my` 재발 장애 원인을 재확인했다.
  - `aws-load-balancer-controller`가 ELB API와 통신하지 못하던 기존 문제는 private node로 이동하면서 해소되었으나,
  - staging overlay가 `nodeSelector`를 제거하고 있어 `frontend/backend/auth/worker`가 다시 `default` NodeClass 노드로 스케줄되고 있었다.
  - `EKS Auto Mode`는 `general-purpose/system` NodePool의 `nodeClassRef`를 다시 `default`로 되돌리고 있어, 단순 live patch만으로는 재발을 막을 수 없는 상태였다.
- staging overlay를 수정했다.
  - [remove-nodeselector-patch.yaml](C:\Users\CloudDX\Documents\GitHub\clouddx-project\k8s-manifests\overlays\staging\remove-nodeselector-patch.yaml)
  - 기존 `nodeSelector: null` 제거 패치를 중단하고, 아래 workload를 `eks.amazonaws.com/nodeclass: private-only`로 고정했다.
    - `backend`
    - `frontend`
    - `auth`
    - `price-producer`
    - `price-consumer`
    - `news-producer`
    - `news-consumer`
    - `elastic-consumer`
    - `email-worker`
    - `ocr`
    - `elasticsearch`
    - `kafka`
- private 전용 capacity를 보장하기 위해 custom NodePool 2개를 추가했다.
  - [private-nodepools.yaml](C:\Users\CloudDX\Documents\GitHub\clouddx-project\k8s-manifests\overlays\staging\private-nodepools.yaml)
  - `private-general`
    - `nodeClassRef.name=private-only`
    - app workload 전용
  - `private-system`
    - `nodeClassRef.name=private-only`
    - `CriticalAddonsOnly:NoSchedule` taint 유지
    - system controller 전용
- staging kustomization에 custom NodePool 리소스를 포함시켰다.
  - [kustomization.yaml](C:\Users\CloudDX\Documents\GitHub\clouddx-project\k8s-manifests\overlays\staging\kustomization.yaml)
- live cluster에 `kubectl apply -k k8s-manifests/overlays/staging`를 적용했다.
- `aws-load-balancer-controller`를 `private-system`으로 이동시켰다.
  - deployment `nodeSelector`를 `karpenter.sh/nodepool=private-system`, `kubernetes.io/arch=amd64`로 변경
  - 롤아웃 후 `private-system` 노드에서 `2/2 Running` 확인
- app deployment를 재시작해 private-only 노드로 재스케줄되도록 정리했다.
  - `backend`
  - `frontend`
  - `auth`
  - `price-consumer`
  - `price-producer`
  - `news-producer`
  - `news-consumer`
  - `email-worker`
  - `ocr`
- old public-route backend pod를 삭제해 `backend-svc`가 다시 public subnet pod를 가리키지 않도록 정리했다.
- Kafka statefulset 롤링 중 `kafka-2`가 이전 revision에 묶여 `busybox:1.35`를 Docker Hub에서 직접 pull하려다 실패하던 문제를 확인했다.
  - old pod 강제 삭제 후 새 revision으로 재생성
  - 새 pod는 ECR mirror 이미지 `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/busybox:1.35`를 사용
- Kafka가 다시 bootstrap되면서 아래 워커가 `Running 2/2`로 복구되는 것을 확인했다.
  - `price-consumer`
  - `news-producer`
  - `elastic-consumer`

## 3. 작업 중 발생 이슈 및 대응
- 이슈: `NodePool`을 live patch로 `private-only`로 바꿔도 EKS Auto Mode가 다시 `default`로 되돌렸다.
- 대응: `NodePool` patch에 의존하지 않고, workload 자체를 `eks.amazonaws.com/nodeclass=private-only`로 고정하고 custom `private-general/private-system` NodePool을 추가했다.
- 이슈: private-only selector를 붙인 직후 pending pod가 다수 발생했다.
- 대응: `private-general` NodePool을 생성해 private-only capacity를 직접 유도했다. 실제로 `nodeclaim/private-general-*`가 생성되고 app pod가 해당 노드로 스케줄되는 것을 확인했다.
- 이슈: `aws-load-balancer-controller`가 기존에는 public-route node 또는 arm64 경로에서 불안정했다.
- 대응: `private-system` + `amd64`로 이동 후 target group reconcile 로그가 정상적으로 찍히는 것을 확인했다.
- 이슈: `kafka-2`가 old revision 상태에서 `busybox:1.35`를 Docker Hub에서 pull하려다 `ImagePullBackOff`가 발생했다.
- 대응: old `kafka-2` pod를 강제 삭제해 새 revision으로 재생성했고, 새 pod는 mirror 이미지로 init container를 시작하도록 전환했다.
- 이슈: rollout 중간에 `root=504`, `auth_me=504`가 순간적으로 재발했다.
- 대응: ALB target group, service endpoint, rollout 상태를 반복 점검했고, 최종적으로 `frontend` target group이 private frontend pod를 자동 반영하는 것까지 확인했다.

## 4. 결과
- 최종 검증 일시: 2026-03-11
- 외부 응답 검증:
  - `https://tutum.my/` -> `200`
  - `https://tutum.my/api/v1/market/prices/stocks?symbols=NVDA` -> `200`
  - `https://tutum.my/api/v1/chat/health` -> `200`
  - `https://tutum.my/api/v1/auth/me` -> `504`
- 서비스 endpoint 검증:
  - `frontend-svc` -> `10.60.11.50:3000`, `10.60.11.62:3000`
  - `backend-svc` -> private endpoint 4개 연결
  - `kafka` -> `10.60.11.224:9092`, `10.60.11.242:9092`
- NodePool 상태:
  - `general-purpose` -> `default`, 9 nodes
  - `private-general` -> `private-only`, 1 node
  - `private-system` -> `private-only`, 1 node
  - `system` -> `default`, 2 nodes
- controller 상태:
  - `aws-load-balancer-controller` -> `2/2 Running`
  - private-system node `i-051011711f75f63bb`에서 실행 확인
- app/workers 상태:
  - `frontend` -> `2/2 Running`
  - `auth` -> `2/2 Running`
  - `backend` -> `4/5 Available`
  - `price-consumer` -> `1/1 Available`
  - `news-producer` -> `1/1 Available`
  - `elastic-consumer` -> `1/1 Available`
- Kafka 상태:
  - `kafka-0` -> `2/2 Running`
  - `kafka-1` -> `2/2 Running`
  - `kafka-2` -> `1/2 Running`
  - `kafka-exporter` -> `CrashLoopBackOff`
- 결론:
  - 사용자 체감 경로인 `root`, `market`, `chat`은 복구됨
  - 재발 원인이던 public-route 스케줄 경로는 overlay와 custom NodePool로 우회 완료
  - 다만 `auth /me`, `backend` 일부 파드, `kafka-2`, `kafka-exporter`는 추가 수렴 작업이 남아 있음

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-11" --until="2026-03-11 23:59:59"
```

- 이번 작업과 직접 관련된 주요 파일:
  - `k8s-manifests/overlays/staging/kustomization.yaml`
  - `k8s-manifests/overlays/staging/remove-nodeselector-patch.yaml`
  - `k8s-manifests/overlays/staging/private-nodepools.yaml`
  - `docs/dev_logs/3월_둘째주/2026-03-11_tutum_staging_private_nodepool_and_kafka_recovery.md`

## 6. 후속 작업/리스크
- `auth /api/v1/auth/me`가 최종 검증 시점에 `504`를 반환했다. auth target group과 auth rollout 상태를 별도로 다시 확인해야 한다.
- `backend` deployment가 `4/5 Available` 상태다. `CrashLoopBackOff` 중인 backend pod 1개 원인 분석이 필요하다.
- `kafka-2`는 아직 `1/2 Running`이며 `kafka` service endpoint에도 아직 포함되지 않았다. Kafka 3-broker 수렴이 끝나야 exporter와 consumer lag 지표도 안정화된다.
- `kafka-exporter`는 Kafka broker 수렴 전까지 계속 재시도할 가능성이 높다.
- 현재 custom `private-general/private-system` NodePool은 live cluster와 overlay 모두에 반영했지만, 이후 운영 정책 변경 시 EKS Auto Mode 기본 NodePool과 충돌하지 않도록 별도 문서화와 commit/push가 필요하다.
