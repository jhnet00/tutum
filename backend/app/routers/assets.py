import logging

"""
============================================
?먯궛 API ?쇱슦??
============================================

?ъ슜???먯궛(二쇱떇, 肄붿씤) CRUD API?낅땲??

?곗씠???먮쫫:
- ?ъ슜????FastAPI ??MongoDB Primary (Node2)
- 議고쉶 ??Read Replica (Node3) ?ъ슜 媛??
- ?쒖꽭 ?뺣낫??Kafka Producer ??Price Topic ??Consumer 寃쎈줈濡?媛깆떊
"""

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, field_validator
from datetime import datetime
from typing import Optional, Dict, Literal
from bson import ObjectId
from bson.errors import InvalidId
from pymongo import UpdateOne, ReturnDocument
from pymongo.errors import BulkWriteError
from ..database import get_database, get_assets_collection
from ..models.asset import AssetCreateExtended, BulkAssetCreate, BulkAssetResponse
from ..services.exchange_rate import get_exchange_rate
from ..services.market_data import kis_client, crypto_client
from ..cache import cache_portfolio, get_cached_portfolio, invalidate_portfolio_cache
from .auth import get_current_user, UserResponse

import asyncio

router = APIRouter()
logger = logging.getLogger(__name__)


# ============================================
# ?붿껌/?묐떟 紐⑤뜽
# ============================================


class AssetCreate(BaseModel):
    """?먯궛 ?깅줉 ?붿껌"""

    symbol: str  # ?곗빱 ?щ낵 (BTC, AAPL, 005930)
    name: str  # ?쒖떆 ?대쫫
    asset_type: Literal["stock", "crypto", "etf"]
    quantity: float  # 蹂댁쑀 ?섎웾
    average_price: float  # ?됯퇏 留ㅼ엯媛
    currency: str = "KRW"  # ?듯솕
    memo: Optional[str] = None  # ?ъ슜??硫붾え/AI ?붿빟
    buy_reason: Optional[str] = None  # 留ㅼ닔 ?ъ쑀 (News, Technical ??


class AssetUpdate(BaseModel):
    """?먯궛 ?섏젙 ?붿껌"""

    quantity: Optional[float] = None
    average_price: Optional[float] = None
    memo: Optional[str] = None
    buy_reason: Optional[str] = None
    ai_analysis: Optional[str] = None


class SellRequest(BaseModel):
    """?먯궛 留ㅻ룄 ?붿껌"""

    quantity: float
    sell_price: float
    sell_reason: Optional[str] = None
    sell_date: datetime = datetime.utcnow()
    memo: Optional[str] = None


class AssetResponse(BaseModel):
    """?먯궛 ?묐떟"""

    id: str
    symbol: str
    name: str
    asset_type: Literal["stock", "crypto", "etf"]
    quantity: float
    average_price: float
    current_price: Optional[float] = None
    profit: Optional[float] = None
    profit_percent: Optional[float] = None
    currency: str
    memo: Optional[str] = None
    buy_reason: Optional[str] = None
    ai_analysis: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# ============================================
# API ?붾뱶?ъ씤??
# ============================================


@router.get("")
async def list_assets(
    current_user: UserResponse = Depends(get_current_user),
    asset_type: Optional[str] = Query(None),
    skip_cache: bool = Query(False),
):
    user_id = current_user.id
    """
    ?ъ슜???먯궛 紐⑸줉 議고쉶

    - Redis 罹먯떆 ?곗꽑 議고쉶 (1遺?TTL)
    - MongoDB?먯꽌 ?ъ슜?먯쓽 紐⑤뱺 ?먯궛 議고쉶
    - ?꾩옱媛 ?뺣낫??罹먯떆(Redis) ?먮뒗 蹂꾨룄 ?쒖꽭 API?먯꽌 議고쉶
    """
    # 罹먯떆 ?뺤씤 (asset_type ?꾪꽣 ?녿뒗 ?꾩껜 議고쉶留?
    if not skip_cache and not asset_type:
        cached = await get_cached_portfolio(user_id)
        if cached:
            cached["source"] = "cache"
            return cached

    assets = get_assets_collection()

    # FX rates (KRW base)
    try:
        usd_to_krw = await get_exchange_rate("USD", "KRW")
    except Exception as e:
        logger.warning("FX rate lookup failed (USD->KRW): %s", e)
        usd_to_krw = 1.0

    query = {"user_id": current_user.id}
    if asset_type:
        query["asset_type"] = asset_type

    try:
        cursor = assets.find(query)
        docs = await cursor.to_list(length=100)

        # ?ㅼ떆媛??쒖꽭 議고쉶瑜??꾪븳 鍮꾨룞湲??묒뾽 ?앹꽦
        tasks = []
        task_meta = []
        for doc in docs:
            # ... (omitted for brevity in replacement but kept in file)
            symbol = doc["symbol"]
            asset_type = doc["asset_type"]
            if asset_type == "stock":
                currency = (doc.get("currency") or "KRW").upper()
                if symbol in {"USD", "KRW", "JPY"}:
                    tasks.append(get_exchange_rate(symbol, "KRW"))
                    task_meta.append({"kind": "fx", "symbol": symbol})
                elif currency == "USD" or (not symbol.isdigit()):
                    tasks.append(kis_client.get_current_price(symbol, market="US"))
                    task_meta.append({"kind": "stock_usd"})
                else:
                    tasks.append(kis_client.get_current_price(symbol, market="KR"))
                    task_meta.append({"kind": "stock_kr"})
            elif asset_type == "crypto":
                tasks.append(crypto_client.get_current_price(symbol))
                task_meta.append({"kind": "crypto"})
            else:
                tasks.append(asyncio.sleep(0, result=None))
                task_meta.append({"kind": "other"})

        # ?쒖꽭 ?숈떆 議고쉶
        prices = await asyncio.gather(*tasks, return_exceptions=True)

        result = []
        update_ops = []
        now = datetime.utcnow()
        for i, doc in enumerate(docs):
            price_data = prices[i]
            current_price = doc.get("current_price", doc["average_price"])
            avg_price = doc["average_price"]
            original_currency = (doc.get("currency") or "KRW").upper()
            display_currency = original_currency
            meta = task_meta[i] if i < len(task_meta) else {"kind": "other"}

            if (
                price_data
                and not isinstance(price_data, Exception)
                and isinstance(price_data, dict)
                and "price" in price_data
            ):
                current_price = price_data["price"]

            # FX cash (USD/JPY/KRW) -> KRW base
            if meta.get("kind") == "fx":
                if price_data and not isinstance(price_data, Exception):
                    current_price = float(price_data)
                display_currency = "KRW"

            # USD assets -> convert to KRW for display/analysis
            if original_currency == "USD" and meta.get("kind") in {"stock_usd"}:
                # Heuristic: if avg_price is very large, assume it's already KRW
                avg_is_krw = avg_price >= 10000
                if not avg_is_krw:
                    avg_price = avg_price * usd_to_krw
                current_price = current_price * usd_to_krw
                display_currency = "KRW"

            # Update DB only for non-converted assets
            if (
                price_data
                and not isinstance(price_data, Exception)
                and isinstance(price_data, dict)
                and "price" in price_data
                and display_currency == original_currency
            ):
                update_ops.append(
                    UpdateOne(
                        {"_id": doc["_id"]},
                        {"$set": {"current_price": current_price, "updated_at": now}},
                    )
                )

            quantity = doc["quantity"]

            profit = (current_price - avg_price) * quantity
            profit_percent = (
                ((current_price - avg_price) / avg_price * 100) if avg_price > 0 else 0
            )

            result.append(
                AssetResponse(
                    id=str(doc["_id"]),
                    symbol=doc["symbol"],
                    name=doc["name"],
                    asset_type=doc["asset_type"],
                    quantity=quantity,
                    average_price=avg_price,
                    current_price=current_price,
                    profit=profit,
                    profit_percent=profit_percent,
                    currency=display_currency,
                    memo=doc.get("memo"),
                    buy_reason=doc.get("buy_reason"),
                    ai_analysis=doc.get("ai_analysis"),
                    created_at=doc["created_at"],
                    updated_at=doc["updated_at"],
                )
            )

        # DB?癒?퐣 current_price ??낅쑓??꾨뱜 (揶쎛?館釉?野껋럩??
        if update_ops:
            try:
                await assets.bulk_write(update_ops, ordered=False)
            except Exception as e:
                logger.warning("Failed to update current_price: %s", e)

        # 寃곌낵 罹먯떛 (asset_type ?꾪꽣 ?녿뒗 ?꾩껜 議고쉶留?
        response_data = {"assets": result, "total": len(result), "source": "db"}
        if not asset_type:
            await cache_portfolio(
                user_id,
                {"assets": [a.model_dump() for a in result], "total": len(result)},
            )

        return response_data

    except Exception as e:
        logger.error("list_assets failed: %s", e)
        raise HTTPException(
            status_code=500, detail="자산 목록 조회 중 오류가 발생했습니다"
        )


@router.post("", response_model=AssetResponse)
async def create_asset(
    asset: AssetCreate, current_user: UserResponse = Depends(get_current_user)
):
    user_id = current_user.id
    """
    Asset Registration
    """
    assets = get_assets_collection()
    now = datetime.utcnow()
    asset_doc = {
        "user_id": user_id,  # ?몄쬆??ID ?ъ슜
        "symbol": asset.symbol.upper(),
        "name": asset.name,
        "asset_type": asset.asset_type,
        "quantity": asset.quantity,
        "average_price": asset.average_price,
        "current_price": asset.average_price,  # 珥덇린媛?
        "currency": asset.currency,
        "memo": asset.memo,
        "buy_reason": asset.buy_reason,
        "ai_analysis": None,  # 珥덇린?앹꽦?쒖뿏 鍮꾩뼱?덉쓬 (鍮꾨룞湲곕줈 梨꾩슦嫄곕굹 蹂꾨룄 ?붿껌)
        "created_at": now,
        "updated_at": now,
    }

    result = await assets.insert_one(asset_doc)

    # 罹먯떆 臾댄슚??
    await invalidate_portfolio_cache(user_id)

    return AssetResponse(
        id=str(result.inserted_id),
        symbol=asset_doc["symbol"],
        name=asset_doc["name"],
        asset_type=asset_doc["asset_type"],
        quantity=asset_doc["quantity"],
        average_price=asset_doc["average_price"],
        current_price=asset_doc["current_price"],
        profit=0,
        profit_percent=0,
        currency=asset_doc["currency"],
        memo=asset_doc.get("memo"),
        buy_reason=asset_doc.get("buy_reason"),
        ai_analysis=None,
        created_at=now,
        updated_at=now,
    )


@router.post("/{asset_id}/sell")
async def sell_asset(
    asset_id: str,
    sell_data: SellRequest,
    current_user: UserResponse = Depends(get_current_user),
):
    user_id = str(current_user.id)
    """
    자산 매도

    - 매도 수량만큼 자산 차감
    - 실현손익 계산
    - Transaction 기록 생성
    """
    assets = get_assets_collection()
    db = get_database()
    transactions = db["transactions"]

    # 1. 자산 조회 및 수량 차감 (Atomic)
    now = datetime.utcnow()
    if sell_data.quantity <= 0:
        raise HTTPException(status_code=400, detail="판매 수량은 0보다 커야 합니다")

    try:
        # find_one_and_update (atomic)
        updated_asset = await assets.find_one_and_update(
            {
                "_id": ObjectId(asset_id),
                "user_id": user_id,
                "quantity": {"$gte": sell_data.quantity},
            },
            {
                "$inc": {"quantity": -sell_data.quantity},
                "$set": {"updated_at": now},
            },
            return_document=ReturnDocument.AFTER,
        )
    except Exception:
        raise HTTPException(status_code=400, detail="유효하지 않은 자산 ID입니다")

    if not updated_asset:
        # Check if asset exists at all
        existing = await assets.find_one(
            {"_id": ObjectId(asset_id), "user_id": user_id}
        )
        if not existing:
            raise HTTPException(status_code=404, detail="자산을 찾을 수 없습니다")
        raise HTTPException(status_code=400, detail="보유 수량이 부족합니다")

    new_quantity = float(updated_asset.get("quantity", 0))
    if new_quantity <= 1e-12:
        await assets.delete_one(
            {
                "_id": ObjectId(asset_id),
                "user_id": user_id,
                "quantity": {"$lte": 1e-12},
            }
        )
        new_quantity = 0.0
        message = "전량 매도 완료 (자산 삭제)"
    else:
        message = "매도 완료"

    # 3. 실현손익 계산
    average_price = updated_asset["average_price"]
    realized_profit = (sell_data.sell_price - average_price) * sell_data.quantity
    profit_rate = (
        ((sell_data.sell_price - average_price) / average_price * 100)
        if average_price > 0
        else 0
    )

    transaction_doc = {
        "user_id": current_user.id,
        "asset_id": asset_id,
        "symbol": updated_asset["symbol"],
        "name": updated_asset["name"],
        "transaction_type": "sell",
        "quantity": sell_data.quantity,
        "price": sell_data.sell_price,
        "total_amount": sell_data.sell_price * sell_data.quantity,
        "buy_reason": None,
        "sell_reason": sell_data.sell_reason,
        "realized_profit": realized_profit,
        "memo": sell_data.memo,
        "transaction_date": sell_data.sell_date,
        "created_at": now,
    }

    transaction_result = await transactions.insert_one(transaction_doc)

    await invalidate_portfolio_cache(user_id)

    return {
        "message": message,
        "sold_quantity": sell_data.quantity,
        "remaining_quantity": updated_asset["quantity"],
        "realized_profit": realized_profit,
        "profit_rate": profit_rate,
        "transaction_id": str(transaction_result.inserted_id),
    }


@router.post("/bulk", response_model=BulkAssetResponse)
async def bulk_create_assets(
    bulk_request: BulkAssetCreate,
    current_user: UserResponse = Depends(get_current_user),
):
    user_id = current_user.id
    assets = get_assets_collection()
    now = datetime.utcnow()
    # user_id = user_id # Query?먯꽌 吏곸젒 諛쏆쓬

    merged_assets: Dict[str, AssetCreateExtended] = {}
    merged_rows: Dict[str, int] = {}

    for index, asset in enumerate(bulk_request.assets):
        symbol = asset.symbol.upper()
        if symbol in merged_assets:
            existing = merged_assets[symbol]
            total_quantity = existing.quantity + asset.quantity
            if total_quantity != 0:
                existing.average_price = (
                    existing.average_price * existing.quantity
                    + asset.average_price * asset.quantity
                ) / total_quantity
            else:
                existing.average_price = 0
            existing.quantity = total_quantity

            if existing.exchange_rate is None and asset.exchange_rate is not None:
                existing.exchange_rate = asset.exchange_rate
        else:
            if asset.symbol != symbol:
                asset.symbol = symbol
            merged_assets[symbol] = asset
            merged_rows[symbol] = index

    failures = []
    operations = []
    operation_meta = []

    for symbol, asset_data in merged_assets.items():
        row_index = merged_rows.get(symbol)
        try:
            currency = (asset_data.currency or "KRW").upper()
            asset_data.currency = currency

            exchange_rate = asset_data.exchange_rate
            if currency in {"USD", "JPY"} and exchange_rate is None:
                exchange_rate = await get_exchange_rate(currency, "KRW")
                asset_data.exchange_rate = exchange_rate

            existing = await assets.find_one(
                {"user_id": current_user.id, "symbol": symbol}
            )
            existing_quantity = existing.get("quantity", 0) if existing else 0
            existing_average = existing.get("average_price", 0) if existing else 0

            incoming_quantity = asset_data.quantity
            incoming_average = asset_data.average_price
            total_quantity = existing_quantity + incoming_quantity
            if total_quantity != 0:
                new_average = (
                    existing_average * existing_quantity
                    + incoming_average * incoming_quantity
                ) / total_quantity
            else:
                new_average = 0

            update_fields = {
                "user_id": current_user.id,
                "symbol": symbol,
                "name": asset_data.name,
                "asset_type": asset_data.asset_type,
                "quantity": total_quantity,
                "average_price": new_average,
                "currency": currency,
                "updated_at": now,
            }

            optional_fields = [
                "exchange_rate",
                "transaction_type",
                "transaction_date",
                "account_name",
                "memo",
                "buy_reason",
            ]
            for field in optional_fields:
                value = getattr(asset_data, field)
                if value is not None:
                    update_fields[field] = value

            update_doc = {
                "$set": update_fields,
                "$setOnInsert": {
                    "created_at": now,
                    "current_price": new_average,
                },
            }

            operations.append(
                UpdateOne(
                    {"user_id": current_user.id, "symbol": symbol},
                    update_doc,
                    upsert=True,
                )
            )
            operation_meta.append({"row": row_index, "symbol": symbol})
        except Exception as exc:
            failures.append({"row": row_index, "symbol": symbol, "error": str(exc)})

    created_ids = []
    success_count = len(operations)

    if operations:
        try:
            result = await assets.bulk_write(operations, ordered=False)
            if result.upserted_ids:
                created_ids = [str(_id) for _id in result.upserted_ids.values()]
        except BulkWriteError as exc:
            write_errors = exc.details.get("writeErrors", []) if exc.details else []
            for error in write_errors:
                error_index = error.get("index")
                meta = (
                    operation_meta[error_index]
                    if error_index is not None and error_index < len(operation_meta)
                    else {"row": None, "symbol": None}
                )
                failures.append(
                    {
                        "row": meta["row"],
                        "symbol": meta["symbol"],
                        "error": error.get("errmsg", str(exc)),
                    }
                )
            upserted = exc.details.get("upserted", []) if exc.details else []
            created_ids = [str(item.get("_id")) for item in upserted if item.get("_id")]
            success_count = max(0, success_count - len(write_errors))
        except Exception as exc:
            for meta in operation_meta:
                failures.append(
                    {
                        "row": meta["row"],
                        "symbol": meta["symbol"],
                        "error": str(exc),
                    }
                )
            success_count = 0

    # 罹먯떆 臾댄슚??
    await invalidate_portfolio_cache(user_id)

    return BulkAssetResponse(
        success_count=success_count,
        failure_count=len(failures),
        failures=failures,
        created_ids=created_ids,
    )


@router.put("/{asset_id}", response_model=AssetResponse)
async def update_asset(
    asset_id: str,
    asset: AssetUpdate,
    current_user: UserResponse = Depends(get_current_user),
):
    user_id = current_user.id
    """
    ?먯궛 ?섏젙

    - ?섎웾, ?됯퇏媛 ?낅뜲?댄듃
    """
    assets = get_assets_collection()

    try:
        oid = ObjectId(asset_id)
    except (InvalidId, Exception):
        raise HTTPException(status_code=400, detail="유효하지 않은 자산 ID입니다")

    update_data = {"updated_at": datetime.utcnow()}
    if asset.quantity is not None:
        update_data["quantity"] = asset.quantity
    if asset.average_price is not None:
        update_data["average_price"] = asset.average_price
    if asset.memo is not None:
        update_data["memo"] = asset.memo
    if asset.buy_reason is not None:
        update_data["buy_reason"] = asset.buy_reason
    if asset.ai_analysis is not None:
        update_data["ai_analysis"] = asset.ai_analysis

    result = await assets.find_one_and_update(
        {"_id": oid, "user_id": str(user_id)},
        {"$set": update_data},
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise HTTPException(status_code=404, detail="?먯궛??李얠쓣 ???놁뒿?덈떎")

    # 罹먯떆 臾댄슚??
    await invalidate_portfolio_cache(user_id)

    return AssetResponse(
        id=str(result["_id"]),
        symbol=result["symbol"],
        name=result["name"],
        asset_type=result["asset_type"],
        quantity=result["quantity"],
        average_price=result["average_price"],
        current_price=result.get("current_price"),
        currency=result.get("currency", "KRW"),
        memo=result.get("memo"),
        buy_reason=result.get("buy_reason"),
        ai_analysis=result.get("ai_analysis"),
        created_at=result["created_at"],
        updated_at=result["updated_at"],
    )


@router.delete("/{asset_id}")
async def delete_asset(
    asset_id: str, current_user: UserResponse = Depends(get_current_user)
):
    user_id = current_user.id
    """
    ?먯궛 ??젣
    """
    assets = get_assets_collection()

    try:
        oid = ObjectId(asset_id)
    except (InvalidId, Exception):
        raise HTTPException(status_code=400, detail="유효하지 않은 자산 ID입니다")

    try:
        result = await assets.delete_one({"_id": oid, "user_id": str(user_id)})

        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="?먯궛??李얠쓣 ???놁뒿?덈떎")

        # 罹먯떆 臾댄슚??
        await invalidate_portfolio_cache(user_id)

        return {"message": "자산이 삭제되었습니다"}
    except Exception as e:
        logger.error("delete_asset failed: %s", e)
        raise HTTPException(status_code=500, detail="자산 삭제 중 오류가 발생했습니다")
