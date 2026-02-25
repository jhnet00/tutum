"""
AI Chat Pydantic Models
"""
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from enum import Enum


class MessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"


class SourceType(str, Enum):
    PRICE = "price"
    NEWS = "news"
    PORTFOLIO = "portfolio"


class Source(BaseModel):
    type: SourceType
    title: str
    url: Optional[str] = None


class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    user_id: Optional[str] = None


class ChatMessage(BaseModel):
    id: str
    role: MessageRole
    content: str
    sources: List[Source] = []
    created_at: datetime
