# Local Workspace And Git Sync Guide

## 목적

로컬 작업 구조를 GitLab 정본 구조와 맞추고, GitHub `clouddx-project` monorepo가 어떤 조건에서 자동 동기화되는지 명확히 정리한다.

현재 기준 로컬 workspace 루트는 아래 경로다.

- `C:\Users\CloudDX\Documents\GitHub\clouddx-project`

## 현재 로컬 구조

루트는 Git repo가 아니고 plain workspace다.

- `backend/` -> GitLab `tutum-backend.git`
- `frontend/` -> GitLab `tutum-frontend.git`
- `auth/` -> GitLab `auth.git`
- `clouddx-project.code-workspace` -> VS Code multi-root workspace

즉, 이제부터는 루트에서 한 번에 commit/push 하는 구조가 아니다. 각 하위 폴더에서 별도 Git 작업을 해야 한다.

## 작업 규칙

### 1. 백엔드 작업

아래 경로에서 작업한다.

- `C:\Users\CloudDX\Documents\GitHub\clouddx-project\backend`

이 경로에서 commit/push 하면 backend GitLab pipeline이 돈다.

### 2. 프론트엔드 작업

아래 경로에서 작업한다.

- `C:\Users\CloudDX\Documents\GitHub\clouddx-project\frontend`

이 경로에서 commit/push 하면 frontend GitLab pipeline이 돈다.

### 3. 인증 서비스 작업

아래 경로에서 작업한다.

- `C:\Users\CloudDX\Documents\GitHub\clouddx-project\auth`

이 경로에서 commit/push 하면 auth GitLab pipeline이 돈다.

### 4. VS Code 사용 방식

아래 파일을 열어 multi-root workspace로 사용한다.

- `C:\Users\CloudDX\Documents\GitHub\clouddx-project\clouddx-project.code-workspace`

이렇게 열면 창은 하나로 유지하면서 Git repo는 3개로 분리해 관리할 수 있다.

## GitHub 동기화 방식

GitHub는 정본이 아니고 보기용 monorepo다.

- GitHub repo: `https://github.com/kyk02405/clouddx-project`
- 루트 구조:
  - `backend/`
  - `frontend/`
  - `auth/`

자동 동기화는 GitLab CI에서 수행한다.

### GitLab -> GitHub 매핑

- backend repo -> GitHub `backend/`
- frontend repo -> GitHub `frontend/`
- auth repo -> GitHub `auth/`

### 동기화 조건

GitLab CI의 `mirror:github-monorepo` job이 실행되어야 한다.

이 job은 아래 조건을 만족할 때만 생성된다.

- 브랜치가 `develop` 또는 `main`
- pipeline source가 `push`, `web`, `api`
- GitLab CI 변수 `GITHUB_MONOREPO_TOKEN`이 설정돼 있음

## 현재 확인된 상태

### frontend

로컬 clone 기준 `.gitlab-ci.yml`에 아래가 들어가 있다.

- `GITHUB_MONOREPO_REPO`
- `mirror:github-monorepo`
- `scripts/sync-to-github-monorepo.sh`

즉 frontend는 GitLab CI 설정이 들어간 상태다.

### auth

로컬 clone 기준 `.gitlab-ci.yml`에 아래가 들어가 있다.

- `GITHUB_MONOREPO_REPO`
- `mirror:github-monorepo`
- `scripts/sync-to-github-monorepo.sh`

즉 auth도 GitLab CI 설정이 들어간 상태다.

### backend

GitLab 원격 `origin/develop` 기준으로는 same CI 설정이 들어가 있다.

다만 현재 로컬 backend clone HEAD는 아래 상태다.

- 로컬 HEAD: `a94d662b`
- 원격 `origin/develop`: `f6cb49aa`

즉 현재 로컬 backend clone은 GitLab 최신 `develop`보다 뒤에 있다.

따라서 backend에서 GitHub 자동 sync를 기대하려면 먼저 아래를 수행하는 편이 맞다.

```bash
git fetch origin
git pull --ff-only origin develop
```

주의:

- 현재 backend 작업 폴더에는 미반영 로컬 변경이 있으므로, 실제 pull 전에는 변경사항 정리나 백업이 필요하다.

## 현재 로컬에서 확인 불가능한 항목

아래는 GitLab 서버 설정 영역이라 로컬 파일만으로는 확인할 수 없다.

- GitLab 프로젝트/그룹 CI 변수 `GITHUB_MONOREPO_TOKEN` 실제 등록 여부
- 해당 토큰 권한이 GitHub push 가능 범위인지 여부

즉, 로컬 기준으로는 CI job 정의는 확인 가능하지만, 변수 등록 여부는 GitLab UI 또는 GitLab API 권한이 있어야 검증 가능하다.

## 실제 검증 방법

### 1. GitLab 변수 확인

각 GitLab 프로젝트 또는 그룹 설정에서 아래 변수 존재 여부를 확인한다.

- `GITHUB_MONOREPO_TOKEN`

권장 권한은 GitHub repo push 가능한 token이다.

### 2. GitLab pipeline 확인

각 repo에서 `develop` 또는 `main`에 push 후 pipeline에서 아래 job이 생성되는지 본다.

- `mirror:github-monorepo`

이 job이 보이지 않으면 대부분 아래 둘 중 하나다.

- `GITHUB_MONOREPO_TOKEN` 미설정
- 조건에 맞지 않는 브랜치 또는 pipeline source

### 3. GitHub 반영 확인

push 후 GitHub `clouddx-project`에서 해당 폴더만 갱신됐는지 확인한다.

예시:

- backend push -> GitHub `backend/` 변경
- frontend push -> GitHub `frontend/` 변경
- auth push -> GitHub `auth/` 변경

## 권장 운영 기준

### 권장 브랜치

현재 기준으로는 `develop`를 기준 브랜치로 쓰는 것이 가장 안전하다.

이유:

- GitHub monorepo 자동 동기화가 `develop` 기준으로 이미 정리돼 있음
- backend 로컬 작업도 현재 `develop` 기준
- frontend/auth clone도 현재 `develop` 또는 `origin/develop` 중심으로 쓰기 쉬움

### 하지 말아야 할 것

- 루트 `clouddx-project`에서 Git 작업하려고 시도하기
- GitHub repo를 정본처럼 직접 수정하기
- backend/frontend/auth 변경을 한 repo에서 같이 commit/push 하려고 하기

## 빠른 체크리스트

- VS Code는 `clouddx-project.code-workspace`로 열었는가
- 현재 작업 위치가 `backend`, `frontend`, `auth` 중 하나인가
- push 대상 GitLab repo가 맞는가
- GitHub는 정본이 아니라 mirror라는 점을 알고 있는가
- GitHub 자동 sync를 기대한다면 `GITHUB_MONOREPO_TOKEN`이 GitLab에 등록돼 있는가
