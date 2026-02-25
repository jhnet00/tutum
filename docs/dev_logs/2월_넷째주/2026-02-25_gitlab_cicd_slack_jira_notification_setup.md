# 개발 로그 작업 요약 (2026-02-25)

## 1. 작업 요약
- 작업 일시: 2026-02-25
- 작업자: jhnet00
- 작업 목적: GitLab CI/CD 실패 이벤트를 Slack/Jira로 연동하기 위한 운영 가이드 정비 및 실제 설정 경로 검증

## 2. 수행 내용
- CI/CD 알림 가이드 문서 보강 방향 확정
  - 파일: `docs/plans/infra/GITLAB_CICD_SLACK_JIRA_INTEGRATION_GUIDE.md`
  - 보강 포인트:
    - GitLab UI 진입 경로 상세화
    - 실제 수정 파일 위치 명시(`backend/.gitlab-ci.yml`)
    - 변수 등록 규칙(Visibility/Protected/Masked) 실무 기준 정리
    - 실패 시 검증 순서/트러블슈팅 항목 강화
- GitLab 변수 등록 시 제약 확인
  - `JIRA_PROJECT_KEY=TUTUM`은 길이 제약으로 `Masked` 불가
  - 대응: `JIRA_PROJECT_KEY`는 `Visible`로 등록, 비밀값(`SLACK_WEBHOOK_URL`, `JIRA_API_TOKEN`)은 `Masked`/`Masked and hidden` 유지
- Slack Integration 트리거 항목 매핑 확인
  - UI 문구 기준으로 `pipeline/deployment/MR` 항목만 사용하도록 정리
  - issue/comment/tag/wiki/alert 계열은 알림 과다 방지를 위해 비활성화 권장
- Jira UI Integration 미노출 케이스 확인
  - 프로젝트 설정 화면에서 일반 Jira integration 항목이 보이지 않는 환경 확인
  - 대응: UI 통합 없이도 `.gitlab-ci.yml`의 `notify:jira_on_failure`로 Jira API 직접 호출하는 경로 유지

## 3. 핵심 결정
- 알림 경로는 CI 파이프라인 job 중심으로 운영
  - `notify:slack_on_failure`
  - `notify:jira_on_failure`
- 브랜치 제한은 `develop`, `main` 기준으로 적용
- Slack 채널은 `#tutum-gitlab` 사용

## 4. 테스트 계획
1. `backend/.gitlab-ci.yml`에 notify job 반영
2. `develop` 또는 테스트 브랜치에서 의도적 실패 파이프라인 1회 실행
3. Slack 수신 확인
4. Jira 이슈 생성 확인
5. 임시 실패 job 제거 후 정상 파이프라인 복귀

## 5. 이슈/리스크
- 원격 `develop`에 force update 이력 존재 확인
  - 로컬 변경과 충돌 가능성이 높아 pull/rebase 시 stash 전략 필요
- Slack Webhook URL 노출 이력 발생
  - 보안상 webhook rotate(재발급) 필요

## 6. 후속 작업
1. notify job 반영분 파이프라인 테스트 결과를 동일 주차 로그에 추가 기록
2. Jira 키 연결 규칙(`TUTUM-123`)을 브랜치/커밋/MR 명명 규칙으로 팀 합의
3. 필요 시 GitLab Push Rule로 커밋 메시지 Jira 키 패턴 강제 검토
