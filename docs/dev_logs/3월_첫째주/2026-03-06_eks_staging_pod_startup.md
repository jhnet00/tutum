# 2026-03-06 EKS Staging Pod 기동 작업

## 작업자
박성준

## 작업 내용

ArgoCD로 EKS staging 배포 후 Pod Pending/CrashLoopBackOff 원인 분석 및 수정.

---

## 해결한 이슈들

### 1. nodeSelector 패치 미동작 (nodeSelector: {} → null)
- **원인**: strategic merge patch에서 `nodeSelector: {}`는 빈 맵 merge → 기존 키 유지
- **해결**: `nodeSelector: null`로 변경 → 필드 자체 제거
- **파일**: `k8s-manifests/overlays/staging/remove-nodeselector-patch.yaml`

### 2. EKS 노드가 public subnet에 배치됨
- **원인**: NodeClass subnetSelectorTerms에 NAT GW가 있는 public subnet 포함
  - `subnet-0937edf9855525b1b` (ap-northeast-2a): IGW 경로 → public subnet인데 public IP 없음
  - `subnet-0495c1c0ae546f02c` (ap-northeast-2c): 동일 문제
- **해결**: NodeClass에서 2개 public subnet 제거, private subnet(NAT 경로)만 유지
  - 유지: `subnet-012b272e47d6e6a07` (ap-northeast-2c), `subnet-09e82b994d4378ed4` (ap-northeast-2a)
  - public subnet에 있던 nodeclaim 2개 삭제 → Karpenter가 private subnet에 재생성
- **명령**: `kubectl patch nodeclass default --type=json -p '[{"op": "replace", "path": "/spec/subnetSelectorTerms", "value": [...]}]'`

### 3. StorageClass 문제 (gp2 in-tree → gp3 EBS CSI)
- **원인**: 기존 default StorageClass `gp2`가 `kubernetes.io/aws-ebs` provisioner 사용 → EKS Auto Mode 미지원
- **해결**: `ebs.csi.eks.amazonaws.com` provisioner 사용하는 `gp3` StorageClass 생성 및 default 지정
  ```bash
  kubectl delete storageclass gp2   # default 해제
  kubectl apply -f gp3-storageclass.yaml  # ebs.csi.eks.amazonaws.com
  ```
- 기존 PVC 삭제 후 재생성 (tutum-data, tutum-storage 네임스페이스)
- **영향**: Redis 3/3, MongoDB 3/3 PVC Bound 성공

### 4. Elasticsearch EBS 볼륨 권한 오류 (AccessDeniedException)
- **원인**: EKS Auto Mode EBS 볼륨이 root 소유로 마운트 → ES user(1000)가 node.lock 생성 불가
- **해결**: `securityContext: {fsGroup: 1000, runAsUser: 1000}` 추가
- **파일**: `k8s-manifests/overlays/staging/remove-nodeselector-patch.yaml` (ES StatefulSet 항목에 추가)

### 5. elasticsearch init container: minio-secret 없음
- **원인**: ES keystore init container가 `minio-secret`을 참조하는데 EKS staging에 없음
- **해결**: 임시 placeholder 시크릿 생성
  ```bash
  kubectl create secret generic minio-secret -n tutum-data \
    --from-literal=MINIO_ROOT_USER=placeholder \
    --from-literal=MINIO_ROOT_PASSWORD=placeholder
  ```
- **향후**: Phase D에서 실제 S3 credentials로 교체 예정

### 6. cloudflared 비활성화 (EKS staging)
- **원인**: EKS staging은 ALB로 트래픽 수신 → cloudflared 불필요
- **해결**: `replicas: 0` 패치 추가 (ArgoCD가 replicas 무시하므로 수동 scale도 필요)
  ```bash
  kubectl scale deployment cloudflared -n tutum-app --replicas=0
  ```

### 7. EC2 vCPU 한도 도달 (32개)
- **원인**: staging + production EKS가 동시 실행 → 총 32 vCPU 소비
  - staging: 5×c5a.large(10) + 2×c6g.large(4) = 14 vCPU
  - production: 3×c5a.large(6) + 2×c6g.large(4) + 2×m6i.large(4) + 2×t3.medium(4) = 18 vCPU
- **해결**:
  1. EC2 vCPU quota 증가 요청 (32→64), requestId: `1ce99f2598904f8d81eb90bef2c05edfMeId8a2k`
  2. Kafka/ES staging resource request 최소화: CPU 500m→100m, Memory 1Gi→512Mi
- **파일**: `k8s-manifests/overlays/staging/replicas-patch.yaml`

---

## 현재 Running 상태 (2026-03-06 KST ~23:00)

| 서비스 | 상태 | 비고 |
|--------|------|------|
| backend (2/2) | ✅ Running | |
| frontend (2/2) | ✅ Running | |
| email-worker | ✅ Running | |
| ocr | ✅ Running | |
| price-producer | ✅ Running | |
| elasticsearch | ✅ Running | fsGroup fix 적용 |
| mongodb 3/3 | ✅ Running | |
| redis 3/3 | ✅ Running | |
| kafka 0/3 | ⏳ Pending | vCPU quota 증가 후 해결 예정 |
| news-/price-/elastic-consumer | ⚠️ CrashLoop | Kafka 의존성 |
| cloudflared | ⏳ scale=0 | EKS staging 불필요 (ALB 사용) |

---

## 남은 작업

1. **vCPU quota 승인 대기** → Kafka pod 기동 → consumer pods 복구
2. **MinIO PVC** tutum-storage gp3 재생성 완료 확인
3. **`gitlab-registry-secret` 경고** 제거 (불필요 secret 참조 - ECR 사용 중)
4. **`news-pipeline-secret`** EKS staging 생성 (on-prem에서 복사)
5. **Phase D** 데이터 마이그레이션 (Elasticsearch, MongoDB 등)
