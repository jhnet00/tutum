"""
============================================
Storage Service (AWS S3 / MinIO fallback)
============================================

S3_BUCKET_NAME 환경변수가 설정되면 AWS S3 (boto3 + IRSA) 사용.
없으면 MinIO (on-prem / legacy) fallback.

버킷 구조 (S3):
  tutum-prod-storage/
    ocr-images/    ← OCR 결과 이미지
    profile-images/ ← 프로필 이미지
"""

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
    from minio import Minio
    from minio.error import S3Error
    import urllib3


class StorageService:
    """
    Storage service abstraction supporting AWS S3 (IRSA) and MinIO.
    Interface is identical regardless of backend.
    """

    OCR_PREFIX = "ocr-images"
    PROFILE_PREFIX = "profile-images"

    def __init__(self):
        if _USE_S3:
            self._init_s3()
        else:
            self._init_minio()

    # ──────────────────────────────────────────
    # S3 backend (boto3 + IRSA)
    # ──────────────────────────────────────────

    def _init_s3(self):
        self._s3 = boto3.client("s3", region_name=settings.AWS_REGION or "ap-northeast-2")
        self._bucket = settings.S3_BUCKET_NAME
        self.ocr_bucket = self.OCR_PREFIX
        self.profile_bucket = self.PROFILE_PREFIX

    def _s3_key(self, prefix: str, filename: str) -> str:
        return f"{prefix}/{filename}"

    async def upload_file(
        self,
        file: BinaryIO,
        filename: str,
        bucket: str,
        content_type: Optional[str] = None,
    ) -> dict:
        if _USE_S3:
            return await self._upload_s3(file, filename, bucket, content_type)
        return await self._upload_minio(file, filename, bucket, content_type)

    async def _upload_s3(self, file, filename, prefix, content_type):
        key = self._s3_key(prefix, filename)
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        extra = {"ContentType": content_type or "application/octet-stream"}
        try:
            self._s3.upload_fileobj(file, self._bucket, key, ExtraArgs=extra)
        except ClientError as e:
            raise Exception(f"S3 upload failed: {e}")
        url = self.get_presigned_url(prefix, filename)
        return {"url": url, "bucket": prefix, "filename": filename, "size": file_size}

    def get_presigned_url(
        self, bucket: str, filename: str, expires: timedelta = timedelta(hours=1)
    ) -> str:
        if _USE_S3:
            return self._presigned_s3(bucket, filename, expires)
        return self._presigned_minio(bucket, filename, expires)

    def _presigned_s3(self, prefix, filename, expires):
        key = self._s3_key(prefix, filename)
        try:
            return self._s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": key},
                ExpiresIn=int(expires.total_seconds()),
            )
        except ClientError as e:
            raise Exception(f"S3 presigned URL failed: {e}")

    async def delete_file(self, bucket: str, filename: str) -> bool:
        if _USE_S3:
            return self._delete_s3(bucket, filename)
        return await self._delete_minio(bucket, filename)

    def _delete_s3(self, prefix, filename):
        key = self._s3_key(prefix, filename)
        try:
            self._s3.delete_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError as e:
            print(f"S3 delete failed {key}: {e}")
            return False

    def list_files(self, bucket: str, prefix: str = "") -> list:
        if _USE_S3:
            return self._list_s3(bucket, prefix)
        return self._list_minio(bucket, prefix)

    def _list_s3(self, bucket_prefix, prefix):
        s3_prefix = f"{bucket_prefix}/{prefix}" if prefix else f"{bucket_prefix}/"
        try:
            paginator = self._s3.get_paginator("list_objects_v2")
            keys = []
            for page in paginator.paginate(Bucket=self._bucket, Prefix=s3_prefix):
                for obj in page.get("Contents", []):
                    keys.append(obj["Key"][len(f"{bucket_prefix}/"):])
            return keys
        except ClientError as e:
            print(f"S3 list failed {s3_prefix}: {e}")
            return []

    # ──────────────────────────────────────────
    # MinIO backend (legacy fallback)
    # ──────────────────────────────────────────

    def _init_minio(self):
        http_client = urllib3.PoolManager(
            timeout=urllib3.Timeout(connect=3.0, read=3.0),
            retries=False,
            cert_reqs="CERT_NONE" if not settings.MINIO_SECURE else "CERT_REQUIRED",
        )
        self.client = Minio(
            endpoint=settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_SECURE,
            http_client=http_client,
        )
        self.ocr_bucket = "ocr-images"
        self.profile_bucket = "profile-images"
        self._ensure_buckets()

    def _ensure_buckets(self):
        for bucket_name in [self.ocr_bucket, self.profile_bucket]:
            try:
                if not self.client.bucket_exists(bucket_name):
                    self.client.make_bucket(bucket_name)
            except S3Error as e:
                print(f"MinIO bucket error {bucket_name}: {e}")

    async def _upload_minio(self, file, filename, bucket, content_type):
        try:
            file.seek(0, os.SEEK_END)
            file_size = file.tell()
            file.seek(0)
            self.client.put_object(
                bucket_name=bucket,
                object_name=filename,
                data=file,
                length=file_size,
                content_type=content_type or "application/octet-stream",
            )
            url = self.get_presigned_url(bucket, filename, expires=timedelta(days=7))
            return {"url": url, "bucket": bucket, "filename": filename, "size": file_size}
        except S3Error as e:
            raise Exception(f"MinIO upload failed: {e}")

    def _presigned_minio(self, bucket, filename, expires):
        try:
            return self.client.presigned_get_object(
                bucket_name=bucket, object_name=filename, expires=expires
            )
        except S3Error as e:
            raise Exception(f"MinIO presigned URL failed: {e}")

    async def _delete_minio(self, bucket, filename):
        try:
            self.client.remove_object(bucket_name=bucket, object_name=filename)
            return True
        except S3Error as e:
            print(f"MinIO delete failed {filename}: {e}")
            return False

    def _list_minio(self, bucket, prefix):
        try:
            return [
                obj.object_name
                for obj in self.client.list_objects(bucket_name=bucket, prefix=prefix)
            ]
        except S3Error as e:
            print(f"MinIO list failed {bucket}: {e}")
            return []


# Singleton instance
_storage_service: Optional[StorageService] = None


def get_storage_service() -> StorageService:
    global _storage_service
    if _storage_service is None:
        _storage_service = StorageService()
    return _storage_service
