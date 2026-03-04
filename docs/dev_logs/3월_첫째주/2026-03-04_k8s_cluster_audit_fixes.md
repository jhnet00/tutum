# K8s 클러스터 전체 감사 및 이슈 수정

- 날짜: 2026-03-04
- 작업자: 박성준

---

## 배경

SSH 접속 후 전체 클러스터를 점검하여 발견된 이슈 4건 즉시 수정.

---

## 수정 1: elasticsearch-exporter CrashLoopBackOff 해소

### 문제
`elasticsearch-exporter` Pod가 CrashLoopBackOff 상태.
에러: `unknown long flag '--es.cluster_settings'`
→ `quay.io/prometheuscommunity/elasticsearch-exporter:v1.7.0`에서 해당 플래그 제거됨.

### 조치
`k8s-manifests/base/data/elasticsearch-exporter.yaml`에서 `--es.cluster_settings` arg 제거.

---

## 수정 2: ArgoCD ignoreDifferences (KEDA replicas drift)

### 문제
KEDA가 backend를 4개로 스케일업한 상태에서 ArgoCD가 manifest 기준 replicas와 다르다고
`OutOfSync`로 인식 → `tutum-staging Degraded` 반복.

### 조치
`staging-app.yaml`, `production-app.yaml` 양쪽에 `ignoreDifferences` 추가:
```yaml
ignoreDifferences:
  - group: apps
    kind: Deployment
    jsonPointers:
      - /spec/replicas
```

---

## 수정 3: tutum-data 네임스페이스 mTLS 추가

### 문제
`tutum-app`만 Istio PeerAuthentication STRICT 적용되어 있고
`tutum-data` (MongoDB/Redis/Kafka)는 mTLS 미설정 상태.

### 조치
`k8s-manifests/base/ingress/peer-authentication.yaml`에 tutum-data용 PeerAuthentication 추가.

---

## 수정 4: 백업 CronJob 신규 추가

### 문제
계획에는 MongoDB/etcd 자동 백업이 있었으나 실제 CronJob 없음.

### 추가 내용
| 파일 | 스케줄 | 대상 | 저장 |
|------|--------|------|------|
| `base/backup/mongodb-backup.yaml` | 매일 02:00 KST | MongoDB 전체 DB | MinIO `tutum-backups/mongodb/` |
| `base/backup/etcd-backup.yaml` | 매일 02:30 KST | etcd 스냅샷 | MinIO `tutum-backups/etcd/` |

- mongodump gzip 압축 후 MinIO mc cli로 업로드
- etcd: cp-1 nodeSelector + hostPath 인증서 마운트, ETCDCTL_API=3
- 30일 이전 백업 자동 정리
- `base/kustomization.yaml`에 두 파일 등록 완료

---

## 미해결 (Medium 이상)

| # | 항목 | 비고 |
|---|------|------|
| 3 | Kyverno Audit → Enforce 전환 | 서명 파이프라인 안정화 후 진행 |
| 5 | cert-manager ClusterIssuer 미설정 | 도메인 확정 후 진행 |
| 7 | MinIO 단일 레플리카 | HA 전환 시 PVC 재구성 필요 |
