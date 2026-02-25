"""Exchange rate API router."""

import logging
from fastapi import APIRouter, Query, HTTPException

from ..services.exchange_rate import get_exchange_rate

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/exchange-rate")
async def get_exchange_rate_api(
    from_currency: str = Query(..., description="Source currency (e.g., USD)"),
    to_currency: str = Query(..., description="Target currency (e.g., KRW)")
):
    """
    환율 조회 API
    
    - from_currency: 원본 통화 (예: USD, JPY, CNY)
    - to_currency: 대상 통화 (예: KRW)
    - 반환: 환율 정보 (1 from_currency = rate to_currency)
    """
    try:
        rate = await get_exchange_rate(from_currency, to_currency)
        return {
            "from": from_currency.upper(),
            "to": to_currency.upper(),
            "rate": rate
        }
    except ValueError as e:
        logger.warning("Invalid exchange rate request: %s -> %s: %s", from_currency, to_currency, e)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Exchange rate lookup failed: %s", e)
        raise HTTPException(status_code=500, detail="환율 조회 중 오류가 발생했습니다")
