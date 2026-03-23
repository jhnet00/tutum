# Kyverno Enforce 활성화 및 MinIO HA 전환

**날짜**: 2026-03-04
**작업자**: 박성준
**브랜치**: develop

---

## 작업 개요

감사(Audit)에서 운영(Enforce)으로 Kyverno 이미지 서명 검증 정책 전환,
그리고 MinIO 단일 레플리카에서 4-pod 분산 모드(HA)로 전환.

---

## 1. Kyverno Cosign 서명 파이프라인 안정화

### 문제
- 클러스터에 적용된 ClusterPolicy의 public key가 K8s Secret `cosign-key`의 public key와 **불일치**
- 클러스터 정책: `E9ajQMQpN...` (구버전 키)
- K8s Secret: `QB0CTxfmi...` (현재 사용 키)
- 모든 이미지가 서명되지 않은 상태 (`accfcfe2` 태그 포함)
- `validationFailureAction: Audit` → 미서명 이미지도 배포 허용 상태

### 조치

#### 1-1. 미서명 이미지 서명 (cosign-key Secret으로)
```
COSIGN_PASSWORD=tutum123 cosign sign --key /tmp/cosign.key \
  registry.gitlab.com/tutum-project/tutum-app/backend:accfcfe2 --yes
COSIGN_PASSWORD=tutum123 cosign sign --key /tmp/cosign.key \
  registry.gitlab.com/tutum-project/tutum-app/backend/frontend:accfcfe2 --yes
COSIGN_PASSWORD=tutum123 cosign sign --key /tmp/cosign.key \
  registry.gitlab.com/tutum-project/tutum-app/backend/workers:accfcfe2 --yes
```
> 이전 세션 서명 이미지 (fafa6af3, 8ee32022)와 합쳐 총 5개 이미지 서명 완료

#### 1-2. Kyverno namespace에 GitLab 레지스트리 크리덴셜 생성
```bash
# tutum-app의 gitlab-registry-secret을 kyverno ns에 복제
kubectl get secret gitlab-registry-secret -n tutum-app -o jsonpath='{.data.\.dockerconfigjson}' \
  | base64 -d > /tmp/dockerconfig.json
kubectl create secret docker-registry gitlab-registry-secret -n kyverno \
  --from-file=.dockerconfigjson=/tmp/dockerconfig.json
```

#### 1-3. ClusterPolicy 업데이트
- `validationFailureAction: Audit` → **`Enforce`**
- public key: 구버전 키 → `QB0CTxfmi...` (K8s Secret과 동일)
- `secret` 필드 추가: `name: gitlab-registry-secret, namespace: kyverno`
- 파일: `k8s-manifests/kyverno/cosign-verify-policy.yaml`

#### 1-4. Kyverno 컨트롤러에 `--imagePullSecrets` 플래그 추가
Kyverno가 private GitLab 레지스트리에서 cosign 서명을 검증하려면
레지스트리 접근 크리덴셜이 필요함.

```bash
kubectl patch deployment kyverno-admission-controller -n kyverno --type=json \
  -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-",
        "value":"--imagePullSecrets=gitlab-registry-secret"}]'
kubectl patch deployment kyverno-background-controller -n kyverno --type=json \
  -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-",
        "value":"--imagePullSecrets=gitlab-registry-secret"}]'
```

> **주의**: Kyverno는 Helm(chart v3.2.8)으로 설치됨.
> `helm upgrade kyverno` 실행 시 이 패치가 초기화될 수 있음.
> 재적용 방법은 `k8s-manifests/kyverno/kyverno-registry-patches.yaml` 참고.

### 검증
```bash
# pod 재시작 후 Kyverno Enforce 통과 확인
kubectl rollout restart deployment/backend -n tutum-app
kubectl get pods -n tutum-app -l app=backend
# → 4/4 Running (Kyverno Enforce 통과)

# 미서명 이미지 차단 확인 (이벤트에서 FailedCreate + Kyverno denied 없음)
kubectl get events -n tutum-app --field-selector reason=FailedCreate | tail -5
```

### 영향 파일
| 파일 | 변경 내용 |
|------|----------|
| `k8s-manifests/kyverno/cosign-verify-policy.yaml` | public key 교체, Enforce 활성화, secret 참조 추가 |
| `k8s-manifests/kyverno/kyverno-registry-patches.yaml` | 신규 - 패치 재적용 가이드 |

---

## 2. MinIO 단일 레플리카 → 4-pod 분산 HA 전환

### 기존 상태
- StatefulSet `minio`: replicas=1, standalone mode
- PVC: 1개 (worker2, 20Gi)
- 버킷: `ocr-images` (1.93MB, 10개 파일), `profile-images` (4KB)
- SPOF: minio-0 또는 worker2 장애 시 스토리지 전체 중단

### MinIO 분산 모드 요구사항
- **최소 4개 드라이브** (Erasure Coding)
- 모든 드라이브는 **새로 초기화** (기존 데이터 직접 재사용 불가)
- `server http://minio-{0...3}.minio-headless.{ns}.svc.cluster.local/data` 형식

### 마이그레이션 절차

#### 2-1. 기존 데이터 백업
```bash
# worker2에서 MinIO 내부 데이터 tar 백업
ssh worker2 "tar czf /tmp/minio-backup.tar.gz \
  -C /opt/local-path-provisioner/pvc-8942b0fc-..._tutum-storage_minio-data-minio-0 ."
# 결과: 1.7MB
```

#### 2-2. 기존 StatefulSet 및 PVC 삭제
```bash
kubectl scale statefulset minio -n tutum-storage --replicas=0
kubectl delete statefulset minio -n tutum-storage   # PVC는 유지됨
kubectl delete pvc minio-data-minio-0 -n tutum-storage  # 분산 모드는 빈 드라이브 필요
```

#### 2-3. Headless Service 및 4-pod StatefulSet 배포
- Headless service `minio-headless` 추가 (pod 간 DNS 통신용)
- StatefulSet: replicas=4, `podManagementPolicy: Parallel`
- Image: `minio/minio:RELEASE.2024-01-16T16-07-38Z` (버전 고정)
- Anti-affinity: `preferredDuringScheduling` (3 worker에 최대한 분산)
- 파일: `k8s-manifests/base/storage/minio.yaml`

#### 2-4. 데이터 복원 (mc mirror)
```bash
# worker2에 임시 standalone MinIO pod 기동 (minio:latest - 원본 버전과 동일)
kubectl apply -f /tmp/minio-restore-pod.yaml

# mc mirror: 임시 → 분산 클러스터
kubectl exec -n tutum-storage minio-restore -- mc mirror old/ocr-images newminio/ocr-images
kubectl exec -n tutum-storage minio-restore -- mc mirror old/profile-images newminio/profile-images
# 10개 파일 1.93MiB → 전송 완료

kubectl delete pod minio-restore -n tutum-storage
```

### 결과

| 항목 | 이전 | 이후 |
|------|------|------|
| 레플리카 | 1 | 4 |
| PVC | 1×20Gi | 4×20Gi (80Gi raw) |
| 가용 용량 | 20Gi | ~40Gi (EC 2+2, 50% parity) |
| 장애 허용 | 0개 드라이브 | 1개 드라이브 |
| Pod 분산 | worker2 (1개) | worker1/2/3 (1/2/1개) |
| Erasure Set | N/A | 1 set, 4 drives per set |

```
# 최종 상태 확인
kubectl get pods -n tutum-storage -o wide
# minio-0: worker2
# minio-1: worker1
# minio-2: worker3
# minio-3: worker2 (worker가 3개뿐이어서 worker2에 2개)

mc admin info local/
# Drives: 1/1 OK × 4
# Erasure sets: 1, Drives per erasure set: 4
```

### 영향 파일
| 파일 | 변경 내용 |
|------|----------|
| `k8s-manifests/base/storage/minio.yaml` | 4-pod 분산 모드, headless service 추가 |

---

## 3. 향후 조치

- [ ] MinIO 백업 CronJob의 `minio-backup-secret` (kube-system) 크리덴셜을 minioadmin에서 실제 값으로 변경 검토
- [ ] CI/CD 파이프라인에서 새 이미지 빌드 시 자동 서명 확인 (sign:* 잡 실행 검증)
- [ ] Kyverno Helm 업그레이드 시 `--imagePullSecrets` 패치 재적용 필요
