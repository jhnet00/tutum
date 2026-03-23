# Kafka Contract (TUTUM)

## Topics

- `asset.import.request`
- `news` (env: `KAFKA_NEWS_TOPIC`, default `news`)

## Message Schema

### `asset.import.request`

```json
{
  "import_id": "...",
  "user_id": "...",
  "object_key": "...",
  "type": "OCR_IMAGE"
}
```

### `news`

```json
{
  "title": "기사 제목 (required)",
  "content": "기사 본문 텍스트 (required)",
  "summary": "요약 텍스트 (required)",
  "source": "출처명 (required)",
  "url": "https://example.com/news/1 (required)",
  "published_at": "2026-02-11T09:30:00Z (required, ISO-8601)",
  "tags": ["finance", "stock"],
  "related_assets": ["005930", "NVDA"]
}
```

## Compatibility

- Consumer는 하위 호환을 위해 `publishedAt`도 수용하고 내부에서 `published_at`으로 정규화합니다.
- Consumer는 `link` 필드도 `url`로 정규화합니다.

## Consumer Groups

- `ocr-workers`
- `indexer-consumer-group`
