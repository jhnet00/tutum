# 개발 로그 작업 요약 (2026-02-25)

## 1. 작업 요약
- 작업 일시: 2026-02-25
- 작업자: Kyung Yoon Kim
- 브랜치: develop
- 작업 목적: `GITLAB_PUSH_TRIGGER_FIX_GUIDE.md` 기준으로 Push 트리거 파이프라인 동작을 점검하고, 실패 원인을 수정해 정상 동작 상태로 복구

## 2. 상세 변경 사항
- 파이프라인/프로젝트 상태 점검
  - 프로젝트: `tutum-project/tutum-app/backend` (ID: `79771242`)
  - 확인 항목: `ci_config_path`, `default_branch`, runner 설정, 최근 push 파이프라인 상태
- 실패 원인 분석 (파이프라인 `#30`, SHA `56a548d`)
  - `deploy:staging` 실패 원인: 아카이브된 `tutum-project/k8s-manifests`로 push 시도 (`403`)
  - `notify:*` 실패 원인: Slack/Jira 변수 공란일 때 curl 명령 실패
- CI 설정 수정
  - 파일: `/.gitlab-ci.yml`, `/backend/.gitlab-ci.yml`
  - 수정 내용:
    - `K8S_MANIFESTS_REPO`를 단일 저장소(`tutum-project/tutum-app/backend.git`)로 변경
    - deploy 스크립트가 monorepo 경로(`k8s-manifests/overlays/*/kustomization.yaml`)를 직접 수정하도록 변경
    - deploy 커밋 메시지에 `[skip ci]` 적용
    - deploy 실행 조건 강화:
      - 브랜치 + `K8S_MANIFESTS_TOKEN` 존재 조건
      - `backend/**/*`, `frontend/**/*` 변경 시에만 실행
    - notify 잡에 변수 미설정 방어 로직 추가(미설정 시 `exit 0`으로 skip)
    - `security/sign` 잡에도 `rules:changes`를 추가해 docs-only 커밋에서 불필요 실행 방지

## 3. 작업 중 발생 이슈 및 대응
- 이슈: CI Lint API 호출이 장시간 응답 지연
- 대응:
  - 로컬 YAML 파싱(`python + pyyaml`)으로 문법 확인
  - 실제 `develop` push 파이프라인 실행 결과로 최종 검증 전환

## 4. 결과
- 수정 커밋
  - `253c648`: `ci: fix deploy target repo and harden notify guards`
  - `eba82bc`: `ci: scope security and sign jobs by file changes`
- 검증 파이프라인
  - `#31` (`2348374821`, source=`push`, ref=`develop`) -> `success`
  - Jobs: `14`개 생성(0-job 이슈 미재발)
  - `deploy:staging` -> `success`
  - `notify:slack_on_failure`, `notify:jira_on_failure` -> `skipped` (실패로 인한 파이프라인 중단 없음)
  - `#34` (`2348394897`, source=`push`, ref=`develop`) -> `success`
  - Jobs: `10`개 생성, `security/sign`은 `backend` 관련 잡만 실행됨
- 배포 반영 커밋(파이프라인 자동 생성)
  - `70ad720`: `deploy: staging 253c6483 [skip ci]`
  - `185b558`: `deploy: staging eba82bcc [skip ci]`

## 5. 커밋 로그
```bash
git log --oneline --since="2026-02-25" --until="2026-02-25 23:59:59"
```

## 6. 후속 작업/리스크
- `lint/sonar/security/sign` 일부 잡은 `allow_failure: true` 상태로 운영 중이며, 품질 게이트 강제 여부는 별도 정책 결정 필요
- Slack/Jira 알림을 실제 운영에서 강제하려면 CI/CD 변수(`SLACK_WEBHOOK_URL`, `JIRA_*`) 값/스코프를 프로젝트 정책에 맞게 확정 필요
