import asyncio
import os
import sys
from bson import ObjectId

# Add parent directory to path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__))))

from app.database import get_database, connect_to_mongodb


async def check_user_full(email):
    print(f"--- Full Check for {email} ---")
    await connect_to_mongodb()
    db = get_database()
    users = db["users"]
    user = await users.find_one({"email": email})

    if not user:
        print(f"❌ User {email} not found.")
        return

    user_id_str = str(user["_id"])
    print(f"✅ USER: ID={user_id_str}")
    print(f"   - Nickname: {user.get('nickname')}")
    print(f"   - Login Type: {user.get('login_type')}")
    print(f"   - Verified: {user.get('is_verified')}")
    print(f"   - Created At: {user.get('created_at')}")

    assets_coll = db["assets"]
    # Check both string and ObjectId user_id
    assets_cursor = assets_coll.find({"user_id": user_id_str})
    assets_list = await assets_cursor.to_list(length=100)

    print(f"✅ ASSETS (user_id as string): {len(assets_list)}")
    for a in assets_list:
        print(
            f"   - {a.get('symbol')} ({a.get('asset_type')}): {a.get('quantity')} @ {a.get('average_price')}"
        )

    # Just in case some assets use ObjectId for user_id
    assets_cursor_oid = assets_coll.find({"user_id": user["_id"]})
    assets_list_oid = await assets_cursor_oid.to_list(length=100)
    print(f"✅ ASSETS (user_id as ObjectId): {len(assets_list_oid)}")
    for a in assets_list_oid:
        print(
            f"   - {a.get('symbol')} ({a.get('asset_type')}): {a.get('quantity')} @ {a.get('average_price')}"
        )


if __name__ == "__main__":
    email = "clouddx.krb@gmail.com"
    if len(sys.argv) > 1:
        email = sys.argv[1]
    asyncio.run(check_user_full(email))
