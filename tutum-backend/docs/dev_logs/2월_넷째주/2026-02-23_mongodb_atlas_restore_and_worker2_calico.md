# 2026-02-23 MongoDB Atlas 이관 및 worker2 Calico 이슈 점검
## 1. 오늘 목표
- Atlas MongoDB 데이터를 Kubernetes 내부 MongoDB Replica Set으로 이관.
- 이관 후 파드/Replica Set 상태와 데이터 건수 검증.
- worker2 불안정 징후(Calico, MongoDB 재시작) 원인 범위 축소.

## 2. 수행 내용
### 2-1. MongoDB 이관 경로 정리
- 로컬 타깃: `tutum-data` 네임스페이스 MongoDB 서비스.
- 포트포워딩 기반 로컬 복원 경로 사용:
  - `kubectl -n tutum-data port-forward svc/mongodb 27017:27017`

### 2-2. 이관 도구 설치 및 덤프/복원
- `mongodb-database-tools` 설치.
- Atlas -> dump:
  - `mongodump --uri "$ATLAS_MONGODB_URL" --db clouddx --gzip --archive=/tmp/clouddx-atlas.gz`
- dump 파일 확인:
  - `/tmp/clouddx-atlas.gz` 생성 확인(약 4.5MB).
- dump -> local restore:
  - `mongorestore --uri "mongodb://localhost:27017" --nsInclude="clouddx.*" --drop --gzip --archive=/tmp/clouddx-atlas.gz`

### 2-3. 복원 결과
- 복원 성공(0 failures):
  - `clouddx.email_verification_tokens`: 7 docs
  - `clouddx.assets`: 22 docs
  - `clouddx.users`: 11 docs
  - `clouddx.news`: 5479 docs
- `news` 컬렉션 인덱스 메타데이터 복원 로그 확인.

## 3. 이슈/리스크
### 3-1. MongoDB 버전 경고
- 경고: Atlas `8.0.19` -> local `7.0.30` cross-version restore.
- 즉시 장애는 없었지만, 운영 정합성 측면에서 버전 상향/정렬 필요.

### 3-2. worker2 불안정
- `worker2`의 `calico-node`가 `CrashLoopBackOff`.
- 같은 시점 `mongodb-0`가 `worker2`에서 재시작 반복(`CrashLoopBackOff`, `quiesce mode` 로그, `exit=0` 반복).
- 노드 컨디션 자체(`Ready/MemoryPressure/DiskPressure/PIDPressure`)는 정상.
- 결론: 노드 자체 다운보다는 CNI 불안정 영향 가능성이 높음.

## 4. 현재 상태(세션 종료 시점)
- 클러스터 노드: `cp-1`, `cp-2`, `cp-3`, `worker1`, `worker2`, `worker3` 모두 `Ready`.
- MongoDB:
  - `mongodb-1`, `mongodb-2`는 안정 `Running`.
  - `mongodb-0`는 worker2 영향으로 재시작 이력 존재, 추가 모니터링 필요.
- 데이터 이관 자체는 성공(복원 로그 기준).

## 5. 내일 우선 작업
1. worker2 CNI 안정화
- `calico-node` worker2 로그/이벤트 분석 후 재발 방지.
- 필요시 worker2 드레인/복구 또는 Calico 설정 보정.

2. MongoDB 안정성 최종 확인
- `mongodb-0` restartCount 증가 여부 10~15분 모니터링.
- RS health/primary 선출 안정성 재검증.

3. 앱 연동 검증
- `tutum-app` 백엔드/워커가 복원된 MongoDB를 정상 조회하는지 확인.
- 이미지 풀 경로(기존 `192.168.56.12:8080` 잔재) 정리 지속.

## 6. 참고
- 보안: Atlas 계정/비밀번호가 운영 중 노출된 이력이 있어 이관 완료 후 자격증명 회전 필요.
