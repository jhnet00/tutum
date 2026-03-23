import asyncio
import httpx
from datetime import datetime
import os
from dotenv import load_dotenv

load_dotenv()

async def test_kis():
    print("--- KIS API Test ---")
    base_url = "https://openapivts.koreainvestment.com:29443" # virtual mode
    app_key = os.getenv("KIS_APP_KEY")
    app_secret = os.getenv("KIS_APP_SECRET")
    
    # 1. Token
    url_token = f"{base_url}/oauth2/tokenP"
    body_token = {
        "grant_type": "client_credentials",
        "appkey": app_key,
        "appsecret": app_secret
    }
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.post(url_token, json=body_token)
            data = res.json()
            token = data.get("access_token")
            print(f"Token: {token[:10]}...")
            
            # 2. Price
            path = "/uapi/domestic-stock/v1/quotations/inquire-price"
            headers = {
                "content-type": "application/json",
                "authorization": f"Bearer {token}",
                "appkey": app_key,
                "appsecret": app_secret,
                "tr_id": "FHKST01010100"
            }
            params = {
                "fid_cond_mrkt_div_code": "J",
                "fid_input_iscd": "005930"
            }
            res_price = await client.get(f"{base_url}{path}", headers=headers, params=params)
            price_data = res_price.json()
            print("KIS Response:", price_data)
        except Exception as e:
            print(f"KIS Error: {e}")

async def test_upbit():
    print("\n--- Upbit API Test ---")
    try:
        import ccxt.async_support as ccxt
        exchange = ccxt.upbit({
            'apiKey': os.getenv("UPBIT_ACCESS_KEY"),
            'secret': os.getenv("UPBIT_SECRET_KEY"),
        })
        ticker = await exchange.fetch_ticker('BTC/KRW')
        print(f"BTC Price: {ticker['last']}")
        await exchange.close()
    except Exception as e:
        print(f"Upbit Error: {e}")

async def main():
    await test_kis()
    await test_upbit()

if __name__ == "__main__":
    asyncio.run(main())
