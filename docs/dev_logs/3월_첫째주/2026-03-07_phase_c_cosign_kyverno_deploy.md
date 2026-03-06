# 2026-03-07 Phase C: Cosign 서명 + Kyverno Enforce 배포

## 작업자
박성준

## 작업 배경
AWS Migration Plan Phase C 완료:
- GitLab CI COSIGN 키 업데이트 → 파이프라인 실행 → Kyverno Audit→Enforce 전환

---

## 완료 항목

### 1. GitLab CI/CD Variables 설정

- `COSIGN_PRIVATE_KEY`: Variable 타입 (env://로 읽음, File 아님)
- `COSIGN_PUBLIC_KEY`: Variable 타입
- `COSIGN_PASSWORD`: Variable 타입 (tutum123)
- 키 파일 위치: cp-2 `/tmp/cosign.key`, `/tmp/cosign.pub`

### 2. 파이프라인 트리거 및 완료

- 커밋: `ci: trigger pipeline for cosign signing (Phase C)` (SHA: `61e9366`)
- 파이프라인: Passed (전 스테이지 green ✅)
  - guard → lint → test → scan → build → security → sign → deploy
- ECR 이미지 빌드 완료: `frontend:61e93665`, `backend:61e93665`, `workers:61e93665`

### 3. Kyverno Audit → Enforce 전환

```bash
kubectl patch clusterpolicy verify-image-signature --type=merge \
  -p '{"spec":{"validationFailureAction":"Enforce"}}'
```

---

## 트러블슈팅

### 이슈 1: Kyverno webhook context deadline exceeded

- **원인**: KEDA 이슈와 유사 — Kyverno admission controller가 ECR(cosign 서명 확인)에 접근 시 AWS 자격증명 없음 → 10s timeout 초과
- **해결**:
  1. IRSA 설정: IAM role `tutum-stg-kyverno-ecr-role` 생성
     - Trust policy: Kyverno SA (`kyverno:kyverno-admission-controller`)
     - Policy: `AmazonEC2ContainerRegistryReadOnly`
  2. SA annotation: `eks.amazonaws.com/role-arn=...`
  3. Kyverno admission controller rollout restart → IRSA env vars 주입 확인
  4. Webhook timeout: 10s → 30s로 증가

### 이슈 2: cosign 서명 포맷 불일치 (OCI 1.1 vs legacy)

- **원인**: cosign v2.x는 OCI 1.1 referrers 포맷으로 서명 저장, Kyverno v1.17.1은 legacy `sha256-xxx.sig` 태그 형식만 검증 가능
  - ECR referrers API 확인: `application/vnd.dev.sigstore.bundle.v0.3+json` 형식으로 저장됨
  - Kyverno: "no signatures found" 반복
- **해결**:
  1. cp-2에서 기존 `61e93665` 이미지 재서명 (legacy 모드):
     ```bash
     cosign sign --key /tmp/cosign.key --registry-referrers-mode=legacy \
       903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/tutum/{frontend,backend,workers}:61e93665
     ```
  2. `.gitlab-ci.yml` sign:* 잡에 `--registry-referrers-mode=legacy` 추가 (영구 fix)
     ```yaml
     cosign sign --key env://COSIGN_PRIVATE_KEY --registry-referrers-mode=legacy ${IMAGE}:${SHA}
     ```

### 이슈 3: ArgoCD sync → Kyverno autogen 규칙이 Deployment PATCH 차단

- **원인**: Kyverno `verifyImages` 정책이 autogen으로 Deployment 규칙 생성 → ArgoCD의 Deployment UPDATE도 서명 검증
- **해결**: 이슈 2 해결 후 자동 해소 (legacy 서명 추가 후 Kyverno가 정상 검증)

### 이슈 4: 새 EKS 노드가 public subnet에 배치

- **원인**: NodePool이 `private-only` NodeClass로 패치됐지만 재시작 후 `default` NodeClass로 복귀
  - EKS Auto Mode가 `default` NodeClass는 재설정, 커스텀 NodeClass는 유지
- **해결**: NodePool 재패치 → `private-only` + public subnet 노드 삭제
  ```bash
  kubectl patch nodepool general-purpose --type=merge \
    -p '{"spec":{"template":{"spec":{"nodeClassRef":{"name":"private-only"}}}}}'
  kubectl delete nodeclaim general-purpose-6cm4x general-purpose-tmsmn
  ```
- **참고**: NodePool 패치는 재시작마다 수동 재적용 필요 (ArgoCD로 관리 검토 필요)

---

## 최종 상태

| 컴포넌트 | 상태 |
|---------|------|
| 파이프라인 | ✅ Passed (61e93665) |
| ECR 이미지 서명 | ✅ legacy sha256-xxx.sig 형식 |
| Kyverno Enforce | ✅ 활성화 |
| Kyverno IRSA | ✅ ECR ReadOnly 권한 |
| ArgoCD sync | ✅ Synced |
| tutum-app pods | ✅ All 2/2 Running |

---

## 남은 작업 (Phase E)

- ACM `*.tutum.my` ISSUED 확인 (DNS validation 전파 완료 후)
- ALB Ingress 생성 (ACM ARN annotation)
- WAF WebACL → ALB 연결
- Route53 A 레코드 → ALB
- OAuth 콜백 URL 업데이트 (Google, Naver)
