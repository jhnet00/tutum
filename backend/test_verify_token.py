"""
Test Verify Endpoint Directly
Tests GET /auth/verify with token
"""

import requests

BASE_URL = "http://localhost:8000/api/v1"

# Token from email
token = "4_Atmh_1DK2ths4cYfiqFUz3Mj620Bt9DjmKsVmhZBA"

print("=" * 60)
print("Testing Email Verification - Direct API Call")
print("=" * 60)

print(f"\n🔐 Token: {token[:20]}...")
print(f"📡 Calling GET /auth/verify...")

try:
    response = requests.get(
        f"{BASE_URL}/auth/verify",
        params={"token": token},
        allow_redirects=False,  # Don't follow redirect
    )

    print(f"\n✅ Status Code: {response.status_code}")

    if response.status_code == 307 or response.status_code == 302:
        redirect_url = response.headers.get("Location")
        print(f"🔀 Redirect to: {redirect_url}")
        print("\n🎉 Verification successful!")
        print("   Account should now be activated")
    elif response.status_code == 200:
        print(f"✅ Response: {response.text}")
        print("\n🎉 Verification successful!")
    else:
        print(f"❌ Verification failed")
        print(f"Response: {response.text}")

except Exception as e:
    print(f"❌ Error: {e}")

print("\n" + "=" * 60)
print("Run check_user_status.py to verify account activation")
print("=" * 60)
