# 2026-03-05 AWS 확정 설정 기록

## 1) 운영 방향 확정

| 항목 | 설정 | 이유 | 상태 |
|---|---|---|---|
| 소스/CI-CD | GitLab only | 운영 단일화 및 추적성 확보 | 확정 |
| 레지스트리 운영 | 온프레 경로: GitLab Registry 유지 / AWS 경로: ECR 사용 | 하이브리드 운영 + AWS 배포 경로 분리 | 확정 |
| 운영 모델 | 온프레 + AWS 동시 운영(하이브리드) | 점진 전환보다 안정성/유연성 우선 | 확정 |

## 2) EKS/VPC 생성 규칙 확정

| 항목 | 설정 | 이유 | 상태 |
|---|---|---|---|
| Staging 클러스터명 | `tutum-stg-eks` | 네이밍 일관성 | 확정 |
| Production 클러스터명 | `tutum-prd-eks` | 환경 분리 명확화 | 확정 |
| Staging 노드그룹명 | `ng-stg-general` | 역할 식별 용이 | 확정 |
| VPC | 기존 VPC 재사용 대신 EKS 전용 신규 생성 | 충돌/라우팅 리스크 최소화 | 확정 |
| VPC CIDR 예시 | `10.60.0.0/16` | 서브넷 확장성 확보 | 확정 |
| Subnet 규칙 | 모든 서브넷 CIDR은 VPC CIDR의 부분집합이어야 함 | `CIDR is not a subset of VPC` 오류 방지 | 확정 |
| Public Access CIDR 규칙 | 사설망(`192.168.x.x`) 금지, 공인IP `/32` 사용 | EKS endpoint 접근 규칙 준수 | 확정 |
| NAT 전략 | 비용 우선 시 `Zonal` 1개(1 AZ) | 초기 비용 절감 | 확정 |

## 3) GitLab CI 변수 확정

| Key | 값/형식 | 비고 |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | IAM Access Key | Masked 권장 |
| `AWS_SECRET_ACCESS_KEY` | IAM Secret Key | Masked 권장 |
| `AWS_DEFAULT_REGION` | `ap-northeast-2` | 공통 |
| `AWS_ACCOUNT_ID` | `903913341620` | 공통 |
| `ECR_REGISTRY` | `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com` | 공통 |
| `ECR_REPOSITORY_BACKEND` | `tutum/backend` | ECR |
| `ECR_REPOSITORY_FRONTEND` | `tutum/frontend` | ECR |
| `ECR_REPOSITORY_WORKERS` | `tutum/workers` | ECR |
| `EKS_CLUSTER_NAME_STG` | `tutum-stg-eks`(생성 후 실제명) | 필수 |
| `EKS_CLUSTER_NAME_PROD` | `tutum-prd-eks`(생성 후 실제명) | prod 생성 후 |

주의:
- `develop`이 protected 브랜치가 아니면, 해당 변수 `Protected` 체크 시 잡에서 읽지 못할 수 있음.

## 4) CI 수동 잡 상태

| 잡 이름 | 목적 | 상태 |
|---|---|---|
| `aws:precheck` | AWS 인증/기본 점검 | 완료 |
| `aws:ecr-bootstrap` | ECR repo 생성/조회 | 완료 |
| `aws:ecr-push-check` | ECR 로그인/푸시 스모크 테스트 | 완료 |
| `aws:eks-cluster-check` | EKS 클러스터/노드그룹 상태 점검 | 대기 (클러스터 생성 후 실행) |
| `aws:eks-kubectl-smoke` | kubeconfig 갱신 + `kubectl get nodes` 점검 | 대기 (클러스터 생성 후 실행) |

## 5) 오류 이력 및 원인

| 오류 메시지 | 원인 | 조치 |
|---|---|---|
| `EKS_CLUSTER_NAME_STG is missing` | 변수 미등록 또는 보호/스코프 불일치 | 변수 등록 + 보호 설정 확인 |
| `The CIDR '192.168.0.0/24' is invalid` | Public access CIDR에 사설 대역 입력 | 공인 IP `/32`로 변경 |
| `CIDR is not a subset of the VPC CIDR` | 서브넷 CIDR이 VPC CIDR 밖에 있음 | 서브넷을 VPC 대역 내부로 재설정 |

## 6) 다음 액션

1. AWS 콘솔에서 `tutum-stg-eks` + `ng-stg-general` 생성
2. `EKS_CLUSTER_NAME_STG` 변수 등록
3. GitLab에서 `aws:eks-cluster-check` -> `aws:eks-kubectl-smoke` 실행
4. 실행 결과를 `docs/ruby/2026-03-04_AWS_EXECUTION_RESULT.md`에 반영

