# Error Observability

Structured error logging, error tracking integration, error budgets, alerting strategies, and dashboards for production error management.

## Structured Error Logging

### Principles

1. **Structured, not string** -- Log errors as structured JSON objects, not concatenated strings
2. **Context-rich** -- Include error code, severity, trace ID, user context, and operation metadata
3. **No secrets** -- Never log tokens, passwords, PII, or internal paths in error context
4. **Consistent schema** -- Every log entry follows the same field schema for parsing
5. **Severity-mapped** -- Map error severity to log levels (warning, error, fatal/critical)

### TypeScript Structured Error Logger

```typescript
interface ErrorLogEntry {
  level: 'warn' | 'error' | 'fatal';
  message: string;
  error: {
    code: string;
    name: string;
    severity: string;
    retryable: boolean;
    stack?: string;
  };
  context: Record<string, unknown>;
  trace_id?: string;
  request_id?: string;
  service: string;
  timestamp: string;
}

class ErrorLogger {
  constructor(
    private readonly serviceName: string,
    private readonly logger: Logger
  ) {}

  logError(error: unknown, context?: Record<string, unknown>): void {
    const entry = this.buildEntry(error, context);

    switch (entry.level) {
      case 'fatal':
        this.logger.fatal(entry);
        break;
      case 'error':
        this.logger.error(entry);
        break;
      case 'warn':
        this.logger.warn(entry);
        break;
    }
  }

  private buildEntry(
    error: unknown,
    context?: Record<string, unknown>
  ): ErrorLogEntry {
    if (error instanceof AppError) {
      return {
        level: this.severityToLevel(error.severity),
        message: error.message,
        error: {
          code: error.code,
          name: error.name,
          severity: error.severity,
          retryable: error.retryable,
          stack: error.stack,
        },
        context: { ...error.context, ...context },
        trace_id: error.traceId,
        service: this.serviceName,
        timestamp: new Date().toISOString(),
      };
    }

    // Unknown error
    const err = toError(error);
    return {
      level: 'error',
      message: err.message,
      error: {
        code: 'UNKNOWN_ERROR',
        name: err.name,
        severity: 'error',
        retryable: false,
        stack: err.stack,
      },
      context: context ?? {},
      service: this.serviceName,
      timestamp: new Date().toISOString(),
    };
  }

  private severityToLevel(severity: string): 'warn' | 'error' | 'fatal' {
    switch (severity) {
      case 'warning': return 'warn';
      case 'fatal': return 'fatal';
      default: return 'error';
    }
  }
}
```

### Python Structured Error Logger

```python
import logging
import json
from typing import Any

class StructuredErrorFormatter(logging.Formatter):
    """JSON formatter that includes error context as structured fields."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "level": record.levelname.lower(),
            "message": record.getMessage(),
            "service": getattr(record, "service", "unknown"),
            "timestamp": self.formatTime(record),
            "logger": record.name,
        }

        # Include error details if present
        if record.exc_info and record.exc_info[1]:
            exc = record.exc_info[1]
            if isinstance(exc, AppError):
                log_entry["error"] = exc.to_dict()
            else:
                log_entry["error"] = {
                    "code": "UNKNOWN_ERROR",
                    "name": type(exc).__name__,
                    "message": str(exc),
                    "severity": "error",
                    "retryable": False,
                }

        # Include extra context fields
        for key in ("trace_id", "request_id", "context"):
            if hasattr(record, key):
                log_entry[key] = getattr(record, key)

        return json.dumps(log_entry, default=str)


def setup_structured_logging(service_name: str, level: int = logging.INFO) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(StructuredErrorFormatter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)

    # Add service name as a filter
    class ServiceFilter(logging.Filter):
        def filter(self, record):
            record.service = service_name
            return True

    root.addFilter(ServiceFilter())
```

## Error Tracking Integration (Sentry)

### TypeScript (Node.js)

```typescript
import * as Sentry from '@sentry/node';

// Initialization
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.APP_VERSION,
  tracesSampleRate: 0.1,         // 10% of transactions for performance
  profilesSampleRate: 0.1,
  beforeSend(event, hint) {
    const error = hint.originalException;

    // Don't send expected business errors to Sentry
    if (error instanceof AppError && error.severity === 'warning') {
      return null;
    }

    // Scrub sensitive data
    if (event.request?.headers) {
      delete event.request.headers['authorization'];
      delete event.request.headers['cookie'];
    }

    return event;
  },
  // Ignore known non-actionable errors
  ignoreErrors: [
    'AbortError',
    'ResizeObserver loop',
    /Loading chunk \d+ failed/,
  ],
});

// Capture with context
function captureAppError(error: AppError, extras?: Record<string, unknown>): void {
  Sentry.withScope(scope => {
    scope.setTag('error_code', error.code);
    scope.setTag('error_severity', error.severity);
    scope.setTag('retryable', String(error.retryable));
    scope.setLevel(error.severity === 'fatal' ? 'fatal' : 'error');
    scope.setContext('error_context', error.context);

    if (error.traceId) {
      scope.setTag('trace_id', error.traceId);
    }

    if (extras) {
      scope.setContext('extras', extras);
    }

    Sentry.captureException(error);
  });
}

// Express integration
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());
// ... routes ...
app.use(Sentry.Handlers.errorHandler({
  shouldHandleError(error) {
    // Only send 5xx and unhandled errors to Sentry
    if (error instanceof AppError) {
      return error.severity !== 'warning';
    }
    return true;
  },
}));
```

### Python

```python
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration

sentry_sdk.init(
    dsn=os.environ["SENTRY_DSN"],
    environment=os.environ.get("ENV", "development"),
    release=os.environ.get("APP_VERSION"),
    traces_sample_rate=0.1,
    profiles_sample_rate=0.1,
    before_send=filter_sentry_events,
)

def filter_sentry_events(event, hint):
    """Filter out expected business errors."""
    exc = hint.get("exc_info")
    if exc:
        exc_type, exc_value, _ = exc
        if isinstance(exc_value, AppError) and exc_value.severity == Severity.WARNING:
            return None  # Don't send to Sentry
    return event

def capture_app_error(error: AppError, **extras: Any) -> None:
    with sentry_sdk.push_scope() as scope:
        scope.set_tag("error_code", error.code)
        scope.set_tag("error_severity", error.severity.value)
        scope.set_tag("retryable", str(error.retryable))
        scope.set_context("error_context", error.context)
        if error.trace_id:
            scope.set_tag("trace_id", error.trace_id)
        if extras:
            scope.set_context("extras", extras)
        sentry_sdk.capture_exception(error)
```

## Error Budgets and SLOs

### Concept

An error budget is the maximum allowable error rate derived from your Service Level Objective (SLO):

```
SLO = 99.9% availability
Error budget = 100% - 99.9% = 0.1%
Per month: ~43 minutes of downtime or ~43,200 errors per 43.2M requests
```

### Implementation

```typescript
interface ErrorBudget {
  sloTarget: number;           // e.g., 0.999 (99.9%)
  windowDays: number;          // e.g., 30 (rolling 30-day window)
  totalRequests: number;       // Requests in window
  totalErrors: number;         // Errors in window
  budgetRemaining: number;     // Percentage of budget left (0-100%)
  burnRate: number;            // How fast budget is burning (1.0 = normal)
}

function calculateErrorBudget(
  sloTarget: number,
  totalRequests: number,
  totalErrors: number,
  windowDays: number,
  elapsedDays: number
): ErrorBudget {
  const errorRate = totalErrors / totalRequests;
  const allowedErrorRate = 1 - sloTarget;
  const budgetUsed = errorRate / allowedErrorRate;
  const budgetRemaining = Math.max(0, (1 - budgetUsed) * 100);

  // Burn rate: >1 means burning faster than sustainable
  const expectedBudgetUsed = elapsedDays / windowDays;
  const burnRate = budgetUsed / (expectedBudgetUsed || 1);

  return {
    sloTarget,
    windowDays,
    totalRequests,
    totalErrors,
    budgetRemaining,
    burnRate,
  };
}
```

### Alert Thresholds

| Condition | Burn Rate | Action |
|---|---|---|
| Normal | < 1.0 | No action |
| Elevated | 1.0 - 2.0 | Warning alert, investigate |
| Critical | 2.0 - 10.0 | Page on-call, stop non-critical deploys |
| Emergency | > 10.0 | All hands, roll back recent changes |

### Burn Rate Alert Rules

```yaml
# Prometheus alert rules (example)
groups:
  - name: error_budget_alerts
    rules:
      - alert: ErrorBudgetBurnRateHigh
        expr: |
          (
            sum(rate(http_requests_total{status=~"5.."}[1h]))
            /
            sum(rate(http_requests_total[1h]))
          ) > (1 - 0.999) * 14.4
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Error budget burning 14.4x faster than sustainable"

      - alert: ErrorBudgetBurnRateWarning
        expr: |
          (
            sum(rate(http_requests_total{status=~"5.."}[6h]))
            /
            sum(rate(http_requests_total[6h]))
          ) > (1 - 0.999) * 6
        for: 15m
        labels:
          severity: warning
```

## Error Dashboards

### Key Metrics to Track

| Metric | Description | Granularity |
|---|---|---|
| Error rate | Errors / total requests | Per endpoint, per service |
| Error rate by code | Count per error code | Per code, per service |
| p50/p95/p99 error latency | How long before errors are returned | Per endpoint |
| New error types | First occurrence of a new error code | Global |
| Error budget remaining | % of error budget left in window | Per SLO |
| Burn rate | Speed of budget consumption | Per SLO |
| Retry rate | Retries / initial requests | Per external dependency |
| Circuit breaker state | Current state of each breaker | Per breaker |
| Unhandled exception rate | Exceptions without AppError wrapping | Per service |

### Dashboard Layout

```
Row 1: [Error Rate (30d trend)] [Error Budget Remaining] [Burn Rate]
Row 2: [Errors by Code (top 10)] [Errors by Endpoint (top 10)]
Row 3: [New Error Types (last 24h)] [Unhandled Exceptions]
Row 4: [Retry Rate by Dependency] [Circuit Breaker States]
Row 5: [Error Latency p50/p95/p99] [Error Budget Burn (7d chart)]
```

## Error Categorization for Observability

### Severity to Logging/Alerting Mapping

| Error Severity | Log Level | Sentry | Alert | Dashboard |
|---|---|---|---|---|
| Warning | warn | Skip | None (count only) | Error count chart |
| Error (retryable) | error | Capture | If rate spikes | Retry chart |
| Error (permanent) | error | Capture | If rate spikes | Error code chart |
| Fatal | fatal/critical | Capture + page | Immediate | Incident panel |

### What NOT to Send to Error Tracking

- **Expected business errors** -- Validation failures, not-found, rate limits (these are metrics, not incidents)
- **Client-caused errors** -- 4xx responses from API consumers (track as metrics instead)
- **Known third-party issues** -- Flaky external APIs you cannot fix (track as dependency health)
- **Noise** -- Browser extension errors, bot traffic errors, known browser bugs

### What to ALWAYS Send

- **Unhandled exceptions** -- Anything not wrapped in AppError
- **Fatal errors** -- Configuration missing, invariant violations
- **New error codes** -- First occurrence of an error code not seen in the last 30 days
- **Error rate anomalies** -- Sudden spike in any error code

## Correlation and Tracing

### Propagating Trace IDs

```typescript
// Middleware: extract or generate trace ID
function traceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceId = req.headers['x-trace-id'] as string
    ?? req.headers['x-request-id'] as string
    ?? `req_${crypto.randomUUID()}`;

  // Make available throughout request lifecycle
  req.traceId = traceId;
  res.setHeader('x-trace-id', traceId);

  // Set on Sentry scope
  Sentry.getCurrentScope().setTag('trace_id', traceId);

  next();
}

// All errors created during request carry the trace ID
class RequestErrorFactory extends ErrorFactory {
  constructor(req: Request) {
    super('my-service', () => req.traceId);
  }
}
```

```python
# FastAPI middleware
from contextvars import ContextVar

trace_id_var: ContextVar[str] = ContextVar("trace_id", default="unknown")

@app.middleware("http")
async def trace_middleware(request: Request, call_next):
    trace_id = (
        request.headers.get("x-trace-id")
        or request.headers.get("x-request-id")
        or f"req_{uuid.uuid4()}"
    )
    trace_id_var.set(trace_id)

    response = await call_next(request)
    response.headers["x-trace-id"] = trace_id
    return response
```

## Anti-Patterns

- **Logging errors without codes** -- Unstructured `logger.error("something failed")` is unsearchable and uncountable.
- **Sending all errors to Sentry** -- Expected 4xx errors overwhelm the error tracker. Only send unexpected/actionable errors.
- **No error budgets** -- Without an error budget, teams either over-invest in reliability or ignore errors until an outage.
- **Alerting on every error** -- Alert on error *rate changes*, not individual occurrences. Otherwise, on-call burnout.
- **Missing trace IDs** -- Without correlation IDs, debugging distributed errors requires guessing which logs go together.
- **PII in error context** -- Never log user emails, tokens, or passwords in error context fields. Redact before logging.
