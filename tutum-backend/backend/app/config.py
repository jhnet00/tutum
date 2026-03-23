"""
============================================
FastAPI 환경 설정
============================================

환경 변수를 관리하는 설정 클래스입니다.
.env 파일 또는 시스템 환경 변수에서 값을 로드합니다.

운영 환경 VM 배치:
- Node1: 이 백엔드 서버가 실행됨
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
    """애플리케이션 설정"""

    # 기본 설정
    APP_NAME: str = "CloudDX Asset Management API"
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api/v1"

    # MongoDB 설정 (Node2)
    MONGODB_URL: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "clouddx"

    # MariaDB 설정 (학원 제공 서버)
    MARIADB_HOST: str = "211.46.52.153"
    MARIADB_PORT: int = 15432
    MARIADB_USER: str = "team3"
    MARIADB_PASSWORD: str = ""
    MARIADB_DATABASE: str = "team3"
    MARIADB_POOL_SIZE: int = 5
    MARIADB_MAX_OVERFLOW: int = 10

    # Redis 설정 (Node2)
    REDIS_URL: str = "redis://localhost:6379"
    REDIS_DB: int = 0

    EXCHANGE_RATE_API_URL: str = "https://open.er-api.com/v6/latest"
    EXCHANGE_RATE_TIMEOUT_SECONDS: float = 5.0

    # Kafka 설정 (Node3)
    KAFKA_BOOTSTRAP_SERVERS: str = "localhost:9092"

    # Elasticsearch 설정
    # 기본값은 현재 EKS in-cluster Service 주소를 사용한다.
    # 로컬/특수 환경은 환경변수 ELASTICSEARCH_URL로 덮어쓴다.
    ELASTICSEARCH_URL: str = "http://elasticsearch.tutum-data.svc.cluster.local:9200"
    ELASTICSEARCH_INDEX: str = "news"

    # Storage 설정 (S3 / MinIO fallback)
    # S3_BUCKET_NAME 이 설정되면 boto3 (IRSA) 사용, 없으면 MinIO fallback
    S3_BUCKET_NAME: str = ""
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET_NAME: str = "clouddx-assets"
    MINIO_SECURE: bool = False  # Use HTTPS if True

    # AWS SQS 설정 (Email Queue)
    AWS_REGION: str = "ap-northeast-2"
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    SQS_QUEUE_NAME: str = "tutum-email-verify-queue"
    SQS_DLQ_NAME: str = "tutum-email-verify-dlq"

    # AWS SES 설정 (Email Sending)
    SES_SENDER_EMAIL: str = "clouddx.krb@gmail.com"
    SES_SENDER_NAME: str = "TUTUM"

    # Email Verification 설정
    VERIFICATION_TOKEN_EXPIRE_MINUTES: int = 60

    # JWT 인증 설정
    SECRET_KEY: str = ""
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 120
    REFRESH_TOKEN_EXPIRE_DAYS: int = 14

    # CORS 설정 (프론트엔드 도메인)
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]
    FRONTEND_URL: str = "http://localhost:3000"

    # ============================================
    # Market Data API Settings
    # ============================================

    # 한국투자증권 (KIS)
    KIS_APP_KEY: str = ""
    KIS_APP_SECRET: str = ""
    KIS_CANO: str = ""  # 종합계좌번호 (8자리)
    KIS_ACNT_PRDT_CD: str = "01"  # 계좌상품코드 (보통 01)
    KIS_MODE: str = "virtual"  # real or virtual (모의투자)

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
    # AWS Bedrock 설정
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
                f"필수 환경변수가 설정되지 않았습니다: {', '.join(errors)}. "
                f".env 파일을 확인하세요."
            )

        warnings = []
        if not self.AWS_ACCESS_KEY_ID or not self.AWS_SECRET_ACCESS_KEY:
            warnings.append(
                "AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (Bedrock AI 기능 비활성)"
            )
        if not self.GOOGLE_CLIENT_ID:
            warnings.append("GOOGLE_CLIENT_ID (Google OAuth 비활성)")
        if not self.KAKAO_CLIENT_ID:
            warnings.append("KAKAO_CLIENT_ID (Kakao OAuth 비활성)")
        if not self.NAVER_CLIENT_ID:
            warnings.append("NAVER_CLIENT_ID (Naver OAuth 비활성)")

        for w in warnings:
            logger.warning("선택 환경변수 미설정: %s", w)

        return self

    class Config:
        env_file = str(ENV_PATH)
        extra = "ignore"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    """설정 싱글톤 인스턴스 반환"""
    return Settings()
