# 📈 차트 정합성/실시간 고도화 실행 계획서
> **작성일**: 2026-02-20  
> **작성자**: Codex + kyk02405  
> **대상 페이지**: `http://localhost:3000/portfolio/chart`  
> **작업 브랜치**: `kyk/realtime-chart-stream`

---

## 0. 진행 상태 (2026-02-20)
- [x] 계획서 초안 작성
- [x] V1 백엔드 코드 반영 (분봉 mock fallback 제거, KST 보정)
- [x] V1 프론트 코드 반영 (분봉 no-data 안내 UI, LIVE/REST 상태 표시)
- [x] 프론트 빌드 검증 통과 (`npm run build`)
- [x] V2 1차 코드 반영 (`price_tick` + `candle-aggregator` + API 캐시 우선 조회)
- [x] V3 1차 코드 반영 (해외 분봉 벤더 fallback: Finnhub/Polygon)
- [x] V4 워크플랜 생성 및 착수 (`2026-02-20_chart_v4_session_backfill_plan.md`)
- [x] 실환경 E2E 점검 (장중/장외 분봉 응답 검증)
- [x] `timeframe=M` 월봉이 분봉으로 오인되던 파싱 버그 수정

---

## 1. 목표
- 사용자에게 **가짜 분봉 데이터가 노출되지 않는 차트**를 제공한다.
- `1분/5분/1시간/일/주/월/년` 전 구간에서 시간축/데이터 정합성을 맞춘다.
- 이후 토스형 실시간 차트로 확장 가능한 아키텍처 기반을 만든다.

---

## 2. 단계별 결과물

### V1 (이번 주): 정합성 우선
- [x] 주식 `1분/5분/1시간`에서 mock fallback 제거
- [x] KIS 분봉 조회 시각 KST 기준 보정
- [x] 분봉 데이터 없음 시 차트에 `"장시간 외/분봉 데이터 없음"` 안내 표시
- [x] 분봉은 "실데이터 있으면 표시 / 없으면 명확한 빈 상태" 원칙 적용

**완료 기준**
- [x] `timeframe=1/5/60` API 응답에서 `mock=true`가 더 이상 나오지 않음(주식 기준)
- [x] 분봉 데이터 없을 때 프론트 차트에 안내 문구 표시
- [x] 기존 `일/주/월/년` 동작 회귀 없음

### V2 (다음 1~2주): 실시간 캔들 엔진 분리
- [x] `price_tick` Kafka 수집 파이프라인 정의
- [x] `candle-aggregator` 서비스로 `1분` 캔들 생성
- [x] `5분/1시간` 파생 집계 로직 구현
- [x] Redis(최근), Mongo(장기) 저장 분리
- [x] 프론트 `REST 초기 로드 + WS 델타` 표준화

**완료 기준**
- [x] 캔들 집계가 API 서버 로직에서 분리됨
- [x] 재기동 후에도 최근 캔들 복원 가능
- [x] 실시간 지연/누락 모니터링 지표 확보 (`/api/v1/market/status` candle_monitor)

### V3 (토스형 완성): 데이터 소스 확장
- [x] 해외 주식 분봉 벤더(Polygon/Finnhub) 1차 연동
- [ ] 세션(정규장/애프터), 정정 체결, 휴장일 처리
- [x] replay/backfill 파이프라인 구축

**완료 기준**
- [ ] 국내/해외 분봉 모두 일관된 UX 제공
- [x] 운영 장애 시 백필로 정합성 복구 가능

---

## 3. 이번 작업 범위 (즉시 시작)
이번 커밋 범위는 **V1 + V2 1차 + V3 1차** 포함한다.

### 백엔드
- [x] `backend/app/services/market_data.py`
  - [x] KIS 분봉 조회 기준 시간 `Asia/Seoul` 보정
  - [x] 분봉 날짜 파싱/반환 형식 점검
- [x] `backend/app/routers/market.py`
  - [x] 주식 분봉(`1/5/60`) 빈 응답 시 mock 생성 로직 비활성화
  - [x] 빈 응답 메타(`message`, `no_data_reason`) 반환

### 프론트엔드
- [x] `frontend/components/AdvancedChart.tsx`
  - [x] 분봉 빈 데이터 상태 안내 UI 추가
  - [x] 안내 문구: `"장시간 외/분봉 데이터 없음"`
  - [x] 기존 LIVE/REST 및 timeframe 동작 유지

### 워커/인프라
- [x] `backend/workers/price_producer.py`
  - [x] `price_tick` 토픽 동시 발행
  - [x] 벤더 우선순위(Upbit/Finnhub/Polygon) 기반 시세 수집
  - [x] mock 피드 옵트인(`ALLOW_MOCK_PRICE_FEED`) 적용
- [x] `backend/workers/candle_aggregator.py`
  - [x] 1분 캔들 집계 + Redis 저장
  - [x] Mongo upsert 저장(`candles_1m`)
- [x] `docker-compose.yml`
  - [x] `candle-aggregator` 서비스 추가
  - [x] `price_tick` 환경 변수 wiring

---

## 4. 검증 시나리오
- [x] `stock/005930` `timeframe=1/5/60` 호출 시:
  - 데이터 있으면 정상 캔들
  - 데이터 없으면 빈 배열 + 안내 문구
- [x] `stock/005930` `timeframe=D/W/M/Y` 기존 정상 확인
- [x] `crypto/KRW-BTC` `timeframe=1/5/60/D/W/M/Y` 회귀 없음
- [ ] `/portfolio/chart`에서 timeframe 전환 시 JS 에러 없음

---

## 5. 리스크 및 대응
- 리스크: 분봉 미제공 시간대에 사용자가 "고장"으로 인식  
  대응: 명시적 메시지 + mock 제거로 의도된 상태임을 명확화

- 리스크: Upbit/KIS rate limit로 인한 간헐 실패  
  대응: 재시도/백오프 및 로그 분류(경고/오류) 정리

---

## 6. 산출물
- 코드 변경(PR)
- dev_log 문서 1건
- 운영 점검 체크리스트 업데이트
