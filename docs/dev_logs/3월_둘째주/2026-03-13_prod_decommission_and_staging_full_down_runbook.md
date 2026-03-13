# 개발 로그 작업 요약 (2026-03-13)

## 1. 작업 요약
- 작업 일시: 2026-03-13
- 작업자: 김경윤
- 브랜치: develop
- 작업 목적: `tutum-prd-eks`와 prod VPC를 정리하고, staging만 남기는 비용 절감 구조로 전환했다. 동시에 staging을 필요할 때만 켜는 `full down / full up` 스크립트를 실제 운영 가능한 형태로 정리했다.

## 2. 상세 변경 사항
- prod 인프라 정리
  - `tutum-prd-eks` 클러스터 삭제
  - prod VPC `vpc-032e15f57dbd8898b` 삭제
  - prod NAT Gateway 2개 삭제
  - prod VPC endpoint 삭제
  - prod CloudWatch log group `/aws/eks/tutum-prd-eks/cluster` 삭제
- staging 비용 낭비 리소스 정리
  - 실패 상태였던 managed nodegroup `ng-stg-general` 삭제
  - 관련 `t3.medium` 2대 제거
- 스크립트 정리
  - `scripts/eks-cost-down.sh`
    - staging context guard 추가
    - `tutum-app`, `tutum-data`, `argocd`, `keda`, `external-secrets`, `kyverno`, `istio`, `kiali`, `gitlab-runner`, `kube-system` 컨트롤러까지 full down 대상에 포함
    - `tutum-monitoring` EC2 stop 옵션 유지
    - `aws.exe`, `kubectl.exe` fallback 지원
  - `scripts/eks-cost-up.sh`
    - full up 시 control-plane 성격 워크로드를 먼저 복구
    - ArgoCD 복구 대기 후 KEDA pause 해제
    - 고정 replica 워크로드를 우선 복구하고 나머지는 ArgoCD self-heal에 맡기도록 정리
    - `aws.exe`, `kubectl.exe` fallback 지원
  - `scripts/decommission-prod-eks.sh`
    - prod 삭제 절차를 재실행 가능한 스크립트로 작성
    - cluster, EC2, NAT, VPC endpoint, subnet, route table, IGW, log group, VPC 삭제 순서 반영
    - `DRY_RUN`과 `CONFIRM_DELETE_PROD` 보호 장치 추가

## 3. 작업 중 발생 이슈 및 대응
- 이슈: prod VPC 삭제 마지막 단계에서 `DependencyViolation` 발생
- 대응:
  - 남은 의존 리소스를 재조회해 route table, subnet, IGW, ENI, VPC endpoint, NAT 상태를 다시 확인했다.
  - GuardDuty managed security group을 별도 삭제했다.
  - NAT 삭제 전파가 끝난 뒤 VPC 삭제를 재시도해 최종 삭제 완료했다.
- 이슈: bash 환경에서 `aws` 명령을 찾지 못하는 경우가 있었다.
- 대응:
  - 스크립트에서 `aws` 대신 `aws.exe`를 자동 탐색하도록 보강했다.
  - `kubectl`도 동일하게 `kubectl.exe` fallback을 추가했다.
- 이슈: 기존 `eks-cost-down/up`은 staging public 서비스가 살아 있는 현재 구조에 비해 대상 범위와 복구 순서가 느슨했다.
- 대응:
  - 현재 staging 실제 상주 컨트롤러 목록을 기준으로 full down/up 흐름을 다시 설계했다.

## 4. 결과
- AWS 검증
  - `aws eks list-clusters --region ap-northeast-2` 결과 `tutum-stg-eks`만 남음
  - `aws eks describe-cluster --name tutum-prd-eks` 결과 `ResourceNotFoundException`
  - `aws ec2 describe-vpcs --vpc-ids vpc-032e15f57dbd8898b` 결과 `InvalidVpcID.NotFound`
  - prod NAT 2개 상태 `deleted`
  - prod CloudWatch log group 조회 결과 없음
- staging 검증
  - `kubectl get ingress -A -o wide` 기준 `tutum.my`, `sonar.tutum.my`, `kiali.tutum.my`는 모두 staging ALB 유지
  - `kubectl get nodepool` 기준 staging NodePool 정상
  - `ng-stg-general` 조회 결과 `ResourceNotFoundException`
- 외부 경로 검증
  - `https://tutum.my/` -> `200`
  - `https://sonar.tutum.my/` -> `200`
  - `https://kiali.tutum.my/kiali/` -> `200`
- 스크립트 검증
  - `bash -n scripts/eks-cost-down.sh`
  - `bash -n scripts/eks-cost-up.sh`
  - `bash -n scripts/decommission-prod-eks.sh`
  - 모두 통과

## 5. 커밋 로그
```bash
# 이번 작업은 아직 commit / push 미진행
git log --oneline --since="2026-03-13 00:00:00" --until="2026-03-13 23:59:59"
```

## 6. 후속 작업/리스크
- `scripts/eks-cost-down.sh`는 실제 실행 시 staging 공개 경로도 같이 내려간다.
- `scripts/eks-cost-up.sh`는 복구에 대략 8분~15분 정도가 걸릴 수 있다.
- full down을 해도 비용이 0이 되지는 않는다.
  - staging EKS control plane
  - staging NAT
  - EBS/PVC
  - RDS
  - ALB, Route53, WAF, CloudWatch
  는 계속 남는다.
- 다음 단계는 실제 미사용 시간에 `full down -> full up`을 한 번 수동 실행해 복구 시간과 누락 리소스를 운영 기준으로 검증하는 것이다.
