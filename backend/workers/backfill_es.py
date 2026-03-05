#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MongoDB → Elasticsearch 백필 스크립트

MongoDB tutum.news 컬렉션의 전체 문서를 Elasticsearch에 bulk upsert.
이미 인덱싱된 문서는 덮어쓰지 않음 (doc_as_upsert).
K8s Job으로 실행 - 완료 후 파드 자동 종료.

환경변수:
  MONGO_URI           - MongoDB 연결 문자열
  MONGO_DB            - DB명 (기본: tutum)
  MONGO_COLL          - 컬렉션명 (기본: news)
  ELASTICSEARCH_URL   - ES URL (기본: http://localhost:9200)
  ES_INDEX            - 인덱스명 (기본: news)
  BATCH_SIZE          - 배치 크기 (기본: 100)
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import quote

import requests
from pymongo import MongoClient

MONGO_URI = os.getenv("MONGO_URI") or os.getenv("MONGODB_URL", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "tutum")
MONGO_COLL = os.getenv("MONGO_COLL", "news")

ES_URL = (os.getenv("ELASTICSEARCH_URL") or os.getenv("ES_URL", "http://localhost:9200")).rstrip("/")
ES_INDEX = os.getenv("ES_INDEX", "news")
ES_TIMEOUT = int(os.getenv("ES_TIMEOUT_SEC", "30"))
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "100"))

KST = timezone(timedelta(hours=9))


# ── 날짜 파싱 (elastic_consumer.py 동일 로직) ────────────────────────────────

def parse_published_at(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=KST)
    if not isinstance(value, str):
        return None
    s = value.strip()
    try:
        if s.endswith("Z"):
            return datetime.fromisoformat(s[:-1] + "+00:00")
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=KST)
    except Exception:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y.%m.%d %H:%M"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=KST)
        except Exception:
            continue
    return None


def to_utc_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


# ── MongoDB 문서 → ES 문서 변환 ──────────────────────────────────────────────

def normalize_doc(raw: dict[str, Any]) -> Optional[dict[str, Any]]:
    """MongoDB 문서를 ES 인덱싱 형식으로 변환."""
    url = raw.get("url") or raw.get("link")
    title = raw.get("title")
    content = raw.get("content") or raw.get("body")

    if not url or not title or not content:
        return None

    published_at_dt = (
        parse_published_at(raw.get("published_at"))
        or parse_published_at(raw.get("published_at_dt"))
        or parse_published_at(raw.get("crawled_at"))
        or datetime.now(timezone.utc)
    )

    doc: dict[str, Any] = {
        "url": url,
        "title": title,
        "content": content,
        "summary": raw.get("summary") or title,
        "source": raw.get("source", "unknown"),
        "published_at": to_utc_iso(published_at_dt),
        "tags": raw.get("tags") or [],
        "related_assets": raw.get("related_assets") or [],
        "ingested_at": to_utc_iso(datetime.now(timezone.utc)),
    }

    for field in ("section", "press", "source_list_url", "embedding",
                  "finance_origin_link", "published_at_dt", "published_at_ts",
                  "sort_ts"):
        if field in raw:
            doc[field] = raw[field]

    return doc


# ── ES bulk upsert ────────────────────────────────────────────────────────────

def bulk_upsert(session: requests.Session, docs: list[dict[str, Any]]) -> tuple[int, int]:
    """bulk API로 upsert. (성공 수, 실패 수) 반환."""
    lines = []
    for doc in docs:
        doc_id = quote(str(doc["url"]), safe="")
        action = json.dumps({"update": {"_index": ES_INDEX, "_id": doc_id, "retry_on_conflict": 3}})
        body = json.dumps({"doc": doc, "doc_as_upsert": True}, ensure_ascii=False)
        lines.append(action)
        lines.append(body)

    payload = "\n".join(lines) + "\n"
    resp = session.post(
        f"{ES_URL}/_bulk",
        headers={"Content-Type": "application/x-ndjson"},
        data=payload.encode("utf-8"),
        timeout=ES_TIMEOUT,
    )
    if resp.status_code >= 400:
        print(f"[bulk] HTTP {resp.status_code}: {resp.text[:300]}", flush=True)
        return 0, len(docs)

    result = resp.json()
    ok = sum(1 for item in result.get("items", []) if item.get("update", {}).get("status") in (200, 201))
    failed = len(result.get("items", [])) - ok
    return ok, failed


# ── 메인 ─────────────────────────────────────────────────────────────────────

def main() -> None:
    session = requests.Session()

    # ES 연결 확인
    try:
        ping = session.get(ES_URL, timeout=10)
        ping.raise_for_status()
        print(f"[es] connected: {ES_URL}", flush=True)
    except Exception as e:
        print(f"[es] connection failed: {e}", flush=True)
        sys.exit(1)

    # MongoDB 연결
    try:
        client: MongoClient = MongoClient(MONGO_URI, serverSelectionTimeoutMS=10000)
        client.server_info()
        coll = client[MONGO_DB][MONGO_COLL]
        total = coll.count_documents({})
        print(f"[mongo] connected: {MONGO_DB}.{MONGO_COLL} — 총 {total:,}건", flush=True)
    except Exception as e:
        print(f"[mongo] connection failed: {e}", flush=True)
        sys.exit(1)

    # 현재 ES 문서 수 확인
    try:
        count_resp = session.get(f"{ES_URL}/{ES_INDEX}/_count", timeout=10)
        es_before = count_resp.json().get("count", 0) if count_resp.ok else 0
        print(f"[es] 기존 인덱싱 수: {es_before:,}건 ({round(es_before/total*100) if total else 0}%)", flush=True)
    except Exception:
        es_before = 0

    # 배치 처리
    total_ok = 0
    total_fail = 0
    total_skip = 0
    batch: list[dict[str, Any]] = []
    processed = 0

    cursor = coll.find({}, no_cursor_timeout=True).batch_size(BATCH_SIZE)
    try:
        for raw in cursor:
            raw.pop("_id", None)  # ObjectId는 JSON 직렬화 불가 → 제거
            doc = normalize_doc(raw)
            if not doc:
                total_skip += 1
                continue

            batch.append(doc)
            if len(batch) >= BATCH_SIZE:
                ok, fail = bulk_upsert(session, batch)
                total_ok += ok
                total_fail += fail
                processed += len(batch)
                batch = []
                pct = round(processed / total * 100) if total else 0
                print(f"[progress] {processed:,}/{total:,} ({pct}%) — OK:{total_ok:,} FAIL:{total_fail:,}", flush=True)

        # 남은 배치
        if batch:
            ok, fail = bulk_upsert(session, batch)
            total_ok += ok
            total_fail += fail
            processed += len(batch)

    finally:
        cursor.close()
        client.close()

    # 완료 후 ES 문서 수 재확인
    try:
        session.post(f"{ES_URL}/{ES_INDEX}/_refresh", timeout=10)
        count_resp = session.get(f"{ES_URL}/{ES_INDEX}/_count", timeout=10)
        es_after = count_resp.json().get("count", 0) if count_resp.ok else 0
    except Exception:
        es_after = total_ok

    print("", flush=True)
    print("=" * 50, flush=True)
    print(f"[완료] MongoDB {total:,}건 → ES 처리", flush=True)
    print(f"  upsert 성공 : {total_ok:,}건", flush=True)
    print(f"  upsert 실패 : {total_fail:,}건", flush=True)
    print(f"  필드 누락 스킵: {total_skip:,}건", flush=True)
    print(f"  ES 최종 문서 수: {es_after:,}건 ({round(es_after/total*100) if total else 0}%)", flush=True)
    print("=" * 50, flush=True)

    if total_fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
