import os
from typing import Optional  # noqa: F401
from google.cloud import vision
from google.api_core import client_options as client_options_lib


def _get_vision_client() -> vision.ImageAnnotatorClient:
    """
    Creates Vision API client with flexible authentication:

    Priority 1 (Recommended): API Key via GOOGLE_API_KEY environment variable
    Priority 2 (Optional): Service Account JSON via GOOGLE_APPLICATION_CREDENTIALS

    Raises:
        RuntimeError: If neither authentication method is configured
    """
    api_key = os.getenv("GOOGLE_API_KEY")
    sa_credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")

    if api_key:
        # API Key 방식 (기본 권장)
        opts = client_options_lib.ClientOptions(api_key=api_key)
        return vision.ImageAnnotatorClient(client_options=opts)

    elif sa_credentials_path:
        # Service Account 키 방식 (옵션)
        # GOOGLE_APPLICATION_CREDENTIALS가 설정되어 있으면 자동으로 사용됨
        return vision.ImageAnnotatorClient()

    else:
        raise RuntimeError(
            "Google Vision API 인증 설정이 필요합니다.\n"
            "방법 1 (권장): GOOGLE_API_KEY 환경변수 설정\n"
            "방법 2 (옵션): GOOGLE_APPLICATION_CREDENTIALS 환경변수로 서비스 계정 JSON 경로 지정"
        )


def extract_text_from_image_bytes(image_bytes: bytes) -> str:
    """
    Google Vision OCR: returns the full detected text.

    Authentication (automatic selection):
    - Uses GOOGLE_API_KEY if set (recommended)
    - Falls back to GOOGLE_APPLICATION_CREDENTIALS if API key not available
    - Raises error if neither is configured
    """
    client = _get_vision_client()
    image = vision.Image(content=image_bytes)

    # document_text_detection is often better for screenshots/doc-like images
    res = client.document_text_detection(image=image)

    if res.error.message:
        raise RuntimeError(f"Vision API error: {res.error.message}")

    # Prefer fullTextAnnotation when available
    if res.full_text_annotation and res.full_text_annotation.text:
        return res.full_text_annotation.text

    # Fallback: join detected blocks
    texts = [t.description for t in (res.text_annotations or [])]
    return "\n".join(texts).strip()
