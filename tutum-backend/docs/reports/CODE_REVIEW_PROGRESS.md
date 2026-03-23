# CODE REVIEW Progress

기준 문서: `docs/reports/CODE_REVIEW_ISSUES.md`
브랜치: `develop`
최종 업데이트: 2026-02-12

## 1) 완료됨

### Backend
- B1: health traceback 노출 제거
- B2: OAuth httpx timeout 적용
- B3: JWT SECRET_KEY 하드코딩 제거/검증
- B4: ObjectId 검증 보강
- B5: asset_type Literal 적용
- B6: rate limit fail-open/fail-closed 정책 보강
- B7: OAuth 토큰 URL 노출 제거
- B8: user_id 타입 불일치 보정
- B9: portfolio 업데이트 화이트리스트 적용
- B10: Bedrock stream 타임아웃/안정화
- B11: 환율 하드코딩 제거 + 외부 API/fallback
- B12: market_data 무응답 시 명시적 error 반환
- B13: 포트폴리오 조회 실패 컨텍스트 전달
- B14: BulkAssetCreate 최대 개수 제한
- B15: ES replicas 설정 환경분리
- B16: 알림 상태 Redis 영속화
- B17: CORS allow_methods 명시
- B18: news regex escape 적용
- B19: monitor task shutdown cancel/await 처리
- B20: REDIS_AVAILABLE dead code 제거
- B21: backend/app 프로덕션 경로 print -> logging 전환
- B22: database.py 인코딩/주석 정리
- B24: portfolio MariaDB 내부 에러 메시지 노출 차단
- B25: transaction_date 미래 날짜 검증 추가
- B26: /health, /ready 분리
- B27: SSE graceful shutdown 처리
- B28: MariaDB pool 설정 환경변수화

### Frontend
- F1: OAuth callback URL token 의존 제거
- F2: AuthContext 토큰 저장 정책 보강
- F3: logout 쿠키 무효화 정리
- F5: confirm-input 이벤트 리스너 cleanup
- F6: refreshPrices 무한루프 이슈 해소(브랜치 반영)
- F7: Chat markdown sanitize 적용
- F9: OAuth state 검증 플로우 적용
- F10: Sell API user_id query 제거(JWT 기반)
- F11: confirm-input/portfolio write CSRF 토큰 검증 추가
- F13: 로그인 클라이언트 측 시도 제한/잠금 UX 추가
- F12: API URL 노출 정책 재정의 (`/api/proxy` + server route base URL 정리)
- F14: 로그아웃 시 진행중 요청 abort 보강
- F15: 전역 fetch timeout/abort 표준화(Auth/Asset 컨텍스트)
- F16: refresh token 체계 확립(`/auth/refresh`, refresh cookie rotation, 프론트 자동 갱신)
- F17: 로그인 에러 핸들링 UX 보강(inline 에러/잠금 UX)
- F18: `context/` vs `contexts/` 경로 정리
- F19: MarketSnapshot 에러 상태 분리
- F20: 매도 후 hard reload 제거
- F21: trading-analysis response.ok 체크
- F23: MarketSnapshot 로딩/에러 UI 분리
- F24: 불필요 console 성공 로그 제거
- F25: MarketSnapshot 재시도(backoff) 추가
- F27: OAuth 버튼 중복 클릭 방지

## 2) 미완료

### Frontend
- 없음

## 3) 현재 리스크/블로커

- 현재 치명적 블로커 없음.
- frontend `lint/build` 검증 통과 상태.
- 잔여 작업은 신규 이슈 발생 시 추가.

## 4) 비고

- backend 핵심 파일 컴파일 검증은 이전 단계에서 완료.
- frontend 검증:
  - `npm run lint` 통과 (warning/error 없음)
  - `npm run build` 통과
