"""
거래 이력 모델 정의

사용자의 모든 매수/매도 거래를 추적하여
AI 분석 및 투자 패턴 인사이트를 제공합니다.
"""

from pydantic import BaseModel, field_validator
from datetime import datetime
from typing import Optional
from enum import Enum


class TransactionType(str, Enum):
    """거래 유형"""

    BUY = "buy"
    SELL = "sell"


class TransactionCreate(BaseModel):
    """거래 생성 요청"""

    asset_id: str  # 연결된 자산 ID
    symbol: str
    name: str
    transaction_type: TransactionType
    quantity: float
    price: float  # 매수가 또는 매도가
    total_amount: float  # quantity * price

    # Buy-specific fields
    buy_reason: Optional[str] = None

    # Sell-specific fields
    sell_reason: Optional[str] = None
    realized_profit: Optional[float] = None  # 실현손익 (매도시에만)

    memo: Optional[str] = None
    transaction_date: datetime

    @field_validator("transaction_date")
    @classmethod
    def validate_transaction_date_not_future(cls, v: datetime) -> datetime:
        if v > datetime.now():
            raise ValueError("transaction_date cannot be in the future")
        return v


class TransactionResponse(BaseModel):
    """거래 응답"""

    id: str
    user_id: str
    asset_id: str
    symbol: str
    name: str
    transaction_type: TransactionType
    quantity: float
    price: float
    total_amount: float
    buy_reason: Optional[str]
    sell_reason: Optional[str]
    realized_profit: Optional[float]
    memo: Optional[str]
    transaction_date: datetime
    created_at: datetime


class TradingAnalysis(BaseModel):
    """매매 분석 결과"""

    total_buys: int
    total_sells: int
    avg_holding_days: float
    realized_return: float  # 실현 수익률 (%)
    win_rate: float  # 승률 (%)
    total_realized_profit: float
    buy_reasons_distribution: dict  # {"뉴스": 5, "기술적": 3, ...}
    sell_reasons_distribution: dict
