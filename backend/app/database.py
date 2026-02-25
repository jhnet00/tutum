"""MongoDB connection helpers."""

import logging

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from .config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

client: AsyncIOMotorClient | None = None
database: AsyncIOMotorDatabase | None = None


async def connect_to_mongodb():
    """Initialize MongoDB connection."""
    global client, database

    try:
        # Keep startup resilient with short server selection timeout.
        client = AsyncIOMotorClient(settings.MONGODB_URL, serverSelectionTimeoutMS=2000)
        await client.admin.command("ping")
        database = client[settings.MONGODB_DB_NAME]
        logger.info("Connected to MongoDB")
    except Exception as e:
        logger.warning("MongoDB connection failed: %s", e)
        database = None


async def close_mongodb_connection():
    """Close MongoDB connection."""
    global client

    if client:
        client.close()
        logger.info("MongoDB connection closed")


def get_database() -> AsyncIOMotorDatabase | None:
    """Return MongoDB database instance."""
    return database


def get_assets_collection():
    """Return assets collection."""
    if database is None:
        return None
    return database["assets"]


def get_news_collection():
    """Return news collection."""
    if database is None:
        return None
    return database["news"]


def get_db():
    """Alias for get_database."""
    return database
