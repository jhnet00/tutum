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

## 해결 방법: 가비아 네임서버 → Route53 변경

`tutum.my`는 **가비아**에서 구매한 도메인. Cloudflare는 기존 온프레미스 시절 DNS 호스팅으로 사용했으나 EKS 전환 후 불필요.
Route53 Hosted Zone에 모든 레코드가 이미 등록되어 있으므로, 가비아에서 네임서버만 교체하면 됨.

### 가비아 네임서버 변경

`gabia.com` 로그인 → My가비아 → 서비스 관리 → 도메인 → `tutum.my` 관리 → 네임서버 수정

| 네임서버 |
|---------|
| `ns-1504.awsdns-60.org` |
| `ns-542.awsdns-03.net` |
| `ns-1540.awsdns-00.co.uk` |
| `ns-49.awsdns-06.com` |

### Route53에 이미 등록된 레코드 (전부 준비 완료 ✅)

| Type | Name | Value |
|------|------|-------|
| A (Alias) | `tutum.my` | ALB (`k8s-tutumstg-522ae53287-...`) |
| A (Alias) | `*.tutum.my` | ALB (동일) |
| CNAME | `_6c8cd6bb0901cac2de8fc47417d88c34` | ACM 인증서 검증용 |

---

## 네임서버 전파 후 진행할 작업

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
