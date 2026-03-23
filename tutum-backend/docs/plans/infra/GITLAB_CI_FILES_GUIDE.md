# GitLab CI/CD 파일 현황 정리

> 작성일: 2026-02-26

---

## 전체 구조

```
clouddx-project/
├── .gitlab-ci.yml               ← ✅ 실제 동작하는 파일 (Active)
├── backend/
│   └── .gitlab-ci.yml           ← ⚠️ 비활성 중복 파일 (Legacy)
└── frontend/
    └── .gitlab-ci.yml           ← ❌ 완전히 구버전 (Obsolete)
```

---

## 1. `/.gitlab-ci.yml` (루트) — **현재 유일하게 동작하는 파일**

### 동작 방식

GitLab은 기본적으로 저장소 **루트의 `.gitlab-ci.yml`** 을 CI 설정 파일로 사용한다.
`Settings → CI/CD → General pipelines → CI/CD configuration file` 항목이 `.gitlab-ci.yml` (기본값)으로 설정되어 있으면 이 파일이 모든 파이프라인을 제어한다.

### 현재 설정 요약

| 항목 | 내용 |
|------|------|
| 레지스트리 | GitLab CR (`registry.gitlab.com/tutum-project/`) |
| Runner | 공유 Runner (기본) + `tags: [k8s]` (SonarQube, Trivy, Cosign용) |
| 스테이지 | guard → lint → test → scan → build → security → sign → deploy → notify |
| 트리거 | push, api, web, merge_request_event |
| 배포 방식 | GitOps (k8s-manifests repo 이미지 태그 업데이트 → ArgoCD auto-sync) |
| 알림 | Slack + Jira (파이프라인 실패 시, develop/main 브랜치만) |

### 스테이지별 설명

```
guard     → 커밋 정책 검사 (.gitignore 매칭 파일 감지)
lint      → ESLint (프론트엔드), flake8 (백엔드)
test      → npm build (프론트엔드), pytest (백엔드)
scan      → SonarQube 정적 분석 [k8s runner 필요]
build     → Docker 빌드 & GitLab CR 푸시
security  → Trivy 이미지 취약점 스캔 [k8s runner 필요]
sign      → Cosign 이미지 서명 [k8s runner 필요]
deploy    → k8s-manifests repo 이미지 태그 업데이트
notify    → Slack/Jira 실패 알림 (on_failure)
```

### 주요 특징

- `rules: changes:` 로 변경된 파일에 해당하는 잡만 실행 (불필요한 빌드 스킵)
- `needs: optional: true` 로 이전 스테이지 잡이 skip되어도 config error 없음
- `tags: [k8s]` 잡은 모두 `allow_failure: true` → k8s Runner 미설치 시 파이프라인 전체는 통과

---

## 2. `/backend/.gitlab-ci.yml` — **비활성 레거시 파일**

### 탄생 배경

초기에 GitLab CI 설정 경로가 `backend/.gitlab-ci.yml`로 지정되어 있어서 push 트리거 파이프라인이 0 jobs로 실패했다.
이를 고치는 과정에서 루트 파일과 백엔드 파일이 각자 따로 발전했다.

현재는 루트 `.gitlab-ci.yml`이 완전한 파이프라인을 가지고 있으므로, **이 파일은 GitLab이 사용하지 않는다.**

### 루트 파일과 차이점

| 항목 | 루트 `.gitlab-ci.yml` | `backend/.gitlab-ci.yml` |
|------|----------------------|--------------------------|
| Runner 태그 | scan/security/sign에 `tags: [k8s]` | 태그 없음 (공유 Runner만) |
| Cosign 인증 | `cosign login` 사용 | `docker login` 사용 |
| 내용 | 최신 (2026-02-25 ~26) | 루트보다 살짝 구버전 |

### 권장 조치

**삭제 또는 제거를 권장한다.** 어차피 GitLab이 읽지 않으며, 존재만 해도 혼선을 준다.
단, GitLab 설정에서 CI config 경로를 다시 `backend/.gitlab-ci.yml`로 바꾸지 않는 한 이 파일은 완전히 무해하다.

---

## 3. `/frontend/.gitlab-ci.yml` — **완전히 구버전 (사용 불가)**

### 탄생 배경

프로젝트 초기, Harbor 레지스트리와 ArgoCD CLI를 사용하던 시절의 CI 템플릿이다.
현재 인프라와 전혀 맞지 않는다.

### 현재와 다른 점

| 항목 | 현재 (루트) | `frontend/.gitlab-ci.yml` |
|------|------------|--------------------------|
| 레지스트리 | GitLab CR | ❌ Harbor (`192.168.56.12:8080`) — 서비스 종료 |
| 배포 방식 | GitOps (k8s-manifests) | ❌ `argocd app sync` 직접 호출 |
| 문법 | `rules:` (최신) | ❌ `only:` (deprecated) |
| notify 스테이지 | 있음 | ❌ 없음 |
| CI 설정 경로 | GitLab이 읽지 않음 | GitLab이 읽지 않음 |

### 권장 조치

**즉시 삭제를 권장한다.** 이 파일은 어떤 경우에도 사용하면 안 된다.

---

## 세 파일을 똑같이 맞춰도 되는가?

**결론: 맞출 필요 없고, 오히려 하나로 통합해야 한다.**

GitLab은 CI 설정 경로로 지정된 **단 하나의 파일**만 읽는다.
세 파일을 동기화하는 건 관리 부담만 늘리고 실수의 원인이 된다.

### 권장 정리 방향

```
# 남길 파일
/.gitlab-ci.yml          ← 유지 (현재 동작 중)

# 삭제할 파일
/backend/.gitlab-ci.yml  ← 삭제 (사용되지 않음, 혼란만 야기)
/frontend/.gitlab-ci.yml ← 삭제 (구버전, Harbor/only: 사용)
```

삭제 방법:
```bash
git rm backend/.gitlab-ci.yml frontend/.gitlab-ci.yml
git commit -m "chore: remove obsolete ci config files"
git push gitlab HEAD:develop
```

---

## 현재 파이프라인 동작 흐름 (루트 파일 기준)

```
Push to develop
       │
       ▼
workflow:rules 매칭 (push → 통과)
       │
       ▼
guard:commit-policy  ─── allow_failure: true
       │
       ▼
lint / test  ─── 변경된 파일 있을 때만 (rules: changes:)
       │
       ▼
sonar  ─── 변경 있을 때 + k8s runner [allow_failure]
       │
       ▼
build  ─── 변경 있을 때 (GitLab CR에 이미지 push)
       │
       ▼
security (Trivy) ─── build 완료 후 [allow_failure, optional]
       │
       ▼
sign (Cosign) ─── security 완료 후 [allow_failure, optional]
       │
       ▼
deploy:staging ─── develop 브랜치면 k8s-manifests 업데이트
       │
       ▼
notify (Slack/Jira) ─── 파이프라인 실패 시에만
```

---

## 현재 미설치 / 미완료 상태

| 항목 | 상태 | 영향 |
|------|------|------|
| GitLab Runner (k8s 태그) | ❌ 미설치 | scan/security/sign 잡 stuck → timeout 후 allow_failure로 통과 |
| COSIGN_PRIVATE_KEY | ❌ 미생성 | sign 잡 실패 → allow_failure로 통과 |
| K8S_MANIFESTS_TOKEN | ⚠️ 설정 필요 확인 | deploy:staging 잡 실패 시 파이프라인 FAIL |
| SLACK_WEBHOOK_URL | ⚠️ 설정 필요 확인 | notify 잡 실패 → allow_failure로 통과 |
