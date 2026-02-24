# 2026-02-12 코드리뷰 이슈 수정 현황 (중간 정리)

## 1) 오늘 반영된 주요 수정

- 인증/보안
  - `SECRET_KEY` 미설정으로 백엔드 기동 실패하던 문제 해결 (`backend/.env` 설정 반영)
  - Refresh Token 체계(F16) 반영
    - `backend/app/routers/auth.py`
      - `POST /api/v1/auth/refresh` 추가
      - access/refresh 쿠키 발급 공통화
      - logout 시 세션/refresh 정리 로직 보강
    - `frontend/contexts/AuthContext.tsx`
      - 초기 인증 복원 시 `refresh -> me` 재시도
      - 주기적 refresh 연동
  - CSRF 검증 대상 확장 (refresh cookie 포함)

- 프록시/환경변수
  - `frontend/app/api/proxy/[...path]/route.ts`
    - `API_BASE_URL || NEXT_PUBLIC_API_URL` fallback 처리
  - `frontend/app/api/public/news/route.ts`
    - 동일 fallback 처리 및 dynamic 라우트 설정 유지

- 프론트 안정화
  - 로그인 페이지 문구 한국어 복구 (`frontend/app/login/page.tsx`)
  - 자산 컨텍스트 로딩 타이밍 보정 (`frontend/context/AssetContext.tsx`)
    - Auth 로딩 중 포트폴리오 조회 지연
    - 기본 `credentials: include` 적용

- 문서
  - `docs/reports/CODE_REVIEW_PROGRESS.md` 업데이트(F16 완료 반영 포함)

## 2) 확인된 동작 결과

- 통과
  - `npm run lint` 통과
  - `npm run build` 통과
  - 서버 헬스체크: `/health`, `/ready` 응답 확인
  - 회원가입/로그인/로그아웃 기본 동작 확인
  - `POST /auth/refresh` 재검증 후 200 확인
  - `GET /api/public/news` 200 확인

- 주의/추가확인 필요
  - 포트폴리오 조회 API는 trailing slash 여부에 따라 308 리다이렉트가 발생 가능
    - 클라이언트 요청 URL 통일(`/api/v1/portfolio/` 또는 `/api/v1/portfolio`) 필요
  - 실사용 브라우저에서 로그인 직후 자산 화면 오류 재현 여부 최종 확인 필요

## 3) 아직 남은 수정 필요 항목

- F22 잔여 지점 정밀 점검
  - `JSON.parse` 사용처 중 데이터 스키마 검증까지 필요한 곳 추가 보강
- 포트폴리오 API 경로 표준화
  - 프론트 전역에서 trailing slash 정책 통일
- 스모크 테스트 자동화
  - 인증/포트폴리오 CRUD/refresh/public API를 CI에서 재현 가능하게 스크립트화

## 4) 다음 액션 제안

1. 포트폴리오 API 경로 통일 패치 적용
2. 로그인 -> 자산조회 브라우저 실사용 시나리오 재검증
3. F22 잔여 지점 정리 후 `CODE_REVIEW_PROGRESS.md` 최종 확정
