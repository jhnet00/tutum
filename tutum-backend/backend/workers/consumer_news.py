#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional

from kafka import KafkaConsumer
from pymongo import MongoClient, UpdateOne, errors

try:
    from dotenv import load_dotenv
except Exception:
    load_dotenv = None


def load_env() -> None:
    """
    Load .env for local runs (VS Code Run, direct python execution).
    Existing exported env vars still win (override=False).
    """
    if load_dotenv is None:
        return

    base_dir = Path(__file__).resolve().parents[1]
    candidates = [
        Path.cwd() / ".env",
        base_dir / ".env",
        Path.home() / ".env",
    ]
    for env_path in candidates:
        if env_path.exists():
            load_dotenv(env_path, override=False)


load_env()


KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP_SERVERS") or os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
TOPIC = os.getenv("KAFKA_NEWS_TOPIC") or os.getenv("KAFKA_TOPIC", "news")
GROUP_ID = os.getenv("KAFKA_GROUP_ID", "clouddx-news-consumer-v1")

MONGO_URI = os.getenv("MONGO_URI") or os.getenv("MONGODB_URL")
MONGO_DB = os.getenv("MONGO_DB", "clouddx")
MONGO_COLL = os.getenv("MONGO_COLL", "news")
KST = timezone(timedelta(hours=9))


def parse_published_at(value: Any) -> Optional[datetime]:
    """
    producer에서 published_at이:
    - ISO8601 (예: 2026-02-05T11:38:12+09:00 / ...Z)
    - finance 리스트 시간 문자열 (예: 2026-02-05 11:38:12)
    - None
    형태로 올 수 있어서 Mongo 정렬/필터링용 datetime으로 정규화한다.
    """
    if not value:
        return None

    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=KST)

    if not isinstance(value, str):
        return None

    s = value.strip()

    # 1) ISO8601 계열
    try:
        # Z 처리
        if s.endswith("Z"):
            s2 = s[:-1] + "+00:00"
            return datetime.fromisoformat(s2)
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=KST)
    except Exception:
        pass

    # 2) "YYYY-MM-DD HH:MM:SS" 형태
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y.%m.%d %H:%M"):
        try:
            dt = datetime.strptime(s, fmt)
            return dt.replace(tzinfo=KST)
        except Exception:
            continue

    return None


def to_utc_iso(dt: datetime) -> str:
    utc_dt = dt.astimezone(timezone.utc)
    return utc_dt.isoformat().replace("+00:00", "Z")


def backfill_time_fields(coll) -> None:
    """
    기존 Mongo 문서에도 published_at_ts/sort_ts/UTC 문자열 시간을 채워
    소스와 무관한 시간 정렬 기준을 통일한다.
    """
    ops: list[UpdateOne] = []
    updated = 0
    cursor = coll.find(
        {},
        {
            "_id": 1,
            "published_at": 1,
            "published_at_dt": 1,
            "published_at_ts": 1,
            "sort_ts": 1,
            "ingested_at": 1,
        },
    )

    for doc in cursor:
        cur_ts = doc.get("published_at_ts")
        cur_sort_ts = doc.get("sort_ts")
        dt = (
            parse_published_at(doc.get("published_at_dt"))
            or parse_published_at(doc.get("published_at"))
            or parse_published_at(doc.get("ingested_at"))
        )
        if not dt:
            continue

        ts = float(dt.timestamp())
        utc_iso = to_utc_iso(dt)

        needs_update = False
        set_doc: dict[str, Any] = {}

        if not isinstance(cur_ts, (int, float)) or abs(float(cur_ts) - ts) > 0.0001:
            set_doc["published_at_ts"] = ts
            needs_update = True
        if not isinstance(cur_sort_ts, (int, float)) or abs(float(cur_sort_ts) - ts) > 0.0001:
            set_doc["sort_ts"] = ts
            needs_update = True
        if doc.get("published_at_dt") != utc_iso:
            set_doc["published_at_dt"] = utc_iso
            needs_update = True
        if doc.get("published_at") != utc_iso:
            set_doc["published_at"] = utc_iso
            needs_update = True

        if needs_update:
            ops.append(UpdateOne({"_id": doc["_id"]}, {"$set": set_doc}))
            if len(ops) >= 500:
                result = coll.bulk_write(ops, ordered=False)
                updated += result.modified_count
                ops = []

    if ops:
        result = coll.bulk_write(ops, ordered=False)
        updated += result.modified_count

    print(f"[mongo] backfill done: modified={updated}")


def main():
    if not MONGO_URI:
        raise RuntimeError("MONGO_URI/MONGODB_URL 환경변수가 없습니다. (.env/Secret/ConfigMap 설정 확인)")

    # Mongo 연결 테스트
    try:
        mongo = MongoClient(MONGO_URI, serverSelectionTimeoutMS=8000)
        mongo.admin.command("ping")
        print("[mongo] ping ok")
    except Exception as e:
        print("[mongo] connection failed:", repr(e))
        print(" - Atlas Network Access → IP Access List 허용(내 IP 또는 0.0.0.0/0) 확인")
        return

    coll = mongo[MONGO_DB][MONGO_COLL]

    # 인덱스
    try:
        # 중복 방지: url/link unique (구버전 스키마 호환)
        coll.create_index([("url", 1)], unique=True, sparse=True)
        coll.create_index([("link", 1)], unique=True, sparse=True)

        # 정렬/조회용: published_at_ts(숫자 epoch) 내림차순
        coll.create_index([("published_at_ts", -1), ("ingested_at", -1)])

        # (선택) 섹션별 조회가 많으면
        coll.create_index([("section", 1), ("published_at_ts", -1), ("ingested_at", -1)])
    except errors.PyMongoError as e:
        print("[mongo] create_index warning:", repr(e))

    try:
        backfill_time_fields(coll)
    except errors.PyMongoError as e:
        print("[mongo] backfill warning:", repr(e))

    consumer = KafkaConsumer(
        TOPIC,
        bootstrap_servers=[KAFKA_BOOTSTRAP],
        group_id=GROUP_ID,
        auto_offset_reset="earliest",
        enable_auto_commit=True,
        value_deserializer=lambda m: json.loads(m.decode("utf-8")),
    )

    print(f"[kafka] consumer started: {KAFKA_BOOTSTRAP} topic={TOPIC} group={GROUP_ID}")

    for msg in consumer:
        item = msg.value

        link = item.get("url") or item.get("link")
        title = item.get("title")
        if not link or not title:
            print("[skip] missing url(link)/title")
            continue

        # clouddx-project(url) + legacy(link) 스키마 동시 호환
        item["url"] = link
        item["link"] = link

        # 스키마 보강/정규화
        ingested_at = datetime.now(timezone.utc)

        # published_at 정규화 (원본은 유지)
        published_at_dt = (
            parse_published_at(item.get("published_at"))
            or parse_published_at(item.get("published_at_dt"))
        )

        # Mongo/JSON 공통 필드 보강
        item["ingested_at"] = ingested_at.isoformat()
        item.setdefault("id", link)
        if published_at_dt:
            item["published_at_dt"] = to_utc_iso(published_at_dt)
            item["published_at_ts"] = float(published_at_dt.timestamp())
            item["sort_ts"] = float(published_at_dt.timestamp())
            item["published_at"] = to_utc_iso(published_at_dt)
        else:
            item["published_at_ts"] = float(ingested_at.timestamp())
            item["sort_ts"] = float(ingested_at.timestamp())
            item["published_at_dt"] = to_utc_iso(ingested_at)
            item["published_at"] = to_utc_iso(ingested_at)

        # 최소 필드 기본값(없어도 저장은 되지만 일관성 위해)
        item.setdefault("source", "unknown")
        item.setdefault("section", "unknown")

        try:
            coll.update_one(
                {"$or": [{"url": link}, {"link": link}]},
                {
                    "$set": item,
                    "$setOnInsert": {"created_at": ingested_at.isoformat()},
                },
                upsert=True,
            )
            print("[saved]", title[:80])
        except errors.DuplicateKeyError:
            # 아주 드물게 경합이 생기면 update_one이 아닌 insert 상황에서 발생 가능
            print("[dup]", title[:80])
        except errors.PyMongoError as e:
            print("[mongo] upsert failed:", repr(e))


if __name__ == "__main__":
    main()
