# AWS Migration 세부 기술 가이드 작성

**날짜**: 2026-03-05
**작업자**: 박성준
**브랜치**: develop

---

## 작업 개요

기존 `AWS_MIGRATION_PLAN_2026-03-03.md`의 세부 구현 가이드로서
`AWS_MIGRATION_DETAIL_GUIDE.md`를 **온프레미스 K8s → AWS EKS 마이그레이션 중점**으로 전면 재작성.

기존 문서는 AWS 리소스 셋업 중심이었으나,
**현재 운영 중인 VirtualBox K8s 클러스터에서 어떻게 이전하는가**에 초점을 맞춰 재구성.

---

## 주요 내용

### 현재 상태 vs 이전 후 상태 비교표

| 항목 | 온프레미스 | EKS 이전 후 |
|------|-----------|------------|
| K8s | VirtualBox VM 6대 (kubeadm) | EKS 관리형 |
| Registry | GitLab CR | ECR |
| Ingress | MetalLB + Istio GW | ALB |
| MinIO | 4-pod StatefulSet | S3 |
| Elasticsearch | Node3 Docker | EC2 Docker (CI/CD VPC) |
| 모니터링 | 192.168.0.230 Docker Compose | EC2 Docker Compose |

변경 없는 항목:
- MongoDB Atlas (이미 클라우드)
- MariaDB 211.46.52.153:15432 (공인 IP 직접 접속, VPN 불필요)
- Cloudflare Tunnel (origin URL만 변경)

---

### Phase별 마이그레이션 절차

**Phase A**: 현재 클러스터 리소스 스냅샷 → ECR 리포 생성 → 기존 이미지 ECR 미러링

**Phase B**: EKS 클러스터 생성 → 기존 addon 이식
- Istio (IngressGateway 비활성화, ALB 대체)
- KEDA (ScaledObject 그대로 이식)
- Kyverno + Cosign 재구성 (ECR URI + 새 키)
- ArgoCD (destination을 EKS API server로 변경)
- NetworkPolicy (vpc-cni network policy engine 활성화)

**Phase C**: CI/CD 파이프라인 전환
- `.gitlab-ci.yml` ECR push 전환
- Kustomize 이미지 경로 ECR로 수정
- 스테이징 E2E 검증 (온프레미스와 병행)

**Phase D**: 데이터 이전
- MinIO → S3 (mc mirror, 약 10MB)
- Redis: 캐시 허용 손실 or RDB 이전
- Kafka: 실시간 데이터, 빈 상태 시작
- Elasticsearch: S3 스냅샷 → 새 EC2 복원
- 모니터링: Alloy remote_write → 새 EC2 IP

**Phase E**: 트래픽 컷오버
- Cloudflare Tunnel origin → ALB DNS (유일한 사용자-facing 컷오버 포인트)
- 즉각 롤백 가능: origin 되돌리기 (~30초)
- 1주일 병행 운영 후 온프레미스 철수

---

## 수정 파일

| 파일 | 변경 내용 |
|------|---------|
| `docs/plans/infra/AWS_MIGRATION_DETAIL_GUIDE.md` | 전면 재작성 (온프레미스 K8s → EKS 마이그레이션 중점) |
