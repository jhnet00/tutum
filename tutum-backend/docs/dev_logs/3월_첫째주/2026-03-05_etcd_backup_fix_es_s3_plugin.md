# etcd-backup 장애 수정 및 Elasticsearch S3 플러그인 설치

**날짜**: 2026-03-05
**작업자**: 박성준
**브랜치**: develop

---

## 배경

SSH 클러스터 감사에서 발견된 etcd-backup 실패 및 elasticsearch-backup 미적용 상태를 수정.

---

## 발견된 이슈 및 조치

### 1. etcd-backup CronJob 실패 — exit 127 (BackoffLimitExceeded)

**증상**
```
Job: etcd-backup-29544090
COMPLETIONS: 0/1 (8시간 경과)
상태: BackoffLimitExceeded
3회 모두 exit_status: 127 (< 1초 내 종료)
```

**원인 (이중 버그)**

1. `registry.k8s.io/etcd:3.5.10-0` 이미지에 `gzip`, `wget` 미포함 → exit 127
   - 해당 이미지는 `etcd`, `etcdctl`, `etcdutl` 바이너리만 포함 (distroless-style)
   - 스크립트가 `set -e` 상태에서 `gzip "${SNAPSHOT}"` 실행 즉시 실패
2. `dnsPolicy: ClusterFirstWithHostNet` 누락
   - `hostNetwork: true` 설정 시 기본 DNS policy는 `Default` (host의 resolv.conf)
   - `minio.tutum-storage.svc.cluster.local` 등 K8s 서비스 DNS 해석 불가
   - gzip 문제가 없었더라도 MinIO 업로드 단계에서 실패했을 것

**조치**: initContainer(etcd 스냅샷) + main container(alpine: gzip+mc) 분리 구조로 수정

```yaml
# Before: 단일 컨테이너 (registry.k8s.io/etcd:3.5.10-0)
# → gzip/wget 없어서 즉시 실패

# After: initContainer + main container 분리
initContainers:
  - name: etcd-snapshot
    image: registry.k8s.io/etcd:3.5.10-0  # etcdctl snapshot save
    → emptyDir(/shared)에 스냅샷 저장

containers:
  - name: etcd-backup
    image: alpine:3.19  # gzip 내장, mc는 apk install
    → gzip 압축 + mc로 MinIO 업로드

# dnsPolicy 추가
hostNetwork: true
dnsPolicy: ClusterFirstWithHostNet   # ← 추가
```

**클러스터 적용**
```bash
kubectl apply -f k8s-manifests/base/backup/etcd-backup.yaml
# secret/minio-backup-secret configured
# cronjob.batch/etcd-backup configured

kubectl delete job etcd-backup-29544090 -n kube-system  # 실패 job 정리
```

**결과**: CronJob 정상 업데이트, 다음 실행(17:30 UTC, 02:30 KST)에서 정상 동작 예상 ✅

---

### 2. Elasticsearch repository-s3 플러그인 미설치 → elasticsearch-backup 동작 불가

**증상**
```
elasticsearch StatefulSet: 1/1 Running (정상)
repository-s3 플러그인: 미설치
elasticsearch-backup CronJob: 클러스터 미적용 상태
```

**원인**: 공식 ES 이미지 `docker.elastic.co/elasticsearch/elasticsearch:8.17.0`에
`repository-s3` 플러그인 미포함. 플러그인 없이 MinIO S3 스냅샷 저장소 등록 불가.

**조치 1**: `elasticsearch.yaml` initContainer 추가

```yaml
initContainers:
  - name: install-s3-plugin
    image: docker.elastic.co/elasticsearch/elasticsearch:8.17.0
    command:
      - sh
      - -c
      - elasticsearch-plugin install --batch repository-s3
    volumeMounts:
      - name: es-plugins
        mountPath: /usr/share/elasticsearch/plugins

volumes:
  - name: es-plugins
    emptyDir: {}   # initContainer → main container 플러그인 공유

containers:
  - name: elasticsearch
    volumeMounts:
      - name: es-plugins
        mountPath: /usr/share/elasticsearch/plugins  # ← 추가
```

**조치 2**: `elasticsearch-backup` CronJob 클러스터 적용
```bash
kubectl apply -f k8s-manifests/base/backup/elasticsearch-backup.yaml
# cronjob.batch/elasticsearch-backup created
```

**클러스터 확인**
```
Init Containers:
  install-s3-plugin:
    State: Terminated (Completed, exit 0)
    Started: 02:23:10, Finished: 02:23:15  (5초 설치)
elasticsearch: 1/1 Running ✅
elasticsearch-backup CronJob: 등록 완료 (0 18 * * *, 03:00 KST) ✅
```

---

## 최종 백업 현황

| 백업 대상 | CronJob | 스케줄 (KST) | 상태 |
|----------|---------|-------------|------|
| MongoDB | mongodb-backup | 매일 02:00 | ✅ 정상 |
| etcd | etcd-backup | 매일 02:30 | ✅ 수정 완료 |
| Elasticsearch | elasticsearch-backup | 매일 03:00 | ✅ 신규 적용 |
| MariaDB | 제외 (외부 서버) | - | - |

---

## 변경 파일

| 파일 | 변경 내용 |
|------|---------|
| `k8s-manifests/base/backup/etcd-backup.yaml` | initContainer 분리 + dnsPolicy 수정 |
| `k8s-manifests/base/data/elasticsearch.yaml` | repository-s3 initContainer 추가 |
| `k8s-manifests/base/backup/elasticsearch-backup.yaml` | 신규 생성 (이전 커밋) |

---

## 향후 확인 사항

- [ ] etcd-backup 다음 실행 결과 확인 (17:30 UTC)
- [ ] elasticsearch-backup 첫 실행 결과 확인 (18:00 UTC)
- [ ] MinIO `tutum-backups/etcd/` 및 `tutum-backups/elasticsearch/` 경로 확인
