# 📋 kyk02405 작업 계획서
> **작성일**: 2026-02-19
> **작성자**: kyk02405 (Kyung Yoon Kim)
> **기준 브랜치**: `develop`

---

## ✅ 오늘 완료한 작업 (2026-02-19)

| 브랜치 | 내용 | 상태 |
|--------|------|------|
| `kyk/0219-chart` | ChartSidebar 자산탭 실제 포트폴리오 연동 | ✅ develop 병합 완료 |
| `kyk/0219-chart` | 차트 헤더 KR 종목코드 → 종목명 표시 | ✅ develop 병합 완료 |
| `kyk/0219-chart` | 검색창 placeholder, 도미노 문구 수정 | ✅ develop 병합 완료 |
| `kyk/0219-chart` | mock-data.ts 33개 주식 / 9개 코인으로 확장 | ✅ develop 병합 완료 |
| `kyk/0219-chart` | direct-input 종목 목록 동기화 (34개) | ✅ develop 병합 완료 |
| `develop` | AI 파이프라인 ES+kNN, Node3 Bedrock 활성화 | ✅ 완료 |
| `kyk/0219-stock-search` | KRX 종목 검색 API + debounce UI | ✅ 브랜치 푸시 완료, 미병합 |

---

## 🧭 지금 해야 할 작업 (2026-02-19 실시간 업데이트)

### A. 배포/검증 복구 (최우선)
- [x] `kyk/recommended-portfolio` 변경사항 `develop` 반영 완료
- [x] Node1 SSH 상태 복구 (`2211` 접속 정상)
- [x] Node1에서 `docker compose up -d --force-recreate backend` 재기동
- [x] Node1 백엔드/프론트/워커 컨테이너 기동 확인
  - `clouddx-backend`, `clouddx-frontend`, `clouddx-price-producer`, `clouddx-price-consumer` Up
  - `/health`, `/ready` 정상
- [x] 검색 API 스모크 테스트 재실행
  - `GET /api/v1/market/search?q=삼성전자`
  - `GET /api/v1/market/search?q=NVDA`
  - `GET /api/v1/market/search?q=bitcoin`
  - 결과: 3건 모두 정상 응답 확인 (Node1, 2026-02-19)

### B. 자산 기반 추천뉴스 확인/보강
- [x] `/portfolio/asset` 추천뉴스 호출 경로 확인
  - `frontend/components/PersonalizedNewsCarousel.tsx`
  - `frontend/app/api/public/news/route.ts`
  - `backend/app/routers/news.py`
- [x] 추천뉴스 미노출 원인 1차 확인 (Node1 데이터 점검)
  - MongoDB `clouddx.news` 문서 수: `0`
  - Node1 Mongo DB 목록: `admin`, `config`, `local` (앱 데이터 미적재)
- [x] 추천뉴스 데이터 소스 2차 조치: Atlas 전환
  - `docker-compose.yml` backend의 로컬 Mongo 강제값 제거
  - backend `MONGODB_URL` = Atlas(`mongodb+srv://...`) 반영 확인
  - `GET /api/v1/news?limit=3` 응답 기준 `total=4064` 확인 (Node1, 2026-02-19)
- [x] 로그인 세션 기준 추천뉴스 실검증 완료 (Node1)
  - 테스트 사용자 포트폴리오: `005930`, `AAPL`, `MSFT`, `000660`
  - `GET /api/v1/news/recommended?limit=6` 결과: `is_fallback=false`
  - 프론트 BFF `GET /api/public/news?mode=recommended&limit=6` 결과도 `isFallback=false`, `myAssets` 정상 채움
- [ ] 추천뉴스 fallback 비율 점검 (`is_fallback` 모니터링)
- [ ] 포트폴리오 보유 종목명/코드 정규화 품질 점검 (예: KR/US/코인 표기 통일)

### C. 다음 구현
- [ ] 프론트 추천뉴스 카드에 추천 근거(추천 자산/키워드) 노출 여부 결정
- [ ] 필요 시 추천뉴스 랭킹 규칙 개선 (보유비중 가중치 + 최신성 가중치 튜닝)

### D. 보류 항목 (Node 장애, 추후 재개)
- [ ] **보류**: node2/node3 SSH/VM 장애 복구
  - 증상: `2213` 포트는 열리지만 SSH 배너 타임아웃
  - 증상: `2212` 포트 타임아웃(접속 불가)
- [x] Node1 SSH/배포 검증 재개
  - `docker compose up -d --force-recreate backend` 수행
  - 백엔드 env 누락(`SECRET_KEY`, `MARIADB_PASSWORD`) 재주입 완료
  - `GET /health`, `GET /ready` 정상
- [x] Node1 검색 API 스모크 테스트 완료
  - `GET /api/v1/market/search` 3종 정상
- [ ] **보류**: 추천뉴스 운영 환경 검증
  - Atlas `clouddx.news`/추천뉴스 API 결과 재검증(로그인 세션 기준 UI 포함)
  - `/api/v1/news/recommended` `is_fallback` 비율 점검

#### Node 이슈 재개 체크리스트
1. VM 전원/리소스 상태 확인 (CPU, RAM, Disk)
2. 각 노드에서 `sudo systemctl restart ssh && sudo systemctl restart docker`
3. SSH 접속 복구 확인 (`2211/2212/2213`)
4. Node1 서비스/헬스체크/뉴스 API 재검증

---

## 🔥 우선순위 1 — 이번 주 내 완료 (긴급)

### 1-1. `kyk/0219-stock-search` → develop 병합
- [ ] Node1에서 백엔드 배포 후 `GET /api/v1/market/search?q=삼성전자` 응답 확인
- [ ] KRX API 연결 여부 확인 (`data.krx.co.kr` 접근 가능한지)
  - 접근 불가 시: embedded fallback(~60개) 으로만 동작 → 문제없음
- [ ] 프론트 검색창에서 타이핑 → 결과 표시 확인
- [ ] develop 병합 및 Node1 재배포

```bash
# 테스트 명령어 (Node1 접속 후)
curl "http://localhost:8000/api/v1/market/search?q=삼성전자"
curl "http://localhost:8000/api/v1/market/search?q=NVDA"
curl "http://localhost:8000/api/v1/market/search?q=bitcoin"
```

### 1-2. 차트 KRW 변환 버그 수정 (`docs/work-plans/2026-02-10_portfolio_chart_refactor.md`)
- [ ] **Critical**: `AdvancedChart.tsx` 에서 코인 가격 1450배 부풀리는 버그
  - Upbit은 이미 KRW 반환 → 코인 rate=1 적용 필요
- [ ] **Timeframe**: `1주일`, `1달`, `1년` 클릭 시 차트 미업데이트
  - 백엔드 `market.py`에 W/M/Y 매핑 추가
- [ ] 브랜치: `kyk/0219-chart-bugfix`로 작업 후 develop 병합

---

## 📌 우선순위 2 — 이번 달 내 완료

### 2-1. AI 채팅 포트폴리오 연동
- [ ] 사용자의 실제 보유 자산을 AI 채팅 context에 포함
  - "내 포트폴리오 분석해줘" 질문 시 실제 holdings 데이터 참고
  - `chat_service.py`에서 MariaDB 포트폴리오 조회 → 프롬프트 삽입
- [ ] 현재 뉴스 기반 답변 + 포트폴리오 기반 맞춤 분석 결합

### 2-2. 뉴스 피드 UI 연동
- [ ] Elasticsearch에 쌓인 뉴스(801개+)를 프론트 뉴스 섹션에 표시
- [ ] 종목 클릭 시 관련 뉴스 사이드패널 표시
  - `GET /api/v1/news?symbol=삼성전자` 엔드포인트 활용

### 2-3. UX 개선
- [ ] `alert()` → Toast 메시지로 전환 (에러/성공 알림)
  - 현재: `alert(error.message)` 방식
  - 목표: `shadcn/ui toast` 또는 `sonner` 사용
- [ ] 차트 사이드바 실시간 시세 폴링 → WebSocket으로 전환 검토
  - 현재: 30초 REST 폴링
  - 목표: `/api/v1/market/ws` WebSocket 구독 (이미 백엔드 구현됨)
- [ ] `direct-input` 페이지에서 검색 결과 선택 후 자동 가격 조회
  - 종목 선택 시 `GET /api/v1/market/price/{symbol}` 호출 → 현재가 자동 채움

### 2-4. Elasticsearch kNN 품질 향상
- [ ] Node3 Bedrock 임베딩 적재 현황 모니터링
  - 목표: 전체 801개+ 문서에 임베딩 생성 완료
  - 현재: 13개 → 매 60초 producer 사이클마다 증가 중
- [ ] kNN 검색 정확도 테스트 (임베딩 200개+ 이후 의미 있음)
- [ ] 동의어 사전 보강 (`FINANCIAL_SYNONYMS` 35개 → 추가)

---

## 🚀 우선순위 3 — 인프라 안정화 (K8S 마이그레이션 전)

> 참고: `docs/plans/infra/K8S_CICD_LGTM_SETUP_PLAN.md`, `docs/plans/infra/K8S_MIGRATION_PLAN.md`

### 3-1. Node1 Docker 배포 안정화
- [ ] `docker-compose.yml` 모든 서비스 헬스체크 확인
- [ ] Kafka 운영 모드 기준 통일: **KRaft 사용, Zookeeper 미사용**
  - Compose/K8S 매니페스트/문서에서 `zookeeper` 표기 제거 및 `KRaft`로 정리
- [ ] 환경변수 `.env` → Docker secrets 또는 Kubernetes ConfigMap 전환 준비
- [ ] 이미지 빌드/푸시 스크립트 (`build-and-push.sh`) 정기 실행 검증

### 3-2. 모니터링 기반 구축
- [ ] 백엔드 헬스체크 엔드포인트 (`/health`) 동작 확인
- [ ] 주요 에러 로그 수집 방안 검토 (현재 stdout 로깅만)
- [ ] Kibana 대시보드에서 ES 인덱스 현황 모니터링 설정

### 3-3. K8S 마이그레이션 준비
- [ ] Harbor 레지스트리 이미지 push 자동화
- [ ] Helm chart 또는 kustomize 기본 구조 작성
- [ ] Ingress 설정 검토 (도메인, TLS)

---

## 🗂️ 미구현 백로그 (언젠가)

| 항목 | 비고 |
|------|------|
| 이메일 인증 | UI만 있고 실제 발송 없음 |
| 비밀번호 재설정 | 엔드포인트 없음 |
| 카카오 OAuth | Placeholder만 존재 |
| pytest / Playwright 테스트 | 테스트 파일 전무 |
| React Error Boundary | 미구현 |
| 주식 초성 검색 | KR 종목 ㅅㅅㄷ → 삼성전자 |
| 종목 즐겨찾기 동기화 | 현재 로컬 localStorage만 |
| 모바일 PWA 최적화 | 기본 반응형만 구현 |

---

## 📁 관련 문서

| 문서 | 경로 |
|------|------|
| AI 파이프라인 가이드 | `docs/guides/AI_PIPELINE_GUIDE.md` |
| 차트 리팩토링 계획 | `docs/work-plans/2026-02-10_portfolio_chart_refactor.md` |
| direct-input 개선 계획 | `docs/work-plans/direct-asset-input-improvements.md` |
| K8S 마이그레이션 | `docs/plans/infra/K8S_MIGRATION_PLAN.md` |
| K8S CI/CD LGTM | `docs/plans/infra/K8S_CICD_LGTM_SETUP_PLAN.md` |
| 협업 규칙 | `docs/policies/00_COLLABORATION_RULES.md` |

---

## 🌿 브랜치 전략

```
main          ← 배포 완료된 안정 버전
  └─ develop  ← 통합 브랜치 (항상 최신)
       ├─ kyk/0219-stock-search  ← 현재 작업 중 (미병합)
       └─ kyk/MMDD-{feature}    ← 다음 작업 브랜치
```

> 작업 순서: feature 브랜치 → 테스트 → develop 병합 → Node1 배포 확인 → main PR
