# Retry and Resilience Patterns

Exponential backoff, jitter, circuit breakers, bulkheads, timeouts, and fallback strategies for TypeScript and Python.

## Exponential Backoff with Jitter

### The Algorithm

```
delay = min(base_delay * (multiplier ^ attempt), max_delay)
jittered_delay = delay * random(0.5, 1.5)   // Full jitter
```

Jitter prevents the **thundering herd problem** -- without it, all clients that failed simultaneously retry at the exact same time, causing another failure spike.

### TypeScript Implementation

```typescript
interface RetryConfig {
  maxAttempts: number;       // Total attempts including the first
  baseDelayMs: number;       // Starting delay (e.g., 1000)
  maxDelayMs: number;        // Upper bound (e.g., 30000)
  multiplier: number;        // Backoff factor (e.g., 2)
  jitter: boolean;           // Add randomization
  retryableErrors?: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  multiplier: 2,
  jitter: true,
};

async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: unknown;

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      if (cfg.retryableErrors && !cfg.retryableErrors(error)) {
        throw error; // Non-retryable: fail immediately
      }

      // Last attempt: don't delay, just throw
      if (attempt === cfg.maxAttempts) break;

      // Calculate delay with exponential backoff
      const exponentialDelay = Math.min(
        cfg.baseDelayMs * Math.pow(cfg.multiplier, attempt - 1),
        cfg.maxDelayMs
      );

      // Apply jitter (full jitter: 50%-150% of calculated delay)
      const delay = cfg.jitter
        ? exponentialDelay * (0.5 + Math.random())
        : exponentialDelay;

      cfg.onRetry?.(attempt, error, delay);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
```

### Usage Examples

```typescript
// Basic usage
const data = await withRetry(
  () => fetch('/api/data').then(r => {
    if (!r.ok) throw new HttpError(r.status);
    return r.json();
  }),
  {
    maxAttempts: 5,
    retryableErrors: (e) => e instanceof HttpError && e.retryable,
    onRetry: (attempt, error, delay) => {
      logger.warn('Retrying request', { attempt, error, delayMs: delay });
    },
  }
);

// With neverthrow
import { ResultAsync } from 'neverthrow';

function fetchWithRetry<T>(
  url: string,
  config?: Partial<RetryConfig>
): ResultAsync<T, AppError> {
  return ResultAsync.fromPromise(
    withRetry(
      () => fetch(url).then(r => {
        if (!r.ok) throw new ExternalServiceError('api', r.status, r.statusText);
        return r.json() as Promise<T>;
      }),
      config
    ),
    (e) => e instanceof AppError ? e : new NetworkError('Request failed', { cause: toError(e) })
  );
}
```

### Python Implementation with tenacity

```bash
pip install tenacity
```

```python
import logging
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential_jitter,
    retry_if_exception_type,
    before_sleep_log,
    after_log,
    RetryError,
)

logger = logging.getLogger(__name__)

# Basic retry with exponential backoff + jitter
@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential_jitter(
        initial=1,      # Start at 1 second
        max=30,          # Cap at 30 seconds
        jitter=5,        # Add up to 5 seconds of jitter
    ),
    retry=retry_if_exception_type((NetworkError, TimeoutError)),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True,  # Raise the last exception instead of RetryError
)
async def fetch_with_retry(url: str) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()


# Custom retry condition
@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential_jitter(initial=1, max=10),
    retry=retry_if_exception_type(DatabaseError),
)
async def save_with_retry(data: dict) -> str:
    return await db.insert(data)


# Retry with callback for monitoring
def log_retry(retry_state):
    logger.warning(
        "Retry attempt",
        extra={
            "attempt": retry_state.attempt_number,
            "wait": retry_state.next_action.sleep if retry_state.next_action else 0,
            "exception": str(retry_state.outcome.exception()) if retry_state.outcome else None,
        },
    )

@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential_jitter(initial=1, max=30),
    before_sleep=log_retry,
    retry=retry_if_exception_type((NetworkError, ExternalServiceError)),
)
async def call_external_service(payload: dict) -> dict:
    ...
```

### Python Manual Implementation

```python
import asyncio
import random
from typing import TypeVar, Callable, Awaitable

T = TypeVar("T")

async def with_retry(
    fn: Callable[[], Awaitable[T]],
    *,
    max_attempts: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    multiplier: float = 2.0,
    jitter: bool = True,
    retryable: Callable[[Exception], bool] = lambda _: True,
    on_retry: Callable[[int, Exception, float], None] | None = None,
) -> T:
    last_error: Exception | None = None

    for attempt in range(1, max_attempts + 1):
        try:
            return await fn()
        except Exception as e:
            last_error = e
            if not retryable(e):
                raise

            if attempt == max_attempts:
                break

            delay = min(base_delay * (multiplier ** (attempt - 1)), max_delay)
            if jitter:
                delay *= 0.5 + random.random()

            if on_retry:
                on_retry(attempt, e, delay)

            await asyncio.sleep(delay)

    raise last_error  # type: ignore[misc]
```

## Circuit Breaker Pattern

A circuit breaker prevents a system from repeatedly calling a failing service, giving it time to recover.

### State Machine

```
CLOSED  -- calls pass through, failures counted
  |
  | failure_count >= threshold
  v
OPEN    -- all calls fail immediately (fast fail)
  |
  | reset_timeout expires
  v
HALF_OPEN -- one test call allowed
  |
  | success -> CLOSED (reset counter)
  | failure -> OPEN (restart timer)
```

### TypeScript Implementation

```typescript
enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitBreakerConfig {
  failureThreshold: number;    // Failures before opening (e.g., 5)
  resetTimeoutMs: number;      // Time in OPEN before testing (e.g., 30000)
  halfOpenMaxCalls: number;    // Test calls in HALF_OPEN (e.g., 1)
  monitorWindowMs: number;     // Window for counting failures (e.g., 60000)
}

class CircuitBreaker {
  private state = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenCalls = 0;

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs) {
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        throw new CircuitOpenError(this.name, this.config.resetTimeoutMs);
      }
    }

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
        throw new CircuitOpenError(this.name, this.config.resetTimeoutMs);
      }
      this.halfOpenCalls++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.CLOSED);
    }
    this.failureCount = 0;
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.OPEN);
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.transitionTo(CircuitState.OPEN);
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    if (newState === CircuitState.CLOSED) {
      this.failureCount = 0;
    }
    if (newState === CircuitState.HALF_OPEN) {
      this.halfOpenCalls = 0;
    }
    // Log state transitions for observability
    logger.info('Circuit breaker state change', {
      name: this.name,
      from: oldState,
      to: newState,
    });
  }

  getState(): CircuitState { return this.state; }
}

class CircuitOpenError extends Error {
  constructor(
    public readonly circuitName: string,
    public readonly resetTimeoutMs: number
  ) {
    super(`Circuit breaker '${circuitName}' is OPEN`);
  }
}
```

### Python Implementation

```python
import asyncio
import time
from enum import Enum
from dataclasses import dataclass


class CircuitState(Enum):
    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"


@dataclass
class CircuitBreakerConfig:
    failure_threshold: int = 5
    reset_timeout_s: float = 30.0
    half_open_max_calls: int = 1


class CircuitOpenError(AppError):
    code = "CIRCUIT_OPEN"
    severity = Severity.ERROR
    retryable = True

    def __init__(self, circuit_name: str, reset_timeout_s: float) -> None:
        super().__init__(
            f"Circuit breaker '{circuit_name}' is OPEN",
            context={"circuit_name": circuit_name, "reset_timeout_s": reset_timeout_s},
        )


class CircuitBreaker:
    def __init__(self, name: str, config: CircuitBreakerConfig | None = None) -> None:
        self.name = name
        self.config = config or CircuitBreakerConfig()
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._last_failure_time = 0.0
        self._half_open_calls = 0

    @property
    def state(self) -> CircuitState:
        return self._state

    async def call(self, fn):
        if self._state == CircuitState.OPEN:
            if time.monotonic() - self._last_failure_time >= self.config.reset_timeout_s:
                self._transition_to(CircuitState.HALF_OPEN)
            else:
                raise CircuitOpenError(self.name, self.config.reset_timeout_s)

        if self._state == CircuitState.HALF_OPEN:
            if self._half_open_calls >= self.config.half_open_max_calls:
                raise CircuitOpenError(self.name, self.config.reset_timeout_s)
            self._half_open_calls += 1

        try:
            result = await fn()
            self._on_success()
            return result
        except Exception as e:
            self._on_failure()
            raise

    def _on_success(self) -> None:
        if self._state == CircuitState.HALF_OPEN:
            self._transition_to(CircuitState.CLOSED)
        self._failure_count = 0

    def _on_failure(self) -> None:
        self._failure_count += 1
        self._last_failure_time = time.monotonic()
        if self._state == CircuitState.HALF_OPEN:
            self._transition_to(CircuitState.OPEN)
        elif self._failure_count >= self.config.failure_threshold:
            self._transition_to(CircuitState.OPEN)

    def _transition_to(self, new_state: CircuitState) -> None:
        old_state = self._state
        self._state = new_state
        if new_state == CircuitState.CLOSED:
            self._failure_count = 0
        if new_state == CircuitState.HALF_OPEN:
            self._half_open_calls = 0
        logger.info(
            "Circuit breaker state change",
            extra={"name": self.name, "from": old_state.value, "to": new_state.value},
        )
```

## Combining Retry + Circuit Breaker

```typescript
class ResilientClient {
  private circuitBreaker: CircuitBreaker;

  constructor(
    private readonly serviceName: string,
    cbConfig?: CircuitBreakerConfig
  ) {
    this.circuitBreaker = new CircuitBreaker(serviceName, cbConfig ?? {
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      halfOpenMaxCalls: 1,
      monitorWindowMs: 60_000,
    });
  }

  async call<T>(
    fn: () => Promise<T>,
    retryConfig?: Partial<RetryConfig>
  ): Promise<T> {
    // Circuit breaker wraps retry: if circuit is open, fail fast
    // If circuit is closed, retry transient failures
    return this.circuitBreaker.call(() =>
      withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 1000,
        retryableErrors: (e) => !(e instanceof CircuitOpenError) && isRetryable(e),
        onRetry: (attempt, error, delay) => {
          logger.warn('Retrying', {
            service: this.serviceName,
            attempt,
            error: getErrorCode(error),
            delayMs: delay,
          });
        },
        ...retryConfig,
      })
    );
  }
}

// Usage
const paymentService = new ResilientClient('payment-api');

const result = await paymentService.call(
  () => fetch('https://payment.example.com/charge', { method: 'POST', body }),
);
```

## Timeout Pattern

Always set timeouts on I/O operations. A missing timeout is a resource leak waiting to happen.

### TypeScript

```typescript
async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await fn();
    return result;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new TimeoutError(
        `${operationName} timed out after ${timeoutMs}ms`,
        timeoutMs
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Usage with fetch
const data = await withTimeout(
  () => fetch(url, { signal: AbortSignal.timeout(5000) }).then(r => r.json()),
  5000,
  'fetchUserData'
);
```

### Python

```python
import asyncio

async def with_timeout(coro, timeout_s: float, operation_name: str):
    try:
        return await asyncio.wait_for(coro, timeout=timeout_s)
    except asyncio.TimeoutError:
        raise TimeoutError(
            f"{operation_name} timed out after {timeout_s}s",
            timeout_ms=int(timeout_s * 1000),
        )
```

## Fallback Strategies

```typescript
type FallbackChain<T> = Array<{
  name: string;
  fn: () => Promise<T>;
}>;

async function withFallback<T>(chain: FallbackChain<T>): Promise<T> {
  const errors: Array<{ name: string; error: unknown }> = [];

  for (const { name, fn } of chain) {
    try {
      return await fn();
    } catch (error) {
      errors.push({ name, error });
      logger.warn('Fallback: source failed, trying next', {
        failed: name,
        remaining: chain.length - errors.length,
      });
    }
  }

  throw new AggregateError(
    errors.map(e => toError(e.error)),
    `All ${errors.length} fallback sources failed: ${errors.map(e => e.name).join(', ')}`
  );
}

// Usage
const userData = await withFallback([
  { name: 'primary-db', fn: () => primaryDb.getUser(id) },
  { name: 'replica-db', fn: () => replicaDb.getUser(id) },
  { name: 'cache', fn: () => cache.getUser(id) },
  { name: 'default', fn: async () => DEFAULT_USER },
]);
```

## Bulkhead Pattern

Isolate critical and non-critical operations so a failure in one does not consume resources for the other.

```typescript
class Bulkhead {
  private activeCount = 0;
  private queue: Array<() => void> = [];

  constructor(
    private readonly name: string,
    private readonly maxConcurrent: number,
    private readonly maxQueue: number
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrent) {
      if (this.queue.length >= this.maxQueue) {
        throw new BulkheadFullError(this.name, this.maxConcurrent, this.maxQueue);
      }
      await new Promise<void>(resolve => this.queue.push(resolve));
    }

    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

// Critical path: high concurrency limit
const criticalBulkhead = new Bulkhead('critical', 50, 100);

// Non-critical path: low limit to avoid resource starvation
const analyticsBlkhead = new Bulkhead('analytics', 5, 10);
```

## Configuration Guidelines

| Scenario | Max Attempts | Base Delay | Max Delay | Circuit Threshold |
|---|---|---|---|---|
| User-facing API call | 2-3 | 500ms | 5s | 5 failures / 60s |
| Background job | 5-10 | 2s | 60s | 10 failures / 120s |
| Payment/financial | 3 | 1s | 10s | 3 failures / 30s |
| Notifications (best-effort) | 3 | 1s | 30s | 10 failures / 300s |
| Database writes | 3 | 500ms | 5s | 5 failures / 60s |
| Inter-service calls | 3-5 | 1s | 30s | 5 failures / 60s |
| Agent tool calls | 3 | 1s | 15s | 3 failures / 30s |

## Anti-Patterns

- **Retrying non-idempotent operations** -- POST that creates a resource might create duplicates. Use idempotency keys.
- **Retrying without backoff** -- Immediate retries amplify the problem. Always use exponential backoff.
- **No jitter** -- All clients retry at the same time, causing thundering herd.
- **No maximum delay** -- Exponential growth without a cap leads to absurdly long waits.
- **Circuit breaker with no monitoring** -- State transitions should be logged and alerted on.
- **Timeout longer than retry budget** -- If your total timeout is 30s but each attempt has a 60s timeout, you only get one try.
- **Retrying after circuit opens** -- Retries inside a circuit breaker should stop when the circuit opens.
