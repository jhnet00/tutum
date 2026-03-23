from fastapi import APIRouter, Request, Query
from ..models.notification import NotificationListResponse
from ..services.alert_service import MarketMonitor

router = APIRouter()


@router.get("", response_model=NotificationListResponse)
async def get_notifications(
    request: Request,
    limit: int = Query(20, ge=1, le=100),
    unread_only: bool = False
):
    """
    알림 목록 조회
    - limit: 반환할 알림 개수 (기본 20)
    - unread_only: 읽지 않은 알림만 필터링 여부
    """
    monitor: MarketMonitor = request.app.state.market_monitor

    notifications = monitor.get_notifications(limit=limit, unread_only=unread_only)
    unread_count = len([n for n in monitor.notifications if not n.is_read])

    return {
        "notifications": notifications,
        "unread_count": unread_count
    }


@router.post("/read-all")
async def mark_all_read(request: Request):
    """모든 알림 읽음 처리"""
    monitor: MarketMonitor = request.app.state.market_monitor
    for n in monitor.notifications:
        n.is_read = True
    return {"message": "All notifications marked as read"}
