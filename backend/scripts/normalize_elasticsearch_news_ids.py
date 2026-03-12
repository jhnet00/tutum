"""Normalize Elasticsearch news document IDs to URL-encoded form.

This script preserves the existing document source, including embeddings,
while consolidating mixed raw/encoded _id schemes into the encoded format
used by the live elastic-consumer worker.
"""

from __future__ import annotations

import argparse
import json
from typing import Iterator
from urllib.parse import quote

import httpx


def iter_hits(
    client: httpx.Client,
    base_url: str,
    index: str,
    size: int = 500,
    scroll: str = "2m",
) -> Iterator[dict]:
    response = client.post(
        f"{base_url}/{index}/_search",
        params={"scroll": scroll},
        json={
            "size": size,
            "sort": ["_doc"],
            "_source": True,
            "query": {"match_all": {}},
        },
    )
    response.raise_for_status()
    payload = response.json()
    scroll_id = payload.get("_scroll_id")

    try:
        hits = payload.get("hits", {}).get("hits", [])
        while hits:
            for hit in hits:
                yield hit

            response = client.post(
                f"{base_url}/_search/scroll",
                json={"scroll": scroll, "scroll_id": scroll_id},
            )
            response.raise_for_status()
            payload = response.json()
            scroll_id = payload.get("_scroll_id")
            hits = payload.get("hits", {}).get("hits", [])
    finally:
        if scroll_id:
            client.request(
                "DELETE",
                f"{base_url}/_search/scroll",
                json={"scroll_id": [scroll_id]},
            )


def chunked(items: list[dict], size: int) -> Iterator[list[dict]]:
    for idx in range(0, len(items), size):
        yield items[idx : idx + size]


def distinct_url_count(client: httpx.Client, base_url: str, index: str) -> int:
    response = client.post(
        f"{base_url}/{index}/_search",
        params={"size": 0},
        json={
            "aggs": {
                "distinct_urls": {
                    "cardinality": {"field": "url", "precision_threshold": 40000}
                }
            }
        },
    )
    response.raise_for_status()
    return int(response.json()["aggregations"]["distinct_urls"]["value"])


def scan_raw_doc_count(client: httpx.Client, base_url: str, index: str) -> int:
    count = 0
    for hit in iter_hits(client, base_url, index):
        doc_id = str(hit.get("_id", ""))
        if doc_id.startswith(("http://", "https://")):
            count += 1
    return count


def normalize(base_url: str, index: str, apply_changes: bool) -> dict:
    stats = {
        "total_docs": 0,
        "raw_docs": 0,
        "raw_duplicates_deleted": 0,
        "raw_docs_copied": 0,
        "raw_docs_skipped": 0,
        "bulk_batches": 0,
    }

    with httpx.Client(timeout=60.0) as client:
        raw_hits: list[dict] = []
        for hit in iter_hits(client, base_url, index):
            stats["total_docs"] += 1
            doc_id = str(hit.get("_id", ""))
            if doc_id.startswith(("http://", "https://")):
                raw_hits.append(hit)

        stats["raw_docs"] = len(raw_hits)

        for batch in chunked(raw_hits, 200):
            docs = []
            for hit in batch:
                source = hit.get("_source") or {}
                raw_id = str(hit["_id"])
                canonical_key = str(source.get("url") or source.get("link") or raw_id).strip()
                if not canonical_key:
                    stats["raw_docs_skipped"] += 1
                    continue
                encoded_id = quote(canonical_key, safe="")
                if encoded_id == raw_id:
                    stats["raw_docs_skipped"] += 1
                    continue
                docs.append(
                    {
                        "raw_id": raw_id,
                        "encoded_id": encoded_id,
                        "source": source,
                    }
                )

            if not docs:
                continue

            mget_response = client.post(
                f"{base_url}/{index}/_mget",
                json={"docs": [{"_id": item["encoded_id"]} for item in docs]},
            )
            mget_response.raise_for_status()
            existing = {
                item["_id"]: item.get("found", False)
                for item in mget_response.json().get("docs", [])
            }

            bulk_lines: list[str] = []
            for item in docs:
                encoded_exists = existing.get(item["encoded_id"], False)
                if encoded_exists:
                    stats["raw_duplicates_deleted"] += 1
                else:
                    stats["raw_docs_copied"] += 1
                    bulk_lines.append(
                        json.dumps(
                            {"index": {"_index": index, "_id": item["encoded_id"]}},
                            ensure_ascii=False,
                        )
                    )
                    bulk_lines.append(json.dumps(item["source"], ensure_ascii=False))

                bulk_lines.append(
                    json.dumps(
                        {"delete": {"_index": index, "_id": item["raw_id"]}},
                        ensure_ascii=False,
                    )
                )

            if not bulk_lines:
                continue

            stats["bulk_batches"] += 1
            if apply_changes:
                response = client.post(
                    f"{base_url}/_bulk",
                    content="\n".join(bulk_lines) + "\n",
                    headers={"Content-Type": "application/x-ndjson"},
                )
                response.raise_for_status()
                payload = response.json()
                if payload.get("errors"):
                    raise RuntimeError(f"bulk operation failed: {payload}")

        if apply_changes:
            refresh = client.post(f"{base_url}/{index}/_refresh")
            refresh.raise_for_status()

        stats["post_count"] = int(client.get(f"{base_url}/{index}/_count").json()["count"])
        stats["post_distinct_urls"] = distinct_url_count(client, base_url, index)
        stats["post_raw_docs"] = scan_raw_doc_count(client, base_url, index)

    return stats


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--base-url",
        default="http://elasticsearch.tutum-data.svc.cluster.local:9200",
    )
    parser.add_argument("--index", default="news")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    stats = normalize(args.base_url, args.index, apply_changes=args.apply)
    print(json.dumps(stats, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
