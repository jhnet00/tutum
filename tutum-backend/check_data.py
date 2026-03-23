"""Compare our API data with real market data"""
import json, urllib.request

API = "http://localhost:8000/api/v1/market"

def fetch(url):
    with urllib.request.urlopen(url) as r:
        return json.loads(r.read())

# 1. Samsung Electronics (005930) daily
print("=" * 60)
print("1. Samsung Electronics (005930) - Daily")
d = fetch(f"{API}/history/stock/005930?timeframe=D&count=200")
h = d["history"]
print(f"   Total: {len(h)} items, Range: {h[0]['date']} ~ {h[-1]['date']}")
print(f"   Last close: {h[-1]['close']:,.0f} KRW")
for item in h[-3:]:
    print(f"   {item['date']}: O={item['open']:,.0f} H={item['high']:,.0f} L={item['low']:,.0f} C={item['close']:,.0f}")

# 2. NVDA daily
print("\n" + "=" * 60)
print("2. NVIDIA (NVDA) - Daily (USD)")
d = fetch(f"{API}/history/stock/NVDA?timeframe=D&count=200")
h = d["history"]
is_mock = d.get("mock", False)
print(f"   Mock: {is_mock}, Total: {len(h)} items")
if h:
    print(f"   Range: {h[0]['date']} ~ {h[-1]['date']}")
    print(f"   Last close: ${h[-1]['close']:.2f}")
    for item in h[-3:]:
        print(f"   {item['date']}: O={item['open']:.2f} H={item['high']:.2f} L={item['low']:.2f} C={item['close']:.2f}")

# 3. BTC daily
print("\n" + "=" * 60)
print("3. Bitcoin (KRW-BTC) - Daily")
d = fetch(f"{API}/history/crypto/KRW-BTC?timeframe=D&count=200")
h = d["history"]
print(f"   Total: {len(h)} items, Range: {h[0]['date'][:10]} ~ {h[-1]['date'][:10]}")
print(f"   Last close: {h[-1]['close']:,.0f} KRW")
for item in h[-3:]:
    print(f"   {item['date'][:16]}: O={item['open']:,.0f} H={item['high']:,.0f} L={item['low']:,.0f} C={item['close']:,.0f}")

# 4. Samsung weekly
print("\n" + "=" * 60)
print("4. Samsung Electronics (005930) - Weekly")
d = fetch(f"{API}/history/stock/005930?timeframe=W&count=200")
h = d["history"]
print(f"   Total: {len(h)} items, Range: {h[0]['date']} ~ {h[-1]['date']}")
for item in h[-3:]:
    print(f"   {item['date']}: O={item['open']:,.0f} H={item['high']:,.0f} L={item['low']:,.0f} C={item['close']:,.0f}")

# 5. Samsung monthly
print("\n" + "=" * 60)
print("5. Samsung Electronics (005930) - Monthly")
d = fetch(f"{API}/history/stock/005930?timeframe=M&count=200")
h = d["history"]
print(f"   Total: {len(h)} items, Range: {h[0]['date']} ~ {h[-1]['date']}")
for item in h[-3:]:
    print(f"   {item['date']}: O={item['open']:,.0f} H={item['high']:,.0f} L={item['low']:,.0f} C={item['close']:,.0f}")

# 6. NVDA weekly
print("\n" + "=" * 60)
print("6. NVIDIA (NVDA) - Weekly")
d = fetch(f"{API}/history/stock/NVDA?timeframe=W&count=200")
h = d["history"]
is_mock = d.get("mock", False)
print(f"   Mock: {is_mock}, Total: {len(h)} items")
if h:
    print(f"   Range: {h[0]['date']} ~ {h[-1]['date']}")
    for item in h[-3:]:
        print(f"   {item['date']}: O={item['open']:.2f} H={item['high']:.2f} L={item['low']:.2f} C={item['close']:.2f}")

# 7. BTC 1-minute (crypto)
print("\n" + "=" * 60)
print("7. Bitcoin (KRW-BTC) - 1 Minute")
d = fetch(f"{API}/history/crypto/KRW-BTC?timeframe=1&count=10")
h = d["history"]
print(f"   Total: {len(h)} items")
for item in h[-5:]:
    print(f"   {item['date']}: O={item['open']:,.0f} C={item['close']:,.0f}")

# 8. BTC 1-hour
print("\n" + "=" * 60)
print("8. Bitcoin (KRW-BTC) - 1 Hour")
d = fetch(f"{API}/history/crypto/KRW-BTC?timeframe=60&count=10")
h = d["history"]
print(f"   Total: {len(h)} items")
for item in h[-5:]:
    print(f"   {item['date']}: O={item['open']:,.0f} C={item['close']:,.0f}")

# 9. Current prices for comparison
print("\n" + "=" * 60)
print("9. Current Prices (for cross-check)")
d = fetch(f"{API}/price/domestic/005930")
print(f"   Samsung: {d}")
d = fetch(f"{API}/prices/crypto?tickers=BTC")
print(f"   BTC: {d}")
