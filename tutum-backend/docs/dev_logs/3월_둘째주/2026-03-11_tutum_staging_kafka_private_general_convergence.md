# 개발 로그 작업 요약 (2026-03-11)

## 1. 작업 요약
- 작업 일시: 2026-03-11
- 작업자: 김경윤
- 브랜치: develop
- 작업 목적: staging Kafka StatefulSet을 `private-general` 노드풀에 안정적으로 고정하고, `kafka-0` 재기동 지연으로 발생하던 probe 기반 재시작을 해소해 `tutum.my` 경로 영향 없이 3-broker 구성을 다시 수렴시킨다.

## 2. 상세 변경 사항
- staging overlay에 Kafka 고정 설정을 추가했다.
  - `k8s-manifests/overlays/staging/private-general-nodepool-patch.yaml`
    - `StatefulSet/kafka`에 `eks.amazonaws.com/nodeclass=private-only`, `karpenter.sh/nodepool=private-general`를 추가했다.
    - pod template annotation으로 `karpenter.sh/do-not-disrupt: "true"`를 추가했다.
  - `k8s-manifests/overlays/staging/kafka-startup-probe-patch.yaml`
    - Kafka container에 `startupProbe`를 추가하고 `failureThreshold=120`으로 늘렸다.
  - `k8s-manifests/overlays/staging/kustomization.yaml`
    - 위 Kafka patch가 staging overlay에 포함되도록 등록했다.
- live cluster에서 Kafka StatefulSet을 안전하게 수렴시켰다.
  - 자동 롤링 중 healthy broker가 같이 재시작되지 않도록 일시적으로 `updateStrategy=OnDelete`로 전환했다.
  - `kafka-0`가 과밀한 `c5a.large` 노드 `i-011aa5b1c670f4835`에서 반복적으로 startup/liveness probe에 걸리던 상태를 확인했다.
  - 해당 노드를 cordon한 뒤 `kafka-0`를 같은 AZ의 여유 있는 `m5a.large` 노드 `i-02a59b614e9c3712d`로 재배치했다.
  - 이후 `kafka-2`, `kafka-1`을 순서대로 삭제해 새 revision으로 하나씩 수렴시켰다.
  - 최종적으로 StatefulSet strategy를 다시 `RollingUpdate`로 원복했다.
- 임시 운영 리소스를 정리했다.
  - `default/private-general-trigger-2c` trigger pod를 삭제했다.
  - 과밀 노드 `i-011aa5b1c670f4835`는 이후 클러스터에서 제거된 것을 확인했다.

## 3. 작업 중 발생 이슈 및 대응
- 이슈: `kafka-0`가 새 `private-general` 노드에서도 `1/2 Running` 상태로 머물며 약 10분 주기로 재시작됐다.
- 대응: pod `describe`와 이전 로그를 확인한 결과, Kafka controller와 broker listener가 거의 올라오기 직전에 startup probe timeout으로 프로세스가 종료되고 있었다. `startupProbe.failureThreshold=120`을 추가해 기동 여유를 늘렸다.
- 이슈: 현재 StatefulSet이 `RollingUpdate` 상태에서 template을 변경하면 `kafka-2 -> kafka-1 -> kafka-0` 순으로 healthy broker까지 자동 재시작될 위험이 있었다.
- 대응: 일시적으로 `OnDelete` 전략으로 전환한 뒤 broker를 하나씩 삭제하면서 readiness를 확인하는 방식으로 롤링을 통제했다.
- 이슈: `kafka-0`가 처음 배치된 `i-011aa5b1c670f4835` 노드는 `cpu request 95%`, `memory request 98%` 수준까지 올라가 있어 Kafka 복구 시간이 비정상적으로 길었다.
- 대응: 해당 노드를 cordon하고 `kafka-0`를 여유 있는 2a 노드로 재배치해 90초 내 `2/2 Ready`로 복구시켰다.

## 4. 결과
- 최종 검증 일시: 2026-03-12 00:32 KST
- 외부 경로 검증:
  - `https://tutum.my/` -> `200`
  - `https://tutum.my/api/v1/auth/me` -> `401`
  - `https://tutum.my/api/v1/market/prices/stocks?symbols=NVDA` -> `200`
  - `https://tutum.my/api/v1/chat/health` -> `200`
- Kafka StatefulSet 검증:
  - `kubectl get sts -n tutum-data kafka` -> `3/3`, `currentRevision=kafka-5f4488cd98`, `updateRevision=kafka-5f4488cd98`, `RollingUpdate`
  - `kafka-0` -> `2/2 Running`, node `i-02a59b614e9c3712d`
  - `kafka-1` -> `2/2 Running`, node `i-03c788d91dc2f8124`
  - `kafka-2` -> `2/2 Running`, node `i-07c5ca6e1f3072bcc`
  - `kafka-exporter` -> `2/2 Running`
- 정리 결과:
  - Kafka 3-broker가 모두 `private-general` 노드풀 기준으로 수렴했다.
  - staging overlay에도 동일 설정이 반영되어 Argo CD 재동기화 시 되돌림이 발생하지 않는 상태로 맞췄다.

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-11" --until="2026-03-11 23:59:59"
```

- 이번 작업과 직접 관련된 파일:
  - `k8s-manifests/overlays/staging/kustomization.yaml`
  - `k8s-manifests/overlays/staging/private-general-nodepool-patch.yaml`
  - `k8s-manifests/overlays/staging/kafka-startup-probe-patch.yaml`
  - `docs/dev_logs/3월_둘째주/2026-03-11_tutum_staging_kafka_private_general_convergence.md`

## 6. 후속 작업/리스크
- `private-general` 노드풀에 Kafka와 Elasticsearch가 함께 올라가므로, 이후에도 `m5a.large/c5a.large` 혼합 capacity가 과밀해지지 않는지 모니터링이 필요하다.
- 현재 live에서 과밀 노드 회피를 위해 cordon이 개입됐던 만큼, 동일한 패턴이 반복되면 Kafka 전용 노드풀 또는 더 큰 instance type 검토가 필요하다.
- 이번 작업은 UI 변경이 아니라 운영 수렴 작업이므로 별도 스크린샷은 첨부하지 않았다.
