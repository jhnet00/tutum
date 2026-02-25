# GitLab CI/CD Slack + Jira 연동 가이드

작성일: 2026-02-25  
대상: Tutum 프로젝트(`develop`/`main`)  
목적: LGTM 알림과 분리된 **CI/CD 운영 알림 체계** 구축

---

## 1. 목표

- GitLab 파이프라인 상태를 Slack으로 빠르게 공유
- 배포/보안/테스트 실패 이벤트를 Jira 이슈로 자동 생성
- 커밋/MR/Jira 이슈 연결로 변경 이력 추적

---

## 2. 최종 구조

1. GitLab Pipeline 실행
2. 실패 시 `notify` stage 실행
3. Slack Webhook으로 실패 알림 전송
4. Jira API로 이슈 자동 생성

권장 운영 원칙:
- 성공 알림은 최소화
- 실패/수동 조치 필요 이벤트 중심 알림
- Slack(상태 공유) + Jira(추적/액션) 역할 분리

---

## 3. 사전 준비

## 3-1. Slack 준비

1. Slack App 생성/선택
2. `Incoming Webhooks` 활성화
3. 채널별 Webhook 발급
   - `#cicd-notify`: 일반 실패 알림
   - `#cicd-critical`: 배포/보안 실패 알림(선택)

중요:
- Grafana에서 쓰는 Webhook 재사용은 가능하지만, 운영상 분리 권장
- URL 노출 이력이 있으면 반드시 새로 발급(rotate)

## 3-2. Jira 준비

1. Jira Cloud URL 확인  
   예: `https://infraforge3.atlassian.net`
2. API Token 발급  
   `https://id.atlassian.com/manage-profile/security/api-tokens`
3. 프로젝트 Key 확인  
   예: `TUTUM`
4. 이슈 타입 확인  
   예: `Task`

## 3-3. GitLab 변수 등록

경로:
- GitLab 프로젝트 > `Settings` > `CI/CD` > `Variables`

등록 변수:
- `SLACK_WEBHOOK_URL`
- `JIRA_BASE_URL` (예: `https://infraforge3.atlassian.net`)
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `JIRA_PROJECT_KEY` (예: `TUTUM`)

권장 옵션:
- `Masked`: ON (비밀값)
- `Protected`: 운영 브랜치만 쓸 경우 ON

주의:
- `JIRA_PROJECT_KEY=TUTUM`은 길이 제약으로 `Masked`가 안 될 수 있음
- 이 경우 `JIRA_PROJECT_KEY`는 `Visible`로 저장

---

## 4. GitLab UI 연동 (선택 + 권장)

`.gitlab-ci.yml` notify job만으로도 운영 가능하지만,
UI 연동도 함께 설정하면 가시성이 좋아진다.

## 4-1. Slack Integration

경로:
- GitLab 프로젝트 > `Settings` > `Integrations` > `Slack notifications`

설정:
1. Webhook URL 입력
2. 트리거 최소화(알림 폭주 방지)
   - `A pipeline status changes`
   - `A merge request is created, merged, closed, or reopened`
   - `A deployment is started or finished`
3. 채널 입력칸은 `#tutum-gitlab` 등 CI/CD 전용 채널로 통일
4. Save
5. Test

## 4-2. Jira Integration

환경에 따라 UI에서 Jira 항목이 안 보일 수 있다.
이 경우에도 `.gitlab-ci.yml`에서 Jira REST API 호출 방식으로 자동 생성 가능하다.

---

## 5. CI 파일 수정 위치

현재 Tutum 구조 기준:
- 루트 `.gitlab-ci.yml`: include만 담당
- **실제 수정 파일**: `backend/.gitlab-ci.yml`

즉, notify job은 `backend/.gitlab-ci.yml`에 추가한다.

---

## 6. `.gitlab-ci.yml` notify 템플릿

아래 블록을 `backend/.gitlab-ci.yml`에 반영한다.

```yaml
stages:
  - guard
  - lint
  - test
  - scan
  - build
  - security
  - sign
  - deploy
  - notify

notify:slack_on_failure:
  stage: notify
  image: curlimages/curl:8.7.1
  script:
    - >
      curl -sS -X POST -H "Content-type: application/json"
      --data "{\"text\":\"[CI FAIL] ${CI_PROJECT_PATH} #${CI_PIPELINE_ID}\n${CI_PIPELINE_URL}\"}"
      "${SLACK_WEBHOOK_URL}"
  when: on_failure
  rules:
    - if: '$CI_COMMIT_BRANCH == "develop"'
    - if: '$CI_COMMIT_BRANCH == "main"'

notify:jira_on_failure:
  stage: notify
  image: curlimages/curl:8.7.1
  script:
    - >
      curl -sS -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}"
      -H "Content-Type: application/json"
      -X POST "${JIRA_BASE_URL}/rest/api/3/issue"
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
    - if: '$CI_COMMIT_BRANCH == "develop"'
    - if: '$CI_COMMIT_BRANCH == "main"'
```

---

## 7. Jira 키 연결 규칙 (권장)

브랜치/커밋/MR 제목에 Jira 키 포함:

- 브랜치: `feature/TUTUM-123-cicd-notify`
- 커밋: `TUTUM-123 fix notify pipeline`
- MR 제목: `TUTUM-123 CI notify 개선`

필수는 아니지만, 추적성 향상에 효과적이다.

---

## 8. 검증 절차

1. GitLab Variables 저장 확인
2. Slack Integration Test 성공 확인(UI 설정 시)
3. 의도적 실패 파이프라인 1회 실행
4. Slack 실패 메시지 수신 확인
5. Jira 이슈 생성 확인
6. 이슈 본문에 Pipeline URL 포함 여부 확인

---

## 9. 장애 대응 (트러블슈팅)

## 9-1. Slack 전송 실패

점검:
- `SLACK_WEBHOOK_URL` 오타
- Webhook 비활성화/회수 여부
- 채널 권한/앱 권한
- job 로그의 curl 응답 코드

## 9-2. Jira 401/403

점검:
- `JIRA_EMAIL`, `JIRA_API_TOKEN` 불일치
- API Token 만료/권한 문제
- 프로젝트 이슈 생성 권한 없음

## 9-3. Jira 400

점검:
- `JIRA_PROJECT_KEY` 오타
- `issuetype` 이름 불일치 (`Task`/`Bug`)
- JSON 포맷 오류

## 9-4. 알림 과다

조치:
- `when: on_failure` 유지
- `rules`로 브랜치 범위 제한
- 성공 알림 job 제거

---

## 10. 보안 수칙

1. Webhook/API Token은 코드/문서 본문에 직접 쓰지 않는다.
2. GitLab Variables만 사용한다.
3. URL 노출 발생 시 즉시 rotate한다.
4. 운영 브랜치 변수는 `Protected` 적용한다.

