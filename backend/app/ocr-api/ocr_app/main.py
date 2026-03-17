import os
import uuid
import logging
from datetime import datetime
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Form, status
from fastapi.middleware.cors import CORSMiddleware

# Internal imports
from ocr_app.workers.ocr_parser import parse_portfolio_text
from ocr_app.workers.ocr_engine import extract_text_from_image_bytes

# Standard logging setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ocr-api")

# .env load
env_path = Path(__file__).parent.parent.parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

# ============================================
# ENV CONFIG
# ============================================
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017/clouddx")
MONGO_URI = MONGODB_URL
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
MINIO_BUCKET = os.getenv("MINIO_BUCKET_OCR", "ocr-images")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
MOCK_MODE = os.getenv("MOCK_MODE", "false").lower() == "true"
STRICT_STORAGE_ERROR = os.getenv("OCR_STRICT_STORAGE", "false").lower() == "true"
OCR_MAX_UPLOAD_BYTES = int(os.getenv("OCR_MAX_UPLOAD_BYTES", "10485760"))

# MinIO/Kafka availability
MINIO_AVAILABLE = True
KAFKA_AVAILABLE = False

# ============================================
# APP CONTEXT
# ============================================
minio_client = None
kafka_producer = None
image_storage: dict[str, bytes] = {}
ocr_cache: dict[str, dict] = {}

# Structured error presets
OCR_ERROR_CODES = {
    "EMPTY_FILE": "No upload payload provided",
    "INVALID_USER": "Missing or invalid user_id",
    "INVALID_FILE_TYPE": "Unsupported image type",
    "FILE_TOO_LARGE": "Uploaded file exceeds allowed size",
    "STORAGE_FAILURE": "Image storage service failed",
    "PROCESSING_FAILURE": "OCR processing failed",
    "DRAFT_NOT_FOUND": "OCR draft item not found",
    "INTERNAL_ERROR": "OCR API internal error",
}


def _build_error(code: str, message: str, detail: str | dict[str, Any] | None = None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "error": {
            "code": code,
            "message": message,
            "description": OCR_ERROR_CODES.get(code, "OCR API Error"),
        }
    }
    if detail is not None:
        payload["error"]["detail"] = detail
    return payload


def _is_supported_image(file: UploadFile) -> bool:
    content_type = (file.content_type or "").lower()
    if content_type.startswith("image/"):
        return True

    filename = (file.filename or "").lower()
    return filename.endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle Management"""
    logger.info("SERVER STARTING (OCR API)...")
    if MINIO_AVAILABLE:
        logger.info("SUCCESS: OCR API Service Ready (MinIO Enabled)")
    else:
        logger.info("NOTE: Running in pure MEMORY MODE (No MinIO/Kafka).")
        logger.info("WARNING: Mock mode active (MOCK_MODE=true)")

    logger.info("SUCCESS: OCR API Service Ready (Memory Mode)")
    yield

    logger.info("SERVER SHUTTING DOWN (OCR API)...")
    logger.info("SUCCESS: Normal shutdown")


# ============================================
# FastAPI setup
# ============================================
app = FastAPI(
    title="TUTUM OCR API",
    description="Image upload and Google Vision OCR processing",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================
# Worker and OCR error
# ============================================
class OCRError(Exception):
    pass


def process_ocr_task(import_id: str, content: bytes, user_id: str):
    """
    Background Task
    1) Call Vision API
    2) Parse output
    3) Cache result
    """
    logger.info(
        f"[TASK] OCR Background Task Started: {import_id} (Data size: {len(content)} bytes)"
    )
    try:
        logger.info(f"[API] Calling Vision API for ID: {import_id}...")
        raw_text = extract_text_from_image_bytes(content)
        logger.info(f"[SUCCESS] Vision API Success: {len(raw_text)} chars extracted")

        logger.info("[PARSE] Parsing extracted text...")
        parsed_items = parse_portfolio_text(raw_text)
        logger.info(f"[SUCCESS] Parsing Success: {len(parsed_items)} items found")

        ocr_cache[import_id] = {
            "import_id": import_id,
            "user_id": user_id,
            "status": "completed",
            "items": parsed_items,
            "raw_text": raw_text[:500] if len(raw_text) > 500 else raw_text,
            "created_at": datetime.utcnow().isoformat(),
        }
        logger.info(f"[DONE] OCR Task Completed for ID: {import_id}")

    except Exception as e:
        logger.error(f"[ERROR] OCR Task Failed for ID {import_id}: {e}", exc_info=True)
        ocr_cache[import_id] = {
            "import_id": import_id,
            "status": "failed",
            "error": str(e),
        }


@app.get("/health")
async def health_check():
    return {"status": "healthy", "mode": "MOCK" if MOCK_MODE else "PROD"}


@app.get("/")
async def root_health_check():
    # ALB health checks use "/" via the shared staging ingress annotation.
    return {"status": "healthy", "service": "ocr-api", "mode": "MOCK" if MOCK_MODE else "PROD"}


@app.post("/import/ocr")
async def process_ocr(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_id: str = Form(...),
):
    """
    Start OCR processing.
    """
    import_id = str(uuid.uuid4())

    request_id = str(uuid.uuid4())

    if not user_id or not user_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_build_error("INVALID_USER", "user_id is required", {"request_id": request_id}),
        )

    content = await file.read()
    logger.info(
        f"[REQUEST] New OCR Request: {import_id} | File: {file.filename} | Size: {len(content)} bytes"
    )

    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_build_error("EMPTY_FILE", "Uploaded file is empty", {"request_id": request_id}),
        )

    if len(content) > OCR_MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=_build_error(
                "FILE_TOO_LARGE",
                "Uploaded file is too large",
                {"request_id": request_id, "max_bytes": OCR_MAX_UPLOAD_BYTES},
            ),
        )

    if not _is_supported_image(file):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=_build_error(
                "INVALID_FILE_TYPE",
                "Unsupported file type",
                {"request_id": request_id, "content_type": file.content_type},
            ),
        )

    # 1. Save image to storage if available
    image_url = None
    try:
        from app.services.storage import get_storage_service
        import io

        storage = get_storage_service()
        filename = f"ocr_{user_id}_{import_id}{os.path.splitext(file.filename or '.bin')[1]}"

        result = await storage.upload_file(
            file=io.BytesIO(content),
            filename=filename,
            bucket=storage.ocr_bucket,
            content_type=file.content_type,
        )
        image_url = result["url"]
        logger.info(f"[SAVE] Image stored: {filename}")
    except Exception as e:
        logger.warning(f"[WARNING] Image storage failed: {e}")
        if STRICT_STORAGE_ERROR:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=_build_error(
                    "STORAGE_FAILURE",
                    "Failed to store OCR image",
                    {"request_id": request_id, "error": str(e)},
                ),
            )
        image_storage[import_id] = content

    # 2. OCR processing
    if not MOCK_MODE:
        try:
            process_ocr_task(import_id, content, user_id)
            return {
                "import_id": import_id,
                "status": "completed",
                "image_url": image_url,
                "request_id": request_id,
            }
        except Exception as e:
            logger.error(f"[ERROR] OCR processing failed: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=_build_error(
                    "PROCESSING_FAILURE",
                    "OCR processing failed",
                    {"request_id": request_id, "error": str(e)},
                ),
            )
    else:
        # Mock mode response for quick test flow
        return {
            "import_id": import_id,
            "status": "completed",
            "image_url": image_url,
            "note": "MOCK_MODE is ON",
            "request_id": request_id,
        }


@app.get("/import/draft/{import_id}")
async def get_ocr_draft(import_id: str):
    # Return processed cache result
    if import_id in ocr_cache:
        return ocr_cache[import_id]

    # Mock fallback preview
    if MOCK_MODE and import_id in image_storage:
        return {
            "import_id": import_id,
            "status": "completed",
            "items": [
                {
                    "symbol": "BTC",
                    "amount": 0.00381993,
                    "avg_price": 50000000.0,
                    "asset_type": "crypto",
                    "currency": "KRW",
                },
                {
                    "symbol": "ETH",
                    "amount": 1.5,
                    "avg_price": 3500000.0,
                    "asset_type": "crypto",
                    "currency": "KRW",
                },
            ],
            "request_id": str(uuid.uuid4()),
        }

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=_build_error(
            "DRAFT_NOT_FOUND",
            "OCR draft not found",
            {"import_id": import_id},
        ),
    )
