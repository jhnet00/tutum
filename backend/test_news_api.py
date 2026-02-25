import httpx
import asyncio


async def test_news():
    async with httpx.AsyncClient(follow_redirects=True) as client:
        try:
            print("Testing News API...")
            res = await client.get("http://localhost:8000/api/v1/news")
            print(f"Status: {res.status_code}")
            if res.status_code == 200:
                data = res.json()
                print(f"Count: {len(data)}")
                if data:
                    print("First Item Title:", data[0]["title"])
                    print("First Item Keys:", data[0].keys())
                    print("Content Length:", len(data[0].get("content", "")))
                    print("Content Sample:", data[0].get("content", "")[:100])
            else:
                print(f"Error: {res.text}")
        except Exception as e:
            print(f"[FAIL] Connection Error: {e}")


if __name__ == "__main__":
    asyncio.run(test_news())
