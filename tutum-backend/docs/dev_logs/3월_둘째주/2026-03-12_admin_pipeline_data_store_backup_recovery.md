# 개발 로그 작업 요약 (2026-03-12)

## 1. 작업 요약
- 작업 일시: 2026-03-12
- 작업자: 김경윤
- 브랜치: `develop`
- 작업 목적: `https://tutum.my/admin`의 Pipeline/Data/Backup 탭에서 비정상으로 보이던 MongoDB, Elasticsearch, Kafka, Backup Summary 수치를 복구하고 운영 원인을 분리한다.

## 2. 상세 변경 사항
- Monitoring EC2(`tutum-monitoring`, `10.60.11.95`)가 중지되어 있어 기동 후 `Mimir`와 `Loki` 질의 경로를 재검증했다.
  - `Mimir` 실제 질의 경로는 `http://10.60.11.95:9009/prometheus/api/v1/query`였다.
- backend admin 집계 로직에서 MongoDB 최근 1시간 증가 수치를 `published_at` 기준이 아니라 Mongo `_id` 생성 시각 기준으로 보도록 보강했다.
  - 결과적으로 "Added in 1h"가 UI 계산 오류가 아니라 실제 적재량을 반영하도록 정리했다.
- `elasticsearch-backup` CronJob을 운영 환경 기준으로 보강했다.
  - S3 snapshot idempotency 처리
  - Istio sidecar 주입 활성화
  - `holdApplicationUntilProxyStarts` 설정 추가
  - snapshot API 호출 `curl` retry 추가
  - `restartPolicy: Never`로 조정
  - 종료 직전 `quitquitquit` 호출 추가
  - snapshot state 파싱 로직 수정
  - Istio startup probe 통과 시간을 확보하기 위해 종료 전 짧은 대기 추가
- Elasticsearch snapshot 수동 검증 Job을 재실행해 `Complete` 상태를 확인했다.
  - 검증 Job: `elasticsearch-backup-manual-1711`
- Elasticsearch 색인 상태를 확인하고 부족했던 문서는 backfill로 채웠다.
  - backfill 결과 `12,575`건 upsert 성공
  - 현재 ES 문서 수는 `15,202`
- `elastic-consumer`가 `KEDA minReplicaCount: 0` 때문에 평소에 완전히 내려가 있어 실시간 색인이 지연되는 구조를 확인했다.
  - staging 기준 `minReplicaCount: 1`로 상향하는 수정안을 `develop`에 반영했다.
  - live도 즉시 `1 replica`로 올려 `elastic-consumer`를 `Running` 상태로 복구했다.

## 3. 작업 중 발생 이슈 및 대응
- 이슈: `Backup Summary`에서 Elasticsearch가 계속 `ERROR`로 표시됨
  - 대응: 초기에는 snapshot 스크립트 문제처럼 보였지만, 실제 원인은 `Elasticsearch service`가 Istio mesh 내부인데 backup Job은 mesh 밖에서 평문으로 붙고 있었기 때문이다. sidecar 주입 후에도 probe 타이밍과 state 파싱 오류가 남아 있어 순차적으로 수정했다.
- 이슈: `Kafka`가 `No metrics`로 표시됨
  - 대응: monitoring EC2가 중지된 상태였고, Mimir 경로도 `/prometheus/api/v1/query` 기준으로 확인해야 했다. EC2 기동 후 backend에서 직접 질의해 Kafka metric 복구를 확인했다.
- 이슈: `MongoDB Added in 1h`가 계속 `0`
  - 대응: backend 계산식을 수정한 뒤 실제 Mongo 최근 문서를 조회했다. 최신 삽입 시각이 `2026-03-12 15:56 KST`에 머물러 있었고, `news-producer` 로그에서 `n.news.naver.com` 대상 `429` 및 `ReadTimeout`이 반복됨을 확인했다. 즉, 현재 값은 UI 버그가 아니라 실제 수집 정체다.
- 이슈: Elasticsearch 문서 수가 Mongo 문서 수와 1:1로 맞지 않음
  - 대응: backfill로 부족분은 채웠지만 ES에 기존 stale 문서가 남아 있어 총 문서 수가 `15,202`로 Mongo `12,576`보다 많다. 파괴적 인덱스 정리는 이번 작업 범위에서 제외했다.

## 4. 결과
- backend 내부 검증 결과:
  - `get_data_metrics()` -> `kafka.available=true`, `consumer_lag=21`, `throughput_msg_per_min=375.1`
  - `get_backup_status()` -> `MongoDB=OK`, `Elasticsearch=OK`
  - `get_pipeline()` -> `mongodb.news_total=12576`, `mongodb.news_last_1h=0`, `elasticsearch.news_docs=15202`
  - `elastic-consumer` -> `Running`
- Elasticsearch backup 수동 검증:
  - `job/elasticsearch-backup-manual-1711` -> `Complete`
  - 로그: `snapshot snap-2026-03-12 already exists and is successful`
- 운영 화면 기준 기대 상태:
  - Kafka 카드에 `No metrics` 대신 수치 노출
  - Backup Summary에 `MongoDB`, `Elasticsearch` 모두 `OK`
  - Elasticsearch Indexed docs는 `2606`이 아니라 `15202`
- 미해결 항목:
  - MongoDB 최근 1시간 추가 건수는 현재 실제 수집 정체로 인해 `0`

## 5. 커밋 로그
```bash
2742c14c fix(pipeline): keep elastic consumer warm in staging
ee603aea fix(backup): run elasticsearch backup inside mesh
07fac23b fix(backup): finish elasticsearch job with istio sidecar
9520db0c fix(backup): retry elasticsearch snapshot calls
6b491eee fix(backup): run elasticsearch job with restartPolicy never
1b70d63d fix(backup): let istio startup probe settle before exit
d8496b17 fix(backup): parse elasticsearch snapshot state correctly
d573e521 deploy(staging): backend+workers dcc0539a [skip ci]
```

## 6. 후속 작업/리스크
- `news-producer`가 Naver 기사 상세 수집 중 `429`와 `ReadTimeout`을 반복해 Mongo 최근 적재가 멈추는 문제가 남아 있다.
- Elasticsearch 문서 수는 현재 `15,202`로, Mongo `12,576`과 차이가 난다. 정합성을 1:1로 맞추려면 stale 문서 정리 또는 인덱스 재구성이 필요하다.
- `elastic-consumer`는 live에서 이미 `1 replica`로 올렸지만, Argo CD가 `ScaledObject` 변경을 완전히 수렴하는지 추가 확인이 필요하다.
