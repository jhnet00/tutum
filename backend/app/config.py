"""
============================================
FastAPI ?섍꼍 ?ㅼ젙
============================================

?섍꼍 蹂?섎? 愿由ы븯???ㅼ젙 ?대옒?ㅼ엯?덈떎.
.env ?뚯씪 ?먮뒗 ?쒖뒪???섍꼍 蹂?섏뿉??媛믪쓣 濡쒕뱶?⑸땲??

?댁쁺 ?섍꼍 VM 諛곗튂:
- Node1: ??諛깆뿏???쒕쾭媛 ?ㅽ뻾??
- Node2: MongoDB Primary, Redis Master, MinIO
- Node3: MongoDB Secondary, Elasticsearch, Kafka Workers
"""

import logging
from pydantic_settings import BaseSettings
from pydantic import model_validator
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

ENV_PATH = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    """?좏뵆由ъ??댁뀡 ?ㅼ젙"""

    # 湲곕낯 ?ㅼ젙
    APP_NAME: str = "CloudDX Asset Management API"
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api/v1"

    # MongoDB ?ㅼ젙 (Node2)
    MONGODB_URL: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "clouddx"

    # MariaDB ?ㅼ젙 (?숈썝 ?쒓났 ?쒕쾭)
    MARIADB_HOST: str = "211.46.52.153"
    MARIADB_PORT: int = 15432
    MARIADB_USER: str = "team3"
    MARIADB_PASSWORD: str = ""
    MARIADB_DATABASE: str = "team3"
    MARIADB_POOL_SIZE: int = 5
    MARIADB_MAX_OVERFLOW: int = 10

    # Redis ?ㅼ젙 (Node2)
    REDIS_URL: str = "redis://localhost:6379"
    REDIS_DB: int = 0

    EXCHANGE_RATE_API_URL: str = "https://open.er-api.com/v6/latest"
    EXCHANGE_RATE_TIMEOUT_SECONDS: float = 5.0

    # Kafka ?ㅼ젙 (Node3)
    KAFKA_BOOTSTRAP_SERVERS: str = "localhost:9092"

    # Elasticsearch ?ㅼ젙 (Node3)
    ELASTICSEARCH_URL: str = "http://192.168.56.13:9200"
    ELASTICSEARCH_INDEX: str = "news"

    # Storage ?ㅼ젙 (S3 / MinIO fallback)
    # S3_BUCKET_NAME ???ㅼ젙?섎㈃ boto3 (IRSA) ?ъ슜, ?놁쑝硫?MinIO fallback
    S3_BUCKET_NAME: str = ""
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET_NAME: str = "clouddx-assets"
    MINIO_SECURE: bool = False  # Use HTTPS if True

    # AWS SQS ?ㅼ젙 (Email Queue)
    AWS_REGION: str = "ap-northeast-2"
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    SQS_QUEUE_NAME: str = "tutum-email-verify-queue"
    SQS_DLQ_NAME: str = "tutum-email-verify-dlq"

    # AWS SES ?ㅼ젙 (Email Sending)
    SES_SENDER_EMAIL: str = "clouddx.krb@gmail.com"
    SES_SENDER_NAME: str = "TUTUM"

    # Email Verification ?ㅼ젙
    VERIFICATION_TOKEN_EXPIRE_MINUTES: int = 60

    # JWT ?몄쬆 ?ㅼ젙
    SECRET_KEY: str = ""
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 120
    REFRESH_TOKEN_EXPIRE_DAYS: int = 14

    # CORS ?ㅼ젙 (?꾨줎?몄뿏???꾨찓??
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]
    FRONTEND_URL: str = "http://localhost:3000"

    # ============================================
    # Market Data API Settings
    # ============================================

    # ?쒓뎅?ъ옄利앷텒 (KIS)
    KIS_APP_KEY: str = ""
    KIS_APP_SECRET: str = ""
    KIS_CANO: str = ""  # 醫낇빀怨꾩쥖踰덊샇 (8?먮━)
    KIS_ACNT_PRDT_CD: str = "01"  # 怨꾩쥖?곹뭹肄붾뱶 (蹂댄넻 01)
    KIS_MODE: str = "virtual"  # real or virtual (紐⑥쓽?ъ옄)

    # Upbit
    UPBIT_ACCESS_KEY: str = ""
    UPBIT_SECRET_KEY: str = ""

    # Overseas Intraday Vendor (V3)
    STOCK_VENDOR: str = "auto"  # auto|finnhub|polygon|mock
    FINNHUB_API_KEY: str = ""
    POLYGON_API_KEY: str = ""

    # OAuth 2.0 (Google)
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/v1/auth/google/callback"

    # OAuth 2.0 (Kakao)
    KAKAO_CLIENT_ID: str = ""
    KAKAO_CLIENT_SECRET: str = ""
    KAKAO_REDIRECT_URI: str = "http://localhost:8000/api/v1/auth/kakao/callback"

    # OAuth 2.0 (Naver)
    NAVER_CLIENT_ID: str = ""
    NAVER_CLIENT_SECRET: str = ""
    NAVER_REDIRECT_URI: str = "http://localhost:8000/api/v1/auth/naver/callback"

    # ============================================
    # AWS Bedrock ?ㅼ젙
    # ============================================
    AWS_REGION: str = "ap-northeast-2"
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    BEDROCK_MODEL_ID: str = "global.anthropic.claude-sonnet-4-6"
    BEDROCK_MAX_TOKENS: int = 4096
    BEDROCK_TEMPERATURE: float = 0.7

    @model_validator(mode="after")
    def validate_required_settings(self) -> "Settings":
        errors = []

        if not self.SECRET_KEY:
            errors.append("SECRET_KEY")
        if not self.MARIADB_PASSWORD:
            errors.append("MARIADB_PASSWORD")

        if errors:
            raise ValueError(
                f"?꾩닔 ?섍꼍蹂?섍? ?ㅼ젙?섏? ?딆븯?듬땲?? {', '.join(errors)}. "
                f".env ?뚯씪???뺤씤?섏꽭??"
            )

        warnings = []
        if not self.AWS_ACCESS_KEY_ID or not self.AWS_SECRET_ACCESS_KEY:
            warnings.append(
                "AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (Bedrock AI 湲곕뒫 鍮꾪솢??"
            )
        if not self.GOOGLE_CLIENT_ID:
            warnings.append("GOOGLE_CLIENT_ID (Google OAuth 鍮꾪솢??")
        if not self.KAKAO_CLIENT_ID:
            warnings.append("KAKAO_CLIENT_ID (Kakao OAuth 鍮꾪솢??")
        if not self.NAVER_CLIENT_ID:
            warnings.append("NAVER_CLIENT_ID (Naver OAuth 鍮꾪솢??")

        for w in warnings:
            logger.warning("?좏깮 ?섍꼍蹂??誘몄꽕?? %s", w)

        return self

    class Config:
        env_file = str(ENV_PATH)
        extra = "ignore"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    """?ㅼ젙 ?깃????몄뒪?댁뒪 諛섑솚"""
    return Settings()

