# 개발 로그 작업 요약 (2026-03-13)

## 1. 작업 요약
- 작업 일시: 2026-03-13
- 작업자: 김경윤
- 브랜치: develop
- 작업 목적: GitLab을 정본으로 유지하면서 GitHub 저장소를 자동 미러링할 수 있도록 GitLab CI에 mirror job을 추가하고, 현재 GitHub 브랜치도 GitLab 최신 상태로 정렬한다.

## 2. 상세 변경 사항
- `.gitlab-ci.yml`에 `mirror` stage를 추가했다.
- 기본 변수에 `GITHUB_MIRROR_REPO`를 추가해 GitHub 대상 저장소 URL을 한 곳에서 관리하도록 정리했다.
- `mirror:github` job을 추가했다.
  - 실행 조건: `develop`, `main` 브랜치의 `push/web/api` 파이프라인
  - 실행 전제: GitLab CI 변수 `GITHUB_MIRROR_TOKEN` 존재
  - 동작 방식:
    - GitHub remote를 동적으로 추가
    - 대상 브랜치 fetch
    - `--force-with-lease`로 GitHub 브랜치를 GitLab commit SHA 기준으로 동기화
- 자동화 적용 전 현재 remote 상태를 점검했다.
  - `origin/develop`가 `github/develop`보다 `132 commits` 앞선 상태
  - `origin/main`이 `github/main`보다 `230 commits` 앞선 상태
  - GitHub에만 남아 있던 오래된 `5 commits`는 GitLab 정본 기준으로 덮어쓰는 방향으로 정리했다.

## 3. 작업 중 발생 이슈 및 대응
- 이슈: 로컬 메인 워크트리가 이미 dirty 상태였고 `develop`도 `origin/develop`보다 뒤쳐져 있어 직접 수정 시 충돌 위험이 컸다.
- 대응: GitLab `develop` 기준 clean clone을 따로 만들어 CI 변경을 적용하고 검증했다.
- 이슈: `.gitlab-ci.yml` 편집 시 Windows 인코딩/줄바꿈과 한글 주석 때문에 patch 컨텍스트가 안정적으로 맞지 않았다.
- 대응: clean clone에서 내용을 직접 검증한 뒤 UTF-8 기준으로 mirror job을 삽입했다.
- 이슈: GitHub는 GitLab보다 뒤쳐져 있었고 GitHub-only 커밋도 일부 존재했다.
- 대응: GitLab을 source of truth로 고정하고, 현재 브랜치는 `force-with-lease` 기반으로 일회성 정렬 후 이후부터는 GitLab CI가 자동으로 맞추는 구조로 설계했다.

## 4. 결과
- 검증 항목:
  - `.gitlab-ci.yml` YAML 파싱
  - mirror job 존재 여부
  - remote 간 커밋 차이 확인
- 검증 결과:
  - `python + yaml.safe_load` 기준 `.gitlab-ci.yml` 파싱 성공
  - `mirror:github`, `GITHUB_MIRROR_REPO`, `GITHUB_MIRROR_TOKEN` 참조 구문 정상 확인
  - 자동 미러링 범위는 `develop`, `main`으로 제한되어 운영 브랜치만 GitHub에 반영되도록 구성 완료
  - GitLab을 정본으로 두는 정책이 CI 레벨에서도 재현 가능해졌다.

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-13 00:00:00" --until="2026-03-13 23:59:59"
```

- 예정 커밋:
  - `ci: add gitlab-to-github mirror job`
  - `docs(devlog): record gitlab github mirror sync setup`

## 6. 후속 작업/리스크
- GitLab 프로젝트 CI 변수에 `GITHUB_MIRROR_TOKEN`을 반드시 등록해야 자동 미러링이 실제로 동작한다.
- GitHub 브랜치 보호 규칙이 강하면 `force-with-lease` push가 차단될 수 있어 저장소 설정 확인이 필요하다.
- 현재 job은 브랜치 미러링만 수행하며, 태그/릴리스 자산은 별도 정책이 필요하다.
