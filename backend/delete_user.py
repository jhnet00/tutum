"""
Delete User from MongoDB
Deletes user and associated verification tokens to allow re-testing
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


async def delete_user(email: str):
    """Delete user and associated tokens from MongoDB"""
    client = AsyncIOMotorClient(MONGODB_URL)
    db = client[MONGODB_DB_NAME]

    users_collection = db["users"]
    tokens_collection = db["email_verification_tokens"]

    print(f"🔍 Looking for user: {email}")

    # Find user
    user = await users_collection.find_one({"email": email})

    if not user:
        print(f"❌ User not found: {email}")
        return

    user_id = str(user["_id"])
    print(f"✅ Found user ID: {user_id}")
    print(f"   Nickname: {user.get('nickname')}")
    print(f"   Login Type: {user.get('login_type')}")
    print(f"   Is Verified: {user.get('is_verified', False)}")

    # Delete user
    delete_user_result = await users_collection.delete_one({"_id": user["_id"]})
    print(f"\n🗑️  Deleted {delete_user_result.deleted_count} user(s)")

    # Delete associated tokens
    delete_tokens_result = await tokens_collection.delete_many({"user_id": user_id})
    print(f"🗑️  Deleted {delete_tokens_result.deleted_count} verification token(s)")

    print(f"\n✅ User {email} and associated data deleted successfully!")

    client.close()


if __name__ == "__main__":
    # Email to delete
    test_email = "rubyjeenkim@gmail.com"

    print("=" * 60)
    print("Delete User from MongoDB")
    print("=" * 60)
    print()

    asyncio.run(delete_user(test_email))

    print("\n" + "=" * 60)
    print("You can now re-register this email for testing")
    print("=" * 60)
