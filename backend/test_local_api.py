import httpx
import asyncio


async def test_local_api():
    async with httpx.AsyncClient() as client:
        try:
            print("Testing domestic stock price...")
            res1 = await client.get(
                "http://localhost:8000/api/v1/market/price/domestic/005930"
            )
            print(f"Domestic Status: {res1.status_code}")
            print(f"Domestic Body: {res1.text[:200]}...")

            print("\nTesting crypto price...")
            res2 = await client.get(
                "http://localhost:8000/api/v1/market/price/crypto/KRW-BTC"
            )
            print(f"Crypto Status: {res2.status_code}")
            print(f"Crypto Body: {res2.text[:200]}...")
        except Exception as e:
            print(f"[FAIL] Connection Error: {e}")


if __name__ == "__main__":
    asyncio.run(test_local_api())
