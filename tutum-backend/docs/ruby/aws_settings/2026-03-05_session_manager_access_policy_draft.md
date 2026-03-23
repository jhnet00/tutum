# 2026-03-05 Session Manager 기반 접속 정책 초안

## 1) 목적과 적용 범위
- 목적: 운영 접근 경로를 SSH(22)에서 Session Manager(SSM)로 일원화한다.
- 핵심 원칙:
  - EC2 Inbound `22/3389` 미개방
  - 사람 계정 Access Key 최소화
  - 세션 로그/감사 추적(CloudWatch, S3, CloudTrail) 유지
- 적용 대상: AWS 계정(`903913341620`) 내 운영 EC2(유틸리티/운영 점검 인스턴스)
- 비대상: 온프레 Kubernetes 노드(`cp-*`, `worker*`)

## 2) 선행 조건

### 2-1. 인스턴스 측
- EC2 IAM Role(Instance Profile)에 `AmazonSSMManagedInstanceCore` 부착
- SSM Agent 실행 상태 정상
- 네트워크 경로:
  - 인터넷 경유 시: NAT/IGW를 통한 `443` 아웃바운드
  - Private Subnet-only 시: VPC Interface Endpoint 3종 필수
    - `com.amazonaws.ap-northeast-2.ssm`
    - `com.amazonaws.ap-northeast-2.ssmmessages`
    - `com.amazonaws.ap-northeast-2.ec2messages`

### 2-2. 운영자 측
- IAM 사용자/역할에 Session Manager 접속 권한 부여
- CLI 사용 시 로컬에 Session Manager Plugin 설치

## 3) IAM 권한 모델 (초안)

### 3-1. 인스턴스 역할(필수)
- Managed Policy: `AmazonSSMManagedInstanceCore`

### 3-2. 운영자 권한(권장: 커스텀 정책)
- 최소 액션:
  - `ssm:StartSession`
  - `ssm:TerminateSession`
  - `ssm:ResumeSession`
  - `ssm:DescribeSessions`
  - `ssm:DescribeInstanceInformation`
  - `ec2:DescribeInstances`
- 리소스 스코프:
  - 기본: 특정 태그가 있는 인스턴스로 제한(`Access=SessionManager`)
  - 문서: AWS 기본 Session 문서만 허용

예시 정책(JSON):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DescribeForSession",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ssm:DescribeInstanceInformation",
        "ssm:DescribeSessions"
      ],
      "Resource": "*"
    },
    {
      "Sid": "SessionToTaggedInstancesOnly",
      "Effect": "Allow",
      "Action": [
        "ssm:StartSession",
        "ssm:TerminateSession",
        "ssm:ResumeSession"
      ],
      "Resource": [
        "arn:aws:ec2:ap-northeast-2:903913341620:instance/*",
        "arn:aws:ssm:ap-northeast-2::document/AWS-StartInteractiveCommand",
        "arn:aws:ssm:ap-northeast-2::document/AWS-StartPortForwardingSession",
        "arn:aws:ssm:ap-northeast-2::document/AWS-StartSSHSession"
      ],
      "Condition": {
        "StringEquals": {
          "ssm:resourceTag/Access": "SessionManager"
        }
      }
    }
  ]
}
```

## 4) 네트워크/보안그룹 기준
- 인스턴스 SG:
  - Inbound: `22/tcp`, `3389/tcp` 금지
  - Inbound: 앱 포트만 ALB SG 또는 내부망 SG에서 허용
  - Outbound: `443/tcp` 허용(SSM endpoint/NAT 경유)
- Endpoint SG(Private Subnet 운영 시):
  - Inbound `443/tcp` from 인스턴스 SG

## 5) 운영 절차 (콘솔/CLI)

### 5-1. 콘솔
1. EC2 대상 인스턴스에 IAM Role 연결(`AmazonSSMManagedInstanceCore` 포함)
2. 인스턴스 태그 추가: `Access=SessionManager`
3. Systems Manager > Fleet Manager/Managed instances에서 노출 확인
4. Systems Manager > Session Manager > Preferences에서 로그 경로 설정
   - CloudWatch Log Group 예시: `/tutum/ssm/session`
   - S3 Bucket 예시: `tutum-ssm-session-logs`
5. 테스트 세션 1회 실행 후 종료

### 5-2. CLI
```bash
# 대상 인스턴스가 SSM 관리 대상으로 잡혔는지 확인
aws ssm describe-instance-information \
  --region ap-northeast-2 \
  --query "InstanceInformationList[].{InstanceId:InstanceId,PingStatus:PingStatus,PlatformName:PlatformName}"

# 태그 기준 대상 인스턴스 확인
aws ec2 describe-instances \
  --region ap-northeast-2 \
  --filters "Name=tag:Access,Values=SessionManager" "Name=instance-state-name,Values=running" \
  --query "Reservations[].Instances[].InstanceId"

# 세션 시작
aws ssm start-session --target <INSTANCE_ID> --region ap-northeast-2
```

## 6) 감사/로그 기준
- CloudTrail: `StartSession`, `TerminateSession` 이벤트 추적
- Session log:
  - CloudWatch Logs + S3 동시 저장 권장
  - 보관기간 예시: 90일(운영 정책에 맞춰 조정)

## 7) 완료 기준 (Definition of Done)
- 대상 EC2가 `Managed instances`에 정상 표시
- 운영자 계정으로 Session 연결/종료 성공
- Inbound 22/3389 미개방 상태 확인
- 세션 로그가 CloudWatch/S3 중 최소 1곳 이상 저장 확인

## 8) 롤아웃 순서
1. STG 대상 1대에서 우선 검증
2. 운영팀 계정 1개로 권한 최소범위 점검
3. 로그 적재 확인 후 PROD 확장
4. SSH Security Group 규칙 제거(예외 인스턴스 없을 때)
