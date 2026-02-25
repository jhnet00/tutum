
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient

async def list_all():
    client = AsyncIOMotorClient("mongodb://localhost:27017")
    dbs = await client.list_database_names()
    print("Databases:", dbs)
    for db_name in dbs:
        db = client[db_name]
        collections = await db.list_collection_names()
        print(f"Collections in {db_name}:", collections)
        if "news" in collections:
            count = await db["news"].count_documents({})
            print(f"  -> 'news' count: {count}")
            if count > 0:
                sample = await db["news"].find_one()
                print(f"  -> Sample: {sample}")

if __name__ == "__main__":
    asyncio.run(list_all())
