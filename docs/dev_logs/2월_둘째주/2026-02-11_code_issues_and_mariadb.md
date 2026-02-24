# 개발 작업 완료 보고서 (2026-02-11)

## 작업 개요
- 작성자: `Kyung Yoon Kim`  
- Branch: feature/chart-api-logo-fix
- 작업 내용:
  - `docs/reports/CODE_ISSUES_REPORT.md` 기준 이슈 수정 반영
  - MariaDB 사용자 저장소 연동 및 마이그레이션 작업 반영
  - 로그인/로그아웃 검증 및 토큰 무효화 동작 보강

## 1. 주요 변경 사항

### A. CODE_ISSUES_REPORT 기반 수정
- 백엔드
  - `backend/app/config.py`
    - `FRONTEND_URL` 설정 추가
  - `backend/app/routers/auth.py`
    - OAuth 콜백 URL 하드코딩 제거 (`FRONTEND_URL` 기반)
  - `backend/app/routers/assets.py`
    - `AssetResponse.profit_percent` 중복 필드 제거
    - 매도 API race condition 완화 (원자적 수량 차감)
    - `transaction_id`를 `inserted_id`로 반환
  - `backend/app/routers/market.py`
    - 운영 환경(`DEBUG=False`)에서 mock history fallback 차단 (`503` 반환)
  - `backend/app/services/market_data.py`
    - KIS 토큰 발급 동시성 제어(`asyncio.Lock`)
    - 환율 계산 0 division 방어
  - `backend/app/database.py`
    - MongoDB 연결 실패 시 `database=None` 명시

- 프론트엔드
  - `frontend/components/SellAssetDialog.tsx`
    - `test_user_id` 제거, 인증 컨텍스트 user/token 사용
    - Authorization 헤더 추가
  - `frontend/context/AssetContext.tsx`
    - 자산 API 호출에 Authorization 헤더 추가
  - `frontend/contexts/AuthContext.tsx`
    - logout API 호출 시 Authorization 헤더 추가
    - 세션 체크 간격 1초 -> 60초 변경
    - `User` 타입 확장 (`profile_image`, `created_at`, `updated_at`)
  - `frontend/lib/hooks/useCoins.ts`
    - 의존성 루프 가능성 완화 (`setCoins(prev => ...)`)
  - `frontend/app/login/page.tsx`, `frontend/app/auth/callback/page.tsx`
    - `useSearchParams`를 `Suspense` 경계로 감싸 prerender 에러 대응
  - `frontend/app/portfolio/trading-analysis/page.tsx`
    - 기존 UI 유지 상태로 인증 기반 호출 반영

### B. MariaDB 연동 작업
- 신규 파일
  - `backend/app/mariadb.py`
    - SQLAlchemy async 엔진/세션, User 모델, CRUD 헬퍼
  - `backend/scripts/migrate_users_to_mariadb.py`
    - MongoDB 사용자 -> MariaDB 마이그레이션 스크립트
- 변경 파일
  - `backend/app/main.py`
    - 앱 시작/종료 시 MariaDB 연결/해제
  - `backend/app/routers/auth.py`
    - 사용자 조회/생성/수정을 MariaDB 경로로 연동
  - `backend/requirements.txt`
    - `aiomysql`, `sqlalchemy[asyncio]` 추가

## 2. 버그 수정
- 로그아웃 후 토큰 재사용 가능 문제 수정
  - 증상: logout 이후 동일 토큰으로 `/api/v1/auth/me` 호출 가능
  - 조치: `backend/app/routers/auth.py`에 로컬 fallback 블랙리스트 추가
    - Redis 미연결 환경에서도 logout 직후 토큰 차단
  - 재검증: login(200) -> logout(200) -> me(401) 확인

## 3. 검증 내역
- 백엔드
  - `python -m py_compile`로 핵심 변경 파일 문법 체크
- 프론트엔드
  - `frontend`에서 `npm run build` 성공
- 런타임
  - 백엔드(8000), 프론트(3000) 재시작 및 리스닝 확인
  - 로그인 계정(`test0211@test.com`) 실로그인 검증 성공
  - 로그아웃 후 토큰 무효화 검증 성공

## 4. 커밋 내역
- 본 로그 작성 시점 기준 단일 정리 커밋으로 반영 예정

---
결론: CODE_ISSUES_REPORT 반영 + MariaDB 연동 + 인증/로그아웃 검증까지 완료.
