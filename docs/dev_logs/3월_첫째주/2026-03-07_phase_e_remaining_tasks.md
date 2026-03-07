# 2026-03-07 Phase E 잔여 작업

## 작업자
박성준

---

## 완료 항목

| 항목 | 내용 |
|------|------|
| ALB 생성 | `k8s-tutumstg-522ae53287-1398442796.ap-northeast-2.elb.amazonaws.com` |
| WAF 연결 | `tutum-stg-waf` → ALB 연결 완료 |
| Route53 | `tutum.my`, `*.tutum.my` A 레코드 → ALB alias 등록 완료 (Route53 기준) |
| ALB Ingress manifest | `k8s-manifests/overlays/staging/alb-ingress.yaml` 작성 완료 |

---

## ⚠️ 블로커: Cloudflare DNS 설정 필요 (담당자 전달)

`tutum.my` 도메인의 실제 네임서버: **Cloudflare** (`rodrigo.ns.cloudflare.com`, `gail.ns.cloudflare.com`)
Route53에 등록해도 실제 DNS에 반영 안 됨 → Cloudflare에 직접 추가 필요

### Cloudflare > tutum.my > DNS 레코드 추가

| Type | Name | Value | Proxy |
|------|------|-------|-------|
| CNAME | `_6c8cd6bb0901cac2de8fc47417d88c34` | `_0a6858f03b9918dee5cb09a3e501c17f.jkddzztszm.acm-validations.aws.` | **DNS only** (필수) |
| CNAME | `@` (루트) | `k8s-tutumstg-522ae53287-1398442796.ap-northeast-2.elb.amazonaws.com` | DNS only |
| CNAME | `*` (와일드카드) | `k8s-tutumstg-522ae53287-1398442796.ap-northeast-2.elb.amazonaws.com` | DNS only |

> **첫 번째 CNAME** (긴 이름): ACM 인증서 DNS validation용. Proxy OFF 필수.
> **`@`, `*`**: ALB 트래픽 라우팅용. Proxy OFF 권장 (HTTPS redirect는 ALB에서 처리).

---

## Cloudflare 설정 완료 후 진행할 작업

### 1. ACM 인증서 ISSUED 확인

```bash
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:ap-northeast-2:903913341620:certificate/cc8731ed-bd74-4ea4-a07b-897b6fbac78d \
  --region ap-northeast-2 \
  --query "Certificate.Status" --output text
# → ISSUED 확인
```

### 2. ALB Ingress HTTPS 활성화

```bash
kubectl annotate ingress tutum-stg-ingress -n tutum-app \
  'alb.ingress.kubernetes.io/certificate-arn=arn:aws:acm:ap-northeast-2:903913341620:certificate/cc8731ed-bd74-4ea4-a07b-897b6fbac78d' \
  'alb.ingress.kubernetes.io/listen-ports=[{"HTTP": 80}, {"HTTPS": 443}]' \
  'alb.ingress.kubernetes.io/ssl-redirect=443' \
  --overwrite
```

### 3. OAuth 콜백 URL 업데이트

- **Google Cloud Console**: OAuth 2.0 클라이언트 → Authorized redirect URIs
  - `https://tutum.my/api/v1/auth/google/callback` 추가
- **Naver Developers**: 애플리케이션 관리 → API 설정 → Callback URL
  - `https://tutum.my/api/v1/auth/naver/callback` 추가

### 4. E2E 검증

- [ ] `https://tutum.my` 접속 → 프론트엔드 정상 로딩
- [ ] OAuth 로그인 (Google, Naver)
- [ ] 시세 데이터 표시 (WebSocket / REST fallback)
- [ ] 뉴스 데이터 표시
- [ ] OCR 기능

---

## 참고 정보

| 리소스 | 값 |
|--------|-----|
| ACM ARN | `arn:aws:acm:ap-northeast-2:903913341620:certificate/cc8731ed-bd74-4ea4-a07b-897b6fbac78d` |
| ALB DNS | `k8s-tutumstg-522ae53287-1398442796.ap-northeast-2.elb.amazonaws.com` |
| ALB ARN | `arn:aws:elasticloadbalancing:ap-northeast-2:903913341620:loadbalancer/app/k8s-tutumstg-522ae53287/60e2a19710e06ee3` |
| WAF WebACL ARN | `arn:aws:wafv2:ap-northeast-2:903913341620:regional/webacl/tutum-stg-waf/14db8c23-c2dc-4d17-9f85-4b509bf4c261` |
| Route53 Hosted Zone | `Z04669402IT42VPHL8CRP` (tutum.my) |
