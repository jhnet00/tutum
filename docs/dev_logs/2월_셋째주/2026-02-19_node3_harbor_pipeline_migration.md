# 📅 개발 작업 완료 보고서 (2026-02-19)

## 📌 작업 개요
**작성자**: `jhnet00`  
**Jira Ticket**: `N/A`  
**Branch**: `develop`  
**작업 내용**: `/home/kafka`의 뉴스 파이프라인(Producer/Consumer/Elasticsearch/Kafka)을 Node3로 이관하고 Harbor 연동 오류를 수정함.

## 1. 🔧 주요 변경 사항
- Node3 배포용 파일 세트 작성/정리
  - `docker-compose.node3.yml`, `.env.node3`, `.env.node3.example`
  - Producer/Consumer용 Dockerfile 및 requirements 분리
- Node3에서 Kafka(KRaft), Elasticsearch, Producer, Consumer 컨테이너 실행 구성 완료
- Harbor 경로 교정
  - 기존 잘못된 경로: `192.168.0.28:8080`
  - 최종 정상 경로: `192.168.56.12:8080`
- Node3 Docker daemon에 `insecure-registry` 설정 적용
  - `/etc/docker/daemon.json`에 `192.168.56.12:8080` 등록
- Harbor 업로드 및 검증 완료
  - `tutum/producer:v1`, `tutum/consumer:v1` push 성공
  - Harbor API 조회로 repository/artifact 생성 확인

## 2. 🐛 버그 수정 (있는 경우)
- 문제 상황
  - Node3에서 Harbor 로그인/푸시 시 `connection refused` 발생
- 원인 분석
  - VM 간 통신 대역이 아닌 NAT 호스트 주소(`192.168.0.28:8080`)를 Harbor 주소로 사용함
  - Harbor가 HTTP 모드인데 Docker insecure-registry 설정이 누락됨
- 해결 방법
  - Harbor 주소를 Host-Only 대역(`192.168.56.12:8080`)으로 변경
  - Node3에 insecure-registry 설정 후 Docker 재시작
  - 재로그인 및 push 재시도하여 성공 확인

## 3. 📸 UI 스크린샷 (브라우징 기능 사용 가능한 경우 필수)
- 본 작업은 인프라/백엔드 배포 작업으로 UI 변경 없음 (N/A)

## 4. 📝 커밋 내역
```bash
git log --oneline --since="2026-02-19" --until="2026-02-19 23:59:59"
# (해당 일자 커밋 없음)
```

---
**✅ 결론**: 뉴스 파이프라인 실행 주체를 Node3로 전환했고, Harbor 연동 이슈를 해결하여 `192.168.56.12:8080/tutum/*:v1` 기준 배포 경로를 정상화했다.
