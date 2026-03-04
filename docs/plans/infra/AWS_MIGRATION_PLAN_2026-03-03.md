# AWS Migration Plan 2026-03-03 (EKS + ECR)

작성일: `2026-03-03`
최종 수정: `2026-03-04` (리스크 분석 및 Phase 일정 보완)

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
- Docker build → ECR push
- k8s-manifests 갱신 → Argo CD sync → EKS 반영

2. 런타임
- EKS (Managed Node Group)
- ALB Ingress + AWS WAF
- Route53 + ACM TLS
- **Istio 유지 여부**: EKS 전환 시 Istio IngressGateway는 제거하고 ALB로 대체.
  mTLS/Circuit Breaker 등 Istio 내부 기능은 필요 시 EKS에서 재설치 검토.

3. 데이터
- MongoDB, MariaDB (현행 유지 후 단계적 managed 전환 검토)
- Redis, Kafka (현행 구조 유지, 비용/운영성 기준 점진 전환)
- MinIO(온프레) + S3(클라우드) 하이브리드

4. 관측(Observability)
- **LGTM 스택**: 온프레 Monitoring VM(192.168.0.230)은 EKS VPC에서 접근 불가.
  → EKS 전환 시 LGTM 스택을 EKS 내부(monitoring namespace)로 이전하거나
     Grafana Cloud 등 외부 관리형 서비스로 전환 필요. (Phase D에서 결정)
- CloudWatch (EKS/ALB 인프라 이벤트, 알람)
- 주요 SLI: API latency, 5xx, queue lag, consumer lag, OCR 실패율

---

## 3. 네트워크/보안 원칙

1. 외부 유입: `Route53 → ALB → EKS Ingress`
2. WAF 필수 적용 (managed rule + rate limit)
3. IRSA 기반 최소 권한
4. ECR 이미지 스캔 활성화
5. Secrets Manager + External Secrets Operator 적용 검토
6. Kyverno/NetworkPolicy는 보안 담당자가 진행 중인 정책과 통합
7. **Cosign + Kyverno ECR 재설정 필요**: 현재 on-prem Cosign 키 쌍은 GitLab CR 기준으로 생성됨.
   ECR 전환 시 Cosign 키 재발급 + Kyverno policy의 registry 경로 수정 필요.

---

## 4. 리스크 분석

### R1: MariaDB 네트워크 단절 (최우선 리스크)

| 항목 | 내용 |
|------|------|
| 현황 | MariaDB는 학원 온프레미스 서버(192.168.x.x)에서 운영 중 |
| 문제 | EKS(AWS VPC)에서 학원 내부망으로의 직접 접근 불가 |
| 영향 | 회원가입/로그인(OAuth 포함) 전체 불능 |
| 해결 방안 | ① AWS Site-to-Site VPN으로 온프레→VPC 터널 구성<br>② MariaDB를 RDS로 마이그레이션<br>③ MariaDB를 EKS 내부 StatefulSet으로 이전 |
| 결정 필요 | Phase A 시작 전 방향 확정 |

### R2: Monitoring VM 접근 불가

| 항목 | 내용 |
|------|------|
| 현황 | LGTM 스택(Grafana/Loki/Tempo/Mimir)이 192.168.0.230에서 운영 |
| 문제 | EKS에서 해당 VM으로 메트릭/로그/트레이스 전송 불가 |
| 영향 | 관측성 전면 손실 |
| 해결 방안 | ① LGTM을 EKS monitoring namespace로 이전 (Helm)<br>② Grafana Cloud 사용 (무료 티어 한계 확인 필요)<br>③ VPN 터널 구성 후 기존 VM 유지 |
| 결정 필요 | Phase D 시작 전 방향 확정 |

### R3: Cosign + Kyverno ECR 재설정

| 항목 | 내용 |
|------|------|
| 현황 | Cosign 키가 GitLab CR(`registry.gitlab.com`) 기준으로 설정됨 |
| 문제 | ECR(`*.dkr.ecr.ap-northeast-2.amazonaws.com`)으로 변경 시 Kyverno verifyImages 정책 경로 불일치 |
| 영향 | 미서명 이미지 배포 차단 정책 무력화 또는 모든 배포 실패 |
| 조치 | Phase C에서 Cosign 재서명 + Kyverno policy registry 경로 수정 |

### R4: ALB + Istio 관계 정리

| 항목 | 내용 |
|------|------|
| 현황 | on-prem에서는 MetalLB → Istio IngressGateway → 서비스 구조 |
| EKS 방향 | ALB Ingress Controller가 외부 트래픽 수신, Istio는 내부 서비스 메시 역할만 담당 |
| 구성 | `Route53 → ALB → K8s Service → (Istio sidecar) → Pod` |
| 주의 | Istio IngressGateway 제거 시 VirtualService/Gateway 리소스 정리 필요 |

### R5: 비용 900 USD 실현 가능성

| 항목 | 예상 월 비용(USD) |
|------|-----------------|
| EKS Control Plane | ~72 |
| EC2 (m5.large × 3, On-Demand) | ~315 |
| EC2 Spot 혼용 시 절감 | ~-100 |
| ALB | ~20 |
| EBS (gp3 200GB) | ~16 |
| NAT Gateway | ~45 |
| S3 + Glacier | ~10 |
| ECR | ~5 |
| CloudWatch | ~20 |
| **합계 (Spot 혼용)** | **~403** |

> Spot 혼용 + 불필요 NAT 최소화 시 500 USD 이하 달성 가능. 900 USD는 안전 마진.
> 단, RDS(MariaDB 이전 시) 또는 LGTM EKS 이전(추가 EC2) 비용은 별도 산정 필요.

---

## 5. CI/CD 타깃 플로우 (GitLab → ECR → EKS)

1. `develop`
- staging 성격
- image tag: `stg-$CI_COMMIT_SHORT_SHA`

2. `main`
- production 성격
- image tag: `prod-$CI_COMMIT_SHORT_SHA`

3. 기본 단계
- `build`: Docker image build
- `scan`: Trivy/SAST
- `push`: ECR push (GitLab CR 병행 가능, 전환 기간 중)
- `sign`: Cosign 서명 (ECR 기준 키로 교체 후)
- `deploy`: manifests image tag 갱신
- `sync`: Argo CD sync

---

## 6. 담당 목록

1. 보안 담당
- IAM/IRSA
- WAF 룰
- Cosign 키 재발급 + Kyverno policy 수정 (R3)
- Kyverno/NetworkPolicy

2. 플랫폼 담당
- EKS 클러스터/노드 그룹 운영
- ALB Ingress Controller
- MariaDB 연결 방안 결정 및 구현 (R1)
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
- MinIO → S3 복제
- S3 lifecycle(Glacier) 정책
- DB 백업/복구 시나리오

---

## 7. 단계별 실행

### Phase A (D+0 ~ D+3): 기반 준비
1. ECR repo 생성
2. GitLab CI 변수 등록 (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `ECR_REGISTRY`)
3. EKS 접근 권한/IAM role 정리
4. **MariaDB 연결 방안 확정** (R1 — Phase A에서 결정하지 않으면 Phase C 배포 불가)

### Phase B (D+4 ~ D+7): EKS 구성
1. EKS 생성 (VPC, subnet, node group)
2. ALB Ingress Controller 구성
3. Argo CD 연동 (GitLab repo 연결)
4. Calico 또는 EKS 기본 CNI 기반 NetworkPolicy 적용
5. **Istio 제거 또는 축소 여부 결정** (R4)

### Phase C (D+8 ~ D+12): 배포 전환
1. GitLab CI → ECR push 전환
2. Cosign 키 재발급 + Kyverno policy registry 경로 수정 (R3)
3. k8s-manifests image 경로 ECR 통일
4. staging E2E 검증

### Phase D (D+13 ~ D+18): 데이터/관측
1. MinIO → S3 복제 구성
2. S3 lifecycle → Glacier 적용
3. **LGTM 이전 방향 결정 및 구현** (R2): EKS 내부 Helm 설치 or Grafana Cloud
4. CloudWatch 알람 정리

### Phase E (D+19 ~ D+24): 안정화
1. canary/rollback 리허설
2. 장애 시나리오 점검
3. 운영 문서 확정

---

## 8. 비용 가드레일 (총 900 USD 이하)

1. 월간 비용 상한 관리: `EKS + EC2 + ALB + EBS + S3 + CloudWatch`
2. Spot 혼용 (비핵심 워크로드: news-consumer, elastic-consumer 등)으로 절감
3. S3 lifecycle으로 저장 비용 절감
4. 미사용 자원 정리 자동화 (EBS, ELB, NAT)
5. RDS/LGTM EKS 이전 선택 시 비용 재산정 필요 (R1, R2 결정 후)

---

## 9. Done 기준

1. Harbor 관련 항목이 문서/파이프라인/매니페스트에서 제거됨
2. `develop → ECR(stg) → EKS` 배포 성공
3. `main → ECR(prod) → EKS` 배포 성공
4. OAuth, 시세, 뉴스, OCR, SES, MinIO E2E 통과
5. LGTM 대시보드 + 알람 정책 운영 가능 상태
6. MariaDB 연결 정상 (회원/로그인 E2E 포함)
7. Cosign 서명 검증 정상 (Kyverno 미서명 이미지 차단 확인)
