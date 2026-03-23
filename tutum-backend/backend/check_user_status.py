"""
Check User Verification Status
Checks if user account was successfully verified in MongoDB
"""

import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import os

# Load env
load_dotenv()

# MongoDB connection
MONGODB_URL = os.getenv("MONGODB_URL")
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "clouddx")


async def check_user_status(email: str):
    """Check user verification status in MongoDB"""
    client = AsyncIOMotorClient(MONGODB_URL)
    db = client[MONGODB_DB_NAME]

    users_collection = db["users"]
    tokens_collection = db["email_verification_tokens"]

    print(f"🔍 Checking user: {email}")

    # Find user
    user = await users_collection.find_one({"email": email})

    if not user:
        print(f"❌ User not found: {email}")
        return

    user_id = str(user["_id"])
    print(f"\n✅ User found!")
    print(f"   User ID: {user_id}")
    print(f"   Email: {user.get('email')}")
    print(f"   Nickname: {user.get('nickname')}")
    print(f"   Login Type: {user.get('login_type')}")
    print(f"   Created At: {user.get('created_at')}")

    # Check verification status
    is_verified = user.get("is_verified", False)
    print(
        f"\n{'🎉' if is_verified else '⏳'} Verification Status: {'VERIFIED ✅' if is_verified else 'NOT VERIFIED ❌'}"
    )

    # Check tokens
    tokens = await tokens_collection.find({"user_id": user_id}).to_list(length=10)

    if tokens:
        print(f"\n📧 Verification Tokens ({len(tokens)}):")
        for i, token in enumerate(tokens, 1):
            used = token.get("used_at") is not None
            expired = token.get("expires_at")
            print(f"   {i}. Created: {token.get('created_at')}")
            print(f"      Status: {'USED ✅' if used else 'UNUSED'}")
            print(f"      Used At: {token.get('used_at', 'N/A')}")
    else:
        print(f"\n📧 No verification tokens found")

    client.close()


if __name__ == "__main__":
    # Email to check
    test_email = "rubyjeenkim@gmail.com"

    print("=" * 60)
    print("Check User Verification Status")
    print("=" * 60)
    print()

    asyncio.run(check_user_status(test_email))

    print("\n" + "=" * 60)
