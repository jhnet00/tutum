# Dev Log: AWS Prod EKS / Team Access / ArgoCD 최종 정리 (2026-03-05)

> 날짜: 2026-03-05  
> 작성자: Ruby Kim  
> 브랜치: `develop`  
> 참고: `docs/ruby/2026-03-05_AWS_CONSOLE_TEAM_ACCESS_5H_RUNBOOK.md`, `docs/ruby/2026-03-04_AWS_MIGRATION_PHASE9_SOLO_RUNBOOK.md`

---

## 1. 작업 요약

- 오늘 AWS 마이그레이션 Phase 9 기준으로 GitLab CI 수동 점검 파이프라인을 정리하고, ECR/EKS 연결 검증을 반복 수행했다.
- CI 변수 보호 정책(Protected)과 브랜치/리전 불일치로 발생한 실패를 정리해, `develop`에서 재실행 가능한 상태로 맞췄다.
- ECR smoke push, EKS cluster check, kubectl smoke 단계까지 확인했고, 리전은 서울(`ap-northeast-2`) 기준으로 통일했다.
- 기존 `.gitlab-ci.yml`을 AWS 전용으로 교체하는 실수는 취소하고, 기존 메인 파이프라인을 원복했다.
- 다른 채팅창에서 수행한 ArgoCD 프로덕션 연결 작업은 본 문서 맨 아래 섹션으로 이동해 그대로 보존했다.

## 2. 오늘 Codex 협업 작업(추가 반영)

### 2.1 GitLab CI/AWS 검증 흐름 정리
- 수동 실행 기준 AWS 검증 잡 흐름 점검:
  - `aws:precheck`
  - `aws:ecr-bootstrap`
  - `aws:ecr-push-check`
  - `aws:eks-cluster-check`
  - `aws:eks-kubectl-smoke`
- `aws:ecr-push-check`에서 Alpine 환경 PEP 668 이슈로 `pip3 install awscli` 실패하던 부분은 `apk add --no-cache aws-cli` 방식으로 정리.
- DinD 준비 지연으로 `Cannot connect to the Docker daemon` 오류가 발생하던 구간은 Docker readiness 대기 로직으로 안정화.

### 2.2 변수/권한/브랜치 정책 이슈 정리
- `AWS_ACCESS_KEY_ID is missing` 오류 원인:
  - GitLab Variable이 Protected이고 `develop`이 protected branch가 아니었던 상태.
- 조치:
  - 테스트 단계에서는 해당 변수 보호 범위를 조정하거나 브랜치 정책과 일치하도록 재설정.
- `EKS_CLUSTER_NAME_STG is missing` 오류 원인:
  - 클러스터명 변수 미등록/오타.
- 조치:
  - EKS 클러스터 생성 후 실제 이름으로 변수 재등록.

### 2.3 AWS 리전 불일치 이슈 정리
- `No cluster found for name: tutum-stg-eks` 원인:
  - 클러스터/리소스를 미국 리전에 생성하고, 파이프라인은 서울 리전을 조회한 상태.
- 조치:
  - 리전 기준을 `ap-northeast-2`로 고정하고 재실행.
  - 불필요한 타 리전 리소스 정리 진행.

### 2.4 파이프라인 파일 원복
- 요청에 따라 `.gitlab-ci.yml`은 기존 메인 파이프라인으로 완전 원복.
- AWS 테스트는 기존 파일 구조를 유지한 상태에서 필요한 수동 잡만 사용하는 방향으로 확정.

## 3. 장애/원인/조치 요약

| 구분 | 증상 | 원인 | 조치 |
|---|---|---|---|
| CI Variable | `AWS_ACCESS_KEY_ID is missing` | Protected 변수 + 브랜치 정책 불일치 | 변수 보호 범위/브랜치 정책 재정렬 |
| ECR Push | `pip` 설치 실패 (PEP 668) | Alpine 시스템 패키지 제한 | `apk add --no-cache aws-cli` 적용 |
| ECR Push | Docker daemon 연결 실패 | DinD 준비 전 docker 명령 실행 | readiness wait 추가 |
| EKS Check | `No cluster found` | 리전 불일치 (US/Seoul) | 서울 리전으로 통일 |
| CI Config | 파이프라인 구조 붕괴 위험 | `.gitlab-ci.yml` AWS 전용 치환 시도 | 즉시 원복 |

## 4. 검증 결과

- [x] AWS precheck 수동 실행 성공
- [x] ECR bootstrap/repository 확인
- [x] ECR smoke push 성공(임시 태그 push/검증)
- [x] 리전 정합성 수정 후 EKS 조회 성공
- [x] 기존 `.gitlab-ci.yml` 원복 완료
- [ ] 프로덕션 앱 전체 기능 레벨 최종 점검(서비스별)

## 5. 오늘 반영 문서/산출물

- `docs/ruby/aws_settings/2026-03-05_confirmed_settings.md` (설정 기준 기록)
- `docs/ruby/aws_settings/README.md` (설정 문서 인덱스)
- 본 로그 파일에 Codex 협업 내역 추가 통합

## 6. 후속 작업 (다음 세션 우선순위)

1. 서울 리전 기준 EKS/NodeGroup/IAM Access Entry 최종 캡처 및 운영체크리스트 확정
2. GitLab CI에서 ECR Push -> EKS Smoke까지 재현 가능한 실행 순서 스냅샷 정리
3. ArgoCD production 앱 Health `Healthy` 확인 후 서비스별 smoke 테스트
4. AWS migration 문서(`AWS_MIGRATION_PLAN_2026-03-03.md`)와 실제 설정값 동기화

## 7. 메모

- IAM은 개인 사용자와 CI 사용자(예: `tutum-gitlab-ci`)를 분리 운영하는 방향으로 확정.
- 테스트 속도 이슈로 파이프라인 전체 자동화를 무리하게 확장하지 않고, 수동 게이트 중심으로 단계 검증.
- GitLab/GitHub 혼용 없이 GitLab 기준 소스/레지스트리/CI 운영 원칙 유지.

---

## 8. ArgoCD 프로덕션 최종화

- 운영 EKS(`tutum-prd-eks`) 생성 및 Access Entry/노드그룹 설정 진행.
- `argocd`에서 `tutum-prd-eks` 클러스터를 등록.
- `tutum-production` 목적지 서버를 `in-cluster`에서 prod EKS API로 전환.
- `Manual Sync` 기준으로 prod 배포 동기화 실행.

### 실행 명령 (주요)

```bash
aws configure --profile ruby
aws eks update-kubeconfig --region ap-northeast-2 --name tutum-prd-eks --profile ruby --alias tutum-prd-eks
argocd cluster list
argocd cluster add tutum-prd-eks --kube-context tutum-prd-eks --name tutum-prd-eks --yes
argocd app set tutum-production --dest-server https://2D522A207493F13377B8D32660928341.gr7.ap-northeast-2.eks.amazonaws.com
argocd app set tutum-production --sync-policy none
argocd app sync tutum-production
```

### 결과

- ArgoCD Cluster: `tutum-prd-eks` 등록 확인
- Application destination: `tutum-production`이 prod EKS 엔드포인트를 바라보도록 수정
- `argocd app sync tutum-production` 성공
- 기본 리소스(Deployment, Service, Secret, Namespace) 생성 확인
