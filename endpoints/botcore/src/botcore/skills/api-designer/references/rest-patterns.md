# REST API Design Patterns

Detailed reference for RESTful API design conventions, resource modeling, and HTTP semantics.

## Resource Naming

### URL Structure

```
# Collection
GET /api/v1/users

# Specific resource
GET /api/v1/users/{userId}

# Sub-resource (relationship)
GET /api/v1/users/{userId}/orders

# Specific sub-resource
GET /api/v1/users/{userId}/orders/{orderId}
```

### Naming Rules

| Rule | Good | Bad |
|------|------|-----|
| Use plural nouns for collections | `/users` | `/user`, `/getUsers` |
| Use kebab-case for multi-word | `/order-items` | `/orderItems`, `/order_items` |
| No verbs in URLs | `/users/{id}/activate` (POST) | `/activateUser` |
| No trailing slashes | `/users` | `/users/` |
| Lowercase only | `/order-items` | `/Order-Items` |
| No file extensions | `/users` | `/users.json` |
| Max 3 levels of nesting | `/users/{id}/orders` | `/users/{id}/orders/{oid}/items/{iid}/tags` |

### Resource Relationships

When nesting exceeds 3 levels, flatten with query parameters:

```
# Instead of deeply nested:
GET /users/{id}/orders/{oid}/items/{iid}/reviews

# Use top-level with filters:
GET /reviews?orderId={oid}&itemId={iid}
```

## HTTP Methods

| Method | Purpose | Idempotent | Request Body | Success Code |
|--------|---------|------------|--------------|--------------|
| GET | Retrieve resource(s) | Yes | No | 200 |
| POST | Create resource | No | Yes | 201 |
| PUT | Full replace | Yes | Yes | 200 |
| PATCH | Partial update | No* | Yes | 200 |
| DELETE | Remove resource | Yes | No | 204 |
| HEAD | Headers only (same as GET) | Yes | No | 200 |
| OPTIONS | Available methods | Yes | No | 204 |

*PATCH can be idempotent depending on implementation (JSON Merge Patch is idempotent; JSON Patch is not).

### Method Selection Guide

```
Need to read data?                  -> GET
Need to create a new resource?      -> POST
Need to replace the entire resource? -> PUT
Need to update specific fields?     -> PATCH
Need to remove a resource?          -> DELETE
Need to perform an action?          -> POST to /resource/{id}/action
```

## HTTP Status Codes

### Success (2xx)

| Code | Use When |
|------|----------|
| 200 OK | GET, PUT, PATCH success |
| 201 Created | POST creates a resource (include Location header) |
| 202 Accepted | Async operation accepted but not yet complete |
| 204 No Content | DELETE success, or PUT/PATCH with no response body |

### Client Errors (4xx)

| Code | Use When |
|------|----------|
| 400 Bad Request | Malformed syntax, invalid parameters |
| 401 Unauthorized | Missing or invalid authentication |
| 403 Forbidden | Authenticated but lacks permission |
| 404 Not Found | Resource does not exist |
| 405 Method Not Allowed | HTTP method not supported for endpoint |
| 409 Conflict | State conflict (e.g., duplicate creation, version mismatch) |
| 410 Gone | Resource permanently deleted (distinct from 404) |
| 412 Precondition Failed | If-Match / ETag mismatch (optimistic locking) |
| 415 Unsupported Media Type | Wrong Content-Type header |
| 422 Unprocessable Entity | Syntactically valid but semantically invalid |
| 429 Too Many Requests | Rate limit exceeded (include Retry-After header) |

### Server Errors (5xx)

| Code | Use When |
|------|----------|
| 500 Internal Server Error | Unhandled server failure |
| 502 Bad Gateway | Upstream service failure |
| 503 Service Unavailable | Maintenance or overload (include Retry-After) |
| 504 Gateway Timeout | Upstream service timeout |

## Headers

### Standard Request Headers

```http
Accept: application/json
Content-Type: application/json
Authorization: Bearer {token}
If-None-Match: "{etag}"          # Conditional GET (caching)
If-Match: "{etag}"               # Optimistic concurrency
Idempotency-Key: {uuid}          # Safe retries for POST
X-Request-ID: {uuid}             # Distributed tracing
```

### Standard Response Headers

```http
Content-Type: application/json
Location: /api/v1/users/123      # After 201 Created
ETag: "abc123"                   # Cache validation
Cache-Control: max-age=3600      # Caching directive
X-Request-ID: {uuid}             # Echo back for tracing
Retry-After: 60                  # After 429 or 503
X-RateLimit-Limit: 1000          # Rate limit ceiling
X-RateLimit-Remaining: 998       # Requests left
X-RateLimit-Reset: 1620000000    # Unix timestamp for reset
```

## Filtering, Sorting, and Field Selection

### Filtering

```
GET /users?status=active&role=admin
GET /orders?created_after=2025-01-01&total_gte=100
GET /products?category=electronics&price_lte=500
```

### Sorting

```
GET /users?sort=created_at        # Ascending (default)
GET /users?sort=-created_at       # Descending (prefix with -)
GET /users?sort=last_name,-created_at  # Multi-field sort
```

### Field Selection (Sparse Fieldsets)

```
GET /users?fields=id,name,email
GET /users/{id}?fields=id,name,email,address
```

## Pagination

See [pagination-and-filtering.md](pagination-and-filtering.md) for comprehensive pagination patterns.

## Content Negotiation

### JSON Envelope Pattern

```json
{
  "data": { ... },
  "meta": {
    "request_id": "abc-123",
    "timestamp": "2025-06-15T10:30:00Z"
  }
}
```

### Collection Response

```json
{
  "data": [ ... ],
  "pagination": {
    "total": 142,
    "page": 2,
    "per_page": 20,
    "next": "/api/v1/users?page=3&per_page=20",
    "prev": "/api/v1/users?page=1&per_page=20"
  }
}
```

## HATEOAS (Hypermedia Controls)

Include links for discoverability, especially for agent-consumed APIs:

```json
{
  "data": {
    "id": "usr_123",
    "name": "Jane Doe",
    "status": "active"
  },
  "links": {
    "self": "/api/v1/users/usr_123",
    "orders": "/api/v1/users/usr_123/orders",
    "deactivate": {
      "href": "/api/v1/users/usr_123/deactivate",
      "method": "POST"
    }
  }
}
```

HATEOAS links are particularly valuable for AI agents, as they enable autonomous navigation of API capabilities without hardcoding URL construction logic.

## Bulk Operations

For creating or updating multiple resources in a single request:

```http
POST /api/v1/users/bulk
Content-Type: application/json

{
  "operations": [
    { "method": "POST", "body": { "name": "Alice" } },
    { "method": "POST", "body": { "name": "Bob" } }
  ]
}
```

Response with per-item status:

```json
{
  "results": [
    { "status": 201, "data": { "id": "usr_124", "name": "Alice" } },
    { "status": 201, "data": { "id": "usr_125", "name": "Bob" } }
  ],
  "summary": { "total": 2, "succeeded": 2, "failed": 0 }
}
```

## Asynchronous Operations

For long-running operations:

```http
POST /api/v1/reports/generate
```

```http
HTTP/1.1 202 Accepted
Location: /api/v1/jobs/job_456

{
  "job_id": "job_456",
  "status": "pending",
  "poll_url": "/api/v1/jobs/job_456",
  "estimated_completion": "2025-06-15T10:35:00Z"
}
```

Polling the job:

```http
GET /api/v1/jobs/job_456

{
  "job_id": "job_456",
  "status": "completed",
  "result_url": "/api/v1/reports/rpt_789",
  "completed_at": "2025-06-15T10:34:12Z"
}
```
