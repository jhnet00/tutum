# 2026-03-06 Phase C: GitLab CR → ECR 전환 (CI/CD + 이미지 경로 + Cosign)

## 작업자
박성준

## 작업 배경
AWS Migration Plan Phase C 진행
기준: `docs/plans/infra/AWS_MIGRATION_PLAN_2026-03-03.md`

## 완료 항목

### 1. Dockerfile Alpine 전환

| 파일 | 변경 |
|------|------|
| `backend/Dockerfile` | `python:3.11-slim` → `python:3.11-alpine`, `apt-get` → `apk add --no-cache gcc musl-dev` |
| `backend/workers/Dockerfile` | 동일 |
| `frontend/Dockerfile` | 이미 `node:20-alpine` 사용 중 (변경 불필요) |

### 2. `.gitlab-ci.yml` ECR 전환

**variables 섹션:**
```yaml
# 변경 전
FRONTEND_IMAGE: "${CI_REGISTRY_IMAGE}/frontend"  # GitLab CR
BACKEND_IMAGE: "${CI_REGISTRY_IMAGE}"
WORKERS_IMAGE: "${CI_REGISTRY_IMAGE}/workers"

# 변경 후
FRONTEND_IMAGE: "${ECR_REGISTRY}/tutum/frontend"  # AWS ECR
BACKEND_IMAGE: "${ECR_REGISTRY}/tutum/backend"
WORKERS_IMAGE: "${ECR_REGISTRY}/tutum/workers"
```

**build:* jobs** (kaniko ECR 인증):
```yaml
# 변경 전: GitLab CR Basic Auth
echo "{\"auths\":{\"${CI_REGISTRY}\":{...}}}" > /kaniko/.docker/config.json

# 변경 후: ECR credHelper (kaniko 내장 ecr-login 사용)
printf '{"credHelpers":{"%s":"ecr-login"}}' "${ECR_REGISTRY}" > /kaniko/.docker/config.json
```
→ kaniko executor가 `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` 환경변수로 ECR 자동 인증

**security:* (Trivy) jobs**:
```yaml
# ECR 토큰을 before_script에서 동적으로 획득
before_script:
  - apk add --no-cache aws-cli
  - export TRIVY_USERNAME=AWS
  - export TRIVY_PASSWORD=$(aws ecr get-login-password --region ${AWS_DEFAULT_REGION})
  - export TRIVY_AUTH_URL=${ECR_REGISTRY}
```

**sign:* (Cosign) jobs**:
```yaml
# 변경 전: GitLab CR 로그인 후 서명
- cosign login ${CI_REGISTRY} -u ${CI_REGISTRY_USER} -p ${CI_REGISTRY_PASSWORD}
- cosign sign ...

# 변경 후: AWS 자격증명 자동 사용 (cosign이 ECR 레지스트리 감지 시 AWS SDK 사용)
- cosign sign ...  # 로그인 불필요
```

**deploy:staging/production sed 패턴:**
```bash
# 변경 전: GitLab CR 경로
sed -i "/name: registry.gitlab.com\/tutum-project\/.../

# 변경 후: ECR 경로
sed -i "/name: ${ECR_REGISTRY}\/tutum\/frontend$/...
```

### 3. k8s-manifests kustomization.yaml ECR 경로 통일

| 파일 | 변경 |
|------|------|
| `k8s-manifests/overlays/staging/kustomization.yaml` | GitLab CR → ECR (`903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/tutum/*`) |
| `k8s-manifests/overlays/production/kustomization.yaml` | 동일 |

### 4. Cosign 키 재발급 (ECR용)

- 위치: cp-2 `/tmp/cosign.key`, `/tmp/cosign.pub`
- 패스워드: `tutum123` (기존 동일)
- 공개키:
  ```
  -----BEGIN PUBLIC KEY-----
  MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE3jV1os/fuTuPPvF0XFpFlYiP156q
  OUnqtAxXN2oGy/cTFktgFYyWFt6lAaB+8GSCRb9FhW4JXzQucDm1O/c8tw==
  -----END PUBLIC KEY-----
  ```

### 5. Kyverno 정책 업데이트 (on-prem 적용 완료)

- 파일: `k8s-manifests/kyverno/cosign-verify-policy.yaml`
- 변경: `imageReferences: registry.gitlab.com/...` → `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/tutum/*`
- 새 공개키 반영
- `kubectl apply` on-prem 적용 완료 (`configured`)

## 수동 완료 필요 항목 (파이프라인 실행 전 필수)

| 항목 | 방법 |
|------|------|
| **GitLab CI `COSIGN_PRIVATE_KEY` 업데이트** | GitLab > Settings > CI/CD > Variables<br>키: cp-2 `/tmp/cosign.key` 내용, Type: File |
| **GitLab CI `COSIGN_PUBLIC_KEY` 업데이트** | 동일 위치, cp-2 `/tmp/cosign.pub` 내용, Type: Variable |

## 다음 단계 (Phase C 나머지)

1. GitLab CI 변수 수동 업데이트 (위 항목)
2. `develop` 브랜치 push 후 파이프라인 실행 → build→scan→sign→deploy 전 구간 ECR 정상 동작 확인
3. staging E2E 검증 (MariaDB, OAuth, 시세, 뉴스, OCR)
4. ACM 인증서 `ISSUED` 확인 후 ALB Ingress 생성 (tutum.my 도메인 연결)
