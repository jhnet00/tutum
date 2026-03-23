# GitLab Push 트리거 파이프라인 실패 해결 가이드

> 작성일: 2026-02-25
> 증상: Push로 트리거된 파이프라인이 0개 Job으로 즉시 종료됨
> API/Web 트리거는 정상 동작

---

## 1. 증상 요약

| 트리거 방식 | 결과 | Jobs |
|------------|------|------|
| `git push` | 즉시 실패 (finished_at ≤ created_at) | 0개 |
| API (`curl -X POST`) | 정상 실행 | 17개 |
| Web (Run Pipeline) | 정상 실행 | 17개 |

- `yaml_errors: null` → YAML 문법 문제 아님
- `workflow:rules`에 `push` 포함 확인 완료
- `.gitlab-ci.yml` 위치: 저장소 루트 (정상)

---

## 2. 원인 분석

GitLab.com SaaS에서 Push 이벤트 파이프라인이 0 Job으로 끝나는 주요 원인:

### 2-1. CI/CD 설정 비활성화 (가장 유력)

GitLab 프로젝트 설정에서 Push 이벤트에 대한 CI/CD가 비활성화되어 있을 수 있음.

### 2-2. Protected Branch 정책

Protected Branch에서만 파이프라인이 실행되도록 제한되어 있을 수 있음.

### 2-3. Runner 할당 제한

특정 브랜치/태그에 대해 Runner가 할당되지 않을 수 있음.

### 2-4. CI/CD 분리 설정

`Settings > CI/CD > General pipelines`에서 별도 CI 설정 파일 경로가 잘못 지정되어 있을 수 있음.

---

## 3. 해결 순서

### Step 1: CI/CD 설정 파일 경로 확인

1. GitLab 프로젝트 페이지 접속
2. `Settings → CI/CD → General pipelines` 이동
3. **CI/CD configuration file** 항목 확인
   - 올바른 값: `.gitlab-ci.yml` (기본값)
   - 만약 `backend/.gitlab-ci.yml` 등으로 되어 있다면 → `.gitlab-ci.yml`로 수정

### Step 2: CI/CD 활성화 확인

1. `Settings → General → Visibility, project features, permissions` 이동
2. **CI/CD** 토글이 **활성화(Enabled)** 되어 있는지 확인
3. 비활성화되어 있다면 활성화 후 Save

### Step 3: Push 이벤트 파이프라인 설정 확인

1. `Settings → CI/CD → General pipelines` 이동
2. 아래 항목 확인:
   - **Git strategy**: `git clone` 또는 `git fetch` (기본값 유지)
   - **Auto-cancel redundant pipelines**: 체크 해제 (테스트 중엔 비활성)
   - **Skip outdated deployment jobs**: 체크 해제

### Step 4: Branch Protection 확인

1. `Settings → Repository → Protected branches` 이동
2. `develop`, `main` 브랜치가 있는지 확인
3. **Allowed to push and merge** 권한 확인
4. 필요 시 push 대상 브랜치도 Protected에 추가

### Step 5: Default Branch 확인

1. `Settings → Repository → Branch defaults` 이동
2. **Default branch**가 `develop` 또는 `main`인지 확인
3. Push하는 브랜치와 일치하는지 확인

### Step 6: 프로젝트 CI/CD 상세 설정

1. `Settings → CI/CD → Runners` 이동
2. 프로젝트에 할당된 Runner 확인
   - Shared runners 활성화 여부
   - 특정 Runner에 tag 제한이 있는지 확인

### Step 7: Pipeline 트리거 테스트

```bash
# 1. 간단한 변경 후 Push 테스트
echo "# test $(date)" >> README.md
git add README.md
git commit -m "test: push trigger check"
git push origin develop

# 2. 파이프라인 상태 확인 (GitLab API)
curl -s --header "PRIVATE-TOKEN: <YOUR_TOKEN>" \
  "https://gitlab.com/api/v4/projects/<PROJECT_ID>/pipelines?per_page=3" | \
  python3 -m json.tool

# 3. 파이프라인 Jobs 확인
curl -s --header "PRIVATE-TOKEN: <YOUR_TOKEN>" \
  "https://gitlab.com/api/v4/projects/<PROJECT_ID>/pipelines/<PIPELINE_ID>/jobs" | \
  python3 -m json.tool
```

---

## 4. 추가 디버깅

### CI Lint 검증

GitLab UI에서 CI Lint 도구로 YAML 검증:

1. `Build → Pipeline editor` 이동
2. 좌측 **Lint** 탭 클릭
3. `.gitlab-ci.yml` 내용 붙여넣기
4. **Validate** 클릭
5. 각 Job의 `only/except/rules` 조건이 `push` 이벤트에 매칭되는지 확인

### Pipeline 생성 시뮬레이션

```bash
# CI Lint API로 push 이벤트 시뮬레이션
curl -s --header "PRIVATE-TOKEN: <YOUR_TOKEN>" \
  --header "Content-Type: application/json" \
  --data '{"content": "<YAML_CONTENT>", "ref": "develop"}' \
  "https://gitlab.com/api/v4/projects/<PROJECT_ID>/ci/lint"
```

### 프로젝트 이벤트 로그 확인

1. `Manage → Activity` 이동
2. Push 이벤트가 기록되어 있는지 확인
3. Pipeline 생성 이벤트가 있는지 확인

---

## 5. 알려진 GitLab.com 이슈

- GitLab SaaS에서 프로젝트 초기 설정 시 CI/CD configuration file 경로가 비표준으로 설정되는 경우가 있음
- `include` 지시어로 다른 파일을 참조하는 경우, 루트 `.gitlab-ci.yml`이 없으면 Push 트리거가 무시됨
- 프로젝트가 Fork인 경우 원본 프로젝트의 CI/CD 설정이 상속될 수 있음

---

## 6. 요약 체크리스트

- [ ] `Settings → CI/CD → General pipelines → CI/CD configuration file` = `.gitlab-ci.yml`
- [ ] `Settings → General → Visibility → CI/CD` = Enabled
- [ ] `Settings → CI/CD → General pipelines → Auto-cancel` 설정 확인
- [ ] `Settings → Repository → Protected branches` 권한 확인
- [ ] `Settings → Repository → Branch defaults` 확인
- [ ] `Settings → CI/CD → Runners` Shared runners 활성화 확인
- [ ] CI Lint로 push 이벤트 매칭 Job 확인
- [ ] 테스트 Push 후 파이프라인 생성 여부 확인
