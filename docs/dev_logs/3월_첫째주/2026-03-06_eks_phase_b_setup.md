# 2026-03-06 EKS Phase B 구성 완료 (ALB / ArgoCD / NetworkPolicy / Istio)

## 작업자
박성준

## 작업 배경
AWS Migration Plan Phase B 항목 순차 진행
기준: `docs/plans/infra/AWS_MIGRATION_PLAN_2026-03-03.md`

## 완료 항목

### 1. cp-2 도구 설치
- eksctl: v0.224.0
- helm: v3.17.1
- istioctl: v1.25.0
- kubectl 컨텍스트: tutum-stg-eks 추가 (`aws eks update-kubeconfig`)
- tutum-sj1202pak EKS Access Entry 추가 (AmazonEKSClusterAdminPolicy)

### 2. EKS Auto Mode 네트워크 문제 수정

**문제**: NodeClass의 subnetSelectorTerms가 public subnet 포함 4개 전체
→ general-purpose NodePool이 public subnet(10.60.1.x, IGW 경로, 공인 IP 없음)에 노드 배치
→ `public.ecr.aws`, `quay.io` 등 이미지 풀 불가 (i/o timeout)

**수정**:
- NodeClass `default` subnetSelectorTerms → private subnet만 사용
  - `subnet-09e82b994d4378ed4` (10.60.11.0/24, ap-northeast-2a)
  - `subnet-012b272e47d6e6a07` (10.60.12.0/24, ap-northeast-2c)
- Subnet 태그 추가:
  - Public (10.60.1.x, 10.60.2.x): `kubernetes.io/role/elb=1`
  - Private (10.60.11.x, 10.60.12.x): `kubernetes.io/role/internal-elb=1`
  - 전체: `kubernetes.io/cluster/tutum-stg-eks=shared`

### 3. ALB Ingress Controller 설치

- OIDC provider 연결: `eksctl utils associate-iam-oidc-provider`
- IAM 정책: `AWSLoadBalancerControllerIAMPolicy` 생성 (`arn:aws:iam::903913341620:policy/...`)
- IRSA 서비스 어카운트: `kube-system/aws-load-balancer-controller`
- Helm: `eks/aws-load-balancer-controller` v3.1.0
- tolerations: `CriticalAddonsOnly:NoSchedule` (시스템 노드 스케줄링)
- 상태: 2/2 Running ✅

### 4. ACM 인증서 발급

- 도메인: `*.tutum.my` + `tutum.my`
- 방식: DNS 검증
- Route53 CNAME 레코드 추가 완료 (tutum.my zone)
- CertARN: `arn:aws:acm:ap-northeast-2:903913341620:certificate/cc8731ed-bd74-4ea4-a07b-897b6fbac78d`
- 상태: PENDING_VALIDATION (DNS 전파 중, 수 분~30분 소요)

### 5. ArgoCD on EKS 배포

- 설치: `kubectl apply -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml --server-side`
- CRD 크기 이슈: `--server-side` 플래그로 해결
- 상태: 7/7 Running ✅ (private subnet 10.60.11.x 노드에 배치)

### 6. 네임스페이스 생성

```
tutum-app, tutum-data, tutum-storage, monitoring, keda
```

### 7. NetworkPolicy 이식

on-prem 정책 그대로 EKS에 적용 (`k8s-manifests/base/security/network-policy.yaml` 기준)

**tutum-data**:
- default-deny-ingress
- allow-from-tutum-app
- allow-from-monitoring
- allow-from-keda (kafka only)
- allow-intra-namespace

**tutum-app**:
- default-deny-ingress
- allow-from-istio (istiod sidecar 트래픽)
- allow-from-monitoring
- allow-intra-namespace

### 8. Istio 재설치 (IngressGateway 제거)

- Profile: `minimal` (istiod only, IngressGateway 없음)
- 이유: ALB가 외부 진입점 역할 대체, Envoy sidecar는 내부 mTLS용으로만 유지
- istiod: 1/1 Running ✅
- sidecar injection: tutum-app, tutum-data 네임스페이스 `istio-injection=enabled`

## VPC 구성 최종

| 서브넷 | CIDR | 역할 | 라우팅 | 태그 |
|--------|------|------|--------|------|
| subnet-0937edf9855525b1b | 10.60.1.0/24 | Public (NAT GW 위치) | IGW | elb=1 |
| subnet-0495c1c0ae546f02c | 10.60.2.0/24 | Public | IGW | elb=1 |
| subnet-09e82b994d4378ed4 | 10.60.11.0/24 | Private (노드) | NAT GW | internal-elb=1 |
| subnet-012b272e47d6e6a07 | 10.60.12.0/24 | Private (노드) | NAT GW | internal-elb=1 |

## 미완료 / 다음 단계

- ACM 인증서 검증 완료 대기 (PENDING_VALIDATION)
- Phase C: GitLab CI → ECR push 전환, Cosign 재서명 (ECR 기준), k8s-manifests image 경로 변경
- ArgoCD EKS에 staging/production Application 등록 (on-prem ArgoCD와 별도 운영)
- Kyverno 재설치 (EKS 환경)

## 참조
- `docs/plans/infra/AWS_MIGRATION_PLAN_2026-03-03.md` Phase B
