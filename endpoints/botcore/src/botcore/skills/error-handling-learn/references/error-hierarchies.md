# Custom Error Hierarchies

Patterns for building domain-specific error classes with context, codes, and metadata in TypeScript and Python.

## TypeScript Error Hierarchies

### Base Application Error

```typescript
interface ErrorContext {
  [key: string]: unknown;
}

abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly severity: 'warning' | 'error' | 'fatal';
  abstract readonly retryable: boolean;
  readonly timestamp: Date;
  readonly context: ErrorContext;
  readonly traceId?: string;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      context?: ErrorContext;
      traceId?: string;
    }
  ) {
    super(message, { cause: options?.cause });
    this.name = this.constructor.name;
    this.timestamp = new Date();
    this.context = options?.context ?? {};
    this.traceId = options?.traceId;

    // Fix prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Serializable representation for logging and API responses */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      severity: this.severity,
      retryable: this.retryable,
      context: this.context,
      traceId: this.traceId,
      timestamp: this.timestamp.toISOString(),
      cause: this.cause instanceof AppError ? this.cause.toJSON() : this.cause?.toString(),
    };
  }
}
```

### Domain Error Categories

```typescript
// --- Infrastructure Errors ---

class NetworkError extends AppError {
  readonly code = 'NETWORK_ERROR';
  readonly severity = 'error' as const;
  readonly retryable = true;
}

class DatabaseError extends AppError {
  readonly code = 'DATABASE_ERROR';
  readonly severity = 'error' as const;
  readonly retryable: boolean;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      context?: ErrorContext;
      traceId?: string;
      retryable?: boolean;
    }
  ) {
    super(message, options);
    this.retryable = options?.retryable ?? true;
  }
}

class TimeoutError extends AppError {
  readonly code = 'TIMEOUT';
  readonly severity = 'error' as const;
  readonly retryable = true;

  constructor(
    message: string,
    public readonly timeoutMs: number,
    options?: { cause?: Error; context?: ErrorContext; traceId?: string }
  ) {
    super(message, options);
  }
}

// --- Business Logic Errors ---

class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR';
  readonly severity = 'warning' as const;
  readonly retryable = false;

  constructor(
    message: string,
    public readonly fieldErrors: Array<{
      field: string;
      code: string;
      message: string;
      actual?: unknown;
      expected?: unknown;
    }>,
    options?: { context?: ErrorContext; traceId?: string }
  ) {
    super(message, options);
  }
}

class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND';
  readonly severity = 'warning' as const;
  readonly retryable = false;

  constructor(
    public readonly resourceType: string,
    public readonly resourceId: string,
    options?: { context?: ErrorContext; traceId?: string }
  ) {
    super(`${resourceType} '${resourceId}' not found`, options);
  }
}

class ConflictError extends AppError {
  readonly code = 'CONFLICT';
  readonly severity = 'warning' as const;
  readonly retryable = false;
}

class AuthorizationError extends AppError {
  readonly code = 'FORBIDDEN';
  readonly severity = 'error' as const;
  readonly retryable = false;
}

// --- External Service Errors ---

class ExternalServiceError extends AppError {
  readonly code = 'EXTERNAL_SERVICE_ERROR';
  readonly severity = 'error' as const;
  readonly retryable: boolean;

  constructor(
    public readonly serviceName: string,
    public readonly statusCode: number | undefined,
    message: string,
    options?: { cause?: Error; context?: ErrorContext; traceId?: string }
  ) {
    super(`[${serviceName}] ${message}`, options);
    this.retryable = statusCode !== undefined &&
      [408, 429, 500, 502, 503, 504].includes(statusCode);
  }
}

// --- Configuration Errors ---

class ConfigError extends AppError {
  readonly code = 'CONFIG_ERROR';
  readonly severity = 'fatal' as const;
  readonly retryable = false;

  constructor(
    public readonly configKey: string,
    message: string,
    options?: { context?: ErrorContext }
  ) {
    super(`Configuration error for '${configKey}': ${message}`, options);
  }
}
```

### Error Factory Pattern

```typescript
/**
 * Factory for creating errors with consistent trace IDs and context
 * propagation. Use this in service layers to create errors with
 * request-scoped metadata automatically attached.
 */
class ErrorFactory {
  constructor(
    private readonly serviceName: string,
    private readonly traceIdProvider: () => string
  ) {}

  notFound(resourceType: string, resourceId: string): NotFoundError {
    return new NotFoundError(resourceType, resourceId, {
      traceId: this.traceIdProvider(),
      context: { service: this.serviceName },
    });
  }

  validation(
    message: string,
    fieldErrors: ValidationError['fieldErrors']
  ): ValidationError {
    return new ValidationError(message, fieldErrors, {
      traceId: this.traceIdProvider(),
      context: { service: this.serviceName },
    });
  }

  external(
    serviceName: string,
    statusCode: number | undefined,
    message: string,
    cause?: Error
  ): ExternalServiceError {
    return new ExternalServiceError(serviceName, statusCode, message, {
      cause,
      traceId: this.traceIdProvider(),
      context: { service: this.serviceName },
    });
  }

  database(message: string, cause?: Error, retryable?: boolean): DatabaseError {
    return new DatabaseError(message, {
      cause,
      retryable,
      traceId: this.traceIdProvider(),
      context: { service: this.serviceName },
    });
  }
}
```

### Type Guards for Error Narrowing

```typescript
function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

function isRetryable(error: unknown): boolean {
  if (isAppError(error)) return error.retryable;
  // Network errors from fetch are retryable
  if (error instanceof TypeError && error.message.includes('fetch')) return true;
  return false;
}

function getErrorCode(error: unknown): string {
  if (isAppError(error)) return error.code;
  if (error instanceof Error) return 'UNKNOWN_ERROR';
  return 'NON_ERROR_THROWN';
}

/** Safely extract an Error from unknown catch values */
function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  return new Error(`Non-error thrown: ${JSON.stringify(value)}`);
}
```

## Python Error Hierarchies

### Base Application Error

```python
from __future__ import annotations

import traceback
from datetime import datetime, timezone
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Severity(Enum):
    WARNING = "warning"
    ERROR = "error"
    FATAL = "fatal"


class AppError(Exception):
    """Base class for all application errors."""

    code: str = "UNKNOWN_ERROR"
    severity: Severity = Severity.ERROR
    retryable: bool = False

    def __init__(
        self,
        message: str,
        *,
        cause: Exception | None = None,
        context: dict[str, Any] | None = None,
        trace_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.__cause__ = cause
        self.context = context or {}
        self.trace_id = trace_id
        self.timestamp = datetime.now(timezone.utc)

    def to_dict(self) -> dict[str, Any]:
        """Serializable representation for logging and API responses."""
        return {
            "code": self.code,
            "message": str(self),
            "severity": self.severity.value,
            "retryable": self.retryable,
            "context": self.context,
            "trace_id": self.trace_id,
            "timestamp": self.timestamp.isoformat(),
            "cause": str(self.__cause__) if self.__cause__ else None,
        }
```

### Domain Error Classes

```python
# --- Infrastructure Errors ---

class NetworkError(AppError):
    code = "NETWORK_ERROR"
    severity = Severity.ERROR
    retryable = True


class DatabaseError(AppError):
    code = "DATABASE_ERROR"
    severity = Severity.ERROR
    retryable = True

    def __init__(self, message: str, *, retryable: bool = True, **kwargs: Any) -> None:
        super().__init__(message, **kwargs)
        self.retryable = retryable


class TimeoutError(AppError):
    code = "TIMEOUT"
    severity = Severity.ERROR
    retryable = True

    def __init__(self, message: str, *, timeout_ms: int, **kwargs: Any) -> None:
        super().__init__(message, **kwargs)
        self.timeout_ms = timeout_ms


# --- Business Logic Errors ---

@dataclass
class FieldError:
    field: str
    code: str
    message: str
    actual: Any = None
    expected: Any = None


class ValidationError(AppError):
    code = "VALIDATION_ERROR"
    severity = Severity.WARNING
    retryable = False

    def __init__(
        self,
        message: str,
        *,
        field_errors: list[FieldError] | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(message, **kwargs)
        self.field_errors = field_errors or []


class NotFoundError(AppError):
    code = "NOT_FOUND"
    severity = Severity.WARNING
    retryable = False

    def __init__(
        self,
        resource_type: str,
        resource_id: str,
        **kwargs: Any,
    ) -> None:
        super().__init__(f"{resource_type} '{resource_id}' not found", **kwargs)
        self.resource_type = resource_type
        self.resource_id = resource_id


class ConflictError(AppError):
    code = "CONFLICT"
    severity = Severity.WARNING
    retryable = False


class AuthorizationError(AppError):
    code = "FORBIDDEN"
    severity = Severity.ERROR
    retryable = False


# --- External Service Errors ---

class ExternalServiceError(AppError):
    code = "EXTERNAL_SERVICE_ERROR"
    severity = Severity.ERROR

    RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}

    def __init__(
        self,
        service_name: str,
        status_code: int | None,
        message: str,
        **kwargs: Any,
    ) -> None:
        super().__init__(f"[{service_name}] {message}", **kwargs)
        self.service_name = service_name
        self.status_code = status_code
        self.retryable = (
            status_code in self.RETRYABLE_STATUS_CODES
            if status_code is not None
            else False
        )


# --- Configuration Errors ---

class ConfigError(AppError):
    code = "CONFIG_ERROR"
    severity = Severity.FATAL
    retryable = False

    def __init__(self, config_key: str, message: str, **kwargs: Any) -> None:
        super().__init__(
            f"Configuration error for '{config_key}': {message}", **kwargs
        )
        self.config_key = config_key
```

### Python Exception Groups (3.11+)

```python
import sys

# Accumulate multiple errors and raise together
def validate_user_input(data: dict) -> None:
    errors: list[Exception] = []

    if not data.get("email"):
        errors.append(ValidationError(
            "Email is required",
            field_errors=[FieldError("email", "REQUIRED", "Email is required")],
        ))

    if not data.get("name"):
        errors.append(ValidationError(
            "Name is required",
            field_errors=[FieldError("name", "REQUIRED", "Name is required")],
        ))

    age = data.get("age")
    if age is not None and age < 18:
        errors.append(ValidationError(
            "Must be at least 18",
            field_errors=[FieldError("age", "OUT_OF_RANGE", "Must be at least 18", actual=age)],
        ))

    if errors:
        raise ExceptionGroup("Validation failed", errors)


# Handle exception groups with except*
try:
    validate_user_input({"age": 15})
except* ValidationError as eg:
    # eg.exceptions contains all ValidationError instances
    all_field_errors = []
    for exc in eg.exceptions:
        all_field_errors.extend(exc.field_errors)
    print(f"Validation errors: {all_field_errors}")
```

### Adding Notes to Exceptions (3.11+)

```python
def process_order(order_id: str) -> None:
    try:
        order = fetch_order(order_id)
    except DatabaseError as e:
        e.add_note(f"Processing order {order_id} during batch job")
        e.add_note(f"Batch started at {batch_start_time}")
        raise  # Notes are preserved in the traceback
```

## Error Code Registry Pattern

### TypeScript

```typescript
/**
 * Central error code registry. All error codes in the system
 * must be registered here. This serves as documentation and
 * enables exhaustive handling.
 */
const ERROR_CODES = {
  // Infrastructure
  NETWORK_ERROR: { severity: 'error', retryable: true, httpStatus: 502 },
  DATABASE_ERROR: { severity: 'error', retryable: true, httpStatus: 500 },
  TIMEOUT: { severity: 'error', retryable: true, httpStatus: 504 },
  CONFIG_ERROR: { severity: 'fatal', retryable: false, httpStatus: 500 },

  // Business logic
  VALIDATION_ERROR: { severity: 'warning', retryable: false, httpStatus: 422 },
  NOT_FOUND: { severity: 'warning', retryable: false, httpStatus: 404 },
  CONFLICT: { severity: 'warning', retryable: false, httpStatus: 409 },
  FORBIDDEN: { severity: 'error', retryable: false, httpStatus: 403 },
  UNAUTHORIZED: { severity: 'error', retryable: false, httpStatus: 401 },

  // External
  EXTERNAL_SERVICE_ERROR: { severity: 'error', retryable: true, httpStatus: 502 },
  RATE_LIMITED: { severity: 'warning', retryable: true, httpStatus: 429 },
} as const;

type ErrorCode = keyof typeof ERROR_CODES;
```

### Python

```python
from enum import Enum
from dataclasses import dataclass


@dataclass(frozen=True)
class ErrorCodeMeta:
    severity: Severity
    retryable: bool
    http_status: int


class ErrorCodes(Enum):
    """Central error code registry."""
    NETWORK_ERROR = ErrorCodeMeta(Severity.ERROR, True, 502)
    DATABASE_ERROR = ErrorCodeMeta(Severity.ERROR, True, 500)
    TIMEOUT = ErrorCodeMeta(Severity.ERROR, True, 504)
    CONFIG_ERROR = ErrorCodeMeta(Severity.FATAL, False, 500)
    VALIDATION_ERROR = ErrorCodeMeta(Severity.WARNING, False, 422)
    NOT_FOUND = ErrorCodeMeta(Severity.WARNING, False, 404)
    CONFLICT = ErrorCodeMeta(Severity.WARNING, False, 409)
    FORBIDDEN = ErrorCodeMeta(Severity.ERROR, False, 403)
    UNAUTHORIZED = ErrorCodeMeta(Severity.ERROR, False, 401)
    EXTERNAL_SERVICE_ERROR = ErrorCodeMeta(Severity.ERROR, True, 502)
    RATE_LIMITED = ErrorCodeMeta(Severity.WARNING, True, 429)
```

## Anti-Patterns

- **Catching `unknown` / bare `except Exception`** -- Always narrow to specific error types. Broad catches mask bugs.
- **Losing the cause chain** -- Always pass `{ cause: originalError }` (TS) or set `__cause__` (Python) when wrapping errors.
- **Error messages as API contracts** -- Consumers should match on error codes, never on message strings.
- **Mutable error objects** -- Error properties should be readonly/frozen. Errors are facts about what happened.
- **Logging and rethrowing without context** -- If you catch to add context, use `add_note()` (Python 3.11+) or wrap in a new error with cause.
- **String-only errors** -- `throw 'something failed'` or `raise Exception("oops")` provides no structure for programmatic handling.
