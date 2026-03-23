# 2026-03-12 EKS 클러스터 복구 + 버그 수정

## 작업자
박성준

## 작업 배경
- 출근 후 EKS 워크로드 복구 (eks-cost-up.sh 실행)
- 전체 K8s/AWS 상태 점검 및 버그 수정

---

## 1. 클러스터 복구 (eks-cost-up.sh)

비용 절감 스크립트 수동 실행 (scripts/ 미동기화로 명령어 직접 실행):

```bash
# EC2 시작
aws ec2 start-instances --instance-ids i-0a8cab5d5ce1cac60 --region ap-northeast-2

# ArgoCD scale up
kubectl scale statefulset argocd-application-controller -n argocd --replicas=1
kubectl scale deployment argocd-redis argocd-repo-server argocd-server ... -n argocd --replicas=1

# KEDA resume
kubectl annotate scaledobject -n tutum-app autoscaling.keda.sh/paused- --overwrite

# 비KEDA deployments (cost-up script 버그로 누락 → 수동 처리)
kubectl scale deployment auth -n tutum-app --replicas=2
kubectl scale deployment email-worker news-producer price-producer ocr -n tutum-app --replicas=1
kubectl scale deployment elasticsearch-exporter kafka-exporter redis-exporter -n tutum-data --replicas=1
kubectl scale deployment kyverno-admission-controller kyverno-background-controller ... -n kyverno --replicas=1
```

**복구 결과**: 전체 네임스페이스 Running 확인

---

## 2. 발견된 버그 및 수정

### 2-1. eks-cost-up.sh 비KEDA Deployment 누락 (즉시 수정)

**원인**: ArgoCD `ignoreDifferences: /spec/replicas` 설정으로 KEDA 없는 서비스는
selfHeal로 replicas 복구 불가. 기존 스크립트에 수동 scale 명령 없음.

**영향 서비스**: auth, email-worker, news/price-producer, ocr, 3종 exporter, kyverno 4종, gitlab-runner

**수정**: `scripts/eks-cost-up.sh` STEP 5 추가 (비KEDA 수동 복구)

커밋: `272b51c` — fix(scripts): add manual scale for non-KEDA deployments in cost-up

---

### 2-2. kiali pod ImagePullBackOff (12h 지속)

**원인**: `quay.io/kiali/kiali:v2.23.0` → EKS private subnet 노드에서 quay.io 타임아웃
(NAT GW 없는 default NodeClass 사용)

**확인**: `kiali/kiali:v2.23.0` ECR 저장소에 이미 미러링 완료 (2026-03-10)

**수정**:
```bash
# Kiali CR 패치
kubectl patch kiali kiali -n istio-system --type=merge \
  -p '{"spec":{"deployment":{"image_name":"903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/kiali/kiali","image_version":"v2.23.0"}}}'

# operator가 업데이트 안함 → 직접 패치
kubectl set image deployment/kiali kiali=903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/kiali/kiali:v2.23.0 -n istio-system
```

**결과**: kiali 1/1 Running ✅

---

### 2-3. mongodb-backup CronJob InitContainer ImagePullBackOff

**원인**: init container `minio/mc:latest` (Docker Hub) → EKS 노드에서 Docker Hub 접근 불가
메인 컨테이너 `mongo:7.0` → ECR에 이미 미러 있음

**수정**:
1. `minio/mc:latest` ECR 저장소 생성 및 crane으로 미러링
   - `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/minio/mc:latest`
2. `k8s-manifests/base/backup/mongodb-backup.yaml` 이미지 교체

```yaml
# 변경 전
image: minio/mc:latest
image: mongo:7.0
# 변경 후
image: 903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/minio/mc:latest
image: 903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/mongo:7.0
```

---

### 2-4. ecr-token-refresher CronJob IRSA AccessDenied

**원인**: ServiceAccount가 `tutum-eks-node-role-stg`를 IRSA로 사용하려 했으나
해당 역할의 trust policy가 `ec2.amazonaws.com`만 허용 (웹아이덴티티 불가)

**수정**:
1. 전용 IAM 역할 생성: `tutum-ecr-token-refresher`
   - Trust policy: OIDC provider + `system:serviceaccount:kyverno:ecr-token-refresher`
   - Inline policy: `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`
2. `k8s-manifests/base/security/ecr-token-cronjob.yaml` role-arn 업데이트

```yaml
# 변경 전
eks.amazonaws.com/role-arn: arn:aws:iam::903913341620:role/tutum-eks-node-role-stg
# 변경 후
eks.amazonaws.com/role-arn: arn:aws:iam::903913341620:role/tutum-ecr-token-refresher
```

---

## 3. 전체 마이그레이션 현황 재확인

| Phase | 항목 | 상태 | 비고 |
|-------|------|------|------|
| A | ECR, GitLab CI, VPC, ACM, COSIGN | ✅ | |
| B | EKS, Istio, ALB, ArgoCD, KEDA, Kyverno | ✅ | |
| B | ECR 토큰 CronJob IRSA | ✅ | 이번 수정 |
| B | KMS CMK (`alias/tutum-secrets-key`) | ✅ | |
| B | ESO + Secrets Manager (`tutum/backend-secret`) | ✅ | |
| B | WAF, GuardDuty, GuardDuty→Slack | ✅ | |
| C | CI/CD 파이프라인 EKS E2E | ✅ | 2026-03-11 전 스테이지 SUCCESS |
| D-4 | MinIO → S3 백엔드 전환 | ✅ | 2026-03-10 완료 |
| D-7 | Kiali 설치 + ECR 이미지 수정 | ✅ | 이번 수정 |
| D-9 | MongoDB EC2 이전 | ❌ | 현재 EKS StatefulSet (3-replica) |
| D-10 | Kafka EC2 이전 | ❌ | 현재 EKS StatefulSet KRaft 3-replica |
| E | DNS 컷오버 | ✅ | |

### 남은 주요 항목
1. **D-9**: MongoDB → EC2 standalone 이전 (데이터 이전 수반, 계획 수립 필요)
2. **D-10**: Kafka → EC2 이전 (토픽/오프셋 마이그레이션 수반)
3. Production EKS 클러스터 비용 최적화 (spot 전환 여부 검토)

## 4. 노드 현황 (아침 기준)
- 총 18개 노드 → Karpenter 통합 진행 중
- Spot 노드 8개 (private-general × 3, private-system × 2, system × 2, etc.)
- On-demand (general-purpose, 어제 생성) → 점진적 제거 예정

## 커밋
- `272b51c` — fix(scripts): add manual scale for non-KEDA deployments in cost-up
- 이번 커밋 — fix: ECR image migration for mongodb-backup and ecr-token-refresher IRSA
