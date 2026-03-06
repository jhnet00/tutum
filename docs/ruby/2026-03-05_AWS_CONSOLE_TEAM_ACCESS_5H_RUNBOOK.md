# 2026-03-05 AWS 콘솔 팀 권한 세팅 5시간 런북

## 0. 목적
- 팀원들이 AWS 콘솔에서 직접 작업 가능한 최소 권한/접근 체계를 하루 안에 완료한다.
- GitLab CI -> ECR -> EKS 점검 파이프라인을 실행 가능한 상태로 만든다.
- 내일 부재 상황에서도 팀이 이어서 운영할 수 있게 인계 문서를 확정한다.

기준 문서:
- `docs/ruby/2026-03-04_AWS_MIGRATION_PHASE9_SOLO_RUNBOOK.md`

---

## 1. 오늘 완료 기준 (Done)
1. 팀원 콘솔 계정 생성 + MFA 적용 완료
2. IAM 그룹/권한 모델 적용 완료
3. GitLab CI 전용 IAM 사용자/권한/변수 등록 완료
4. AWS 검증 파이프라인 5개 성공
   - `aws:precheck`
   - `aws:ecr-bootstrap`
   - `aws:ecr-push-check`
   - `aws:eks-cluster-check`
   - `aws:eks-kubectl-smoke`
5. Budget/알람 최소 구성 완료
6. Session Manager STG 1대 접속 검증 완료

---

## 2. 5시간 타임박스

| 시간 | 작업 | 완료 기준 |
|---|---|---|
| 00:00~00:40 | IAM 기본 보안 세팅 | Root MFA/불필요 Access Key 정리 |
| 00:40~01:50 | 팀원 IAM 사용자/그룹 구성 | 팀원별 콘솔 로그인 + MFA 등록 |
| 01:50~02:40 | GitLab CI IAM/변수 구성 | CI 변수 등록 및 권한 오류 없음 |
| 02:40~03:20 | ECR/EKS 파이프라인 검증 | 수동 잡 5개 성공 |
| 03:20~04:00 | 비용/알람 설정 | Budget 임계치 알림 동작 |
| 04:00~05:00 | 인계 문서 정리 | 내일 대체 작업 가능 상태 |

---

## 3. IAM 권한 모델 (권장)

### 3-1. 그룹 구성
- `tutum-platform-admin`
- `tutum-cicd-operator`
- `tutum-observability-readonly`
- `tutum-readonly`

### 3-2. 그룹별 권한
- `tutum-platform-admin`
  - `AdministratorAccess` (초기 세팅 시)
  - `IAMUserChangePassword`
- `tutum-cicd-operator`
  - `AmazonEC2ContainerRegistryPowerUser`
  - `TutumGitlabCiEKSReadOnly` (커스텀 정책)
  - `CloudWatchReadOnlyAccess`
- `tutum-observability-readonly`
  - `CloudWatchReadOnlyAccess`
  - `CloudWatchLogsReadOnlyAccess`
  - `AWSXRayReadOnlyAccess`
- `tutum-readonly`
  - `ReadOnlyAccess`

### 3-3. 사용자 생성 규칙
- 사용자명: `tutum-<name>`
- Console access 활성화
- 최초 로그인 시 비밀번호 변경 강제
- MFA 필수
- Access Key는 CI 전용 계정만 허용

---

## 4. GitLab CI 전용 IAM (필수)

### 4-1. 사용자
- `tutum-gitlab-ci`

### 4-2. 커스텀 정책: `TutumGitlabCiEKSReadOnly`

필요 액션(최소):
- `eks:DescribeCluster`
- `eks:ListClusters`
- `eks:ListNodegroups`
- `eks:DescribeNodegroup`
- `sts:GetCallerIdentity`

정책 JSON 예시:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EKSReadOnlyForCIPipeline",
      "Effect": "Allow",
      "Action": [
        "eks:DescribeCluster",
        "eks:ListClusters",
        "eks:ListNodegroups",
        "eks:DescribeNodegroup"
      ],
      "Resource": "*"
    },
    {
      "Sid": "STSCallerIdentity",
      "Effect": "Allow",
      "Action": "sts:GetCallerIdentity",
      "Resource": "*"
    }
  ]
}
```

AWS 콘솔에서 생성 방법:
1. IAM -> Policies -> Create policy
2. JSON 탭에 위 내용 붙여넣기
3. Policy name: `TutumGitlabCiEKSReadOnly`
4. Create policy
5. IAM -> User groups -> `tutum-cicd-operator` -> Attach policies에서 연결

CLI로 생성 방법:

```bash
aws iam create-policy \
  --policy-name TutumGitlabCiEKSReadOnly \
  --policy-document file://TutumGitlabCiEKSReadOnly.json
```

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

권장 옵션:
- Masked
- Protected (단, 브랜치 보호 정책과 일치시켜야 함)

---

## 5. 콘솔 작업 순서
1. IAM Users 생성
2. IAM Group 생성 + 정책 연결
3. 사용자 그룹 할당
4. MFA 등록
5. CI 사용자 Access Key 발급 (CLI 용도)
6. GitLab CI 변수 등록
7. 수동 파이프라인 5개 실행
8. Session Manager 접속 검증

---

## 6. 예산/알람 최소 세팅
- AWS Budgets:
  - 경고: `700 USD`
  - 크리티컬: `850 USD`
- 알림 채널:
  - 이메일 필수
  - 가능하면 SNS -> Slack 연동

---

## 7. 내일 부재 대비 인계 템플릿
- 플랫폼 담당: EKS/NodeGroup 상태 점검
- CI/CD 담당: ECR push 및 파이프라인 상태 점검
- 모니터링 담당: Budget/CloudWatch 알람 수신 확인
- 공통: 권한 변경 이력 기록

---

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
- [x] Session Manager 세션 정책(STG 1대) 검증
  - 인스턴스: `i-0eef06d350fae53d3`
  - 명령: `aws ssm start-session --target i-0eef06d350fae53d3 --region ap-northeast-2`
  - 결과: 접속 성공 (`Starting session with SessionId ...`)
- [x] 팀 채널 인계 공지 완료

---

## 9. 최종 참조
- `docs/ruby/aws_settings/2026-03-05_confirmed_settings.md`
- `docs/ruby/2026-03-04_AWS_EXECUTION_RESULT.md`
- `docs/ruby/study/2026-03-05_AWS_PROD_EKS_ARGOCD_STUDY.md`
