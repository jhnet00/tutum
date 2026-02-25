import asyncio
import os
import sys
from minio import Minio
from minio.error import S3Error

# Add parent directory to path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__))))

from app.config import get_settings


async def setup_minio():
    settings = get_settings()
    print("--- MinIO Setup & Diagnostic ---")
    print(f"Endpoint: {settings.MINIO_ENDPOINT}")
    print(f"Access Key: {settings.MINIO_ACCESS_KEY}")

    client = Minio(
        endpoint=settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=settings.MINIO_SECURE,
    )

    buckets = ["ocr-images", "profile-images"]

    try:
        # Check connection
        if not client.bucket_exists("health-check-bucket"):
            # We don't necessarily need to create it, just checking if we can call bucket_exists
            print("✅ Connection to MinIO successful.")

        for bucket_name in buckets:
            if not client.bucket_exists(bucket_name):
                print(f"Creating bucket: {bucket_name}...")
                client.make_bucket(bucket_name)
                print(f"✅ Created bucket: {bucket_name}")
            else:
                print(f"✅ Bucket already exists: {bucket_name}")

        # List all buckets
        all_buckets = client.list_buckets()
        print("\nAll Buckets:")
        for b in all_buckets:
            print(f"- {b.name}")

    except S3Error as e:
        print(f"❌ MinIO S3Error: {e}")
    except Exception as e:
        print(f"❌ Error: {e}")


if __name__ == "__main__":
    asyncio.run(setup_minio())
