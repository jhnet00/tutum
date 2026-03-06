# AWS Migration 오늘 3시간 단독 실행 지시서 (Phase 9 기준)

- 작성일: 2026-03-04
- 작성자: Ruby Kim
- 기준 문서: `docs/plans/infra/AWS_MIGRATION_PLAN_2026-03-03.md` (특히 9번 단계별 실행)
- 운영 원칙: GitLab only, EKS + ECR, LGTM 분리 운영
- 멘토링 피드백(`docs/feedback/03.04_mentoring.md`)은 **오늘은 참고만** 하고 본 문서는 AWS 마이그레이션 선행 작업에 집중
- 문서 우선순위: **기준 문서 > 본 런북** (충돌 시 기준 문서 내용 우선)
- 레지스트리 정책: AWS 배포 경로는 **ECR 고정** (`develop/main -> ECR -> EKS`)
- 재시작 지점(2026-03-05): `aws:precheck`, `aws:ecr-bootstrap`, `aws:ecr-push-check` 완료
- 추가 검증 단계: `aws:eks-cluster-check` -> `aws:eks-kubectl-smoke` 수동 실행 완료(2026-03-05)
- 오늘 권한 세팅 실행 문서: `docs/ruby/2026-03-05_AWS_CONSOLE_TEAM_ACCESS_5H_RUNBOOK.md`
- 참고: EKS 클러스터 미생성 시 `aws:eks-cluster-check` 실패가 정상이며, 현재는 stg/prod 클러스터 생성 완료 상태다.
- 선행 조건: `EKS_CLUSTER_NAME_STG`, `EKS_CLUSTER_NAME_PROD` 변수 등록 및 스코프 확인

## 진행 상태 (2026-03-05 기준)

- [x] Step 1: AWS 실행 환경 점검 완료 (`aws:precheck` 성공)
- [x] Step 2: ECR 준비/검증 완료 (`aws:ecr-bootstrap`, `aws:ecr-push-check` 성공)
- [x] Step 3: GitLab CI 변수 정의/등록표 확정
- [x] Step 4: Session Manager 정책 초안 문서화
- [x] Step 5: VPC/CIDR 설계값 확정 기록
- [x] Step 6: 실행 결과 문서 작성
- [x] 추가 검증 1: `aws:eks-cluster-check` 실행 로그 캡처 후 실행 결과 문서 반영 완료
- [x] 추가 검증 2: `aws:eks-kubectl-smoke` 실행 로그 캡처 후 실행 결과 문서 반영 완료

## 즉시 실행 최소 조건 (필수 2개)

1. STG/PROD EKS 클러스터 + 노드그룹 생성 (`tutum-stg-eks`, `tutum-prd-eks`)
2. GitLab 변수 등록: `EKS_CLUSTER_NAME_STG`, `EKS_CLUSTER_NAME_PROD`

## 실행 환경 기준 (반드시 먼저 확인)

- 기본 실행 위치: **GitLab Runner (`tags: [k8s]`)**
  - AWS 관련 명령은 로컬 PC/개인 VM보다 CI runner에서 실행
  - 자격증명은 GitLab CI Variables로 주입
  - 실행 이력(로그)이 GitLab에 남아 추적 가능
- Host OS(Windows)는 **fallback(긴급 확인용)** 으로만 사용
- cp-3(192.168.0.222)는 본 런북 기준 실행 위치가 아님
  - cp-3는 K8s 운영 점검/배포 확인 용도
  - AWS 리소스 생성 커맨드는 runner 기준 수행

| Step | 작업 | 실행 위치 |
|---|---|---|
| Step 1 | AWS 실행 환경 점검 | **GitLab Runner (manual job)** |
| Step 2 | ECR 준비 및 검증 | **GitLab Runner (manual job)** |
| Step 3 | GitLab CI 변수 정의서 확정 | **GitLab Web UI** |
| Step 4 | Session Manager 정책 초안 | 문서화(로컬/러너 무관) |
| Step 5 | VPC/CIDR 설계 확정 기록 | 문서화(로컬/러너 무관) |
| Step 6 | 마무리 산출물 정리 | 문서화(로컬/러너 무관) |

### Access Key 유형 선택 기준 (AWS 콘솔 안내 문구)

- AWS 콘솔에서 Access Key 생성 시 `CLI`, `Application running on AWS service` 같은 항목은
  **권한이 다른 키를 만드는 옵션이 아니라 사용 목적 가이드**에 가깝다.
- 현재 우리 구조(온프레 K8s GitLab Runner)에서는
  `CLI` 또는 `Other` 성격으로 발급한 IAM User 키를 CI 변수에 넣어 쓰면 된다.
- `Application running on EC2`는 보통 **EC2 Instance Role 사용 권장 안내**이며,
  우리처럼 AWS 외부 Runner에서는 해당 선택이 실질 이점을 주지 않는다.

### Runner에서 명령이 실행되는 “터미널” 정의

- 본 문서의 AWS 명령은 **개인 PC 터미널에서 직접 실행하는 것이 아니라**,
  GitLab Pipeline의 manual job 안 `script`에서 실행된다.
- 실제 실행 위치:
  - GitLab Runner가 띄운 임시 컨테이너(예: `amazon/aws-cli` 이미지) 내부 쉘
- 사용자가 보는 화면:
  - GitLab UI > CI/CD > Pipelines > Job 로그
- 즉, 별도의 SSH 접속 터미널(cp-3/master node)은 기본적으로 필요 없다.

---

## 0. 오늘 목표 (3시간)

오늘 혼자 완료 가능한 범위:
1. AWS 계정/CLI/권한 기본 점검
2. ECR 리포지토리 생성 및 푸시 권한 검증
3. GitLab CI 변수 설계/등록 체크리스트 확정
4. Session Manager 기반 접속 정책 초안(SSH 22 비허용 원칙)
5. VPC/CIDR 설계 값 확정 기록 (팀 공유용)

오늘 제외(팀 협업 필요):
- 실제 EKS 생성/ArgoCD 연동
- StrongSwan 터널 실연결
- 서비스 트래픽 전환/배포 cutover

---

## 1. 타임박스 계획 (총 180분)

| 시간 | 작업 | 완료 기준 |
|---|---|---|
| 00:00~00:20 (20m) | 환경/권한 사전점검 | AWS CLI 정상, 계정 식별 성공 |
| 00:20~01:00 (40m) | ECR 생성 + 로그인/푸시 사전검증 | ECR repo 목록 확인, auth 토큰 확인 |
| 01:00~01:35 (35m) | GitLab CI 변수 정의/등록표 작성 | 변수 목록/용도/보안레벨 문서화 |
| 01:35~02:10 (35m) | Session Manager 보안정책 초안 | SSH 미사용 정책 + IAM/SG 조건 정리 |
| 02:10~02:40 (30m) | VPC/CIDR/서브넷 설계 확정 메모 | CIDR 충돌 없음 확인표 작성 |
| 02:40~03:00 (20m) | 산출물 정리 및 내일 TODO | 팀 공유 가능한 체크리스트 완성 |

---

## 2. Step-by-Step 실행

## Step 1) AWS 실행 환경 점검 (Runner 기준, 20분)

1. GitLab CI Variables 확인
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_DEFAULT_REGION=ap-northeast-2`
2. Runner에서 AWS CLI/자격 확인
```bash
aws --version
aws configure list
aws sts get-caller-identity --region ap-northeast-2
```
3. 리전/계정 기준 확인
```bash
aws ec2 describe-availability-zones --region ap-northeast-2 --query "AvailabilityZones[].ZoneName"
```

완료 기준:
- `get-caller-identity`가 `Account`, `Arn` 반환
- runner 환경에서 `ap-northeast-2` 조회 정상

---

## Step 2) ECR 준비 및 검증 (Runner 기준, 40분)

1. 리포지토리 생성 (없으면 생성, 있으면 통과)
```bash
aws ecr create-repository --repository-name tutum/frontend --region ap-northeast-2 || true
aws ecr create-repository --repository-name tutum/backend --region ap-northeast-2 || true
aws ecr create-repository --repository-name tutum/workers --region ap-northeast-2 || true
```
2. 리포지토리 조회
```bash
aws ecr describe-repositories --region ap-northeast-2 --query "repositories[].repositoryName"
```
3. Docker 로그인 토큰 검증
```bash
aws ecr get-login-password --region ap-northeast-2
```
4. (선택) Runner job에 docker:dind 사용 시 로그인 검증
```bash
aws ecr get-login-password --region ap-northeast-2 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-northeast-2.amazonaws.com
```

완료 기준:
- `tutum/frontend`, `tutum/backend`, `tutum/workers` 존재
- 로그인 토큰 발급 성공

---

## Step 3) GitLab CI 변수 정의서 확정 (35분, GitLab UI)

아래 키를 GitLab Project > Settings > CI/CD > Variables에 등록 준비:

| Key | 용도 | Mask/Protected |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | ECR push, AWS API 호출 | Masked + Protected |
| `AWS_SECRET_ACCESS_KEY` | ECR push, AWS API 호출 | Masked + Protected |
| `AWS_DEFAULT_REGION` | 배포 리전 고정 | Protected |
| `AWS_ACCOUNT_ID` | ECR URI 조합 | Protected |
| `ECR_REGISTRY` | `<ACCOUNT>.dkr.ecr.ap-northeast-2.amazonaws.com` | Protected |
| `ECR_REPOSITORY_BACKEND` | `tutum/backend` | Protected |
| `ECR_REPOSITORY_FRONTEND` | `tutum/frontend` | Protected |
| `ECR_REPOSITORY_WORKERS` | `tutum/workers` | Protected |
| `EKS_CLUSTER_NAME_STG` | staging cluster name | Protected |
| `EKS_CLUSTER_NAME_PROD` | production cluster name | Protected |

완료 기준:
- 변수 목록이 표로 정리되고 누락 없음
- 팀원에게 그대로 전달 가능한 상태

---

## Step 4) Session Manager 기반 접속 정책 초안 (35분)

목표:
- EC2 직접 SSH(22) 미사용 원칙 확정
- 운영 접근은 SSM Session Manager로 통일
- 상세 정책 문서: `docs/ruby/aws_settings/2026-03-05_session_manager_access_policy_draft.md`

오늘 작성할 항목:
1. EC2 IAM Role 필수 정책:
   - `AmazonSSMManagedInstanceCore`
2. 보안그룹 원칙:
   - Inbound 22 미개방
   - 필요한 앱 포트만 ALB/내부망에서 허용
3. 접속 절차:
```bash
aws ssm start-session --target <INSTANCE_ID> --region ap-northeast-2
```

완료 기준:
- “SSH 키페어 없이 운영 접근” 절차를 문서로 설명 가능
- STG 1대에서 Session 연결/종료 성공 로그 확인

---

## Step 5) VPC/CIDR 설계 확정 기록 (30분)

기준(문서 합의안):
- EKS VPC: `10.60.0.0/16`
- CI/CD VPC: `10.61.0.0/16`
- On-prem: `192.168.0.0/24`

체크 항목:
1. CIDR 중복 없음 확인
2. Public/Private 서브넷 범위 초안 작성
3. VPC Peering 라우팅 필요 테이블 메모
4. VPN(StrongSwan) 전제조건 메모:
   - UDP 500/4500 허용 필요

완료 기준:
- 네트워크 충돌 없는 설계표 1개 완성
- 내일 팀 협업 시 바로 리뷰 가능한 수준

---

## Step 6) 마무리 산출물 정리 (20분)

오늘 종료 전에 남길 것:
1. 실행 결과 텍스트(성공/실패/보류) 1페이지 요약
2. 내일 팀 협업 필요 항목 분리
3. 실패한 커맨드/이슈를 그대로 기록

권장 파일:
- `docs/ruby/2026-03-04_AWS_EXECUTION_RESULT.md` (새로 생성)

---

## 3. 오늘 바로 쓰는 점검 명령어 모음

```bash
# AWS identity
aws sts get-caller-identity --region ap-northeast-2

# ECR repos
aws ecr describe-repositories --region ap-northeast-2 --query "repositories[].repositoryName"

# region check
aws configure get region

# AZ check
aws ec2 describe-availability-zones --region ap-northeast-2 --query "AvailabilityZones[].ZoneName"
```

---

## 3-1. Runner에서 바로 실행할 임시 Manual Job 예시

> 아래 job은 바로 반영하기보다, 오늘 점검용으로 임시 브랜치에서 실행 권장

```yaml
aws:precheck:
  stage: test
  image: amazon/aws-cli:2.15.44
  tags: [k8s]
  when: manual
  script:
    - aws --version
    - aws sts get-caller-identity --region ${AWS_DEFAULT_REGION}
    - aws ecr describe-repositories --region ${AWS_DEFAULT_REGION} --query "repositories[].repositoryName"
  rules:
    - if: '$CI_COMMIT_BRANCH == "develop"'
```

검증 포인트:
1. 수동 실행 시 runner 로그에 account id 출력
2. ECR repo 목록 조회 성공
3. 권한 오류(`AccessDenied`) 없으면 최소 권한 정상

---

## 4. 내일(팀 작업 시작) 바로 이어갈 항목

1. EKS 클러스터 생성 + ALB Controller
2. ArgoCD staging/prod 동기화 전략 확정
3. StrongSwan VPN 실제 연결 테스트
4. GitLab CI -> ECR -> EKS 배포 테스트
5. 멘토링 피드백 반영(모니터링 지표/보안 발표 포인트 강화)
