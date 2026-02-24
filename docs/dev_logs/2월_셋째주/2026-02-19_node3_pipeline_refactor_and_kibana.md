# 📅 개발 작업 완료 보고서 (2026-02-19)

## 📌 작업 개요
**작성자**: `jhnet00`  
**Jira Ticket**: `N/A`  
**Branch**: `develop`  
**작업 내용**: Node3 단독 운영이 가능하도록 뉴스 파이프라인(Producer/Consumer/Elastic/Kibana)을 정비하고, 컨테이너/이미지 명명 규칙을 통일함.

## 1. 🔧 주요 변경 사항
- Node3 파이프라인 역할 분리/고정 완료
  - `node3-producer`: 뉴스 크롤링 후 Kafka 발행
  - `node3-consumer`: Kafka consume 후 MongoDB 저장 (`consumer_news.py`)
  - `node3-elastic`: Kafka consume 후 Elasticsearch 인덱싱 (`elastic_consumer.py`)
  - `node3-kafka`, `node3-elasticsearch`, `node3-kibana` 운영
- Node3에 MongoDB 적재 consumer 추가 구성
  - `/home/clouddx/consumer/consumer_news.py` 배치
  - `Dockerfile.consumer_news`, `requirements.consumer_news.txt` 추가
  - compose에 `consumer-news` 서비스 추가 후 `node3-consumer`로 컨테이너명 통일
- Elasticsearch 인덱서 파일명 정리
  - `/home/clouddx/consumer/indexer_consumer.py` -> `/home/clouddx/consumer/elastic_consumer.py`
  - `Dockerfile.consumer` 실행 엔트리포인트를 새 파일명으로 변경
- 이미지/컨테이너 명명 일관성 정리
  - `192.168.56.12:8080/tutum/node3-producer:v1`
  - `192.168.56.12:8080/tutum/node3-consumer:v1`
  - `192.168.56.12:8080/tutum/node3-elastic:v1`
  - 구 레거시 태그(`consumer`, `consumer-news`, `producer`, `192.168.0.28:8080/*`) 정리
- Kibana 접속/운영 경로 안정화
  - compose에 Kibana 서비스 유지 (`5601:5601`)
  - Elasticsearch 연동 확인 및 Discover 조회 정상화

## 2. 🐛 버그 수정 (있는 경우)
- 문제 상황
  - 컨테이너 이름 교체 과정에서 `node3-consumer` 이름 충돌 발생
  - compose 재기동 시 고아(orphan) 컨테이너로 인해 자동 접두 이름(`xxxx_node3-*`) 노출
  - Kibana 접속 시 호스트 포트 선점으로 접근 실패
- 원인 분석
  - 기존 컨테이너가 동일 이름을 점유한 상태에서 재생성 시도
  - 이전 compose 상태가 완전 정리되지 않아 orphan 컨테이너 잔존
  - Windows 호스트 `5601` 포트가 선점되어 포트 포워딩 충돌
- 해결 방법
  - `docker compose down --remove-orphans` 및 충돌 컨테이너 정리 후 재기동
  - 서비스별 강제 재생성으로 컨테이너명 재정렬
  - 호스트 포트 점유 해제 후 Kibana 5601 경로 정상 확인

## 3. 📸 UI 스크린샷 (브라우징 기능 사용 가능한 경우 필수)
- 인프라/백엔드 중심 작업으로 저장 가능한 자동 캡처 스크린샷은 첨부하지 않음 (N/A)

## 4. 📝 커밋 내역
```bash
git log --oneline --since="2026-02-19" --until="2026-02-19 23:59:59"
# (본 문서는 작업 기록 기준이며 커밋/푸시는 별도 진행)
```

---
**✅ 결론**: Node3가 로컬 `/home/kafka` 의존 없이 단독으로 뉴스 수집부터 MongoDB/Elasticsearch 저장, Kibana 조회까지 처리하도록 정비되었고, 컨테이너/이미지 네이밍을 `node3-*` 규칙으로 통일했다.
