# 2026-02-05 Logo, Nav, Notification & Real-time Alert Updates

## 1. 작업 개요
- **목표**: 사용자 UX 개선, 알림 기능 구현, 실시간 가격 알림 시스템 구축
- **브랜치**: `kyk/0205-logo`
- **관련 워크플랜**:
  - `docs/work-plans/2026-02-05_logo_nav_noti_update.md`
  - `docs/work-plans/2026-02-05_realtime_alert.md`

## 2. 주요 변경 사항

### 2.1 로고 리다이렉트 수정
- **파일**: `frontend/components/PortfolioHeader.tsx`
- **내용**: 좌측 상단 `tutum` 로고 클릭 시 랜딩 페이지(`/`)가 아닌 포트폴리오 메인(`/portfolio/asset`)으로 이동하도록 수정.
- **목적**: 로그인 사용자가 실수로 로그아웃되지 않도록 사용자 경험 개선.

### 2.2 네비게이션 텍스트 변경 (랜딩 페이지)
- **파일**: `frontend/components/TopNav.tsx`
- **내용**: 상단 메뉴바의 "시장" 텍스트를 "**증시**"로 변경.
- **목적**: 금융 서비스로서의 정체성을 명확히 하기 위함.

### 2.3 TopNav 다크모드 지원 추가
- **파일**: `frontend/components/TopNav.tsx`
- **내용**: TopNav에 다크모드 클래스가 전혀 없어 다크 테마에서 UI가 깨지는 문제 수정.
- **변경 요소**:
  - nav 배경: `bg-white` → `bg-white dark:bg-zinc-950`
  - 테두리: `border-gray-200` → `+ dark:border-zinc-800`
  - 로고 아이콘/텍스트: `dark:bg-white dark:text-black` / `dark:text-white` 추가
  - 내비 링크: `dark:text-gray-300`, `dark:hover:bg-zinc-800` 추가
  - 로그인 버튼: `dark:bg-white dark:text-black` 추가

### 2.4 알림 Popover UI 구현
- **파일**: `frontend/components/PortfolioHeader.tsx`, `frontend/components/ui/popover.tsx` (신규)
- **내용**:
  - shadcn/ui 기반 `Popover` 컴포넌트 추가 (`@radix-ui/react-popover` 래핑).
  - 헤더의 Bell 아이콘 클릭 시 알림 팝오버 표시.
  - 읽지 않은 알림이 있을 경우 빨간 점(Badge) 조건부 표시.
  - 기존 메뉴(설정, 유저, 검색)와 상호 배타 처리.

### 2.5 실시간 가격 알림 시스템 (Backend)
- **신규 파일**:
  - `backend/app/models/notification.py` — Pydantic 알림 모델 (`Notification`, `NotificationListResponse`)
  - `backend/app/services/alert_service.py` — `MarketMonitor` 클래스
  - `backend/app/routers/notifications.py` — 알림 API 엔드포인트
- **수정 파일**: `backend/app/main.py` — lifespan에 MarketMonitor 통합, 라우터 등록
- **기능**:
  - 60초 간격 백그라운드 가격 모니터링 (BTC, ETH, XRP, SOL)
  - Upbit API 기반 `crypto_client` 재사용
  - 5분 전 대비 3% 이상 급락/급등 감지 시 알림 자동 생성
  - 10분 cooldown으로 중복 알림 방지
  - In-memory 저장소 (최대 100건, FIFO)
- **API**:
  - `GET /api/v1/notifications` — 알림 목록 조회 (limit, unread_only 파라미터)
  - `POST /api/v1/notifications/read-all` — 전체 읽음 처리

### 2.6 프론트엔드 알림 API 연동
- **파일**: `frontend/components/PortfolioHeader.tsx`
- **내용**:
  - `SAMPLE_NOTIFICATIONS` 하드코딩 제거, 백엔드 API polling으로 교체
  - 30초 간격 `useEffect` + `setInterval` 패턴 (기존 `useCoins` 훅과 동일)
  - `getTimeAgo()` 상대 시간 변환 유틸 함수 추가
  - `unreadCount` 기반 Bell badge 조건부 표시
  - API 오류 시 빈 배열 폴백 처리, "새로운 알림이 없습니다" 빈 상태 UI

## 3. 검증 결과
- **로고 리다이렉트**: `href="/portfolio/asset"` 변경 확인.
- **네비게이션 텍스트**: Desktop/Mobile 양쪽 "증시" 반영 확인.
- **TopNav 다크모드**: 다크 테마에서 배경, 텍스트, 버튼 정상 표시.
- **알림 Popover**: 팝오버 열기/닫기, 기존 메뉴와 상호 배타 동작 확인.
- **백엔드 모니터링**: 서버 시작 시 `[INFO] Market Monitor Started` 로그 출력 확인.
- **API 엔드포인트**: `GET /api/v1/notifications` 정상 응답 확인.
- **빌드**: `Compiled successfully` (기존 `CoinItem.tsx` 타입 에러는 별도 이슈).

## 4. 알려진 이슈
- `lightweight-charts` 라이브러리 HMR 시 `Object is disposed` 에러 — dev 모드 전용, 페이지 새로고침으로 해결. 프로덕션에서는 발생하지 않음.
- `CoinItem.tsx:74` 타입 에러 (`sparklineData` 타입 불일치) — 이번 작업과 무관한 기존 이슈.

## 5. 향후 계획
- MongoDB `notifications` 컬렉션으로 영구 저장소 마이그레이션.
- `CryptoClient.get_multiple_prices()` 배치 조회 메서드 추가 (API 호출 4회→1회 최적화).
- 브라우저 탭 비활성 시 polling 중단 (`visibilitychange` 이벤트 활용).
- 사용자별 알림 임계값 커스터마이징 기능.
