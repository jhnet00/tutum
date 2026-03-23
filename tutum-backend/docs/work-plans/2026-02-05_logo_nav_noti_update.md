# Work Plan: Logo Redirect, Nav Update, and Notification Feature

**Date**: 2026-02-05
**Task**: Update Logo Redirect, Landing Page Nav Text, and Implement Mock Notifications
**Branch**: `kyk/0205-logo`

## 1. Goal Description
The user requests three specific UI/UX improvements:
1.  **Logo Redirect**: Fix the top-left logo link in the Portfolio section to redirect to the main dashboard (`/portfolio/asset`) instead of the landing page (`/`).
2.  **Landing Page Nav**: Change the navigation menu item "시장" (Market) to "증시" (Stock Market) for better clarity.
3.  **Notification Mockup**: Add a mock notification system (popover) to the bell icon in the header to demonstrate alerts for asset price changes.

## 2. Architecture & Design

### 2.1 Database Schema Changes
*   **Current Phase**: None. We are using client-side mock data.
*   **Future Phase (Reference)**:
    ```typescript
    // Collection: notifications
    {
      _id: ObjectId,
      userId: ObjectId,
      type: "PRICE_ALERT" | "system",
      title: String, // e.g., "BTC 급락 주의"
      message: String, // e.g., "비트코인이 5분 만에 3% 하락했습니다."
      isRead: Boolean,
      createdAt: DateTime
    }
    ```

### 2.2 API Design
*   **Current Phase**: None.
*   **Future Phase**:
    *   `GET /api/v1/notifications`: Fetch user notifications.
    *   `PATCH /api/v1/notifications/{id}/read`: Mark as read.

### 2.3 Frontend Implementation

#### Task A: Logo Redirect
*   **File**: `frontend/components/PortfolioHeader.tsx` (Line 62)
*   **Change**: `<Link href="/">` → `<Link href="/portfolio/asset">`
*   **Note**: 단 1줄 변경. 이 컴포넌트는 6개 페이지(`portfolio/layout`, `direct-input`, `bulk-upload`, `asset-upload/ocr`, `confirm-input`, `asset-upload/csv`)에서 사용되므로 한 곳 수정으로 전체 반영됨.

#### Task B: Landing Page Nav Text
*   **File**: `frontend/components/TopNav.tsx` (Line 11)
*   **Change**: `navLinks` 배열에서 `{ href: "#market", label: "시장" }` → `{ href: "#market", label: "증시" }`
*   **Note**: Desktop 메뉴(line 35-43)와 Mobile Sheet 메뉴(line 73-82) 모두 `navLinks`를 map하므로 배열 값 하나만 바꾸면 양쪽 다 반영됨.

#### Task C: Notification Popover
*   **File**: `frontend/components/PortfolioHeader.tsx` (Lines 218-221)
*   **현재 상태**: Bell 아이콘이 `<Button>` 안에 있지만 onClick 핸들러나 Popover 연동이 없음. 빨간 점(badge)만 표시 중.
*   **구현 방식**:
    *   **Popover UI 컴포넌트 생성 필요**: `frontend/components/ui/popover.tsx`가 존재하지 않으므로 shadcn/ui popover 래퍼를 먼저 추가해야 함. (`@radix-ui/react-popover`는 이미 `package.json`에 설치되어 있음 — v1.1.15)
    *   Bell 버튼을 `Popover.Trigger`로 래핑
    *   State 추가: `isNotificationOpen` (boolean)
    *   Mock 데이터 배열을 컴포넌트 내부 또는 별도 파일에 정의
*   **Mock Data 구조**:
    ```typescript
    const mockNotifications = [
      { id: 1, type: "PRICE_ALERT", title: "BTC 급락 주의", message: "비트코인이 5분 만에 3% 하락했습니다.", isRead: false, createdAt: "2026-02-05T09:30:00" },
      { id: 2, type: "PRICE_ALERT", title: "ETH 급등", message: "이더리움이 10분 만에 5% 상승했습니다.", isRead: false, createdAt: "2026-02-05T09:15:00" },
      { id: 3, type: "system", title: "포트폴리오 리포트", message: "1월 월간 리포트가 준비되었습니다.", isRead: true, createdAt: "2026-02-04T18:00:00" },
    ];
    ```
*   **Popover 디자인 가이드라인**:
    *   기존 `isMenuOpen` 드롭다운(line 236-272)과 동일한 스타일 패턴 적용 (rounded-xl, shadow-xl, animate-in 등)
    *   읽지 않은 알림은 좌측에 작은 파란 점 또는 배경색 구분
    *   읽은 알림은 흐린 텍스트 처리
    *   빈 상태일 때 "새로운 알림이 없습니다" 표시
    *   Bell 아이콘의 빨간 점은 읽지 않은 알림이 있을 때만 표시하도록 조건부 렌더링
*   **기존 Overlay와의 충돌 방지**:
    *   PortfolioHeader에는 이미 3가지 오버레이 상태(`isMenuOpen`, `isUserMenuOpen`, `isSearchOpen`)가 있음 (line 317-328).
    *   `isNotificationOpen` 상태를 이 오버레이 조건에 추가하고, 다른 메뉴 열 때 알림 popover가 닫히도록 상호 배타 처리 필요.

## 3. Implementation Steps (구현 순서)

### Step 1: shadcn/ui Popover 컴포넌트 추가
```bash
npx shadcn@latest add popover
```
또는 수동으로 `frontend/components/ui/popover.tsx` 생성 (`@radix-ui/react-popover` 래핑).

### Step 2: Logo Redirect 변경
*   `PortfolioHeader.tsx` line 62: `href="/"` → `href="/portfolio/asset"`

### Step 3: Nav Text 변경
*   `TopNav.tsx` line 11: `label: "시장"` → `label: "증시"`

### Step 4: Notification Popover 구현
1.  `PortfolioHeader.tsx`에 mock 알림 데이터 추가
2.  `isNotificationOpen` state 추가
3.  Bell 버튼에 onClick 핸들러 연결
4.  Popover 컴포넌트로 알림 목록 UI 구현
5.  기존 overlay 닫기 로직에 `isNotificationOpen` 포함
6.  읽지 않은 알림 수에 따라 빨간 점 조건부 표시

## 4. Browsing Test Scenarios
These scenarios must be verified by the Antigravity Browsing Agent in the final phase.

### Scenario A: Logo Redirect
1.  Navigate to `http://localhost:3000/portfolio/chart`.
2.  Click the "tutum" logo in the top-left corner.
3.  **Pass Criteria**: URL changes to `http://localhost:3000/portfolio/asset`.

### Scenario B: Landing Page Nav
1.  Navigate to `http://localhost:3000`.
2.  Inspect the top navigation bar.
3.  **Pass Criteria**: The menu item previously labeled "시장" now displays "**증시**". (Desktop + Mobile Sheet 메뉴 모두 확인)

### Scenario C: Notification Feature
1.  Navigate to `http://localhost:3000/portfolio/asset`.
2.  Locate the Bell icon in the header.
3.  Click the Bell icon.
4.  **Pass Criteria**:
    *   Popover가 표시되며 mock 알림 리스트가 보임 (e.g., "BTC 급락 주의").
    *   읽지 않은 알림과 읽은 알림이 시각적으로 구분됨.
    *   Popover 바깥 클릭 시 닫힘.
    *   다른 메뉴(설정, 유저) 열면 알림 popover가 자동으로 닫힘.

### Scenario D: Bell Badge 조건부 표시
1.  Navigate to `http://localhost:3000/portfolio/asset`.
2.  **Pass Criteria**: 읽지 않은 알림이 있을 때만 Bell 아이콘 우상단에 빨간 점이 표시됨.

## 5. Refinements by Claude

### 코드 리뷰 결과
1.  **Popover UI 컴포넌트 부재**: `frontend/components/ui/` 디렉토리에 popover.tsx가 없음. `@radix-ui/react-popover`는 이미 설치되어 있으므로 shadcn CLI로 추가하거나 수동 생성 필요.
2.  **상태 관리 충돌**: PortfolioHeader에 이미 5개의 useState가 있고 overlay 닫기 로직이 복잡함. 알림 상태 추가 시 기존 패턴을 그대로 따르되, 모든 메뉴 열기 시 다른 메뉴를 닫는 상호 배타 로직 통일 필요.
3.  **접근성**: Bell 버튼에 `aria-label="알림"` 추가 권장. Popover에 `aria-live="polite"` 적용 권장.
4.  **향후 고려사항**: 현재 mock 데이터를 별도 파일(`lib/mock-notifications.ts`)로 분리하면 추후 API 연동 시 교체가 용이함. 단, 현재 단계에서는 컴포넌트 내 인라인으로 충분.
