"""FastAPI application entrypoint."""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator

from .cache import close_redis_connection, connect_to_redis
from .config import get_settings
from .database import close_mongodb_connection, connect_to_mongodb
from .mariadb import (
    close_mariadb_connection,
    connect_to_mariadb,
    merge_duplicate_portfolios,
)
from .routers import (
    assets,
    auth,
    chat,
    market,
    news,
    notifications,
    portfolio,
    transactions,
    exchange_rate,
)
from .services.alert_service import MarketMonitor

settings = get_settings()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    logger.info("Server starting")
    if (
        not settings.SECRET_KEY
        or settings.SECRET_KEY == "your-secret-key-change-in-production"
    ):
        raise RuntimeError("SECRET_KEY is not configured. Set SECRET_KEY in .env.")

    await connect_to_mongodb()
    await connect_to_mariadb()
    await connect_to_redis()

    # 기존 DB 중복 포트폴리오 항목 병합
    try:
        merged = await merge_duplicate_portfolios()
        if merged > 0:
            logger.info("Merged %d duplicate portfolio entries", merged)
    except Exception as e:
        logger.warning("Portfolio dedup failed: %s", e)

    logger.info("All services registered")

    monitor = MarketMonitor()
    monitor_task = asyncio.create_task(monitor.start_monitoring())
    app.state.market_monitor = monitor

    yield

    logger.info("Server shutting down")
    monitor_task.cancel()
    try:
        await monitor_task
    except asyncio.CancelledError:
        pass

    await close_mongodb_connection()
    await close_mariadb_connection()
    await close_redis_connection()
    logger.info("Normal shutdown complete")


app = FastAPI(
    title=settings.APP_NAME,
    description="AI-based asset management API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
    redirect_slashes=False,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
async def liveness():
    """Liveness probe."""
    return {"status": "alive"}


@app.get("/ready")
async def readiness():
    """Readiness probe."""
    try:
        from .cache import redis_client
        from .database import client as mongo_client
        from .mariadb import engine as mariadb_engine

        services = {
            "mongodb": "connected" if mongo_client else "disconnected",
            "mariadb": "connected" if mariadb_engine else "disconnected",
            "redis": "connected" if redis_client else "disconnected",
        }

        core_ok = (
            services["mongodb"] == "connected" and services["mariadb"] == "connected"
        )
        if not core_ok:
            from fastapi.responses import JSONResponse

            return JSONResponse(
                status_code=503, content={"status": "not_ready", "services": services}
            )

        return {"status": "ready", "services": services}
    except Exception as e:
        logger.warning("Readiness check error: %s", e)
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=503, content={"status": "error", "detail": "Internal error"}
        )


@app.get("/")
async def root():
    return {
        "message": "CloudDX Asset Management API",
        "docs": "/docs",
        "health": "/health",
    }


app.include_router(auth.router, prefix=f"{settings.API_V1_PREFIX}/auth", tags=["auth"])
app.include_router(
    assets.router, prefix=f"{settings.API_V1_PREFIX}/assets", tags=["assets"]
)
app.include_router(
    transactions.router,
    prefix=f"{settings.API_V1_PREFIX}/transactions",
    tags=["transactions"],
)
app.include_router(
    portfolio.router, prefix=f"{settings.API_V1_PREFIX}/portfolio", tags=["portfolio"]
)
app.include_router(
    market.router, prefix=f"{settings.API_V1_PREFIX}/market", tags=["market"]
)
app.include_router(news.router, prefix=f"{settings.API_V1_PREFIX}/news", tags=["news"])
app.include_router(
    notifications.router,
    prefix=f"{settings.API_V1_PREFIX}/notifications",
    tags=["notifications"],
)
app.include_router(chat.router, prefix=f"{settings.API_V1_PREFIX}/chat", tags=["chat"])
app.include_router(
    exchange_rate.router, prefix=f"{settings.API_V1_PREFIX}", tags=["exchange-rate"]
)

# Prometheus 메트릭 노출 (/metrics)
Instrumentator().instrument(app).expose(app)
