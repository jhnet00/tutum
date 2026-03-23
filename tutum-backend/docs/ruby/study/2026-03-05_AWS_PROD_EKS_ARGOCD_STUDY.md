# 2026-03-05 AWS / EKS / ArgoCD 실전 CLI 정리

## 목적
- 오늘 기준으로 실제 터미널에서 자주 치는 명령만 빠르게 재사용할 수 있게 정리.
- 기준 리전은 `ap-northeast-2`(서울), 기준 브랜치는 `develop`.

---

## 1) AWS 기본 확인

```bash
# 현재 IAM 주체 확인
aws sts get-caller-identity --region ap-northeast-2

# 현재 CLI 리전 확인
aws configure get region

# 리전 강제 지정 프로파일 확인
aws configure list --profile ruby
```

문제 상황 체크:
```bash
# 클러스터가 안 보일 때 (리전 불일치 확인)
aws eks list-clusters --region ap-northeast-2
aws eks list-clusters --region us-east-2
```

---

## 2) ECR 확인/부트스트랩

```bash
# 리포지토리 목록 확인
aws ecr describe-repositories --region ap-northeast-2 --query "repositories[].repositoryName"

# 리포지토리 없으면 생성
aws ecr create-repository --region ap-northeast-2 --repository-name tutum/frontend || true
aws ecr create-repository --region ap-northeast-2 --repository-name tutum/backend || true
aws ecr create-repository --region ap-northeast-2 --repository-name tutum/workers || true
```

```bash
# ECR 로그인 패스워드 발급
aws ecr get-login-password --region ap-northeast-2
```

```bash
# (로컬 Docker 테스트 시)
aws ecr get-login-password --region ap-northeast-2 | \
  docker login --username AWS --password-stdin 903913341620.dkr.ecr.ap-northeast-2.amazonaws.com
```

---

## 3) EKS 클러스터/노드그룹 확인

```bash
# STG 클러스터 정보
aws eks describe-cluster --region ap-northeast-2 --name tutum-stg-eks \
  --query "cluster.{name:name,status:status,version:version,endpoint:endpoint}"

# PROD 클러스터 정보
aws eks describe-cluster --region ap-northeast-2 --name tutum-prd-eks \
  --query "cluster.{name:name,status:status,version:version,endpoint:endpoint}"
```

```bash
# 노드그룹 목록
aws eks list-nodegroups --region ap-northeast-2 --cluster-name tutum-stg-eks
aws eks list-nodegroups --region ap-northeast-2 --cluster-name tutum-prd-eks

# 노드그룹 상세
aws eks describe-nodegroup --region ap-northeast-2 --cluster-name tutum-prd-eks --nodegroup-name ng-prd-general
```

---

## 4) kubeconfig / kubectl

```bash
# kubeconfig 업데이트 (별칭 포함)
aws eks update-kubeconfig --region ap-northeast-2 --name tutum-stg-eks --alias tutum-stg-eks
aws eks update-kubeconfig --region ap-northeast-2 --name tutum-prd-eks --profile ruby --alias tutum-prd-eks
```

```bash
# 컨텍스트/노드 확인
kubectl config get-contexts
kubectl config use-context tutum-prd-eks
kubectl get nodes -o wide
kubectl get ns
```

---

## 5) ArgoCD (Prod 연결/동기화)

```bash
# 등록된 클러스터 확인
argocd cluster list

# EKS 클러스터 등록
argocd cluster add tutum-prd-eks --kube-context tutum-prd-eks --name tutum-prd-eks --yes
```

```bash
# 앱 목적지 서버를 prod EKS endpoint로 변경
argocd app set tutum-production --dest-server https://2D522A207493F13377B8D32660928341.gr7.ap-northeast-2.eks.amazonaws.com

# 수동 동기화 정책
argocd app set tutum-production --sync-policy none

# 앱 상태/동기화
argocd app get tutum-production
argocd app sync tutum-production
```

주의:
- `application destination can't have both name and server defined` 발생 시 `--dest-name`과 `--dest-server` 중 하나만 사용.

---

## 6) GitLab Pipeline 수동 실행 순서

GitLab UI > CI/CD > Pipelines에서 `develop` 기준 manual 실행:

1. `aws:precheck`
2. `aws:ecr-bootstrap`
3. `aws:ecr-push-check`
4. `aws:eks-cluster-check`
5. `aws:eks-kubectl-smoke`

실패 포인트 빠른 진단:
- `AWS_ACCESS_KEY_ID is missing`: 변수 보호 범위(Protected)와 브랜치 정책 확인
- `EKS_CLUSTER_NAME_STG is missing`: 변수명/값 확인
- `No cluster found`: 리전/클러스터명 불일치 확인

---

## 7) 오늘 기준 기억할 고정값

- Region: `ap-northeast-2`
- Account: `903913341620`
- ECR Registry: `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com`
- STG Cluster: `tutum-stg-eks`
- PROD Cluster: `tutum-prd-eks`
- PROD NodeGroup: `ng-prd-general`

---

## 8) 내일 바로 시작 체크리스트

- [ ] `aws sts get-caller-identity`로 계정 확인
- [ ] `aws eks list-clusters --region ap-northeast-2` 확인
- [ ] `argocd app get tutum-production`에서 Health 확인
- [ ] `kubectl -n tutum-prod-app get deploy` Ready 확인
