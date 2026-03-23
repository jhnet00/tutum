import asyncio
from motor.motor_asyncio import AsyncIOMotorClient


async def check_atlas():
    uri = "mongodb+srv://tutum-admin:clouddx@tutum.odoeunm.mongodb.net/?appName=tutum"
    client = AsyncIOMotorClient(uri)
    try:
        dbs = await client.list_database_names()
        print("Atlas Databases:", dbs)
        for db_name in dbs:
            db = client[db_name]
            collections = await db.list_collection_names()
            print(f"Collections in {db_name}:", collections)
            if "news" in collections:
                count = await db["news"].count_documents({})
                print(f"  -> 'news' count: {count}")
                if count > 0:
                    sample = await db["news"].find_one()
                    print(f"  -> {db_name}.news Sample: {sample}")
    except Exception as e:
        print(f"[FAIL] Error connecting to Atlas: {e}")


if __name__ == "__main__":
    asyncio.run(check_atlas())
