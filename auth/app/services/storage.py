"""Storage service for auth profile images.

Uses AWS S3 when ``S3_BUCKET_NAME`` is configured and falls back to MinIO
for legacy and local environments.
"""

from __future__ import annotations

import io
import os
from datetime import timedelta
from typing import BinaryIO, Optional

from app.config import get_settings

settings = get_settings()

_USE_S3 = bool(settings.S3_BUCKET_NAME)

if _USE_S3:
    import boto3
    from botocore.exceptions import ClientError
else:
    import urllib3
    from minio import Minio
    from minio.error import S3Error


class StorageService:
    PROFILE_PREFIX = "profile-images"

    def __init__(self):
        if _USE_S3:
            self._init_s3()
        else:
            self._init_minio()

    def _init_s3(self) -> None:
        self._s3 = boto3.client("s3", region_name=settings.AWS_REGION or "ap-northeast-2")
        self._bucket = settings.S3_BUCKET_NAME

    def _init_minio(self) -> None:
        http_client = urllib3.PoolManager(
            timeout=urllib3.Timeout(connect=3.0, read=3.0),
            retries=False,
            cert_reqs="CERT_NONE" if not settings.MINIO_SECURE else "CERT_REQUIRED",
        )
        self._minio = Minio(
            endpoint=settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_SECURE,
            http_client=http_client,
        )
        if not self._minio.bucket_exists(self.PROFILE_PREFIX):
            self._minio.make_bucket(self.PROFILE_PREFIX)

    def _coerce_stream(self, file_or_bytes: BinaryIO | bytes | bytearray) -> tuple[BinaryIO, int]:
        if isinstance(file_or_bytes, (bytes, bytearray)):
            stream: BinaryIO = io.BytesIO(file_or_bytes)
            return stream, len(file_or_bytes)

        stream = file_or_bytes
        if hasattr(stream, "seek") and hasattr(stream, "tell"):
            stream.seek(0, os.SEEK_END)
            size = stream.tell()
            stream.seek(0)
            return stream, size

        data = stream.read()
        if not isinstance(data, (bytes, bytearray)):
            raise TypeError("storage upload expects bytes or a binary file-like object")
        return io.BytesIO(data), len(data)

    def _s3_key(self, prefix: str, filename: str) -> str:
        return f"{prefix}/{filename}"

    async def upload_file(
        self,
        file: BinaryIO | bytes | bytearray,
        filename: str,
        bucket: str,
        content_type: Optional[str] = None,
    ) -> dict:
        if _USE_S3:
            return await self._upload_s3(file, filename, bucket, content_type)
        return await self._upload_minio(file, filename, bucket, content_type)

    async def _upload_s3(
        self,
        file: BinaryIO | bytes | bytearray,
        filename: str,
        prefix: str,
        content_type: Optional[str],
    ) -> dict:
        stream, file_size = self._coerce_stream(file)
        key = self._s3_key(prefix, filename)
        extra = {"ContentType": content_type or "application/octet-stream"}
        try:
            self._s3.upload_fileobj(stream, self._bucket, key, ExtraArgs=extra)
        except ClientError as exc:
            raise Exception(f"S3 upload failed: {exc}") from exc

        return {
            "url": self.get_presigned_url(prefix, filename),
            "bucket": prefix,
            "filename": filename,
            "size": file_size,
        }

    async def _upload_minio(
        self,
        file: BinaryIO | bytes | bytearray,
        filename: str,
        bucket: str,
        content_type: Optional[str],
    ) -> dict:
        stream, file_size = self._coerce_stream(file)
        try:
            self._minio.put_object(
                bucket_name=bucket,
                object_name=filename,
                data=stream,
                length=file_size,
                content_type=content_type or "application/octet-stream",
            )
        except S3Error as exc:
            raise Exception(f"MinIO upload failed: {exc}") from exc

        return {
            "url": self.get_presigned_url(bucket, filename, expires=timedelta(days=7)),
            "bucket": bucket,
            "filename": filename,
            "size": file_size,
        }

    def get_presigned_url(
        self, bucket: str, filename: str, expires: timedelta = timedelta(hours=1)
    ) -> str:
        if _USE_S3:
            key = self._s3_key(bucket, filename)
            try:
                return self._s3.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": self._bucket, "Key": key},
                    ExpiresIn=int(expires.total_seconds()),
                )
            except ClientError as exc:
                raise Exception(f"S3 presigned URL failed: {exc}") from exc

        try:
            return self._minio.presigned_get_object(
                bucket_name=bucket,
                object_name=filename,
                expires=expires,
            )
        except S3Error as exc:
            raise Exception(f"MinIO presigned URL failed: {exc}") from exc


_storage_service: StorageService | None = None


def get_storage_service() -> StorageService:
    global _storage_service
    if _storage_service is None:
        _storage_service = StorageService()
    return _storage_service
