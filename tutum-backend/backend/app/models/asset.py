"""
============================================
자산 모델 (확장)
============================================

CSV 대량 업로드를 위한 확장 Pydantic 모델입니다.
"""

from pydantic import BaseModel, field_validator
from datetime import datetime
from typing import Optional, List, Literal


class AssetCreateExtended(BaseModel):
    """자산 등록 요청 (확장 - CSV 대량 업로드용)"""

    # 필수 필드
    symbol: str  # 티커 심볼 (BTC, AAPL, 005930)
    name: str  # 표시 이름
    asset_type: Literal["stock", "crypto", "etf"]
    quantity: float  # 보유 수량
    average_price: float  # 평균 매입가
    currency: str = "KRW"  # 통화

    # 선택 필드 (CSV 대량 업로드)
    exchange_rate: Optional[float] = None  # 환율
    transaction_type: Optional[str] = None  # 거래 유형 (매수/매도)
    transaction_date: Optional[datetime] = None  # 거래일
    account_name: Optional[str] = None  # 계좌명
    memo: Optional[str] = None  # 메모
    buy_reason: Optional[str] = None  # 매수 사유


class BulkAssetCreate(BaseModel):
    """대량 자산 등록 요청"""

    assets: List[AssetCreateExtended]

    @field_validator("assets")
    @classmethod
    def validate_assets_count(cls, v: List[AssetCreateExtended]) -> List[AssetCreateExtended]:
        if len(v) > 100:
            raise ValueError("assets는 최대 100개까지만 허용됩니다")
        return v


class BulkAssetResponse(BaseModel):
    """대량 자산 등록 응답"""

    success_count: int  # 성공한 자산 수
    failure_count: int  # 실패한 자산 수
    failures: List[dict]  # 실패 목록 (행 번호, 에러 메시지)
    created_ids: List[str]  # 생성된 자산 ID 목록
