import asyncio
import os
import sys
from bson import ObjectId

# Add parent directory to path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__))))

from app.database import get_users_collection, get_database, connect_to_mongodb


async def check_user_and_tokens(email):
    print(f"--- Checking for {email} ---")
    await connect_to_mongodb()
    users = get_users_collection()
    user = await users.find_one({"email": email})

    if not user:
        print(f"❌ User with email {email} not found.")
        return

    print(
        f"✅ User found: ID={user['_id']}, Nickname={user.get('nickname')}, Verified={user.get('is_verified')}"
    )

    db = get_database()
    tokens = db["email_verification_tokens"]

    # Find all tokens for this user
    user_tokens = await tokens.find({"user_id": str(user["_id"])}).to_list(length=10)

    if not user_tokens:
        print("❌ No verification tokens found for this user.")
    else:
        print(f"🔍 Found {len(user_tokens)} tokens:")
        for t in user_tokens:
            print(
                f"  - Token Hash: {t.get('token_hash')[:10]}..., Expires: {t.get('expires_at')}, Used: {t.get('used_at')}"
            )


if __name__ == "__main__":
    email = "clouddx.krb@gmail.com"
    if len(sys.argv) > 1:
        email = sys.argv[1]
    asyncio.run(check_user_and_tokens(email))
