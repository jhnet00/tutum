# TUTUM 현재 백업 전략 요약

- 작성일: `2026-03-19`
- 기준 환경: `AWS staging / EKS`
- 목적: 현재 프로젝트의 실제 운영 기준 백업 전략을 한 문서로 정리

---

## 1. 한눈에 보는 현재 백업 전략

TUTUM의 현재 백업 전략은 크게 아래 3축으로 구성된다.

1. `MongoDB`는 `mongodump -> S3` CronJob 자동 백업
2. `Elasticsearch`는 `Snapshot API -> S3` CronJob 자동 백업
3. `MariaDB`는 `AWS RDS automated backup` 사용

즉, 현재 AWS/EKS 기준의 핵심 백업 경로는 `S3 + RDS 관리형 백업`이며, 예전 온프레미스 시절의 `MinIO + etcd-backup` 전략은 더 이상 현재 기준 운영 주전략이 아니다.

---

## 2. 백업 대상별 전략

### 2-1. MongoDB

- 방식: `CronJob` 기반 자동 백업
- 스케줄: 매일 `02:00 KST`
- 매니페스트: [mongodb-backup.yaml](C:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/k8s-manifests/base/backup/mongodb-backup.yaml)
- 동작 방식:
  - `mongodump` 실행
  - 날짜별 디렉터리 생성
  - 결과를 `s3://tutum-prod-storage/backups/mongodb/YYYY-MM-DD/` 경로로 업로드
- 특징:
  - `MONGODB_URL` 기반으로 백업 대상 연결
  - 고정 Pod 주소가 아니라 연결 문자열 기준이라 primary 변경에 더 유연함

### 2-2. Elasticsearch

- 방식: `CronJob` 기반 자동 백업
- 스케줄: 매일 `03:00 KST`
- 매니페스트: [elasticsearch-backup.yaml](C:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/k8s-manifests/base/backup/elasticsearch-backup.yaml)
- 동작 방식:
  - Elasticsearch `Snapshot API` 호출
  - S3 repository `s3_backup` 사용
  - 백업 경로는 `backups/elasticsearch`
- 특징:
  - 잡 내부에서 snapshot 성공 여부를 확인
  - `14일`보다 오래된 snapshot은 정리하도록 구성
  - Istio mesh 환경을 고려한 sidecar/probe 대응이 반영됨

### 2-3. MariaDB

- 방식: `AWS RDS automated backup`
- 대상: `tutum-mariadb`
- 현재 확인값:
  - `Multi-AZ = True`
  - `BackupRetentionPeriod = 7`
- 특징:
  - Kubernetes CronJob으로 별도 `mysqldump`를 돌리는 구조가 아니라, AWS RDS 관리형 백업을 사용
  - 관계형 데이터는 앱 레벨보다 RDS 운영 기능에 더 기대는 구조

### 2-4. Object Storage

- 대상: OCR 이미지, 프로필 이미지 등 운영 파일
- 저장소: `S3 tutum-prod-storage`
- 코드 기준: [storage.py](C:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/backend/app/services/storage.py)
- 특징:
  - 이 영역은 전통적인 의미의 DB 백업보다는 `원본 운영 저장소`에 가깝다
  - 다만 S3 Lifecycle을 통해 장기 보관/만료 정책이 적용된다

---

## 3. 보관 위치와 수명주기

현재 백업 및 저장 경로는 `tutum-prod-storage` 버킷 기준으로 정리된다.

### 3-1. 백업 경로

- MongoDB: `s3://tutum-prod-storage/backups/mongodb/`
- Elasticsearch: `s3://tutum-prod-storage/backups/elasticsearch/`

### 3-2. Lifecycle 정책

실제 S3 버킷에는 아래 Lifecycle 정책이 적용되어 있다.

- `backups/`
  - `30일 후 Glacier 전환`
  - `365일 후 만료`
- `ocr-images/`
  - `180일 후 만료`

즉, 백업은 단순 저장만 하는 것이 아니라 `S3 -> Glacier` 장기 보관 흐름까지 고려된 구조다.

---

## 4. 시크릿과 자격증명 관리

백업 CronJob이 사용하는 자격증명은 `tutum-data` 네임스페이스의 `s3-backup-secret`으로 관리된다.

- 매니페스트: [secret-store.yaml](C:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/k8s-manifests/base/security/eso/secret-store.yaml)
- 구성 방식:
  - `AWS Secrets Manager` 값을 `External Secrets`가 동기화
  - 동기화 항목:
    - `AWS_ACCESS_KEY_ID`
    - `AWS_SECRET_ACCESS_KEY`
    - `AWS_REGION`
    - `S3_BUCKET_NAME`
    - `MONGODB_URL`

즉, 백업 자격증명을 매니페스트에 직접 하드코딩하지 않고, Secrets Manager -> External Secret -> K8s Secret 흐름으로 관리한다.

---

## 5. 운영 모니터링 방식

백업은 단순히 돌리는 것에서 끝나지 않고, `/admin`과 Grafana 알림 규칙으로 상태를 추적한다.

### 5-1. Admin 백업 상태 집계

- 구현 파일: [admin.py](C:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/backend/app/routers/admin.py)
- 집계 대상:
  - `mongodb-backup`
  - `elasticsearch-backup`
- 표시 상태:
  - `OK`
  - `ERROR`
  - `RUNNING`
  - `NO_RUN`
  - `UNKNOWN`

즉, 운영자는 `/admin`의 Backup Summary에서 최근 백업 결과를 바로 확인할 수 있다.

### 5-2. Grafana Alerting

- 규칙 파일: [alert-rules.yml](C:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/k8s-manifests/step3-lgtm/monitoring-vm/grafana/provisioning/alerting/alert-rules.yml)
- 주요 규칙:
  - `BackupCronJobFailed`
  - `BackupMissed3Days`

따라서 백업 실패나 장기간 미실행은 운영 알림 관점에서도 감지 가능하다.

---

## 6. 2026-03-19 기준 실제 확인 결과

실제 현재 기준으로 아래 항목을 확인했다.

### 6-1. CronJob 상태

- `mongodb-backup` 존재
- `elasticsearch-backup` 존재

### 6-2. 최근 Job 상태

- MongoDB backup 최근 실행 중 `Complete` 확인
- Elasticsearch backup 최근 실행 중 `Complete` 확인

즉, 현재 백업은 매니페스트만 있는 상태가 아니라 최근 실행 성공 이력이 있는 상태다.

### 6-3. RDS 상태

- `tutum-mariadb` 상태: `available`
- `MultiAZ: True`
- `Retention: 7`

### 6-4. S3 백업 경로 존재

- `s3://tutum-prod-storage/backups/mongodb/`
- `s3://tutum-prod-storage/backups/elasticsearch/`

실제 백업 산출물이 S3에 존재하는 것도 확인했다.

---

## 7. 현재 제외되거나 변경된 전략

아래 항목은 예전 설계나 온프레미스 시절 흔적은 있지만, 현재 AWS/EKS 기준 주전략은 아니다.

### 7-1. MinIO 기반 백업

- 예전에는 `MinIO`가 백업 저장소 역할을 했지만,
- 현재는 `S3`로 전환되었고,
- MongoDB / Elasticsearch 백업 경로도 모두 S3 기준으로 정리되었다.

### 7-2. etcd-backup

- 온프레미스 kubeadm 클러스터 시절에는 `etcd-backup` CronJob이 있었다.
- 하지만 현재는 `EKS managed control plane` 환경이라 base 배포에서 제거되었다.
- `/admin` 백업 집계 목록에서도 제외되었다.

즉, 현재 AWS 기준에서는 `etcd-backup`을 프로젝트 핵심 백업 전략으로 설명하면 안 된다.

---

## 8. 복구 관점 해석

현재 전략은 `백업 자동화`는 갖추고 있지만, `복구 자동화`까지 완전히 갖춘 형태는 아니다.

### 8-1. 복구 성격

- MongoDB: 백업은 자동, 실제 restore는 수동 절차 중심
- Elasticsearch: snapshot은 자동, restore는 운영자가 수행해야 함
- MariaDB: RDS 관리형 복구 기능 활용 가능

### 8-2. 운영 관점 장점

- 데이터 종류에 맞는 백업 전략 분리
- S3 기반 중앙화
- Lifecycle을 통한 장기 보관 정책
- `/admin`과 Grafana를 통한 운영 가시성 확보

### 8-3. 운영 관점 한계

- `/admin`은 현재 MongoDB / Elasticsearch만 직접 집계하고, RDS 백업 상태는 별도 표시하지 않음
- Redis, Kafka는 별도 DR 백업보다는 재생성/재수집 전제에 가까움
- 정기적인 restore rehearsal 문서는 일부 존재하지만, 완전 자동 복구 체계로 보기는 어려움

---

## 9. 발표용 한 줄 요약

TUTUM의 현재 백업 전략은 `MongoDB는 mongodump -> S3`, `Elasticsearch는 snapshot -> S3`, `MariaDB는 RDS 자동 백업` 구조이며, 백업 상태는 `/admin`과 Grafana 알림으로 추적하고, 장기 보관은 S3 Lifecycle과 Glacier 전환 정책으로 관리한다.

---

## 10. 근거 문서 / 파일

- [mongodb-backup.yaml](C:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/k8s-manifests/base/backup/mongodb-backup.yaml)
- [elasticsearch-backup.yaml](C:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/k8s-manifests/base/backup/elasticsearch-backup.yaml)
- [secret-store.yaml](C:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/k8s-manifests/base/security/eso/secret-store.yaml)
- [admin.py](C:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/backend/app/routers/admin.py)
- [storage.py](C:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/backend/app/services/storage.py)
- [2026-03-10_istio_hub_rds_migration_terraform_plan.md](C:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/docs/dev_logs/3월_둘째주/2026-03-10_istio_hub_rds_migration_terraform_plan.md)
- [2026-03-12_phase_d_d1_minio_to_s3_cleanup.md](C:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/docs/dev_logs/3월_둘째주/2026-03-12_phase_d_d1_minio_to_s3_cleanup.md)
- [2026-03-12_cicd_manifest_validation_and_backup_cronjob_recovery.md](C:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/docs/dev_logs/3월_둘째주/2026-03-12_cicd_manifest_validation_and_backup_cronjob_recovery.md)
- [2026-03-12_admin_pipeline_data_store_backup_recovery.md](C:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/docs/dev_logs/3월_둘째주/2026-03-12_admin_pipeline_data_store_backup_recovery.md)
