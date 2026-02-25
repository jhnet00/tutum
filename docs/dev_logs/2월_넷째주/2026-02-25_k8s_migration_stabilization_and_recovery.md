# 개발 로그 작업 요약 (2026-02-25)

## 1. 작업 요약
- 작업 일시: 2026-02-25
- 작업자: Codex (with CloudDX)
- 작업 목적: NODE123 -> K8s 이관 과정에서 발생한 배포/데이터/스케줄링 이슈를 복구하고, 운영 기준 상태로 재안정화

## 2. 상세 변경 사항
- `stg-*` 리소스 재생성 원인 식별
  - 원인: ArgoCD `tutum-staging` Application 자동 동기화(`prune/selfHeal`)
- ArgoCD 정리
  - `argocd/tutum-staging` 삭제로 재생성 루프 차단
- base 매니페스트 재적용 및 복구
  - `/home/clouddx/clouddx-project/k8s-manifests/base` 기준 재적용
  - 네임스페이스/서비스/워크로드 재생성
- 시크릿 복구
  - `backend-secret`, `harbor-secret`, `gitlab-registry-secret` 재생성
  - GitLab registry pull credential 유효값으로 재설정 후 앱 롤아웃 정상화
- MongoDB 복구
  - ReplicaSet 재초기화(`rs.initiate`)
  - Atlas -> K8s `mongodump | mongorestore` 재수행
  - 데이터 건수 검증 완료(로컬/Atlas 일치)
- 매니페스트 보완
  - `k8s-manifests/base/kustomization.yaml`에 `backend/secret.yaml` 포함
  - `news-producer`, `news-consumer`, `elastic-consumer` 기본 `replicas: 0`으로 조정
  - `ingress/gateway.yaml`, `ingress/virtualservice.yaml` 반영 유지

## 3. 작업 중 발생 이슈 및 대응
- 이슈: `tutum-staging` 삭제 시 ArgoCD finalizer prune으로 `tutum-app/tutum-data/tutum-storage` 리소스 동반 삭제
- 대응:
  - base 매니페스트 즉시 재적용
  - 필수 secret 재복구
  - 애플리케이션 롤아웃 재진행
  - Mongo 데이터 재복구 및 재검증

## 4. 결과
- 클러스터 상태
  - `tutum-app`: backend/frontend/price-producer/price-consumer/email-worker Running
  - `tutum-data`: mongodb(3/3), kafka(1/1), redis(1/1) Running
  - `tutum-storage`: minio(1/1) Running
- 인그레스 검증
  - `http://192.168.0.240/` -> 200
  - `http://192.168.0.240/api/v1/market/price/crypto/KRW-BTC` -> 200
- Mongo 컬렉션 건수 검증
  - `assets:22`, `email_verification_tokens:7`, `users:11`, `news:6240`
- 운영 제외(임시)
  - `news-producer`, `news-consumer`, `elastic-consumer`는 레지스트리 접근 불가로 `replicas=0`

## 5. 커밋 로그
```bash
git log --oneline --since="2026-02-25" --until="2026-02-25 23:59:59"
```

## 6. 비고
- 다음 작업 우선순위
  1. `192.168.56.12:8080` 이미지를 GitLab Registry 기준으로 이관
  2. `news/*`, `elastic-consumer` 재배포(`replicas` 복원)
  3. Runbook Phase 6(기존 node1/2/3 축소/종료) 단계 진행
