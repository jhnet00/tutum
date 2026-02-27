# Admin Dashboard 전면 재설계 + 파이프라인 모니터링 + Kakao OAuth 활성화

**날짜**: 2026-02-27
**작업자**: Claude (AI)
**커밋**: `3c204e0`, `f687f5d`

---

## 1. 작업 개요

| 작업 | 내용 |
|------|------|
| elastic-consumer Eviction 정리 | DiskPressure로 Evicted된 pods 3개 삭제, 원인 분석 |
| Admin Dashboard 전면 재설계 | 클러스터 개요 + 파드 분석 + 파이프라인 + 로그 + AI 분석 |
| Backend 파이프라인 API 추가 | `/pipeline`, `/pipeline-diagnose` 엔드포인트 |
| Kakao OAuth 활성화 | 앱 키 주입 + FRONTEND_URL 버그 수정 |

---

## 2. elastic-consumer Eviction 원인 및 해결

### 원인
- **DiskPressure**: worker2 노드 디스크 사용량 임계치 초과 (약 107분 전 발생)
- K8s가 3개 파드 강제 축출(Evict): `ncvhw`, `rjssr`, `spv5m`

### 현재 상태
- 모든 노드 DiskPressure: `False` (해소됨)
- 새 파드 `dp47g` 자동 재스케줄링 → **정상 Running**
- 스테일 Evicted pods 수동 삭제

```bash
kubectl -n tutum-app delete pod \
  elastic-consumer-5854df4ff6-ncvhw \
  elastic-consumer-5854df4ff6-rjssr \
  elastic-consumer-5854df4ff6-spv5m
```

---

## 3. Admin Dashboard 전면 재설계

### 이전 구조
```
탭: overview / pods / logs / monitoring
- overview: 노드 + 메트릭차트(Mimir 없어 빈칸) + AI진단 + Services
- monitoring: Grafana iframe
```

### 새 구조
```
[클러스터 개요] ← 탭 밖, 항상 표시
  요약 카드 4개: Nodes / Running Pods / CPU avg / MEM avg
  노드 그리드: CPU + Memory GaugeBar

[탭] 파드 분석 | 파이프라인 | 로그 | ✦ AI 분석
```

#### 파드 분석 탭
- 상태 그룹 카드: Running / Pending / Failed / Evicted
- 파드 테이블: 문제 행 컬러 하이라이트 (red=오류, amber=재시작 >5)

#### 파이프라인 탭 (신규)
- 3대 구성요소 플로우 카드 (→ 화살표):
  - `news-producer` (뉴스 수집)
  - `news-consumer` (MongoDB 저장)
  - `elastic-consumer` (ES 인덱싱)
- 각 카드: 파드 상태, 재시작 횟수, 최근 Loki 로그 스니펫
- MongoDB news 전체/최근 1시간 건수
- ES 인덱스 문서 수 + MongoDB 대비 인덱싱 비율

#### 로그 탭
- 레벨 필터 추가 (ALL / INFO / WARN / ERROR)
- 파드명 클릭 시 해당 파드 필터링 (토글)

#### AI 분석 탭
- **클러스터 진단**: 기존 `/diagnose` 그대로 (노드+파드 전체)
- **파이프라인 AI 분석**: 3대 구성요소 각각 개별 분석 (신규)

---

## 4. Backend 신규 API

### `GET /api/v1/admin/pipeline`
```json
{
  "workers": {
    "news-producer":    {"status": "Running", "restarts": 0, "age": "2d", "running": true},
    "news-consumer":    {"status": "Running", "restarts": 1, "age": "2d", "running": true},
    "elastic-consumer": {"status": "Stopped", "restarts": 0, "age": "-",  "running": false}
  },
  "mongodb":        {"news_total": 5479, "news_last_1h": 42, "available": true},
  "elasticsearch":  {"news_docs": 3200, "available": true},
  "recent_logs":    {"news-producer": [...], "news-consumer": [...], "elastic-consumer": []}
}
```

수집 소스:
- K8s API (worker 파드 상태)
- MongoDB motor (news count, 최근 1시간)
- Elasticsearch HTTP (news/_count)
- Loki (최근 5분 로그 샘플, 각 worker 5건)

### `GET /api/v1/admin/pipeline-diagnose`
- 파이프라인 데이터 수집 후 Bedrock Claude로 3대 구성요소 개별 분석
- 시스템 프롬프트: `elastic-consumer replicas=0`은 안정화 모드 설계상 의도된 상태임을 명시
- 응답: `{overall, components: [{name, label, status, summary, issues, actions}]}`

---

## 5. Kakao OAuth 활성화

### 문제
- `KAKAO_CLIENT_ID=""` (비어 있어 모든 요청 500 에러)
- K8s secret에 Kakao 관련 env var 없음
- **추가 발견**: `FRONTEND_URL` 미설정 → OAuth 인증 후 `http://localhost:3000/auth/callback`으로 리다이렉트 (Google/Naver도 동일 문제)

### 해결
1. 카카오 개발자 콘솔에서 리다이렉트 URI 등록:
   - `https://tutum.my/api/v1/auth/kakao/callback`
   - `http://localhost:8000/api/v1/auth/kakao/callback`

2. K8s secret 업데이트 (`kubectl apply` 즉시 반영):
```yaml
KAKAO_CLIENT_ID:     "7c8a6ef6fdb285ae87bbfde58affc815"
KAKAO_CLIENT_SECRET: "OgT9OBMKCirTrozigdPvDDMVF397ngSx"
KAKAO_REDIRECT_URI:  "https://tutum.my/api/v1/auth/kakao/callback"
FRONTEND_URL:        "https://tutum.my"
```

3. `kubectl rollout restart deployment/backend` → 새 환경변수 로드 확인

### Kakao OAuth 플로우 (정상 동작)
```
사용자 → /api/proxy/api/v1/auth/kakao/login
       → 백엔드 (Next.js 프록시 경유)
       → https://kauth.kakao.com/oauth/authorize?...
       → 사용자 카카오 로그인
       → https://tutum.my/api/v1/auth/kakao/callback (Istio → 백엔드 직접)
       → JWT 발급 + https://tutum.my/auth/callback 리다이렉트
       → 로그인 완료
```

---

## 6. 수정된 파일

| 파일 | 변경 유형 |
|------|----------|
| `backend/app/routers/admin.py` | `/pipeline`, `/pipeline-diagnose` 엔드포인트 추가 |
| `frontend/app/admin/page.tsx` | 전면 재작성 (새 레이아웃, 4탭) |
| `k8s-manifests/base/backend/secret.yaml` | Kakao 크리덴셜 + FRONTEND_URL 추가 |
| `backend/.env` | Kakao 크리덴셜 로컬 설정 |
| `work-plans/2026-02-27_admin_dashboard_redesign.md` | 작업 계획서 |
