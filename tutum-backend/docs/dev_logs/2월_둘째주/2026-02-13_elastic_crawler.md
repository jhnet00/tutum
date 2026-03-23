# 📅 개발 작업 완료 보고서 (2026-02-13)

## 📌 작업 개요
**작성자**: `jhnet00`  
**Jira Ticket**: `N/A`  
**Branch**: `jh/0213`  
**작업 내용**: `elastic&crawler` 파이프라인 운영 전환 및 systemd 상시 실행 구성

## 1. 🔧 주요 변경 사항
- `crawler` 기반 파이프라인으로 운영 경로를 정리함.
- Kafka 토픽 정합성 점검 후 `indexer_consumer.py` 기본 토픽을 producer 기준(`news.raw`)에 맞춤.
  - 파일: `crawler/consumer/indexer_consumer.py`
- `systemd` 서비스 기반 상시 실행 구성/점검 진행.
  - `crawler-producer.service`
  - `crawler-indexer.service`
  - `crawler-consumer.service`
- `producer` 실행 주기 정책 조정.
  - `RUN_FOREVER=1` 유지
  - `POLL_INTERVAL_SEC=5`로 설정해 짧은 폴링 간격으로 운영
- 로그/운영 파일 정리 진행.
  - 불필요한 `clouddx_backend/frontend` pid/log, `producer.lock` 제거
  - `seen_finance_mainnews.json`은 중복 방지용으로 유지

## 2. 🐛 버그 수정
- systemd unit 파일 오타/형식 오류 수정 가이드 및 반영.
  - 잘못된 파일명(`cralwer-producer.service`) 정리
  - 잘못된 `ExecStart` 경로(`/home/kafka/crawler/`)를 실제 python 스크립트 경로로 수정
  - unit 파일 내부 깨진 라인(예: `consumer/consumer_news.py` 단독 라인) 제거
- `crawler-consumer.service` 재시작 실패 원인(`Missing '='`, `can't find '__main__'`)을 unit 설정 문제로 식별하고 수정.

## 3. 📸 UI 스크린샷
- UI 변경 작업 없음 (해당 없음)

## 4. 📝 커밋 내역
```bash
git log --oneline --since="2026-02-13" --until="2026-02-13 23:59:59"
```
- 문서 작성 시점 기준 코드 커밋은 별도 진행 전.

---
**✅ 결론**: `elastic&crawler` 운영 기준으로 Kafka→MongoDB/Elasticsearch 파이프라인을 `crawler` 중심으로 정리했고, systemd 상시 실행 체계를 구축하여 수동 실행 의존도를 낮춤.
