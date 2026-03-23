# Dev Log: ArgoCD Production 자동 배포 + CI/CD 자체 러너 전환

> 작성일: 2026-03-04
> 작성자: kyungyoonkim
> 브랜치: `develop`
> 관련 이슈: `docs/issues/argocd_production_branch_mismatch.md`

---

## 1. ArgoCD tutum-production 브랜치 불일치 해소

### 문제
`tutum-production` ArgoCD Application이 `main` 브랜치를 추적 중이었으나,
팀은 `develop` 브랜치만 사용 중 → `main`이 수십 커밋 뒤처져 OutOfSync/Degraded 상태.

### 결정: Option B (develop → main 머지 워크플로우 유지)
staging 검증 후 develop을 main에 머지 → ArgoCD 자동 감지 → production 배포하는
표준 워크플로우를 채택.

### 적용 내용

**① develop → main 머지**
```bash
git checkout main
git merge develop
git push origin main
```
- `8bc9c7d` → `1859edd` (91개 파일, 6942줄 추가)
- 이후 팀원 커밋 반영분까지 포함하여 추가 머지 완료

**② tutum-production 자동 Sync 활성화**

파일: `k8s-manifests/argocd/production-app.yaml`

```yaml
# 변경 전
syncPolicy:
  # production은 수동 승인 후 sync (automated 없음)
  syncOptions: ...

# 변경 후
syncPolicy:
  automated:
    prune: true
    selfHeal: true
  syncOptions: ...
```

**③ 클러스터 적용**
```bash
kubectl apply -f k8s-manifests/argocd/production-app.yaml -n argocd
# application.argoproj.io/tutum-production configured
```

### 결과
```
tutum-staging     → develop 브랜치 (자동 Sync) ✅
tutum-production  → main 브랜치    (자동 Sync) ✅
```

**워크플로우 확정:**
```
develop 작업 → develop 푸시 → (검증 후) develop → main 머지 → ArgoCD 자동 배포
```

---

## 2. GitLab CI 공유 러너 소모 문제 해결

### 문제
GitLab 네임스페이스 공유 러너 분이 88/400분(22%)만 남은 상태.
자체 러너(`gitlab-runner` Helm, 2026-02-27 배포)가 있음에도 일부 잡이 공유 러너로 빠지고 있었음.

### 원인
`.gitlab-ci.yml`의 `lint`, `test`, `build` 스테이지 잡에 `tags:`가 없어
자체 러너(`k8s` 태그) 대신 공유 러너에 할당됨.

```yaml
# scan/security/sign/deploy 잡만 tags: [k8s] 설정되어 있었음
# lint/test/build 잡은 tags 없음 → 공유 러너로 fallback
```

### 수정
`.gitlab-ci.yml` 최상단에 `default` 블록 추가:

```yaml
default:
  tags: [k8s]  # 자체 러너 사용 (공유 러너 분 소모 방지)
```

→ 모든 잡이 자체 K8s 러너를 사용하도록 통일.

### 자체 러너 현황
```
Helm chart: gitlab-runner-0.86.0 (GitLab Runner 18.9.0)
Namespace:  gitlab-runner
Executor:   kubernetes (privileged)
Concurrent: 10
Project ID: 79771242
```

---

## 3. flake8 lint 오류 수정

자체 러너 전환 후 파이프라인 재실행 시 `backend/app/routers/admin.py` lint 오류 발생.

| 위치 | 오류 | 내용 |
|------|------|------|
| L681 | E501 | dict comprehension 한 줄 124자 초과 |
| L713 | E501 | dict literal 한 줄 121자 초과 |
| L977 | E131 | `.strftime()` 체이닝 들여쓰기 불일치 |

모두 줄바꿈으로 수정 완료.

---

## 커밋 목록

| 커밋 | 내용 |
|------|------|
| `1859edd` | chore: merge develop into main for production sync |
| `749b81d` | feat(argocd): enable auto-sync for tutum-production |
| `ad47e73` | fix(ci): add default tags [k8s] to prevent shared runner usage |
| `6680733` | fix(lint): resolve flake8 E501/E131 in admin.py |
