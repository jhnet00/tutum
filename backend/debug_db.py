import asyncio
import logging
from motor.motor_asyncio import AsyncIOMotorClient
from sqlalchemy import create_engine, text
from app.config import get_settings
from urllib.parse import quote_plus

settings = get_settings()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("debug_db")

EMAIL_TO_DELETE = "rubyjeenkim@gmail.com"


async def debug_all():
    logger.info("Starting Comprehensive DB Debug...")

    # 1. MongoDB Deep Inspection
    try:
        mongo_client = AsyncIOMotorClient(settings.MONGODB_URL)
        dbs = await mongo_client.list_database_names()
        logger.info(f"MongoDB Databases found: {dbs}")

        for db_name in dbs:
            db = mongo_client[db_name]
            cols = await db.list_collection_names()
            logger.info(f"DB '{db_name}' Collections: {cols}")
            if "news" in cols:
                count = await db["news"].count_documents({})
                logger.info(f"!!! Found 'news' in {db_name}: {count} documents")
                if count > 0:
                    sample = await db["news"].find_one()
                    logger.info(f"Sample news from {db_name}: {sample}")

            # While we are at it, check for the user to delete in Mongo
            if "users" in cols:
                u_count = await db["users"].count_documents({"email": EMAIL_TO_DELETE})
                if u_count > 0:
                    logger.info(
                        f"Found {u_count} records for {EMAIL_TO_DELETE} in {db_name}.users. Deleting..."
                    )
                    res = await db["users"].delete_many({"email": EMAIL_TO_DELETE})
                    logger.info(f"Deleted {res.deleted_count} records.")

        await mongo_client.close()
    except Exception as e:
        logger.error(f"MongoDB Debug Error: {e}")

    # 2. MariaDB Deep Inspection
    try:
        encoded_pass = quote_plus(settings.MARIADB_PASSWORD)
        db_url = f"mysql+pymysql://{settings.MARIADB_USER}:{encoded_pass}@{settings.MARIADB_HOST}:{settings.MARIADB_PORT}/{settings.MARIADB_DATABASE}"
        engine = create_engine(db_url)

        with engine.connect() as conn:
            # List tables
            tables = conn.execute(text("SHOW TABLES")).fetchall()
            logger.info(f"MariaDB Tables: {[t[0] for t in tables]}")

            if any("news" in t[0] for t in tables):
                # Check for a table that might contain news
                news_table = next(t[0] for t in tables if "news" in t[0])
                n_count = conn.execute(
                    text(f"SELECT COUNT(*) FROM {news_table}")
                ).scalar()
                logger.info(
                    f"Found news-like table '{news_table}' in MariaDB with {n_count} rows."
                )

            # Delete User in MariaDB
            user_res = conn.execute(
                text("SELECT id FROM users WHERE email = :email"),
                {"email": EMAIL_TO_DELETE},
            ).fetchone()
            if user_res:
                user_id = user_res[0]
                logger.info(
                    f"Found user {EMAIL_TO_DELETE} (ID: {user_id}) in MariaDB. Deleting portfolios and user..."
                )
                conn.execute(
                    text("DELETE FROM portfolios WHERE user_id = :uid"),
                    {"uid": user_id},
                )
                conn.execute(
                    text("DELETE FROM users WHERE id = :uid"), {"uid": user_id}
                )
                conn.commit()
                logger.info("MariaDB user and portfolios deleted successfully.")
            else:
                logger.info(f"User {EMAIL_TO_DELETE} not found in MariaDB.")

    except Exception as e:
        logger.error(f"MariaDB Debug Error: {e}")


if __name__ == "__main__":
    asyncio.run(debug_all())
