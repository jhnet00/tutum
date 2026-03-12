# 개발 로그 작업 요약 (2026-03-12)

## 1. 작업 요약
- 작업 일시: 2026-03-12
- 작업자: 김경윤
- 브랜치: develop
- 작업 목적: AWS 마이그레이션 방향에 맞춰 앱 MongoDB 정본을 Atlas가 아닌 EKS in-cluster ReplicaSet으로 전환하고, 운영 워크로드를 local Mongo 기준으로 통일

## 2. 상세 변경 사항
- 데이터 현황 비교
  - Atlas 기준: `clouddx.assets = 22`, `clouddx.users = 11`, `clouddx.email_verification_tokens = 11`, `clouddx.news = 11779`
  - local Mongo 기준: `clouddx.news = 2538`, 핵심 앱 컬렉션 일부 미존재
  - 위 차이를 기준으로 Atlas 데이터를 local Mongo로 merge하는 cutover 전략 수립
- 데이터 cutover
  - Atlas 데이터를 EKS local Mongo ReplicaSet(`mongo-rs`)으로 merge
  - `users`, `assets`, `email_verification_tokens`는 `_id` 기준 upsert
  - `news`는 `url/link/id` 우선 upsert, 없으면 `_id` 기준 보존
- 시크릿 및 설정 변경
  - `k8s-manifests/base/backend/secret.yaml`
    - `MONGODB_URL`을 in-cluster ReplicaSet URI로 변경
  - `k8s-manifests/base/workers/news-secret.yaml`
    - `MONGO_URI`를 `/clouddx?replicaSet=mongo-rs` 기준으로 정규화
  - AWS Secrets Manager `tutum/backend-secret`
    - `MONGODB_URL`을 동일한 ReplicaSet URI로 갱신
  - ExternalSecret 재동기화 후 `backend`, `auth`, `ocr` rollout 재시작
- 적용 URI
  - `mongodb://mongodb-0.mongodb-headless.tutum-data.svc.cluster.local:27017,mongodb-1.mongodb-headless.tutum-data.svc.cluster.local:27017,mongodb-2.mongodb-headless.tutum-data.svc.cluster.local:27017/clouddx?replicaSet=mongo-rs`
- 최종 데이터 검증
  - local `clouddx.users = 11`
  - local `clouddx.assets = 22`
  - local `clouddx.email_verification_tokens = 11`
  - local `clouddx.news = 12421`
  - `backend 5/5`, `auth 2/2`, `ocr 1/1`
  - 외부 API 확인
    - `https://tutum.my/api/v1/chat/health` → `200`
    - `https://tutum.my/api/v1/market/prices/stocks?symbols=NVDA` → `200`
    - `https://tutum.my/api/v1/auth/me` → `401` (비로그인 기준 정상)

## 3. 작업 중 발생 이슈 및 대응
- 이슈: 앱 기준 핵심 데이터는 Atlas에 있고, local Mongo는 일부 뉴스 데이터만 유지해 정본이 갈라져 있었음
- 대응: collection별 건수 비교 후 Atlas 데이터를 local ReplicaSet으로 merge하고, 앱 워크로드 연결을 local로 통일
- 이슈: AWS Secrets Manager `backend-secret` JSON 포맷이 수정 중 한 차례 깨져 ExternalSecret 동기화가 실패
- 대응: JSON 포맷을 정상화한 뒤 Secrets Manager 값을 복구하고 ExternalSecret `secret synced` 상태까지 확인
- 이슈: local Mongo는 아직 인증이 없는 상태라 정본 전환 후 보안 리스크가 남음
- 대응: 이번 작업은 source of truth 전환까지 완료하고, 인증/권한 적용은 후속 항목으로 분리

## 4. 결과
- 검증 항목:
  - local Mongo 문서 건수
  - `backend`, `auth`, `ocr` 연결 URI
  - 외부 API health 및 로그인 경로 정상 여부
- 검증 결과:
  - 앱 정본이 Atlas에서 EKS in-cluster Mongo ReplicaSet으로 전환됨
  - `backend/auth/ocr`와 뉴스 파이프라인 secret이 동일한 local Mongo를 바라보도록 정리됨
  - 사용자 체감 경로인 채팅, 시세, 인증 health는 정상 응답 유지

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-12" --until="2026-03-12 23:59:59"
```

- 관련 커밋:
  - `cec8735` `feat(mongo): switch app workloads to in-cluster replica set`

## 6. 후속 작업/리스크
- local MongoDB 인증/권한 적용이 아직 남아 있음
- Atlas에 남아 있는 hidden writer/consumer를 점검해 완전 분리 필요
- legacy MongoDB VM(`192.168.0.231`)은 의존성 재확인 후 종료해야 함
