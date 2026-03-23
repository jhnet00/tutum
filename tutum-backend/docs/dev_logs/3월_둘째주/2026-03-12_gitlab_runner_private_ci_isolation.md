# 개발 로그 작업 요약 (2026-03-12)

## 1. 작업 요약
- 작업 일시: 2026-03-12
- 작업자: 김정호
- 브랜치: develop
- 작업 목적: GitLab Runner가 `private-data` 노드에 섞여 Kafka와 같은 상태성 워크로드의 CPU를 흔들지 않도록 staging에 전용 `private-ci` NodePool을 추가하고 runner controller/job pod를 모두 분리한다.

## 2. 상세 변경 사항
- `k8s-manifests/overlays/staging/private-nodepools.yaml`
  - `private-ci` NodePool을 추가했다.
  - `private-only` NodeClass를 사용하고, `m` 계열 `large/xlarge`, `spot + on-demand fallback`으로 CI 전용 capacity를 유도하도록 구성했다.
  - 기존 `private-app`, `private-data`, `private-system` 구조는 유지하고 runner만 별도 풀로 분리할 수 있게 했다.
- `k8s-manifests/base/runner/gitlab-runner-values.yaml`
  - runner controller `nodeSelector`에 `karpenter.sh/nodepool: private-ci`를 추가했다.
  - `runners.kubernetes.node_selector`에도 `karpenter.sh/nodepool: private-ci`를 추가해 CI job pod 역시 전용 CI 노드에만 뜨도록 정리했다.
  - 파일 전체를 ASCII 기준으로 다시 정리해 이후 Helm values 관리가 쉽게 되도록 했다.

## 3. 작업 중 발생 이슈 및 대응
- 이슈: `gitlab-runner-values.yaml` 기존 파일은 인코딩이 섞인 주석 때문에 부분 patch가 자주 어긋났다.
- 대응:
  - 값을 유지한 채 파일을 통째로 다시 작성하고, runner controller와 job pod selector를 함께 명시했다.
- 이슈: 이 머신에는 `helm`이 설치돼 있지 않아 values 파일 수정만으로는 live runner 배포가 즉시 바뀌지 않는다.
- 대응:
  - repo에는 Helm values를 반영하고, live에는 `ConfigMap`과 `Deployment`를 직접 패치해 동일한 selector를 적용하는 방식으로 처리했다.
- 이슈: 기존 runner는 `eks.amazonaws.com/nodeclass=private-only`만 사용하고 있어 app/data/runner가 모두 같은 private 노드에 섞일 수 있었다.
- 대응:
  - `private-ci` NodePool을 추가해 private subnet 조건은 유지하면서 runner만 별도 노드풀에 강제 배치되게 변경했다.

## 4. 결과
- 검증 항목: `kubectl kustomize k8s-manifests/overlays/staging`
- 검증 결과: staging overlay 렌더링이 정상 통과했다.
- 검증 항목: `git diff --check`
- 검증 결과: 공백/patch 문법 오류 없이 통과했다.
- 검증 항목: live `gitlab-runner` Deployment / ConfigMap node selector 확인
- 검증 결과: runner controller와 job pod template 모두 `karpenter.sh/nodepool=private-ci` 기준으로 반영한다.
- 검증 항목: live Karpenter NodePool 확인
- 검증 결과: `private-ci` NodePool이 실제로 생성됐고 `m8i-flex.large` spot 노드 1대가 올라와 runner controller가 `1/1 Running`으로 수렴했다.
- 검증 항목: GitLab pipeline 확인
- 검증 결과: `8fa630e` 커밋의 pipeline `2380338339`가 `success`로 완료됐고, `guard:commit-policy`, `test:kustomize`, `notify:slack_on_success`가 정상 처리됐다. `aws:*` job은 설계대로 `manual` 상태다.
- 검증 항목: `git rev-list --left-right --count HEAD...origin/develop`
- 검증 결과: push 후 로컬 `develop`과 `origin/develop`이 `0 0`으로 일치했다.

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-12 00:00:00" --until="2026-03-12 23:59:59"
```

- `8fa630e feat(ci): isolate gitlab runner on private ci nodes`

## 6. 후속 작업/리스크
- 이 변경은 GitLab Runner가 전용 CI 노드풀로 빠지도록 만드는 것이 목적이며, 장기적으로는 `helm upgrade gitlab-runner ... -f k8s-manifests/base/runner/gitlab-runner-values.yaml`로 관리 경로를 다시 맞추는 것이 바람직하다.
- `private-ci`가 `spot + on-demand fallback` 구조라서, spot 회수 시 CI job 재시도가 발생할 수 있다. 긴 빌드가 많아지면 on-demand 비중 조정이 필요할 수 있다.
- runner job의 CPU 피크가 크면 `private-ci` limits와 instance-size 범위를 다시 튜닝해야 한다.
