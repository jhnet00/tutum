"""
MongoDB Migration Script: Add new fields to existing assets
- buy_reason
- memo
- ai_analysis
"""

import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

MONGODB_URL = os.getenv("MONGODB_URL")


async def migrate():
    """Add new fields to all existing asset documents"""

    client = AsyncIOMotorClient(MONGODB_URL)
    db = client["tutum"]
    assets_collection = db["assets"]

    print("🔄 Starting migration...")

    # Update all documents that don't have the new fields
    result = await assets_collection.update_many(
        {
            # Only update documents missing at least one of the new fields
            "$or": [
                {"buy_reason": {"$exists": False}},
                {"memo": {"$exists": False}},
                {"ai_analysis": {"$exists": False}},
            ]
        },
        {
            "$set": {
                "buy_reason": None,
                "memo": None,
                "ai_analysis": None,
                "updated_at": datetime.utcnow(),
            }
        },
    )

    print(f"✅ Migration complete!")
    print(f"   - Matched: {result.matched_count} documents")
    print(f"   - Modified: {result.modified_count} documents")

    # Show sample of updated documents
    sample = await assets_collection.find_one({"buy_reason": {"$exists": True}})
    if sample:
        print(f"\n📄 Sample document structure:")
        print(f"   - symbol: {sample.get('symbol')}")
        print(f"   - buy_reason: {sample.get('buy_reason')}")
        print(f"   - memo: {sample.get('memo')}")
        print(f"   - ai_analysis: {sample.get('ai_analysis')}")

    client.close()


if __name__ == "__main__":
    asyncio.run(migrate())
