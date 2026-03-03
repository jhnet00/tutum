# AWS Migration Plan 2026-03-03 (EKS + ECR)

작성일: `2026-03-03`

---

## 1. 확정 방향

1. Harbor는 사용하지 않는다.
2. 소스/CI/CD는 GitLab 기준으로 유지한다.
3. AWS 단계의 이미지 저장소는 ECR을 사용한다.
4. 배포 대상은 EKS를 사용한다.
5. 온프레 MinIO는 유지하고, 필요 데이터는 `MinIO -> S3 -> Glacier` 정책으로 관리한다.

---

## 2. 목표 아키텍처

1. 개발/배포
- GitLab Repo + GitLab CI
- Docker build -> ECR push
- k8s-manifests 갱신 -> Argo CD sync -> EKS 반영

2. 런타임
- EKS (Managed Node Group)
- ALB Ingress + AWS WAF
- Route53 + ACM TLS

3. 데이터
- MongoDB, MariaDB (현행 유지 후 단계적 managed 전환 검토)
- Redis, Kafka (현행 구조 유지, 비용/운영성 기준 점진 전환)
- MinIO(온프레) + S3(클라우드) 하이브리드

4. 관측(Observability)
- **LGTM 스택 포함**: `Loki + Grafana + Tempo + Mimir/Prometheus`
- CloudWatch (EKS/ALB 인프라 이벤트, 알람)
- 주요 SLI: API latency, 5xx, queue lag, consumer lag, OCR 실패율

---

## 3. 네트워크/보안 원칙

1. 외부 유입: `Route53 -> ALB -> EKS Ingress`
2. WAF 필수 적용 (managed rule + rate limit)
3. IRSA 기반 최소 권한
4. ECR 이미지 스캔 활성화
5. Secrets Manager + External Secrets Operator 적용 검토
6. Kyverno/NetworkPolicy는 보안 담당자가 진행 중인 정책과 통합

---

## 4. CI/CD 타깃 플로우 (GitLab -> ECR -> EKS)

1. `develop`
- staging 성격
- image tag: `stg-$CI_COMMIT_SHORT_SHA`

2. `main`
- production 성격
- image tag: `prod-$CI_COMMIT_SHORT_SHA`

3. 기본 단계
- `build`: Docker image build
- `scan`: Trivy/SAST
- `push`: ECR push
- `deploy`: manifests image tag 갱신
- `sync`: Argo CD sync

---

## 5. 담당 목록

1. 보안 담당
- IAM/IRSA
- WAF 룰
- Kyverno/NetworkPolicy

2. 플랫폼 담당
- EKS 클러스터/노드 그룹 운영
- ALB Ingress Controller
- 장애 대응 runbook

3. 백엔드 담당
- ECR 기준 이미지/배포 정리
- Secret/Config 분리
- API smoke test

4. 프론트엔드 담당
- ALB/도메인 경로 기준 API 연동 점검
- quick bar/chart/dashboard UI 정리
- OAuth/실데이터 회귀 테스트

5. 데이터 담당
- MinIO -> S3 복제
- S3 lifecycle(Glacier) 정책
- DB 백업/복구 시나리오

---

## 6. 단계별 실행

## Phase A (D+0 ~ D+3): 기반 준비
1. ECR repo 생성
2. GitLab CI 변수 등록
3. EKS 접근 권한/IAM role 정리

## Phase B (D+4 ~ D+7): EKS 구성
1. EKS 생성
2. ALB Controller 구성
3. Argo CD 연동

## Phase C (D+8 ~ D+12): 배포 전환
1. GitLab CI -> ECR push 전환
2. k8s-manifests image 경로 ECR 통일
3. staging E2E 검증

## Phase D (D+13 ~ D+18): 데이터/관측
1. MinIO -> S3 복제 구성
2. S3 lifecycle -> Glacier 적용
3. LGTM + CloudWatch 알람 정리

## Phase E (D+19 ~ D+24): 안정화
1. canary/rollback 리허설
2. 장애 시나리오 점검
3. 운영 문서 확정

---

## 7. 비용 가드레일 (총 900 USD 이하)

1. 월간 비용 상한 관리: `EKS + EC2 + ALB + EBS + S3 + CloudWatch`
2. Spot 혼용(비핵심 워크로드)으로 절감
3. S3 lifecycle로 저장 비용 절감
4. 미사용 자원 정리 자동화(EBS, ELB, NAT)

---

## 8. Done 기준

1. Harbor 관련 항목이 문서/파이프라인/매니페스트에서 제거됨
2. `develop -> ECR(stg) -> EKS` 배포 성공
3. `main -> ECR(prod) -> EKS` 배포 성공
4. OAuth, 시세, 뉴스, OCR, SES, MinIO E2E 통과
5. LGTM 대시보드 + 알람 정책 운영 가능 상태
