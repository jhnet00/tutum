"""
MariaDB Portfolio API Router
"""

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from ..mariadb import (
    add_portfolio_item,
    delete_portfolio_item,
    get_user_portfolios,
    update_portfolio_item,
)
from .auth import UserResponse, get_current_user, verify_csrf_token

router = APIRouter()
logger = logging.getLogger(__name__)
MAX_DECIMAL_PLACES = 6


def _normalize_decimal(value: float) -> float:
    numeric = float(value)
    return round(numeric, MAX_DECIMAL_PLACES)


class PortfolioCreate(BaseModel):
    asset_code: str = Field(..., min_length=1, max_length=20)
    asset_name: str = Field(..., min_length=1, max_length=100)
    asset_type: str = Field(..., min_length=1, max_length=20)
    quantity: float = Field(..., gt=0)
    avg_buy_price: float = Field(..., gt=0)
    currency: str = Field(default="KRW", min_length=3, max_length=10)

    @field_validator("quantity", "avg_buy_price")
    @classmethod
    def normalize_numeric_fields(cls, value: float) -> float:
        return _normalize_decimal(value)


class PortfolioUpdate(BaseModel):
    asset_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    asset_type: Optional[str] = None
    quantity: Optional[float] = Field(default=None, gt=0)
    avg_buy_price: Optional[float] = Field(default=None, gt=0)
    currency: Optional[str] = Field(default=None, min_length=3, max_length=10)

    @field_validator("quantity", "avg_buy_price")
    @classmethod
    def normalize_optional_numeric_fields(cls, value: Optional[float]) -> Optional[float]:
        if value is None:
            return value
        return _normalize_decimal(value)


class PortfolioSell(BaseModel):
    quantity: float = Field(..., gt=0)
    sell_price: float = Field(..., gt=0)
    sell_reason: Optional[str] = None
    sell_date: Optional[str] = None
    memo: Optional[str] = None

    @field_validator("quantity", "sell_price")
    @classmethod
    def normalize_sell_numeric_fields(cls, value: float) -> float:
        return _normalize_decimal(value)


class BulkPortfolioCreate(BaseModel):
    assets: list[PortfolioCreate] = Field(..., max_length=100)


class PortfolioResponse(BaseModel):
    id: int
    user_id: int
    asset_code: str
    asset_name: str
    asset_type: str
    quantity: float
    avg_buy_price: float
    currency: str
    created_at: datetime
    updated_at: datetime


def _to_response(item) -> PortfolioResponse:
    return PortfolioResponse(
        id=item.id,
        user_id=item.user_id,
        asset_code=item.asset_code,
        asset_name=item.asset_name,
        asset_type=item.asset_type,
        quantity=item.quantity,
        avg_buy_price=item.avg_buy_price,
        currency=item.currency,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.get("", response_model=list[PortfolioResponse])
async def list_portfolio_items(
    current_user: UserResponse = Depends(get_current_user),
):
    try:
        items = await get_user_portfolios(int(current_user.id))
        return [_to_response(item) for item in items]
    except Exception:
        logger.exception("MariaDB portfolio list failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="포트폴리오 조회 중 오류가 발생했습니다.",
        )


@router.post("", response_model=PortfolioResponse, status_code=status.HTTP_201_CREATED)
async def create_portfolio_item(
    payload: PortfolioCreate,
    _: None = Depends(verify_csrf_token),
    current_user: UserResponse = Depends(get_current_user),
):
    try:
        created = await add_portfolio_item(
            user_id=int(current_user.id),
            asset_code=payload.asset_code.upper(),
            asset_name=payload.asset_name,
            asset_type=payload.asset_type,
            quantity=payload.quantity,
            avg_buy_price=payload.avg_buy_price,
            currency=payload.currency.upper(),
        )
        return _to_response(created)
    except Exception:
        logger.exception("MariaDB portfolio create failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="포트폴리오 생성 중 오류가 발생했습니다.",
        )


@router.post("/bulk", status_code=status.HTTP_201_CREATED)
async def bulk_create_portfolio_items(
    payload: BulkPortfolioCreate,
    _: None = Depends(verify_csrf_token),
    current_user: UserResponse = Depends(get_current_user),
):
    user_id = int(current_user.id)
    created_items = []
    errors = []

    for i, item in enumerate(payload.assets):
        try:
            created = await add_portfolio_item(
                user_id=user_id,
                asset_code=item.asset_code.upper(),
                asset_name=item.asset_name,
                asset_type=item.asset_type,
                quantity=item.quantity,
                avg_buy_price=item.avg_buy_price,
                currency=item.currency.upper(),
            )
            created_items.append(_to_response(created))
        except Exception as e:
            errors.append({"index": i, "asset_code": item.asset_code, "error": str(e)})

    return {
        "success_count": len(created_items),
        "error_count": len(errors),
        "items": created_items,
        "errors": errors,
    }


@router.patch("/{item_id}", response_model=PortfolioResponse)
async def patch_portfolio_item(
    item_id: int,
    payload: PortfolioUpdate,
    _: None = Depends(verify_csrf_token),
    current_user: UserResponse = Depends(get_current_user),
):
    allowed_fields = {"asset_name", "asset_type", "quantity", "avg_buy_price", "currency"}
    updates = payload.model_dump(exclude_unset=True, exclude_none=True)
    updates = {k: v for k, v in updates.items() if k in allowed_fields}
    if not updates:
        raise HTTPException(status_code=400, detail="수정할 필드가 없습니다.")

    if "currency" in updates:
        updates["currency"] = str(updates["currency"]).upper()

    try:
        updated = await update_portfolio_item(
            item_id=item_id,
            user_id=int(current_user.id),
            **updates,
        )
    except Exception:
        logger.exception("Portfolio update failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="포트폴리오 수정 중 오류가 발생했습니다.",
        )

    if not updated:
        raise HTTPException(status_code=404, detail="포트폴리오 항목을 찾을 수 없습니다.")

    return _to_response(updated)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_portfolio_item(
    item_id: int,
    _: None = Depends(verify_csrf_token),
    current_user: UserResponse = Depends(get_current_user),
):
    try:
        deleted = await delete_portfolio_item(item_id=item_id, user_id=int(current_user.id))
    except Exception:
        logger.exception("MariaDB portfolio delete failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="포트폴리오 삭제 중 오류가 발생했습니다.",
        )

    if not deleted:
        raise HTTPException(status_code=404, detail="포트폴리오 항목을 찾을 수 없습니다.")


@router.post("/{item_id}/sell")
async def sell_portfolio_item(
    item_id: int,
    payload: PortfolioSell,
    _: None = Depends(verify_csrf_token),
    current_user: UserResponse = Depends(get_current_user),
):
    """
    포트폴리오 종목 매도
    - 전량 매도 시 항목 삭제
    - 부분 매도 시 수량 차감
    - 실현손익 반환
    """
    user_id = int(current_user.id)

    try:
        from ..mariadb import get_session, Portfolio
        from sqlalchemy import select

        session_factory = get_session()
        if not session_factory:
            raise HTTPException(status_code=503, detail="DB 연결 오류")

        async with session_factory() as session:
            stmt = select(Portfolio).where(
                Portfolio.id == item_id, Portfolio.user_id == user_id
            )
            result = await session.execute(stmt)
            item = result.scalar_one_or_none()

            if not item:
                raise HTTPException(status_code=404, detail="포트폴리오 항목을 찾을 수 없습니다.")

            if payload.quantity > item.quantity:
                raise HTTPException(status_code=400, detail="보유 수량보다 매도 수량이 많습니다.")

            # 실현손익 계산
            realized_profit = (payload.sell_price - item.avg_buy_price) * payload.quantity
            profit_rate = (
                ((payload.sell_price - item.avg_buy_price) / item.avg_buy_price) * 100
                if item.avg_buy_price > 0
                else 0
            )

            remaining = item.quantity - payload.quantity

            if remaining <= 0:
                # 전량 매도 → 삭제
                await session.delete(item)
            else:
                # 부분 매도 → 수량 차감 (평단가 유지)
                item.quantity = remaining
                item.updated_at = datetime.utcnow()

            await session.commit()

        return {
            "message": "매도 완료",
            "sold_quantity": payload.quantity,
            "sell_price": payload.sell_price,
            "remaining_quantity": max(remaining, 0),
            "realized_profit": round(realized_profit, 2),
            "profit_rate": round(profit_rate, 2),
        }

    except HTTPException:
        raise
    except Exception:
        logger.exception("Portfolio sell failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="매도 처리 중 오류가 발생했습니다.",
        )
