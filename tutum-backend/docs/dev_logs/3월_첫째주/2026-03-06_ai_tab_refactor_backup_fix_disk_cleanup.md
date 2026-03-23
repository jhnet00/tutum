# 개발 로그 작업 요약 (2026-03-06)

## 1. 작업 요약
- 작업 일시: 2026-03-06
- 작업자: Kyungyoon Kim
- 브랜치: develop
- 작업 목적:
  1. Admin 대시보드 AI 분석 탭 제거 → 탭별 인라인 AI 분석 버튼으로 리팩토링
  2. 백업 CronJob 3종 실패 원인 수정 (mongodb / etcd / elasticsearch)
  3. KPI 카드 Sparkline에 hover 툴팁 추가
  4. GitLab Runner 노드(worker1) 디스크 부족으로 인한 파이프라인 실패 해소

---

## 2. 상세 변경 사항

### 2-1. AI 분석 탭 리팩토링
- 변경 파일: `backend/app/routers/admin.py`, `frontend/app/admin/page.tsx`
- **기존**: 별도 "AI 분석" 탭에 클러스터/파이프라인 진단 2종만 존재
- **변경**: AI 분석 탭 제거, 각 탭(Overview·Infra·Pipeline·데이터·백업·Logs·Traces) 하단에 `✦ AI 분석` 버튼 추가

**백엔드 신규 엔드포인트 5종:**
| 엔드포인트 | 분석 대상 |
|---|---|
| `GET /infra-diagnose` | K8s 노드·파드 상태 (CPU/MEM/재시작) |
| `GET /data-diagnose` | ES·Redis·Kafka·MongoDB·Disk 메트릭 |
| `GET /log-diagnose` | Loki 최근 1시간 ERROR 로그 패턴 |
| `GET /trace-diagnose` | Tempo 5xx 에러·지연 트레이스 |
| `GET /backup-diagnose` | CronJob 백업 실행 결과 |

- `_call_bedrock_standard()` 공통 헬퍼 추가 (Bedrock 호출 + JSON 파싱 중복 제거)
- 모든 신규 엔드포인트는 `_DIAGNOSE_SYSTEM_PROMPT` 포맷 통일 (`severity / summary / issues / recommendations`)
- Pipeline 탭은 기존 `PipelineDiagnosis` 포맷(컴포넌트별 분석) 유지

**프론트엔드:**
- `DiagPanel` 재사용 컴포넌트 추가 (severity 색상 + issues + recommendations 렌더링)
- `tabDiag` state (`Record<string, {result, loading}>`) + `runTabDiag()` 헬퍼 추가
- TypeScript 타입 체크 통과 (`npx tsc --noEmit`)

---

### 2-2. 백업 CronJob 실패 수정

**파일:** `k8s-manifests/base/backup/mongodb-backup.yaml`
- **원인:** `mongo:7.0` 이미지(Ubuntu:jammy 기반)에 `curl` 미포함
- **수정:** `apt-get install wget` 후 `wget`으로 MinIO mc 바이너리 설치

**파일:** `k8s-manifests/base/backup/etcd-backup.yaml`
- **원인:** Alpine `apk add mc` = Midnight Commander(텍스트 에디터), MinIO 클라이언트 아님
- **수정:** `wget`으로 MinIO mc 공식 바이너리 직접 설치

**파일:** `k8s-manifests/base/data/elasticsearch.yaml`, `k8s-manifests/base/backup/elasticsearch-backup.yaml`
- **원인:** ES 8.x는 S3 저장소 설정에 인라인 `access_key`/`secret_key` 거부 (`Setting [access_key] is insecure`)
- **원인2:** `repository-s3`는 ES 8.x 내장 모듈 → `install-s3-plugin` initContainer 불필요
- **수정:**
  - `install-s3-plugin` initContainer 제거
  - `setup-keystore` initContainer 추가: MinIO 자격증명을 ES keystore에 주입
  - `keystore-dir` emptyDir + subPath volumeMount로 메인 컨테이너에 keystore 전달
  - `elasticsearch-backup.yaml`에서 S3 저장소 설정의 인라인 credentials 제거

---

### 2-3. KPI Sparkline hover 툴팁
- 변경 파일: `frontend/app/admin/page.tsx`
- `Sparkline` 컴포넌트에 recharts `Tooltip` 추가
- 마우스 오버 시 시간(`-55m` ~ `현재`) + 값(단위 포함) 표시
- cursor 라인으로 현재 위치 시각적 표시
- 차트 높이 32px → 48px 확대
- `unit` / `decimals` prop 추가 → RPS(숫자), P95(ms), Error Rate(%), Kafka Lag(숫자) 단위 맞춤

---

### 2-4. worker1 디스크 정리 (파이프라인 실패 해소)
- **증상:** GitLab CI `build:frontend` 스테이지에서 ephemeral storage 부족으로 파드 강제 종료
  - threshold: 6,134,371,366 bytes / available: 5,898,612 Ki → eviction 발생
- **원인:** worker1 노드에 구버전 컨테이너 이미지 + journald 로그 누적 (디스크 30G/39G = 81%)
- **해결:** kubectl privileged 파드(`worker1-cleanup`) 배포 → `crictl rmi --prune` + journald vacuum 실행
  - 삭제 이미지: cosign, trivy, 구버전 frontend/workers 이미지 등 다수
  - journald 아카이브 2.2GB 삭제
  - 정리 후: 23G/39G = 64% (여유 7G → 14G)

---

## 3. 작업 중 발생 이슈 및 대응

| 이슈 | 원인 | 대응 |
|---|---|---|
| SSH 접속 실패 (tutum 유저) | 이 PC의 키가 tutum 계정 미등록 | clouddx 유저로 전환 후 성공 |
| worker1 SSH 직접 접속 불가 | cp-1에 id_claude_auto 키 없음, sshpass 미설치 | kubectl privileged 파드로 우회 |
| Traces 탭 TSX 구문 오류 | AI 패널을 IIFE return() 바깥에 삽입 | IIFE 내부 div 닫기 순서 수정 |
| git push reject (팀원 커밋 충돌) | 팀원이 동시간대 `.gitlab-ci.yml` 수정 커밋 | `git stash → pull --rebase → stash pop → push` |

---

## 4. 결과

- TypeScript: `npx tsc --noEmit` 통과
- 커밋:
  - `44093f2` feat(admin): add per-tab AI analysis buttons with 5 new diagnose endpoints
  - `5136cc7` fix(backup): fix backup job failures - wget, mc binary, ES keystore
  - `1e79590` feat(admin): add hover tooltip to KPI sparkline charts
- develop 브랜치 push 완료
- GitLab CI 파이프라인 재실행 대기 중 (worker1 디스크 정리 후)
