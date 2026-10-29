# Pagination and Filtering Patterns

Comprehensive reference for paginating large datasets and implementing filtering, sorting, and search.

## Pagination Strategies

### 1. Offset-Based Pagination

The simplest approach. Client specifies page number and size.

```
GET /api/v1/users?page=2&per_page=20
```

Response:

```json
{
  "data": [ ... ],
  "pagination": {
    "page": 2,
    "per_page": 20,
    "total_items": 142,
    "total_pages": 8,
    "links": {
      "first": "/api/v1/users?page=1&per_page=20",
      "prev": "/api/v1/users?page=1&per_page=20",
      "next": "/api/v1/users?page=3&per_page=20",
      "last": "/api/v1/users?page=8&per_page=20"
    }
  }
}
```

| Pros | Cons |
|------|------|
| Simple to implement and understand | Skips or duplicates when data changes mid-pagination |
| Supports random page access | Performance degrades at high offsets (DB scans rows) |
| Easy for agents to iterate | Inconsistent with concurrent writes |

**Best for:** Admin UIs, small datasets, infrequent writes.

### 2. Cursor-Based Pagination

Uses an opaque cursor (typically an encoded ID or timestamp) to mark the position.

```
GET /api/v1/users?limit=20&after=eyJpZCI6MTAwfQ
```

Response:

```json
{
  "data": [ ... ],
  "pagination": {
    "has_next": true,
    "has_prev": true,
    "next_cursor": "eyJpZCI6MTIwfQ",
    "prev_cursor": "eyJpZCI6MTAxfQ"
  }
}
```

| Pros | Cons |
|------|------|
| Consistent results during concurrent writes | Cannot jump to arbitrary page |
| Constant-time performance regardless of offset | Cursor is opaque (not human-readable) |
| Handles real-time data well | Slightly more complex to implement |

**Best for:** Feeds, timelines, large datasets, real-time data, agent consumption.

### 3. Keyset Pagination

Like cursor-based but uses a real field value as the cursor instead of an opaque token.

```
GET /api/v1/users?limit=20&created_after=2025-06-15T10:30:00Z&id_after=usr_100
```

| Pros | Cons |
|------|------|
| Transparent cursor (debuggable) | Requires a unique, sortable field |
| Same performance benefits as cursor | Exposes internal sort key |
| No encoding/decoding needed | Multi-column sort is complex |

**Best for:** Internal APIs, time-series data.

### 4. GraphQL Relay Connection

See [graphql-patterns.md](graphql-patterns.md) for the full Connection specification. Uses `first/after` and `last/before` with edges and pageInfo.

## Pagination Design Rules

### Defaults and Limits

```yaml
default_page_size: 20
max_page_size: 100
min_page_size: 1
```

Always enforce a maximum page size. Never allow unbounded queries.

### Metadata Requirements

Every paginated response must include:

1. **Has more data indicator** -- `has_next` boolean or `next` link
2. **Current position** -- cursor, page number, or offset
3. **Navigation links** -- next and prev at minimum

Optional but recommended:

4. **Total count** -- only if cheap to compute (avoid on large tables)
5. **First/last links** -- for offset-based pagination

### Empty Page Response

Return an empty array, not null or an error:

```json
{
  "data": [],
  "pagination": {
    "has_next": false,
    "next_cursor": null
  }
}
```

## Filtering

### Simple Equality Filters

```
GET /api/v1/users?status=active&role=admin
```

### Comparison Operators

Use suffixed parameter names:

```
GET /api/v1/orders?total_gte=100&total_lte=500
GET /api/v1/users?created_after=2025-01-01&created_before=2025-06-01
```

| Suffix | Meaning | SQL Equivalent |
|--------|---------|---------------|
| `_eq` | Equals (default, can omit) | `= value` |
| `_ne` | Not equals | `!= value` |
| `_gt` | Greater than | `> value` |
| `_gte` | Greater than or equal | `>= value` |
| `_lt` | Less than | `< value` |
| `_lte` | Less than or equal | `<= value` |
| `_in` | In list | `IN (a, b, c)` |
| `_contains` | Contains substring | `LIKE %value%` |
| `_starts_with` | Starts with | `LIKE value%` |

### Complex Filters

For advanced filtering, accept a structured filter parameter:

```
GET /api/v1/users?filter=status eq "active" and age gte 18
```

Or use a JSON body with POST:

```http
POST /api/v1/users/search
Content-Type: application/json

{
  "filter": {
    "and": [
      { "field": "status", "op": "eq", "value": "active" },
      { "field": "age", "op": "gte", "value": 18 }
    ]
  }
}
```

## Sorting

### Standard Sort Parameter

```
GET /api/v1/users?sort=created_at         # Ascending (default)
GET /api/v1/users?sort=-created_at        # Descending (prefix with -)
GET /api/v1/users?sort=last_name,-created_at  # Multi-field
```

### Alternative: Explicit Direction

```
GET /api/v1/users?sort_by=created_at&sort_order=desc
```

### Sort Rules

- Define a default sort order in documentation (typically `created_at desc` or `id asc`)
- Limit sortable fields to indexed columns
- Document which fields support sorting
- Reject unknown sort fields with 400 Bad Request

## Search

### Simple Search

```
GET /api/v1/users?q=jane+doe
```

### Scoped Search

```
GET /api/v1/users?search[name]=jane&search[email]=jane@
```

### Full-Text Search Response

Include relevance scoring when using full-text search:

```json
{
  "data": [
    {
      "id": "usr_123",
      "name": "Jane Doe",
      "_relevance": 0.95
    }
  ],
  "pagination": { ... }
}
```

## Agent-Friendly Pagination

AI agents iterate through paginated APIs frequently. Design for their patterns:

1. **Prefer cursor-based pagination** -- Agents process items sequentially; they rarely need random page access. Cursor-based is more reliable.
2. **Include complete navigation** -- Always return `next_cursor` or `next` URL. Agents should not need to construct pagination URLs manually.
3. **Consistent empty response** -- Return `[]` with `has_next: false`, never null or omitted fields. Agents rely on consistent shapes.
4. **Auto-pagination support** -- Provide SDK helpers or document the iteration pattern clearly:

```python
# Ideal agent pattern
cursor = None
all_users = []
while True:
    response = api.list_users(limit=100, after=cursor)
    all_users.extend(response.data)
    if not response.pagination.has_next:
        break
    cursor = response.pagination.next_cursor
```

5. **Rate-limit awareness** -- If an agent paginates rapidly, return 429 with `Retry-After` rather than silently throttling or returning partial data.
