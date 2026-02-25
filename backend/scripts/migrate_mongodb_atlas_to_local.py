"""
Atlas -> Local MongoDB migration helper.

Usage examples:
  python scripts/migrate_mongodb_atlas_to_local.py --dry-run
  python scripts/migrate_mongodb_atlas_to_local.py --copy-indexes
  python scripts/migrate_mongodb_atlas_to_local.py --drop-target --copy-indexes
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from typing import Iterable

from dotenv import load_dotenv
from pymongo import MongoClient, ReplaceOne
from pymongo.operations import IndexModel
from pymongo.errors import PyMongoError


DEFAULT_DB_NAME = "clouddx"
DEFAULT_TARGET_URI = "mongodb://localhost:27017"


@dataclass
class CollectionSummary:
    name: str
    source_count: int
    migrated: int = 0
    target_count: int = 0


def _load_env() -> None:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.dirname(script_dir)
    env_path = os.path.join(backend_dir, ".env")
    load_dotenv(env_path)


def _resolve_source_uri(cli_value: str | None) -> str:
    if cli_value:
        return cli_value.strip()

    atlas_uri = (os.getenv("ATLAS_MONGODB_URL") or "").strip()
    if atlas_uri:
        return atlas_uri

    mongodb_url = (os.getenv("MONGODB_URL") or "").strip().strip('"').strip("'")
    if mongodb_url.startswith("mongodb+srv://"):
        return mongodb_url

    raise ValueError(
        "source URI not found. Use --source-uri or set ATLAS_MONGODB_URL (or MONGODB_URL as mongodb+srv)."
    )


def _resolve_target_uri(cli_value: str | None) -> str:
    if cli_value:
        return cli_value.strip()
    return DEFAULT_TARGET_URI


def _is_local_target_uri(uri: str) -> bool:
    if not uri.startswith("mongodb://"):
        return False

    # mongodb://[user:pass@]host[:port][/db][?...]
    authority_and_rest = uri[len("mongodb://") :]
    authority = authority_and_rest.split("/", 1)[0]
    hostlist = authority.rsplit("@", 1)[-1]
    first_host = hostlist.split(",", 1)[0]
    hostname = first_host.split(":", 1)[0].strip("[]").lower()
    return hostname in {"localhost", "127.0.0.1", "mongodb"}


def _iter_collections(db, only: set[str] | None) -> Iterable[str]:
    names = db.list_collection_names()
    for name in sorted(names):
        if name.startswith("system."):
            continue
        if only and name not in only:
            continue
        yield name


def _copy_indexes(src_coll, dst_coll) -> None:
    models: list[IndexModel] = []
    for idx in src_coll.list_indexes():
        if idx.get("name") == "_id_":
            continue

        keys = list(idx["key"].items())
        options = {
            "name": idx.get("name"),
            "unique": idx.get("unique", False),
            "sparse": idx.get("sparse", False),
            "expireAfterSeconds": idx.get("expireAfterSeconds"),
            "partialFilterExpression": idx.get("partialFilterExpression"),
            "collation": idx.get("collation"),
            "weights": idx.get("weights"),
            "default_language": idx.get("default_language"),
            "language_override": idx.get("language_override"),
            "textIndexVersion": idx.get("textIndexVersion"),
        }
        clean_options = {k: v for k, v in options.items() if v is not None}
        models.append(IndexModel(keys, **clean_options))

    if models:
        dst_coll.create_indexes(models)


def _migrate_collection(src_coll, dst_coll, batch_size: int) -> int:
    migrated = 0
    ops: list[ReplaceOne] = []
    # Atlas free/shared tiers may reject noTimeout cursors.
    cursor = src_coll.find({}).batch_size(batch_size)
    try:
        for doc in cursor:
            ops.append(ReplaceOne({"_id": doc["_id"]}, doc, upsert=True))
            if len(ops) >= batch_size:
                dst_coll.bulk_write(ops, ordered=False)
                migrated += len(ops)
                ops.clear()

        if ops:
            dst_coll.bulk_write(ops, ordered=False)
            migrated += len(ops)
    finally:
        cursor.close()

    return migrated


def main() -> int:
    _load_env()

    parser = argparse.ArgumentParser(description="Migrate MongoDB Atlas data to local MongoDB.")
    parser.add_argument("--source-uri", help="Atlas/source URI (mongodb+srv://...)")
    parser.add_argument("--target-uri", help="Target URI (default: mongodb://localhost:27017)")
    parser.add_argument("--source-db", default=os.getenv("MONGODB_DB_NAME", DEFAULT_DB_NAME))
    parser.add_argument("--target-db", default=os.getenv("MONGODB_DB_NAME", DEFAULT_DB_NAME))
    parser.add_argument("--collections", help="Comma-separated collection names to migrate")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true", help="Only print counts, do not migrate")
    parser.add_argument("--drop-target", action="store_true", help="Drop target collection before migration")
    parser.add_argument("--copy-indexes", action="store_true", help="Copy indexes from source to target")
    args = parser.parse_args()

    source_uri = _resolve_source_uri(args.source_uri)
    target_uri = _resolve_target_uri(args.target_uri)

    if source_uri == target_uri:
        raise ValueError("source-uri and target-uri are identical. Abort.")

    target_is_local = _is_local_target_uri(target_uri)
    if not target_is_local:
        raise ValueError("target-uri must point to local mongo (localhost/127.0.0.1/mongodb).")

    selected_collections: set[str] | None = None
    if args.collections:
        selected_collections = {
            token.strip() for token in args.collections.split(",") if token.strip()
        }

    src_client = MongoClient(source_uri, serverSelectionTimeoutMS=10000)
    dst_client = MongoClient(target_uri, serverSelectionTimeoutMS=10000)

    try:
        src_client.admin.command("ping")
        dst_client.admin.command("ping")
        print("[OK] source/target mongo connection verified")

        src_db = src_client[args.source_db]
        dst_db = dst_client[args.target_db]

        summaries: list[CollectionSummary] = []
        for col_name in _iter_collections(src_db, selected_collections):
            src_coll = src_db[col_name]
            dst_coll = dst_db[col_name]
            source_count = src_coll.estimated_document_count()
            summary = CollectionSummary(name=col_name, source_count=source_count)

            if args.dry_run:
                summary.target_count = dst_coll.estimated_document_count()
                summaries.append(summary)
                continue

            if args.drop_target:
                dst_coll.drop()

            summary.migrated = _migrate_collection(src_coll, dst_coll, batch_size=max(50, args.batch_size))
            if args.copy_indexes:
                _copy_indexes(src_coll, dst_coll)

            summary.target_count = dst_coll.estimated_document_count()
            summaries.append(summary)
            print(
                f"[OK] {col_name}: source={summary.source_count}, migrated={summary.migrated}, "
                f"target={summary.target_count}"
            )

        print("\n===== Migration Summary =====")
        for s in summaries:
            if args.dry_run:
                print(f"- {s.name}: source={s.source_count}, target_now={s.target_count}")
            else:
                print(f"- {s.name}: source={s.source_count}, migrated={s.migrated}, target={s.target_count}")
        print("=============================")

    except PyMongoError as exc:
        print(f"[ERROR] Mongo migration failed: {exc}")
        return 1
    except ValueError as exc:
        print(f"[ERROR] {exc}")
        return 1
    finally:
        src_client.close()
        dst_client.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
