
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient

async def inspect_news():
    client = AsyncIOMotorClient("mongodb://localhost:27017")
    db = client["tutum"]
    collection = db["news"]
    
    # Try finding one document to see schema
    doc = await collection.find_one()
    print("Document Sample:", doc)
    
    # Check if there's data in 'clouddx' db as well just in case
    db2 = client["clouddx"]
    col2 = db2["news"]
    doc2 = await col2.find_one()
    print("clouddx sample:", doc2)

if __name__ == "__main__":
    asyncio.run(inspect_news())
