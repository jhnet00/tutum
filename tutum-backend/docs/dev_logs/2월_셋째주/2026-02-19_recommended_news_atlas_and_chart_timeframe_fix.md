# 📅 개발 작업 완료 보고서 (2026-02-19)

## 📌 작업 개요
- **작성자**: `kyk02405` (Kyung Yoon Kim)
- **Jira Ticket**: `N/A`
- **Branch**: `kyk/recommended-portfolio` → `develop`
- **작업 내용**:
  - 사용자 맞춤 추천뉴스 비노출 이슈 원인 분석 및 Atlas 전환
  - 추천뉴스 API/프론트 BFF 실검증
  - `/portfolio/chart` 구간별 timeframe 동작 및 타임스탬프 표시 수정

---

## 1. 🔧 주요 변경 사항

### 1-1. 추천뉴스 데이터 소스 Atlas 전환
- **문제**: 추천뉴스 영역이 비거나 fallback 비율이 높음
- **원인**:
  - `docker-compose.yml`의 backend 환경변수에서 `MONGODB_URL=mongodb://mongodb:27017`을 강제
  - 로컬 Mongo(`clouddx.news`)가 비어 있어 추천 매칭 데이터 부족
- **조치**:
  - backend의 로컬 Mongo 강제값 제거
  - `backend/.env`의 Atlas URI를 backend 런타임에 반영

### 1-2. 프론트 뉴스 BFF 내부 라우팅 보정
- **문제**: `/api/public/news?mode=recommended` 호출이 컨테이너 내부에서 backend를 안정적으로 못 찾는 케이스 존재
- **조치**:
  - `frontend/app/api/public/news/route.ts`에 `BACKEND_INTERNAL_URL` 우선 적용
  - `docker-compose.yml` frontend 환경변수에 `BACKEND_INTERNAL_URL=http://backend:8000` 추가

### 1-3. 추천뉴스 실검증 (로그인 세션 기준)
- 테스트 사용자 생성 후 포트폴리오 입력:
  - `005930`, `AAPL`, `MSFT`, `000660`
- 검증 결과:
  - `GET /api/v1/news/recommended?limit=6` -> `is_fallback=false`
  - `GET /api/public/news?mode=recommended&limit=6` -> `recommended.isFallback=false`, `myAssets` 정상 채움

### 1-4. 차트 timeframe 매핑 및 히스토리 처리 수정
- **문제**: `1분/5분/1시간/1일/1주일/1달/1년`이 유사하게 보이거나 동일하게 보이는 현상
- **원인**:
  - 프론트 timeframe 매핑 누락 (`1주일/1달/1년`이 사실상 동일 파라미터로 전송)
  - 백엔드 분봉 empty 시 일봉 강제 fallback
- **조치**:
  - 프론트 `AdvancedChart` timeframe 매핑 보강 (`W/M/Y`)
  - 백엔드 `market_data.py`:
    - 분봉 요청(1/5/60) 시 bucket 단위 리샘플링
    - `count` 반영
  - 백엔드 `market.py`:
    - 분봉 empty 시 일봉 강제 fallback 제거
    - mock fallback 시에도 timeframe 단위(분/주/월) 맞춰 타임스탬프 생성

### 1-5. 차트 하단 타임스탬프 포맷 통일
- **문제**: 1년 구간에서 `31일`, `4월`, `31 10월 25` 등 혼합 포맷 노출
- **조치** (`frontend/components/AdvancedChart.tsx`):
  - 축/크로스헤어 시간 포맷터 커스텀 적용
  - 형식 통일:
    - `1분/5분/1시간` -> `MM.DD HH:mm`
    - `1일/1주일/1달/1년` -> `YYYY.MM.DD`

---

## 2. ✅ 검증 결과

### 2-1. 추천뉴스
- backend:
  - `GET /api/v1/news?limit=3` 응답 `total=4000+` 확인
  - `GET /api/v1/news/recommended` 로그인 세션 기준 `is_fallback=false` 확인
- frontend BFF:
  - `/api/public/news?mode=recommended`에서 `myAssets`/`recommended` 정상 반환 확인

### 2-2. 차트 timeframe
- 샘플 검증 기준:
  - `stock:005930`, `crypto:KRW-BTC`
- 결과:
  - `1분` 간격: 60초
  - `5분` 간격: 300초
  - `1시간` 간격: 3600초
  - `1일/1주일/1달/1년`: 구간별 서로 다른 간격/범위 확인

---

## 3. 📝 커밋 내역

```bash
e3afeb0 docs: update work plan and API architecture runtime status
0296391 fix: switch recommended news flow to Atlas and internal backend route
ad2a6b0 fix(chart): normalize timeframe labels and market history intervals
```

---

## 4. 결론
- 사용자 포트폴리오 기반 추천뉴스 경로는 현재 정상 동작(`is_fallback=false` 검증 완료).
- 차트 timeframe/타임스탬프는 구간별로 의도한 형태로 분리·표시되도록 수정 완료.
- `kyk/recommended-portfolio` 작업은 `develop`까지 반영 완료.
