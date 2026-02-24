# 📅 개발 작업 완료 보고서 (2026-02-19)

## 📌 작업 개요
**작성자**: `kyk02405` (Kyung Yoon Kim)
**Jira Ticket**: `N/A`
**Branch**: `kyk/0219-chart` → `develop`
**작업 내용**: 차트 페이지 프론트엔드 개선 - 자산 탭 실제 데이터 연동, 종목명 표시, 종목 목록 확장, 검색창 텍스트 수정

---

## 1. 🔧 주요 변경 사항

### 1-1. ChartSidebar 자산 탭 실제 포트폴리오 연동 (`frontend/components/ChartSidebar.tsx`)
- **문제**: `/portfolio/chart` 우측 패널 "자산" 탭이 하드코딩된 mock 심볼을 표시
- **해결**: `useAsset()` 훅 연동 → `holdings` (실제 MariaDB 포트폴리오 데이터) 사용
  - `allAssets`에 있는 종목은 mock 메타데이터(로고, 색상) 활용
  - `allAssets`에 없는 보유 종목은 기본 AssetItem으로 fallback 생성
  - 빈 포트폴리오일 때 "보유 자산이 없습니다." 메시지 표시

### 1-2. 실시간 시세 폴링 추가 (`frontend/components/ChartSidebar.tsx`)
- `fetchLivePrices()` 함수 추가 - 30초마다 백엔드 시세 API 폴링
  - `/api/proxy/api/v1/market/prices/stocks` (주식)
  - `/api/proxy/api/v1/market/prices/crypto` (코인)
- `livePriceMap`, `liveChangeMap` state → 인기 종목 패널에 실시간 가격 반영
- live 데이터 우선, 없으면 mock fallback

### 1-3. KR 종목코드 → 종목명 표시 (`frontend/components/AdvancedChart.tsx`)
- **문제**: 한국 주식 선택 시 차트 헤더에 `005930`(코드)으로 표시
- **해결**: 정규식 `/^\d{6}$/` 으로 6자리 KR 코드 감지 → `selectedAsset.name` 표시
  - 국내: `005930` → `삼성전자`
  - 해외: 그대로 `TSLA`, `BTC` 표시

### 1-4. 검색창 텍스트 수정
- `frontend/components/PortfolioHeader.tsx`
  - placeholder: `"주식, 코인, 지수, 펀드, 아파트 검색"` → `"주식, 코인 검색"`
  - 검색 드롭다운 레이블: `"월요일 9:00 기준 도미노 인기 주식"` → `"인기 주식"` (날짜/도미노 텍스트 제거)
- `frontend/components/DashboardNav.tsx`
  - 동일하게 placeholder 수정

### 1-5. 종목 목록 확장 (`frontend/lib/mock-data.ts`)
- **이전**: 주식 14개, 코인 5개
- **이후**: 주식 33개, 코인 9개
  - 추가된 국내 주식 (8개): SK하이닉스, NAVER, 현대차, 기아, LG에너지솔루션, 셀트리온, KB금융, 신한지주
  - 추가된 해외 주식 (8개): 브로드컴, TSMC, JP모건, 비자, 월마트, 디즈니, 우버, 알리바바
  - 추가된 코인 (4개): ADA(에이다), AVAX(아발란체), DOT(폴카닷), LINK(체인링크)

### 1-6. backend/.env 주석 추가
- 각 섹션별 한국어 설명 추가 (MongoDB, MariaDB, Redis, KIS API, Upbit, OAuth, OCR, Bedrock, MinIO, JWT, ES)
- 로컬 개발 시 ES SSH 터널 명령어 안내 포함

---

## 2. 🐛 버그 수정

### ChartSidebar 자산 탭 mock 고정값 문제
- **문제**: `initialMyAssetSymbols` 하드코딩 배열에서 가격을 읽음
- **해결**: `useAsset()` 훅의 실시간 `holdings` 데이터로 대체

### KR 종목 차트 헤더 코드 표시 문제
- **문제**: `selectedAsset.symbol` 그대로 표시 시 KR 종목은 코드(6자리 숫자)로 표시됨
- **해결**: 6자리 숫자 여부 판별 후 `.name` 또는 `.symbol` 조건부 표시

---

## 3. 📝 커밋 내역

```
feat: expand asset lists and add search on direct-input page
  - POPULAR_STOCKS 10 → 34개, POPULAR_CRYPTO 5 → 9개
  - direct-input 검색 기능 구현 (로컬 필터, mock-data 동기화)
  (이전 커밋들 포함 - ChartSidebar, AdvancedChart, PortfolioHeader, DashboardNav, mock-data)
merge: kyk/0219-chart → develop
```

---

## 4. 현재 프론트엔드 상태

| 페이지/컴포넌트 | 변경 사항 |
|----------------|-----------|
| `/portfolio/chart` 우측 패널 자산 탭 | 실제 포트폴리오 데이터 표시 ✅ |
| `/portfolio/chart` 우측 패널 시세 | 30초 폴링 실시간 가격 ✅ |
| 차트 헤더 종목명 | KR 코드 → 이름 변환 ✅ |
| 검색창 placeholder | "주식, 코인 검색"으로 통일 ✅ |
| mock-data.ts 종목 | 주식 33개, 코인 9개 ✅ |
| direct-input 인기 종목 | mock-data와 동기화 (34개 주식, 9개 코인) ✅ |

---

**✅ 결론**: `/portfolio/chart` 페이지의 실시간성과 사용성이 개선됨. 하드코딩된 mock 데이터에서 실제 API 연동으로 전환 완료.
