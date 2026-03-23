from datetime import datetime
from pydantic import BaseModel


class Notification(BaseModel):
    id: str
    type: str  # "PRICE_DROP", "PRICE_SURGE", "SYSTEM"
    title: str
    message: str
    is_read: bool = False
    created_at: datetime


class NotificationListResponse(BaseModel):
    notifications: list[Notification]
    unread_count: int
