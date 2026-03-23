import httpx
import asyncio
import time


async def test_registration():
    url = "http://localhost:8000/api/v1/auth/register"
    payload = {
        "email": f"testuser_{int(time.time())}@example.com",
        "password": "Password123!",
        "nickname": "TestUser",
        "marketing_opt_in": False,
    }

    print(f"Sending registration request to {url}...")
    start_time = time.time()

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.post(url, json=payload)
            duration = time.time() - start_time
            print(f"Status Code: {response.status_code}")
            print(f"Response Body: {response.text}")
            print(f"Request took {duration:.2f} seconds")
        except Exception as e:
            print(f"[FAIL] Request failed: {e}")


if __name__ == "__main__":
    asyncio.run(test_registration())
