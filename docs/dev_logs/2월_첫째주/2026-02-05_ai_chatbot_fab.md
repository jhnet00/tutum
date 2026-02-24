# AI 챗봇 FAB 구현

**작성일**: 2026-02-05
**작성자**: Claude AI
**브랜치**: `kyk/0205-ai-chatbot`

---

## 개요

포트폴리오 페이지에 AI 금융 어시스턴트 챗봇을 FAB(Floating Action Button) 형태로 구현했습니다.

## 구현 내용

### Backend

| 파일 | 설명 |
|------|------|
| `backend/app/models/chat.py` | Pydantic 모델 (ChatRequest, Source, SourceType) |
| `backend/app/services/chat_service.py` | Mock LLM + 실시간 Upbit 시세 연동 |
| `backend/app/routers/chat.py` | SSE 스트리밍 API 엔드포인트 |

### Frontend

| 파일 | 설명 |
|------|------|
| `frontend/components/chat/AIChatFAB.tsx` | 드래그 가능한 FAB 컴포넌트 |
| `frontend/components/chat/ChatContainer.tsx` | 채팅 컨테이너 |
| `frontend/components/chat/ChatMessages.tsx` | 메시지 렌더링 |
| `frontend/components/chat/ChatInput.tsx` | 입력 컴포넌트 |
| `frontend/hooks/useChat.ts` | SSE 스트리밍 훅 |
| `frontend/types/chat.ts` | TypeScript 타입 정의 |
| `frontend/app/portfolio/layout.tsx` | FAB 레이아웃 연동 |

## 주요 기능

1. **FAB 버튼**: 우측 하단 플로팅 버튼, 드래그로 위치 이동 가능
2. **슬라이드 패널**: 우측에서 슬라이드로 열리는 채팅 UI
3. **SSE 스트리밍**: 실시간 타이핑 효과
4. **실시간 시세**: Upbit API 연동 (BTC, ETH, XRP, SOL)

## 데이터 구조

```
사용자 질문
    ↓
키워드 추출 (비트코인 → KRW-BTC)
    ↓
Upbit API 실시간 시세 조회
    ↓
Mock 템플릿에 가격 삽입
    ↓
SSE 스트리밍 응답
```

## 현재 상태

| 항목 | 상태 |
|------|------|
| 암호화폐 시세 | ✅ 실시간 (Upbit API) |
| AI 응답 텍스트 | ❌ Mock 템플릿 |
| AWS Bedrock | ⏳ 미연결 |

## 다음 단계

1. AWS Bedrock 연동으로 실제 AI 응답 구현
2. RAG 시스템 구축 (뉴스, 포트폴리오 데이터 연동)
3. 대화 히스토리 저장 (MongoDB)

## API 엔드포인트

```
POST /api/v1/chat
Content-Type: application/json

Request:
{
    "message": "비트코인 가격",
    "conversation_id": "optional-uuid"
}

Response: SSE Stream
event: start
event: sources
event: delta (반복)
event: done
```

## 테스트 방법

1. `http://localhost:3000/portfolio/asset` 접속
2. 우측 하단 "Tutum AI" FAB 클릭
3. "비트코인 가격" 입력 후 전송
4. 실시간 시세 포함 응답 확인
