# AI 챗봇 UI 구현 계획

**작성일**: 2026-02-05  
**브랜치**: `kyk/0205-ai-chatbot` (신규 생성 예정)  
**관련 페이지**: `/portfolio/asset`

---

## 1. 목표
`/portfolio/asset` 페이지에 **AI 자산 어드바이저 챗봇 섹션** 추가  
참고: Perplexity Finance 스타일 (하단 고정 채팅 UI)

---

## 2. 디자인 컨셉

```
┌─────────────────────────────────┐
│  🤖 AI 자산 어드바이저          │ [최소화]
├─────────────────────────────────┤
│  [사용자] 내 포트폴리오 분석해줘 │
│                                 │
│  [AI] 현재 포트폴리오를 분석    │
│  하고 있습니다...               │
│  ✓ 기술주 비중: 45%            │
│  ✓ 금융주 비중: 25%            │
│  💡 분산 투자가 잘 되어 있습니다│
├─────────────────────────────────┤
│ [📊 포트폴리오 분석] [💡 추천]  │ <- 퀵 액션
├─────────────────────────────────┤
│ [메시지 입력...]        [전송] │
└─────────────────────────────────┘
```

**스타일**: 글래스모피즘, 다크모드 지원, `framer-motion` 애니메이션

---

## 3. 파일 변경 목록

### [NEW] `frontend/components/AIChatbot.tsx`
- 채팅 메시지 리스트 (사용자/AI 구분)
- 하단 입력창 (textarea + 전송 버튼)
- 퀵 액션 버튼 (추천 질문)
- 접이식 UI (최소화/최대화)
- Mock 응답 (MVP)

### [MODIFY] `frontend/app/portfolio/asset/page.tsx`
- `AIChatbot` 컴포넌트 import
- Fixed FAB 방식으로 화면 우하단에 배치

---

## 4. 컴포넌트 상세

### 상태 관리
```typescript
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const [messages, setMessages] = useState<ChatMessage[]>([]);
const [input, setInput] = useState("");
const [isTyping, setIsTyping] = useState(false);
const [isOpen, setIsOpen] = useState(false);
```

### 퀵 액션
```typescript
const QUICK_ACTIONS = [
  { label: "📊 포트폴리오 분석", prompt: "내 포트폴리오를 분석해줘" },
  { label: "💡 리밸런싱 추천", prompt: "리밸런싱이 필요한지 알려줘" },
  { label: "📈 최근 수익률", prompt: "최근 수익률을 요약해줘" },
  { label: "⚠️ 리스크 진단", prompt: "포트폴리오 리스크를 진단해줘" },
];
```

---

## 5. 구현 순서

1. **Phase 1: UI 컴포넌트** — `AIChatbot.tsx` 생성, Fixed FAB 트리거
2. **Phase 2: Mock 응답** — 퀵 액션 처리, 포트폴리오 데이터 기반 응답
3. **Phase 3: 백엔드 연동** (추후) — `/api/v1/chat` 엔드포인트, LLM 연동

---

## 6. 검증 계획
- [ ] 챗봇 FAB 버튼 표시 확인
- [ ] 클릭 시 채팅창 팝업 확인
- [ ] 메시지 입력 및 전송 확인
- [ ] 퀵 액션 버튼 동작 확인
- [ ] Mock 응답 표시 확인
- [ ] 다크모드 UI 확인

---

## 7. 결정 필요 사항

> [!IMPORTANT]
> **배치 방식**: Fixed FAB (권장) vs 대시보드 위젯 중 선택 필요

> [!NOTE]
> **MVP 범위**: UI + Mock 응답까지 (백엔드 연동은 Phase 3)
