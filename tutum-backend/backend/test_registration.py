"""
Test Email Verification Registration Flow - Verified Email
Tests with SES verified email: rubyjeenkim@gmail.com
"""

import requests
import json

BASE_URL = "http://localhost:8000/api/v1"

# Test data - using SES verified email
test_user = {
    "email": "rubyjeenkim@gmail.com",
    "password": "TestPassword123!",
    "nickname": "Ruby Test User",
    "marketing_opt_in": True,
}

print("=" * 60)
print("Testing Email Verification - Full Flow")
print("=" * 60)

# 1. Register new user
print("\n1️⃣ Testing POST /auth/register...")
print(f"   Email: {test_user['email']} (SES Verified ✅)")
print(f"   Nickname: {test_user['nickname']}")

try:
    response = requests.post(
        f"{BASE_URL}/auth/register",
        json=test_user,
        headers={"Content-Type": "application/json"},
    )

    print(f"\n✅ Status Code: {response.status_code}")

    if response.status_code == 200:
        data = response.json()
        print(f"📧 {data.get('message')}")
        print(f"📬 Email: {data.get('email')}")
        print(f"🔐 Verification Required: {data.get('verification_required')}")
        print("\n🎉 Registration successful!")
        print("\n⏳ Wait a few seconds for the email worker to process...")
        print("📨 Check your email (rubyjeenkim@gmail.com) for verification link!")
    elif response.status_code == 400:
        # Email already registered
        print(f"⚠️  Email already registered")
        print(f"Response: {response.text}")
        print("\n💡 To test again, either:")
        print("   1. Use /resend-verification endpoint")
        print("   2. Delete user from MongoDB and re-register")
    else:
        print(f"❌ Registration failed")
        print(f"Response: {response.text}")

except Exception as e:
    print(f"❌ Error: {e}")

print("\n" + "=" * 60)
print("Expected Flow:")
print("1. ✅ User registered with is_verified=False")
print("2. ✅ Verification token generated and hashed")
print("3. ✅ Token stored in email_verification_tokens collection")
print("4. ✅ Email task enqueued to SQS")
print("5. ⏳ Worker picks up message from SQS")
print("6. ⏳ Worker sends verification email via SES")
print("7. ⏳ Check email and click verification link")
print("8. ⏳ GET /auth/verify?token=... activates account")
print("=" * 60)
