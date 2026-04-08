# Tools Reference

All tools are prefixed with `cy_dp_` and return structured JSON with a `_meta` block.

---

## `cy_dp_search_decisions`

Full-text search across CDPC decisions and sanctions.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query (e.g., `cookies`, `employee monitoring`, `data breach`) |
| `type` | string | No | Filter by type: `sanction`, `warning`, `reprimand`, `decision` |
| `topic` | string | No | Filter by topic ID (e.g., `consent`, `cookies`). See `cy_dp_list_topics`. |
| `limit` | number | No | Max results. Default: 20. Max: 100. |

**Returns:** `{ results: Decision[], count: number }`

---

## `cy_dp_get_decision`

Get a specific CDPC decision by reference number.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reference` | string | Yes | Decision reference (e.g., `CDPC-2022-001`) |

**Returns:** Full `Decision` object or error if not found.

---

## `cy_dp_search_guidelines`

Full-text search across CDPC guidance documents.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query (e.g., `DPIA`, `cookies`, `data subject rights`) |
| `type` | string | No | Filter by type: `guide`, `recommendation`, `faq`, `template` |
| `topic` | string | No | Filter by topic ID. See `cy_dp_list_topics`. |
| `limit` | number | No | Max results. Default: 20. Max: 100. |

**Returns:** `{ results: Guideline[], count: number }`

---

## `cy_dp_get_guideline`

Get a specific CDPC guidance document by its database ID.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | Yes | Guideline database ID (from `cy_dp_search_guidelines` results) |

**Returns:** Full `Guideline` object or error if not found.

---

## `cy_dp_list_topics`

List all controlled vocabulary topics available for filtering.

**Parameters:** None

**Returns:** `{ topics: Topic[], count: number }`

Each topic has: `id`, `name_local` (Greek), `name_en` (English), `description`.

---

## `cy_dp_about`

Return metadata about this MCP server.

**Parameters:** None

**Returns:** Server name, version, description, data source, coverage summary, and list of all tools.

---

## `cy_dp_list_sources`

List all data sources with provenance metadata.

**Parameters:** None

**Returns:** Array of source objects with: `id`, `name`, `authority`, `country`, `url`, `data_types`, `languages`, `license`, `known_limitations`.

---

## `cy_dp_check_data_freshness`

Report current record counts and latest dates per source.

**Parameters:** None

**Returns:** Array of freshness objects with: `id`, `record_count`, `latest_record_date`, `status` (`populated` or `empty`).

---

## Response Structure

All successful tool responses include a `_meta` block:

```json
{
  "_meta": {
    "disclaimer": "Data sourced from CDPC ... not legal advice.",
    "copyright": "© Commissioner for Personal Data Protection, Cyprus",
    "source_url": "https://www.dataprotection.gov.cy/",
    "data_age": "Database is updated periodically and may lag official publications by days to weeks."
  }
}
```
