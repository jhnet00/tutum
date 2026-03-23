"""AI chat API router."""

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..middleware.rate_limit import check_rate_limit
from ..models.chat import ChatRequest
from ..services.chat_service import chat_service
from .auth import UserResponse, get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)


class BedrockChatRequest(BaseModel):
    prompt: str | None = None
    message: str | None = None
    conversation_id: str | None = None

    def resolved_message(self) -> str:
        return (self.message or self.prompt or "").strip()


class BedrockChatResponse(BaseModel):
    response: str
    sources: list[dict[str, Any]] = Field(default_factory=list)


@router.post("")
async def chat(
    request: Request,
    body: ChatRequest,
    current_user: UserResponse = Depends(get_current_user),
):
    """SSE streaming chat endpoint."""
    await check_rate_limit(request, "chat", user_id=current_user.id)

    try:
        async def guarded_stream():
            try:
                async for chunk in chat_service.chat_stream(
                    message=body.message,
                    conversation_id=body.conversation_id,
                    user_id=current_user.id,
                ):
                    if await request.is_disconnected():
                        break
                    if getattr(request.app.state, "is_shutting_down", False):
                        break
                    yield chunk
            except asyncio.CancelledError:
                return

        return StreamingResponse(
            guarded_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    except Exception as e:
        logger.error("Chat API Error: %s", e)

        async def error_stream():
            payload = {"message": "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요."}
            yield f"event: error\ndata: {json.dumps(payload)}\n\n"

        return StreamingResponse(error_stream(), media_type="text/event-stream")


@router.post("/bedrock", response_model=BedrockChatResponse)
async def chat_bedrock(
    request: Request,
    body: BedrockChatRequest,
    current_user: UserResponse = Depends(get_current_user),
):
    """
    JSON chat endpoint for clients that cannot consume SSE directly.
    Accepts either `prompt` or `message`.
    """
    await check_rate_limit(request, "chat", user_id=current_user.id)

    user_message = body.resolved_message()
    if not user_message:
        raise HTTPException(status_code=422, detail="prompt or message is required")

    current_event = ""
    response_parts: list[str] = []
    sources: list[dict[str, Any]] = []

    try:
        async for chunk in chat_service.chat_stream(
            message=user_message,
            conversation_id=body.conversation_id,
            user_id=current_user.id,
        ):
            for line in chunk.splitlines():
                line = line.strip()
                if not line:
                    current_event = ""
                    continue

                if line.startswith("event: "):
                    current_event = line[7:].strip()
                    continue

                if not line.startswith("data: "):
                    continue

                try:
                    payload = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue

                if current_event == "delta":
                    token = payload.get("content")
                    if isinstance(token, str):
                        response_parts.append(token)
                elif current_event == "sources":
                    event_sources = payload.get("sources")
                    if isinstance(event_sources, list):
                        sources = event_sources
                elif current_event == "error":
                    detail = payload.get("message") if isinstance(payload, dict) else None
                    raise HTTPException(
                        status_code=502,
                        detail=detail or "Bedrock response stream failed",
                    )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Bedrock JSON API Error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to generate Bedrock response")

    return BedrockChatResponse(response="".join(response_parts).strip(), sources=sources)


@router.get("/health")
async def chat_health():
    """Chat service health check."""
    return {"status": "ok", "service": "chat"}
