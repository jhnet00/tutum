# AWS Migration Plan 2026-03-03 (EKS + ECR, Harbor 제거)

작성자: `ruby`  
작성일: `2026-03-03`

---

## 1. 확정사항 (변경 반영)

1. Harbor는 사용하지 않는다.
2. 소스코드 관리/CI/CD는 GitLab 기준으로 유지한다.
3. AWS 단계의 컨테이너 레지스트리는 ECR로 전환한다.
4. AWS 배포 대상은 EKS를 사용한다.
5. 온프레미스 MinIO는 유지하고, 필요 데이터는 `MinIO -> S3` 복제로 확장한다.

---

## 2. 목표 아키텍처 (요약)

1. 개발/통합
- GitLab Repo + GitLab CI
- 이미지 빌드 후 ECR push
- k8s-manifests(GitOps) 업데이트
- Argo CD가 EKS로 배포

2. 런타임
- EKS (managed control plane + managed node group)
- ALB Ingress + AWS WAF
- Route53 + ACM TLS

3. 데이터/스토리지
- MongoDB + MariaDB (현행 유지, 단계적으로 AWS managed 검토)
- MinIO(온프레) + S3(클라우드) 하이브리드
- S3 Lifecycle로 Glacier 이동

4. 관측/운영
- Prometheus/Grafana(현행)
- CloudWatch(인프라/ALB/EKS 이벤트)

---

## 3. 네트워크/보안 방향

1. 외부 노출
- 권장: `Route53 -> ALB -> EKS Ingress`
- ALB 앞단에 AWS WAF 연결
- Cloudflare Tunnel은 운영 경로에서 제외

2. Cloudflare 혼용 원칙
- 가능: DNS/캐시/CDN 계층으로만 사용
- 비권장: 터널 기반 주 경로 운영(세션 끊김/운영 리스크)

3. 보안 기준
- ECR 이미지 스캔 활성화
- IRSA로 Pod 권한 최소화
- Secret은 AWS Secrets Manager + External Secrets Operator 도입 검토
- 네트워크 정책(Kyverno/CNI Policy) cp-2 진행안과 통합

---

## 4. CI/CD 목표 상태 (GitLab -> ECR -> EKS)

1. `develop` 브랜치
- Staging 성격
- 이미지 태그: `stg-$CI_COMMIT_SHORT_SHA`

2. `main` 브랜치
- Production 성격
- 이미지 태그: `prod-$CI_COMMIT_SHORT_SHA` + 릴리즈 태그

3. 파이프라인 핵심
- `build`: Docker image build
- `scan`: Trivy/SAST
- `push`: ECR push
- `deploy`: k8s-manifests image tag 갱신
- `sync`: Argo CD sync

---

## 5. 팀 분담 (명령 중심)

## 5-1. 팀장 `ruby` (총괄/릴리즈)

할 일:
1. 브랜치 정책/릴리즈 승인
2. GitLab CI 변수 표준 확정
3. 최종 go/no-go 결정

커맨드 방향:
```bash
git checkout develop
git pull origin develop
git log --oneline -n 20
```

```bash
kubectl -n argocd get applications
kubectl -n argocd describe application tutum-app
```

---

## 5-2. `cp-2` (보안/정책)

할 일:
1. EKS IAM/IRSA 정책 설계
2. Kyverno/NetworkPolicy baseline 적용
3. WAF 룰셋(Managed + rate-limit) 구성

커맨드 방향:
```bash
aws iam list-roles | grep tutum
aws eks describe-cluster --name tutum-eks --region ap-northeast-2
```

```bash
kubectl get clusterpolicy
kubectl get networkpolicy -A
```

---

## 5-3. `cp-3` (플랫폼/K8s 운영)

할 일:
1. EKS 클러스터/노드그룹 운영
2. ALB Ingress Controller/ExternalDNS/Cert-manager 점검
3. 장애 복구 runbook 정리

커맨드 방향:
```bash
eksctl get cluster --region ap-northeast-2
eksctl get nodegroup --cluster tutum-eks --region ap-northeast-2
kubectl get nodes -o wide
```

```bash
kubectl -n kube-system get deploy aws-load-balancer-controller
kubectl get ingress -A
```

---

## 5-4. 백엔드 담당

할 일:
1. ECR image pull 기준으로 deployment 정리
2. Secret/Config 분리
3. 핵심 API smoke test 자동화

커맨드 방향:
```bash
aws ecr describe-repositories --region ap-northeast-2
aws ecr get-login-password --region ap-northeast-2 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-northeast-2.amazonaws.com
```

```bash
kubectl -n tutum-app rollout status deploy/backend
kubectl -n tutum-app logs deploy/backend --tail=100
```

---

## 5-5. 프론트엔드 담당

할 일:
1. 도메인/경로(Route53 + ALB) 기준 API endpoint 점검
2. quick bar, dashboard, chart UI 이슈 정리
3. OAuth/실데이터 모드 회귀 테스트

커맨드 방향:
```bash
cd frontend
npm ci
npm run lint
npm run build
```

```bash
curl -I https://tutum.my
curl -I https://admin.tutum.my
```

---

## 6. 실행 단계 (현실 일정)

## Phase A: 기반 준비 (D+0 ~ D+3)
1. AWS 계정/권한 정리
2. ECR repo 생성
3. GitLab CI 변수 입력

대표 커맨드:
```bash
aws ecr create-repository --repository-name tutum/backend --region ap-northeast-2
aws ecr create-repository --repository-name tutum/frontend --region ap-northeast-2
aws ecr create-repository --repository-name tutum/workers --region ap-northeast-2
```

## Phase B: EKS 구축 (D+4 ~ D+7)
1. EKS 생성
2. ALB Controller 설치
3. Argo CD 연동

대표 커맨드:
```bash
eksctl create cluster \
  --name tutum-eks \
  --region ap-northeast-2 \
  --version 1.30 \
  --nodes 2 \
  --node-type t3.large \
  --managed
```

## Phase C: 배포 전환 (D+8 ~ D+12)
1. GitLab CI에서 ECR push
2. manifests image path ECR로 교체
3. Staging E2E 점검

대표 커맨드:
```bash
kubectl -n tutum-app get deploy
kubectl -n tutum-app get svc
kubectl -n tutum-app get ingress
```

## Phase D: 데이터/운영 (D+13 ~ D+18)
1. MinIO -> S3 복제 작업
2. S3 lifecycle -> Glacier 적용
3. 모니터링/알람 정리

대표 커맨드:
```bash
aws s3api put-bucket-lifecycle-configuration --bucket tutum-prod-data --lifecycle-configuration file://lifecycle.json
```

## Phase E: 안정화 (D+19 ~ D+24)
1. canary/rollback 훈련
2. 장애 대응 리허설
3. 운영문서 확정

---

## 7. 비용 가드레일 (총 900 USD 이하)

1. EKS + 노드 + LB + 스토리지 + 로그 포함 월간 상한 추적
2. Spot 혼용(비핵심 워크로드)으로 절감
3. S3 Lifecycle로 장기 저장 비용 절감
4. 불필요 NAT/고정 IP/미사용 EBS 정리 자동화

운영 규칙:
1. 주간 비용 리포트
2. 월간 초과 예상 시 즉시 scale-down/보존정책 조정

---

## 8. Done 기준

1. Harbor 관련 항목이 파이프라인/문서/매니페스트에서 제거됨
2. `develop -> ECR(stg) -> EKS` 배포 성공
3. `main -> ECR(prod) -> EKS` 배포 성공
4. 주요 기능(OAuth, 시세, 뉴스, OCR, SES, MinIO) E2E 통과
5. 팀원별 운영 명령/복구 명령 문서화 완료

---

## 9. 즉시 액션 체크리스트

1. `.gitlab-ci.yml` ECR login/push job 반영
2. `k8s-manifests` image 경로 ECR로 통일
3. EKS ingress + WAF + Route53 연결 검증
4. MinIO -> S3 복제 정책 확정
5. `cp-2` 보안정책 merge 후 전체 회귀 테스트
