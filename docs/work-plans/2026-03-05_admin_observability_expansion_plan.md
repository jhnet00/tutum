# Work Plan: Admin Observability Expansion (Disk + DB I/O + Ops)

> 작성일: 2026-03-05  
> 브랜치: `develop`  
> 대상: `frontend/app/admin/page.tsx`, `backend/app/routers/admin.py`

---

## 1. 배경

현재 `/admin` 페이지에서 아래는 일부 확인 가능:

- Disk I/O (read/write MB/s)
- MongoDB I/O (ops/s, connections)
- ES indexing rate / JVM heap

하지만 운영 관점에서 핵심인 아래가 부족함:

- 디스크 **실사용량(used/free, %)** 시각화
- DB I/O 상세(지연, reject/queue 등) 부족
- 백업 성공/실패 상태를 한 화면에서 확인 불가
- 장애 징후 요약(즉시 조치 포인트) 부족

---

## 2. 목표

`/admin` 한 화면에서 운영자가 아래를 즉시 판단 가능하도록 개선:

1. 저장소 포화 위험 (노드/볼륨)
2. DB 병목 위험 (MongoDB/Elasticsearch)
3. 백업 정상 여부
4. 현재 즉시 대응이 필요한 경고 항목

---

## 3. 범위

### In Scope

- Admin Backend API 확장
- Admin Frontend 카드/차트 확장
- 임계치 기반 경고 요약 UI
- 운영 검증 체크리스트 문서화

### Out of Scope

- Grafana 대시보드 구조 자체 개편
- 새 exporter 추가 배포(필요 시 후속 티켓)
- 장기 분석 리포트(주/월 단위)

---

## 4. 작업 항목

## 4.1 P0 - 디스크 사용량 가시화 (필수)

### Backend

- [ ] `GET /api/v1/admin/data-metrics` 응답에 디스크 용량 지표 추가
  - [ ] `disk_total_gb`
  - [ ] `disk_used_gb`
  - [ ] `disk_free_gb`
  - [ ] `disk_used_pct`
- [ ] 가능 시 노드별 breakdown 추가 (`nodes[]`)
- [ ] 메트릭 미존재 시 `available=false` + 이유 메시지

### Frontend

- [ ] `Pipeline` 탭 Data Layer에 `Disk Capacity` 카드 추가
- [ ] used/free/total 및 % 표시
- [ ] 임계치 색상
  - [ ] 70% 이상: WARN
  - [ ] 85% 이상: CRITICAL

---

## 4.2 P0 - DB I/O 상세 지표 확장 (필수)

### MongoDB

- [ ] 기존 지표 유지: `connections`, `ops_read_per_sec`, `ops_write_per_sec`
- [ ] 추가 지표:
  - [ ] `active_readers`, `active_writers` (표시 강화)
  - [ ] `queued_readers`, `queued_writers` (가능 시)
  - [ ] `slow_ops_count` (가능 시)

### Elasticsearch

- [ ] 기존 지표 유지: `indexing_rate`, `jvm_heap_pct`
- [ ] 추가 지표:
  - [ ] `search_qps`
  - [ ] `search_latency_ms`
  - [ ] `index_latency_ms`
  - [ ] `threadpool_rejected` (가능 시)

### Frontend

- [ ] MongoDB I/O 카드 고도화 (읽기/쓰기/대기/지연)
- [ ] Elasticsearch 카드 고도화 (검색/인덱싱 지연 및 reject)

---

## 4.3 P1 - 백업 상태 카드 (강추)

### Backend

- [ ] `GET /api/v1/admin/backup-status` 신규 추가
- [ ] 대상 CronJob:
  - [ ] `mongodb-backup`
  - [ ] `etcd-backup`
  - [ ] `elasticsearch-backup`
- [ ] 각 항목 응답:
  - [ ] `last_success_at`
  - [ ] `last_run_at`
  - [ ] `status` (`OK/WARN/ERROR`)
  - [ ] `last_error` (있으면)

### Frontend

- [ ] `Pipeline` 또는 `Overview`에 `Backup Health` 카드 추가
- [ ] 최근 성공 시간, 실패 여부, 마지막 오류 표시

---

## 4.4 P1 - 운영 경고 요약 배너

### Backend or Frontend 계산

- [ ] 임계치 기준 경고 목록 생성
  - [ ] Disk used > 85%
  - [ ] ES JVM heap > 80%
  - [ ] MongoDB write ops 급증
  - [ ] Kafka lag > 1000
  - [ ] 백업 실패

### Frontend

- [ ] 상단 `Action Needed` 섹션 추가
- [ ] 우선순위/권장 조치 1줄 노출

---

## 4.5 P2 - 품질/운영성

- [ ] API 실패 시 N/A graceful fallback
- [ ] fetch timeout/에러 메시지 통일
- [ ] tooltip에 지표 정의/임계치 명시
- [ ] 30초 polling 기준 성능 확인

---

## 5. API 계약(초안)

```json
{
  "disk": {
    "read_mbps": 2.4,
    "write_mbps": 1.8,
    "disk_total_gb": 120.0,
    "disk_used_gb": 76.5,
    "disk_free_gb": 43.5,
    "disk_used_pct": 63.8,
    "available": true
  },
  "mongodb": {
    "connections": 18,
    "active_readers": 2,
    "active_writers": 1,
    "ops_read_per_sec": 33.2,
    "ops_write_per_sec": 5.4,
    "available": true
  },
  "elasticsearch": {
    "indexing_rate": 4.1,
    "jvm_heap_pct": 42.3,
    "search_qps": 12.8,
    "search_latency_ms": 18.4,
    "index_latency_ms": 11.2,
    "available": true
  }
}
```

---

## 6. 완료 기준 (Definition of Done)

- [ ] `/admin`에서 디스크 실사용량(used/free/%) 확인 가능
- [ ] MongoDB/ES I/O 상세 지표 확인 가능
- [ ] 백업 상태(최근 성공/실패) 확인 가능
- [ ] 임계치 초과 항목이 상단 경고로 즉시 노출
- [ ] 지표 수집 실패 시 화면 깨짐 없이 N/A 처리

---

## 7. 검증 체크리스트

- [ ] `GET /api/v1/admin/data-metrics` 응답 스키마 검증
- [ ] `GET /api/v1/admin/backup-status` 응답 검증
- [ ] `/admin`에서 카드 렌더링/수치/색상 임계치 확인
- [ ] 메트릭 중단 시 fallback 동작 확인
- [ ] 10분 모니터링 중 JS 에러/콘솔 에러 없음 확인

---

## 8. 리스크 및 대응

- 메트릭 소스 미존재: 지표별 fallback + 안내 문구 표준화
- 클러스터/Exporter 라벨 불일치: query 후보 다중화
- 폴링 부하 증가: endpoint 통합/캐시(짧은 TTL) 검토

---

## 9. 실행 순서(권장)

1. Backend `data-metrics` 확장
2. Frontend `Disk Capacity` 카드 추가
3. MongoDB/ES 카드 확장
4. Backup Status API + 카드 추가
5. Action Needed 배너 추가
6. 회귀 검증 및 문서 업데이트

