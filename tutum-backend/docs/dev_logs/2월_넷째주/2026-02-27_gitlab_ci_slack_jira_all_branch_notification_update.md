# 개발 로그 작업 요약 (2026-02-27)

## 1. 작업 요약
- 작업 일시: 2026-02-27
- 작업자: jhnet00
- 브랜치: `develop`
- 작업 목적:
  - GitLab CI 성공/실패 알림을 Slack/Jira로 연동
  - 기존 `develop/main` 한정 알림을 모든 브랜치 대상으로 확장
  - 팀원 변경사항을 지속 반영하면서 로컬 변경을 안전하게 병합 후 푸시

---

## 2. 상세 변경 사항

### 2-1. `.gitlab-ci.yml` notify 정책 수정
- 기존:
  - 일부 notify 잡이 `develop/main` 브랜치 조건에 의존
  - 실패 알림 중심 구성
- 변경:
  - 성공 알림 잡 추가/정리
    - `notify:slack_on_success`
    - `notify:jira_on_success`
  - 실패 알림 유지
    - `notify:slack_on_failure`
    - `notify:jira_on_failure`
  - 브랜치 조건 제거:
    - `rules: if $CI_COMMIT_BRANCH == ...` 제거
    - `when: on_failure/on_success`만 사용
  - 결과:
    - 파이프라인이 실행되는 모든 브랜치에서 성공/실패 알림 동작

### 2-2. 가이드 문서 업데이트
- 파일: `docs/plans/infra/GITLAB_CI_SLACK_JIRA_SETUP.md`
- 반영 내용:
  - 현재 GitLab UI의 Trigger 명칭 기준 매핑 정리
  - Slack Notifications에서 권장 활성/비활성 이벤트 표 갱신
  - Variables 등록 시 Masked/Visible 기준 명확화
  - Jira 확인 경로(`TUTUM` 프로젝트 List/Issues) 및 검색 키워드(`[CI FAIL]`, `[CI OK]`) 보강

---

## 3. 작업 중 이슈 및 대응

### 3-1. 원격 브랜치 선행 커밋으로 push 거절
- 증상:
  - `git push origin develop` 시 `rejected (fetch first)`
- 대응:
  - `git pull --rebase origin develop` 수행 후 재푸시
  - 충돌 없이 rebase 완료, 최종 푸시 성공

### 3-2. 로컬 변경 파일 존재 상태에서 pull 불가
- 증상:
  - `.gitlab-ci.yml` 로컬 수정으로 `git pull` 중단
- 대응:
  - `git stash push -u` → `git pull` → `git stash pop` 순서로 안전 병합

---

## 4. 결과 (검증 포함)
- Git 반영:
  - 팀원 변경사항을 `develop`으로 다회 Fast-forward 동기화
  - 로컬 변경을 rebase 기반으로 최종 `origin/develop` 반영
- CI 구성 결과:
  - 성공/실패 notify 잡이 모두 정의됨
  - 브랜치 제한 제거로 전 브랜치 대상 알림 정책 확정
- 운영 확인 포인트:
  - 성공 파이프라인: `notify:*_on_success` 실행
  - 실패 파이프라인: `notify:*_on_failure` 실행
  - `allow_failure: true`로 알림 API 실패가 전체 파이프라인 실패로 전파되지 않음

---

## 5. 커밋 로그
```bash
git log --oneline --since="2026-02-27" --until="2026-02-27 23:59:59"
```

- `7ffe4ec` ci(notify): enable success/failure alerts for all branches

---

## 6. 후속 작업 / 리스크
- Jira 알림 과다 가능성:
  - 성공/실패 모두 Jira 이슈 생성 시 이슈 폭증 가능
  - 운영 정책에 따라 `jira_on_success` 비활성 검토 필요
- 알림 채널 정리:
  - Slack 채널을 `#tutum-gitlab` 등 단일 채널로 고정 권장
- 검증 권장:
  - 성공 1회, 실패 1회 파이프라인을 의도적으로 실행해 Slack/Jira 양쪽 수신 확인
