import asyncio
import logging
from motor.motor_asyncio import AsyncIOMotorClient
from sqlalchemy import create_engine, text
from app.config import get_settings

settings = get_settings()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

EMAIL_TO_DELETE = "rubyjeenkim@gmail.com"


async def cleanup_user():
    # 1. MongoDB Cleanup
    try:
        mongo_client = AsyncIOMotorClient(settings.MONGODB_URL)
        db = mongo_client[settings.MONGODB_DB_NAME]

        # Check 'users' collection (legacy)
        res = await db["users"].delete_many({"email": EMAIL_TO_DELETE})
        logger.info(f"MongoDB 'users' deleted: {res.deleted_count}")

        # Also check 'clouddx' if different
        db_alt = mongo_client["clouddx"]
        res_alt = await db_alt["users"].delete_many({"email": EMAIL_TO_DELETE})
        logger.info(f"MongoDB (alt) 'users' deleted: {res_alt.deleted_count}")

    except Exception as e:
        logger.error(f"MongoDB cleanup error: {e}")

    # 2. MariaDB Cleanup
    try:
        # Construct DB URL
        db_url = f"mysql+pymysql://{settings.MARIADB_USER}:{settings.MARIADB_PASSWORD}@{settings.MARIADB_HOST}:{settings.MARIADB_PORT}/{settings.MARIADB_DATABASE}"
        engine = create_engine(db_url)

        with engine.connect() as conn:
            # Get user id first
            result = conn.execute(
                text("SELECT id FROM users WHERE email = :email"),
                {"email": EMAIL_TO_DELETE},
            ).fetchone()
            if result:
                user_id = result[0]
                # Delete portfolios related to user first (Integrity)
                conn.execute(
                    text("DELETE FROM portfolios WHERE user_id = :uid"),
                    {"uid": user_id},
                )
                # Delete user
                conn.execute(
                    text("DELETE FROM users WHERE id = :uid"), {"uid": user_id}
                )
                conn.commit()
                logger.info(
                    f"MariaDB user {EMAIL_TO_DELETE} (ID: {user_id}) and portfolios deleted."
                )
            else:
                logger.info(f"MariaDB user {EMAIL_TO_DELETE} not found.")

    except Exception as e:
        logger.error(f"MariaDB cleanup error: {e}")


if __name__ == "__main__":
    asyncio.run(cleanup_user())
