import logging

"""
============================================
? API ???
============================================

????(?????? ? ?OAuth 2.0 ? ??API???

? ????Auth Service? ???
- Node1? ? ???
- Redis Master(Node2)??? ???
- MariaDB(Node2)?????? ???
"""

from fastapi import (
    APIRouter,
    HTTPException,
    Depends,
    status,
    Response,
    Request,
    Cookie,
    Query,
)
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, EmailStr, field_validator
import re
from datetime import datetime, timedelta
from typing import Optional
import time
import uuid
import secrets
import hashlib
from jose import jwt, JWTError
import bcrypt  # passlib ???bcrypt  ? (Python 3.13 ?)
import httpx
import secrets
from bson import ObjectId  # For backwards compatibility/S3 if needed
import os
from fastapi import UploadFile, File

from ..config import get_settings
from ..mariadb import (
    get_user_by_email,
    get_user_by_id,
    create_user as mariadb_create_user,
    update_user,
)
from app.services.queue_service import get_queue_service
from app.services.email_service import get_email_service

# Redis ??? ??  (? ????)
try:
    from ..cache import cache_set, cache_get, cache_delete, get_redis

except ImportError:
    cache_set = cache_get = cache_delete = get_redis = None

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_PREFIX}/auth/login")
OAUTH_STATE_COOKIE_MAX_AGE_SECONDS = 600
CSRF_COOKIE_KEY = "csrf_token"
REFRESH_COOKIE_KEY = "refresh_token"
_OAUTH_STATE_FALLBACK_TTL_SECONDS = OAUTH_STATE_COOKIE_MAX_AGE_SECONDS
_oauth_state_fallback: dict[str, float] = {}


def _oauth_state_cookie_key(provider: str) -> str:
    return f"oauth_state_{provider}"


def _oauth_state_cache_key(provider: str, state: str) -> str:
    return f"oauth_state:{provider}:{state}"


def _is_oauth_secure_cookie(provider: str) -> bool:
    uri = {
        "google": settings.GOOGLE_REDIRECT_URI,
        "kakao": settings.KAKAO_REDIRECT_URI,
        "naver": settings.NAVER_REDIRECT_URI,
    }.get(provider, "")
    return str(uri).startswith("https://")


def _oauth_state_cookie_attrs(provider: str) -> tuple[str, str]:
    secure_cookie = _is_oauth_secure_cookie(provider)
    same_site = "none" if secure_cookie else "lax"
    return secure_cookie, same_site


def _set_oauth_state_cookie(response: Response, provider: str, state: str) -> None:
    secure_cookie, same_site = _oauth_state_cookie_attrs(provider)

    response.set_cookie(
        key=_oauth_state_cookie_key(provider),
        value=state,
        httponly=True,
        path="/",
        samesite=same_site,
        secure=secure_cookie,
        max_age=OAUTH_STATE_COOKIE_MAX_AGE_SECONDS,
    )


async def _remember_oauth_state(provider: str, state: str) -> None:
    key = _oauth_state_cache_key(provider, state)
    stored_in_cache = False

    if cache_set:
        try:
            await cache_set(key, "1", expire_seconds=OAUTH_STATE_COOKIE_MAX_AGE_SECONDS)
            stored_in_cache = True
        except Exception:
            logger.exception("Failed to persist oauth state")
            stored_in_cache = False

    if not stored_in_cache:
        _oauth_state_fallback[key] = time.time() + _OAUTH_STATE_FALLBACK_TTL_SECONDS


def _consume_oauth_state_fallback(provider: str, state: str) -> bool:
    key = _oauth_state_cache_key(provider, state)
    expired_at = _oauth_state_fallback.get(key)
    if not expired_at:
        return False

    if expired_at < time.time():
        _oauth_state_fallback.pop(key, None)
        return False

    _oauth_state_fallback.pop(key, None)
    return True


def _is_oauth_state_cache_hit(raw_value: object) -> bool:
    if raw_value is None:
        return False
    if isinstance(raw_value, bool):
        return raw_value
    if isinstance(raw_value, (bytes, bytearray)):
        return raw_value.decode("utf-8", errors="ignore").strip() == "1"
    if isinstance(raw_value, int):
        return raw_value == 1
    return str(raw_value).strip() == "1"


def _issue_csrf_token(response: Response) -> str:
    csrf_token = secrets.token_urlsafe(32)
    response.set_cookie(
        key=CSRF_COOKIE_KEY,
        value=csrf_token,
        httponly=False,
        path="/",
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    return csrf_token


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(key="auth_token", path="/", samesite="lax", httponly=True)
    response.delete_cookie(
        key=REFRESH_COOKIE_KEY, path="/", samesite="lax", httponly=True
    )
    response.delete_cookie(
        key=CSRF_COOKIE_KEY, path="/", samesite="lax", httponly=False
    )


async def _verify_oauth_state(request: Request, provider: str, state: str) -> None:
    if not state:
        raise HTTPException(status_code=400, detail="OAuth state is missing")

    expected_state = request.cookies.get(_oauth_state_cookie_key(provider))
    cache_valid = False
    cache_raw_value = None

    if cache_get:
        try:
            cache_key = _oauth_state_cache_key(provider, state)
            cache_raw_value = await cache_get(cache_key)
            cache_valid = _is_oauth_state_cache_hit(cache_raw_value)
        except Exception:
            logger.exception("Failed to read oauth state cache")
            cache_valid = False

    logger.debug(
        "OAuth state check provider=%s expected_cookie=%s cache_hit=%s cache_value=%r",
        provider,
        bool(expected_state),
        cache_valid,
        cache_raw_value,
    )

    if not cache_valid:
        cache_valid = _consume_oauth_state_fallback(provider, state)

    if not expected_state and not cache_valid:
        raise HTTPException(status_code=400, detail="OAuth state is missing")

    if expected_state and expected_state != state and not cache_valid:
        logger.warning(
            "OAuth state mismatch for provider=%s expected=%s got=%s",
            provider,
            expected_state,
            state,
        )
        raise HTTPException(status_code=400, detail="OAuth state is invalid")


def _clear_oauth_state_cookie(response: Response, provider: str) -> None:
    secure_cookie, same_site = _oauth_state_cookie_attrs(provider)
    response.delete_cookie(
        key=_oauth_state_cookie_key(provider),
        path="/",
        samesite=same_site,
        secure=secure_cookie,
    )


async def _clear_oauth_state_cache(provider: str, state: str) -> None:
    if cache_delete:
        try:
            await cache_delete(_oauth_state_cache_key(provider, state))
        except Exception:
            logger.exception("Failed to clear oauth state cache")
    _oauth_state_fallback.pop(_oauth_state_cache_key(provider, state), None)


# ============================================
# ?/?
# ============================================


class UserCreate(BaseModel):
    """????"""

    email: EmailStr
    password: str
    nickname: str
    marketing_opt_in: bool = False

    @field_validator("password")
    @classmethod
    def validate_password_complexity(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("비밀번호는 최소 8자 이상이어야 합니다")
        if len(v) > 128:
            raise ValueError("비밀번호는 128자 이하여야 합니다")
        if not re.search(r"[A-Z]", v):
            raise ValueError("비밀번호에 대문자가 최소 1자 포함되어야 합니다")
        if not re.search(r"[a-z]", v):
            raise ValueError("비밀번호에 소문자가 최소 1자 포함되어야 합니다")
        if not re.search(r"[0-9]", v):
            raise ValueError("비밀번호에 숫자가 최소 1자 포함되어야 합니다")
        if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", v):
            raise ValueError("비밀번호에 특수문자가 최소 1자 포함되어야 합니다")
        return v


class UserLogin(BaseModel):
    """???"""

    email: EmailStr
    password: str


class ProfileUpdate(BaseModel):
    """프로필 업데이트 요청"""

    nickname: Optional[str] = None
    marketing_opt_in: Optional[bool] = None


class PasswordUpdate(BaseModel):
    """비밀번호 변경 요청"""

    old_password: str
    new_password: str


class Token(BaseModel):
    """? ?"""

    access_token: str
    token_type: str = "bearer"
    user_id: str
    nickname: str


class UserResponse(BaseModel):
    """???? ?"""

    id: str
    email: str
    nickname: str
    marketing_opt_in: bool
    login_type: str  # email, google, kakao, naver
    profile_image: Optional[str] = None
    created_at: datetime


class SocialSync(BaseModel):
    """소셜 로그인 동기화 요청"""

    email: EmailStr
    nickname: str
    provider: str
    provider_id: Optional[str] = None


# ============================================
# ? ?
# ============================================


def create_access_token(data: dict) -> str:
    """JWT ???? ?"""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict) -> str:
    """JWT refresh token 생성."""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def _issue_auth_cookies(
    response: Response, access_token: str, refresh_token: str
) -> None:
    response.set_cookie(
        key="auth_token",
        value=access_token,
        httponly=True,
        path="/",
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    response.set_cookie(
        key=REFRESH_COOKIE_KEY,
        value=refresh_token,
        httponly=True,
        path="/",
        samesite="lax",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
    )
    _issue_csrf_token(response)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """? ?(bcrypt  ?)"""
    password_bytes = plain_password.encode("utf-8")
    hashed_bytes = hashed_password.encode("utf-8")
    return bcrypt.checkpw(password_bytes, hashed_bytes)


def hash_password(password: str) -> str:
    """? ? (bcrypt  ?)"""
    password_bytes = password.encode("utf-8")
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode("utf-8")


def generate_verification_token() -> str:
    """
    Generate secure random verification token (URL-safe).

    Returns 32-byte URL-safe token string.
    """
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """
    Hash verification token using SHA-256.

    Tokens are stored hashed in database for security.
    """
    return hashlib.sha256(token.encode()).hexdigest()


def _user_to_response(user) -> UserResponse:
    """Convert MariaDB User ORM to UserResponse."""
    return UserResponse(
        id=str(user.id),
        email=user.email,
        nickname=user.nickname,
        marketing_opt_in=user.marketing_opt_in,
        login_type=user.login_type,
        created_at=user.created_at,
        profile_image=getattr(user, "profile_image", None),
    )


async def _extract_token(
    request: Request,
    auth_token: str | None = Cookie(default=None),
) -> str:
    """Authorization ? ? HttpOnly ? ?"""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    if auth_token:
        return auth_token
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="? ? ??",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def verify_csrf_token(
    request: Request,
    csrf_cookie: str | None = Cookie(default=None, alias=CSRF_COOKIE_KEY),
) -> None:
    """
    CSRF protection for cookie-authenticated state-changing requests.
    If auth cookie is present, require X-CSRF-Token header to match csrf_token cookie.
    """
    auth_cookie = request.cookies.get("auth_token")
    refresh_cookie = request.cookies.get(REFRESH_COOKIE_KEY)
    if not auth_cookie and not refresh_cookie:
        return

    csrf_header = request.headers.get("X-CSRF-Token")
    if not csrf_cookie or not csrf_header or csrf_cookie != csrf_header:
        raise HTTPException(status_code=403, detail="CSRF token validation failed")


async def get_current_user(token: str = Depends(_extract_token)) -> UserResponse:
    """Validate JWT and return current user from MariaDB."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="검증되지 않은 토큰입니다.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    # 블랙리스트 확인 (NEW)
    if cache_get:
        is_blacklisted = await cache_get(f"blacklist:{token}")
        if is_blacklisted:
            raise credentials_exception

    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        user_id_str = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # MariaDB에서 조회 (user_id가 숫자임 확인)
    try:
        user = await get_user_by_id(int(user_id_str))
    except (ValueError, TypeError):
        raise credentials_exception

    if user is None:
        raise credentials_exception

    return _user_to_response(user)


# ============================================
# API ????
# ============================================


from ..database import get_database


@router.post("/register")
async def register(user: UserCreate):
    """
    이메일 회원가입

    - 이메일 중복 확인
    - 비밀번호 해싱 후 MariaDB에 저장
    - 이메일 인증 토큰 생성 및 SQS enqueue (Optional)
    """
    # ??? ?
    existing = await get_user_by_email(user.email)
    if existing:
        raise HTTPException(status_code=400, detail="?? ??????")

    # Create user (is_verified defaults to False in model if supported)
    now = datetime.utcnow()

    new_user = await mariadb_create_user(
        email=user.email,
        password=hash_password(user.password),
        nickname=user.nickname,
        marketing_opt_in=user.marketing_opt_in,
        login_type="email",
    )
    user_id = str(new_user.id)

    # 이메일 인증 토큰 생성
    verification_token = generate_verification_token()
    token_hash = hash_token(verification_token)
    expires_at = datetime.utcnow() + timedelta(
        minutes=settings.VERIFICATION_TOKEN_EXPIRE_MINUTES
    )

    # MongoDB에 토큰 저장 (email_verification_tokens 컬렉션) - Hybrid approach for now
    db = get_database()
    tokens_collection = db["email_verification_tokens"]
    token_doc = {
        "user_id": user_id,
        "token_hash": token_hash,
        "expires_at": expires_at,
        "used_at": None,
        "created_at": now,
    }
    await tokens_collection.insert_one(token_doc)

    # SQS에 이메일 발송 작업 enqueue
    try:
        queue_service = get_queue_service()
        await queue_service.enqueue_verification_email(
            user_email=user.email,
            verification_token=verification_token,  # Plain token (not hashed)
        )
        print(f"✅ Verification email queued for {user.email}")
    except Exception as e:
        print(f"⚠️  Failed to enqueue verification email: {e}")
        # 사용자 생성은 성공했으므로 에러를 던지지 않고 로그만 남김

    return {
        "message": "회원가입이 완료되었습니다. 이메일을 확인하여 인증을 완료해주세요.",
        "email": user.email,
        "verification_required": True,
    }


@router.post("/check-email")
async def check_email_availability(request: dict):
    """
    이메일 사용 가능 여부 확인 (회원가입 전 중복 체크)

    - 일반 이메일 회원가입 중복 확인
    - 소셜 로그인 계정 중복 확인

    Returns: {"available": bool, "message": str}
    """
    email = request.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="이메일을 입력해주세요")

    # 이메일 중복 확인 (모든 login_type)
    existing_user = await get_user_by_email(email)

    if existing_user:
        login_type = existing_user.login_type or "unknown"
        if login_type == "email":
            return {
                "available": False,
                "message": "이미 등록된 이메일입니다. 로그인해주세요.",
            }
        else:
            return {
                "available": False,
                "message": f"{login_type.upper()} 계정으로 이미 가입된 이메일입니다. {login_type.upper()} 로그인을 이용해주세요.",
            }

    return {"available": True, "message": "사용 가능한 이메일입니다."}


@router.get("/verification-status")
async def get_verification_status(email: str):
    """
    이메일 인증 상태 확인 (프론트엔드 polling용)

    - 회원가입 중 인증 완료 여부 확인

    Returns: {"is_verified": bool}
    """
    user = await get_user_by_email(email)

    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

    return {"is_verified": user.is_verified}


@router.get("/verify")
async def verify_email(token: str):
    """
    이메일 인증 처리

    - 토큰 검증 (해시 비교, 만료 확인, 사용 여부 확인)
    - 사용자 is_verified = True 업데이트
    - 토큰 used_at 업데이트 (1회성)
    """
    from app.database import get_database

    db = get_database()
    tokens_collection = db["email_verification_tokens"]
    db = get_database()
    tokens_collection = db["email_verification_tokens"]
    # users = get_users_collection() (Removed)

    # 토큰 해시
    token_hash = hash_token(token)

    # DB에서 토큰 조회
    token_doc = await tokens_collection.find_one({"token_hash": token_hash})

    if not token_doc:
        raise HTTPException(status_code=400, detail="유효하지 않은 인증 링크입니다")

    # 만료 확인
    if token_doc["expires_at"] < datetime.utcnow():
        raise HTTPException(
            status_code=400,
            detail="인증 링크가 만료되었습니다. 새로운 인증 이메일을 요청해주세요",
        )

    # 이미 사용된 토큰 확인 및 멱등성(Idempotency) 처리
    # 이미 사용된 토큰 확인 및 멱등성(Idempotency) 처리
    if token_doc.get("used_at") is not None:
        # 이미 사용된 토큰일 경우, 해당 사용자가 이미 인증되었는지 확인
        user_id = token_doc["user_id"]
        # MariaDB check
        try:
            user = await get_user_by_id(int(user_id))
            if user and user.is_verified:
                # 이미 인증된 사용자라면 메시지 반환 (중복 호출 대응)
                return {
                    "message": "이미 인증이 완료된 계정입니다.",
                    "status": "success",
                }
        except Exception:
            pass

        raise HTTPException(status_code=400, detail="이미 사용된 인증 링크입니다")

    # 사용자 is_verified 업데이트
    user_id = token_doc["user_id"]
    try:
        await update_user(int(user_id), is_verified=True, updated_at=datetime.utcnow())
    except Exception as e:
        logger.error(f"Failed to update user verification status: {e}")
        raise HTTPException(status_code=500, detail="사용자 인증 상태 업데이트 실패")

    # 토큰 used_at 업데이트
    await tokens_collection.update_one(
        {"_id": token_doc["_id"]}, {"$set": {"used_at": datetime.utcnow()}}
    )

    # API 호출이므로 메시지 반환 (프론트엔드에서 처리)
    return {"message": "이메일 인증이 완료되었습니다.", "status": "success"}


@router.post("/resend-verification")
async def resend_verification(email: EmailStr):
    """
    이메일 인증 재발송

    - 이미 인증된 사용자는 에러
    - 기존 토큰 무효화
    - 새 토큰 생성 및 SQS enqueue
    """
    from app.database import get_database

    db = get_database()
    tokens_collection = db["email_verification_tokens"]
    # 사용자 조회
    user = await get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=404, detail="등록되지 않은 이메일입니다")

    # 이미 인증된 사용자
    if user.is_verified:
        raise HTTPException(status_code=400, detail="이미 인증된 계정입니다")

    user_id = str(user.id)

    # 기존 토큰 무효화 (used_at 설정)
    await tokens_collection.update_many(
        {"user_id": user_id, "used_at": None}, {"$set": {"used_at": datetime.utcnow()}}
    )

    # 새 토큰 생성
    verification_token = generate_verification_token()
    token_hash = hash_token(verification_token)

    expires_at = datetime.utcnow() + timedelta(
        minutes=settings.VERIFICATION_TOKEN_EXPIRE_MINUTES
    )
    token_doc = {
        "user_id": user_id,
        "token_hash": token_hash,
        "expires_at": expires_at,
        "used_at": None,
        "created_at": datetime.utcnow(),
    }
    await tokens_collection.insert_one(token_doc)

    # SQS에 이메일 발송 작업 enqueue
    try:
        queue_service = get_queue_service()
        await queue_service.enqueue_verification_email(
            user_email=email, verification_token=verification_token
        )
        print(f"✅ Verification email re-queued for {email}")
    except Exception as e:
        print(f"⚠️  Failed to enqueue verification email: {e}")
        raise HTTPException(status_code=500, detail="이메일 발송에 실패했습니다")

    return {
        "message": "인증 이메일이 재발송되었습니다. 이메일을 확인해주세요.",
        "email": email,
    }


@router.post("/login")
async def login(user: UserLogin):
    """
    ?????

    - ???? ?
    - JWT ?  (HttpOnly  + JSON ?)
    - Redis???  (?? ??? ?????)
    """
    # MariaDB? ???
    user_doc = await get_user_by_email(user.email, login_type="email")
    if not user_doc:
        raise HTTPException(status_code=401, detail="???? ? ?? ??")

    # ? ?
    if not user_doc.password or not verify_password(user.password, user_doc.password):
        raise HTTPException(status_code=401, detail="???? ? ?? ??")

    # 이메일 인증 확인 (MariaDB model check)
    if hasattr(user_doc, "is_verified") and not user_doc.is_verified:
        raise HTTPException(
            status_code=403, detail="이메일 인증이 필요합니다. 이메일을 확인해주세요."
        )

    # ? ?
    user_id = str(user_doc.id)
    access_token = create_access_token({"sub": user_id, "email": user_doc.email})
    refresh_token = create_refresh_token({"sub": user_id, "email": user_doc.email})

    # Redis??? ???(? ? - Redis ????? ?)
    if cache_set:
        try:
            await cache_set(
                f"session:{user_id}",
                access_token,
                expire_seconds=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            )
            await cache_set(
                f"refresh:{user_id}",
                refresh_token,
                expire_seconds=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
            )
        except Exception as e:
            logger.warning("Redis session save failed: %s", e)

    response = JSONResponse(
        content={
            "access_token": access_token,
            "token_type": "bearer",
            "user_id": user_id,
            "nickname": user_doc.nickname,
        }
    )
    _issue_auth_cookies(response, access_token, refresh_token)
    return response


# ============================================
# OAuth 2.0  ?
# ============================================


async def _oauth_find_or_create(email: str, nickname: str, login_type: str) -> str:
    """OAuth ??: MariaDB? ??????, user_id ??"""
    user = await get_user_by_email(email)

    if not user:
        # ? ??
        user = await mariadb_create_user(
            email=email,
            password=None,
            nickname=nickname,
            marketing_opt_in=False,
            login_type=login_type,
        )
    else:
        #  ? - login_type ?? ?updated_at
        await update_user(user.id, login_type=login_type, updated_at=datetime.utcnow())

    return str(user.id)


async def _oauth_issue_token_and_redirect(
    user_id: str, email: str, state: str | None = None
) -> RedirectResponse:
    """Issue JWT and return OAuth redirect response."""
    app_token = create_access_token({"sub": user_id, "email": email})
    refresh_token = create_refresh_token({"sub": user_id, "email": email})

    if cache_set:
        try:
            await cache_set(
                f"session:{user_id}",
                app_token,
                expire_seconds=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            )
            await cache_set(
                f"refresh:{user_id}",
                refresh_token,
                expire_seconds=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
            )
        except Exception:
            pass

    frontend_url = (
        getattr(settings, "FRONTEND_URL", "http://localhost:3000") or "http://localhost:3000"
    ).rstrip("/")
    callback_url = f"{frontend_url}/auth/callback"
    if state:
        callback_url = f"{callback_url}?token={app_token}"

    response = RedirectResponse(url=callback_url)
    _issue_auth_cookies(response, app_token, refresh_token)
    return response


@router.post("/social-sync")
async def social_sync(data: SocialSync, response: Response):
    """
    OAuth 2.0 소셜 로그인 성공 후 백엔드와 유저 정보를 동기화하고
    Tutum 서비스 전용 JWT 토큰 및 세션을 발급합니다.
    """
    # 1. MariaDB에서 유저 조회 또는 생성
    user_id = await _oauth_find_or_create(data.email, data.nickname, data.provider)

    # 2. Tutum JWT 발급
    app_token = create_access_token({"sub": user_id, "email": data.email})
    refresh_token = create_refresh_token({"sub": user_id, "email": data.email})

    # 3. Redis 세션 저장 (필요한 경우)
    if cache_set:
        try:
            await cache_set(
                f"session:{user_id}",
                app_token,
                expire_seconds=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            )
            await cache_set(
                f"refresh:{user_id}",
                refresh_token,
                expire_seconds=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
            )
        except Exception as e:
            logger.warning("Social sync Redis session save failed: %s", e)

    # 4. JSON 응답 및 쿠키 발급
    json_response = JSONResponse(
        content={
            "access_token": app_token,
            "token_type": "bearer",
            "user_id": user_id,
            "nickname": data.nickname,
        }
    )
    _issue_auth_cookies(json_response, app_token, refresh_token)
    return json_response


# ============================================
# OAuth 2.0 (Google)
# ============================================


@router.get("/google/login")
@router.get("/google/login/")
async def google_login(
    state: str | None = Query(default=None, min_length=8, max_length=128),
):
    """Google OAuth login endpoint."""
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google Client ID ??? ????")

    oauth_state = state or secrets.token_urlsafe(24)
    google_auth_url = (
        f"https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={settings.GOOGLE_CLIENT_ID}"
        f"&response_type=code"
        f"&redirect_uri={settings.GOOGLE_REDIRECT_URI}"
        f"&scope=openid email profile"
        f"&access_type=offline"
        f"&prompt=select_account"
        f"&state={oauth_state}"
    )
    response = RedirectResponse(google_auth_url)
    _set_oauth_state_cookie(response, "google", oauth_state)
    await _remember_oauth_state("google", oauth_state)
    return response


@router.get("/google")
@router.get("/google/")
async def google_login_alias() -> Response:
    # Prevent 404 from legacy frontend routes or stale caches requesting /google or /google/.
    # Keep compatibility with legacy or bookmark URLs.
    return RedirectResponse("/api/v1/auth/google/login")


@router.get("/google/callback")
@router.get("/google/callback/")
async def google_callback(code: str, state: str, request: Request):
    """Google ??"""
    # 1. Access Token ?
    await _verify_oauth_state(request, "google", state)
    token_url = "https://oauth2.googleapis.com/token"
    data = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "client_secret": settings.GOOGLE_CLIENT_SECRET,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        token_res = await client.post(token_url, data=data)
        if token_res.status_code != 200:
            try:
                token_error = token_res.json()
            except Exception:
                token_error = token_res.text
            logger.error("Google token exchange failed state=%s status=%s body=%r", state, token_res.status_code, token_error)
            raise HTTPException(status_code=400, detail="Google token exchange failed")
        token_json = token_res.json()
        access_token = token_json.get("access_token")

        # 2. ???? ?
        user_info_res = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if user_info_res.status_code != 200:
            try:
                info_error = user_info_res.json()
            except Exception:
                info_error = user_info_res.text
            logger.error(
                "Google userinfo failed state=%s status=%s body=%r",
                state,
                user_info_res.status_code,
                info_error,
            )
            raise HTTPException(status_code=400, detail="Google userinfo failed")
        user_info = user_info_res.json()

    # 3. MariaDB? ? ???
    email = user_info.get("email")
    nickname = user_info.get("name", "Google User")
    user_id = await _oauth_find_or_create(email, nickname, "google")

    # 4. JWT  + ???
    response = await _oauth_issue_token_and_redirect(user_id, email, state)
    _clear_oauth_state_cookie(response, "google")
    await _clear_oauth_state_cache("google", state)
    return response


# ============================================
# OAuth 2.0 (Kakao)
# ============================================


@router.get("/kakao/login")
async def kakao_login(
    state: str | None = Query(default=None, min_length=8, max_length=128),
):
    """Kakao OAuth login endpoint."""
    if not settings.KAKAO_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Kakao Client ID ??? ????")

    oauth_state = state or secrets.token_urlsafe(24)
    kakao_auth_url = (
        f"https://kauth.kakao.com/oauth/authorize"
        f"?client_id={settings.KAKAO_CLIENT_ID}"
        f"&redirect_uri={settings.KAKAO_REDIRECT_URI}"
        f"&response_type=code"
        f"&prompt=select_account"
        f"&state={oauth_state}"
    )
    response = RedirectResponse(kakao_auth_url)
    _set_oauth_state_cookie(response, "kakao", oauth_state)
    await _remember_oauth_state("kakao", oauth_state)
    return response


@router.get("/kakao/callback")
async def kakao_callback(code: str, state: str, request: Request):
    """Kakao ??"""
    # 1. Access Token ?
    await _verify_oauth_state(request, "kakao", state)
    token_url = "https://kauth.kakao.com/oauth/token"
    data = {
        "grant_type": "authorization_code",
        "client_id": settings.KAKAO_CLIENT_ID,
        "client_secret": settings.KAKAO_CLIENT_SECRET,
        "redirect_uri": settings.KAKAO_REDIRECT_URI,
        "code": code,
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        token_res = await client.post(token_url, data=data)
        if token_res.status_code != 200:
            raise HTTPException(status_code=400, detail="Kakao ??? (Token)")
        token_json = token_res.json()
        access_token = token_json.get("access_token")

        # 2. ???? ?
        user_info_res = await client.get(
            "https://kapi.kakao.com/v2/user/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if user_info_res.status_code != 200:
            raise HTTPException(status_code=400, detail="Kakao ??? (UserInfo)")
        user_info = user_info_res.json()

    # 3. MariaDB? ? ???
    kakao_account = user_info.get("kakao_account", {})
    email = kakao_account.get("email")
    properties = user_info.get("properties", {})
    nickname = properties.get("nickname", "Kakao User")

    if not email:
        email = f"kakao_{user_info.get('id')}@kakao.com"

    user_id = await _oauth_find_or_create(email, nickname, "kakao")

    # 4. JWT  + ???
    response = await _oauth_issue_token_and_redirect(user_id, email, state)
    _clear_oauth_state_cookie(response, "kakao")
    await _clear_oauth_state_cache("kakao", state)
    return response


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: UserResponse = Depends(get_current_user)):
    """현재 로그인한 사용자 정보 반환"""
    return current_user


@router.put("/update-profile")
async def update_profile(
    profile: ProfileUpdate, current_user: UserResponse = Depends(get_current_user)
):
    """사용자 프로필 업데이트 (닉네임, 마케팅 동의)"""
    update_data = {}
    if profile.nickname is not None:
        update_data["nickname"] = profile.nickname
    if profile.marketing_opt_in is not None:
        update_data["marketing_opt_in"] = profile.marketing_opt_in

    if not update_data:
        return current_user

    updated_user = await update_user(int(current_user.id), **update_data)
    if not updated_user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

    return _user_to_response(updated_user)


@router.put("/change-password")
async def change_password(
    data: PasswordUpdate, current_user: UserResponse = Depends(get_current_user)
):
    """비밀번호 변경"""
    user = await get_user_by_id(int(current_user.id))
    if not user or not user.password:
        raise HTTPException(
            status_code=400, detail="이메일 가입 사용자만 비밀번호 변경이 가능합니다"
        )

    if not verify_password(data.old_password, user.password):
        raise HTTPException(status_code=400, detail="현재 비밀번호가 일치하지 않습니다")

    await update_user(user.id, password=hash_password(data.new_password))
    return {"message": "비밀번호가 성공적으로 변경되었습니다"}


@router.post("/upload-profile-image")
async def upload_profile_image(
    file: UploadFile = File(...), current_user: UserResponse = Depends(get_current_user)
):
    """프로필 이미지 업로드 (MinIO)"""
    from app.services.storage import get_storage_service

    storage = get_storage_service()

    # MIME type check
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="이미지 파일만 업로드 가능합니다")

    # Upload to MinIO
    file_ext = file.filename.split(".")[-1]
    object_name = (
        f"profiles/{current_user.id}_{int(datetime.utcnow().timestamp())}.{file_ext}"
    )

    try:
        content = await file.read()
        image_url = await storage.upload_file(
            content, object_name, bucket="profile-images"
        )

        # Update MariaDB
        await update_user(int(current_user.id), profile_image=image_url)
        return {"profile_image": image_url}
    except Exception as e:
        logger.error(f"Avatar upload failed: {e}")
        raise HTTPException(
            status_code=500, detail="이미지 업로드 중 오류가 발생했습니다"
        )


@router.delete("/profile-image")
async def delete_profile_image(current_user: UserResponse = Depends(get_current_user)):
    """프로필 이미지 삭제"""
    await update_user(int(current_user.id), profile_image=None)
    return {"message": "프로필 이미지가 삭제되었습니다"}


# ============================================
# OAuth 2.0 (Naver)
# ============================================


@router.get("/naver/login")
async def naver_login(
    state: str | None = Query(default=None, min_length=8, max_length=128),
):
    """Naver OAuth login endpoint."""
    if not settings.NAVER_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Naver Client ID ??? ????")

    oauth_state = state or secrets.token_urlsafe(24)

    naver_auth_url = (
        f"https://nid.naver.com/oauth2.0/authorize"
        f"?response_type=code"
        f"&client_id={settings.NAVER_CLIENT_ID}"
        f"&redirect_uri={settings.NAVER_REDIRECT_URI}"
        f"&state={oauth_state}"
        f"&auth_type=reauthenticate"
    )
    response = RedirectResponse(naver_auth_url)
    _set_oauth_state_cookie(response, "naver", oauth_state)
    await _remember_oauth_state("naver", oauth_state)
    return response


@router.get("/naver/callback")
async def naver_callback(code: str, state: str, request: Request):
    """Naver ??"""
    # 1. Access Token ?
    await _verify_oauth_state(request, "naver", state)
    token_url = "https://nid.naver.com/oauth2.0/token"
    params = {
        "grant_type": "authorization_code",
        "client_id": settings.NAVER_CLIENT_ID,
        "client_secret": settings.NAVER_CLIENT_SECRET,
        "code": code,
        "state": state,
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        token_res = await client.get(token_url, params=params)
        if token_res.status_code != 200:
            raise HTTPException(status_code=400, detail="Naver ??? (Token)")
        token_json = token_res.json()
        access_token = token_json.get("access_token")

        # 2. ???? ?
        user_info_res = await client.get(
            "https://openapi.naver.com/v1/nid/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if user_info_res.status_code != 200:
            raise HTTPException(status_code=400, detail="Naver ??? (UserInfo)")
        user_info = user_info_res.json()

    # 3. MariaDB? ? ???
    naver_response = user_info.get("response", {})
    email = naver_response.get("email")
    nickname = naver_response.get("nickname", "Naver User")

    if not email:
        raise HTTPException(status_code=400, detail="Naver? ?????? ????.")

    user_id = await _oauth_find_or_create(email, nickname, "naver")

    # 4. JWT  + ???
    response = await _oauth_issue_token_and_redirect(user_id, email, state)
    _clear_oauth_state_cookie(response, "naver")
    await _clear_oauth_state_cache("naver", state)
    return response


@router.post("/refresh")
async def refresh_access_token(
    refresh_token: str | None = Cookie(default=None, alias=REFRESH_COOKIE_KEY),
    _: None = Depends(verify_csrf_token),
):
    """Refresh token으로 access token을 재발급합니다."""
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Refresh token not found")

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid refresh token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(
            refresh_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        user_id = payload.get("sub")
        email = payload.get("email")
        token_type = payload.get("type")
        if not user_id or not email or token_type != "refresh":
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    if cache_get and get_redis and get_redis() is not None:
        try:
            stored_refresh = await cache_get(f"refresh:{user_id}")
            normalized_cookie = str(refresh_token).strip().strip('"')
            if stored_refresh is not None:
                normalized_stored = str(stored_refresh).strip().strip('"')
                if normalized_stored != normalized_cookie:
                    raise credentials_exception
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("Refresh token cache lookup failed: %s", e)

    new_access_token = create_access_token({"sub": user_id, "email": email})
    new_refresh_token = create_refresh_token({"sub": user_id, "email": email})

    if cache_set:
        try:
            await cache_set(
                f"session:{user_id}",
                new_access_token,
                expire_seconds=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            )
            await cache_set(
                f"refresh:{user_id}",
                new_refresh_token,
                expire_seconds=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
            )
        except Exception as e:
            logger.warning("Refresh token cache save failed: %s", e)

    response = JSONResponse(
        content={
            "access_token": new_access_token,
            "token_type": "bearer",
            "user_id": str(user_id),
        }
    )
    _issue_auth_cookies(response, new_access_token, new_refresh_token)
    return response


@router.delete("/me")
async def withdraw_account(
    response: Response,
    current_user: UserResponse = Depends(get_current_user),
    token: str = Depends(_extract_token),
):
    """
    회원 탈퇴 처리
    """
    user_id = int(current_user.id)

    # 1. MariaDB에서 사용자 삭제 (Portfolios are cascaded)
    from ..mariadb import delete_user

    success = await delete_user(user_id)

    if not success:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

    # 1.1 MongoDB 레거시 데이터 삭제 (Social 로그 정보 등 잔재 제거)
    from ..database import get_db

    db = get_db()
    if db is not None:
        try:
            # 이메일 기준으로 모든 잔재 삭제
            await db["users"].delete_many({"email": current_user.email})
            logger.info(
                "MongoDB legacy user records for %s purged.", current_user.email
            )
        except Exception as e:
            logger.warning(
                "Failed to delete legacy user from MongoDB during withdrawal: %s", e
            )

    # 2. Redis 세션 삭제
    if cache_delete:
        try:
            await cache_delete(f"session:{user_id}")
            await cache_delete(f"refresh:{user_id}")
        except Exception as e:
            logger.warning(
                "Failed to delete session from redis during withdrawal: %s", e
            )

    # 3. 쿠키 삭제
    _clear_auth_cookies(response)

    return {"message": "회원 탈퇴가 완료되었습니다. 그동안 이용해주셔서 감사합니다."}

    # users = get_users_collection() (removed)


@router.post("/logout")
async def logout(
    response: Response,
    token: str | None = Cookie(default=None, alias="auth_token"),
):
    """로그아웃 (쿠키 삭제)"""
    if token and cache_delete:
        try:
            # Decode token to get user_id without validation (just to get sub)
            # Or just use the token string if we were blacklisting.
            # Here we follow logic to invalidate session.
            payload = jwt.decode(
                token,
                settings.SECRET_KEY,
                algorithms=[settings.ALGORITHM],
                options={"verify_signature": False},
            )
            user_id = payload.get("sub")
            if user_id:
                await cache_delete(f"session:{user_id}")
                await cache_delete(f"refresh:{user_id}")
        except Exception:
            pass
    _clear_auth_cookies(response)
    return {"message": "Successfully logged out"}
