import logging
"""
AI Chat API Router
"""
import asyncio
from fastapi import APIRouter, Request, Depends
from fastapi.responses import StreamingResponse
import json

from ..models.chat import ChatRequest
from .auth import get_current_user, UserResponse
from ..services.chat_service import chat_service
from ..middleware.rate_limit import check_rate_limit

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("")
async def chat(request: Request, body: ChatRequest, current_user: UserResponse = Depends(get_current_user)):
    """
    AI 梨꾪똿 API (SSE ?ㅽ듃由щ컢)

    - message: ?ъ슜??吏덈Ц
    - conversation_id: ???ID (?좏깮)

    Response: SSE Stream
    - event: start - ????쒖옉
    - event: sources - 異쒖쿂 ?뺣낫
    - event: delta - ?묐떟 ?띿뒪??泥?겕
    - event: done - ?꾨즺
    """
    # Rate Limiting (10??遺? ?ъ슜?먮퀎)
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
                "X-Accel-Buffering": "no",  # Nginx buffering 鍮꾪솢?깊솕
            }
        )
    except Exception as e:
        logger.error("Chat API Error: %s", e)

        async def error_stream():
            yield f"event: error\ndata: {json.dumps({'message': '?쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎. ?좎떆 ???ㅼ떆 ?쒕룄?댁＜?몄슂.'})}\n\n"

        return StreamingResponse(
            error_stream(),
            media_type="text/event-stream"
        )


@router.get("/health")
async def chat_health():
    """梨꾪똿 ?쒕퉬???곹깭 ?뺤씤"""
    return {"status": "ok", "service": "chat"}


