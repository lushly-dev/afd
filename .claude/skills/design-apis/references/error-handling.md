# API Error Handling Patterns

Comprehensive reference for designing consistent, machine-readable error responses across API styles.

## RFC 9457: Problem Details for HTTP APIs

RFC 9457 (supersedes RFC 7807) is the standard for structured HTTP error responses. Use it for all REST APIs.

### Standard Fields

```json
{
  "type": "https://api.example.com/errors/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "The 'email' field must be a valid email address.",
  "instance": "/api/v1/users"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Recommended | URI reference identifying the problem type. Defaults to `about:blank`. |
| `title` | Recommended | Short human-readable summary. Should NOT change between occurrences. |
| `status` | Recommended | HTTP status code (matches the response status). |
| `detail` | Optional | Human-readable explanation specific to this occurrence. |
| `instance` | Optional | URI reference identifying this specific occurrence. |

### Content Type

Always set: `Content-Type: application/problem+json`

### Extension Fields

Add domain-specific fields alongside standard ones:

```json
{
  "type": "https://api.example.com/errors/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "2 fields failed validation.",
  "errors": [
    {
      "field": "email",
      "message": "Must be a valid email address",
      "code": "INVALID_FORMAT"
    },
    {
      "field": "age",
      "message": "Must be at least 18",
      "code": "OUT_OF_RANGE",
      "minimum": 18,
      "actual": 15
    }
  ],
  "trace_id": "abc-123-def"
}
```

### Multiple Problems

RFC 9457 supports reporting multiple problems. Use the `errors` array pattern above, or the compound problem type:

```json
{
  "type": "https://api.example.com/errors/compound",
  "title": "Multiple Problems",
  "status": 400,
  "problems": [
    {
      "type": "https://api.example.com/errors/missing-field",
      "title": "Missing Required Field",
      "detail": "The 'name' field is required.",
      "pointer": "/data/name"
    },
    {
      "type": "https://api.example.com/errors/invalid-format",
      "title": "Invalid Format",
      "detail": "The 'email' field is not a valid email.",
      "pointer": "/data/email"
    }
  ]
}
```

## Error Code Registry

Define a finite set of error codes that clients and agents can programmatically handle:

```
VALIDATION_ERROR        - Input fails validation rules
NOT_FOUND               - Resource does not exist
ALREADY_EXISTS          - Duplicate resource conflict
UNAUTHORIZED            - Missing or invalid credentials
FORBIDDEN               - Insufficient permissions
RATE_LIMITED            - Too many requests
CONFLICT                - State conflict (optimistic locking, etc.)
PRECONDITION_FAILED     - Required precondition not met
GONE                    - Resource permanently removed
INTERNAL_ERROR          - Unexpected server error
SERVICE_UNAVAILABLE     - Temporary outage
DEPENDENCY_FAILED       - Upstream service failure
TIMEOUT                 - Operation exceeded time limit
PAYLOAD_TOO_LARGE       - Request body exceeds size limit
UNSUPPORTED_MEDIA_TYPE  - Wrong Content-Type
METHOD_NOT_ALLOWED      - HTTP method not supported
```

Publish this registry in your API documentation. Agents rely on stable, enumerated codes for retry logic and error routing.

## Error Response by API Style

### REST

```http
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/problem+json

{
  "type": "https://api.example.com/errors/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "The email field is invalid.",
  "errors": [
    { "field": "email", "code": "INVALID_FORMAT", "message": "Must be a valid email" }
  ]
}
```

### GraphQL

GraphQL uses payload-level errors (not top-level `errors` array) for business logic:

```json
{
  "data": {
    "createUser": {
      "user": null,
      "errors": [
        {
          "field": "email",
          "code": "INVALID_FORMAT",
          "message": "Must be a valid email"
        }
      ]
    }
  }
}
```

Reserve top-level `errors` for transport/schema errors:

```json
{
  "errors": [
    {
      "message": "Authentication required",
      "extensions": {
        "code": "UNAUTHORIZED",
        "timestamp": "2025-06-15T10:30:00Z"
      }
    }
  ]
}
```

### gRPC

```go
st := status.New(codes.InvalidArgument, "email field is invalid")
st, _ = st.WithDetails(&errdetails.BadRequest{
    FieldViolations: []*errdetails.BadRequest_FieldViolation{
        {Field: "email", Description: "must be a valid email address"},
    },
})
return nil, st.Err()
```

## Retry Guidance

Include machine-readable retry information so agents and clients can automatically recover:

### Retry-After Header

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
Content-Type: application/problem+json

{
  "type": "https://api.example.com/errors/rate-limited",
  "title": "Rate Limited",
  "status": 429,
  "detail": "Rate limit of 100 requests per minute exceeded.",
  "retry_after_seconds": 30
}
```

### Retryable vs Non-Retryable

| Category | Status Codes | Agent Behavior |
|----------|-------------|----------------|
| Retryable (transient) | 408, 429, 500, 502, 503, 504 | Retry with exponential backoff |
| Non-retryable (client) | 400, 401, 403, 404, 409, 422 | Fix request and resubmit |
| Non-retryable (permanent) | 410 | Stop requesting this resource |

### Exponential Backoff Pattern

```
Attempt 1: wait 1s
Attempt 2: wait 2s
Attempt 3: wait 4s
Attempt 4: wait 8s
Max attempts: 5
Max wait: 30s
Add jitter: random(0, wait_time * 0.1)
```

## Agent-Friendly Error Design

For APIs consumed by AI agents:

1. **Stable error codes** -- Use enumerated string codes, not just HTTP status codes. Agents parse codes to decide next actions.
2. **Actionable detail messages** -- Include what went wrong AND what the agent should do differently (e.g., "Field 'email' is required. Provide a valid email address in the request body.").
3. **Structured validation errors** -- Return field-level errors with field path, code, and message so agents can programmatically fix and retry.
4. **Retry metadata** -- Always include `retry_after_seconds` for rate limits and transient errors. Agents use this to schedule retries without guessing.
5. **Link to documentation** -- The `type` URI in RFC 9457 should resolve to a human-readable page describing the error and resolution steps. Agents can fetch this for additional context.
6. **Consistent shape** -- Every error response must have the same structure. Agents break when error formats vary between endpoints.
