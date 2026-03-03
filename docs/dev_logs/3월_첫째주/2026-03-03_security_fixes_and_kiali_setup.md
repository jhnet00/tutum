# 2026-03-03 보안 강화 작업 및 Kiali 설치

## 작업자
박성준

## 작업 범위
- K8S_MIGRATION_STATUS.md 작성 (클러스터 현황 vs 계획서 비교 이슈 트래커)
- ArgoCD OutOfSync 수정 (ISSUE-01)
- Istio mTLS PeerAuthentication 매니페스트 추가 (ISSUE-05)
- NetworkPolicy 매니페스트 추가 (ISSUE-06)
- Cosign 키 생성 및 Kyverno 정책 업데이트 (ISSUE-03)
- Kiali v1.73 설치 - Monitoring VM Docker Compose (ISSUE-10)

---

## 1. K8S_MIGRATION_STATUS.md 작성

K8S_MIGRATION_PLAN.md 대비 실제 클러스터 상태를 SSH 직접 점검하여 이슈 트래커 문서 작성.

- **위치**: `docs/plans/infra/K8S_MIGRATION_STATUS.md`
- **이슈 총 14개** 분류 (Critical 2, High 4, Medium 4, Low 4)
- 이미 완료된 항목 재확인: Slack/Jira 알림 (ISSUE-07), GitLab Runner 태그 (ISSUE-02)

---

## 2. ArgoCD OutOfSync 수정 (ISSUE-01)

**문제**: `news-producer` Deployment가 ruby-backup0225 브랜치의 `value:` 방식 env와 develop 브랜치의 `valueFrom:` 방식 env가 충돌하여 strategic merge patch 실패.

**해결**:
```bash
kubectl delete deployment news-producer -n tutum-app
# ArgoCD force sync with apply.force: true
kubectl patch application tutum-app-gitops -n argocd --type merge \
  -p '{"operation": {"sync": {"syncStrategy": {"apply": {"force": true}}}}}'
```

**결과**: `tutum-app-gitops` → Synced / Healthy / Succeeded, news-producer 재생성 Running 확인.

---

## 3. Istio mTLS PeerAuthentication 추가 (ISSUE-05)

**파일**: `k8s-manifests/base/ingress/peer-authentication.yaml`

```yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: tutum-app
spec:
  mtls:
    mode: STRICT
```

`k8s-manifests/base/kustomization.yaml`에 추가 → ArgoCD 배포 예정.

---

## 4. NetworkPolicy 추가 (ISSUE-06)

**파일**: `k8s-manifests/base/security/network-policy.yaml`

8개 NetworkPolicy 생성:

| 네임스페이스 | 정책명 | 역할 |
|------------|--------|-----|
| tutum-data | default-deny-ingress | 기본 차단 |
| tutum-data | allow-from-tutum-app | Backend/Workers → DB 허용 |
| tutum-data | allow-from-monitoring | Alloy 메트릭 스크랩 허용 |
| tutum-data | allow-intra-namespace | 레플리카 내부 통신 허용 |
| tutum-app | default-deny-ingress | 기본 차단 |
| tutum-app | allow-from-istio | IngressGateway → 앱 허용 |
| tutum-app | allow-from-monitoring | Alloy 메트릭 스크랩 허용 |
| tutum-app | allow-intra-namespace | Istio sidecar 간 통신 허용 |

`k8s-manifests/base/kustomization.yaml`에 추가 → ArgoCD 배포 예정.

---

## 5. Cosign 키 생성 및 Kyverno 정책 업데이트 (ISSUE-03)

**키 생성** (cp-2 노드):
```bash
wget https://github.com/sigstore/cosign/releases/download/v2.4.3/cosign-linux-amd64
chmod +x cosign-linux-amd64 && mv cosign-linux-amd64 cosign
COSIGN_PASSWORD=tutum123 ./cosign generate-key-pair
```

**K8s Secret 생성**:
```bash
kubectl create secret generic cosign-key \
  --from-file=cosign.key=cosign.key \
  --from-file=cosign.pub=cosign.pub \
  -n tutum-app
```

**Kyverno 정책 publicKeys 업데이트**: `k8s-manifests/kyverno/cosign-verify-policy.yaml`에 새 공개키 반영.

**남은 작업**: GitLab CI Variable `COSIGN_PRIVATE_KEY`(File 타입), `COSIGN_PASSWORD`(=tutum123) 등록 필요.

---

## 6. Kiali v1.73 설치 (ISSUE-10)

### 구성 방식
Kiali는 기본적으로 K8s 클러스터 내부에서 실행하도록 설계되어 있어, 외부(Monitoring VM) 배포 시 "fake in-cluster config" 방식 사용.

**방식**: KUBERNETES_SERVICE_HOST/PORT 환경변수 + SA 토큰/CA cert 파일 마운트

### K8s RBAC 설정 (monitoring 네임스페이스)
```bash
# ServiceAccount, ClusterRole, ClusterRoleBinding, kiali-token Secret 생성
kubectl create serviceaccount kiali -n monitoring
kubectl create clusterrole kiali (전체 Istio CRD 포함)
kubectl create clusterrolebinding kiali
kubectl create secret kiali-token (long-lived SA token)
```

### Docker Compose 추가 (`/opt/monitoring/docker-compose.yml`)
```yaml
kiali:
  image: quay.io/kiali/kiali:v1.73
  ports:
    - "20001:20001"
  volumes:
    - ./kiali/config.yaml:/tmp/kiali-config.yaml:ro
    - ./kiali-sa-secret/ca.crt:/var/run/secrets/kubernetes.io/serviceaccount/ca.crt:ro
    - ./kiali-sa-secret/token:/var/run/secrets/kubernetes.io/serviceaccount/token:ro
  environment:
    - KUBERNETES_SERVICE_HOST=192.168.0.220
    - KUBERNETES_SERVICE_PORT=6443
    - LOG_LEVEL=info
  command:
    - -config=/tmp/kiali-config.yaml
  restart: unless-stopped
```

### Kiali 설정 (`/opt/monitoring/kiali/config.yaml`)
```yaml
auth:
  strategy: anonymous
deployment:
  accessible_namespaces: ["**"]
  cluster_wide_access: true
external_services:
  prometheus:
    url: http://mimir:9009/prometheus
  istio:
    istiod_deployment_name: istiod
  grafana:
    enabled: true
    in_cluster_url: http://grafana:3000
    url: http://192.168.0.230:3000
  tracing:
    enabled: false
server:
  port: 20001
  web_root: /kiali
```

### 트러블슈팅 과정
1. **Kiali v2.2 시도**: v2.x는 out-of-cluster 배포 완전 미지원 → v1.73으로 다운그레이드
2. **`--config` → `-config`**: v1.73은 single-dash flag만 지원 (flag 오타로 설정파일 무시됨)
3. **HOME 환경변수**: Docker container에서 HOME이 Windows 경로로 설정되어 kubeconfig 경로 오작동
4. **fake in-cluster config**: SA token + CA cert 마운트 + KUBERNETES_SERVICE_HOST/PORT 설정으로 해결

**결과**: Kiali v1.73 정상 구동, 웹 UI 접속 확인 (`http://192.168.0.230:20001/kiali`)

---

## 변경된 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `k8s-manifests/base/ingress/peer-authentication.yaml` | 신규 - mTLS STRICT PeerAuthentication |
| `k8s-manifests/base/security/network-policy.yaml` | 신규 - 8개 NetworkPolicy |
| `k8s-manifests/base/kustomization.yaml` | peer-authentication, network-policy 추가 |
| `k8s-manifests/kyverno/cosign-verify-policy.yaml` | publicKeys 새 cosign 키로 업데이트 |
| `docs/plans/infra/K8S_MIGRATION_STATUS.md` | 신규 - 이슈 트래커 문서 |

## Monitoring VM 변경 사항 (직접 수정)

| 경로 | 변경 내용 |
|------|----------|
| `/opt/monitoring/docker-compose.yml` | kiali 서비스 추가 |
| `/opt/monitoring/kiali/config.yaml` | 신규 - Kiali 설정 |
| `/opt/monitoring/kiali-sa-secret/ca.crt` | 신규 - K8s CA cert |
| `/opt/monitoring/kiali-sa-secret/token` | 신규 - Kiali SA token |

## K8s 클러스터 직접 생성 리소스

- `cosign-key` Secret (tutum-app ns)
- `kiali` ServiceAccount (monitoring ns)
- `kiali` ClusterRole
- `kiali` ClusterRoleBinding
- `kiali-token` Secret (monitoring ns)

---

## 다음 작업

1. **사용자 필수**: GitLab CI Variable `COSIGN_PRIVATE_KEY`, `COSIGN_PASSWORD` 등록
2. ArgoCD develop 브랜치 sync로 PeerAuthentication, NetworkPolicy 클러스터 적용 확인
3. ISSUE-04: CI 파이프라인 이미지 서명 확인 후 Kyverno Audit → Enforce 전환
