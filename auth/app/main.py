from __future__ import annotations

"""Auth service entrypoint.

이 모듈은 auth 라우터만 구동하는 독립 FastAPI 앱입니다.
"""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .cache import close_redis_connection, connect_to_redis
from .config import get_settings
from .database import close_mongodb_connection, connect_to_mongodb
from .mariadb import close_mariadb_connection, connect_to_mariadb
from .routers import auth as auth_router

settings = get_settings()
logger = logging.getLogger(__name__)


app = FastAPI(
    title="TUTUM Auth Service",
    description="Auth API extracted from monolith",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)


@app.on_event("startup")
async def startup_event() -> None:
    if not settings.SECRET_KEY:
        raise RuntimeError("SECRET_KEY is not configured. Set SECRET_KEY in .env.")

    await connect_to_mongodb()
    await connect_to_mariadb()
    await connect_to_redis()
    logger.info("TUTUM auth service startup complete")


@app.on_event("shutdown")
async def shutdown_event() -> None:
    await close_mongodb_connection()
    await close_mariadb_connection()
    await close_redis_connection()
    logger.info("TUTUM auth service shutdown complete")


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def healthcheck():
    return {"status": "alive"}


@app.get("/ready")
async def readiness():
    return {"status": "ready"}


@app.get("/")
async def root():
    return {
        "message": "TUTUM Auth Service",
        "docs": "/docs",
        "health": "/health",
    }


app.include_router(auth_router.router, prefix=f"{settings.API_V1_PREFIX}/auth", tags=["auth"])
