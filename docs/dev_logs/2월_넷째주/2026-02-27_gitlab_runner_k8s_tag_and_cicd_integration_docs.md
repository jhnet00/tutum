# 개발 로그 작업 요약 (2026-02-27)

## 1. 작업 요약
- 작업 일시: 2026-02-27
- 작업자: jhnet00
- 브랜치: jun/dev0213 (← gitlab/develop 최신화 후 작업)
- 작업 목적: GitLab Runner에 `k8s` 태그 추가, CI/CD 파일 구조 문서화, Slack/Jira 연동 설정 가이드 작성

---

## 2. 상세 변경 사항

### 2-1. gitlab/develop 최신화 (pull)
- `87bd46c` — `Merge branch 'ruby-backup0225' into develop` 반영
- 포함된 주요 변경:
  - `backend/.gitlab-ci.yml`, `frontend/.gitlab-ci.yml` 삭제 (팀 결정으로 중복 파일 제거)
  - notify 잡 `rules:` 제거 (단순화된 형태로 되돌려짐)
  - 백엔드/프론트엔드 코드 다수 업데이트

### 2-2. GitLab Runner `k8s` 태그 추가 (Helm upgrade)
- **대상**: K8s `gitlab-runner` 네임스페이스에 설치된 gitlab-runner Helm 릴리즈
- **문제 상황**: Runner가 Running 중이었으나 `RUNNER_TAG_LIST`가 공란이어서 `tags: [k8s]`가 지정된 잡(`sonar:*`, `security:*`, `sign:*`)을 처리하지 못했음
- **적용 방법**: `cp-1(192.168.0.220)`에 `/tmp/runner-values-patch.yaml` 생성 후 Helm upgrade 실행

  ```yaml
  # /tmp/runner-values-patch.yaml
  runners:
    config: |
      [[runners]]
        [runners.kubernetes]
          namespace = "gitlab-runner"
          image = "ubuntu:22.04"
        tags = "k8s"
  ```

  ```bash
  helm upgrade gitlab-runner gitlab/gitlab-runner \
    -n gitlab-runner \
    --reuse-values \
    -f /tmp/runner-values-patch.yaml
  ```

- **결과**: REVISION 2로 업그레이드 완료, 신규 파드 `gitlab-runner-c68f65459-2fhdh` 1/1 Running
- **검증**: `kubectl exec -n gitlab-runner <pod> -- cat /etc/gitlab-runner/config.toml` → `tags = "k8s"` 확인, Runner 로그에 `"Runner registered successfully"` 출력 확인

### 2-3. CI/CD 파일 구조 문서화
- **파일**: `docs/plans/infra/GITLAB_CI_FILES_GUIDE.md` (신규 작성)
- **내용**:
  - 루트 `/.gitlab-ci.yml`만 실제 동작하는 Active 파일임을 명시
  - `backend/`, `frontend/` 하위 `.gitlab-ci.yml`은 각각 Legacy/Obsolete로 분류
  - 삭제 권장 및 GitLab이 단일 파일만 읽는 구조 설명

### 2-4. GitLab CI Slack/Jira 연동 설정 가이드 작성
- **파일**: `docs/plans/infra/GITLAB_CI_SLACK_JIRA_SETUP.md` (신규 작성)
- **내용**:
  - 현재 동작 불가 원인 4가지 명시
    1. CI/CD Variables 미등록 (`SLACK_WEBHOOK_URL`, `JIRA_*`)
    2. `on_failure` 조건 한계 (대부분 잡이 `allow_failure: true`)
    3. `deploy:staging` 실패 시 파이프라인 전체 FAIL
    4. Runner `k8s` 태그 미설정 (→ 이번 작업으로 해소)
  - 단계별 설정 방법: Slack Webhook 발급 → GitLab Variables 등록 → UI Integration → 테스트
  - 트러블슈팅 섹션 포함
  - 보안 주의사항: `SLACK_WEBHOOK_URL` 노출 이력 → Webhook 재발급 필요

---

## 3. 작업 중 발생 이슈 및 대응

### 이슈 1: Runner 태그 설정 방법 혼동
- **내용**: `RUNNER_TAG_LIST` 환경변수가 공란이어도 정상인지, `config.toml`에 직접 설정해야 하는지 불분명
- **대응**: Helm chart 구조 확인 — `RUNNER_TAG_LIST`는 최초 등록 시 사용, 이후에는 `config.toml`의 `tags` 값이 실제 job 필터링에 사용됨을 확인. Helm upgrade로 config.toml 직접 수정하는 방식 채택.

### 이슈 2: Helm rollout 확인 timeout
- **내용**: `kubectl rollout status --timeout=60s` 명령이 timeout으로 실패
- **대응**: 직접 `kubectl get pods`로 신규 파드 Running 상태 확인 (정상 기동됨)

---

## 4. 결과

| 항목 | 결과 |
|------|------|
| gitlab/develop 최신화 | ✅ `87bd46c` 반영 완료 |
| GitLab Runner `k8s` 태그 추가 | ✅ Helm REVISION 2, 파드 재배포 완료 |
| config.toml `tags = "k8s"` 확인 | ✅ |
| Runner 등록 성공 로그 확인 | ✅ `Runner registered successfully` |
| `docs/plans/infra/GITLAB_CI_FILES_GUIDE.md` | ✅ 신규 작성 |
| `docs/plans/infra/GITLAB_CI_SLACK_JIRA_SETUP.md` | ✅ 신규 작성 |

---

## 5. 커밋 로그
```bash
git log --oneline --since="2026-02-27" --until="2026-02-27 23:59:59"
```

---

## 6. 후속 작업/리스크

### 필수 (수동 작업 — GitLab UI)
1. **GitLab CI/CD Variables 등록** (`Settings → CI/CD → Variables`)
   - `SLACK_WEBHOOK_URL` — 기존 URL 노출 이력 있음, **반드시 Webhook 재발급 후 등록**
   - `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`
   - `K8S_MANIFESTS_TOKEN` (deploy:staging용 PAT)
2. **GitLab UI Slack Integration** (`Settings → Integrations → Slack notifications`)
   - Webhook URL, 채널(`#tutum-cicd`) 입력 및 이벤트 체크

### 검증 필요
3. **Runner `k8s` 태그 실효 확인**: 다음 파이프라인에서 `sonar:*`, `security:*`, `sign:*` 잡이 정상 처리되는지 확인
4. **Slack/Jira 알림 테스트**: Variables 등록 후 의도적 실패 파이프라인 1회 실행하여 Slack 수신 및 Jira 이슈 생성 확인

### 리스크
- Slack Webhook URL 노출 이력 → 재발급 전까지 알림 기능 비활성 상태 유지 권장
- `notify:*` 잡에 `rules:` 없음 → 전 브랜치에서 실패 시 알림 발생 (알림 폭주 가능)
