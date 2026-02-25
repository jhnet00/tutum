# 개발 로그 작업 요약 (2026-02-24)

## 1. 작업 요약
- 작업 일시: 2026-02-24
- 작업자: jhnet00, Kyung Yoon Kim
- 작업 목적: node3 Docker Compose 기반 뉴스 파이프라인(Producer/Consumer/Elastic Consumer + ES/Kibana)을 Tutum의 K8s 매니페스트 구조로 이관하기 위한 base 리소스 작성

## 2. 상세 변경 사항
- node3 원격 실사로 현재 파이프라인 구조 확인
  - producer/consumer/elastic_consumer 컨테이너와 Kafka 토픽/그룹 확인
  - 토픽: `news.raw`
  - 그룹: `clouddx-news-consumer-v1`, `indexer-consumer-group`
- K8s 리소스 추가
  - `k8s-manifests/base/data/elasticsearch.yaml` 추가 (StatefulSet + Service, `workload=data` 고정)
  - `k8s-manifests/base/data/kibana.yaml` 추가 (Deployment + Service, `workload=data` 고정)
  - `k8s-manifests/base/workers/news-configmap.yaml` 추가
  - `k8s-manifests/base/workers/news-secret.yaml` 추가
  - `k8s-manifests/base/workers/news-producer.yaml` 추가 (`workload=app`)
  - `k8s-manifests/base/workers/news-consumer.yaml` 추가 (`workload=app`)
  - `k8s-manifests/base/workers/elastic-consumer.yaml` 추가 (`workload=app`)
- `k8s-manifests/base/kustomization.yaml`에 신규 리소스 등록

## 3. 작업 중 발생 이슈 및 대응
- 이슈: 로컬 리포에서 일반 `ssh`는 비대화형 비밀번호 주입이 안 되어 node3 원격 조회 실패
- 대응: `plink` 사용 + hostkey 고정으로 자동 조회 전환
- 결과: node3에서 실제 실행 중인 이미지/토픽/consumer group/환경변수 확인 완료

## 4. 결과
- node3 뉴스 파이프라인의 K8s 이관용 매니페스트 초안 반영 완료
- 토픽/그룹/엔드포인트를 기존 운영값과 일치시켜 초기 마이그레이션 리스크를 낮춤
- worker 역할 분리 전략 반영
  - app 계열 워커(`news-*`, `elastic-consumer`)는 `workload=app`
  - data 계열(`elasticsearch`, `kibana`)는 `workload=data`

## 5. 커밋 로그
```bash
git log --oneline --since="2026-02-24" --until="2026-02-24 23:59:59"
```

## 6. 비고
- `news-pipeline-secret`의 AWS/Mongo 민감값은 실제 운영값으로 교체 필요
- `harbor-secret` 및 이미지 태그(`v1`)는 클러스터 환경과 동일하게 유지/검증 필요
- 기존 로컬 변경 파일 `backend/.env`는 본 작업 커밋에서 제외함
