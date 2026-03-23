import asyncio
import os
import sys
import httpx
from datetime import datetime

# Add app directory to sys.path
sys.path.append(os.getcwd())

from app.config import get_settings
from app.services.market_data import KISClient


async def test_kis():
    settings = get_settings()
    print(
        f"KIS_APP_KEY: {settings.KIS_APP_KEY[:5] if settings.KIS_APP_KEY else 'EMPTY'}..."
    )
    print(f"KIS_MODE: {settings.KIS_MODE}")

    client = KISClient()
    try:
        token = await client._get_access_token()
        print(f"[OK] Token obtained: {token[:10] if token else 'NONE'}...")
    except Exception as e:
        print(f"[FAIL] Failed to get token: {e}")


if __name__ == "__main__":
    asyncio.run(test_kis())
