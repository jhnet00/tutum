# 백업 모니터링 + Slack 알림 + Elasticsearch 백업 추가

**날짜**: 2026-03-05
**작업자**: 박성준
**브랜치**: develop

---

## 작업 배경

K8S_MIGRATION_PLAN Section 25 (백업 전략) 기준으로 현황 점검 결과:

| 항목 | 이전 상태 | 이번 작업 후 |
|------|----------|------------|
| MongoDB 백업 | ✅ CronJob 있음 | 변경 없음 |
| etcd 백업 | ✅ CronJob 있음 | 변경 없음 |
| Elasticsearch 백업 | ❌ 매니페스트 없음 | ✅ **추가** |
| 백업 실패 Slack 알림 규칙 | ❌ 없음 | ✅ **추가** |
| Slack Webhook URL 설정 | ❌ 비어있음 | ✅ **환경변수 연동 추가** |

---

## 변경 내용

### 1. Elasticsearch 백업 CronJob 추가

**파일**: `k8s-manifests/base/backup/elasticsearch-backup.yaml`

- 매일 03:00 KST 실행 (`schedule: "0 18 * * *"`)
- ES Snapshot API + MinIO S3 repository 방식
- 14일 이전 스냅샷 자동 삭제
- MinIO 저장 경로: `tutum-backups/elasticsearch/`

**사전 조건 (1회 수동 작업 필요)**:
```bash
# Node3에서 repository-s3 플러그인 설치
docker exec elasticsearch elasticsearch-plugin install repository-s3
docker restart elasticsearch
```

**클러스터 적용**:
```bash
kubectl apply -f k8s-manifests/base/backup/elasticsearch-backup.yaml
# minio-secret이 tutum-data에 있는지 확인 (mongodb-backup과 동일 방식)
kubectl get secret minio-secret -n tutum-data
```

---

### 2. Grafana 백업 실패 Slack 알림 규칙 추가

**파일**: `k8s-manifests/step3-lgtm/monitoring-vm/grafana/provisioning/alerting/alert-rules.yml`

추가된 알림 규칙 3개:

| 규칙 | 조건 | 심각도 |
|------|------|--------|
| `BackupCronJobFailed` | `kube_job_status_failed{job_name=~".*backup.*"} > 0` | Critical |
| `MinIOStorageHigh` | MinIO 사용량 > 80% | Warning |
| `BackupMissed3Days` | 72시간 내 성공한 backup job 없음 | Critical |

`policies`에 `group_wait`, `group_interval`, `repeat_interval` 추가 (중복 알림 억제).

---

### 3. Slack Webhook URL 환경변수 연동

**파일**: `k8s-manifests/step3-lgtm/monitoring-vm/docker-compose.yml`

`SLACK_WEBHOOK_URL` 환경변수를 Grafana 컨테이너에 주입.
alert-rules.yml의 contactPoints에서 `${SLACK_WEBHOOK_URL}`로 참조.

**파일**: `k8s-manifests/step3-lgtm/monitoring-vm/.env.example`

실제 웹훅 URL 주입 방법:
```bash
# monitoring VM (192.168.0.230)에서
cp .env.example .env
# .env 파일에 실제 Slack 웹훅 URL 입력:
# SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../...

docker compose up -d grafana   # Grafana만 재시작
```

Slack 웹훅 URL 발급:
1. https://api.slack.com/apps → 앱 선택 (없으면 Create New App)
2. Incoming Webhooks → Add New Webhook to Workspace
3. 채널: `#tutum-alerts` 선택
4. 웹훅 URL 복사 → `.env`에 입력

---

## 향후 확인 사항

- [ ] Node3에서 `repository-s3` 플러그인 설치 후 `elasticsearch-backup` CronJob 첫 실행 확인
- [ ] Slack 웹훅 URL 발급 후 `.env`에 등록 → Grafana 알림 테스트 (테스트 알림 전송)
- [ ] `BackupCronJobFailed` 알림이 실제로 Slack `#tutum-alerts`로 수신되는지 검증
