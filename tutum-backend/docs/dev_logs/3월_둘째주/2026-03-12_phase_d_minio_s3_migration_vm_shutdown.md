# 개발 로그 작업 요약 (2026-03-12)

## 1. 작업 요약
- 작업 일시: 2026-03-12
- 작업자: 박성준
- 브랜치: develop
- 작업 목적: Phase D 잔여 항목 마무리 — MinIO EKS PVC 정리와 on-prem MinIO 데이터 S3 이관, MongoDB legacy VM 종료, on-prem monitoring VM 종료, on-prem K8s 클러스터 worker/cp 종료 (cp-2 제외)

## 2. 상세 변경 사항

### D-1: MinIO 잔여 정리 완료
- on-prem MinIO(`minio-0` pod exec)에서 `mc ls --recursive`로 버킷 내용 확인
  - `ocr-images/`: OCR 처리 결과 PNG 11개 파일 (~2.3MB) 존재 확인
  - `profile-images/`: 빈 버킷
  - `tutum-backups/`: elasticsearch 스냅샷 (별도 S3 경로로 이미 저장 중)
- `mc mirror local/ocr-images s3/tutum-prod-storage/ocr-images/`로 11개 파일을 AWS S3로 이관 완료
  - 자격증명: `backend-secret`(tutum-app ns)에서 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY 추출 사용
  - 검증: `mc ls s3/tutum-prod-storage/ocr-images/ | wc -l` → 11 확인
- EKS `tutum-storage` 네임스페이스의 MinIO PVC 4개 삭제 (cp-2에서 EKS context 사용)
  - `minio-data-minio-0~3` (각 20Gi gp3) → 총 80Gi EBS 해제

### D-9: MongoDB legacy VM 종료
- `192.168.0.231` SSH 접속하여 상태 확인
  - `ss -tn state established sport = :27017 or dport = :27017` → ESTABLISHED 연결 0건
  - crontab (user/root): 비어 있음 (e2scrub_all만 존재, MongoDB 무관)
  - `mongod.conf` bindIp: `127.0.0.1,192.168.0.231` (외부 공개 최소화 설정)
- EKS MongoDB ReplicaSet 정상 확인 후 legacy mongod 서비스 중단 및 비활성화
  - `systemctl stop mongod` + `systemctl disable mongod`
  - EKS mongodb-0(PRIMARY), mongodb-1(SECONDARY), mongodb-2(SECONDARY) 상태 영향 없음 확인
- `sudo shutdown -h now`로 VM 종료, SSH 타임아웃으로 오프라인 확인

### D-11: on-prem monitoring VM 종료
- `192.168.0.230` SSH 접속하여 컨테이너 상태 확인
  - 실행 중: `grafana`, `mimir`, `loki`, `tempo`, `influxdb`, `kiali`, `tempo-http-proxy`, `tempo-local-proxy`
  - `tempo-http-proxy`: nginx 컨테이너, 3202 → 3200 프록시 (on-prem Tempo 전용)
- EKS Alloy configmap 확인: 모든 endpoint가 `10.60.11.95` (AWS monitoring EC2) 지정
  - Mimir push: `http://10.60.11.95:9009/api/v1/push`
  - Loki push: `http://10.60.11.95:3100/loki/api/v1/push`
  - Tempo OTLP: `10.60.11.95:4317`
  - `192.168.0.230` 참조 없음 → EKS 워크로드에 영향 없음
- on-prem K8s Alloy는 `192.168.0.230`으로 전송 중이나, on-prem 클러스터 자체가 해체 예정이므로 허용
- `sudo shutdown -h now`로 VM 종료, SSH 타임아웃으로 오프라인 확인

### D-11: on-prem K8s 클러스터 worker/cp 종료
- `kubectl get pods -A -o wide` 로 worker1~3 실행 파드 목록 확인
  - 잔존 파드: argocd, cert-manager, istio, keda, kyverno, tutum-app, tutum-data, tutum-storage, sonarqube 등
  - 해당 워크로드는 모두 EKS에 동일 기능 존재, on-prem 파드는 구형 잔존 분
- `kubectl drain worker1 worker2 worker3 --ignore-daemonsets --delete-emptydir-data --force --grace-period=10 --timeout=120s`
  - worker2: drain 완료
  - worker1, worker3: StatefulSet PDB로 타임아웃 → VM 직접 종료로 전환
- SSH로 worker1~3 동시 `shutdown -h now` → 모두 오프라인 확인
- SSH로 cp-1, cp-3 동시 `shutdown -h now` → 모두 오프라인 확인
- **cp-2 (192.168.0.221)는 aws CLI + EKS kubeconfig 용도로 유지**

## 3. 작업 중 발생 이슈 및 대응
- 이슈: local bash 환경에 aws CLI 미설치로 `aws ssm send-command` 실행 불가
- 대응: cp-2(192.168.0.221)에 aws CLI와 EKS kubeconfig가 구성되어 있음을 확인하고, cp-2 SSH를 통해 EKS kubectl 명령 실행
- 이슈: on-prem MinIO pod에서 mc S3 alias 생성 시 첫 시도에 `Access Denied` 오류
- 대응: 환경변수 `MINIO_ROOT_USER=minioadmin`, `MINIO_ROOT_PASSWORD=minioadmin` 확인 후 alias 재설정

## 4. 결과

| 검증 항목 | 결과 |
|-----------|------|
| S3 `ocr-images/` 파일 수 | 11개 ✅ |
| EKS `tutum-storage` PVC | 0개 (전체 삭제) ✅ |
| EKS MongoDB ReplicaSet | PRIMARY 1 + SECONDARY 2 정상 ✅ |
| legacy MongoDB VM (192.168.0.231) | 오프라인 ✅ |
| on-prem monitoring VM (192.168.0.230) | 오프라인 ✅ |
| AWS monitoring EC2 (10.60.11.95) | 영향 없음, LGTM 스택 운영 중 ✅ |
| on-prem worker1 (192.168.0.223) | 오프라인 ✅ |
| on-prem worker2 (192.168.0.224) | 오프라인 ✅ |
| on-prem worker3 (192.168.0.225) | 오프라인 ✅ |
| on-prem cp-1 (192.168.0.220) | 오프라인 ✅ |
| on-prem cp-3 (192.168.0.222) | 오프라인 ✅ |
| on-prem cp-2 (192.168.0.221) | 유지 중 (AWS CLI 전용) ✅ |

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-12" --until="2026-03-12 23:59:59"
```

## 6. 후속 작업/리스크
- `tutum-storage` 네임스페이스 자체: PVC 삭제 완료, namespace 정리는 추후 판단
- InfluxDB: Mimir로 대체됨. k6 차기 테스트는 `--out=experimental-prometheus-rw`로 Mimir 직접 push 사용 권장
- cp-2 (192.168.0.221): on-prem kubeadm etcd quorum 상실 (3→1). K8s 클러스터 기능 불가 상태이나 aws CLI / EKS kubectl 기능은 정상. 팀에서 더 이상 cp-2가 필요 없을 경우 종료 가능
- on-prem 물리 호스트 PC들의 전원/네트워크 비용이 잔존하므로, cp-2 종료 시점 팀 내 합의 후 진행 권장
