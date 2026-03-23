# EKS ImagePullBackOff 전체 해소 — 외부 이미지 ECR 미러링

- **날짜**: 2026-03-11
- **작업자**: 박성준
- **작업 분류**: Infra / EKS / ECR

---

## 배경

EKS `tutum-stg-eks` 클러스터에서 다수 Pod가 `ImagePullBackOff` 상태.
원인: EKS Auto Mode `private-only` NodeClass 노드는 NAT GW를 통해 인터넷 접근 가능하나,
`general-purpose` NodeClass 노드는 인터넷 연결 없음 → 외부 레지스트리(Docker Hub, quay.io, ghcr.io, reg.kyverno.io 등) 직접 pull 불가.
모든 외부 이미지를 ECR private 레지스트리로 미러링하고, 매니페스트/Helm values를 ECR URI로 전면 교체.

---

## 미러링한 이미지 목록 (crane copy, cp-2에서 실행)

| 원본 이미지 | ECR 대상 |
|------------|---------|
| `quay.io/argoproj/argocd:v3.3.2` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/argoproj/argocd:v3.3.2` |
| `ghcr.io/dexidp/dex:v2.43.0` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/dexidp/dex:v2.43.0` |
| `ghcr.io/kedacore/keda:2.16.1` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/kedacore/keda:2.16.1` |
| `ghcr.io/kedacore/keda-metrics-apiserver:2.16.1` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/kedacore/keda-metrics-apiserver:2.16.1` |
| `ghcr.io/kedacore/keda-admission-webhooks:2.16.1` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/kedacore/keda-admission-webhooks:2.16.1` |
| `reg.kyverno.io/kyverno/kyvernopre:v1.17.1` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/kyverno/kyvernopre:v1.17.1` |
| `reg.kyverno.io/kyverno/kyverno:v1.17.1` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/kyverno/kyverno:v1.17.1` |
| `reg.kyverno.io/kyverno/background-controller:v1.17.1` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/kyverno/background-controller:v1.17.1` |
| `reg.kyverno.io/kyverno/cleanup-controller:v1.17.1` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/kyverno/cleanup-controller:v1.17.1` |
| `amazon/aws-cli:2.15.0` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/amazon/aws-cli:2.15.0` |
| `quay.io/prometheuscommunity/elasticsearch-exporter:v1.7.0` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/prometheuscommunity/elasticsearch-exporter:v1.7.0` |
| `busybox:1.35` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/busybox:1.35` |
| `confluentinc/cp-kafka:7.5.0` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/confluentinc/cp-kafka:7.5.0` |
| `mongo:7.0` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/mongo:7.0` |
| `minio/minio:RELEASE.2024-01-16T16-07-38Z` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/minio/minio:RELEASE.2024-01-16T16-07-38Z` |
| `docker.elastic.co/elasticsearch/elasticsearch:8.17.0` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/elasticsearch/elasticsearch:8.17.0` |
| `redis:7-alpine` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/redis:7-alpine` |
| `oliver006/redis_exporter:v1.62.0` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/oliver006/redis_exporter:v1.62.0` |
| `danielqsj/kafka-exporter:latest` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/danielqsj/kafka-exporter:latest` |
| `quay.io/kiali/kiali:v2.23.0` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/kiali/kiali:v2.23.0` |
| `alpine:3.20` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/alpine:3.20` |
| `aquasec/trivy:latest` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/aquasec/trivy:latest` |
| `public.ecr.aws/eks/aws-load-balancer-controller:v3.1.0` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/eks/aws-load-balancer-controller:v3.1.0` |

---

## 수정한 매니페스트/설정 파일

| 파일 | 변경 내용 |
|------|---------|
| `.gitlab-ci.yml` | `alpine:3.20`, `aquasec/trivy:latest` → ECR |
| `k8s-manifests/base/security/ecr-token-cronjob.yaml` | `amazon/aws-cli:2.15.0` → ECR |
| `k8s-manifests/base/data/elasticsearch-exporter.yaml` | ES exporter → ECR |
| `k8s-manifests/base/data/kafka.yaml` | `busybox:1.35`, `confluentinc/cp-kafka:7.5.0` → ECR; `remove-lost-found` init container 추가 |
| `k8s-manifests/base/data/mongodb.yaml` | `mongo:7.0` → ECR (StatefulSet + rs-init Job 전체) |
| `k8s-manifests/base/storage/minio.yaml` | `minio/minio` → ECR |
| `k8s-manifests/base/data/elasticsearch.yaml` | `elasticsearch:8.17.0` → ECR (init + main container) |
| `k8s-manifests/base/data/redis.yaml` | `redis:7-alpine` → ECR |
| `k8s-manifests/base/data/redis-exporter.yaml` | `redis_exporter:v1.62.0` → ECR |
| `k8s-manifests/base/data/kafka-exporter.yaml` | `kafka-exporter:latest` → ECR |
| `k8s-manifests/base/keda/keda-values.yaml` | **신규** — KEDA Helm values ECR 이미지 |
| `k8s-manifests/base/kyverno/kyverno-ecr-values.yaml` | **신규** — Kyverno Helm values ECR 이미지 (4개 컴포넌트 전체) |

---

## 클러스터 적용 작업 (cp-2에서 실행)

### ArgoCD (argocd ns, manifest 설치)
- `argocd-server`, `argocd-repo-server`, `argocd-applicationset-controller`, `argocd-notifications-controller` Deployment → `kubectl set image`
- `argocd-application-controller` StatefulSet → `kubectl patch`
- `argocd-dex-server` Deployment (init container `copyutil` + main container `dex`) → `kubectl patch`
- `argocd-redis` Deployment (init container 포함) → `kubectl patch`

### KEDA
```bash
helm upgrade keda keda-add-ons-http/keda -n keda --reuse-values \
  -f /tmp/keda-values.yaml
```

### Kyverno (웹훅 데드락 해소 후 전체 업그레이드)
- 문제: cleanup-controller만 먼저 업그레이드 후 admissionController/backgroundController ImagePullBackOff
  → `failurePolicy: Fail` 웹훅 엔드포인트 없음 → 모든 kubectl 뮤테이션 차단
- 해결: 웹훅 일시 삭제 후 누락된 이미지 미러링, 전체 `helm upgrade`
```bash
kubectl delete mutatingwebhookconfigurations,validatingwebhookconfigurations \
  -l app.kubernetes.io/instance=kyverno
helm upgrade kyverno kyverno/kyverno -n kyverno --version 3.7.1 \
  -f /tmp/kyverno-values.yaml
```

### AWS Load Balancer Controller
```bash
helm upgrade aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system --reuse-values \
  --set image.repository=903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/eks/aws-load-balancer-controller
```

### 기타 kubectl set image 적용
- `ecr-token-refresher` CronJob, `elasticsearch-exporter`, `kafka` StatefulSet (init 2개 + main), `mongodb`, `minio`, `elasticsearch`, `redis`, `redis-exporter`, `kafka-exporter`

---

## 트러블슈팅 주요 사항

### Kyverno 웹훅 데드락
- Kyverno 자체 Pod ImagePullBackOff 시 웹훅 엔드포인트 없음 → `failurePolicy: Fail` → 모든 kubectl 뮤테이션 불가
- 해결 순서: 웹훅 삭제 → 이미지 미러링 → helm upgrade 전체

### StatefulSet 구 Pod 강제 삭제
- `kubectl set image` 후 rolling update가 이전 Pod Ready 대기로 블록
- `kubectl delete pod <name> --grace-period=0 --force` 로 재생성 강제

### kafka `remove-lost-found` init container
- EKS StatefulSet에 로컬 매니페스트에 없는 init container 존재 (busybox, `/var/lib/kafka/data/lost+found` 정리)
- `kubectl get statefulset kafka -o jsonpath` 로 확인 후 kubectl set image 적용
- 로컬 kafka.yaml에도 반영 완료

### ECR 토큰 만료 후 재적용
- ecr-token-refresher CronJob 패치 후 구 Job 오브젝트가 구 이미지로 남아 있어 수동 Job 생성:
  `kubectl create job --from=cronjob/ecr-token-refresher ecr-token-refresher-manual`

---

## 최종 결과

```
ImagePullBackOff: 0
Running: 79
```

모든 EKS Pod 정상 Running 확인.
