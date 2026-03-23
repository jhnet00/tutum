# 2026-03-06 AWS Migration 문서 현행화

## 작업자
박성준

## 작업 배경
SSH로 직접 온프레미스 K8s 클러스터 상태 확인 후 `AWS_MIGRATION_DETAIL_GUIDE.md`,
`AWS_MIGRATION_PLAN_2026-03-03.md` 두 문서를 실제 인프라 기준으로 전면 수정.

---

## 확인한 실제 인프라 상태

### VM 구성 (8대 — 문서에 6대로 잘못 기재되어 있었음)

| VM | IP | 역할 |
|----|-----|------|
| cp-1 | 192.168.0.220 | Control Plane (kubeadm init) |
| cp-2 | 192.168.0.221 | Control Plane |
| cp-3 | 192.168.0.222 | Control Plane |
| worker1 | 192.168.0.223 | App Worker |
| worker2 | 192.168.0.224 | App+Consumer Worker |
| worker3 | 192.168.0.225 | Data Worker |
| monitoring | 192.168.0.230 | LGTM Docker Compose VM |
| mongodb | 192.168.0.231 | MongoDB v7.0.30 standalone |

### K8s 클러스터 (cp-1 kubectl 직접 확인)
- **버전**: v1.29.15 / containerd 1.7.28 / Ubuntu 22.04.5
- **CNI**: Calico (tigera-operator)
- **Istio**: istiod + istio-ingressgateway 둘 다 Running
- **MetalLB**: VIP 192.168.0.240
- **KEDA**: 5 ScaledObject Active (backend/frontend/price/news/elastic consumer)
- **ArgoCD**: tutum-staging(Synced/Healthy), tutum-production(OutOfSync/Healthy)
- **Kyverno**: Enforce 모드, ECR 공개키 적용 완료

### StatefulSet PVC 현황
| 서비스 | replicas | PVC |
|--------|----------|-----|
| MongoDB | 3/3 | 30Gi × 3 (tutum-data) |
| Redis | 3/3 | 5Gi × 3 (Master+2Replica) |
| Kafka | 3/3 | 20Gi × 3 (KRaft) |
| Elasticsearch | 1/1 | 30Gi |
| MinIO | 4/4 | 20Gi × 4 (tutum-storage) |

### Monitoring VM (192.168.0.230) Docker Compose
- Grafana: 3000, Loki: 3100, Tempo: 3200/4317/4318
- Mimir: 9009, InfluxDB: 8086, Kiali: 20001

### MongoDB VM (192.168.0.231)
- MongoDB v7.0.30 (systemd active)
- 앱 연결은 K8s StatefulSet (tutum-data ns) 사용

---

## 수정 내용

### AWS_MIGRATION_DETAIL_GUIDE.md
1. **섹션 0 비교표**:
   - VM 6대 → **8대** (monitoring VM + mongodb VM 추가)
   - 노드 스펙: m5.large ASG → **EKS Auto Mode (Bottlerocket)**
   - 컨테이너 레지스트리: GitLab CR → **ECR 전환 완료** (Phase C)
   - MongoDB: Atlas Cloud(오기재) → **K8s StatefulSet 3-replica + mongodb VM**
   - StorageClass: local-path-provisioner 추가
2. **변경 없는 항목**: MongoDB Atlas 언급 제거, 완료된 항목 명시
3. **A-2 ECR repo 이름**: `tutum-app/*` → **`tutum/*`** (실제 생성 경로)
4. **A-3 이미지 미러링**: 미완료 표시, ECR 경로 수정
5. **B-1 EKS**: 실제 구성 표 추가 (tutum-stg-eks, 10.60.0.0/16, Auto Mode, API 인증)
6. **B-3 Istio**: 완료 표시, 실제 설치 방법 반영
7. **B-4 ALB**: 완료 표시, 실제 클러스터명 반영
8. **B-5 KEDA**: on-prem 현황 표 추가, EKS 미설치 명시
9. **B-7 ArgoCD**: 실제 설치 방법(kubectl apply --server-side) 반영
10. **마이그레이션 로드맵**: Phase별 진행 상태 표시 추가
11. **체크리스트**: 완료/미완료 `[x]`/`[ ]` 전면 갱신

### AWS_MIGRATION_PLAN_2026-03-03.md
1. **VPC 다이어그램**: 10.0.0.0/16 → **10.60.0.0/16**, 실제 서브넷 구조 반영
2. **MSA 서비스 표**: 현재 상태 컬럼 추가 (Running/replica/PVC 정보)
3. **비용 표**: Auto Mode 기반 재산정, tutum-prd-eks 추가 비용 안내
4. **단계별 실행**: 각 Phase 완료/미완료 항목 ✅/⬜ 표시

---

## 주요 발견 사항 (문서 오기재 목록)

| 항목 | 기존 문서 | 실제 |
|------|----------|------|
| VM 수 | 6대 | **8대** |
| MongoDB | Atlas Cloud | **K8s StatefulSet 3-replica + VM(231)** |
| ECR 경로 | tutum-app/* | **tutum/*** |
| VPC CIDR | 10.0.0.0/16 | **10.60.0.0/16** |
| EKS 노드 | m5.large MNG | **Auto Mode (Bottlerocket)** |
| EKS 클러스터명 | tutum-eks | **tutum-stg-eks / tutum-prd-eks** |
| Registry | GitLab CR (현재) | **ECR 전환 완료 (Phase C)** |
