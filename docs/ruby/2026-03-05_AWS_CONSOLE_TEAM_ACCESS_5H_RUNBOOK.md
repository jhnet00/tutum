# 2026-03-05 AWS 콘솔 팀 권한 세팅 5시간 런북

## 0. 목적
- 오늘 안에 팀원들이 AWS 콘솔에서 직접 작업 가능한 상태를 만든다.
- 내일 부재를 고려해 권한/계정/알람/인계 문서를 오늘 완료한다.
- 기준: `docs/ruby/2026-03-04_AWS_MIGRATION_PHASE9_SOLO_RUNBOOK.md`

## 1. 오늘 완료 기준 (Done)
1. 팀원별 콘솔 계정 생성 및 MFA 강제 적용 완료
2. 역할별 IAM 그룹/정책 적용 완료
3. GitLab CI 전용 IAM 사용자(또는 역할) 권한 확정 및 변수 등록 완료
4. ECR/EKS 수동 점검 파이프라인 통과 (`aws:precheck`, `aws:ecr-bootstrap`, `aws:ecr-push-check`, `aws:eks-cluster-check`, `aws:eks-kubectl-smoke`)
5. 예산 알람(Budget) + 운영 알람(SNS/Email) 최소 1개 이상 활성화
6. 팀 인계표(누가 어떤 콘솔 메뉴까지 접근 가능한지) 공유 완료

## 2. 5시간 타임박스
| 시간 | 작업 | 완료 기준 |
|---|---|---|
| 00:00~00:40 | 계정 보안 기본값 점검 | Root MFA on, 불필요 Access Key 제거 |
| 00:40~01:50 | IAM 사용자/그룹/권한 생성 | 팀원 전원 콘솔 로그인 + MFA 등록 |
| 01:50~02:40 | GitLab CI용 IAM 권한 확정 | CI 변수 등록 후 AWS 수동 잡 준비 완료 |
| 02:40~03:20 | ECR/EKS 파이프라인 검증 | 수동 잡 5개 성공 |
| 03:20~04:00 | Budget/알람 설정 | 월 예산 경보 발송 확인 |
| 04:00~05:00 | 인계 문서/체크리스트 공유 | 내일 대체 작업 가능 상태 |

## 3. IAM 권한 모델 (권장)

### 3-1. 그룹 구성
- `tutum-platform-admin`
- `tutum-cicd-operator`
- `tutum-observability-readonly`
- `tutum-readonly`

### 3-2. 그룹별 권한
- `tutum-platform-admin`
  - 초기: `AdministratorAccess` (프로젝트 안정화 후 축소 예정)
  - 추가: `IAMUserChangePassword`
- `tutum-cicd-operator`
  - `AmazonEC2ContainerRegistryPowerUser`
  - `TutumGitlabCiEKSReadOnly` (customer policy, `eks:DescribeCluster` 포함)
  - `CloudWatchReadOnlyAccess`
- `tutum-observability-readonly`
  - `CloudWatchReadOnlyAccess`
  - `CloudWatchLogsReadOnlyAccess`
  - `AWSXRayReadOnlyAccess`
- `tutum-readonly`
  - `ReadOnlyAccess`

### 3-3. 사용자 생성 규칙
- 사용자명: `tutum-<name>`
- Console access: 활성화
- 비밀번호: 첫 로그인 시 변경 강제
- MFA: 가상 MFA 필수
- Access key:
  - 사람 계정: 기본 비활성
  - CI 계정만 예외 허용

## 4. GitLab CI 전용 IAM (필수)

### 4-1. 사용자
- `tutum-gitlab-ci`

### 4-2. 최소 권한 (ECR + EKS 점검용)
- ECR: 로그인/레포 생성/이미지 푸시/조회/정리
- EKS: `DescribeCluster`, `ListNodegroups`, `DescribeNodegroup`
- STS: `GetCallerIdentity`

### 4-3. GitLab CI/CD Variables
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_DEFAULT_REGION=ap-northeast-2`
- `AWS_ACCOUNT_ID=903913341620`
- `ECR_REGISTRY=903913341620.dkr.ecr.ap-northeast-2.amazonaws.com`
- `ECR_REPOSITORY_BACKEND=tutum/backend`
- `ECR_REPOSITORY_FRONTEND=tutum/frontend`
- `ECR_REPOSITORY_WORKERS=tutum/workers`
- `EKS_CLUSTER_NAME_STG=tutum-stg-eks`
- `EKS_CLUSTER_NAME_PROD=tutum-prd-eks`

모두 `Masked + Protected` 권장.

## 5. 콘솔 작업 순서 (실행 메뉴 기준)

1. AWS Console -> IAM -> Users -> Add users
2. AWS Console -> IAM -> User groups -> 그룹 생성 + 정책 연결
3. 각 사용자 그룹 할당
4. IAM -> Users -> Security credentials -> MFA 등록
5. CI 사용자 Access key 생성 (CLI 용도)
6. GitLab -> Settings -> CI/CD -> Variables 등록
7. GitLab Pipeline 수동 실행:
   - `aws:precheck`
   - `aws:ecr-bootstrap`
   - `aws:ecr-push-check`
   - `aws:eks-cluster-check`
   - `aws:eks-kubectl-smoke`

## 6. 예산/알람 최소 세팅
- AWS Budgets:
  - 월 예산: `700 USD` (warning), `850 USD` (critical)
  - 알림 채널: 이메일 + (가능하면) SNS -> Slack 연동
- CloudWatch:
  - EKS/EC2 비용 급증 감지용 기본 알람 1개 이상

## 7. 내일 부재 대비 인계 템플릿
- 플랫폼 담당: EKS 상태 확인, 노드그룹 상태 공유
- CI/CD 담당: ECR push/배포 파이프라인 상태 확인
- 모니터링 담당: CloudWatch/Budget 알람 수신 확인
- 공통: 권한 이슈 발생 시 IAM 그룹 정책 변경 이력 기록

## 8. 최종 체크리스트
- [x] 팀원 콘솔 로그인 성공
- [x] 팀원 MFA 등록 완료
- [x] CI 변수 등록 완료
- [x] `aws:precheck` 성공
- [x] `aws:ecr-bootstrap` 성공
- [x] `aws:ecr-push-check` 성공
- [x] `aws:eks-cluster-check` 성공
- [x] `aws:eks-kubectl-smoke` 성공
- [x] Budget 알람 활성화
- [x] 팀 채널에 인계 공지 완료

## 9. 2026-03-05 최종 참조
- 확정 설정: `docs/ruby/aws_settings/2026-03-05_confirmed_settings.md`
- 실행 결과: `docs/ruby/2026-03-04_AWS_EXECUTION_RESULT.md`

