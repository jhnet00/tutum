# 개발 로그 작업 요약 (2026-03-03)

## 1. 작업 요약
- 작업 일시: 2026-03-03
- 작업자: 김경윤
- 브랜치: develop
- 작업 목적:
  - Admin 대시보드 KPI(RPS/P95/Error Rate/Kafka Lag) `N/A` 문제 원인 분석 및 복구
  - Alloy scrape 조건과 exporter 메타데이터 불일치 해소
  - Mimir API 경로/메트릭 라벨 편차에 대한 백엔드 폴백 강화
  - 뉴스 파이프라인(MongoDB 적재) 실시간 동작 재확인

## 2. 상세 변경 사항
- 백엔드 메트릭 조회 강건성 보강
  - 파일: `backend/app/routers/admin.py`
  - `MIMIR_URL`이 `/prometheus` prefix 유무가 다른 환경 모두 동작하도록 API URL 후보 fallback 추가
  - `/api/v1/admin/metrics`에서 메트릭/라벨 편차(`status`, `status_code`, `http_status`)를 고려한 쿼리 후보군 적용
  - range query 실패 시 instant query로 최종 폴백해 KPI가 전부 빈 배열로 떨어지는 케이스 완화
  - `/api/v1/admin/data-metrics`의 Kafka lag 쿼리에 다중 metric 후보(`kafka_consumergroup_lag`, `kafka_consumergroup_group_lag`, `kafka_consumergroup_lag_sum`) 적용

- exporter scrape 메타데이터 보강
  - 파일: `k8s-manifests/base/data/kafka-exporter.yaml`
  - 파일: `k8s-manifests/base/data/redis-exporter.yaml`
  - `prometheus.io/scrape`, `prometheus.io/port`, `prometheus.io/path` annotation 추가
  - Alloy의 `prometheus.io/scrape=true` 필터 정책과 정합성 확보

- 배포 반영/운영 검증
  - `develop` 브랜치 커밋 푸시: `e54a4e1`
  - 운영 클러스터 점검 결과
    - `kafka-exporter`, `redis-exporter` deployment에 prometheus annotation 반영 확인
    - `kubectl -n monitoring rollout status ds/alloy` 성공 확인
    - `news-producer`/`news-consumer` 로그에서 `queue`/`[saved]` 흐름 확인
    - `news-producer`, `news-consumer`, `elastic-consumer` 파드 모두 `Running`, `Restart 0` 상태 확인

## 3. 작업 중 발생 이슈 및 대응
- 이슈: Admin KPI가 지속적으로 `N/A` 표시
  - 원인: (1) Mimir API 경로 편차(`/prometheus` 유무), (2) scrape annotation 필터와 exporter 매니페스트 불일치, (3) metric label 편차
  - 대응: 백엔드 폴백 로직 추가 + exporter annotation 추가 + Alloy rollout 확인

- 이슈: MongoDB 적재가 과거 시점에 멈춘 것처럼 보임
  - 원인: 특정 시점 카운트 확인 시 업데이트 지연/워커 재기동 구간 겹침
  - 대응: producer/consumer 로그와 파드 상태를 함께 점검하여 실시간 저장 재개 확인

## 4. 결과 (검증 포함)
- 코드 검증
```bash
python -m py_compile backend/app/routers/admin.py
# success
```

- 운영 검증(사용자 실행 결과)
```bash
kubectl -n tutum-data get deploy kafka-exporter redis-exporter -o yaml | egrep "prometheus.io/scrape|prometheus.io/port|prometheus.io/path"
# 두 deployment 모두 prometheus annotation 반영 확인

kubectl -n monitoring rollout status ds/alloy
# daemon set "alloy" successfully rolled out

kubectl -n tutum-app logs deploy/news-producer --since=30m --tail=200
# queue 로그 지속 확인

kubectl -n tutum-app logs deploy/news-consumer --since=30m --tail=200
# [saved] 로그 지속 확인

kubectl -n tutum-app get pods -o wide --sort-by=.status.containerStatuses[0].restartCount | egrep "news-producer|news-consumer|elastic-consumer"
# 3개 모두 Running, Restart 0
```

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-03 00:00:00" --until="2026-03-03 23:59:59"
# e54a4e1 fix(admin): recover KPI metrics with Mimir fallback + exporter scrape
# 5859dec deploy: staging b66cb8cf [skip ci]
# b66cb8c fix(observability): align Alloy/admin endpoints and safe configmap rollout
```

## 6. 후속 작업/리스크
- [ ] `https://tutum.my/api/v1/admin/metrics` 응답에서 4개 KPI 배열 비어있지 않은지 최종 확인
- [ ] Admin 대시보드에서 KPI 카드와 시계열 패널 값 반영 여부 확인
- [ ] MongoDB `clouddx.news` 문서 수를 1~2분 간격으로 재확인해 지속 증가 검증
- [ ] 필요 시 Alloy pod 내부 `/etc/alloy/config.alloy`에서 relabel 규칙과 scrape target 최종 점검
