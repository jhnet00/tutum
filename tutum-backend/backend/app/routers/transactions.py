"""
거래 이력 API 라우터

사용자의 매수/매도 거래 이력을 관리하고
AI 분석용 데이터를 제공합니다.
"""

from fastapi import APIRouter, HTTPException, Query, Depends
from datetime import datetime
from typing import Optional, List
from bson import ObjectId  # noqa: F401

from ..database import get_database
from ..models.transaction import (
    TransactionCreate,
    TransactionResponse,
    TradingAnalysis,
    TransactionType,
)
from .auth import get_current_user, UserResponse

router = APIRouter()


def get_transactions_collection():
    """Transactions 컬렉션 가져오기"""
    db = get_database()
    if db is None:
        return None
    return db["transactions"]


@router.post("", response_model=TransactionResponse)
async def create_transaction(
    transaction: TransactionCreate,
    current_user: UserResponse = Depends(get_current_user),
):
    """
    거래 기록 생성

    매수 또는 매도 거래를 기록합니다.
    """
    transactions = get_transactions_collection()
    if transactions is None:
        raise HTTPException(status_code=503, detail="거래 DB에 연결할 수 없습니다.")
    now = datetime.utcnow()

    transaction_doc = {
        "user_id": current_user.id,
        "asset_id": transaction.asset_id,
        "symbol": transaction.symbol.upper(),
        "name": transaction.name,
        "transaction_type": transaction.transaction_type.value,
        "quantity": transaction.quantity,
        "price": transaction.price,
        "total_amount": transaction.total_amount,
        "buy_reason": transaction.buy_reason,
        "sell_reason": transaction.sell_reason,
        "realized_profit": transaction.realized_profit,
        "memo": transaction.memo,
        "transaction_date": transaction.transaction_date,
        "created_at": now,
    }

    result = await transactions.insert_one(transaction_doc)

    return TransactionResponse(
        id=str(result.inserted_id),
        user_id=current_user.id,
        asset_id=transaction.asset_id,
        symbol=transaction_doc["symbol"],
        name=transaction.name,
        transaction_type=TransactionType(transaction.transaction_type),
        quantity=transaction.quantity,
        price=transaction.price,
        total_amount=transaction.total_amount,
        buy_reason=transaction.buy_reason,
        sell_reason=transaction.sell_reason,
        realized_profit=transaction.realized_profit,
        memo=transaction.memo,
        transaction_date=transaction.transaction_date,
        created_at=now,
    )


@router.get("", response_model=List[TransactionResponse])
async def list_transactions(
    current_user: UserResponse = Depends(get_current_user),
    transaction_type: Optional[str] = Query(
        None, description="거래 유형 필터 (buy/sell)"
    ),
    start_date: Optional[datetime] = Query(None, description="시작 날짜"),
    end_date: Optional[datetime] = Query(None, description="종료 날짜"),
    limit: int = Query(100, description="최대 결과 수"),
):
    """
    거래 이력 조회

    사용자의 거래 이력을 조회합니다. 필터링 지원.
    """
    transactions = get_transactions_collection()
    if transactions is None:
        return []

    query = {"user_id": current_user.id}

    if transaction_type:
        query["transaction_type"] = transaction_type

    if start_date or end_date:
        date_query = {}
        if start_date:
            date_query["$gte"] = start_date
        if end_date:
            date_query["$lte"] = end_date
        query["transaction_date"] = date_query

    cursor = transactions.find(query).sort("transaction_date", -1).limit(limit)
    docs = await cursor.to_list(length=limit)

    result = []
    for doc in docs:
        result.append(
            TransactionResponse(
                id=str(doc["_id"]),
                user_id=doc["user_id"],
                asset_id=doc["asset_id"],
                symbol=doc["symbol"],
                name=doc["name"],
                transaction_type=TransactionType(doc["transaction_type"]),
                quantity=doc["quantity"],
                price=doc["price"],
                total_amount=doc["total_amount"],
                buy_reason=doc.get("buy_reason"),
                sell_reason=doc.get("sell_reason"),
                realized_profit=doc.get("realized_profit"),
                memo=doc.get("memo"),
                transaction_date=doc["transaction_date"],
                created_at=doc["created_at"],
            )
        )

    return result


@router.get("/analysis", response_model=TradingAnalysis)
async def get_trading_analysis(current_user: UserResponse = Depends(get_current_user)):
    """
    매매 분석 데이터 조회

    AI 분석용 집계 데이터를 반환합니다.
    """
    transactions = get_transactions_collection()
    if transactions is None:
        return TradingAnalysis(
            total_buys=0, total_sells=0, avg_holding_days=0,
            realized_return=0, win_rate=0, total_realized_profit=0,
            buy_reasons_distribution={}, sell_reasons_distribution={},
        )

    # 모든 거래 조회
    cursor = transactions.find({"user_id": current_user.id})
    docs = await cursor.to_list(length=1000)

    if not docs:
        return TradingAnalysis(
            total_buys=0,
            total_sells=0,
            avg_holding_days=0,
            realized_return=0,
            win_rate=0,
            total_realized_profit=0,
            buy_reasons_distribution={},
            sell_reasons_distribution={},
        )

    # 집계
    total_buys = sum(1 for d in docs if d["transaction_type"] == "buy")
    total_sells = sum(1 for d in docs if d["transaction_type"] == "sell")

    # 실현손익 계산
    sell_transactions = [d for d in docs if d["transaction_type"] == "sell"]
    total_realized_profit = sum(d.get("realized_profit", 0) for d in sell_transactions)

    # 승률 계산 (수익 거래 / 전체 매도 거래)
    profitable_sells = sum(
        1 for d in sell_transactions if d.get("realized_profit", 0) > 0
    )
    win_rate = (profitable_sells / total_sells * 100) if total_sells > 0 else 0

    # 평균 보유 기간 (간단한 추정: 매수-매도 간격)
    # TODO: 실제로는 asset_id로 매칭 필요
    avg_holding_days = 30.0  # Placeholder

    # 총 투자금 대비 실현 수익률
    total_investment = sum(
        d["total_amount"] for d in docs if d["transaction_type"] == "buy"
    )
    realized_return = (
        (total_realized_profit / total_investment * 100) if total_investment > 0 else 0
    )

    # 매수/매도 사유 분포
    buy_reasons = {}
    for d in docs:
        if d["transaction_type"] == "buy" and d.get("buy_reason"):
            reason = d["buy_reason"]
            buy_reasons[reason] = buy_reasons.get(reason, 0) + 1

    sell_reasons = {}
    for d in sell_transactions:
        if d.get("sell_reason"):
            reason = d["sell_reason"]
            sell_reasons[reason] = sell_reasons.get(reason, 0) + 1

    return TradingAnalysis(
        total_buys=total_buys,
        total_sells=total_sells,
        avg_holding_days=avg_holding_days,
        realized_return=realized_return,
        win_rate=win_rate,
        total_realized_profit=total_realized_profit,
        buy_reasons_distribution=buy_reasons,
        sell_reasons_distribution=sell_reasons,
    )
