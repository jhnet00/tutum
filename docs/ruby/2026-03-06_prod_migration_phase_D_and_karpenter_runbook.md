# 2026-03-06 AWS Prod Migration Runbook

## 현재 진행 상태 (요약)

### 최신 기준
- **Phase A**: 완료
- **Phase B**: 완료 (Prod EKS/VPC/ArgoCD 기준 구성 완료)
- **Phase C**: 진행 중 (현재 미해결 이슈 남음)
- **Phase D**: 착수 (Karpenter 제외, 데이터/워커는 팀원 동시 대응 전까지 보류)
- **Karpenter**: 미설치 (이번에 진행)

### 오늘까지 확인된 상태 (현실 점검)
- `develop`에서 운영 배포 브랜치(`tutum-production`)는 **Argocd 기준 overlay `k8s-manifests/overlays/production`으로 동작**
- 프로덕션에서는 현재 네임스페이스/배포 구조가 아래처럼 정리됨
  - `tutum-app` (백엔드/워커/프론트)
  - `tutum-data` (kafka, redis, mongodb)
  - `tutum-storage` (minio)
- 기존 `tutum-prod-app`은 과거 팀 협업 잔여로 `Terminating` 상태가 있었고, 현재는 분리 정리되어 `tutum-app` 중심으로 전환됨
- 현재 주요 장애 유형(최근):
  - `ImagePullBackOff` + `Progressing=False`
  - `kubectl -n tutum-data get endpoints`에서 `kafka`, `redis`가 `<none>`로 보이는 구간 존재
  - `price-consumer` 계열이 `CrashLoopBackOff`/`ErrImagePull` 이력과 함께 start 실패

> 위 이슈는 Phase D 이전 단계의 런타임 준비(특히 데이터 계층 readiness와 네트워크/endpoint 가시성)가 안 맞는 상황에서 흔히 같이 나옵니다. Phase D로 가기 전에 아래 최소 정리부터 수행해야 합니다.

---

## 오늘 목표 (Team Handoff)

1. **Phase C 마무리 정리** *(보류: 팀원 동시 대응 필요)*  
   - 현재 `ImagePullBackOff`, `ENDPOINTS <none>`가 그대로이므로 완전 해소는 보류.
   - 다만 아래 데이터 인수인수는 `next-window`에 이어서 이어받기 가능.

2. **Phase D 시작 (우선순위 상향)**
   - Karpenter는 후순위
   - MinIO 이전 및 모니터링/감사 계측부터 선행

3. **향후 Karpenter 설치**
   - 팀원들이 Kafka/워크로드 안정화 이후 재개

4. **Phase D 핵심 항목**
   - MinIO → S3/Glacier 이전(저장/라이프사이클)
   - Monitoring(ELT? LGTM 스택) 정착
   - CloudTrail + 감사/S3 로깅 연결

## 지금 바로 할 수 있는 Phase D 실행 가이드 (Karpenter 제외)

### 우선순위 1) 문서/정합성 마무리
- 환경 변수/시크릿 목록 검증: 앱에서 실제 참조하는 변수와 데이터 소스 일치 여부
- MinIO/S3 사용 코드 경로에 대한 feature flag 또는 endpoint 전환 지점 정리

### 우선순위 2) MinIO 전환 준비
```bash
# dry-run: 정책/버킷만 선 생성 (아직 앱은 기존 경로 유지)
# 1) 생성 대상 버킷 설계: 암호화/KMS, TTL, lifecycle(IA/Glacier), 버전관리
# 2) IAM 정책/역할 검토
# 3) S3 접근 경로 테스트: s3://target-bucket/health-check 파일 r/w
```

### 우선순위 3) 모니터링 계측 착수
```bash
# LGTM 구성 리소스는 AWS EC2/기존 모니터링 노드에서 점검 (클러스터 상태와 분리)
kubectl --context tutum-prd-eks -n kube-system get deploy,pod
kubectl --context tutum-prd-eks get cm,svc -n kube-system | grep -i lgtm
```

### 우선순위 4) CloudTrail 인프라
```bash
# 콘솔/terraform으로 CloudTrail을 최소 설정:
# - 멀티리전 trail + S3 bucket
# - 보존기간/암호화/버킷 정책
```

### 실행 중 충돌 방지 규칙
- Phase C 미해결 이슈가 난 상태라서 앱 장애 판단은 `완료`라고 간주하지 말고 `보류`로 기록.
- 데이터/모니터링/감사 계측은 별도 namespace/service로 운영되어야 하며, 앱 재시작 정책과 분리.


---

## 3분 진단 실행순서 (Kafka/워커 상태 바로 판단)

아래 순서만 실행하면 Kafka 문제 해결 여부를 바로 판단할 수 있다.

```bash
CONTEXT=tutum-prd-eks
NS_APP=tutum-app
NS_DATA=tutum-data

echo "0) 컨텍스트/권한"
kubectl --context "$CONTEXT" config current-context || kubectl --context "$CONTEXT" version
kubectl --context "$CONTEXT" get ns

echo "1) 최근 증상 대상 Deployment 상태"
kubectl --context "$CONTEXT" -n "$NS_APP" get deploy backend email-worker frontend price-consumer price-producer
kubectl --context "$CONTEXT" -n "$NS_APP" get pods -o wide

echo "2) Kafka/Redis 서비스-엔드포인트"
kubectl --context "$CONTEXT" -n "$NS_DATA" get svc kafka kafka-headless redis mongodb
kubectl --context "$CONTEXT" -n "$NS_DATA" get endpoints kafka redis
kubectl --context "$CONTEXT" -n "$NS_DATA" get endpointslices.discovery.k8s.io kafka redis

echo "3) kafka statefulset/pod readiness"
kubectl --context "$CONTEXT" -n "$NS_DATA" get sts kafka redis mongodb -o wide
kubectl --context "$CONTEXT" -n "$NS_DATA" get pods -l app=kafka -o wide
kubectl --context "$CONTEXT" -n "$NS_DATA" get pods -l app=redis -o wide
kubectl --context "$CONTEXT" -n "$NS_DATA" describe sts kafka
kubectl --context "$CONTEXT" -n "$NS_DATA" describe sts redis
kubectl --context "$CONTEXT" -n "$NS_DATA" describe sts mongodb
kubectl --context "$CONTEXT" -n "$NS_DATA" describe pods -l app=kafka

echo "4) 워커가 실제로 Kafka/Redis를 읽는지"
kubectl --context "$CONTEXT" -n "$NS_APP" logs deploy/price-consumer --tail=200
kubectl --context "$CONTEXT" -n "$NS_APP" logs deploy/price-producer --tail=200
kubectl --context "$CONTEXT" -n "$NS_APP" logs deploy/email-worker --tail=200

echo "5) 배포 리스타트 후 진행 상태(타임아웃 넉넉히)"
kubectl --context "$CONTEXT" -n "$NS_APP" set env deploy/backend \
  KAFKA_BOOTSTRAP_SERVERS='kafka.tutum-data.svc.cluster.local:9092' \
  REDIS_URL='redis://redis.tutum-data.svc.cluster.local:6379' --overwrite
kubectl --context "$CONTEXT" -n "$NS_APP" set env deploy/email-worker deploy/price-consumer deploy/price-producer \
  KAFKA_BOOTSTRAP_SERVERS='kafka.tutum-data.svc.cluster.local:9092' \
  REDIS_URL='redis://redis.tutum-data.svc.cluster.local:6379' --overwrite
kubectl --context "$CONTEXT" -n "$NS_APP" rollout restart deploy/backend deploy/email-worker deploy/price-consumer deploy/price-producer
kubectl --context "$CONTEXT" -n "$NS_APP" rollout status deploy/backend --timeout=5m || true
kubectl --context "$CONTEXT" -n "$NS_APP" rollout status deploy/email-worker --timeout=5m || true
kubectl --context "$CONTEXT" -n "$NS_APP" rollout status deploy/price-consumer --timeout=5m || true
kubectl --context "$CONTEXT" -n "$NS_APP" rollout status deploy/price-producer --timeout=5m || true
```

판단 기준
- `kubectl -n tutum-data get endpoints kafka redis`에 `ENDPOINTS`가 `<none>`이면, Kafka/Redis 연결 불가가 맞다.
- `describe pods -l app=kafka` / `describe pods -l app=redis`에 `Unhealthy`, `Back-off`, `CrashLoopBackOff`가 있으면 연결 원인 해결 전이다.
- 위가 정상인데도 워커 로그에 `ErrImagePull`/`ImagePullBackOff`가 반복되면, Kafka 문제가 아니라 이미지/registry(secret)/노드 egress 문제를 봐야 한다.

## 시작 전 필수 점검 (각 단계 이전 공통)

```bash
# 컨텍스트/네임스페이스
kubectl config use-context tutum-prd-eks
kubectl get ns
kubectl -n tutum-app get deploy
kubectl -n tutum-app get pod -o wide
kubectl -n tutum-data get pods,sts,svc
kubectl -n tutum-storage get pods,sts,svc

# ArgoCD
argocd app get tutum-production
argocd app sync tutum-production --prune

# 이미지 pull/secret
kubectl -n tutum-app get secret gitlab-registry-secret
kubectl -n tutum-app get deploy backend frontend email-worker price-consumer price-producer -o wide
```

- `gitlab-registry-secret`가 없거나 만료/키 불일치 시 imagePull 실패가 반복됨
- `kafka`/`redis` 서비스 타입, selector, 포트, endpoint readiness를 확인

---

## Step 1. Phase C 장애 정리 (진행 중 단계 마무리)

### 1-1. 워크로드 상태 정리

```bash
kubectl --context tutum-prd-eks -n tutum-app get deploy -o wide
kubectl --context tutum-prd-eks -n tutum-app get rs -o wide
kubectl --context tutum-prd-eks -n tutum-app get pods -o wide
kubectl --context tutum-prd-eks -n tutum-app describe deploy backend frontend email-worker price-consumer price-producer
```

### 1-2. Pod가 안 올라오는 원인 분리

- `ImagePullBackOff`만 보이면:
  1) secret 존재 + namespace 확인
  2) 이미지 태그(`stable`/`2df8d9da`류)와 registry 접근 가능성
  3) Node egress 제한(Security Group) 점검(443/443/필요 포트)

- `ProgressDeadlineExceeded`면:
  - `kubectl describe deploy <name>`에서 `Deployment` 상태 이벤트 확인
  - 새 ReplicaSet이 0/desired에서 멈추는지 점검

### 1-3. Kafka/Redis readiness(매우 중요)

```bash
kubectl -n tutum-data get svc kafka kafka-headless redis redis-exporter mongodb mongodb-headless
kubectl -n tutum-data get endpoints kafka redis mongodb
kubectl -n tutum-data get sts kafka redis mongodb -o wide
kubectl -n tutum-data describe sts kafka
kubectl -n tutum-data describe svc kafka redis
kubectl -n tutum-data get pods -l app=kafka -o wide
kubectl -n tutum-data get pods -l app=redis -o wide
```

#### 체크포인트
- `kafka`/`redis` endpoints가 `<none>`이면 해당 서비스의 selector 라벨이 실제 Pod 라벨과 불일치했거나 Pod가 Ready가 아님
- StatefulSet이 시작 안 되면 Pod 이벤트에서 PVC/PV/CSI/Probe 실패를 우선 확인

### 1-4. 환경변수 강제 정합성 점검

```bash
kubectl -n tutum-app set env deploy/backend \
  KAFKA_BOOTSTRAP_SERVERS='kafka.tutum-data.svc.cluster.local:9092' \
  REDIS_URL='redis://redis.tutum-data.svc.cluster.local:6379' --overwrite

kubectl -n tutum-app set env deploy/email-worker deploy/price-consumer deploy/price-producer \
  KAFKA_BOOTSTRAP_SERVERS='kafka.tutum-data.svc.cluster.local:9092' \
  REDIS_URL='redis://redis.tutum-data.svc.cluster.local:6379' --overwrite

kubectl -n tutum-app rollout restart deploy/backend deploy/frontend deploy/email-worker deploy/price-consumer deploy/price-producer
```

### 1-5. 워크로드 로그 확인

```bash
kubectl -n tutum-app logs deploy/price-consumer --tail=200
kubectl -n tutum-app logs deploy/price-producer --tail=200
kubectl -n tutum-app logs deploy/email-worker --tail=200
kubectl -n tutum-app logs deploy/backend --tail=200
kubectl -n tutum-app logs deploy/frontend --tail=200
```

> 위 단계에서 워크로드가 안정적으로 running 되면 Phase C 진행 완료로 판정.

---

## Step 2. Karpenter 설치 (Phase D와 병행 가능)

> 중요: 기존 Managed Node Group/CA(Cluster Autoscaler)와 동시에 유지하면 충돌/이중조정 위험이 커짐.

### 2-1. 사전 조건
- EKS Cluster OIDC provider 생성되어 있어야 함
- IAM 권한/역할 규칙 수립
- Karpenter Controller가 접근할 Subnet/SG/EC2 Describe/RunInstances IAM 정책 보유

### 2-2. Helm 설치

```bash
helm repo add karpenter https://charts.karpenter.sh
helm repo update
helm upgrade --install karpenter \
  karpenter/karpenter \
  -n kube-system \
  --create-namespace \
  -f ./infra/karpenter-values.yaml
```

### 2-3. IAM + controller role 연결

- 아래 항목이 있어야 함
  - `KarpenterNodeRole` (EC2 Instance Profile용)
  - `KarpenterControllerRole` (`eks:DescribeCluster`, `ec2:*`, `ec2:CreateFleet`, `ec2:RunInstances` 등)
  - IAM OIDC trust 정책에서 `kube-system/karpenter` SA 연동
- 노드 역할에 `AmazonEKS_CNI_Policy`, `AmazonEBSCSIDriverPolicy`, `CloudWatchAgentServerPolicy` 등 필요한 최소 권한 부여

### 2-4. CRD/구성 리소스 적용

```bash
# NodeClass
kubectl apply -f infra/karpenter/ec2nodeclass-prod.yaml

# NodePool
kubectl apply -f infra/karpenter/nodepool-prod.yaml

kubectl get ec2nodeclass,nodepool -A
```

### 2-5. NodePool 최소 예시

- `requirements`: zone, instance-family, capacity-type(spot/on-demand), 용량 범위
- `limits`: cpu/memory 총량 상한
- `disruption` 정책: consolidate/empty time 조절
- `ttlSecondsAfterEmpty`로 scale-to-zero/scale-out 동작 제어

### 2-6. 기존 노드 그룹 전환 전략

1) 새 Karpenter 노드가 healthy로 올라오는지 확인
2) 기존 노드에 남은 workload drain
3) 기존 nodegroup scale down
4) 노드 그룹 제거 여부 결정 (운영 창구 동의 후)

```bash
kubectl top nodes
kubectl get nodes -o wide
# 새 노드가 올라온 뒤
kubectl get pods -A -o wide | Select-String '<현재 워크로드 라벨>'
```

---

## Step 3. Phase D 실행 (오늘 시작)

### 3-1. MinIO → S3/Glacier 이전(계획/검증 순)

1) 대상 버킷 생성
2) S3 버킷 정책(접근 경로 + VPC endpoint 경로)
3) lifecycle 정책: `STANDARD_IA`, `GLACIER`/`GLACIER DEEP ARCHIVE` 적용
4) 동기화 테스트
   - 소량 파일 업로드/다운로드
   - 기존 minio path와 호환성 체크
5) 애플리케이션 환경변수 전환(점진)
6) 데이터 정합성 확인 후 cutover

### 3-2. Monitoring EC2 + LGTM 구성

```bash
# Monitoring VM 기본 점검(ssh/session-manager)
aws ssm start-session --target <monitoring-ec2-id> --region ap-northeast-2

# docker compose 상태 확인
cd /srv/lgtm
docker compose ps
```

- 구성 항목: Grafana, Loki, Tempo, Mimir, Alloy
- Alloy에서 EKS API/metrics scrape 및 로그 경로 점검
- AI 로그 분석기(선택)은 기존 운영 정책과 연동

### 3-3. CloudTrail + 감사 로그

- CloudTrail 다중 이벤트 로그 보관 버킷 지정(S3)
- 관리형 이벤트 + 데이터 이벤트(`s3`,`kms`, etc) 필요 시 점진 활성화
- S3 라이프사이클 + 암호화 및 버킷 정책 검증

### 3-4. 보안/정합성 체크

- WAF/SG/NACL은 이전 상태 유지 후 정합성 비교
- `tutum-app` ↔ `tutum-data` 네트워크 정책 확인 (필요 최소 포트만 허용)
- `ServiceAccount + IRSA` 연결 검증

## Phase D 즉시 실행: `2026-03-06` 기준 체크리스트

아래 순서는 **지금 당장 실행 가능한 항목만** 묶은 실제 런북이다.

### 실행 1) MinIO 대체 대상/경로 정리 (데이터 영향도 산정)

```bash
# 1-1. 저장 경로 인벤토리 (현재 사용 중인 bucket/path)
grep -RInE "minio|MINIO|s3|S3|redis|kafka" docs backend frontend src --include='*.py' --include='*.ts' --include='*.js' --include='*.yml' --include='*.yaml'

# 1-2. 앱 배포값에서 기본값과 오버라이드 분리
kubectl --context tutum-prd-eks -n tutum-app get deploy backend frontend email-worker price-consumer price-producer -o yaml \
   | grep -nE "env:|envFrom:|value:|valueFrom:"
```

### 실행 2) S3 baseline 구축 (Cutover 전 단계)

```bash
# 최소 제약 조건(버킷/권한/라이프사이클)만 먼저 생성하거나 점검
# - 버킷명: tutum-prod-storage-archive (예시)
# - 암호화: SSE-KMS
# - 라이프사이클: STANDARD_IA(30d) -> GLACIER(60d) -> DEEP_ARCHIVE(180d)

# terraform/콘솔로 생성한 뒤, 아래만 확인:
aws s3api get-bucket-encryption --bucket <bucket-name>
aws s3api get-bucket-logging --bucket <bucket-name>
aws s3api get-bucket-lifecycle-configuration --bucket <bucket-name>
```

### 실행 3) LGTM 모니터링(독립) 기초 점검

```bash
# 현재 상태 확인
kubectl --context tutum-prd-eks -n kube-system get pods -o wide
kubectl --context tutum-prd-eks -n kube-system get deploy -l app.kubernetes.io/part-of=observability

# 세션에서 직접 운영 중이라면(예시)
aws ssm start-session --target <monitoring-ec2-id> --region ap-northeast-2
```

### 실행 4) CloudTrail baseline

```bash
# 최소 설정 확인
aws cloudtrail get-trail --name <trail-name>
aws s3api get-bucket-policy --bucket <cloudtrail-logs-bucket>
```

### 실행 5) 단계별 마감 점검(당일 종료 전)

```bash
kubectl --context tutum-prd-eks -n tutum-app get pods
kubectl --context tutum-prd-eks -n tutum-data get sts,pods
kubectl --context tutum-prd-eks get events --sort-by='.lastTimestamp' -A | Select-Object -Last 30
argocd app get tutum-production
```

---

## Step 4. 검증 체크리스트 (D 마무리 판단 기준)

- `tutum-app`: 주요 배포 `AVAILABLE=1..N` (or target replicas)
  - `kubectl get endpoints -n tutum-data kafka redis`에서 IP 노출 상태 점검
  - Phase C 미해결 상태이므로 이 항목은 관측용(미해결 상한치)으로만 기록
  - price/email/backend/frontend worker 로그에 인증/네트워크 에러 미발생
  - `argocd app get tutum-production`가 Sync/Error-free 상태
  - MinIO 이전 후 S3 업/다운 경로가 dual-read 전략에서 단일 경로로 안정 전환
  - LGTM 대시보드에서 API latency/error/rate 지표 정상 가동
  - CloudTrail 로그가 버킷에 지속 수집

---

## 롤백/복구 포인트

- Karpenter 적용 후 Pod scheduling 이슈 발생 시: 기존 autoscaling 체계(ASG 기반)로 즉시 fallback 가능한지 사전 문서화
- MinIO 이전 단계별로 dual-write 또는 read-through 경로 유지
- Phase D 중단 시에도 Phase C 상태가 되돌아가지 않게 이미지/secret/endpoint는 최소 변경 단위로 분리

---

## 오늘 작업 실행 순서(한 줄 요약)

1. **Phase D 실행 시작**: MinIO 이전 전략 확정, S3 버킷·라이프사이클·암호화 점검
2. **LGTM/CloudTrail 연동**: 기존 모니터링·감사 파이프라인 분리 적용
3. **ArgoCD/배포 영향도 최소화**: 앱 배포값/secret/네임스페이스 변경은 1건씩 적용
4. **Karpenter는 보류**: `Phase C + 데이터/워커 안정화` 이후 재개
5. **다음 회의 이전에 공유자료 작성**: phase D 진행 내용 + 보류 항목 + 다음 단계 핸드오버 정리

---

## 참고 파일 (현재 브랜치/실무 정리본)

- `docs/dev_logs/3월_첫째주/2026-03-05_aws_prod_eks_access_argocd_finalize.md`
- `docs/dev_logs/3월_첫째주/2026-03-05_eks_prod_migration_worker_kafka_blocker_log.md`
- `docs/ruby/2026-03-05_prod_migration_handoff_for_team.md`
- `docs/ruby/2026-03-05_AWS_CONSOLE_TEAM_ACCESS_5H_RUNBOOK.md`
- `docs/ruby/aws_settings/2026-03-05_confirmed_settings.md`
