# 개발 로그 작업 요약 (2026-03-05)

## 1. 작업 요약
- 작업 일시: 2026-03-05
- 작업자: 박성준
- 브랜치: develop
- 작업 목적: `tutum-production`의 `price-consumer` CrashLoopBackOff 원인(네임스페이스 간 NetworkPolicy 차단) 해소 및 프로덕션 앱 정상화

## 2. 상세 변경 사항
- 변경 파일: `k8s-manifests/base/security/network-policy.yaml`
- 변경 내용:
  - `tutum-data` 네임스페이스에 신규 정책 추가
    - `NetworkPolicy/allow-from-tutum-prod-app`
    - 허용 대상: `namespaceSelector.matchLabels.kubernetes.io/metadata.name = tutum-prod-app`
  - 기존 `allow-from-tutum-app` 정책은 유지
- 기대 효과:
  - `tutum-prod-app`의 `backend`/`price-consumer`/`price-producer`가 공유 데이터 레이어(`tutum-data`의 Kafka/Redis/MongoDB)에 접근 가능

## 3. 작업 중 발생 이슈 및 대응
- 이슈:
  - `tutum-prod-app/price-consumer`가 `KafkaConnectionError`로 반복 재시작
  - 로그: `Unable to bootstrap from [('kafka.tutum-data.svc.cluster.local', 9092, ...)]`
- 원인:
  - `tutum-data`의 `default-deny-ingress` + `allow-from-tutum-app` 조합으로 인해 `tutum-prod-app` 트래픽이 차단됨
- 대응:
  - `tutum-prod-app` 전용 ingress 허용 정책을 manifest에 반영하여 GitOps로 관리

## 4. 결과 (검증 포함)
- 검증 명령:
  - `kubectl -n tutum-prod-app logs deployment/price-consumer --tail=120`
  - `kubectl -n tutum-prod-app get deploy,pods`
  - `kubectl -n argocd get app tutum-production`
- 검증 기준:
  - `price-consumer` CrashLoop 해소
  - `tutum-production` Health 상태 정상(Healthy)

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-05" --until="2026-03-05 23:59:59"
```
- 본 작업 커밋 메시지: `fix(k8s): allow tutum-prod-app ingress to shared tutum-data`

## 6. 후속 작업/리스크
- 현재 구조는 `tutum-prod-app`이 `tutum-data`를 공유 사용하므로, staging/prod 데이터 완전 분리는 미완료 상태
- 향후 `tutum-prod-data`, `tutum-prod-storage` 독립 레이어 전환 시:
  - 앱 ENV endpoint 전환
  - 백업/모니터링/네트워크 정책 분리 운영 필요
