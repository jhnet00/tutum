# 개발 로그 작업 요약 (2026-02-26)

## 1. 작업 요약
- 작업 일시: 2026-02-26
- 작업자: 김경윤
- 브랜치: `develop`
- 작업 목적:
  - `news-producer`의 `CrashLoopBackOff` 원인을 제거하고 안정적으로 상시 실행되도록 복구
  - Kubernetes Deployment 스펙 오류(`env` 위치) 수정
  - ArgoCD 동기화 후 실제 운영 상태(롤아웃/로그)까지 검증

---

## 2. 장애 현상 및 원인 분석

### 2-1. 관측된 증상
- Pod 상태: `CrashLoopBackOff`
- `describe pod` 기준:
  - `Last State: Terminated`
  - `Reason: Completed`
  - `Exit Code: 0`
- 로그 패턴:
  - `done. produced_total=...` 출력 후 프로세스 종료

### 2-2. 핵심 해석
- 애플리케이션이 **에러로 죽는 것**이 아니라 **정상 종료(0)** 후 다시 올라오고 있었음
- Deployment는 프로세스 상시 실행이 전제라, one-shot 종료 코드면 재시작 루프가 발생
- 따라서 크래시의 본질은 런타임 예외가 아니라 실행 모델 불일치였음

### 2-3. 세부 원인
1. 환경변수 boolean 파싱이 `"1"`만 true로 인식  
   - ConfigMap에는 `"true"` 값이 존재  
   - 결과적으로 `RUN_FOREVER=false`로 해석되어 1회 실행 후 종료
2. 매니페스트의 `env` 블록이 `containers[]` 바깥에 있어 Deployment 스펙상 부정확

---

## 3. 상세 변경 사항

### 3-1. 코드 수정 (`backend/workers/producer_news.py`)
- `env_bool`, `env_int`, `_env_raw` 헬퍼 추가
- boolean 파싱 확장:
  - true 처리값: `"1"`, `"true"`, `"yes"`, `"y"`, `"on"`
- fallback 추가:
  - `RUN_FOREVER` <- `RUN_FOREVER`, `PRODUCER_RUN_FOREVER`
  - `POLL_INTERVAL_SEC` <- `POLL_INTERVAL_SEC`, `PRODUCER_POLL_INTERVAL_SEC`
  - `LIMIT` <- `LIMIT`, `PRODUCER_LIMIT`
  - `PAGES` <- `PAGES`, `PRODUCER_PAGES`
- 기대 효과:
  - 기존/신규 환경변수 키 혼용 환경에서도 런타임 동작 일관성 확보

### 3-2. 매니페스트 수정 (`k8s-manifests/base/workers/news-producer.yaml`)
- 잘못된 최상위 `env` 제거
- `containers[news-producer].env` 위치로 이동
- 주입 키:
  - `RUN_FOREVER`
  - `POLL_INTERVAL_SEC`
  - `LIMIT`
  - `PAGES`
- ConfigMap 소스:
  - `news-pipeline-config`

---

## 4. 적용 및 검증 절차

### 4-1. ArgoCD 동기화
- `argocd` CLI 미설치로 `kubectl` 경로 사용
- 실행:
```bash
kubectl -n argocd annotate app tutum-app-gitops argocd.argoproj.io/refresh=hard --overwrite
kubectl -n argocd get app tutum-app-gitops -o jsonpath='{.status.operationState.phase}{" / "}{.status.operationState.message}{"\n"}'
```
- 결과:
  - `Succeeded / successfully synced (all tasks run)`

### 4-2. 배포 상태 확인
- 실행:
```bash
kubectl -n tutum-app rollout status deploy/news-producer
kubectl -n tutum-app get pod -l app=news-producer -o wide
```
- 결과:
  - `deployment "news-producer" successfully rolled out`
  - `1/1 Running` 확인

### 4-3. 런타임 로그 검증
- 실행:
```bash
kubectl -n tutum-app logs --tail=120 deploy/news-producer -c news-producer
```
- 확인 포인트:
  - 다수 `produce:` 로그 출력
  - `done. produced_total=...` 이후
  - `[loop] started=... produced_total=...` 반복 출력
- 결론:
  - one-shot 종료 패턴 제거
  - 루프 기반 상시 실행 정상 전환

---

## 5. 작업 중 이슈 및 대응
- 이슈: 로컬 작업 중 파일 인코딩/문자열 깨짐으로 문법 오류 발생
- 대응:
  - `producer_news.py` 파싱 검증(`ast.parse`) 기준으로 문법 정상 확인 후 커밋
  - 불필요한 문자열 변경 제거하고 필요한 로직 변경만 반영

---

## 6. 커밋 로그
```bash
git log --oneline --since="2026-02-26" --until="2026-02-26 23:59:59"
```

- `8803116` fix(news-producer): support true/1 env flags and wire runtime env keys

---

## 7. 후속 작업 / 리스크
- 운영 안정성:
  - `workers:latest` 대신 고정 태그 사용 권장 (재현성/롤백 안정성)
- 관측성:
  - `news-producer` 재시작 횟수 알람 추가
  - `produced_total=0` 연속 발생 알람 기준 정의
- 운영 기준:
  - 정상 기준 로그 패턴을 Runbook에 명시 (`[loop]` 반복 출력 필수)
