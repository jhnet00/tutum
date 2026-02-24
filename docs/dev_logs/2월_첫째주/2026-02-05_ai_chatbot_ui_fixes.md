# AI 챗봇 UI 개선 및 차트 API 수정

**작성일**: 2026-02-05
**작성자**: Claude AI
**브랜치**: `develop`

---

## 개요

AI 챗봇 FAB 및 차트 API 연동 관련 UI 버그 수정 및 사용성 개선 작업.

## 수정 내역

### 1. FAB 버튼 닫을 때 사라지는 문제 해결

**파일**: `frontend/components/chat/AIChatFAB.tsx`

**문제**: 채팅 패널을 닫으면 FAB 버튼이 완전히 사라짐

**원인**: `AnimatePresence`가 FAB 버튼 전체를 감싸고 있어서 exit 애니메이션 후 DOM에서 제거됨

**해결**:
```tsx
// Before: AnimatePresence가 FAB을 감쌌음
// After: 조건부 렌더링 + initial={false}로 변경
{!isOpen && (
    <motion.div
        key="fab-button"
        initial={false}
        animate={{ scale: 1, opacity: 1, x: position.x, y: position.y }}
        ...
    >
```

### 2. 추천 질문 버튼 클릭 이벤트 추가

**파일**: `frontend/components/chat/ChatMessages.tsx`

**문제**: 초기 화면의 추천 질문 버튼이 클릭해도 반응 없음

**해결**:
```tsx
// onSuggestionClick prop 추가
interface ChatMessagesProps {
    messages: Message[];
    onSuggestionClick?: (text: string) => void;
}

// 버튼에 onClick 핸들러 연결
<button onClick={() => onSuggestionClick?.(suggestion)}>
```

### 3. 메시지 자동 스크롤 기능

**파일**: `frontend/components/chat/ChatMessages.tsx`

**문제**: AI 응답이 길어져도 스크롤이 자동으로 내려가지 않음

**해결**:
```tsx
const messagesEndRef = useRef<HTMLDivElement>(null);

useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
}, [messages]);

// 렌더 마지막에 ref 요소 추가
<div ref={messagesEndRef} />
```

### 4. FAB 드래그 위치 유지

**파일**: `frontend/components/chat/AIChatFAB.tsx`

**문제**: FAB을 드래그로 이동시키고 채팅창 닫으면 원위치로 돌아감

**해결**: animate prop에 저장된 position 값 반영
```tsx
animate={{ scale: 1, opacity: 1, x: position.x, y: position.y }}
```

### 5. 차트 API 심볼 포맷 수정

**파일**: `frontend/components/AdvancedChart.tsx`

**문제**: 코인 차트가 안 뜸 (API 호출 실패)

**원인**: Upbit API는 `KRW-BTC` 형식 필요, 프론트에서 `BTC`만 전송

**해결**:
```tsx
const isCrypto = selectedAsset.type === "코인";
const symbol = isCrypto ? `KRW-${selectedAsset.symbol}` : selectedAsset.symbol;
```

### 6. 채팅 패널 헤더 겹침 수정

**파일**: `frontend/components/chat/AIChatFAB.tsx`

**문제**: 채팅 패널이 상단 네비게이션 바를 가림

**해결**: 패널 위치 조정
```tsx
// Before: top-0 h-full
// After: top-16 h-[calc(100%-64px)]
className="fixed top-16 right-0 h-[calc(100%-64px)] ..."
```

## 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `frontend/components/chat/AIChatFAB.tsx` | FAB 렌더링 로직, 위치 유지, 패널 위치 |
| `frontend/components/chat/ChatMessages.tsx` | 버튼 클릭, 자동 스크롤 |
| `frontend/components/AdvancedChart.tsx` | API 심볼 포맷, 환율 변환 |

## 테스트 확인 사항

- [ ] FAB 클릭 시 채팅창 열림
- [ ] 채팅창 닫아도 FAB 유지
- [ ] 추천 질문 버튼 클릭 동작
- [ ] AI 응답 시 스크롤 자동 이동
- [ ] FAB 드래그 위치 저장/복원
- [ ] 코인 차트 표시 (BTC/ETH 등)
- [ ] 채팅 패널이 헤더 안 가림
