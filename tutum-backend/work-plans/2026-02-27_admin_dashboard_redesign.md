# Admin Dashboard 전면 재설계

**작성일**: 2026-02-27
**범위**: `backend/app/routers/admin.py`, `frontend/app/admin/page.tsx`
**목표**: 클러스터 개요 / 파드 분석 / 파이프라인 모니터링 3대 구성요소 / AI 진단을 통합한 UX 개선 대시보드

---

## 1. 현재 문제점

| 항목 | 현재 | 개선 방향 |
|------|------|----------|
| 탭 구조 | overview/pods/logs/monitoring 4탭 | 구조 재편성 |
| 파이프라인 모니터링 | 없음 | 3대 구성요소 전용 섹션 신설 |
| Services 섹션 | 하드코딩 정적 데이터 | 실제 Pod 상태 연동 |
| Monitoring 탭 | Grafana iframe만 | AI 분석 통합 |
| AI 진단 | 수동 버튼, overview에 묻힘 | 전용 탭, 자동 분석 옵션 |
| 메트릭 차트 | Mimir 없어서 "데이터 없음" | 파이프라인 실측 데이터 대체 |

---

## 2. 새 레이아웃 구조

```
┌─────────────────────────────────────────────────┐
│  Header: Tutum Admin | Live ● | updated HH:MM   │
├─────────────────────────────────────────────────┤
│  클러스터 개요 (항상 표시 - 탭 없이)              │
│  [Nodes] [Running Pods] [Restarts] [CPU avg]    │
│  Node Grid (CPU/Memory GaugeBar)                │
├─────────────────────────────────────────────────┤
│  [🔍 파드 분석] [🔄 파이프라인] [📋 로그] [✦ AI]│ ← 탭
├─────────────────────────────────────────────────┤
│  탭 콘텐츠 영역                                  │
└─────────────────────────────────────────────────┘
```

---

## 3. 탭별 상세 설계

### 탭 1: 파드 분석 (Pod Analysis)
- **상태별 그룹 카드**: Running N / Pending N / Failed N / Evicted N
- **파드 테이블**: 기존 대비 개선
  - 재시작 횟수 > 5 행 하이라이트 (amber)
  - Evicted/CrashLoopBackOff 행 하이라이트 (red)
  - 네임스페이스 필터 버튼
- **네임스페이스 분포 미니 막대**: tutum-app / tutum-data / monitoring 각 pod 수

### 탭 2: 파이프라인 모니터링 (Pipeline)

3대 구성요소를 플로우 카드로 시각화:

```
[뉴스 수집] ──→ [MongoDB 저장] ──→ [ES 인덱싱]
news-producer     news-consumer    elastic-consumer
  Pod: Running      Pod: Running     Pod: Stopped
  수집: 30초         Kafka→Mongo      replicas=0
  건수: 최근 N건     저장: N건         (비활성)
```

각 카드 표시 항목:
- Pod 상태 (Running/Stopped/Error)
- 최근 처리 건수 (Loki 로그에서 파싱)
- MongoDB news count (백엔드 API)
- ES index document count (백엔드 API)
- 파이프라인 흐름 → 화살표 연결

### 탭 3: 로그 (Logs)
- 기존과 동일하되 UX 개선:
  - 로그 레벨 필터 버튼 (INFO/WARN/ERROR/ALL)
  - 파드명 클릭 시 해당 파드 필터링
  - 자동 스크롤 토글

### 탭 4: AI 분석 (AI)
- **클러스터 진단**: 기존 `/diagnose` + 자동실행 옵션
- **파이프라인 AI 분석**: 파이프라인 상태 + Bedrock 분석 통합
  - `/api/v1/admin/pipeline` 데이터를 포함한 별도 프롬프트
- **진단 히스토리**: 세션 내 마지막 3회 결과 보관

---

## 4. Backend 신규 엔드포인트

### `GET /api/v1/admin/pipeline`

수집 데이터:
1. **Worker Pod 상태** (K8s API)
   - news-producer, news-consumer, elastic-consumer
   - phase, restarts, age
2. **MongoDB news count** (motor/pymongo)
   - 전체 건수
   - 최근 1시간 삽입 건수 (createdAt 기준)
3. **Elasticsearch index stats**
   - `GET http://elasticsearch.tutum-data:9200/news/_count`
   - 문서 수 반환
4. **최근 처리 로그 샘플** (Loki)
   - news-producer: 최근 5건 `produced` 키워드 로그
   - news-consumer: 최근 5건 저장 로그
   - elastic-consumer: 최근 5건 `[indexed]` 로그

응답 스키마:
```json
{
  "workers": {
    "news-producer":     {"status": "Running", "restarts": 0, "age": "2d"},
    "news-consumer":     {"status": "Running", "restarts": 1, "age": "2d"},
    "elastic-consumer":  {"status": "Stopped", "restarts": 0, "age": "-"}
  },
  "mongodb": {
    "news_total": 5479,
    "news_last_1h": 42
  },
  "elasticsearch": {
    "news_docs": 3200,
    "available": true
  },
  "recent_logs": {
    "news-producer":    ["produced: 금리 인상...", "..."],
    "news-consumer":    ["saved to mongo: ...", "..."],
    "elastic-consumer": []
  }
}
```

---

## 5. UX/UI 개선 포인트

| 항목 | 변경 내용 |
|------|----------|
| 색상 일관성 | severity 색상 통일 (OK=emerald / WARN=amber / ERROR=red) |
| 로딩 상태 | 스켈레톤 UI (현재 텍스트만) |
| 클러스터 개요 고정 | 탭 전환해도 상단 개요는 항상 표시 |
| 파이프라인 플로우 | 화살표 → 흐름 시각화 |
| 빈 데이터 처리 | "데이터 없음" 대신 이유 표시 (Mimir 미설정 등) |
| 모바일 대응 | 좁은 화면에서 카드 1열 스택 |
| 반응형 노드 그리드 | 3열 → 2열 → 1열 자동 조정 |

---

## 6. 작업 순서

### Phase 1: Backend (admin.py)
- [ ] `/pipeline` 엔드포인트 추가
  - Worker pod 상태
  - MongoDB news count (motor 사용, 기존 DB 연결 재활용)
  - ES document count
  - Loki 로그 샘플 (기존 `/logs` 로직 재활용)

### Phase 2: Frontend (page.tsx)
- [ ] 타입 추가 (`PipelineData`, `WorkerStatus` 등)
- [ ] 클러스터 개요 섹션 (탭 밖, 항상 표시)
- [ ] 탭 재편: 파드분석 / 파이프라인 / 로그 / AI
- [ ] 파드 분석 탭 (상태 그룹 카드 + 개선된 테이블)
- [ ] 파이프라인 탭 (3대 구성요소 카드 + 플로우)
- [ ] 로그 탭 (레벨 필터 추가)
- [ ] AI 탭 (기존 진단 + 파이프라인 진단 통합)

### Phase 3: UX Polish
- [ ] 스켈레톤 로딩 UI
- [ ] 빈 데이터 상태 개선
- [ ] 반응형 레이아웃 검증

---

## 7. 파일 변경 목록

| 파일 | 변경 유형 | 주요 내용 |
|------|----------|----------|
| `backend/app/routers/admin.py` | 추가 | `/pipeline` 엔드포인트 |
| `frontend/app/admin/page.tsx` | 전면 재작성 | 새 레이아웃, 파이프라인 탭 |

---

## 8. 예상 완성 모습

```
┌ Tutum Admin ────────────────────────── ● Live ┐
│ Nodes: 6  |  Pods: 22/25  |  Restarts: 7      │
│ ┌─worker1──┐ ┌─worker2──┐ ┌─worker3──┐        │
│ │CPU ████░ │ │CPU █████░│ │CPU ███░░ │        │
│ │MEM ████░ │ │MEM █████░│ │MEM ████░ │        │
│ └──────────┘ └──────────┘ └──────────┘        │
├────────────────────────────────────────────────┤
│ [파드 분석] [🔄 파이프라인] [📋 로그] [✦ AI]   │
├────────────────────────────────────────────────┤
│  뉴스 파이프라인                                │
│  ┌──────────────┐  →  ┌──────────────┐  →  ┌──────────┐ │
│  │ news-producer│     │ news-consumer│     │ elastic  │ │
│  │ ● Running    │     │ ● Running    │     │ ○ 비활성 │ │
│  │ 30초 수집    │     │ 5,479건 저장 │     │ replicas=0│ │
│  └──────────────┘     └──────────────┘     └──────────┘ │
└────────────────────────────────────────────────┘
```
