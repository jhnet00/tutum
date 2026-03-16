"""Auth compatibility module for monorepo backends.

This file is intentionally scoped down to shared auth helpers only.
Actual auth endpoints are now moved to the separate `auth` repository.
"""

import logging
from datetime import datetime

from fastapi import Cookie, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel

from ..cache import cache_get
from ..config import get_settings
from ..mariadb import get_user_by_id

logger = logging.getLogger(__name__)

settings = get_settings()


# Keep this token source for clients that still import it from this module.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_PREFIX}/auth/login")

CSRF_COOKIE_KEY = "csrf_token"
REFRESH_COOKIE_KEY = "refresh_token"


class UserResponse(BaseModel):
    id: str
    email: str
    nickname: str
    marketing_opt_in: bool
    login_type: str
    profile_image: str | None = None
    created_at: datetime


class AuthIdentity(BaseModel):
    id: str
    email: str | None = None


async def _extract_token(
    request: Request,
    auth_token: str | None = Cookie(default=None),
) -> str:
    """Extract access token from Bearer header or auth cookie."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    if auth_token:
        return auth_token
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="인증 토큰이 없습니다.",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def verify_csrf_token(
    request: Request,
    csrf_cookie: str | None = Cookie(default=None, alias=CSRF_COOKIE_KEY),
) -> None:
    """Validate CSRF token for state-changing requests.

    If the request is explicitly authenticated with a Bearer token,
    treat it as header-based auth and skip cookie CSRF validation.
    Otherwise, if neither auth nor refresh cookie exists, skip CSRF validation.
    """
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return

    auth_cookie = request.cookies.get("auth_token")
    refresh_cookie = request.cookies.get(REFRESH_COOKIE_KEY)
    if not auth_cookie and not refresh_cookie:
        return

    csrf_header = request.headers.get("X-CSRF-Token")
    if not csrf_cookie or not csrf_header or csrf_cookie != csrf_header:
        raise HTTPException(status_code=403, detail="CSRF token validation failed")


def _user_to_response(user) -> UserResponse:
    return UserResponse(
        id=str(user.id),
        email=user.email,
        nickname=user.nickname,
        marketing_opt_in=user.marketing_opt_in,
        login_type=user.login_type,
        profile_image=getattr(user, "profile_image", None),
        created_at=user.created_at if hasattr(user, "created_at") else datetime.now(),
    )


async def get_current_user(token: str = Depends(_extract_token)) -> UserResponse:
    """Validate JWT and return current user from MariaDB."""
    payload = await _decode_authenticated_payload(token)
    user_id_str = payload["sub"]

    try:
        user = await get_user_by_id(int(user_id_str))
    except (TypeError, ValueError):
        raise _credentials_exception()

    if user is None:
        raise _credentials_exception()

    return _user_to_response(user)


def _credentials_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="검증되지 않은 토큰입니다.",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def _decode_authenticated_payload(token: str) -> dict:
    credentials_exception = _credentials_exception()

    # Backward compatible blacklist key (legacy key format from monolith)
    if cache_get:
        is_blacklisted = await cache_get(f"blacklist:{token}")
        if is_blacklisted:
            raise credentials_exception

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id_str = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception
    except JWTError as e:
        logger.debug("JWT decode failed: %s", e)
        raise credentials_exception

    return payload


async def get_current_identity(token: str = Depends(_extract_token)) -> AuthIdentity:
    """Validate JWT and return lightweight identity without MariaDB lookup."""
    payload = await _decode_authenticated_payload(token)
    user_id_str = payload["sub"]
    email = payload.get("email")

    return AuthIdentity(
        id=str(user_id_str),
        email=str(email) if email is not None else None,
    )
