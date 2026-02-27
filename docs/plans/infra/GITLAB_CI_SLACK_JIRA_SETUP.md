# GitLab CI/CD → Slack / Jira 연동 실행 가이드

> 작성일: 2026-02-27
> 프로젝트: `https://gitlab.com/tutum-project/tutum-app/backend`
> 대상 채널: `#tutum-gitlab` (CI/CD 알림) / `#tutum-alerts` (LGTM 운영 알림, 기설정)

---

## 현재 상태 (Before)

| 항목 | 상태 |
|------|------|
| `.gitlab-ci.yml` notify 잡 | ✅ 작성 완료 (on_failure, develop/main 브랜치) |
| `JIRA_PROJECT_KEY=TUTUM` | ✅ GitLab Variables 등록 완료 |
| `SLACK_WEBHOOK_URL` | ❌ 미등록 (이전 URL 노출로 rotate 필요) |
| `JIRA_EMAIL` | ❌ 미등록 |
| `JIRA_API_TOKEN` | ❌ 미등록 |
| `JIRA_BASE_URL` | ❌ 미등록 |
| GitLab UI Slack Integration | ❌ 미설정 |

---

## 지금 상태로 동작하지 않는 이유 (4가지)

### 문제 1. Variables 미등록 → curl 명령이 빈 URL로 실행됨 ← **핵심 원인**

`SLACK_WEBHOOK_URL`이 GitLab Variables에 없으면 파이프라인 내에서 빈 문자열로 확장된다.

```bash
# 실제 실행되는 명령
curl -fsS -X POST ... ""
# → curl: (3) URL rejected: No host part in the URL
# → exit code 3 → 잡 실패 (allow_failure: true라 파이프라인엔 영향 없음)
```

마찬가지로 `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_BASE_URL`이 없으면:

```bash
# 실제 실행되는 명령
curl -u ":" -X POST ""
# → curl URL error 또는 Jira HTTP 401 Unauthorized
```

**결론: Variables 4개 등록 전까지 notify 잡은 항상 실패한다.**

---

### 문제 2. `on_failure` 조건 — 파이프라인이 생각보다 FAIL이 잘 안 된다

`notify:*` 잡은 `when: on_failure`이다. 이 조건은 파이프라인 전체가 **FAIL 상태**가 되어야 트리거된다.
그런데 현재 CI 파일에서 `allow_failure: true`가 설정된 잡 목록을 보면:

| 잡 | allow_failure |
|----|--------------|
| `guard:commit-policy` | ✅ true |
| `lint:backend` | ✅ true |
| `test:backend` | ✅ true (+ `pytest ... \|\| true`) |
| `sonar:frontend/backend` | ✅ true |
| `security:frontend/backend/workers` | ✅ true |
| `sign:frontend/backend/workers` | ✅ true |
| **`lint:frontend`** | **❌ false** |
| **`test:frontend`** | **❌ false** |
| **`build:frontend/backend/workers`** | **❌ false** |
| **`deploy:staging`** | **❌ false** |

`allow_failure: false`인 잡이 실패해야만 파이프라인이 FAIL이 되고, notify가 뜬다.
즉 docs 커밋, 인프라 manifest 수정 등 **프론트/백 코드 변경이 없는 push는 build 잡이 skip되고 deploy:staging만 실행된다.**

---

### 문제 3. `deploy:staging`이 항상 실패한다 ← **현재 실질적 FAIL 원인**

`deploy:staging`은 `develop` 브랜치 push마다 항상 실행되며, **`K8S_MANIFESTS_TOKEN`이 등록되어 있지 않으면 반드시 실패한다.**

```bash
# 실제 실행
git clone https://oauth2:@gitlab.com/tutum-project/k8s-manifests.git /tmp/manifests
# → fatal: repository not found 또는 HTTP 401 Authentication failed
```

`deploy:staging`은 `allow_failure`가 없으므로 이 실패가 **파이프라인 전체를 FAIL**시킨다.
→ `notify` 잡은 트리거되지만 Variables가 없어서 curl도 실패.

즉 지금은 **파이프라인 FAIL 이유가 "배포 토큰 없음"**이라 notify가 동작해도 의미가 없다.

```
현재 develop push 시 실제 흐름:
  guard (pass) → lint/test (skip or pass) → build (skip or pass)
  → deploy:staging (FAIL: K8S_MANIFESTS_TOKEN 없음)
  → notify:slack/jira (트리거됨, 그러나 curl 빈 URL로 실패)
```

**deploy:staging이 정상화되기 전까지는 모든 파이프라인이 항상 FAIL 상태다.**

---

### 문제 4. Runner는 설치돼 있지만 `k8s` 태그가 없어서 해당 잡이 실행 안 된다

GitLab Runner는 `gitlab-runner` 네임스페이스에 설치되어 **Running 중**이다.
그러나 Runner 환경변수를 확인하면:

```
RUNNER_TAG_LIST:   (비어있음)
```

`tags: [k8s]`가 붙은 잡은 **`k8s` 태그를 가진 Runner만 실행**할 수 있다.
현재 Runner는 태그가 없으므로 `sonar:*`, `security:*`, `sign:*` 잡을 처리하지 못하고 대기 상태가 된다.

```
GitLab SaaS 기본 잡 타임아웃: 1시간
→ k8s 태그 잡 6개가 최대 1시간씩 대기
→ 파이프라인 완료까지 이론상 수 시간 소요
```

이 잡들은 모두 `allow_failure: true`라서 파이프라인 FAIL에는 영향 없지만 **완료 시간이 매우 느려진다.**

**해결 방법**: Runner Helm values에 `k8s` 태그 추가

```bash
# 현재 gitlab-runner Helm 릴리즈 확인
kubectl get configmap -n gitlab-runner gitlab-runner -o yaml | grep -A3 runners

# values.yaml 또는 helm upgrade로 태그 추가
# runners.tags: "k8s"
helm upgrade gitlab-runner gitlab/gitlab-runner \
  -n gitlab-runner \
  --reuse-values \
  --set runners.tags="k8s"
```

> `needs: optional: true` 덕분에 build:* 잡이 skip되면 security/sign 잡도 skip되어
> 코드 변경이 없는 커밋에서는 이 잡들이 실행 안 될 수 있다.

---

### 문제 요약

| # | 문제 | 영향 | 해결 방법 |
|---|------|------|----------|
| 1 | Variables 4개 미등록 | notify curl 항상 실패 | Step 3 수행 |
| 2 | `on_failure` 조건 제한 | allow_failure 잡 실패 시 notify 안 뜸 | 인지만 하면 됨 |
| 3 | `K8S_MANIFESTS_TOKEN` 미등록 | develop push마다 파이프라인 FAIL | `K8S_MANIFESTS_TOKEN` 등록 또는 `deploy:staging`에 `allow_failure: true` 임시 추가 |
| 4 | k8s Runner 태그 미설정 | security/sign 잡 1시간 대기 | `helm upgrade ... --set runners.tags="k8s"` |

---

## 연동 구조 (두 가지 경로)

```
GitLab CI 파이프라인 실패
         │
         ├─→ [경로 A] GitLab UI Slack Integration
         │         → 파이프라인/배포 이벤트 자동 전송
         │         → 별도 CI 잡 불필요, Webhook URL만 등록
         │
         └─→ [경로 B] notify:slack/jira_on_failure 잡
                   → 커스텀 메시지 + Jira 이슈 자동 생성
                   → CI/CD Variables 5개 등록 필요
```

**권장: 경로 A + B 모두 사용**
- A: 파이프라인 시작/완료/실패 기본 알림
- B: 실패 시 Jira 이슈 자동 생성 + 커스텀 Slack 메시지

---

## Step 1. Slack Webhook URL 재발급

> 이전 URL이 노출되었으므로 반드시 재발급 필요

1. [Slack API Apps 페이지](https://api.slack.com/apps) 접속
2. 기존 앱 선택 (또는 새 앱 생성: `Create New App → From Scratch`)
3. 앱 이름: `tutum-gitlab` / 워크스페이스: Infraforge
4. **Incoming Webhooks** 메뉴 → `Activate Incoming Webhooks: ON`
5. **Add New Webhook to Workspace** 클릭
6. 채널 선택: `#tutum-gitlab`
7. 생성된 URL 복사:
   ```
   https://hooks.slack.com/services/T.../B.../...
   ```
8. 기존 노출된 Webhook은 **Revoke** 처리

---

## Step 2. Jira API Token 발급

1. [Atlassian API Token 페이지](https://id.atlassian.com/manage-profile/security/api-tokens) 접속
2. **Create API token** 클릭
3. 이름: `tutum-gitlab` → Create
4. 토큰 복사 (한 번만 표시됨)

필요한 정보 정리:

| 변수 | 값 |
|------|-----|
| `JIRA_BASE_URL` | `https://infraforge3.atlassian.net` |
| `JIRA_EMAIL` | Jira 로그인 이메일 |
| `JIRA_API_TOKEN` | 위에서 발급한 토큰 |
| `JIRA_PROJECT_KEY` | `TUTUM` (이미 등록됨) |

---

## Step 3. GitLab CI/CD Variables 등록

**경로**: `https://gitlab.com/tutum-project/tutum-app/backend` → Settings → CI/CD → Variables

| 변수명 | 값 | Type | Protected | Masked |
|--------|-----|------|-----------|--------|
| `SLACK_WEBHOOK_URL` | `https://hooks.slack.com/services/...` | Variable | ✅ | ✅ Masked |
| `JIRA_BASE_URL` | `https://infraforge3.atlassian.net` | Variable | ✅ | ❌ |
| `JIRA_EMAIL` | 담당자 이메일 | Variable | ✅ | ❌ |
| `JIRA_API_TOKEN` | 발급한 토큰 | Variable | ✅ | ✅ Masked |
| `JIRA_PROJECT_KEY` | `TUTUM` | Variable | ✅ | ❌ (이미 등록됨, Visible) |

> **주의**: `JIRA_PROJECT_KEY`는 4자 이하여서 Masked 적용 불가 → Visible로 유지

등록 순서:
1. **Add variable** 클릭
2. Key / Value 입력
3. Protected: ✅ (main, develop 브랜치에서만 사용 가능)
4. Masked: ✅ (Webhook URL, API Token은 반드시 마스킹)
5. **Add variable** 저장

---

## Step 4. GitLab UI Slack Integration 설정 (경로 A)

**경로**: Settings → Integrations → `Slack notifications`

1. **Active**: ✅ 체크
2. **Webhook**: Step 1에서 발급한 URL 입력
3. **Username**: `GitLab CI` (선택)
4. **Channel**: `#tutum-gitlab`
5. 알림 이벤트 설정 (권장):

   | 이벤트 | 활성화 | 이유 |
   |--------|--------|------|
   | Pipeline events | ✅ | 파이프라인 상태 알림 |
   | Deployment events | ✅ | 배포(staging/production) 알림 |
   | Merge request events | ✅ | MR 생성/승인 알림 |
   | Job events | ❌ | 잡 수 많으면 폭주 |
   | Push events | ❌ | 커밋마다 알림 → 노이즈 |
   | Issue events | ❌ | Jira 사용 중이므로 불필요 |
   | Comment events | ❌ | 노이즈 |
   | Tag push events | ❌ | 필요 시 활성 |

6. **Save changes** → **Test settings** 클릭하여 `#tutum-gitlab`에 테스트 메시지 수신 확인

---

## Step 5. 현재 CI notify 잡 동작 확인

`.gitlab-ci.yml`에 이미 작성된 잡:

```yaml
notify:slack_on_failure:
  stage: notify
  image: curlimages/curl:8.7.1
  allow_failure: true
  script:
    - |
      curl -fsS -X POST -H "Content-type: application/json" \
      --data "{\"text\":\"[CI FAIL] ${CI_PROJECT_PATH} #${CI_PIPELINE_ID}\n${CI_PIPELINE_URL}\"}" \
      "${SLACK_WEBHOOK_URL}"
  rules:
    - if: '$CI_COMMIT_BRANCH == "develop"'
      when: on_failure
    - if: '$CI_COMMIT_BRANCH == "main"'
      when: on_failure
```

동작 조건:
- 모든 브랜치에서 파이프라인이 **성공/실패**했을 때 실행

---

## Step 6. 연동 테스트

Variables 등록 후 아래 방법으로 테스트:

### 방법 A: 의도적 실패 커밋

```bash
# .gitlab-ci.yml에 임시 실패 잡 추가
cat >> .gitlab-ci.yml << 'EOF'

test-fail:
  stage: guard
  script:
    - exit 1
EOF

git add .gitlab-ci.yml
git commit -m "test: intentional failure for slack/jira notify test"
git push gitlab HEAD:develop
```

파이프라인 실패 후:
- `#tutum-gitlab` Slack 채널에 `[CI FAIL] tutum-project/...` 메시지 수신 확인
- Jira 프로젝트 `TUTUM`에 이슈 자동 생성 확인

테스트 완료 후 임시 잡 제거:
```bash
git revert HEAD
git push gitlab HEAD:develop
```

### 방법 B: GitLab Web IDE에서 테스트 파이프라인 실행

1. GitLab → CI/CD → Pipelines → Run Pipeline
2. Branch: develop 선택 → Run
3. `notify:*` 잡은 `on_failure`이므로 파이프라인 정상 완료 시 실행 안 됨
4. 의도적 실패가 있어야 notify 잡 트리거됨

---

## Step 7. Jira Integration (UI 방식, 선택)

GitLab UI에서 Jira와 연결하면 커밋 메시지/브랜치에서 Jira 이슈 키 자동 인식:

**경로**: Settings → Integrations → `Jira`

| 설정 | 값 |
|------|-----|
| URL | `https://infraforge3.atlassian.net` |
| Username | Jira 로그인 이메일 |
| Password/Token | Jira API Token |

> Jira integration이 UI에 보이지 않는 경우: GitLab 버전에 따라 "Jira issues" 항목이 다른 경로에 있을 수 있음. 없어도 `notify:jira_on_failure` CI 잡으로 동일 효과.

---

## 완료 후 채널 구조

| Slack 채널 | 알림 소스 | 내용 |
|-----------|----------|------|
| `#tutum-alerts` | Grafana (LGTM) | K8s 운영 알림 (CPU/메모리/에러율 등) |
| `#tutum-gitlab` | GitLab UI Integration | 파이프라인 시작/완료/실패, MR, 배포 |
| `#tutum-gitlab` | notify:slack_on_failure | 파이프라인 실패 시 커스텀 메시지 + Jira 이슈 번호 |

---

## 체크리스트

- [ ] Slack Webhook URL 재발급 (기존 노출 URL revoke)
- [ ] Jira API Token 발급
- [ ] GitLab Variables 등록: `SLACK_WEBHOOK_URL`, `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`
- [ ] GitLab UI Slack Integration 설정 → Test settings 성공
- [ ] 의도적 실패 파이프라인으로 `#tutum-gitlab` 수신 확인
- [ ] Jira `TUTUM` 프로젝트에 이슈 자동 생성 확인
- [ ] 테스트 커밋 revert 또는 정리

---

## 트러블슈팅

### Slack 메시지 미수신
- `SLACK_WEBHOOK_URL` Variables 등록 여부 확인 (Protected 체크 → develop 브랜치에서 동작)
- GitLab 파이프라인 로그 → `notify:slack_on_failure` 잡 로그 확인
- Webhook URL 유효성: `curl -X POST -d '{"text":"test"}' <WEBHOOK_URL>`

### Jira 이슈 미생성 (HTTP 401)
- `JIRA_EMAIL` + `JIRA_API_TOKEN` 조합 확인
- Jira 계정에 해당 프로젝트 이슈 생성 권한 확인

### Jira 이슈 미생성 (HTTP 400)
- `JIRA_PROJECT_KEY=TUTUM` 정확한지 확인
- Jira 이슈 타입 `Task`가 `TUTUM` 프로젝트에 존재하는지 확인
- [Jira API 직접 테스트](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/):
  ```bash
  curl -u "이메일:API토큰" \
    -H "Content-Type: application/json" \
    -X POST "https://infraforge3.atlassian.net/rest/api/3/issue" \
    -d '{"fields":{"project":{"key":"TUTUM"},"summary":"test","issuetype":{"name":"Task"}}}'
  ```

### notify 잡이 아예 실행 안 됨
- `on_failure` 조건: 이 잡은 파이프라인 내 **다른 필수 잡이 실패**해야 실행됨
- `allow_failure: true` 잡의 실패는 on_failure 트리거 안 됨 (guard, sonar, security, sign 등은 모두 allow_failure)
- 실제로 파이프라인을 FAIL시키는 잡: `deploy:staging` (allow_failure 없음) 또는 `lint/test/build` 잡
