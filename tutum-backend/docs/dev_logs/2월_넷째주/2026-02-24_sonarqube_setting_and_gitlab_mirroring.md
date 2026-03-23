# 2026-02-24 Sonarqube and GitLab Mirroring

## 1. 작업 개요
- 작업 날짜: 2026-02-24
- 대상 경로: `d:/dev/tutum`
- 참여자
  - 수행: **김루비**
  - 협업: **김정호**
- 목적
  - SonarQube 장애 복구 후 안정 운영 전환
  - GitLab 연동 정책 정리 (Frontend/Backend 분리 레포 혼선 제거)
  - 후속 인프라/서비스 연동 항목 정리

## 2. 시작
- 2026-02-23 ~ 2026-02-24 초기엔 SonarQube가 자주 `0/1`, `CrashLoopBackOff`, `Back-off restarting` 상태로 머물러 있었고 DB 연결 실패/기동 지연이 반복됨.
- 동시에 CI 정책이 Frontend/Backend를 별도 GitLab 프로젝트 기준으로 작성해 오면서, 실제 소스 기준이 `github`인지 `gitlab`인지가 섞여 있어 문서/운영이 흐트러짐.
- 사용자 요구에 따라 GitHub 기준(`d:/dev/tutum`)으로 통합 운영 방향으로 정리하기로 결정.

## 3. 과정

### 3-1. SonarQube 장애 분석 및 안정화
- 문제 증상
  - `worker2`의 `node-role`/taint, 네트워크 상태와 메모리 자원 이슈로 스케줄링 실패 이력
  - `init` 단계의 `wait-for-db`가 DNS/서비스 준비 타이밍에 민감
  - Elasticsearch JVM bootstrap에서 `initial heap != max heap` 이슈로 프로세스 종료 반복
  - Readiness/Warmup 지연으로 SonarQube 상태가 오래 `0/1` 유지
- 대응 내용
  - Helm 값(`sonarProperties`, `resources`, `probe`, `nodeSelector`) 정합성 재점검 및 정리
  - `sonar.search.javaOpts` / `sonar.web.javaOpts` / `sonar.ce.javaOpts` 힙 크기 정합성 맞춤
  - DB 서비스/DNS/Endpoints 정상 조회 확인
  - init-sysctl / concat-properties 단계 통과 후 app 기동 확인
  - Elasticsearch가 정상 올라온 뒤 web/CE가 순차 기동되도록 로그/상태 검증
- 결과
  - `SonarQube is operational` 로그 확인
  - Pod 상태가 최종적으로 `1/1 Running`

### 3-2. 사용자 인증(OAuth) 오류 후속 수정
- 발생 이슈
  - OAuth callback에서 `{"detail":"OAuth state ..."}` 형태의 state 검증 실패 보고
- 조치
  - `backend/app/routers/auth.py`의 state 관리 로직 보강
    - Redis 캐시 조회 실패/타입 이슈를 방어할 수 있는 검사 추가
    - 상태값 실패 시 폴백 저장소 경로를 통해 동일 동작 확보
    - callback 비교 로직에서 state 예외 케이스 안정화
  - `python -m py_compile`으로 파일 문법 점검 완료
- 비고
  - OAuth fix는 SonarQube/CI 이슈와 별개로 이어서 추적 필요하나, 이번 단계에서 상태 검증 로직은 반영됨

### 3-3. GitLab 미러링 정책 정합화 (핵심 변경)
- 기존 상황
  - Frontend/Backend를 분리 GitLab 프로젝트 기준으로 처리하다 보니 GitHub 기준 코드 경로와 불일치 발생
  - GitLab remote 등록/브랜치 정책을 수동 조정하면서 충돌 이슈 반복
- 최종 기준 확정
  - **GitHub를 단일 소스 기준**으로 사용 (`D:/dev/tutum` 전체)
  - Frontend/Backend는 GitHub에서 동일 레포 경로 기준으로 관리
  - GitLab은 **미러링 대상 pull 전용**으로 전환
    - GitLab에서 직접 push/pull conflict를 줄이기 위해 GitLab remote 등록은 정리 대상
    - GitLab 쪽은 이미 구성된 mirror 정책(main/develop)을 이용해 주기적으로 GitHub 변경분을 반영
- 문서 반영
  - `SONAR_HOST_URL`, `SONAR_TOKEN`, 프로젝트 키 설정은 CI 변수 기반으로 통합 관리
  - GitLab에서는 브랜치 정책 충돌로 인한 push 에러를 피하기 위해 push 중심 워크플로를 사용하지 않음

### 3-4. 접근 및 운영 포인트 정리
- 임시 확인 경로(터널링)
  - `kubectl -n sonarqube port-forward svc/sonarqube-sonarqube 9000:9000`
  - SSH 포워딩: `ssh -L 9090:127.0.0.1:9000 clouddx@192.168.0.220`
  - 브라우저: `http://127.0.0.1:9090`
- SonarQube 최초 로그인
  - `admin / Himedia1234!`
- 토큰 반영
  - `SONAR_HOST_URL`은 터널링 URL(`http://127.0.0.1:9090`) 사용
  - `tutum-backend`, `tutum-frontend` 각각 토큰은 GitLab CI 변수에 분리 저장

## 4. 결론
- SonarQube 기동 자체는 안정화 되었고, 로그 기준 web/ES/CE가 연동되어 운영 가능한 상태로 판단.
- GitLab CI/미러링은 “GitHub 기준, GitLab pull 자동 반영” 정책으로 정리되어 수동 충돌 포인트를 줄임.
- OAuth state 오류도 backend 측에서 방어 로직이 보강되어 재현성 낮춤.

## 5. 후속 진행사항
1. 온프레미스 자원 적재 확인 및 k8s 이전
   - MinIO(image registry)
   - AWS SES/SQS(회원가입 이메일 검증)
   - Google Vision OCR
   - 각 서비스별 Deployment/Secret/ConfigMap/Service 상태 및 동작 확인
2. LGTM 완료 후 Dashboard 연결
   - Frontend 대시보드와 Back API/DB/인증 체계 연동
   - 분석/모니터링 지표 노출 포맷 검증
3. Cloudflare 도메인 정식 반영
   - `tutum.my` DNS 레코드/프록시/SSL 설정 점검
   - Ingress/ALB/Ingress-nginx 라우팅 정책과 80/443 전송 테스트

## 6. 커밋 로그
```bash
git log --oneline --since="2026-02-24 00:00" --until="2026-02-24 23:59:59"
```

주요 커밋(현재 기준):
- `52fee497` chore: backup current frontend/backend CI and project updates
- `5cd9de45` chore: remove github-to-gitlab mirror workflow
- `ca6bdfdf` chore: remove mirror test file
- `f15a0c6a` ci: add github-gitlab mirror workflow and test trigger file
- `c122844a` chore(frontend): keep develop-front as frontend-only
- `095997ab` docs: update CICD SonarQube section for separated gitlab repos
- `cc9a9cf6` Re-encode dev log as UTF-8 without BOM
- `3b4be3f0` Add node3 news pipeline K8s manifests and dev log
