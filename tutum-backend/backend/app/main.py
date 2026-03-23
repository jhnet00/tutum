"""FastAPI application entrypoint."""
# noqa: build trigger 2026-03-06

import asyncio
import logging
import logging.config
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
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
    admin,
    assets,
    chat,
    market,
    news,
    notifications,
    portfolio,
    transactions,
    exchange_rate,
)
from .services.alert_service import MarketMonitor


class TraceContextFilter(logging.Filter):
    """Attach current OpenTelemetry trace/span IDs to each log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        span = trace.get_current_span()
        span_context = span.get_span_context() if span else None
        if span_context and span_context.is_valid:
            record.trace_id = format(span_context.trace_id, "032x")
            record.span_id = format(span_context.span_id, "016x")
        else:
            record.trace_id = "-"
            record.span_id = "-"
        return True


logging.config.dictConfig(
    {
        "version": 1,
        "disable_existing_loggers": False,
        "filters": {
            "trace_context": {
                "()": TraceContextFilter,
            }
        },
        "formatters": {
            "standard": {
                "format": (
                    "%(levelname)s %(asctime)s [%(name)s] %(message)s "
                    "trace_id=%(trace_id)s span_id=%(span_id)s"
                )
            }
        },
        "handlers": {
            "default": {
                "class": "logging.StreamHandler",
                "formatter": "standard",
                "filters": ["trace_context"],
            }
        },
        "root": {
            "handlers": ["default"],
            "level": os.getenv("LOG_LEVEL", "INFO").upper(),
        },
        "loggers": {
            "uvicorn": {
                "handlers": ["default"],
                "level": os.getenv("LOG_LEVEL", "INFO").upper(),
                "propagate": False,
            },
            "uvicorn.error": {
                "handlers": ["default"],
                "level": os.getenv("LOG_LEVEL", "INFO").upper(),
                "propagate": False,
            },
            "uvicorn.access": {
                "handlers": ["default"],
                "level": "WARNING",
                "propagate": False,
            },
        },
    }
)

settings = get_settings()
logger = logging.getLogger(__name__)

# OTel TracerProvider 설정 (Alloy → Tempo)
_otlp_endpoint = os.getenv("OTLP_ENDPOINT", "alloy.monitoring.svc.cluster.local:4317")
_resource = Resource.create({SERVICE_NAME: "tutum-backend"})
_tracer_provider = TracerProvider(resource=_resource)
_tracer_provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint=_otlp_endpoint, insecure=True))
)
trace.set_tracer_provider(_tracer_provider)

_SKIP_REQUEST_LOG_PATHS = {"/health", "/api/health", "/metrics", "/ready"}


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


@app.middleware("http")
async def trace_aware_request_logging(request: Request, call_next):
    start = time.perf_counter()
    client_ip = request.client.host if request.client else "-"
    path = request.url.path

    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (time.perf_counter() - start) * 1000
        logger.exception(
            "request_failed method=%s path=%s status=%s client=%s duration_ms=%.1f",
            request.method,
            path,
            500,
            client_ip,
            duration_ms,
        )
        raise

    duration_ms = (time.perf_counter() - start) * 1000
    status_code = response.status_code

    if path in _SKIP_REQUEST_LOG_PATHS and status_code < 400:
        return response

    log_level = logging.INFO
    if status_code >= 500:
        log_level = logging.ERROR
    elif status_code >= 400:
        log_level = logging.WARNING

    logger.log(
        log_level,
        "request_complete method=%s path=%s status=%s client=%s duration_ms=%.1f",
        request.method,
        path,
        status_code,
        client_ip,
        duration_ms,
    )
    return response


@app.get("/health")
@app.get("/api/health")
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
app.include_router(
    admin.router, prefix=f"{settings.API_V1_PREFIX}", tags=["admin"]
)

# Prometheus 메트릭 노출 (/metrics)
Instrumentator().instrument(app).expose(app)

# OpenTelemetry FastAPI 자동 계측
FastAPIInstrumentor.instrument_app(app)
