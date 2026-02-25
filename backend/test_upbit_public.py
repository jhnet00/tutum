import asyncio
import httpx
import os
from dotenv import load_dotenv

load_dotenv()

async def test_upbit_public():
    print("--- Upbit Public API Test ---")
    url = "https://api.upbit.com/v1/market/all"
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.get(url)
            res.raise_for_status()
            data = res.json()
            print(f"Success! Found {len(data)} markets.")
            print(f"First market: {data[0]}")
        except Exception as e:
            print(f"Upbit Public API Error: {e}")

async def test_upbit_ticker_public():
    print("\n--- Upbit Public Ticker Test ---")
    url = "https://api.upbit.com/v1/ticker?markets=KRW-BTC"
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.get(url)
            res.raise_for_status()
            data = res.json()
            print(f"BTC Price: {data[0]['trade_price']}")
        except Exception as e:
            print(f"Upbit Ticker Error: {e}")

async def main():
    await test_upbit_public()
    await test_upbit_ticker_public()

if __name__ == "__main__":
    asyncio.run(main())
