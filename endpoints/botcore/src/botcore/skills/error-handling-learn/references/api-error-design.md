# Structured API Error Design

RFC 9457 Problem Details, error code registries, and machine-readable error responses for REST, GraphQL, and agent-consumable APIs.

## RFC 9457: Problem Details for HTTP APIs

RFC 9457 (supersedes RFC 7807) defines a standard JSON format for describing errors in HTTP API responses. All REST APIs should use this format.

### Standard Fields

```json
{
  "type": "https://api.example.com/errors/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "The 'email' field must be a valid email address.",
  "instance": "/api/v1/users/usr_abc123"
}
```

| Field | Required | Description |
|---|---|---|
| `type` | Recommended | URI identifying the problem type. Defaults to `about:blank`. Should resolve to documentation. |
| `title` | Recommended | Short, human-readable summary. Must NOT change between occurrences of the same type. |
| `status` | Recommended | HTTP status code. Must match the actual response status. |
| `detail` | Optional | Human-readable explanation specific to this occurrence. |
| `instance` | Optional | URI identifying this specific occurrence (for support/debugging). |

### Content Type

Always set: `Content-Type: application/problem+json`

### Extension Fields

Add domain-specific fields for richer error information:

```json
{
  "type": "https://api.example.com/errors/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "3 fields failed validation.",
  "trace_id": "req_abc123def456",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-06-15T10:30:00Z",
  "errors": [
    {
      "field": "email",
      "code": "INVALID_FORMAT",
      "message": "Must be a valid email address",
      "pointer": "/data/email"
    },
    {
      "field": "age",
      "code": "OUT_OF_RANGE",
      "message": "Must be between 18 and 150",
      "minimum": 18,
      "maximum": 150,
      "actual": 15,
      "pointer": "/data/age"
    },
    {
      "field": "username",
      "code": "ALREADY_EXISTS",
      "message": "This username is already taken",
      "pointer": "/data/username"
    }
  ]
}
```

### Retry Information

For retryable errors, include machine-readable retry guidance:

```json
{
  "type": "https://api.example.com/errors/rate-limited",
  "title": "Rate Limited",
  "status": 429,
  "detail": "Rate limit of 100 requests per minute exceeded for API key ak_xxx.",
  "retry_after_seconds": 30,
  "rate_limit": {
    "limit": 100,
    "window": "60s",
    "remaining": 0,
    "reset_at": "2025-06-15T10:31:00Z"
  }
}
```

Also set the standard HTTP header: `Retry-After: 30`

### Transient Server Errors

```json
{
  "type": "https://api.example.com/errors/service-unavailable",
  "title": "Service Temporarily Unavailable",
  "status": 503,
  "detail": "The database is currently undergoing maintenance.",
  "retry_after_seconds": 120,
  "estimated_recovery": "2025-06-15T11:00:00Z"
}
```

## Error Code Registry

Define a finite, stable set of error codes. Publish them in your API documentation. Agents and clients rely on these for programmatic error handling.

### Registry Format

```typescript
// errors/registry.ts
export const ERROR_REGISTRY = {
  // --- Validation (4xx) ---
  VALIDATION_ERROR: {
    httpStatus: 422,
    title: 'Validation Failed',
    retryable: false,
    description: 'One or more request fields failed validation.',
    resolution: 'Check the errors array for field-level details and correct the request.',
  },
  INVALID_FORMAT: {
    httpStatus: 422,
    title: 'Invalid Format',
    retryable: false,
    description: 'A field value does not match the expected format.',
    resolution: 'Check the field documentation for the correct format.',
  },
  OUT_OF_RANGE: {
    httpStatus: 422,
    title: 'Value Out of Range',
    retryable: false,
    description: 'A numeric or date field is outside the allowed range.',
    resolution: 'Adjust the value to be within minimum and maximum bounds.',
  },

  // --- Resource (4xx) ---
  NOT_FOUND: {
    httpStatus: 404,
    title: 'Resource Not Found',
    retryable: false,
    description: 'The requested resource does not exist.',
    resolution: 'Verify the resource ID and that it has not been deleted.',
  },
  ALREADY_EXISTS: {
    httpStatus: 409,
    title: 'Resource Already Exists',
    retryable: false,
    description: 'A resource with the provided identifier already exists.',
    resolution: 'Use a different identifier or update the existing resource.',
  },
  CONFLICT: {
    httpStatus: 409,
    title: 'State Conflict',
    retryable: false,
    description: 'The request conflicts with the current resource state.',
    resolution: 'Fetch the latest resource state and retry with updated data.',
  },
  GONE: {
    httpStatus: 410,
    title: 'Resource Permanently Removed',
    retryable: false,
    description: 'The resource has been permanently deleted.',
    resolution: 'Stop requesting this resource. It will not return.',
  },

  // --- Authentication / Authorization (4xx) ---
  UNAUTHORIZED: {
    httpStatus: 401,
    title: 'Authentication Required',
    retryable: false,
    description: 'Missing or invalid authentication credentials.',
    resolution: 'Provide valid credentials. If token expired, refresh and retry.',
  },
  FORBIDDEN: {
    httpStatus: 403,
    title: 'Insufficient Permissions',
    retryable: false,
    description: 'The authenticated identity lacks permission for this action.',
    resolution: 'Request the required scope or role from an administrator.',
  },

  // --- Rate Limiting (4xx) ---
  RATE_LIMITED: {
    httpStatus: 429,
    title: 'Too Many Requests',
    retryable: true,
    description: 'Request rate limit exceeded.',
    resolution: 'Wait for retry_after_seconds and retry. Reduce request frequency.',
  },

  // --- Server (5xx) ---
  INTERNAL_ERROR: {
    httpStatus: 500,
    title: 'Internal Server Error',
    retryable: true,
    description: 'An unexpected error occurred on the server.',
    resolution: 'Retry with exponential backoff. If persistent, contact support with trace_id.',
  },
  DEPENDENCY_FAILED: {
    httpStatus: 502,
    title: 'Upstream Service Failed',
    retryable: true,
    description: 'A required upstream service returned an error.',
    resolution: 'Retry with exponential backoff.',
  },
  SERVICE_UNAVAILABLE: {
    httpStatus: 503,
    title: 'Service Temporarily Unavailable',
    retryable: true,
    description: 'The service is temporarily unable to handle the request.',
    resolution: 'Wait for retry_after_seconds and retry.',
  },
  TIMEOUT: {
    httpStatus: 504,
    title: 'Gateway Timeout',
    retryable: true,
    description: 'The server did not receive a timely response from an upstream service.',
    resolution: 'Retry with exponential backoff.',
  },
} as const;

type ErrorCode = keyof typeof ERROR_REGISTRY;
```

## TypeScript Implementation

### Problem Details Builder

```typescript
interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  trace_id?: string;
  timestamp?: string;
  errors?: FieldError[];
  retry_after_seconds?: number;
  [key: string]: unknown;
}

interface FieldError {
  field: string;
  code: string;
  message: string;
  pointer?: string;
  [key: string]: unknown;
}

class ProblemDetailsBuilder {
  private problem: ProblemDetails;

  constructor(code: ErrorCode) {
    const registry = ERROR_REGISTRY[code];
    this.problem = {
      type: `https://api.example.com/errors/${code.toLowerCase().replace(/_/g, '-')}`,
      title: registry.title,
      status: registry.httpStatus,
      timestamp: new Date().toISOString(),
    };
  }

  detail(detail: string): this {
    this.problem.detail = detail;
    return this;
  }

  instance(instance: string): this {
    this.problem.instance = instance;
    return this;
  }

  traceId(traceId: string): this {
    this.problem.trace_id = traceId;
    return this;
  }

  fieldErrors(errors: FieldError[]): this {
    this.problem.errors = errors;
    return this;
  }

  retryAfter(seconds: number): this {
    this.problem.retry_after_seconds = seconds;
    return this;
  }

  extend(fields: Record<string, unknown>): this {
    Object.assign(this.problem, fields);
    return this;
  }

  build(): ProblemDetails {
    return { ...this.problem };
  }
}

// Usage
const error = new ProblemDetailsBuilder('VALIDATION_ERROR')
  .detail('2 fields failed validation.')
  .traceId(requestContext.traceId)
  .instance(`/api/v1/users/${userId}`)
  .fieldErrors([
    { field: 'email', code: 'INVALID_FORMAT', message: 'Must be a valid email', pointer: '/data/email' },
    { field: 'age', code: 'OUT_OF_RANGE', message: 'Must be at least 18', pointer: '/data/age', minimum: 18, actual: 15 },
  ])
  .build();
```

### Express/Fastify Error Middleware

```typescript
// Express middleware
function problemDetailsErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const traceId = req.headers['x-request-id'] as string ?? crypto.randomUUID();

  if (err instanceof AppError) {
    const registry = ERROR_REGISTRY[err.code as ErrorCode];
    const status = registry?.httpStatus ?? 500;

    res.status(status).type('application/problem+json').json({
      type: `https://api.example.com/errors/${err.code.toLowerCase().replace(/_/g, '-')}`,
      title: registry?.title ?? err.name,
      status,
      detail: err.message,
      trace_id: traceId,
      timestamp: new Date().toISOString(),
      ...(err instanceof ValidationError && { errors: err.fieldErrors }),
      ...(err.retryable && { retry_after_seconds: 5 }),
    });
    return;
  }

  // Unknown error -- don't expose internals
  logger.error('Unhandled error', { error: err, traceId });
  res.status(500).type('application/problem+json').json({
    type: 'https://api.example.com/errors/internal-error',
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected error occurred. Please try again later.',
    trace_id: traceId,
    timestamp: new Date().toISOString(),
  });
}
```

## Python Implementation

### FastAPI Error Handlers

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

class ProblemDetail(BaseModel):
    type: str
    title: str
    status: int
    detail: str | None = None
    instance: str | None = None
    trace_id: str | None = None
    timestamp: str | None = None
    errors: list[dict] | None = None
    retry_after_seconds: int | None = None

app = FastAPI()

@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    trace_id = request.headers.get("x-request-id", str(uuid.uuid4()))
    code_meta = ErrorCodes[exc.code].value

    problem = ProblemDetail(
        type=f"https://api.example.com/errors/{exc.code.lower().replace('_', '-')}",
        title=code_meta.title if hasattr(code_meta, 'title') else exc.code,
        status=code_meta.http_status,
        detail=str(exc),
        instance=str(request.url),
        trace_id=trace_id,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )

    if isinstance(exc, ValidationError) and exc.field_errors:
        problem.errors = [
            {"field": fe.field, "code": fe.code, "message": fe.message}
            for fe in exc.field_errors
        ]

    if exc.retryable:
        problem.retry_after_seconds = 5

    return JSONResponse(
        status_code=code_meta.http_status,
        content=problem.model_dump(exclude_none=True),
        media_type="application/problem+json",
    )

@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    trace_id = request.headers.get("x-request-id", str(uuid.uuid4()))
    logger.error("Unhandled error", exc_info=exc, extra={"trace_id": trace_id})

    return JSONResponse(
        status_code=500,
        content={
            "type": "https://api.example.com/errors/internal-error",
            "title": "Internal Server Error",
            "status": 500,
            "detail": "An unexpected error occurred. Please try again later.",
            "trace_id": trace_id,
        },
        media_type="application/problem+json",
    )
```

## GraphQL Error Patterns

GraphQL has its own error conventions. Use the `extensions` object for structured error metadata:

```typescript
// Business logic errors go in the mutation payload
type CreateUserPayload {
  user: User
  errors: [UserError!]!
}

type UserError {
  field: String!
  code: String!
  message: String!
}

// Transport/auth errors go in the top-level errors array
{
  "errors": [
    {
      "message": "Rate limit exceeded",
      "extensions": {
        "code": "RATE_LIMITED",
        "retryable": true,
        "retry_after_seconds": 30,
        "timestamp": "2025-06-15T10:30:00Z"
      }
    }
  ]
}
```

## Agent-Friendly Error Design

When APIs are consumed by AI agents:

1. **Stable string codes** -- Agents match on codes, not messages. Codes must never change without a major version bump.
2. **Actionable details** -- Include what went wrong AND what the consumer should do:
   ```json
   {
     "detail": "The 'email' field is required. Provide a valid email address in the 'email' field of the request body."
   }
   ```
3. **Structured field errors** -- Agents can programmatically fix validation errors and retry:
   ```json
   { "field": "email", "code": "REQUIRED", "message": "Email is required", "pointer": "/data/email" }
   ```
4. **Retry metadata** -- Always include `retry_after_seconds` for 429 and 5xx errors.
5. **Documentation links** -- The `type` URI should resolve to a page documenting the error and fix.
6. **Consistent shape** -- Every error uses the same structure. Inconsistent shapes break agent parsers.
7. **Idempotency support** -- Accept `Idempotency-Key` header so agents can safely retry POST/PATCH without duplicates.

## Retryable vs Non-Retryable Quick Reference

| Status | Code | Retryable | Agent Action |
|---|---|---|---|
| 400 | VALIDATION_ERROR | No | Fix request body and resubmit |
| 401 | UNAUTHORIZED | No* | Refresh token, then retry once |
| 403 | FORBIDDEN | No | Report to user, do not retry |
| 404 | NOT_FOUND | No | Verify resource ID |
| 409 | CONFLICT | No* | Fetch latest state, merge, retry once |
| 410 | GONE | No | Remove from cache, stop requesting |
| 422 | VALIDATION_ERROR | No | Fix specific fields and resubmit |
| 429 | RATE_LIMITED | Yes | Wait retry_after_seconds, then retry |
| 500 | INTERNAL_ERROR | Yes | Retry with exponential backoff |
| 502 | DEPENDENCY_FAILED | Yes | Retry with exponential backoff |
| 503 | SERVICE_UNAVAILABLE | Yes | Wait retry_after_seconds, then retry |
| 504 | TIMEOUT | Yes | Retry with exponential backoff |

\* These have conditional retry: one retry after corrective action (token refresh, state re-fetch), not blind retries.
