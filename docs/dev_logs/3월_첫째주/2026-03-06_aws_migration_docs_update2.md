# 2026-03-06 AWS Migration 문서 2차 보완

## 작업자
박성준

## 작업 배경
1차 수정(VM 8대, MongoDB, ECR, CIDR 등) 이후 토폴로지 다이어그램 검토 및
사용자 추가 요청 사항을 반영하여 DETAIL GUIDE 전면 보강.

---

## 주요 추가/수정 내용

### AWS_MIGRATION_DETAIL_GUIDE.md

#### 신규 추가
1. **A-6 NAT Gateway 생성 + Route Table 설정**
   - A-5 VPC 설계 확정의 CIDR 오류(10.0.0.0/16 → 10.60.0.0/16) 수정
   - NAT GW 생성 CLI + private subnet route table 설정 CLI
   - NAT GW 비용 절감 조건(VPC Endpoints) 안내

2. **B-13 KMS CMK 연동 전면 개선**
   - KMS CMK 생성(`aws kms create-key`) 단계 추가
   - `aws secretsmanager create-secret` 에 `--kms-key-id alias/tutum-secrets-key` 명시
   - IRSA 정책을 SecretsManagerReadWrite(너무 넓음) → 최소 권한 커스텀 정책으로 교체
     - `secretsmanager:GetSecretValue`, `secretsmanager:DescribeSecret` (리소스 범위: tutum/*)
     - `kms:Decrypt`, `kms:DescribeKey` (CMK ARN 기준)
   - ExternalSecret K8s 리소스(SecretStore + ExternalSecret) YAML 추가
   - 흐름 요약: EKS Pod → IRSA → Secrets Manager(VPC Endpoint) → KMS CMK 복호화

3. **B-15 EKS Security Group 구성 (신규)**
   - Cluster SG vs Node SG 역할 구분표
   - EKS → Monitoring EC2 aoutbound(Loki 3100, Tempo 4317/4318, Mimir 9009) 허용 CLI
   - Monitoring EC2 SG 생성 + inbound 규칙(EKS 노드에서 push 포트 허용) CLI
   - SSM outbound 443 허용 CLI
   - Internal LB 불필요 이유 명시(Istio Envoy가 내부 라우팅 담당)

4. **D-5 모니터링 이전 전면 보강**
   - EC2 생성 CLI(`aws ec2 run-instances` + IAM Instance Profile SSM용)
   - Docker + Docker Compose 설치(SSM send-command)
   - docker-compose.yml S3 경유 전송 + `docker compose up -d`
   - Grafana 대시보드 JSON 백업/복원 절차
   - SSM 포트포워딩으로 Grafana 접근
   - Alloy remote_write URL 자동 교체(`sed -i`)

#### 오류 수정
| 위치 | 기존 | 수정 |
|------|------|------|
| B-6 Kyverno cosign policy | `tutum-app/*` | `tutum/*` |
| C-1 CI/CD variables | `tutum-app/backend|frontend|workers` | `tutum/backend|frontend|workers` |
| C-2 Kustomize images | `tutum-app/backend|frontend|workers` | `tutum/backend|frontend|workers` |
| D-5 Alloy remote_write | `http://10.0.4.x:9009` | `http://10.60.11.x:9009` |

#### 체크리스트 추가
- Phase A: NAT Gateway 항목 추가(`[x]`)
- Phase B 미완료-기본: B-15 Cluster SG/Monitoring SG 항목 추가

### AWS_MIGRATION_PLAN_2026-03-03.md

1. **Section 3-5 IAM 보강**
   - Secrets Manager → KMS CMK 암호화 연결 흐름 명시
   - IRSA에 `kms:Decrypt` 필요 명시
   - KMS CMK 용도 분리(`alias/tutum-secrets-key`, EBS, S3, Secrets Manager)
   - ACM `*.tutum.my` 항목 추가(발급 신청 완료, ISSUED 후 ALB annotation 필요)

2. **Section 3-7 추가: Security Groups / 내부 트래픽 설계**
   - Cluster SG / Monitoring EC2 SG / MariaDB SG 구분표
   - Internal ALB/NLB 불필요 이유 상세 설명
   - 실제 트래픽 흐름: 인터넷 → ALB(External) → Istio Envoy → Pod
   - `internal-elb` subnet 태그는 향후 예약 태그임을 명시

3. **기존 3-7 이미지 보안 → 3-8로 번호 변경**

---

## 확인된 문서 완전성

| 항목 | 상태 |
|------|------|
| ACM Certificate Manager | ✅ B-4, Phase A/E 체크리스트 |
| KMS CMK | ✅ B-13(Secrets Manager용), D-1(S3용) |
| Secrets Manager + KMS 연동 | ✅ B-13 전면 개선, PLAN 3-5 |
| NAT Gateway | ✅ A-6 신규 추가 |
| Cluster SG / Node SG | ✅ B-15 신규 추가 |
| Internal LB (불필요) | ✅ B-15, PLAN 3-7 명시 |
| VPC Endpoints | ✅ B-10 |
| NACL | ✅ B-9 |
| WAF | ✅ B-11 |
| GuardDuty | ✅ B-12 |
