# 2026-02-05 AI Chatbot UI Implementation (MVP)

## 1. 개요
- **목표**: 포트폴리오 자산 페이지(`/portfolio/asset`)에 AI 금융 어드바이저 챗봇 UI 구현
- **방식**: Perplexity Finance 스타일의 플로팅 버튼(FAB) + 슬라이드 패널
- **상태**: 구현 완료 (Frontend Only, Mock Data)

## 2. 주요 구현 내용

### 2.1 UI 컴포넌트
- **AIChatFAB**: 우하단 고정 플로팅 버튼, 드래그 이동 가능, 위치 저장 (localStorage)
- **ChatContainer**: 슬라이드 인 패널 UI (우측)
- **ChatMessages**: 사용자/AI 메시지 버블, 출처 표기 (Source Citation) UI
- **ChatInput**: 자동 높이 조절 Textarea, 퀵 액션 버튼

### 2.2 기능 로직
- **Drag & Drop**: `framer-motion`을 사용하여 자유로운 위치 이동 구현
- **클릭 충돌 방지**: 드래그 후 클릭 이벤트가 발생하여 채팅창이 열리는 문제 해결 (`useRef` 및 타이머 활용)
- **Mock Streaming**: 실제 AI 응답처럼 글자가 타이핑되는 효과 구현 (`useChat` hook)

### 2.3 디자인 (Tutum AI)
- **테마**: 시스템 다크모드/라이트모드 완벽 지원
- **스타일**: Emerald-Teal 그라데이션 브랜드 컬러 적용
- **레이아웃**: `portfolio/layout.tsx`에 통합하여 페이지 전환 시에도 유지

## 3. 기술적 이슈 및 해결

### Issue: 드래그 vs 클릭 이벤트 충돌
- **현상**: 버튼을 드래그해서 위치를 옮기고 마우스를 떼면 `onClick`이 트리거되어 원치 않게 채팅창이 열림.
- **해결**:
  ```typescript
  // useRef로 드래그 상태 즉시 추적
  const isDraggingRef = useRef(false);
  
  // onDragStart에서 true 설정
  // onDragEnd에서 150ms 지연 후 false 설정
  // onClick에서는 isDraggingRef.current가 false일 때만 실행
  ```

## 4. 향후 계획 (Backend Integration)
- [ ] AWS Bedrock (Claude 3.5 Sonnet) 연동
- [ ] RAG 파이프라인 구축 (Upbit 시세, 네이버 뉴스)
- [ ] SSE(Server-Sent Events) 스트리밍 API 구현
