# Work Plan: AI Finance Chatbot with RAG (AWS Bedrock)

**Date**: 2026-02-05
**Task**: Perplexity Finance 스타일 AI 금융 챗봇 구현
**Branch**: `kyk/0205-ai-chatbot`
**Reference**: https://www.perplexity.ai/finance

## 1. Goal Description

Perplexity Finance를 참고하여 AI 금융 챗봇을 구현한다.
- 자연어로 금융 관련 질문 → AI가 실시간 데이터 기반 답변
- RAG(Retrieval-Augmented Generation) 패턴으로 정확도 향상
- 스트리밍 응답으로 실시간 타이핑 효과

### 핵심 기능
1. **AI 채팅**: 금융 질문에 대한 지능형 응답
2. **실시간 데이터 연동**: 현재 시세, 뉴스를 컨텍스트로 활용
3. **출처 인용**: 답변에 사용된 데이터 소스 표시
4. **스트리밍 응답**: SSE 기반 실시간 텍스트 출력

## 2. Architecture & Design

### 2.1 Overall Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  ChatPage (/portfolio/ai-chat)                      │    │
│  │  ├─ ChatSidebar (대화 히스토리)                      │    │
│  │  ├─ ChatMessages (메시지 리스트)                     │    │
│  │  │   ├─ UserMessage                                 │    │
│  │  │   └─ AssistantMessage (스트리밍 + 소스 인용)      │    │
│  │  └─ ChatInput (입력창)                              │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ SSE (Server-Sent Events)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Backend                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  POST /api/v1/chat                                  │    │
│  │  ├─ 1. Intent Detection (질문 의도 파악)             │    │
│  │  ├─ 2. Data Retrieval (RAG)                         │    │
│  │  │   ├─ 시세 데이터 (Upbit/KIS API)                 │    │
│  │  │   ├─ 뉴스 데이터 (News API)                      │    │
│  │  │   └─ 사용자 포트폴리오 (MongoDB)                  │    │
│  │  ├─ 3. Prompt Construction                          │    │
│  │  └─ 4. Bedrock Claude Invoke (Streaming)            │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     AWS Bedrock                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Claude Sonnet 4.5 (claude-sonnet-4-5-20250514)     │    │
│  │  - 1M token context window                          │    │
│  │  - Streaming response                               │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 RAG Pipeline

```
사용자 질문: "비트코인 최근 왜 올랐어?"
        │
        ▼
┌─────────────────────────────────────┐
│  1. Intent Detection                │
│  - 질문 유형: CRYPTO_ANALYSIS       │
│  - 대상 자산: BTC                   │
│  - 필요 데이터: 시세, 뉴스          │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  2. Data Retrieval (병렬 실행)       │
│  ├─ Upbit API → 현재가, 24h 변동률  │
│  ├─ News API → 최근 BTC 뉴스 5건    │
│  └─ MongoDB → 사용자 BTC 보유량     │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  3. Context Construction            │
│  """                                │
│  [현재 시세]                        │
│  BTC: ₩95,000,000 (+2.3%)          │
│                                     │
│  [관련 뉴스]                        │
│  1. "미국 ETF 승인 기대감 상승"     │
│  2. "기관 투자자 매수세 증가"       │
│                                     │
│  [사용자 포트폴리오]                │
│  BTC 0.5개 보유 (₩47,500,000)      │
│  """                                │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  4. Bedrock Claude Invoke           │
│  - System Prompt + Context + Query  │
│  - Streaming Response (SSE)         │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  5. Response with Sources           │
│  "비트코인이 최근 상승한 이유는...  │
│                                     │
│  📰 출처:                           │
│  - 업비트 실시간 시세               │
│  - 한국경제 (2026-02-05)            │
│  "                                  │
└─────────────────────────────────────┘
```

### 2.3 Backend File Structure

```
backend/app/
├── services/
│   ├── chat_service.py         # NEW - ChatService 클래스
│   ├── bedrock_client.py       # NEW - AWS Bedrock 클라이언트
│   ├── news_service.py         # NEW - 뉴스 API 연동
│   └── rag_retriever.py        # NEW - RAG 데이터 수집기
├── routers/
│   └── chat.py                 # NEW - 채팅 API 엔드포인트
├── models/
│   └── chat.py                 # NEW - Pydantic 스키마
└── prompts/
    └── finance_assistant.py    # NEW - 시스템 프롬프트
```

### 2.4 Frontend File Structure

```
frontend/
├── app/
│   └── portfolio/
│       └── ai-chat/
│           └── page.tsx        # NEW - 채팅 페이지
├── components/
│   └── chat/
│       ├── ChatContainer.tsx   # NEW - 채팅 전체 레이아웃
│       ├── ChatSidebar.tsx     # NEW - 대화 히스토리
│       ├── ChatMessages.tsx    # NEW - 메시지 리스트
│       ├── UserMessage.tsx     # NEW - 사용자 메시지 버블
│       ├── AssistantMessage.tsx # NEW - AI 응답 (스트리밍)
│       ├── ChatInput.tsx       # NEW - 입력창
│       └── SourceCitation.tsx  # NEW - 출처 표시
└── hooks/
    └── useChat.ts              # NEW - 채팅 상태 관리
```

### 2.5 Data Models

#### Backend Pydantic Models (`backend/app/models/chat.py`)

```python
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from enum import Enum

class MessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"

class Source(BaseModel):
    type: str           # "price", "news", "portfolio"
    title: str
    url: Optional[str] = None
    timestamp: datetime

class ChatMessage(BaseModel):
    id: str
    role: MessageRole
    content: str
    sources: List[Source] = []
    created_at: datetime

class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None

class ChatResponse(BaseModel):
    conversation_id: str
    message: ChatMessage
```

#### Frontend Types (`frontend/types/chat.ts`)

```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  createdAt: Date;
  isStreaming?: boolean;
}

interface Source {
  type: 'price' | 'news' | 'portfolio';
  title: string;
  url?: string;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
}
```

### 2.6 API Design

#### POST /api/v1/chat (SSE Streaming)

**Request**:
```json
{
  "message": "비트코인 현재 가격이랑 최근 동향 알려줘",
  "conversation_id": "optional-uuid"
}
```

**Response** (SSE Stream):
```
event: start
data: {"conversation_id": "uuid", "message_id": "uuid"}

event: sources
data: {"sources": [{"type": "price", "title": "BTC 실시간 시세"}, ...]}

event: delta
data: {"content": "현재 "}

event: delta
data: {"content": "비트코인 "}

event: delta
data: {"content": "가격은..."}

event: done
data: {"usage": {"input_tokens": 500, "output_tokens": 200}}
```

#### GET /api/v1/chat/conversations

대화 히스토리 목록 조회 (추후 구현)

#### GET /api/v1/chat/conversations/{id}

특정 대화 내역 조회 (추후 구현)

## 3. Technology Choices

### 3.1 AWS Bedrock 설정

**필요 권한 (IAM Policy)**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "arn:aws:bedrock:*::foundation-model/anthropic.claude-*"
    }
  ]
}
```

**환경 변수** (`.env`):
```
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-sonnet-4-5-20250514
```

**Python 패키지**:
```
boto3>=1.35.0
```

### 3.2 뉴스 API 옵션

| API | 장점 | 단점 | 비용 |
|-----|------|------|------|
| 네이버 검색 API | 한국 뉴스 풍부 | 일 25,000건 제한 | 무료 |
| NewsAPI.org | 글로벌 뉴스 | 한국 뉴스 부족 | Free tier 있음 |
| 자체 크롤링 | 제한 없음 | 개발 비용 | 서버 비용만 |

**MVP 결정**: 네이버 검색 API (한국 금융 뉴스에 최적)

### 3.3 SSE vs WebSocket

| 방식 | 장점 | 단점 |
|------|------|------|
| **SSE** | 단방향 스트리밍에 최적, 구현 간단 | 양방향 통신 불가 |
| WebSocket | 양방향 통신 | 복잡, 연결 관리 필요 |

**결정**: SSE (채팅은 요청-응답 패턴이므로 SSE로 충분)

## 4. Implementation Steps

### Phase 1: Backend Foundation (Day 1)

#### Step 1.1: Bedrock Client 구현

**File**: `backend/app/services/bedrock_client.py`

```python
import boto3
import json
from typing import AsyncGenerator

class BedrockClient:
    def __init__(self):
        self.client = boto3.client(
            'bedrock-runtime',
            region_name=settings.AWS_REGION
        )
        self.model_id = settings.BEDROCK_MODEL_ID

    async def invoke_stream(
        self,
        messages: list,
        system_prompt: str
    ) -> AsyncGenerator[str, None]:
        """스트리밍 응답 생성"""
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": messages
        }

        response = self.client.invoke_model_with_response_stream(
            modelId=self.model_id,
            body=json.dumps(body)
        )

        for event in response['body']:
            chunk = json.loads(event['chunk']['bytes'])
            if chunk['type'] == 'content_block_delta':
                yield chunk['delta']['text']
```

#### Step 1.2: RAG Retriever 구현

**File**: `backend/app/services/rag_retriever.py`

```python
import asyncio
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class RetrievedData:
    prices: dict          # 시세 데이터
    news: List[dict]      # 뉴스 목록
    portfolio: Optional[dict]  # 사용자 포트폴리오
    sources: List[dict]   # 출처 정보

class RAGRetriever:
    def __init__(self, crypto_client, news_service):
        self.crypto_client = crypto_client
        self.news_service = news_service

    async def retrieve(
        self,
        query: str,
        user_id: Optional[str] = None
    ) -> RetrievedData:
        """질문에 필요한 데이터 병렬 수집"""

        # 질문에서 관련 자산 추출 (간단한 키워드 매칭)
        tickers = self._extract_tickers(query)

        # 병렬 데이터 수집
        prices_task = self._fetch_prices(tickers)
        news_task = self._fetch_news(query)
        portfolio_task = self._fetch_portfolio(user_id)

        prices, news, portfolio = await asyncio.gather(
            prices_task, news_task, portfolio_task
        )

        sources = self._build_sources(prices, news, portfolio)

        return RetrievedData(
            prices=prices,
            news=news,
            portfolio=portfolio,
            sources=sources
        )

    def _extract_tickers(self, query: str) -> List[str]:
        """질문에서 티커 추출"""
        keywords = {
            "비트코인": "KRW-BTC", "btc": "KRW-BTC",
            "이더리움": "KRW-ETH", "eth": "KRW-ETH",
            "리플": "KRW-XRP", "xrp": "KRW-XRP",
            "솔라나": "KRW-SOL", "sol": "KRW-SOL",
        }
        found = []
        query_lower = query.lower()
        for keyword, ticker in keywords.items():
            if keyword in query_lower:
                found.append(ticker)
        return found if found else ["KRW-BTC"]  # 기본값
```

#### Step 1.3: Chat Service 구현

**File**: `backend/app/services/chat_service.py`

```python
from fastapi.responses import StreamingResponse
import uuid

class ChatService:
    def __init__(self, bedrock: BedrockClient, retriever: RAGRetriever):
        self.bedrock = bedrock
        self.retriever = retriever

    async def chat_stream(
        self,
        message: str,
        conversation_id: Optional[str] = None,
        user_id: Optional[str] = None
    ):
        """SSE 스트리밍 응답 생성"""

        # 1. RAG: 관련 데이터 수집
        data = await self.retriever.retrieve(message, user_id)

        # 2. 컨텍스트 구성
        context = self._build_context(data)

        # 3. 프롬프트 구성
        system_prompt = FINANCE_ASSISTANT_PROMPT
        messages = [
            {"role": "user", "content": f"{context}\n\n질문: {message}"}
        ]

        # 4. SSE 이벤트 생성
        conv_id = conversation_id or str(uuid.uuid4())
        msg_id = str(uuid.uuid4())

        # Start event
        yield f"event: start\ndata: {json.dumps({'conversation_id': conv_id, 'message_id': msg_id})}\n\n"

        # Sources event
        yield f"event: sources\ndata: {json.dumps({'sources': data.sources})}\n\n"

        # Delta events (streaming)
        async for chunk in self.bedrock.invoke_stream(messages, system_prompt):
            yield f"event: delta\ndata: {json.dumps({'content': chunk})}\n\n"

        # Done event
        yield f"event: done\ndata: {json.dumps({'status': 'complete'})}\n\n"
```

#### Step 1.4: Chat Router 구현

**File**: `backend/app/routers/chat.py`

```python
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from ..models.chat import ChatRequest

router = APIRouter()

@router.post("/")
async def chat(request: Request, body: ChatRequest):
    """채팅 API (SSE 스트리밍)"""
    chat_service: ChatService = request.app.state.chat_service

    return StreamingResponse(
        chat_service.chat_stream(
            message=body.message,
            conversation_id=body.conversation_id,
            user_id=None  # TODO: JWT에서 추출
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )
```

### Phase 2: Frontend UI (Day 2)

#### Step 2.1: 채팅 페이지 라우트

**File**: `frontend/app/portfolio/ai-chat/page.tsx`

```tsx
import { ChatContainer } from '@/components/chat/ChatContainer';

export default function AIChatPage() {
  return (
    <div className="h-[calc(100vh-64px)]">
      <ChatContainer />
    </div>
  );
}
```

#### Step 2.2: useChat Hook

**File**: `frontend/hooks/useChat.ts`

```tsx
import { useState, useCallback } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  isStreaming?: boolean;
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(async (content: string) => {
    // 1. 사용자 메시지 추가
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
    };
    setMessages(prev => [...prev, userMessage]);

    // 2. AI 응답 플레이스홀더 추가
    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      isStreaming: true,
    };
    setMessages(prev => [...prev, assistantMessage]);
    setIsLoading(true);

    // 3. SSE 스트리밍 연결
    const response = await fetch('/api/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: content }),
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));

          if (data.content) {
            // 스트리밍 텍스트 업데이트
            setMessages(prev => prev.map(msg =>
              msg.id === assistantMessage.id
                ? { ...msg, content: msg.content + data.content }
                : msg
            ));
          }

          if (data.sources) {
            // 소스 정보 추가
            setMessages(prev => prev.map(msg =>
              msg.id === assistantMessage.id
                ? { ...msg, sources: data.sources }
                : msg
            ));
          }
        }
      }
    }

    // 4. 스트리밍 완료
    setMessages(prev => prev.map(msg =>
      msg.id === assistantMessage.id
        ? { ...msg, isStreaming: false }
        : msg
    ));
    setIsLoading(false);
  }, []);

  return { messages, sendMessage, isLoading };
}
```

#### Step 2.3: ChatContainer 컴포넌트

**File**: `frontend/components/chat/ChatContainer.tsx`

```tsx
'use client';

import { useChat } from '@/hooks/useChat';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';

export function ChatContainer() {
  const { messages, sendMessage, isLoading } = useChat();

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-950">
      {/* 헤더 */}
      <div className="border-b border-gray-200 dark:border-zinc-800 px-4 py-3">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
          tutum AI
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          금융 관련 질문을 해보세요
        </p>
      </div>

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto">
        <ChatMessages messages={messages} />
      </div>

      {/* 입력 영역 */}
      <div className="border-t border-gray-200 dark:border-zinc-800 p-4">
        <ChatInput onSend={sendMessage} isLoading={isLoading} />
      </div>
    </div>
  );
}
```

#### Step 2.4: AssistantMessage (스트리밍 + 소스)

**File**: `frontend/components/chat/AssistantMessage.tsx`

```tsx
import { Source } from '@/types/chat';

interface Props {
  content: string;
  sources?: Source[];
  isStreaming?: boolean;
}

export function AssistantMessage({ content, sources, isStreaming }: Props) {
  return (
    <div className="flex gap-3 px-4 py-3">
      {/* AI 아바타 */}
      <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-bold">
        AI
      </div>

      <div className="flex-1">
        {/* 메시지 내용 */}
        <div className="prose dark:prose-invert max-w-none">
          {content}
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-1" />
          )}
        </div>

        {/* 출처 표시 */}
        {sources && sources.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-zinc-700">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              📰 출처
            </p>
            <div className="flex flex-wrap gap-2">
              {sources.map((source, idx) => (
                <span
                  key={idx}
                  className="text-xs px-2 py-1 bg-gray-100 dark:bg-zinc-800 rounded-full text-gray-600 dark:text-gray-300"
                >
                  {source.title}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

### Phase 3: News API Integration (Day 3)

#### Step 3.1: 네이버 검색 API 연동

**File**: `backend/app/services/news_service.py`

```python
import httpx
from typing import List

class NewsService:
    def __init__(self):
        self.client_id = settings.NAVER_CLIENT_ID
        self.client_secret = settings.NAVER_CLIENT_SECRET
        self.base_url = "https://openapi.naver.com/v1/search/news.json"

    async def search(self, query: str, limit: int = 5) -> List[dict]:
        """네이버 뉴스 검색"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                self.base_url,
                params={"query": query, "display": limit, "sort": "date"},
                headers={
                    "X-Naver-Client-Id": self.client_id,
                    "X-Naver-Client-Secret": self.client_secret,
                }
            )
            data = response.json()

            return [
                {
                    "title": self._clean_html(item["title"]),
                    "description": self._clean_html(item["description"]),
                    "link": item["originallink"],
                    "pubDate": item["pubDate"],
                }
                for item in data.get("items", [])
            ]

    def _clean_html(self, text: str) -> str:
        """HTML 태그 제거"""
        import re
        return re.sub(r'<[^>]+>', '', text)
```

### Phase 4: Navigation & Polish (Day 4)

#### Step 4.1: PortfolioHeader에 AI 채팅 링크 추가

**File**: `frontend/components/PortfolioHeader.tsx` (수정)

```tsx
// 기존 네비게이션에 추가
<Link
  href="/portfolio/ai-chat"
  className={cn(
    "flex items-center gap-2 px-3 py-2 rounded-md",
    pathname === "/portfolio/ai-chat"
      ? "bg-primary text-primary-foreground"
      : "hover:bg-muted"
  )}
>
  <MessageSquare className="h-4 w-4" />
  <span>AI 채팅</span>
</Link>
```

## 5. Environment Variables

```env
# AWS Bedrock
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-sonnet-4-5-20250514

# Naver API (뉴스 검색)
NAVER_CLIENT_ID=your-client-id
NAVER_CLIENT_SECRET=your-client-secret
```

## 6. Dependencies

### Backend (`requirements.txt` 추가)

```
boto3>=1.35.0
```

### Frontend (이미 설치됨)

```
- React 18
- TailwindCSS
- shadcn/ui
```

## 7. Browsing Test Scenarios

### Scenario A: Backend SSE Test

1. `POST http://localhost:8000/api/v1/chat` with body `{"message": "비트코인 가격 알려줘"}`
2. **Pass Criteria**: SSE 이벤트가 순차적으로 수신됨 (start → sources → delta... → done)

### Scenario B: Frontend Streaming

1. Navigate to `http://localhost:3000/portfolio/ai-chat`
2. "비트코인 현재 가격이랑 최근 동향 알려줘" 입력
3. **Pass Criteria**:
   - 타이핑 효과로 응답이 실시간 표시됨
   - 응답 완료 후 출처 표시됨
   - 다크모드에서도 정상 표시

### Scenario C: RAG Data Accuracy

1. "이더리움 현재 가격" 질문
2. **Pass Criteria**: 응답에 실제 현재 가격이 포함됨 (Upbit API 데이터)

### Scenario D: Error Handling

1. AWS 자격증명 없이 채팅 시도
2. **Pass Criteria**: 사용자 친화적 에러 메시지 표시, UI 깨지지 않음

## 8. Future Enhancements

### Phase 2 (추후)
- [ ] 대화 히스토리 MongoDB 저장
- [ ] 사용자별 대화 목록 조회
- [ ] 대화 컨텍스트 유지 (이전 메시지 참조)

### Phase 3 (추후)
- [ ] 워치리스트 연동 ("내 관심 종목 분석해줘")
- [ ] 포트폴리오 분석 ("내 자산 분석해줘")
- [ ] 차트 생성 (AI가 차트 데이터 반환 → 프론트에서 렌더링)

### Phase 4 (추후)
- [ ] 음성 입력 (Web Speech API)
- [ ] 다국어 지원
- [ ] 프롬프트 커스터마이징

## 9. Cost Estimation

### AWS Bedrock (Claude Sonnet)

| 사용량 | Input 토큰 | Output 토큰 | 비용 |
|--------|-----------|-------------|------|
| 1회 대화 | ~500 | ~1,000 | ~$0.017 |
| 일 100회 | 50,000 | 100,000 | ~$1.65 |
| 월 3,000회 | 1,500,000 | 3,000,000 | ~$49.50 |

### Naver API

- 무료 (일 25,000건 제한)

---

## 10. Refinements by Claude

### 10.1 MVP 단계: Mock LLM Client (AWS 연결 전)

AWS Bedrock 연결 전에 UI/UX 개발 및 테스트를 위한 Mock 구현이 필요합니다.

**File**: `backend/app/services/llm_client.py`

```python
import asyncio
import json
from typing import AsyncGenerator, Protocol
from abc import abstractmethod

class LLMClient(Protocol):
    """LLM 클라이언트 인터페이스"""
    @abstractmethod
    async def invoke_stream(
        self,
        messages: list,
        system_prompt: str,
        context: str
    ) -> AsyncGenerator[str, None]:
        ...

class MockLLMClient:
    """개발용 Mock LLM 클라이언트 (AWS 연결 전)"""

    MOCK_RESPONSES = {
        "비트코인": "현재 비트코인(BTC) 가격은 **₩{price:,}**입니다.\n\n24시간 변동률: {change}%\n\n최근 동향을 살펴보면, 기관 투자자들의 매수세가 지속되고 있으며 ETF 승인 기대감이 가격 상승을 견인하고 있습니다.",
        "이더리움": "현재 이더리움(ETH) 가격은 **₩{price:,}**입니다.\n\n24시간 변동률: {change}%\n\n이더리움은 최근 레이어2 솔루션 확장과 스테이킹 수요 증가로 긍정적인 흐름을 보이고 있습니다.",
        "default": "죄송합니다. 해당 질문에 대한 정보를 찾을 수 없습니다.\n\n다음과 같은 질문을 시도해보세요:\n- 비트코인 현재 가격\n- 이더리움 동향 분석\n- 내 포트폴리오 분석"
    }

    async def invoke_stream(
        self,
        messages: list,
        system_prompt: str,
        context: str
    ) -> AsyncGenerator[str, None]:
        """Mock 스트리밍 응답 (타이핑 효과 시뮬레이션)"""

        # 질문에서 키워드 추출
        query = messages[-1]["content"] if messages else ""

        # 컨텍스트에서 가격 정보 파싱
        price = self._extract_price(context)
        change = self._extract_change(context)

        # 적절한 응답 선택
        response = self.MOCK_RESPONSES["default"]
        for keyword, template in self.MOCK_RESPONSES.items():
            if keyword in query.lower():
                response = template.format(price=price, change=change)
                break

        # 글자 단위 스트리밍 (타이핑 효과)
        for char in response:
            yield char
            await asyncio.sleep(0.02)  # 20ms 딜레이

    def _extract_price(self, context: str) -> int:
        """컨텍스트에서 가격 추출"""
        import re
        match = re.search(r'현재가[:\s]*([0-9,]+)', context)
        if match:
            return int(match.group(1).replace(',', ''))
        return 95000000  # 기본값

    def _extract_change(self, context: str) -> str:
        """컨텍스트에서 변동률 추출"""
        import re
        match = re.search(r'변동률[:\s]*([+-]?[0-9.]+)', context)
        if match:
            return match.group(1)
        return "+2.3"  # 기본값


class BedrockLLMClient:
    """AWS Bedrock LLM 클라이언트 (추후 연결)"""

    def __init__(self):
        import boto3
        from ..config import get_settings
        settings = get_settings()

        self.client = boto3.client(
            'bedrock-runtime',
            region_name=settings.AWS_REGION
        )
        self.model_id = settings.BEDROCK_MODEL_ID

    async def invoke_stream(
        self,
        messages: list,
        system_prompt: str,
        context: str
    ) -> AsyncGenerator[str, None]:
        """Bedrock 스트리밍 응답"""
        # 실제 Bedrock 호출 로직
        ...


def get_llm_client() -> LLMClient:
    """환경에 따라 적절한 LLM 클라이언트 반환"""
    from ..config import get_settings
    settings = get_settings()

    if settings.USE_MOCK_LLM:
        return MockLLMClient()
    else:
        return BedrockLLMClient()
```

**환경변수 추가** (`.env`):
```env
# Mock 모드 (AWS 연결 전 개발용)
USE_MOCK_LLM=true
```

---

### 10.2 기존 코드베이스와의 통합 포인트

#### 1. API URL 패턴 통일

현재 프로젝트의 API 호출 패턴:
```typescript
// frontend/lib/api.ts 또는 직접 fetch
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
```

채팅 API도 동일 패턴 사용 필요:
```typescript
// useChat.ts에서
const response = await fetch(`${API_URL}/api/v1/chat`, { ... });
```

#### 2. CORS 설정 확인

`backend/app/main.py`에 CORS가 이미 설정되어 있음:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    ...
)
```
→ 추가 작업 불필요

#### 3. 라우터 등록 위치

`main.py`의 기존 패턴 따르기:
```python
# 기존
app.include_router(notifications.router, prefix=f"{settings.API_V1_PREFIX}/notifications", tags=["알림"])

# 추가
app.include_router(chat.router, prefix=f"{settings.API_V1_PREFIX}/chat", tags=["AI 채팅"])
```

#### 4. lifespan에 ChatService 등록

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    ...
    # 기존: MarketMonitor
    monitor = MarketMonitor()
    monitor_task = asyncio.create_task(monitor.start_monitoring())
    app.state.market_monitor = monitor

    # 추가: ChatService
    from .services.llm_client import get_llm_client
    from .services.rag_retriever import RAGRetriever
    from .services.chat_service import ChatService

    llm_client = get_llm_client()
    retriever = RAGRetriever(crypto_client, news_service=None)  # MVP: 뉴스 없이 시작
    app.state.chat_service = ChatService(llm_client, retriever)

    yield
    ...
```

---

### 10.3 프론트엔드 추가 고려사항

#### 1. 페이지 레이아웃 통합

현재 포트폴리오 페이지 구조:
```
/portfolio/asset     → PortfolioHeader + 자산 목록
/portfolio/market    → PortfolioHeader + 시장 정보
```

AI 채팅도 동일 레이아웃 사용:
```
/portfolio/ai-chat   → PortfolioHeader + 채팅 UI
```

**File**: `frontend/app/portfolio/ai-chat/page.tsx`
```tsx
import PortfolioHeader from '@/components/PortfolioHeader';
import { ChatContainer } from '@/components/chat/ChatContainer';

export default function AIChatPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-900">
      <PortfolioHeader />
      <main className="h-[calc(100vh-64px)]">
        <ChatContainer />
      </main>
    </div>
  );
}
```

#### 2. 다크모드 지원

기존 프로젝트 패턴 (`dark:` 클래스) 동일 적용:
```tsx
// 예시
className="bg-white dark:bg-zinc-950 text-gray-900 dark:text-white"
```

#### 3. 반응형 디자인

모바일에서 사이드바 숨김 처리:
```tsx
// ChatSidebar.tsx
<aside className="hidden md:flex w-64 border-r ...">
  {/* 대화 히스토리 */}
</aside>
```

#### 4. 빈 상태 UI

메시지가 없을 때 표시할 Welcome 화면:
```tsx
// ChatMessages.tsx
{messages.length === 0 && (
  <div className="flex flex-col items-center justify-center h-full text-center p-8">
    <div className="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center mb-4">
      <MessageSquare className="w-8 h-8 text-blue-500" />
    </div>
    <h2 className="text-xl font-semibold mb-2">tutum AI에게 물어보세요</h2>
    <p className="text-gray-500 dark:text-gray-400 mb-6">
      금융 관련 질문에 실시간 데이터를 기반으로 답변해드립니다
    </p>
    <div className="flex flex-wrap gap-2 justify-center">
      {["비트코인 현재 가격", "이더리움 동향 분석", "내 포트폴리오 요약"].map(q => (
        <button
          key={q}
          onClick={() => onSuggestionClick(q)}
          className="px-4 py-2 bg-gray-100 dark:bg-zinc-800 rounded-full text-sm hover:bg-gray-200 dark:hover:bg-zinc-700"
        >
          {q}
        </button>
      ))}
    </div>
  </div>
)}
```

---

### 10.4 에러 처리 강화

#### Backend

```python
# chat.py router
from fastapi import HTTPException

@router.post("/")
async def chat(request: Request, body: ChatRequest):
    try:
        chat_service = request.app.state.chat_service
        return StreamingResponse(...)
    except Exception as e:
        # SSE 에러 이벤트로 반환
        async def error_stream():
            yield f"event: error\ndata: {json.dumps({'message': '서버 오류가 발생했습니다'})}\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")
```

#### Frontend

```typescript
// useChat.ts
try {
  const response = await fetch(...);
  if (!response.ok) {
    throw new Error('서버 응답 오류');
  }
  // ... streaming 처리
} catch (error) {
  setMessages(prev => prev.map(msg =>
    msg.id === assistantMessage.id
      ? { ...msg, content: '죄송합니다. 오류가 발생했습니다. 다시 시도해주세요.', isStreaming: false }
      : msg
  ));
} finally {
  setIsLoading(false);
}
```

---

### 10.5 구현 순서 수정 (AWS 없이 시작)

#### Phase 0: Mock 기반 MVP (Day 1) ⭐ 신규

| Step | 작업 | 파일 |
|------|------|------|
| 0.1 | LLM 클라이언트 인터페이스 + Mock 구현 | `services/llm_client.py` |
| 0.2 | 간단한 RAG Retriever (시세만) | `services/rag_retriever.py` |
| 0.3 | Chat Service + Router | `services/chat_service.py`, `routers/chat.py` |
| 0.4 | main.py 통합 | `main.py` |

#### Phase 1: Frontend UI (Day 2)

기존 계획과 동일

#### Phase 2: 기능 확장 (Day 3)

| Step | 작업 |
|------|------|
| 2.1 | 뉴스 API 연동 (선택) |
| 2.2 | 대화 히스토리 로컬 저장 |
| 2.3 | 추천 질문 기능 |

#### Phase 3: AWS Bedrock 연결 (추후)

| Step | 작업 |
|------|------|
| 3.1 | AWS IAM 설정 |
| 3.2 | BedrockLLMClient 구현 |
| 3.3 | `USE_MOCK_LLM=false`로 전환 |

---

### 10.6 테스트 시나리오 수정

#### Scenario A: Mock 모드 테스트

1. `USE_MOCK_LLM=true` 설정
2. `POST /api/v1/chat` with `{"message": "비트코인 가격"}`
3. **Pass Criteria**:
   - SSE 이벤트 수신됨
   - Mock 응답이 실시간 시세 데이터를 포함

#### Scenario B: Frontend Mock 연동

1. Navigate to `http://localhost:3000/portfolio/ai-chat`
2. "비트코인 현재 가격" 입력
3. **Pass Criteria**:
   - 타이핑 효과로 응답 표시
   - 실제 Upbit 가격이 응답에 포함됨
   - 출처 표시됨

---

### 10.7 파일 구조 최종 정리

```
backend/app/
├── services/
│   ├── llm_client.py        # NEW - LLM 인터페이스 + Mock/Bedrock 구현
│   ├── chat_service.py      # NEW - 채팅 서비스
│   ├── rag_retriever.py     # NEW - RAG 데이터 수집
│   ├── news_service.py      # NEW - 뉴스 API (Phase 2)
│   └── market_data.py       # EXISTING - 시세 데이터 (재사용)
├── routers/
│   ├── chat.py              # NEW - 채팅 API
│   └── ...
├── models/
│   ├── chat.py              # NEW - Pydantic 스키마
│   └── ...
└── main.py                  # MODIFY - ChatService 등록

frontend/
├── app/portfolio/ai-chat/
│   └── page.tsx             # NEW - 채팅 페이지
├── components/chat/
│   ├── ChatContainer.tsx    # NEW
│   ├── ChatMessages.tsx     # NEW
│   ├── ChatInput.tsx        # NEW
│   ├── UserMessage.tsx      # NEW
│   ├── AssistantMessage.tsx # NEW
│   └── WelcomeScreen.tsx    # NEW - 빈 상태 UI
├── hooks/
│   └── useChat.ts           # NEW - 채팅 상태 관리
└── types/
    └── chat.ts              # NEW - TypeScript 타입
```

---

### 10.8 환경변수 최종 정리

```env
# === AI 채팅 (MVP) ===
USE_MOCK_LLM=true

# === AI 채팅 (AWS 연결 시) ===
# USE_MOCK_LLM=false
# AWS_ACCESS_KEY_ID=your-access-key
# AWS_SECRET_ACCESS_KEY=your-secret-key
# AWS_REGION=us-east-1
# BEDROCK_MODEL_ID=anthropic.claude-sonnet-4-5-20250514

# === 뉴스 API (Phase 2) ===
# NAVER_CLIENT_ID=your-client-id
# NAVER_CLIENT_SECRET=your-client-secret
```
