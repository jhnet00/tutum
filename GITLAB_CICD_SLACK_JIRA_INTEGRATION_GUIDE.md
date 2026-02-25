# GitLab CI/CD Slack + Jira 연동 가이드

> 작성일: 2026-02-25  
> 목적: LGTM 알림과 분리하여, GitLab CI/CD 이벤트를 Slack/Jira로 운영 관리

---

## 1. 목표

- GitLab 파이프라인 상태를 Slack으로 빠르게 공유
- 배포/보안 등 실패 이벤트를 Jira 이슈로 자동 생성
- 커밋/MR과 Jira 이슈를 연결해 변경 이력을 추적

---

## 2. 권장 운영 구조

1. GitLab Integration(기본)으로 Slack 알림 연동
2. GitLab Integration으로 Jira 링크 연동
3. `.gitlab-ci.yml`의 `notify` stage로 실패 시 Jira 자동 발행
4. 알림 폭주 방지를 위해 성공 알림은 최소화, 실패/배포 위주로 운영

---

## 3. 사전 준비

### 3-1. Slack

- Slack Incoming Webhook URL 발급
- 권장 채널
  - `#cicd-notify`: 일반 CI/CD 알림
  - `#cicd-critical`: 배포 실패/보안 실패

### 3-2. Jira

- Jira Cloud URL: 예) `https://infraforge3.atlassian.net`
- Jira API Token 발급
  - https://id.atlassian.com/manage-profile/security/api-tokens
- Jira 프로젝트 Key 확인 (예: `TUTUM`)
- 생성할 Issue Type 확인 (예: `Task`)

### 3-3. GitLab CI/CD Variables 등록

`Settings -> CI/CD -> Variables`에 아래 값을 `Masked + Protected`로 등록:

- `SLACK_WEBHOOK_URL`
- `JIRA_BASE_URL` (예: `https://infraforge3.atlassian.net`)
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `JIRA_PROJECT_KEY` (예: `TUTUM`)

---

## 4. GitLab UI 연동

### 4-1. Slack Integration

1. `Settings -> Integrations -> Slack notifications`
2. Webhook URL 입력
3. 이벤트 선택
   - Pipeline events
   - Job events
   - Deployment events
   - Merge request events
4. Save 후 Test

### 4-2. Jira Integration

1. `Settings -> Integrations -> Jira`
2. URL: `https://infraforge3.atlassian.net`
3. 이메일 + API Token 입력
4. Save 후 Test

이 설정으로 GitLab에서 Jira 이슈 키 인식/링크가 가능해진다.

---

## 5. `.gitlab-ci.yml` 자동 알림 템플릿

아래는 실패 시 Slack/Jira 자동 발행 예시다.

```yaml
stages:
  - lint
  - test
  - build
  - deploy
  - notify

notify:slack_on_failure:
  stage: notify
  image: curlimages/curl:8.7.1
  script:
    - |
      curl -sS -X POST -H "Content-type: application/json" \
      --data "{\"text\":\"[CI FAIL] ${CI_PROJECT_PATH} #${CI_PIPELINE_ID}\n${CI_PIPELINE_URL}\"}" \
      "${SLACK_WEBHOOK_URL}"
  when: on_failure
  rules:
    - if: $CI_COMMIT_BRANCH == "develop"
    - if: $CI_COMMIT_BRANCH == "main"

notify:jira_on_failure:
  stage: notify
  image: curlimages/curl:8.7.1
  script:
    - |
      curl -sS -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
        -H "Content-Type: application/json" \
        -X POST "${JIRA_BASE_URL}/rest/api/3/issue" \
        -d '{
          "fields": {
            "project": { "key": "'"${JIRA_PROJECT_KEY}"'" },
            "summary": "[CI FAIL] '"${CI_PROJECT_PATH}"' #'"${CI_PIPELINE_ID}"'",
            "description": {
              "type": "doc",
              "version": 1,
              "content": [
                {
                  "type": "paragraph",
                  "content": [
                    { "type": "text", "text": "Pipeline URL: '"${CI_PIPELINE_URL}"'" }
                  ]
                }
              ]
            },
            "issuetype": { "name": "Task" }
          }
        }'
  when: on_failure
  rules:
    - if: $CI_COMMIT_BRANCH == "develop"
    - if: $CI_COMMIT_BRANCH == "main"
```

---

## 6. Jira 키 연결 규칙(권장)

커밋/브랜치/MR 제목에 Jira 키를 포함:

- 브랜치: `feature/TUTUM-123-add-alert`
- 커밋: `TUTUM-123 fix pipeline notify`
- MR 제목: `TUTUM-123 CI notify 개선`

이렇게 하면 GitLab-Jira 추적성이 좋아진다.

---

## 7. 검증 체크리스트

1. GitLab Slack Integration Test 성공
2. GitLab Jira Integration Test 성공
3. 의도적으로 CI 실패 발생
4. Slack에 실패 메시지 수신
5. Jira에 자동 이슈 생성
6. `develop/main` 외 브랜치에서는 알림 정책이 의도대로 제한되는지 확인

---

## 8. 트러블슈팅

### 8-1. Slack 미수신

- Webhook URL 오타
- 채널 권한/앱 권한 문제
- GitLab Integration 이벤트 체크 누락

### 8-2. Jira 401/403

- 이메일/API Token 불일치
- Jira 프로젝트 이슈 생성 권한 없음

### 8-3. Jira 400

- 프로젝트 Key 오타
- Issue type 이름 불일치 (`Task`/`Bug` 확인)

### 8-4. 알림 폭주

- 성공 이벤트 알림 비활성
- `rules`를 `main/develop`로 제한

---

## 9. 운영 권장사항

1. Slack은 상태 공유, Jira는 추적/조치 관리로 역할 분리
2. 실패 알림만 자동 생성하고 성공 알림은 최소화
3. 보안 관련 실패(Trivy/Cosign/Kyverno)는 Jira 자동 생성 우선
4. 토큰/웹훅은 절대 코드에 평문 저장 금지

