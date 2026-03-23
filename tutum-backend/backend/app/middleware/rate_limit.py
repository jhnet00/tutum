"""
============================================
Rate Limiting Middleware
============================================

엔드포인트별 요청 제한을 구현합니다.
Redis가 없을 경우 제한 없이 통과합니다 (graceful fallback).
"""

import hashlib
from typing import Optional

from fastapi import HTTPException, Request, status

from ..cache import rate_limit_increment


# Rate Limit 설정 (엔드포인트별)
RATE_LIMITS = {
    "login": {"max_requests": 5, "window_seconds": 300},      # 5회/5분
    "register": {"max_requests": 3, "window_seconds": 3600},  # 3회/시간
    "check_email": {"max_requests": 15, "window_seconds": 300},  # 15회/5분
    "chat": {"max_requests": 10, "window_seconds": 60},       # 10회/분
    "admin_ai": {"max_requests": 6, "window_seconds": 600},   # 6회/10분
}


def get_client_identifier(
    request: Request,
    use_user_id: bool = False,
    user_id: Optional[str] = None
) -> str:
    """
    클라이언트 식별자 생성

    - 인증된 요청: user_id 사용
    - 비인증 요청: IP + User-Agent 해시
    """
    if use_user_id and user_id:
        return user_id

    # IP 주소 추출 (프록시 환경 고려)
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
    else:
        ip = request.client.host if request.client else "unknown"

    # User-Agent 추가 (IP 스푸핑 방지)
    user_agent = request.headers.get("User-Agent", "")
    identifier = f"{ip}:{user_agent}"

    return hashlib.sha256(identifier.encode()).hexdigest()[:16]


async def check_rate_limit(
    request: Request,
    endpoint: str,
    user_id: Optional[str] = None
) -> bool:
    """
    Rate Limit 체크

    Args:
        request: FastAPI Request 객체
        endpoint: 엔드포인트 이름 (RATE_LIMITS 키)
        user_id: 인증된 사용자 ID (선택)

    Returns:
        True: 요청 허용

    Raises:
        HTTPException: Rate limit 초과 시 429 응답
    """
    config = RATE_LIMITS.get(endpoint)
    if not config:
        return True  # 설정 없으면 제한 없음

    identifier = get_client_identifier(
        request,
        use_user_id=bool(user_id),
        user_id=user_id
    )

    key = f"ratelimit:{endpoint}:{identifier}"

    count = await rate_limit_increment(key, config["window_seconds"])

    # Redis 미연결 시: 보안/과금 민감 엔드포인트는 차단, 나머지는 통과
    if count is None:
        security_endpoints = {"login", "register", "check_email", "chat", "admin_ai"}
        if endpoint in security_endpoints:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="인증 보안 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해주세요.",
            )
        return True

    if count > config["max_requests"]:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "message": "요청 횟수를 초과했습니다. 잠시 후 다시 시도해주세요.",
                "retry_after": config["window_seconds"],
                "endpoint": endpoint
            },
            headers={"Retry-After": str(config["window_seconds"])}
        )

    return True
