# 2026-03-05 AWS 확정 설정 기록 (최신)

## 1) 운영 방향 (확정)

| 항목 | 확정값 | 이유 |
|---|---|---|
| 소스/CI/CD | GitLab only | 소스관리, 레지스트리, 파이프라인 단일화 |
| 레지스트리 전략 | 온프렘 경로: GitLab Registry / AWS 경로: ECR | 하이브리드 운영 + AWS Native 배포 경로 분리 |
| 운영 모델 | On-prem + AWS 하이브리드 동시 운영 | 점진 전환이 아닌 안정성 중심 병행 운영 |
| 관측 체계 | LGTM(기존) + AWS 관측 병행 | 운영 가시성 유지 + AWS 확장성 확보 |

---

## 2) 리전 / 계정 / 네이밍 (확정)

| 항목 | 값 |
|---|---|
| AWS Account ID | `903913341620` |
| 기본 Region | `ap-northeast-2` (Seoul) |
| STG EKS Cluster | `tutum-stg-eks` |
| PROD EKS Cluster | `tutum-prd-eks` |
| PROD NodeGroup | `ng-prd-general` |
| ECR Frontend Repo | `tutum/frontend` |
| ECR Backend Repo | `tutum/backend` |
| ECR Workers Repo | `tutum/workers` |
| ECR Registry | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com` |

---

## 3) 네트워크/VPC 기준 (확정)

| 항목 | 값 | 비고 |
|---|---|---|
| STG VPC CIDR | `10.60.0.0/16` | EKS 전용 |
| PROD VPC CIDR | `10.61.0.0/16` | EKS 전용 |
| NAT 전략 | 초기 비용 절감: `Zonal` 1 AZ | 필요 시 Regional로 확장 |
| Public Access CIDR | 공인 IP `/32`만 허용 | 사설 대역(`192.168.x.x`) 직접 입력 금지 |

주의:
- `CIDR is not a subset of the VPC CIDR` 오류 방지를 위해, 모든 subnet CIDR은 해당 VPC CIDR 내부로만 설정.

---

## 4) IAM 운영 원칙 (확정)

| 항목 | 설정 |
|---|---|
| 개인 작업용 IAM | `tutum-ruby` 사용자 계정 사용 |
| CI 전용 IAM | `tutum-gitlab-ci` 별도 분리 |
| 분리 이유 | 개인/자동화 권한 및 감사 로그 분리 |
| 권장 방식 | 개인키를 CI에 공유하지 않고, CI 계정 키를 GitLab Variables에 등록 |

---

## 5) GitLab CI/CD Variables (최신 체크리스트)

필수:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_DEFAULT_REGION=ap-northeast-2`
- `AWS_ACCOUNT_ID=903913341620`
- `ECR_REGISTRY=903913341620.dkr.ecr.ap-northeast-2.amazonaws.com`
- `ECR_REPOSITORY_FRONTEND=tutum/frontend`
- `ECR_REPOSITORY_BACKEND=tutum/backend`
- `ECR_REPOSITORY_WORKERS=tutum/workers`
- `EKS_CLUSTER_NAME_STG=tutum-stg-eks`
- `EKS_CLUSTER_NAME_PROD=tutum-prd-eks`

정책 주의:
- `develop`이 protected branch가 아니면, `Protected` 변수는 잡에서 안 읽힐 수 있음.
- 테스트 단계에서는 브랜치 보호정책/변수 보호정책을 서로 일치시켜야 함.

---

## 6) 파이프라인/실행 상태 (2026-03-05 기준)

| Job | 목적 | 상태 |
|---|---|---|
| `aws:precheck` | AWS 인증/기본 접근 확인 | 성공 |
| `aws:ecr-bootstrap` | ECR repo 생성/조회 | 성공 |
| `aws:ecr-push-check` | ECR push smoke 테스트 | 성공 |
| `aws:eks-cluster-check` | EKS/NodeGroup 상태 확인 | 성공 |
| `aws:eks-kubectl-smoke` | kubeconfig 업데이트 + kubectl 조회 | 성공 |

비고:
- `.gitlab-ci.yml`은 기존 메인 파이프라인으로 원복 완료.
- AWS 테스트는 기존 파이프라인 내 수동 job으로 운영.

---

## 7) 오늘 발생한 핵심 이슈와 교훈

| 이슈 | 원인 | 재발 방지 |
|---|---|---|
| `AWS_ACCESS_KEY_ID is missing` | Protected 변수 + 브랜치 정책 불일치 | 브랜치/변수 보호 정책 동기화 |
| `No cluster found for name` | 리전 불일치(미국/서울 혼선) | 리전 고정: `ap-northeast-2` |
| Docker daemon 연결 실패 | DinD 준비 전에 docker 호출 | readiness wait 적용 |

---

## 8) 다음 업데이트 대상

1. `docs/ruby/2026-03-04_AWS_EXECUTION_RESULT.md`에 최종 성공 로그/스크린샷 반영
2. ArgoCD production 앱 Health `Healthy`까지 검증 후 상태 갱신
3. 서울 리전 기준 운영 체크리스트(팀원 인수인계용) 확정

## 9) Session Manager 검증 결과 (2026-03-05 추가)

- 검증 인스턴스: `i-0eef06d350fae53d3` (STG)
- IAM 주체 확인: `arn:aws:iam::903913341620:user/tutum-ruby`
- SSM 상태: `describe-instance-information` 기준 `PingStatus: Online`
- Session Manager Plugin: `1.2.779.0`
- 최종 결과: `aws ssm start-session --target i-0eef06d350fae53d3 --region ap-northeast-2` 접속 성공
- 결론: Runbook 체크리스트의 Session Manager 검증 항목 완료 처리

## 10) 2026-03-12 prod 비용 홀드 기준 상태

- Cluster `tutum-prd-eks`: `ACTIVE`
- Managed NodeGroup: 없음
- 기존 `ng-prd-general`은 제거된 상태
- 현재 남아 있는 노드:
  - `system` nodepool `c6g.large` 2대
  - `general-purpose` nodepool `c5a.large` 3대
- 현재 남아 있는 prod 앱 namespace:
  - `tutum-app`
- 의미:
  - managed nodegroup 비용은 줄었지만, prod 앱 파드와 Pending 파드 때문에 Karpenter 일반 노드 비용은 계속 발생 가능
- 상세 절차:
  - `docs/ruby/aws_settings/2026-03-12_tutum_prd_eks_cost_hold_and_restore_steps.md`
