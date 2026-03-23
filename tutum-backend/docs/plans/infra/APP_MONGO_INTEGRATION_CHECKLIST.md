# App-Mongo 연동 체크리스트 (팀원 실행용)

## 1. 목적

- 대상: CI/CD 담당, MongoDB 담당 외의 3번째 팀원(앱 연동/검증 담당)
- 목표:
  - 애플리케이션이 Atlas가 아닌 K8s 내부 MongoDB ReplicaSet(`mongo-rs`)로 연결되도록 전환
  - 전환 후 `backend`, `price-consumer` 배포 안정화 및 기능 검증
  - 장애 시 즉시 롤백 가능한 상태로 운영 문서화

---

## 2. 역할 분담(오늘 기준)

| 역할 | 담당 범위 | 완료 기준 |
|---|---|---|
| CI/CD 담당 | 이미지 빌드/푸시/태그 관리 | 최신 이미지가 Harbor에 업로드됨 |
| MongoDB 담당 | `tutum-data`의 MongoDB StatefulSet/ReplicaSet 및 계정 준비 | `rs.status()` 정상, 앱 계정 접속 가능 |
| 앱 연동/검증 담당(이 문서) | 앱 시크릿/매니페스트 반영, 롤아웃/스모크 테스트, 롤백 절차 점검 | API 정상 응답 + 로그 에러 없음 + 롤백 확인 |

---

## 3. 사전 조건

1. `kubectl get nodes` 결과가 모두 `Ready`
2. `tutum-data` 네임스페이스 MongoDB 3개 Pod가 `Running`
3. MongoDB 담당자가 앱 전용 계정/비밀번호를 전달함
4. 작업 브랜치가 `develop` 최신 상태임

검증 명령:

```bash
kubectl get nodes -o wide
kubectl -n tutum-data get sts,pod,svc,pvc,job -o wide
```

---

## 4. 작업 순서

### 4-1. MongoDB 연결 문자열 확정

앱에서 사용할 표준 URI:

```text
mongodb://<APP_USER>:<APP_PASSWORD>@mongodb-0.mongodb-headless.tutum-data.svc.cluster.local:27017,mongodb-1.mongodb-headless.tutum-data.svc.cluster.local:27017,mongodb-2.mongodb-headless.tutum-data.svc.cluster.local:27017/<APP_DB>?replicaSet=mongo-rs&authSource=admin
```

주의:
- `<APP_USER>`, `<APP_PASSWORD>`, `<APP_DB>`는 실제 값으로 교체
- 값은 문서/깃에 평문으로 올리지 않음

### 4-2. 기존 Secret 백업

목적: 잘못 반영 시 즉시 원복

```bash
kubectl -n tutum-app get secret backend-secret -o yaml > /tmp/backend-secret.backup.yaml
```

### 4-3. `backend-secret`의 Mongo 값 갱신

목적: backend가 로컬 MongoDB ReplicaSet URI 사용

```bash
kubectl -n tutum-app patch secret backend-secret \
  --type merge \
  -p '{"stringData":{"MONGODB_URL":"<LOCAL_MONGO_RS_URI>","MONGODB_DB_NAME":"<APP_DB>"}}'
```

검증:

```bash
kubectl -n tutum-app get secret backend-secret -o jsonpath='{.data.MONGODB_URL}' | wc -c
```

### 4-4. 워커 매니페스트 점검/수정

대상 파일:
- `k8s-manifests/base/workers/price-consumer.yaml`

점검 포인트:
- `MONGODB_URL`이 하드코드(`mongodb://mongodb...`) 되어 있으면 Secret 참조로 변경
- 권장: `backend-secret`의 `MONGODB_URL` 재사용

예시 형태:

```yaml
- name: MONGODB_URL
  valueFrom:
    secretKeyRef:
      name: backend-secret
      key: MONGODB_URL
```

### 4-5. 매니페스트 반영 및 롤아웃

```bash
kubectl apply -k k8s-manifests/base
kubectl -n tutum-app rollout status deploy/backend --timeout=180s
kubectl -n tutum-app rollout status deploy/price-consumer --timeout=180s
```

### 4-6. 런타임 검증(로그/기능)

로그 점검:

```bash
kubectl -n tutum-app logs deploy/backend --tail=200
kubectl -n tutum-app logs deploy/price-consumer --tail=200
```

확인 포인트:
- Mongo 인증 실패(`Authentication failed`) 없음
- 서버 선택 타임아웃(`ServerSelectionTimeout`) 없음
- 연결 문자열 파싱 오류 없음

기능 스모크 테스트(필수 API 2~3개):
- 로그인/유저 조회
- 포트폴리오 조회
- 추천 뉴스 조회

---

## 5. 롤백 절차

### 5-1. Secret 원복

```bash
kubectl apply -f /tmp/backend-secret.backup.yaml
```

### 5-2. Deployment 롤백

```bash
kubectl -n tutum-app rollout undo deploy/backend
kubectl -n tutum-app rollout undo deploy/price-consumer
kubectl -n tutum-app rollout status deploy/backend --timeout=180s
kubectl -n tutum-app rollout status deploy/price-consumer --timeout=180s
```

---

## 6. 완료 기준(Definition of Done)

1. `backend`, `price-consumer` Pod가 모두 `Running`/`Ready`
2. Mongo 연결 에러 로그 없음
3. 핵심 API 스모크 테스트 성공
4. 롤백 커맨드/백업 파일 경로를 팀 채널에 공유
5. 변경사항을 `dev_logs` 또는 작업 보고 문서에 기록

---

## 7. 보고 템플릿(팀 채널 공유용)

```text
[앱-몽고 연동 작업 완료 보고]
- 작업자:
- 브랜치/커밋:
- 적용 내용:
  1) backend-secret MONGODB_URL 교체
  2) price-consumer MONGODB_URL Secret 참조화
  3) rollout 완료
- 검증 결과:
  - backend: Ready
  - price-consumer: Ready
  - 스모크 테스트: PASS/FAIL
- 롤백 정보:
  - secret backup: /tmp/backend-secret.backup.yaml
  - undo command: kubectl -n tutum-app rollout undo deploy/{backend,price-consumer}
```

