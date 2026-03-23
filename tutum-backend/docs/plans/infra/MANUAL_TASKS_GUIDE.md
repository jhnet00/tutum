# 수동 작업 가이드 (사람이 직접 해야 하는 항목)

> 최종 업데이트: 2026-03-03
> 이 파일은 클러드/스크립트로 자동화할 수 없는 작업들을 정리한 가이드입니다.

---

## 목차

1. [GitLab CI Variables 등록](#1-gitlab-ci-variables-등록) 🔴 **필수 — 파이프라인 차단 중**
2. [Kyverno Enforce 전환](#2-kyverno-enforce-전환) 🟡 CI Variables 등록 후 진행
3. [ArgoCD tutum-production 수동 Sync](#3-argocd-tutum-production-수동-sync) 🟠 main 브랜치 배포 시
4. [Let's Encrypt 스킵 안내 (EKS ACM으로 대체)](#4-lets-encrypt-스킵-안내) ℹ️ 참고

---

## 1. GitLab CI Variables 등록

> 🔴 **미등록 시 CI 파이프라인의 `sign:*` 및 `deploy:*` 잡이 실패합니다.**

### 1-1. K8S_MANIFESTS_TOKEN

CI `deploy:staging` / `deploy:production` 잡이 `k8s-manifests/overlays/*/kustomization.yaml`의
이미지 태그를 업데이트하고 백엔드 레포에 push하기 위해 필요한 GitLab Personal Access Token입니다.

**① GitLab PAT 생성**

1. [GitLab](https://gitlab.com) 로그인
2. 우측 상단 프로필 아이콘 → **Edit profile**
3. 왼쪽 사이드바 → **Access Tokens**
4. **Add new token** 클릭
   - Token name: `k8s-manifests-deploy`
   - Expiration date: 원하는 만료일 설정 (예: 1년)
   - Scopes: ✅ **`write_repository`** 체크
5. **Create personal access token** → 토큰 값 복사 (**다시 볼 수 없음**)

**② CI Variable 등록**

1. GitLab → `tutum-project/tutum-app/backend` 레포
2. **Settings > CI/CD > Variables** → **Add variable**

| 항목 | 값 |
|------|-----|
| Key | `K8S_MANIFESTS_TOKEN` |
| Value | (위에서 생성한 PAT 값) |
| Type | Variable |
| Flags | ✅ Mask variable |

3. **Save variables**

---

### 1-2. COSIGN_PRIVATE_KEY

CI `sign:backend` / `sign:frontend` 잡이 빌드된 이미지에 서명하기 위해 필요한 개인키입니다.
키는 2026-03-03에 cp-2 노드에서 생성됐습니다 (`~/cosign.key`).

**① 개인키 내용 확인 (cp-2 SSH 접속 필요)**

```bash
ssh cp-2
cat ~/cosign.key
```

출력 예시:
```
-----BEGIN ENCRYPTED COSIGN PRIVATE KEY-----
...여러 줄...
-----END ENCRYPTED COSIGN PRIVATE KEY-----
```

전체 내용을 복사합니다 (`-----BEGIN...` 부터 `...END-----` 까지 포함).

**② CI Variable 등록**

| 항목 | 값 |
|------|-----|
| Key | `COSIGN_PRIVATE_KEY` |
| Value | (cosign.key 파일 전체 내용 붙여넣기) |
| Type | **File** ← 반드시 File 타입 선택 |
| Flags | ✅ Mask variable |

> ⚠️ Type을 **Variable**이 아닌 **File**로 선택해야 합니다.
> File 타입으로 등록하면 CI 잡 내에서 파일 경로로 전달됩니다.

---

### 1-3. COSIGN_PASSWORD

cosign 개인키 암호화에 사용된 패스워드입니다.

| 항목 | 값 |
|------|-----|
| Key | `COSIGN_PASSWORD` |
| Value | `tutum123` |
| Type | Variable |
| Flags | ✅ Mask variable |

---

### 1-4. 등록 후 확인 방법

develop 브랜치에 아무 커밋이나 push 후 GitLab → CI/CD → Pipelines에서 확인합니다.

| 잡 | 성공 시 의미 |
|----|------------|
| `sign:backend` / `sign:frontend` | COSIGN_PRIVATE_KEY + COSIGN_PASSWORD 정상 |
| `deploy:staging` | K8S_MANIFESTS_TOKEN 정상, kustomization.yaml 태그 자동 업데이트 |

deploy:staging 성공 후 ArgoCD `tutum-staging` 앱이 자동 sync되어 새 이미지가 배포됩니다.

```bash
# 배포 확인 (cp-1 또는 cp-2에서)
kubectl get pods -n tutum-app
# → 새 SHA 태그 이미지로 파드 교체 확인
```

---

## 2. Kyverno Enforce 전환

> 🟡 **위 CI Variables 등록 + `sign:*` 잡 정상 확인 후 진행하세요.**
> 현재는 `Audit` 모드 — 미서명 이미지가 배포돼도 경고만 발생하고 차단되지 않습니다.

**전환 전 전제조건 체크리스트**

- [ ] CI Variables 3종 모두 등록 완료
- [ ] develop 브랜치 파이프라인에서 `sign:backend`, `sign:frontend` 잡 ✅ 성공
- [ ] 현재 실행 중인 모든 파드 이미지가 cosign으로 서명됨 확인

```bash
# 서명 여부 확인 (cp-2에서)
cosign verify \
  --certificate-identity-regexp=".*" \
  --certificate-oidc-issuer-regexp=".*" \
  registry.gitlab.com/tutum-project/tutum-app/backend:<태그>
```

**Enforce 전환 방법**

[k8s-manifests/kyverno/cosign-verify-policy.yaml](../../k8s-manifests/kyverno/cosign-verify-policy.yaml) 파일에서:

```yaml
# 변경 전
spec:
  validationFailureAction: Audit

# 변경 후
spec:
  validationFailureAction: Enforce
```

변경 후 commit & push → ArgoCD tutum-staging auto-sync로 자동 적용됩니다.

---

## 3. ArgoCD tutum-production 수동 Sync

> 🟠 **main 브랜치에 PR이 merge될 때마다 수행합니다.**
> production은 auto-sync가 아닌 manual sync — 의도치 않은 자동 배포를 방지합니다.

**흐름**

```
PR merge to main
  → CI deploy:production 잡 수동 실행 (GitLab CI/CD → 해당 파이프라인 → ▶️ 클릭)
  → k8s-manifests/overlays/production/kustomization.yaml 태그 업데이트
  → ArgoCD에서 수동 Sync 승인
```

**ArgoCD Sync 방법**

1. ArgoCD UI 접속 (port-forward 필요):
   ```bash
   kubectl port-forward svc/argocd-server -n argocd 8080:443
   # 브라우저: https://localhost:8080
   ```
2. `tutum-production` 앱 클릭
3. **SYNC** 버튼 클릭 → **SYNCHRONIZE** 확인

또는 CLI:
```bash
argocd app sync tutum-production
```

---

## 4. Let's Encrypt 스킵 안내

> ℹ️ 현재 Cloudflare Tunnel이 HTTPS/TLS를 처리하므로 온프레미스에서는 설정 불필요합니다.

| 구간 | TLS 처리 방식 |
|------|-------------|
| 온프레미스 (현재) | Cloudflare Tunnel → Cloudflare Edge에서 TLS 종료 |
| EKS 전환 후 | **ACM** (AWS Certificate Manager) + **AWS Load Balancer Controller** 도입 예정 |

cert-manager는 설치된 상태로 유지합니다 (내부 서비스 인증서 / 웹훅 TLS 용도).

---

## 요약 체크리스트

```
🔴 즉시 필요
├── [ ] K8S_MANIFESTS_TOKEN CI Variable 등록 (write_repository PAT)
├── [ ] COSIGN_PRIVATE_KEY CI Variable 등록 (File 타입, cp-2 ~/cosign.key)
└── [ ] COSIGN_PASSWORD CI Variable 등록 (tutum123)

🟡 CI Variables 등록 후
└── [ ] sign:* 잡 성공 확인 → Kyverno Audit → Enforce 전환

🟠 배포 시마다
└── [ ] main 브랜치 PR merge 후 ArgoCD tutum-production 수동 Sync
```
