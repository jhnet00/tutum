# 개발 로그 작업 요약 (2026-03-13)

## 1. 작업 요약
- 작업 일시: 2026-03-13
- 작업자: 김경윤
- 브랜치: develop
- 작업 목적: AWS 비용 급증 원인을 실제 리소스 기준으로 분석하고, `prod 정리 + staging만 유지 + 미사용 시간 full down` 전략으로 FinOps 절감 구조를 확정했다.

## 2. 상세 변경 사항
- 비용 원인 분석
  - running EC2를 cluster/spot/on-demand 기준으로 분류해 실제 비용 기여도를 재정리했다.
  - public DNS, ALB, ArgoCD Application 기준으로 공개 서비스가 `staging`만 사용 중임을 확인했다.
  - `prod`는 공개 트래픽을 받지 않는 별도 클러스터/VPC 비용으로 판단했다.
- 즉시 절감 조치
  - `tutum-prd-eks` 삭제
  - prod VPC `vpc-032e15f57dbd8898b` 삭제
  - prod NAT Gateway 2개 삭제
  - prod CloudWatch EKS log group 삭제
  - 실패 상태였던 staging managed nodegroup `ng-stg-general` 삭제
  - 비용만 발생하던 `t3.medium` 2대 제거
- 운영 절감 구조 반영
  - `scripts/eks-cost-down.sh`를 staging 전용 full down 흐름으로 재정리
  - `scripts/eks-cost-up.sh`를 staging 전용 full up 흐름으로 재정리
  - `scripts/decommission-prod-eks.sh`를 1회성 prod 폐기 스크립트로 추가
- 문서화
  - staging full down 운영 가이드 작성
  - 비용 절감 방향과 실제 리소스 정리 근거를 dev log로 기록

## 3. 작업 중 발생 이슈 및 대응
- 이슈: 비용 화면에서 서비스별 합계만 보이고, 어떤 리소스가 실제 주범인지 바로 식별되지 않았다.
- 대응:
  - AWS CLI로 EKS cluster, EC2 인스턴스, NAT, VPC, EBS, Route53, ALB를 직접 조회해 역산했다.
  - 그 결과 비용 급증 원인은 `staging 다수 노드 + 별도 prod 클러스터 + NAT` 조합으로 정리했다.
- 이슈: `prod`를 유지할지 `staging`을 유지할지 판단이 필요했다.
- 대응:
  - `tutum.my`, `sonar.tutum.my`, `kiali.tutum.my`가 모두 staging ALB를 가리키는지 Route53과 ingress를 통해 확인했다.
  - 현재 공개 데모는 staging만 사용하므로 `prod`를 정리하는 것이 맞다고 결론 냈다.
- 이슈: `prod` 삭제 마지막 단계에서 VPC `DependencyViolation`이 발생했다.
- 대응:
  - NAT, VPC endpoint, ENI, route table, security group 잔존 여부를 다시 조회했다.
  - GuardDuty managed security group까지 제거한 뒤 VPC 삭제를 완료했다.

## 4. 결과
- 실제 구조 확정
  - 운영 방향: `prod 정리`, `staging만 유지`, `안 쓸 때는 full down`
  - 남은 EKS cluster: `tutum-stg-eks` 1개
- 실제 관측 비용
  - AWS Billing 콘솔 스냅샷 기준 `2026-03-13` 3월 누적 비용: `USD 446.03`
  - 사용자 확인 기준 `2026-03-11` 누적 비용: 약 `USD 300`
  - 즉, `2일 사이 약 USD 144`가 추가 발생한 상태에서 분석을 시작했다.
- 비용 주원인 정리
  - 이전 상태 기준: `staging EKS + prod EKS + monitoring EC2`가 함께 비용 발생
  - staging은 다수의 on-demand/spot 노드가 혼재했고, prod는 공개 트래픽 없이 별도 비용만 발생
- 정리 전 추정 런레이트
  - 정리 전 전체 인프라 기준 일일 비용은 대략 `USD 75~80/day`로 추정했다.
  - 해석:
    - EKS worker EC2 다수
    - EKS control plane 2개
    - NAT Gateway 3개
    - gp3 EBS 약 `1713 GiB`
    - RDS, CloudWatch, ALB, WAF, Route53
    가 함께 누적되는 구조였다.
- 실제 절감 조치 검증
  - `aws eks list-clusters --region ap-northeast-2` -> `tutum-stg-eks`만 남음
  - `aws ec2 describe-vpcs --vpc-ids vpc-032e15f57dbd8898b` -> `InvalidVpcID.NotFound`
  - `aws ec2 describe-instances --filters Name=tag:kubernetes.io/cluster/tutum-prd-eks,...` -> 빈 결과
  - `aws ec2 describe-nat-gateways --filter Name=vpc-id,Values=vpc-032e15f57dbd8898b` -> prod NAT 상태 `deleted`
  - `aws eks describe-nodegroup --cluster-name tutum-stg-eks --nodegroup-name ng-stg-general` -> `ResourceNotFoundException`
- 현재 상태 기준 런레이트
  - 현재 남은 인프라 기준 계산값:
    - EC2: 약 `USD 24.01/day`
    - gp3 EBS(약 `1233 GiB`): 약 `USD 3.75/day`
    - RDS MariaDB Multi-AZ: 약 `USD 1.25/day`
    - EKS control plane 1개: 약 `USD 2.40/day`
    - NAT Gateway 1개: 약 `USD 1.49/day`
    - Public IPv4 3개 기준: 약 `USD 0.36/day`
  - 합계 추정: 약 `USD 33.26/day`
- full down 운영 시 추정 런레이트
  - full down 시 worker EC2와 monitoring EC2가 대부분 내려가므로, 남는 비용은 주로 아래다.
    - data PVC 성격 gp3 약 `195 GiB` -> 약 `USD 0.59/day`
    - RDS -> 약 `USD 1.25/day`
    - EKS control plane 1개 -> 약 `USD 2.40/day`
    - NAT Gateway 1개 -> 약 `USD 1.49/day`
    - ALB / WAF / Route53 / CloudWatch 등 잔존비 -> 약 `USD 1~3/day`
  - 합계 추정: 약 `USD 7~9/day`
- 절감 효과 정리
  - 정리 전 `USD 75~80/day`
  - 현재 상시 유지 `USD 33.26/day`
  - full down 운영 시 `USD 7~9/day`
  - 즉,
    - 이번 정리만으로 약 `USD 42~47/day` 절감
    - full down 운영까지 적용하면 정리 전 대비 약 `USD 66~73/day` 절감 가능
  - 목표 운영은 “보여줄 때만 올리고, 그 외에는 내리는 구조”로 정리됨

## 5. 커밋 로그
```bash
# FinOps 로그 작성 시점 기준 별도 commit / push 미진행
git log --oneline --since="2026-03-13 00:00:00" --until="2026-03-13 23:59:59"
```

## 6. 후속 작업/리스크
- full down을 해도 비용이 0이 되지는 않는다.
  - staging EKS control plane
  - staging NAT
  - EBS/PVC
  - RDS
  - ALB, Route53, WAF, CloudWatch
  는 계속 남는다.
- 절감 효과를 안정적으로 누리려면 실제 운영 프로세스에 `full down / full up` 실행 시점을 넣어야 한다.
- 첫 주는 수동 실행으로 복구 시간과 누락 리소스를 확인하고, 그 뒤에 자동화 여부를 결정하는 것이 안전하다.
