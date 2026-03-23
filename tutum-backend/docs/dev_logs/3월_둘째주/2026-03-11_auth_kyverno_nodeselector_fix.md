# Auth 서비스 EKS 배포 + Kyverno 수정 + nodeSelector 전체 수정

- **날짜**: 2026-03-11
- **작업자**: 박성준
- **작업 분류**: EKS / Auth / Kyverno / K8s

---

## 배경

팀원 김경윤이 auth 서비스 K8s 매니페스트 + ECR 이미지 푸시를 완료.
ArgoCD에서 auth Deployment가 Synced 상태이나 pod가 Pending + Degraded 상태.

---

## 수정 항목 1: mongodb-rs-init Job ArgoCD hook 추가

**문제**: ArgoCD sync 시 `mongodb-rs-init` Job immutable field 에러 → OutOfSync.
```
Job.batch "mongodb-rs-init" is invalid: spec.template: Forbidden: pod template was changed
```

**수정**: `k8s-manifests/base/data/mongodb.yaml`에 ArgoCD hook 어노테이션 추가.
```yaml
annotations:
  argocd.argoproj.io/hook: PostSync
  argocd.argoproj.io/hook-delete-policy: BeforeHookCreation
```
기존 Job 수동 삭제 후 ArgoCD sync 완료.

---

## 수정 항목 2: Kyverno admission controller private-only 노드 이전

**문제**: 신규 auth RS pod 생성 시 Kyverno webhook 타임아웃.
```
failed calling webhook "mutate.kyverno.svc-fail": context deadline exceeded
```
원인: Kyverno admission controller가 `default` nodeclass 노드(인터넷 없음)에서 실행 중.
Sigstore TUF (`tuf-repo-cdn.sigstore.dev`) 접근 불가 → Cosign 서명 검증 실패.

**수정**: `k8s-manifests/base/kyverno/kyverno-ecr-values.yaml`
모든 컴포넌트에 nodeSelector 추가:
```yaml
admissionController/backgroundController/cleanupController/reportsController:
  nodeSelector:
    eks.amazonaws.com/nodeclass: private-only
```
`helm upgrade kyverno` 실행 → admissionController가 private-only 노드(NAT GW 있음)로 이전.
Sigstore TUF 접근 확인 완료.

---

## 수정 항목 3: auth ECR 이미지 Cosign 서명

**문제**: Kyverno ClusterPolicy `verify-image-signature`가 `tutum/auth:latest` 서명 검증 실패.
→ auth 이미지가 CI에서 sign 스테이지를 거치지 않았음 (lint 실패로 build/sign skip).

**수정**: cp-2에서 cosign 설치 후 수동 서명.
```bash
cosign sign --key env://COSIGN_PRIVATE_KEY \
  903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/tutum/auth@sha256:...
```
ECR에 서명 아티팩트(OCI referrer) 저장 완료.

---

## 수정 항목 4: nodeSelector `workload: app` → EKS nodeclass 전체 수정

**문제**: auth pod 신규 RS(`auth-fdb5c4778`) Pending 지속.
```
Warning  FailedScheduling  eks-auto-mode/compute
Failed to schedule pod - label "workload" does not have known values
```
`workload: app`은 온프렘 K8s 레이블. EKS Auto Mode 스케줄러가 인식 불가.
기존 pod는 이미 프로비저닝된 노드에 실행 중이었으나, 신규 pod는 노드 프로비저닝 실패.

**수정 대상** (전체 14개 파일):
- `k8s-manifests/base/auth/deployment.yaml`
- `k8s-manifests/base/backend/deployment.yaml`
- `k8s-manifests/base/frontend/deployment.yaml`
- `k8s-manifests/base/data/elasticsearch.yaml`
- `k8s-manifests/base/data/kibana.yaml`
- `k8s-manifests/base/workers/*.yaml` (8개)

변경 내용:
```yaml
# 수정 전
nodeSelector:
  workload: app

# 수정 후
nodeSelector:
  eks.amazonaws.com/nodeclass: private-only
```

---

## 수정 항목 5: app workload nodeSelector 제거 (private-only → 없음)

**문제**: `private-only` 노드 1개가 CPU 95% 포화(1700m/1780m).
EKS Auto Mode는 NodePool 제약으로 새 `private-only` 노드를 자동 프로비저닝 불가.
모든 app pod가 하나의 private-only 노드에 집중되어 신규 RS 스케줄링 불가.

**분석**: app 워크로드(auth/backend/frontend/workers)는 Istio sidecar가 있어 클러스터 내부 통신에는 인터넷 불필요.
Kyverno(Sigstore TUF)와 GitLab Runner(CI 패키지)만 인터넷 접근이 필수.

**수정**: auth/backend/frontend/workers/elasticsearch/kibana에서 nodeSelector 완전 제거.
→ EKS Auto Mode가 `default` nodeclass 노드에 자유롭게 스케줄링.
→ Kyverno + Runner만 `private-only` nodeSelector 유지.

---

## 수정 항목 6: Istio mTLS STRICT - mongodb-rs-init Job 연결 차단 수정

**문제**: ArgoCD PostSync hook `mongodb-rs-init` Job이 MongoDB에 연결 불가.
```
MongoServerSelectionError: read ECONNRESET
```
원인: `tutum-data` 네임스페이스 mTLS STRICT + Job에 `sidecar.istio.io/inject: "false"` →
Job(mTLS 없음)이 MongoDB(mTLS STRICT) 27017에 접근 시 Istio가 거부.

**수정**: `k8s-manifests/base/ingress/peer-authentication.yaml`에 추가.
```yaml
# Kafka와 동일한 패턴
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: mongodb-permissive
  namespace: tutum-data
spec:
  selector:
    matchLabels:
      app: mongodb
  portLevelMtls:
    "27017":
      mode: PERMISSIVE
```

추가로 mongodb-0 pod를 재시작하여 6시간째 unhealthy 상태인 Istio 사이드카 복구.

---

## 최종 결과

- ArgoCD tutum-staging: **Synced** (revision: 34e972d)
- auth pod: **2/2 Running** ×2 (`default` nodeclass 노드에 스케줄링)
- mongodb-rs-init Job: **Completed** (Replica set already initialized)
- mongodb-0: **2/2 Running** (Istio sidecar 정상 복구)

---

## 변경된 파일 요약

| 파일 | 변경 내용 |
|------|----------|
| `k8s-manifests/base/data/mongodb.yaml` | mongodb-rs-init Job ArgoCD PostSync hook 추가 |
| `k8s-manifests/base/kyverno/kyverno-ecr-values.yaml` | 전체 컴포넌트 private-only nodeSelector 추가 |
| `k8s-manifests/base/auth/deployment.yaml` | nodeSelector 완전 제거 |
| `k8s-manifests/base/backend/deployment.yaml` | nodeSelector 완전 제거 |
| `k8s-manifests/base/frontend/deployment.yaml` | nodeSelector 완전 제거 |
| `k8s-manifests/base/data/elasticsearch.yaml` | nodeSelector 완전 제거 |
| `k8s-manifests/base/data/kibana.yaml` | nodeSelector 완전 제거 |
| `k8s-manifests/base/workers/*.yaml` (8개) | nodeSelector 완전 제거 |
| `k8s-manifests/base/ingress/peer-authentication.yaml` | mongodb-permissive PeerAuthentication 추가 |
