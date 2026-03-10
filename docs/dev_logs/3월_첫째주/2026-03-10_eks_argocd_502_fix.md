# 2026-03-10 EKS ArgoCD 배포 완료 및 tutum.my 502 수정

## 작업자
박성준

---

## 배경

이전 세션에서 EKS에 ArgoCD 설치 + `tutum-staging` 앱 생성 완료. Kafka 연결 오류로 worker pod들이 재시작 중이었고, `https://tutum.my` → 502 상태였음.

---

## 완료 항목

### 1. Stuck Pod 정리 (i-089a429af700aa0b5 종료된 노드)

종료된 노드에 붙어있던 pod들이 `Error`/`Completed` 상태로 방치됨.

**원인**: Kyverno admission controller가 `ImagePullBackOff` 상태 → 웹훅 `failurePolicy: Fail` → 강제 삭제 차단

**처리**:
```bash
# Kyverno validating/mutating webhook → failurePolicy: Ignore 로 임시 패치
kubectl get validatingwebhookconfigurations -o name | grep kyverno | xargs -I{} \
  kubectl patch {} --type='json' -p='[{"op":"replace","path":"/webhooks/0/failurePolicy","value":"Ignore"}]'

# stuck pod 강제 삭제
kubectl delete pod frontend-7547f7cc48-c2ctr news-consumer-85df879bb-k6m9j \
  price-consumer-7f98c79fc6-h2s9z -n tutum-app --force --grace-period=0
```

### 2. NodePool Public Subnet 문제 (반복 이슈) → 근본 해결

**원인**: EKS Auto Mode가 `system` NodePool을 `default` NodeClass로 복귀. `default` NodeClass가 공인 IP 없는 public-route subnet(`10.60.1.0/24`, `10.60.2.0/24`)을 포함 → 노드가 인터넷 미접속.

| 서브넷 | CIDR | 라우팅 | 인터넷 가능 |
|--------|------|--------|------------|
| subnet-0937edf9855525b1b | 10.60.1.0/24 | IGW (직접) | ❌ (공인 IP 없음) |
| subnet-0495c1c0ae546f02c | 10.60.2.0/24 | IGW (직접) | ❌ (공인 IP 없음) |
| subnet-09e82b994d4378ed4 | 10.60.11.0/24 | NAT GW | ✅ |
| subnet-012b272e47d6e6a07 | 10.60.12.0/24 | NAT GW | ✅ |

**근본 수정**: `default` NodeClass 자체에서 IGW-routed subnet 제거

```bash
kubectl patch nodeclass default --type='json' -p='[
  {"op":"replace","path":"/spec/subnetSelectorTerms","value":[
    {"id":"subnet-09e82b994d4378ed4"},
    {"id":"subnet-012b272e47d6e6a07"}
  ]}
]'
```

→ NodePool이 어떤 NodeClass로 돌아와도 항상 NAT subnet에서 노드 생성.

### 3. Kyverno 복구 (ImagePullBackOff)

`reg.kyverno.io` 연결 타임아웃으로 Kyverno admission controller ImagePullBackOff 상태였음. `default` NodeClass 수정으로 새 노드가 NAT subnet에 생성됨 → 자동 복구.

### 4. Istio istiod 복구

istiod pod도 public subnet 노드에 스케줄링 → `docker.io/istio/pilot:1.25.0` pull 실패. NodeClass 수정 후 새 private subnet 노드에서 자동 복구.

### 5. ALB HealthCheck 경로 수정

**원인**: `alb.ingress.kubernetes.io/healthcheck-path: /health` → frontend(Next.js)에 `/health` 라우트 없음 → ALB target group 전체 unhealthy → 502

**수정** (`k8s-manifests/overlays/staging/alb-ingress.yaml`):
```yaml
# 변경 전
alb.ingress.kubernetes.io/healthcheck-path: /health

# 변경 후
alb.ingress.kubernetes.io/healthcheck-path: /
alb.ingress.kubernetes.io/healthcheck-success-codes: '200-399'
```

Target group 결과:
- `k8s-tutumapp-frontend-6abac79236`: HC path `/` (Next.js GET / → 200)
- `k8s-tutumapp-backends-2ead00d56d`: HC path `/health` (이미 별도 TG로 `/health` 사용 중)

### 6. Istio PeerAuthentication 수정 (ALB Health Check 차단 해소)

**원인**: `PeerAuthentication default (STRICT)` → ALB plain HTTP health check를 Istio sidecar가 mTLS 인증 실패로 차단 → target group unhealthy

**수정** (`k8s-manifests/overlays/staging/peer-authentication.yaml` 신규 생성):
```yaml
# frontend: port 3000 PERMISSIVE (ALB HC 허용)
# backend: port 8000 PERMISSIVE (ALB HC 허용)
# 나머지 서비스간 트래픽: STRICT 유지
```

---

## 최종 상태

### tutum-app 파드
```
backend (2/2)           ✅ Running
frontend (2/2 × 2)      ✅ Running
elastic-consumer (2/2)  ✅ Running
email-worker (2/2)      ✅ Running
news-consumer (2/2)     ✅ Running
news-producer (2/2)     ✅ Running
ocr (2/2)               ✅ Running
price-consumer (2/2)    ✅ Running
price-producer (2/2)    ✅ Running
```

### tutum-data 파드
```
kafka-0/1/2        ✅ Running
mongodb-0/1/2      ✅ Running
redis-0/1/2        ✅ Running
elasticsearch-0    ✅ Running
```

### E2E 검증
| 항목 | 결과 |
|------|------|
| `https://tutum.my` | ✅ 200 OK |
| `http://tutum.my` → HTTPS redirect | ✅ 301 |
| `/api/health` | ✅ 200 OK |
| `/api/v1/news` | ✅ 200 OK |
| ALB frontend target group | ✅ healthy |
| ALB backend target group | ✅ healthy |

---

## 잔여 작업

- [ ] OAuth callback URL 업데이트 (Google, Naver) → `https://tutum.my/api/v1/auth/*/callback`
- [ ] 실제 브라우저 E2E: 로그인, 시세, 뉴스, OCR 기능
- [ ] `mongodb-rs-init` Job NotReady 확인
- [ ] Kyverno webhook이 재시작 후 자동 `Fail` 복원됨 → 장기적으로 Kyverno ArgoCD 앱으로 관리 검토

---

## 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `k8s-manifests/overlays/staging/alb-ingress.yaml` | healthcheck-path `/health` → `/`, success-codes 추가 |
| `k8s-manifests/overlays/staging/peer-authentication.yaml` | 신규: frontend/backend PERMISSIVE port-level |
| `k8s-manifests/overlays/staging/kustomization.yaml` | resources에 alb-ingress.yaml, peer-authentication.yaml 추가 |
