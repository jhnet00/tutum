"""
============================================
Storage Service (MinIO/S3)
============================================

S3-compatible object storage service using MinIO.
Supports presigned URLs for secure file upload/download.
Easily migrates to AWS S3 by changing endpoint configuration.
"""

import os
from datetime import timedelta
from typing import BinaryIO, Optional
from minio import Minio
from minio.error import S3Error
import urllib3
from app.config import get_settings

settings = get_settings()


class StorageService:
    """
    S3-compatible storage service abstraction.

    Supports MinIO (local/on-premise) and AWS S3 (cloud).
    Uses presigned URLs for secure temporary access.
    """

    def __init__(self):
        """Initialize MinIO client with configuration from settings."""
        # Custom HTTP client with short timeout (3 seconds)
        http_client = urllib3.PoolManager(
            timeout=urllib3.Timeout(connect=3.0, read=3.0),
            retries=False,
            cert_reqs="CERT_NONE" if not settings.MINIO_SECURE else "CERT_REQUIRED",
        )

        self.client = Minio(
            endpoint=settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_SECURE,  # Use HTTPS if True
            http_client=http_client,
        )

        # Bucket names
        self.ocr_bucket = "ocr-images"
        self.profile_bucket = "profile-images"

        # Ensure buckets exist
        self._ensure_buckets()

    def _ensure_buckets(self):
        """Create buckets if they don't exist."""
        for bucket_name in [self.ocr_bucket, self.profile_bucket]:
            try:
                if not self.client.bucket_exists(bucket_name):
                    self.client.make_bucket(bucket_name)
                    print(f"✅ Created bucket: {bucket_name}")
            except S3Error as e:
                print(f"❌ Error ensuring bucket {bucket_name}: {e}")

    async def upload_file(
        self,
        file: BinaryIO,
        filename: str,
        bucket: str,
        content_type: Optional[str] = None,
    ) -> dict:
        """
        Upload file to specified bucket.

        Args:
            file: File-like object (binary mode)
            filename: Destination filename in bucket
            bucket: Bucket name ('ocr-images' or 'profile-images')
            content_type: MIME type (e.g., 'image/jpeg')

        Returns:
            dict with 'url', 'bucket', 'filename'

        Raises:
            S3Error: If upload fails
        """
        try:
            # Get file size
            file.seek(0, os.SEEK_END)
            file_size = file.tell()
            file.seek(0)

            # Upload file
            self.client.put_object(
                bucket_name=bucket,
                object_name=filename,
                data=file,
                length=file_size,
                content_type=content_type or "application/octet-stream",
            )

            # Generate presigned URL (valid for 7 days)
            url = self.get_presigned_url(bucket, filename, expires=timedelta(days=7))

            return {
                "url": url,
                "bucket": bucket,
                "filename": filename,
                "size": file_size,
            }

        except S3Error as e:
            raise Exception(f"Failed to upload file: {e}")

    def get_presigned_url(
        self, bucket: str, filename: str, expires: timedelta = timedelta(hours=1)
    ) -> str:
        """
        Generate presigned URL for temporary file access.

        Args:
            bucket: Bucket name
            filename: Object name in bucket
            expires: URL expiration time (default: 1 hour)

        Returns:
            Presigned URL string
        """
        try:
            url = self.client.presigned_get_object(
                bucket_name=bucket, object_name=filename, expires=expires
            )
            return url
        except S3Error as e:
            raise Exception(f"Failed to generate presigned URL: {e}")

    async def delete_file(self, bucket: str, filename: str) -> bool:
        """
        Delete file from bucket.

        Args:
            bucket: Bucket name
            filename: Object name to delete

        Returns:
            True if successful
        """
        try:
            self.client.remove_object(bucket_name=bucket, object_name=filename)
            return True
        except S3Error as e:
            print(f"❌ Failed to delete {filename} from {bucket}: {e}")
            return False

    def list_files(self, bucket: str, prefix: str = "") -> list:
        """
        List files in bucket with optional prefix filter.

        Args:
            bucket: Bucket name
            prefix: Filter by prefix (e.g., 'user123/')

        Returns:
            List of object names
        """
        try:
            objects = self.client.list_objects(bucket_name=bucket, prefix=prefix)
            return [obj.object_name for obj in objects]
        except S3Error as e:
            print(f"❌ Failed to list files in {bucket}: {e}")
            return []


# Singleton instance
_storage_service: Optional[StorageService] = None


def get_storage_service() -> StorageService:
    """Get or create singleton StorageService instance."""
    global _storage_service
    if _storage_service is None:
        _storage_service = StorageService()
    return _storage_service
