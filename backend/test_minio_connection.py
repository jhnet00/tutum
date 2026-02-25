"""
Test MinIO Connection from Backend
"""

import os
from minio import Minio
from dotenv import load_dotenv

# Load .env
load_dotenv()

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "192.168.0.28:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
MINIO_SECURE = os.getenv("MINIO_SECURE", "False").lower() == "true"

print("=" * 60)
print("Testing MinIO Connection - Node2")
print("=" * 60)
print(f"📡 Endpoint: {MINIO_ENDPOINT}")
print(f"🔐 Access Key: {MINIO_ACCESS_KEY}")

try:
    client = Minio(
        MINIO_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=MINIO_SECURE,
    )

    buckets = client.list_buckets()
    print("\n✅ Connection Successful!")
    print(f"📦 Buckets found ({len(buckets)}):")
    for bucket in buckets:
        print(f"   - {bucket.name} (Created: {bucket.creation_date})")

except Exception as e:
    print(f"\n❌ Connection Failed: {e}")

print("=" * 60)
