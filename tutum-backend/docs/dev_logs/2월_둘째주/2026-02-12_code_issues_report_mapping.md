# 2026-02-12 CODE_ISSUES_REPORT 기준 반영 현황

기준 문서: `docs/reports/CODE_ISSUES_REPORT.md`

## 완료(확인됨)

- #1 SellAssetDialog userId 하드코딩 제거
  - `frontend/components/SellAssetDialog.tsx`
- #2 AssetResponse `profit_percent` 중복 정의 제거
  - `backend/app/routers/assets.py`
- #3 Transaction ID `None` 반환 이슈 수정 (`inserted_id` 사용)
  - `backend/app/routers/assets.py`
- #4 매도 Race Condition 완화 (원자적 수량 차감)
  - `backend/app/routers/assets.py`
- #5 OAuth 콜백 URL 하드코딩 제거 (`FRONTEND_URL` 사용)
  - `backend/app/routers/auth.py`
- #6 Frontend 자산 API 인증 헤더/인증 흐름 보강
  - `frontend/context/AssetContext.tsx`
- #10 세션 만료 체크 1초 루프 조정 (60초)
  - `frontend/contexts/AuthContext.tsx`
- #11 KIS 토큰 Race Condition 완화 (`asyncio.Lock`)
  - `backend/app/services/market_data.py`
- #12 MongoDB 연결 실패 시 상태 처리 보강 (`database=None`)
  - `backend/app/database.py`

## 이번 작업 중 추가 반영

- 인증 프록시 환경변수 fallback 수정
  - `frontend/app/api/proxy/[...path]/route.ts`
- Refresh Token 체계(F16) 반영
  - `backend/app/routers/auth.py`
  - `frontend/contexts/AuthContext.tsx`
- 로그인 페이지 한국어 문구 복구
  - `frontend/app/login/page.tsx`
- 백엔드 기동 필수값(`SECRET_KEY`) 반영 후 서버 정상화

## 미완료(추가 작업 필요)

- #13 Kafka Worker 재연결 로직 고도화
  - `backend/workers/price_producer.py`
  - `backend/workers/news_producer.py`
- #15 환경변수 검증 전면 강화 (validator 기반)
  - `backend/app/config.py`
- #18 백엔드 비밀번호 복잡도 검증 강화
  - `backend/app/routers/auth.py`

## 비고

- 현재 기준 `frontend` lint/build는 통과 상태.
- 인증/프록시 관련 치명 이슈는 1차 해소됨.
