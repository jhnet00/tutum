
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import json

async def final_check():
    uri = "mongodb+srv://tutum-admin:clouddx@tutum.odoeunm.mongodb.net/?appName=tutum"
    client = AsyncIOMotorClient(uri)
    col = client['tutum']['news']
    
    print("--- Fetching 5 Latest Documents ---")
    cursor = col.find().sort("published_at", -1).limit(5)
    async for doc in cursor:
        print(f"\n[DOCUMENT ID: {doc['_id']}]")
        print(f"TITLE: {doc.get('title')}")
        # Print all keys to see what's available
        print(f"AVAILABLE KEYS: {list(doc.keys())}")
        # Print first 100 chars of likely body fields
        for field in ['body', 'content', 'description', 'text', 'summary', 'article']:
            val = doc.get(field)
            if val:
                print(f"FIELD '{field}' (len {len(str(val))}): {str(val)[:100]}...")
            else:
                print(f"FIELD '{field}': NOT FOUND OR EMPTY")

if __name__ == "__main__":
    asyncio.run(final_check())
