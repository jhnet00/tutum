# 2026-02-27 Admin 페이지 Grafana 대시보드 UID 오류 수정

## 작업자
박성준

## 작업 유형
Frontend 버그 수정

## 배경
`tutum.my/admin` Admin 대시보드의 Monitoring/Overview 탭에서 Grafana 패널 iframe에 데이터가 표시되지 않고 "Dashboard not found" 에러가 발생. 사용자가 "id문제"라고 인지하고 있었으나 정확한 원인 미파악 상태.

## 원인 분석

### 1. 존재하지 않는 대시보드 UID 사용
- 코드에 하드코딩된 UID: `rYdd6i9Zz` (Grafana에 없음)
- `tutum-cluster-overview` 슬러그도 없음
- 실제 존재하는 적합한 대시보드: `cfe9hn687abk0e` (CloudDX Overview)

### 2. 잘못된 패널 ID
| iframe 라벨 | 기존 panelId | 실제 panelId |
|---|---|---|
| API Requests/s | 14 | 1 (Backend API RPS) |
| P95 Latency | 15 | 3 (P95 Latency) |
| Error Rate | 16 | 2 (Error Rate 5xx) |
| Kafka Lag | 17 | 4 (Kafka Consumer Lag) |

### 3. HTTPS → HTTP 프로토콜 불일치
- `admin.tutum.my`는 HTTP로 서비스 중이나 코드에 `https://` 하드코딩

## Grafana 인프라 상태 확인 결과 (정상)
- `admin.tutum.my` → monitoring VM(192.168.0.230:3000) Grafana 정상 연결 ✅
- `GF_SECURITY_ALLOW_EMBEDDING=true` (docker-compose 환경변수) ✅
- `GF_AUTH_ANONYMOUS_ENABLED=true` ✅
- Mimir 데이터소스 연결 OK, 실제 메트릭 유입 중 ✅
  - `http_requests_total`, `kafka_consumer_lag` 등 수집 확인

## 수정 내용 — `frontend/app/admin/page.tsx`

### iframe URL 전체 수정
```
변경 전: https://admin.tutum.my/d-solo/rYdd6i9Zz/tutum-cluster-overview?orgId=1&...
변경 후:  http://admin.tutum.my/d-solo/cfe9hn687abk0e/clouddx-overview?orgId=1&...
```

### Overview 탭 미니 차트 panelId 수정
```
변경 전: panelId 14, 15, 16, 17
변경 후: panelId 1, 3, 2, 4
```

## 수정 파일
- `frontend/app/admin/page.tsx` (8개 iframe URL 전부 수정)

## 테스트 포인트
- [ ] `tutum.my/admin` → Overview 탭 미니 차트 4개 정상 표시 확인
- [ ] Monitoring 탭 풀 패널 iframe 정상 표시 확인
- [ ] 데이터 없는 "Dashboard not found" 에러 해소 확인
