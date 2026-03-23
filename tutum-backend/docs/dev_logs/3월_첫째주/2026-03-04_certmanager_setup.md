# cert-manager ClusterIssuer 구성

**날짜**: 2026-03-04
**작업자**: 박성준
**브랜치**: develop

---

## 작업 개요

cert-manager가 설치(v1.x)되어 있었으나 ClusterIssuer가 없어 인증서 발급이 불가한 상태였음.
자체 서명 CA 기반 ClusterIssuer 구성 완료.

---

## HTTPS 아키텍처 (Cloudflare Tunnel 방식)

```
인터넷 → Cloudflare 엣지 (TLS 종료) → cloudflared 터널
  → Istio IngressGateway (HTTP:80) → VirtualService → Service → Pod
```

Cloudflare가 외부 TLS를 처리하므로 Istio Gateway에 HTTPS 포트 추가 불필요.
cert-manager는 **클러스터 내부** 서비스용 인증서 발급 인프라로 활용.

---

## 구성 내용

### ClusterIssuer 구조

```
selfsigned ClusterIssuer (자체 서명)
    ↓ 발급
tutum-ca Certificate (cert-manager ns, isCA=true, 10년)
    ↓ Secret: tutum-ca
tutum-ca ClusterIssuer (CA 기반)
    ↓ 향후 내부 인증서 발급에 사용
```

### 적용 명령

```bash
kubectl apply -f k8s-manifests/base/ingress/cert-manager-issuers.yaml
```

### 검증

```bash
kubectl get clusterissuer
# selfsigned   True
# tutum-ca     True

kubectl get certificate -n cert-manager
# tutum-ca   True   tutum-ca   ...
```

---

## 향후 사용 방법

내부 서비스에 TLS 인증서가 필요한 경우:

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: my-service-tls
  namespace: tutum-app
spec:
  secretName: my-service-tls
  dnsNames:
    - my-service.tutum-app.svc.cluster.local
  issuerRef:
    name: tutum-ca
    kind: ClusterIssuer
```

---

## 영향 파일

| 파일 | 변경 내용 |
|------|----------|
| `k8s-manifests/base/ingress/cert-manager-issuers.yaml` | 신규 - SelfSigned + CA ClusterIssuer |

> ClusterIssuer는 cluster-scoped 리소스로 ArgoCD base kustomization 외부에서 직접 관리.
> 재적용: `kubectl apply -f k8s-manifests/base/ingress/cert-manager-issuers.yaml`
