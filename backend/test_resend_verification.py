"""
Test Resend Verification Email
Tests: POST /auth/resend-verification
"""

import requests
import json

BASE_URL = "http://localhost:8000/api/v1"

# Test email (already registered)
test_email = "rubyjeenkim@gmail.com"

print("=" * 60)
print("Testing Resend Verification Email")
print("=" * 60)

print(f"\n📧 Testing POST /auth/resend-verification...")
print(f"   Email: {test_email} (SES Verified ✅)")

try:
    response = requests.post(
        f"{BASE_URL}/auth/resend-verification",
        json=test_email,  # EmailStr in body
        headers={"Content-Type": "application/json"},
    )

    print(f"\n✅ Status Code: {response.status_code}")

    if response.status_code == 200:
        data = response.json()
        print(f"📨 {data.get('message')}")
        print(f"📬 Email: {data.get('email')}")
        print("\n🎉 Verification email resent!")
        print("📧 Check your email (rubyjeenkim@gmail.com) in a few seconds!")
        print("\n⏳ Check email worker logs for confirmation...")
    elif response.status_code == 400:
        print(f"⚠️  {response.json().get('detail')}")
        print("\n💡 User might already be verified")
    elif response.status_code == 404:
        print(f"❌ {response.json().get('detail')}")
    else:
        print(f"❌ Request failed")
        print(f"Response: {response.text}")

except Exception as e:
    print(f"❌ Error: {e}")

print("\n" + "=" * 60)
