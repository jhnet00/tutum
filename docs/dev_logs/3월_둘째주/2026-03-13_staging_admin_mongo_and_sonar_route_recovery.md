# 개발 로그 작업 요약 (2026-03-13)

## 1. 작업 요약
- 작업 일시: 2026-03-13
- 작업자: 김경윤
- 브랜치: develop
- 작업 목적: staging admin 모니터링의 MongoDB 집계 정합성을 복구하고, SonarQube AWS 외부 진입 경로를 실제 운영 상태로 마감하며, 온프레미스 VM 현황 문서를 최신 운영 기준으로 보정한다.

## 2. 상세 변경 사항
- `backend/app/routers/admin.py`
  - admin pipeline 집계에서 MongoDB 전역 singleton이 비어 있을 때도 직접 Mongo client로 fallback 하도록 `_get_admin_news_collection()`을 추가했다.
  - 최근 1시간 뉴스 집계를 `_id/ObjectId` 기준에서 `ingested_at|created_at -> $toDate` 기준의 distinct business key 집계로 변경했다.
- `k8s-manifests/base/backend/deployment.yaml`
  - 오래된 backend 이미지가 부팅 시 `admin.py`를 패치하는 startup script에 Mongo fallback, `get_settings()`, 최근 1시간 집계 로직을 주입하도록 확장했다.
- `k8s-manifests/overlays/staging/replicas-patch.yaml`
  - staging overlay가 backend `args`를 통째로 덮고 있어 base 수정이 live에 반영되지 않던 문제를 동일 패치로 보정했다.
- `k8s-manifests/base/frontend/deployment.yaml`
  - frontend startup patch가 현재 번들 구조에서 target을 찾지 못해 CrashLoop로 이어지지 않도록 proxy/middleware/admin patch miss를 `warn` 처리로 낮췄다.
  - 현재 raw image 번들 형태도 처리할 수 있도록 proxy/login patch 대상을 확장했다.
- `k8s-manifests/overlays/staging/sonar-ingress.yaml`
  - `sonar.tutum.my`용 `Service + Endpoints + Ingress`를 추가해 monitoring EC2의 SonarQube(`10.60.11.95:9000`)를 ALB 그룹 `tutum-stg`에 연결했다.
- `k8s-manifests/overlays/staging/kustomization.yaml`
  - `sonar-ingress.yaml`을 staging overlay resource에 포함했다.
- `docs/plans/infra/AWS_MIGRATION_DETAIL_GUIDE.md`
  - D-6 SonarQube, D-7 Kiali, D-9-V admin/LGTM, D-11 on-prem shutdown 관련 상태를 운영 검증 기준으로 최신화했다.
- `docs/plans/infra/ONPREM_VM_TO_AWS_MIGRATION_STATUS_2026-03-12.md`
  - 2026-03-13 네트워크 재검증 메모를 추가하고 SonarQube AWS 대응 상태를 반영했다.

## 3. 작업 중 발생 이슈 및 대응
- 이슈: frontend 신규 ReplicaSet이 startup patch target miss를 `throw` 하면서 CrashLoopBackOff가 발생했다.
- 대응: patch miss를 예외가 아닌 경고로 낮추고, 현재 컴파일 산출물 두 가지 패턴을 모두 지원하도록 startup patch를 수정했다.

- 이슈: backend 소스 수정만으로는 live admin Mongo 집계가 바뀌지 않았다.
- 대응: staging overlay가 backend `args` 전체를 덮고 있는 구조를 확인하고, base/overlay 양쪽 startup patch에 동일한 Mongo fallback 및 최근 집계 로직을 주입했다.

- 이슈: `sonar-ingress`는 생성됐지만 AWS Load Balancer Controller가 external EC2 endpoint를 target group에 자동 등록하지 않아 `sonar.tutum.my`가 `503`을 반환했다.
- 대응: target group `k8s-tutumapp-sonarqub-05ee4e849e`에 `10.60.11.95:9000`을 수동 등록해 `healthy` 상태로 만들었다.

- 이슈: on-prem VM 현황 문서는 2026-03-12 SSH 감사 기준이라 사용자가 인지한 전원 상태와 차이가 있었다.
- 대응: 2026-03-13에는 ping/NAT 포트 기준 재검증 결과를 문서 상단 메모로 추가하고, 현재 셸의 SSH 인증키 부재로 네트워크 reachability 수준 확인만 가능하다고 명시했다.

## 4. 결과
- 검증 항목: frontend rollout
- 검증 결과: `kubectl -n tutum-app rollout status deploy/frontend --timeout=240s` 성공, 최신 RS `frontend-6b48977486` 2개 pod `2/2 Running`

- 검증 항목: backend rollout
- 검증 결과: `kubectl -n tutum-app rollout status deploy/backend --timeout=240s` 성공, 최신 RS `backend-974b66dd5` 2개 pod `2/2 Running`

- 검증 항목: backend admin pipeline data
- 검증 결과: 신규 backend pod 두 곳에서 `_collect_pipeline_data()` 실행 결과 `mongodb.news_total=13034`, `mongodb.news_last_1h=133`, `mongodb.available=true`, `elasticsearch.news_docs=13034`

- 검증 항목: admin 접근 경로
- 검증 결과: `curl -k -I https://tutum.my/admin` -> `307 /login?callbackUrl=%2Fadmin`

- 검증 항목: SonarQube 외부 경로
- 검증 결과: `curl -k -I https://sonar.tutum.my` -> `200`, target group health `healthy`

- 검증 항목: Kiali 경로
- 검증 결과: `curl -k -I https://kiali.tutum.my/kiali/` -> `200`, `istio-system/kiali` pod `Running`

- 검증 항목: 온프레미스 전원 상태 재확인
- 검증 결과: `cp-1`, `cp-2`, `cp-3`, `worker1`, `worker2`, `worker3`, `monitoring`, `mongodb` 8대 모두 `ping-up`, 다만 현재 셸에서는 SSH `Permission denied`로 인증 실패

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-13" --until="2026-03-13 23:59:59"
```

## 6. 후속 작업/리스크
- `sonar.tutum.my`는 현재 정상 응답하지만, external EC2 endpoint target 등록이 수동이라 target group 재생성 시 재등록이 필요하다.
- LGTM 후속 이슈인 traces export timeout, Kafka lag metric Mimir 적재, Grafana Explore Tempo 검증은 아직 남아 있다.
- 온프레미스 VM은 2026-03-13 기준 네트워크 reachability만 재검증했으므로, 실제 shutdown 전에는 SSH 감사와 hidden client/cron 확인이 다시 필요하다.
