# 개발 로그 작업 요약 (2026-03-12)

## 1. 작업 요약
- 작업 일시: 2026-03-12
- 작업자: 김정호
- 브랜치: develop
- 작업 목적: Phase D D-1 범위에서 MinIO 잔존 의존성을 S3 기준으로 정리하고, EKS base 배포에서 MinIO/etcd-backup 구성을 제거한다.

## 2. 상세 변경 사항
- `k8s-manifests/base/backup/mongodb-backup.yaml`
  - `minio/mc` 업로드 경로를 제거하고 `amazon/aws-cli:2.15.0` 기반 S3 업로드로 전환했다.
  - 백업 대상 MongoDB 연결은 고정 pod 주소 대신 `MONGODB_URL` secret 값을 사용하도록 변경했다.
  - 백업 산출물은 `s3://$S3_BUCKET_NAME/backups/mongodb/YYYY-MM-DD/` 경로로 저장되도록 정리했다.
- `k8s-manifests/base/data/elasticsearch.yaml`
  - Elasticsearch keystore initContainer가 `minio-secret` 대신 `s3-backup-secret`에서 AWS 자격증명을 읽도록 변경했다.
- `k8s-manifests/base/backup/elasticsearch-backup.yaml`
  - snapshot repository 이름을 `s3_backup`으로 정리했다.
  - MinIO endpoint 기반 설정을 제거하고 S3 bucket/region/base_path(`backups/elasticsearch`) 기준으로 snapshot을 생성하도록 변경했다.
- `k8s-manifests/base/security/eso/secret-store.yaml`
  - `tutum-data` 네임스페이스용 `SecretStore`와 `ExternalSecret(s3-backup-secret)`를 추가했다.
  - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET_NAME`, `MONGODB_URL`를 `tutum/backend-secret`에서 동기화하도록 구성했다.
- `k8s-manifests/base/kustomization.yaml`
  - `backup/elasticsearch-backup.yaml`을 base 배포에 포함했다.
  - `storage/minio-secret.yaml`, `storage/minio.yaml`, `backup/etcd-backup.yaml`을 base 배포에서 제거했다.
- `backend/app/routers/admin.py`
  - 관리자 백업 상태 집계 목록에서 `etcd-backup`을 제거해 EKS 환경과 운영 화면 기준을 맞췄다.
- `docs/plans/infra/AWS_MIGRATION_DETAIL_GUIDE.md`
  - 2026-03-12 기준 D-1 완료 상태와 MinIO/backup 경로 정리 내용을 반영했다.
- 삭제 파일
  - `k8s-manifests/base/backup/etcd-backup.yaml`
  - `k8s-manifests/base/storage/minio-secret.yaml`
  - `k8s-manifests/base/storage/minio.yaml`

## 3. 작업 중 발생 이슈 및 대응
- 이슈: 로컬 `develop`이 원격 `origin/develop`보다 5커밋 뒤처져 있었고 `backend/app/routers/admin.py`가 동일 파일 변경 범위에 포함되어 있었다.
- 대응: 작업 트리를 stash한 뒤 `git pull --ff-only origin develop`로 최신 `develop`을 반영하고, stash를 다시 적용해 변경을 재배치했다. 충돌은 발생하지 않았다.
- 이슈: 기존 `etcd-backup` CronJob은 `cp-1` control-plane hostPath와 kubeadm 인증서를 전제로 한 on-prem 전용 구성이라 EKS 관리형 control plane에 적합하지 않았다.
- 대응: `etcd-backup`은 S3 전환 대상이 아니라 EKS base 제거 대상으로 분류하고, 관련 운영 화면 집계도 함께 정리했다.
- 이슈: 기존 `mongodb-backup`은 `mongodb-0` 고정 주소와 `minio/mc` 업로드에 의존해 primary 변경과 외부 registry 의존에 취약했다.
- 대응: `MONGODB_URL` 기반 mongodump + ECR 미러링된 `amazon/aws-cli` 기반 S3 업로드로 변경했다.

## 4. 결과
- 검증 항목: `git pull --ff-only origin develop`
- 검증 결과: 원격 `develop` 5커밋을 fast-forward로 반영했고, stash 재적용 시 충돌은 발생하지 않았다.
- 검증 항목: `kubectl kustomize k8s-manifests/base`
- 검증 결과: kustomize 렌더링이 정상 완료되었고 수정한 base 매니페스트 조합에 문법 오류가 없음을 확인했다.
- 검증 항목: `rg -n "minio-secret|MINIO_ROOT_USER|MINIO_ROOT_PASSWORD|minio\\.tutum-storage|backup/etcd-backup|etcd-backup" k8s-manifests/base backend/app/routers/admin.py`
- 검증 결과: `k8s-manifests/base`와 관리자 백업 목록에서 MinIO secret/endpoint 및 `etcd-backup` 참조가 제거되었음을 확인했다.
- 검증 항목: `git diff --stat`
- 검증 결과: S3 전환 관련 파일 변경과 MinIO/etcd-backup 삭제만 포함되어 있음을 확인했다.
- 배포 상태: 이번 작업은 Git/manifest 기준 정리까지 수행했으며, 클러스터 apply/ArgoCD sync는 별도 실행하지 않았다.

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-12" --until="2026-03-12 23:59:59"
```

## 6. 후속 작업/리스크
- ArgoCD sync 이후 `s3-backup-secret` 생성 여부와 `mongodb-backup`, `elasticsearch-backup` CronJob 실행 결과를 실제 클러스터에서 확인해야 한다.
- Elasticsearch snapshot repository 등록은 runtime 검증이 아직 없으므로 첫 실행 시 `_snapshot/s3_backup` 응답과 snapshot 생성 결과를 확인해야 한다.
- `tutum-storage` namespace 자체는 base에 남아 있으므로, 네임스페이스 정리 여부는 후속 운영 범위에서 판단이 필요하다.
