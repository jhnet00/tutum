# 개발 로그 작업 요약 (2026-03-12)

## 1. 작업 요약
- 작업 일시: 2026-03-12
- 작업자: 김정호
- 브랜치: develop
- 작업 목적: staging EKS에서 `private-general` 하나에 앱과 Kafka/Elasticsearch가 함께 몰리며 메모리 압박이 반복되어, `private-app` / `private-data` 분리 구조와 메모리 request 상향을 반영해 비용 절감과 안정성을 함께 맞춘다.

## 2. 상세 변경 사항
- `k8s-manifests/overlays/staging/private-nodepools.yaml`
  - 기존 `private-general` NodePool을 제거하고 `private-app`, `private-data`, `private-system` 3개 구조로 재정의했다.
  - `private-app`은 `m` 계열, `generation > 6`, `large/xlarge`, `spot + on-demand fallback`으로 구성해 앱 워크로드를 메모리 중심으로 배치하도록 바꿨다.
  - `private-data`는 `m` 계열, `generation > 6`, `large/xlarge`, `on-demand only`, `consolidationPolicy: WhenEmpty`로 구성해 Kafka/Elasticsearch를 보다 안정적인 노드에 올리도록 바꿨다.
- `k8s-manifests/overlays/staging/workload-nodepool-patch.yaml`
  - `auth`, `backend`, `frontend`, `price-*`, `news-*`, `elastic-consumer`, `email-worker`, `ocr`를 `private-app`으로 고정했다.
  - `kafka`, `kafka-exporter`, `elasticsearch`, `elasticsearch-exporter`, `mongodb-backup`, `elasticsearch-backup`을 `private-data`로 고정했다.
  - `kafka`, `elasticsearch`에는 `karpenter.sh/do-not-disrupt: "true"`를 추가해 불필요한 재배치를 줄였다.
- `k8s-manifests/overlays/staging/resource-tuning-patch.yaml`
  - `auth` request/limit을 `512Mi/768Mi` 기준으로 상향했다.
  - `backend` request를 `768Mi`로 올려 Karpenter가 실제 메모리 수요에 맞춰 노드를 선택하게 했다.
  - `kafka` request를 `1536Mi`로 올려 4Gi 노드에 과밀 배치되는 문제를 줄이도록 조정했다.
- `k8s-manifests/overlays/staging/kustomization.yaml`
  - 신규 patch 파일을 kustomize 순서에 반영하고, 기존 `private-general-nodepool-patch.yaml` 대신 `workload-nodepool-patch.yaml`을 사용하도록 정리했다.

## 3. 작업 중 발생 이슈 및 대응
- 이슈: 기존 `private-nodepools.yaml`은 인코딩이 섞인 주석 때문에 부분 patch가 자주 어긋났다.
- 대응:
  - 파일을 통째로 재작성해 NodePool 정의를 ASCII 기준으로 정리했다.
- 이슈: `remove-nodeselector-patch.yaml`과 새 nodepool patch가 겹치는 구조라 patch 순서가 중요했다.
- 대응:
  - `kustomization.yaml`에서 `resource-tuning` -> `remove-nodeselector` -> `workload-nodepool` 순으로 명시해, 최종 nodeSelector가 의도대로 남도록 정리했다.
- 이슈: `private-general`을 바로 없애면 live에서 stateful/data 재배치 영향이 클 수 있었다.
- 대응:
  - `MongoDB`, `Redis`는 이번 변경에서 그대로 두고, 실제 병목이던 `Kafka/Elasticsearch`와 app 워크로드만 먼저 분리하는 방향으로 범위를 제한했다.

## 4. 결과
- 검증 항목: `rg -n "private-general" k8s-manifests/overlays/staging k8s-manifests/base`
- 검증 결과: staging/base 매니페스트 기준 `private-general` 참조가 남지 않았다.
- 검증 항목: `kubectl kustomize k8s-manifests/overlays/staging > $null`
- 검증 결과: staging overlay 렌더링이 정상 통과했다.
- 검증 항목: `kubectl kustomize k8s-manifests/overlays/staging | kubectl apply --dry-run=client -f -`
- 검증 결과: client-side apply 기준 스키마 오류 없이 통과했다.
- 검증 항목: `git diff --check`
- 검증 결과: 공백/patch 문법 오류 없이 통과했다.
- 검증 항목: `git rev-list --left-right --count HEAD...origin/develop`
- 검증 결과: 커밋/푸시 후 로컬 `develop`과 `origin/develop`이 일치하는지 확인한다.

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-12 00:00:00" --until="2026-03-12 23:59:59"
```

- 커밋 후 업데이트

## 6. 후속 작업/리스크
- push 후 ArgoCD가 `private-app`, `private-data` NodePool을 실제로 생성하고 기존 `private-general` 워크로드를 안전하게 이동시키는지 확인해야 한다.
- `MongoDB`, `Redis`는 이번 변경에서 이동하지 않았으므로, staging이 안정화되면 별도 `private-data` 이관 여부를 다시 판단해야 한다.
- `private-data`를 on-demand로 분리했기 때문에 compute 비용은 일부 증가할 수 있다. sync 후 실제 노드 수와 월 비용을 다시 산정해야 한다.
