import os
import uuid
import logging
from datetime import datetime
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Form
from fastapi.middleware.cors import CORSMiddleware

# Internal imports
# Internal imports
from ocr_app.workers.ocr_parser import parse_portfolio_text
from ocr_app.workers.ocr_engine import extract_text_from_image_bytes

# Standard logging setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ocr-api")

# .env 파일 로드 (프로젝트 루트에서)
env_path = Path(__file__).parent.parent.parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

# ============================================
# 환경변수 설정
# ============================================
# 백엔드와 통일: MONGODB_URL 사용
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017/clouddx")
MONGO_URI = MONGODB_URL  # 호환성 유지
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
MINIO_BUCKET = os.getenv("MINIO_BUCKET_OCR", "ocr-images")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
MOCK_MODE = os.getenv("MOCK_MODE", "false").lower() == "true"

# MinIO/Kafka availability
MINIO_AVAILABLE = True
KAFKA_AVAILABLE = False

# ============================================
# 전역 클라이언트 상태
# ============================================
minio_client = None
kafka_producer = None
image_storage: dict[str, bytes] = {}
ocr_cache: dict[str, dict] = {}


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
# FastAPI 앱 인스턴스
# ============================================
app = FastAPI(
    title="TUTUM OCR API",
    description="이미지 업로드 및 Google Vision OCR 처리 서비스",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for local development/testing
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================
# 스키마 및 간단한 작업함수
# ============================================
class OCRError(Exception):
    pass


def process_ocr_task(import_id: str, content: bytes, user_id: str):
    """
    Background Task:
    1. Vision API로 텍스트 추출
    2. 파서로 포트폴리오 데이터 구조화
    3. 결과 캐싱 (Redis 대신 메모리 캐시 사용 중)
    """
    logger.info(
        f"[TASK] OCR Background Task Started: {import_id} (Data size: {len(content)} bytes)"
    )
    try:
        # 1. Google Vision API 호출
        logger.info(f"[API] Calling Vision API for ID: {import_id}...")
        raw_text = extract_text_from_image_bytes(content)
        logger.info(f"[SUCCESS] Vision API Success: {len(raw_text)} chars extracted")

        # 2. 텍스트 파싱
        logger.info("[PARSE] Parsing extracted text...")
        parsed_items = parse_portfolio_text(raw_text)
        logger.info(f"[SUCCESS] Parsing Success: {len(parsed_items)} items found")

        # 3. 결과 저장 (Polling 대상)
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


@app.post("/import/ocr")
async def process_ocr(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_id: str = Form(...),
):
    """
    이미지를 업로드하고 OCR 처리를 시작합니다.
    - 이미지는 MinIO (ocr-images 버킷)에 저장됩니다.
    """
    import_id = str(uuid.uuid4())
    content = await file.read()
    logger.info(
        f"[REQUEST] New OCR Request: {import_id} | File: {file.filename} | Size: {len(content)} bytes"
    )

    # 1. MinIO 이미지 저장
    image_url = None
    try:
        from app.services.storage import get_storage_service
        import io

        storage = get_storage_service()
        filename = f"ocr_{user_id}_{import_id}{os.path.splitext(file.filename)[1]}"

        result = await storage.upload_file(
            file=io.BytesIO(content),
            filename=filename,
            bucket=storage.ocr_bucket,
            content_type=file.content_type,
        )
        image_url = result["url"]
        logger.info(f"[SAVE] 이미지 MinIO 저장 완료: {filename}")
    except Exception as e:
        logger.warning(f"[WARNING] 이미지 MinIO 저장 실패 (메모리 대체): {e}")
        image_storage[import_id] = content

    # 2. OCR 처리 (MOCK_MODE=false 일 때만 실제 Vision API 호출)
    if not MOCK_MODE:
        try:
            # 동기 처리로 변경: 프론트엔드에서 즉시 조회가 가능하도록 함
            process_ocr_task(import_id, content, user_id)
            return {
                "import_id": import_id,
                "status": "completed",
                "image_url": image_url,
            }
        except Exception as e:
            logger.error(f"[ERROR] OCR 처리 실패: {e}")
            return {"import_id": import_id, "status": "failed", "error": str(e)}
    else:
        # Mock 모드일 때는 즉시 완료로 표시 (get_ocr_draft에서 mock 데이터 리턴)
        return {
            "import_id": import_id,
            "status": "completed",
            "image_url": image_url,
            "note": "MOCK_MODE is ON",
        }


@app.get("/import/draft/{import_id}")
async def get_ocr_draft(import_id: str):
    # 1. 캐시(실제 Vision API 결과) 확인
    if import_id in ocr_cache:
        return ocr_cache[import_id]

    # 2. Mock 모드인 경우 하드코딩된 예시 반환
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
        }

    raise HTTPException(status_code=404, detail="결과를 찾을 수 없거나 처리 중입니다.")
