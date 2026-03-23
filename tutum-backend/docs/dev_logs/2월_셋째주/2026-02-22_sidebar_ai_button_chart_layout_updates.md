# 2026-02-22_sidebar_ai_button_chart_layout_updates

## 1. 작업 요약
- AI 버튼과 자산 추가 버튼의 사이드바 스타일을 조정함.
- `/portfolio/chart` 페이지 주변 레이아웃 제약을 완화해 flex 배치 폭을 넓힘.

## 2. 변경 내용
- `frontend/components/QuickBar.tsx`
  - AI 버튼을 보라/마젠타 계열 로고 톤으로 통일 (`indigo-600`, `purple-600`, `fuchsia-600` 그라데이션).
  - `자산추가` 버튼 테두리에 보라/마젠타 얇은 스트로크 적용.

- `frontend/app/portfolio/layout.tsx`
  - `/portfolio/chart` 경로에서 컨텐츠 래퍼의 `max-w`/좌우 패딩 제약 완화 (`px-0`)로 여백 확대.

- `frontend/app/portfolio/chart/page.tsx`
  - 차트 페이지 컨테이너를 기존보다 폭 중심으로 정리하여 flex 확장성 유지되도록 정렬.

## 3. 참고
- 관련 커밋: `d1635b9`
