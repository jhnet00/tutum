#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import quote

import requests
from kafka import KafkaConsumer


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "t", "yes", "y", "on"}


KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP_SERVERS") or os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
TOPIC = os.getenv("KAFKA_NEWS_TOPIC") or os.getenv("KAFKA_TOPIC", "news.raw")
GROUP_ID = os.getenv("KAFKA_INDEXER_GROUP_ID", "indexer-consumer-group")

ES_URL = os.getenv("ELASTICSEARCH_URL") or os.getenv("ES_URL", "http://localhost:9200")
ES_URL = ES_URL.rstrip("/")
ES_INDEX = os.getenv("ES_INDEX", "news")
ES_TIMEOUT_SEC = int(os.getenv("ES_TIMEOUT_SEC", "10"))

ENABLE_BEDROCK_EMBEDDING = env_bool("ENABLE_BEDROCK_EMBEDDING", default=False)
BEDROCK_REGION = os.getenv("BEDROCK_REGION", os.getenv("AWS_REGION", "us-east-1"))
BEDROCK_EMBED_MODEL_ID = os.getenv("BEDROCK_EMBED_MODEL_ID", "amazon.titan-embed-text-v2:0")
BEDROCK_INPUT_MAX_CHARS = int(os.getenv("BEDROCK_INPUT_MAX_CHARS", "8000"))
BEDROCK_EMBED_DIMS = int(os.getenv("BEDROCK_EMBED_DIMS", "1024"))

KST = timezone(timedelta(hours=9))


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


def normalize_message(item: dict[str, Any]) -> Optional[dict[str, Any]]:
    # producer 호환: old schema(link/body) + new schema(url/content)
    url = item.get("url") or item.get("link")
    title = item.get("title")
    content = item.get("content") or item.get("body")

    if not url or not title or not content:
        return None

    published_at_dt = (
        parse_published_at(item.get("published_at"))
        or parse_published_at(item.get("published_at_dt"))
        or parse_published_at(item.get("crawled_at"))
        or datetime.now(timezone.utc)
    )
    published_at_iso = to_utc_iso(published_at_dt)

    doc: dict[str, Any] = {
        "url": url,
        "title": title,
        "content": content,
        "summary": item.get("summary") or title,
        "source": item.get("source", "unknown"),
        "published_at": published_at_iso,
        "tags": item.get("tags") or [],
        "related_assets": item.get("related_assets") or [],
        "ingested_at": to_utc_iso(datetime.now(timezone.utc)),
    }

    # producer가 추가한 메타는 있으면 같이 넘긴다.
    passthrough_fields = (
        "section",
        "press",
        "source_list_url",
        "finance_origin_link",
        "published_at_dt",
        "published_at_ts",
        "sort_ts",
        "embedding",
    )
    for field in passthrough_fields:
        if field in item:
            doc[field] = item[field]

    return doc


def build_embedding_text(doc: dict[str, Any]) -> str:
    chunks = [
        str(doc.get("title") or ""),
        str(doc.get("summary") or ""),
        str(doc.get("content") or ""),
    ]
    text = "\n\n".join(x for x in chunks if x).strip()
    return text[:BEDROCK_INPUT_MAX_CHARS]


def embed_with_bedrock(text: str) -> Optional[list[float]]:
    if not text:
        return None

    try:
        import boto3  # type: ignore
    except Exception:
        print("[embed] boto3 not installed; skip embedding")
        return None

    try:
        client = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)
        payload = {"inputText": text}
        resp = client.invoke_model(
            modelId=BEDROCK_EMBED_MODEL_ID,
            body=json.dumps(payload),
            contentType="application/json",
            accept="application/json",
        )
        raw = resp["body"].read()
        data = json.loads(raw.decode("utf-8"))
        vector = data.get("embedding")
        if isinstance(vector, list) and vector and isinstance(vector[0], (int, float)):
            out = [float(x) for x in vector]
            if len(out) != BEDROCK_EMBED_DIMS:
                print(f"[embed] dim mismatch expected={BEDROCK_EMBED_DIMS} actual={len(out)}")
                return None
            return out
        print(f"[embed] unexpected response keys={list(data.keys())}")
        return None
    except Exception as e:
        print("[embed] bedrock invoke failed:", repr(e))
        return None


def ensure_index_exists(session: requests.Session) -> None:
    index_url = f"{ES_URL}/{ES_INDEX}"
    resp = session.head(index_url, timeout=ES_TIMEOUT_SEC)
    if resp.status_code == 200:
        return
    if resp.status_code not in (404,):
        raise RuntimeError(f"index check failed: status={resp.status_code} body={resp.text[:200]}")

    # keyword + text + date + dense_vector(1024) 기본 매핑
    mapping = {
        "settings": {"number_of_shards": 1, "number_of_replicas": 0},
        "mappings": {
            "properties": {
                "url": {"type": "keyword"},
                "title": {"type": "text"},
                "content": {"type": "text"},
                "summary": {"type": "text"},
                "source": {"type": "keyword"},
                "published_at": {"type": "date"},
                "tags": {"type": "keyword"},
                "related_assets": {"type": "keyword"},
                "ingested_at": {"type": "date"},
                "embedding": {
                    "type": "dense_vector",
                    "dims": 1024,
                    "index": True,
                    "similarity": "cosine",
                },
            }
        },
    }
    create_resp = session.put(
        index_url,
        headers={"Content-Type": "application/json"},
        data=json.dumps(mapping),
        timeout=ES_TIMEOUT_SEC,
    )
    if create_resp.status_code not in (200, 201):
        raise RuntimeError(
            f"index create failed: status={create_resp.status_code} body={create_resp.text[:300]}"
        )


def upsert_document(session: requests.Session, doc: dict[str, Any]) -> None:
    doc_id = quote(str(doc["url"]), safe="")
    update_url = f"{ES_URL}/{ES_INDEX}/_update/{doc_id}"
    payload = {"doc": doc, "doc_as_upsert": True}

    resp = session.post(
        update_url,
        headers={"Content-Type": "application/json"},
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        timeout=ES_TIMEOUT_SEC,
    )
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"es upsert failed: status={resp.status_code} body={resp.text[:300]}")


def main() -> None:
    session = requests.Session()

    # ES 연결/인덱스 확인
    ping = session.get(ES_URL, timeout=ES_TIMEOUT_SEC)
    if ping.status_code >= 400:
        raise RuntimeError(f"elasticsearch ping failed: status={ping.status_code} body={ping.text[:200]}")
    ensure_index_exists(session)
    print(f"[es] ready: {ES_URL}/{ES_INDEX}")

    consumer = KafkaConsumer(
        TOPIC,
        bootstrap_servers=[KAFKA_BOOTSTRAP],
        group_id=GROUP_ID,
        auto_offset_reset="earliest",
        enable_auto_commit=True,
        value_deserializer=lambda m: json.loads(m.decode("utf-8")),
    )
    print(f"[kafka] indexer started: {KAFKA_BOOTSTRAP} topic={TOPIC} group={GROUP_ID}")

    for msg in consumer:
        item = msg.value
        doc = normalize_message(item)
        if not doc:
            print("[skip] missing required fields(url/title/content)")
            continue

        try:
            if ENABLE_BEDROCK_EMBEDDING and not doc.get("embedding"):
                emb_text = build_embedding_text(doc)
                embedding = embed_with_bedrock(emb_text)
                if embedding:
                    doc["embedding"] = embedding
            upsert_document(session, doc)
            print("[indexed]", str(doc["title"])[:80])
        except Exception as e:
            print("[es] upsert error:", repr(e))


if __name__ == "__main__":
    main()
