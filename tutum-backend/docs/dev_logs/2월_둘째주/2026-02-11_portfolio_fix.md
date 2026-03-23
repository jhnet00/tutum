# 포트폴리오 자산 등록/표시 수정 및 AI 마크다운 렌더링 (2026-02-11)

## 작업 개요
- **작성자**: `kyk02405`
- **Branch**: `kyk/0211-portfolio`
- **작업 내용**: 자산 등록 실패 원인 수정, Mock 데이터 제거, AI 채팅 마크다운 렌더링

---

## 1. 자산 등록 실패 수정 (MariaDB enum 제약)

### 문제
- 프론트엔드에서 자산 등록 시 `POST /api/v1/portfolio/bulk` → 201 응답이지만 실제 DB에 0건 저장
- 원인: `portfolios.asset_type` 컬럼이 `enum('stock_kr','stock_us','crypto','etf')`인데 프론트엔드에서 `"stock"` 전송
- `bulk_create_portfolio_items`가 per-item exception을 catch하여 201 반환 → 실패가 숨겨짐

### 수정
- **`backend/app/mariadb.py`**: Portfolio 모델 `asset_type`을 `SAEnum(...)` → `String(20)`으로 변경
- **MariaDB**: `ALTER TABLE portfolios MODIFY COLUMN asset_type VARCHAR(20) NOT NULL`

---

## 2. 자산 등록 후 포트폴리오 갱신 안 되는 문제

### 문제
- `confirm-input/page.tsx`에서 API 직접 호출 후 `router.push()` → AssetContext 미갱신 → 포트폴리오 0원 표시

### 수정
- **`frontend/app/confirm-input/page.tsx`**:
  - `useAsset()` hook 추가
  - 등록 성공 후 `await fetchHoldings()` 호출하여 AssetContext 동기화

---

## 3. Mock 데이터 제거

### 수정 내용 (`frontend/app/portfolio/asset/page.tsx`)

| 제거 항목 | 설명 |
|---|---|
| `mockCash = 69235` | 하드코딩된 보유 현금 69,235원 |
| 보유 현금 섹션 | 데스크톱 테이블 + 모바일 카드 |
| `mockSellHistory` | AAPL, TSLA, BTC 가짜 매도 내역 3건 |
| Mock 요약 카드 | 총 매도 ₩12.5M, 최고 수익 BTC, 매도 성향, 총 거래 15 |
| 필터 드롭다운 | 월별/수익/손실 필터 (실제 데이터 없이 불필요) |
| `sellHistoryFilter` state | 미사용 상태 변수 제거 |
| `Wallet`, `Calendar` import | 미사용 아이콘 제거 |

---

## 4. AI 채팅 마크다운 렌더링

### 문제
- AI 응답에서 `**볼드**`, `- 리스트` 등 마크다운이 raw text로 표시

### 수정
- **`react-markdown`** 패키지 설치
- **`frontend/components/chat/ChatMessages.tsx`**: `{content}` → `<ReactMarkdown>{content}</ReactMarkdown>`

---

## 5. 변경 파일 목록

| 파일 | 변경 유형 |
|------|-----------|
| `backend/app/mariadb.py` | 수정 (asset_type enum → String) |
| `frontend/app/confirm-input/page.tsx` | 수정 (fetchHoldings 연동) |
| `frontend/app/portfolio/asset/page.tsx` | 수정 (Mock 데이터 전면 제거) |
| `frontend/components/chat/ChatMessages.tsx` | 수정 (react-markdown 적용) |
| `frontend/package.json` | 수정 (react-markdown 의존성 추가) |

---

## 6. 검증

- 자산 등록 → MariaDB `portfolios` 테이블에 정상 저장 확인
- 포트폴리오 페이지 → 총 자산 433,332원 정상 표시
- 매도 내역 탭 → "매도 내역이 없습니다." 빈 상태 표시
- AI 채팅 → 마크다운 볼드/리스트 정상 렌더링
