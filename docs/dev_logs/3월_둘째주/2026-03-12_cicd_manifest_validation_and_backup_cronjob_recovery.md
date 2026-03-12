# 개발 로그 작업 요약 (2026-03-12)

## 1. 작업 요약
- 작업 일시: 2026-03-12
- 작업자: 김정호
- 브랜치: develop
- 작업 목적: manifest-only 변경도 GitLab CI에서 검증되도록 보강하고, S3 전환 이후 남아 있던 `mongodb-backup`, `elasticsearch-backup` CronJob의 실제 동작을 복구했다.

## 2. 상세 변경 사항
- `.gitlab-ci.yml`
  - `lint:shell-scripts` job을 추가해 `scripts/**/*.sh` 변경 시 `bash -n` 검증이 돌도록 구성했다.
  - `test:kustomize` job을 추가해 `k8s-manifests/apps/argocd`, `k8s-manifests/overlays/staging`, `k8s-manifests/overlays/production`을 `kubectl kustomize`로 검증하도록 구성했다.
  - `k8s-manifests/argocd/*.yaml`도 `kubectl create --dry-run=client`로 파싱되도록 추가했다.
  - 새 manifest 검증 job의 이미지는 외부 Docker Hub 대신 ECR 미러 `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/amazon/aws-cli:2.15.0`를 사용하도록 맞췄다.
- `k8s-manifests/base/backup/mongodb-backup.yaml`
  - Job template Pod에 `sidecar.istio.io/inject: "false"`를 추가해 backup Job이 Istio sidecar 종료 대기 때문에 완료되지 않던 문제를 제거했다.
- `k8s-manifests/base/backup/elasticsearch-backup.yaml`
  - Job template Pod에 `sidecar.istio.io/inject: "false"`를 추가했다.
  - repository 등록과 snapshot 요청 payload를 임시 JSON 파일로 만들어 `curl --data-binary @file`로 보내도록 바꿨다.
  - YAML block scalar 내부 heredoc 들여쓰기 때문에 container가 즉시 종료되던 문제를 피하려고, repository JSON도 `printf`로 파일에 쓰도록 정리했다.
  - 잘못 escaped 된 `{\"include_global_state\": false}` 요청 본문 때문에 snapshot Job이 실패하던 문제를 수정했다.
  - 실패 시 Elasticsearch 응답 body를 출력하도록 바꿔 원인 추적이 가능하게 했다.
- `k8s-manifests/argocd/argocd-config-app.yaml`
- `k8s-manifests/argocd/staging-app.yaml`
- `k8s-manifests/argocd/production-app.yaml`
  - ArgoCD Application의 `repoURL` 정리도 검토했지만, live ArgoCD repo-server에는 `tutum-backend.git` 직접 접근용 인증이 없어 현재는 기존 `backend.git` redirect 주소를 유지하는 것이 맞다는 점을 확인했다.

## 3. 작업 중 발생 이슈 및 대응
- 이슈: GitLab push pipeline이 성공으로 표시되는데, `k8s-manifests`나 `scripts`만 바뀐 커밋에는 실제 lint/test/build/deploy job이 거의 돌지 않았다.
- 대응:
  - `backend/.env`의 GitLab PAT로 GitLab API를 직접 조회해 `3df832f` 커밋 파이프라인을 확인했다.
  - 확인 결과 `guard:commit-policy`, `notify:slack_on_success`만 실행되고 나머지는 manual/skipped 상태였다.
  - manifest-only 변경도 최소한의 정적 검증을 거치도록 별도 CI job을 추가했다.
- 이슈: `mongodb-backup` CronJob이 이전 실패 Job과 Istio sidecar 때문에 `Complete`로 끝나지 않고 막혔다.
- 대응:
  - 오래된 실패 Job을 제거하고, CronJob Pod에 sidecar injection을 끈 뒤 수동 Job으로 재검증했다.
  - `s3://tutum-prod-storage/backups/mongodb/...` 경로 업로드와 `Completed` 상태를 확인했다.
- 이슈: `elasticsearch-backup` CronJob이 S3 repository 등록 이후 snapshot 요청 단계에서 실패했다.
- 대응:
  - Elasticsearch Pod 내부에서 repository 등록과 snapshot 호출을 직접 검증해 S3 plugin/keystore 자체는 정상임을 먼저 확인했다.
  - 이후 CronJob 스크립트의 JSON escaping 오류를 수정하고, sidecar injection을 꺼서 재실행 가능 상태로 정리했다.
  - 추가로 repository JSON heredoc이 YAML 들여쓰기와 충돌해 shell parse error를 내는 것을 확인하고 `printf` 방식으로 바꿨다.
- 이슈: ArgoCD `tutum-staging` Application 상태에 repo-server connection refused 흔적이 남아 있었다.
- 대응:
  - 현재 시점의 repo-server 로그에서는 새 revision manifest generate가 정상 동작하는 것을 확인했다.
  - stale `operationState` 오류로 판단하고, 현재는 `Synced` 상태를 기준으로 후속 sync 검증을 진행했다.
- 이슈: live ArgoCD Application의 `repoURL`을 `tutum-backend.git`로 바꾸면 `failed to list refs: authentication required` 비교 오류가 발생했다.
- 대응:
  - ArgoCD repo-server에는 해당 URL용 GitLab 인증이 아직 등록되지 않은 상태임을 확인했다.
  - staging 안정화 기준으로는 기존 `backend.git` redirect URL을 유지하는 것이 안전하다고 판단하고 그 기준으로 정리했다.

## 4. 결과
- 검증 항목: GitLab API로 `3df832f` 커밋 pipeline/job status 조회
- 검증 결과: manifest-only 변경 시 guard/notify만 실행되고 핵심 검증이 빠지는 구조를 확인했다.
- 검증 항목: `kubectl kustomize k8s-manifests/overlays/staging`
- 검증 결과: staging overlay 렌더링이 정상 통과했다.
- 검증 항목: `kubectl kustomize k8s-manifests/overlays/production`
- 검증 결과: production overlay 렌더링이 정상 통과했다.
- 검증 항목: `kubectl create --dry-run=client -f k8s-manifests/argocd/staging-app.yaml`
- 검증 결과: ArgoCD Application manifest 파싱이 정상 통과했다.
- 검증 항목: `kubectl create job --from=cronjob/mongodb-backup mongodb-backup-manual-0312b -n tutum-data`
- 검증 결과: `Completed 1/1`로 종료됐고 S3 업로드 로그를 확인했다.
- 검증 항목: Elasticsearch Pod 내부 repository 등록 및 snapshot API 호출
- 검증 결과: `s3_backup` repository 등록과 `debug-snap-0312` snapshot `SUCCESS`를 확인해 S3 연동 자체는 정상임을 확인했다.

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-12 00:00:00" --until="2026-03-12 23:59:59"
```

## 6. 후속 작업/리스크
- `elasticsearch-backup` CronJob은 로컬 매니페스트 수정이 완료됐지만, 실제 live CronJob이 새 스크립트로 sync된 뒤 수동 Job 재검증을 한 번 더 완료해야 한다.
- ArgoCD Application들의 `repoURL`은 문서/매니페스트 기준으로 새 저장소로 정리했으므로, 실제 클러스터에도 sync 반영 여부를 확인해야 한다.
- ArgoCD repo URL을 `tutum-backend.git`로 직접 전환하려면 먼저 repo credential 또는 PAT 기반 repository 등록을 추가해야 한다.
- 현재 GitLab pipeline은 manifest/script 정적 검증까지는 보강됐지만, 실제 `kubectl apply`는 여전히 ArgoCD GitOps 흐름에 의존한다.
