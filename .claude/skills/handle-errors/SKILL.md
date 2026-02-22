---
name: handle-errors
source: botcore
description: >
  Provides error handling patterns and recovery strategies for TypeScript and Python applications. Covers custom error hierarchies, Result/Either types (neverthrow, Effect), discriminated union errors, retry with exponential backoff and circuit breakers, RFC 9457 structured API error responses, exception groups, error observability, and agent-safe error recovery with graceful degradation. Use when designing error handling strategies, implementing Result types, adding retry logic, building error hierarchies, creating structured API errors, or making agent workflows resilient. Triggers: error handling, Result type, Either, neverthrow, Effect, retry, circuit breaker, backoff, error hierarchy, RFC 9457, error recovery, exception, try-catch, error boundary, structured errors, error logging.

version: 1.0.0
triggers:
  - error handling
  - Result type
  - Either type
  - neverthrow
  - Effect TS
  - retry logic
  - circuit breaker
  - exponential backoff
  - error hierarchy
  - custom error class
  - RFC 9457
  - Problem Details
  - error recovery
  - exception handling
  - try-catch
  - error boundary
  - structured errors
  - error logging
  - error tracking
  - tenacity
  - graceful degradation
  - fault tolerance
portable: true
---

# Handling Errors

Expert guidance for designing and implementing error handling, recovery, and reporting strategies across TypeScript and Python applications, APIs, and AI agent workflows.

## Capabilities

1. **Custom Error Hierarchies** -- Domain-specific error classes with context, codes, and metadata in TypeScript and Python
2. **Result/Either Types** -- Type-safe error handling with neverthrow, Effect, and discriminated unions that make errors explicit in the type system
3. **Retry and Circuit Breaker Patterns** -- Exponential backoff with jitter, circuit breakers, bulkheads, and resilience strategies for transient failures
4. **Structured API Errors** -- RFC 9457 Problem Details, error code registries, and machine-readable error responses
5. **Exception Groups and Aggregation** -- Python ExceptionGroup patterns, error accumulation, and multi-error reporting
6. **Error Observability** -- Structured error logging, error tracking integration (Sentry), error budgets, and alerting strategies
7. **Agent-Safe Error Recovery** -- Graceful degradation, fallback chains, compensation patterns, and error handling for agentic workflows

## Routing Logic

| Request type | Load reference |
|---|---|
| Custom error classes, error hierarchies, domain errors, error context | [references/error-hierarchies.md](references/error-hierarchies.md) |
| Result type, Either, neverthrow, Effect, discriminated unions, typed errors | [references/result-types.md](references/result-types.md) |
| Retry, backoff, jitter, circuit breaker, bulkhead, timeout, resilience | [references/retry-and-resilience.md](references/retry-and-resilience.md) |
| RFC 9457, Problem Details, API errors, error codes, error catalog | [references/api-error-design.md](references/api-error-design.md) |
| Error logging, Sentry, observability, error budgets, tracking, alerts | [references/error-observability.md](references/error-observability.md) |
| Agent error recovery, fallback, compensation, graceful degradation | [references/agent-error-recovery.md](references/agent-error-recovery.md) |

## Core Principles

### 1. Errors Are Values, Not Surprises

Make errors explicit in the type system. Functions that can fail should declare it in their signature, not hide failures in thrown exceptions.

```typescript
// Bad: Caller has no idea this can fail
function getUser(id: string): User { ... }

// Good: Failure is explicit in the return type
function getUser(id: string): Result<User, NotFoundError | DatabaseError> { ... }
```

```python
# Bad: Undeclared exception
def get_user(user_id: str) -> User: ...

# Good: Explicit result with type hint
def get_user(user_id: str) -> Result[User, NotFoundError | DatabaseError]: ...
```

Reserve thrown exceptions for truly unexpected situations (bugs, invariant violations). Handle expected failures through return values.

### 2. Classify Every Error

Every error in the system must be classified along two axes:

**Severity:** Is this a warning, a recoverable error, or a fatal defect?

**Recoverability:** Can the system retry, fall back, or must it abort?

| Category | Retryable | Action | Examples |
|---|---|---|---|
| Transient | Yes | Retry with backoff | Network timeout, 503, rate limit |
| Correctable | Sometimes | Fix input and retry | Validation error, auth expired |
| Permanent | No | Fail fast, report | Not found, forbidden, schema mismatch |
| Fatal | No | Abort, alert | Out of memory, config missing, invariant broken |

### 3. Provide Context, Not Just Messages

Every error must carry enough context for debugging without requiring log correlation:

```typescript
// Bad
throw new Error('Database query failed');

// Good
throw new DatabaseError('Failed to fetch user by ID', {
  code: 'DB_QUERY_FAILED',
  cause: originalError,
  context: { userId, query: 'SELECT * FROM users WHERE id = ?', latencyMs: 3200 },
  retryable: true,
});
```

Include: error code, original cause, operation context, whether it is retryable, and a trace/correlation ID.

### 4. Fail Fast on Non-Recoverable Errors

Do not retry or catch errors that cannot be resolved:

- Missing configuration at startup -- crash immediately with a clear message
- Schema validation failures -- reject and return structured error
- Authorization failures -- do not retry; surface to user
- Invariant violations -- these are bugs; crash and log for investigation

### 5. Retry Only Transient Failures

Apply retry logic only to errors that are genuinely transient:

```
Retry:     network timeout, 429, 500, 502, 503, 504, connection reset
No retry:  400, 401, 403, 404, 409, 422, config errors, type errors
```

Always use exponential backoff with jitter. Set a maximum retry count and total timeout. Log each retry attempt with the attempt number.

### 6. Structured Errors for APIs

All API error responses must be machine-readable and consistent. Use RFC 9457 Problem Details for HTTP APIs:

```json
{
  "type": "https://api.example.com/errors/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "The 'email' field must be a valid email address.",
  "errors": [
    { "field": "email", "code": "INVALID_FORMAT", "message": "Must be a valid email" }
  ],
  "trace_id": "req_abc123"
}
```

### 7. Errors Must Be Observable

Every error that reaches production must be captured, categorized, and trackable:

- Structured logging with error code, severity, context, and trace ID
- Error tracking integration (Sentry or equivalent) for aggregation and alerting
- Error budgets tied to SLOs for prioritizing reliability work
- Dashboards showing error rates by category, endpoint, and service

## Quick Reference

### Error Classification Decision Tree

```
Is the error expected? (validation, not found, auth)
  YES -> Return as Result/Either value or structured API error
  NO  -> Is it a known infrastructure failure? (timeout, 503)
    YES -> Is it transient?
      YES -> Retry with backoff, then degrade gracefully
      NO  -> Fail fast, return structured error, alert
    NO  -> This is a defect (bug)
      -> Log with full context, send to error tracker, alert
```

### TypeScript Error Pattern Selection

```
Need explicit return-type errors?        -> Result<T, E> (neverthrow)
Need composable error pipelines?         -> Effect<A, E, R>
Need simple success/failure branching?   -> Discriminated union
Need error boundaries in React?          -> ErrorBoundary component
Need API error responses?                -> RFC 9457 Problem Details
Need retry logic?                        -> Exponential backoff + circuit breaker
```

### Python Error Pattern Selection

```
Need domain error hierarchy?             -> Custom exception classes
Need retry on transient failures?        -> tenacity decorator
Need structured API errors?              -> Pydantic model + RFC 9457
Need multi-error reporting?              -> ExceptionGroup (3.11+)
Need context cleanup?                    -> contextlib (suppress, ExitStack)
Need result-type pattern?                -> returns library or custom
```

### Retry Configuration Defaults

| Parameter | Default | Notes |
|---|---|---|
| Max attempts | 3-5 | Depends on operation criticality |
| Base delay | 1 second | Starting backoff interval |
| Max delay | 30-60 seconds | Upper bound cap |
| Backoff multiplier | 2 | Doubles each attempt |
| Jitter | 0-100% of delay | Prevents thundering herd |
| Total timeout | 2-5 minutes | Circuit breaker threshold |

## Workflow

### Error Handling Design Protocol

#### 1. Inventory Error Sources

- [ ] List all external dependencies (APIs, databases, queues, file systems)
- [ ] Identify all user input validation points
- [ ] Map authorization and authentication failure modes
- [ ] Document infrastructure failure scenarios (network, DNS, disk)
- [ ] Identify business logic failure conditions

#### 2. Classify and Categorize

- [ ] Assign each error source a severity (warning, error, fatal)
- [ ] Determine recoverability (transient, correctable, permanent, fatal)
- [ ] Define error codes for each category (use a registry)
- [ ] Document which errors are retryable and with what strategy
- [ ] Map errors to user-facing messages (never expose internals)

#### 3. Implement Error Types

- [ ] Create a base error class with code, context, cause, and retryable flag
- [ ] Build domain-specific error subclasses for each category
- [ ] Implement Result/Either types for operations with expected failures
- [ ] Add discriminated unions for function return types where appropriate
- [ ] Ensure all errors are serializable for logging and API responses

#### 4. Add Resilience Patterns

- [ ] Implement retry with exponential backoff and jitter for transient failures
- [ ] Add circuit breakers for external service calls
- [ ] Configure timeouts for all I/O operations
- [ ] Implement fallback strategies (cache, default, degraded mode)
- [ ] Add bulkhead isolation for critical vs non-critical paths

#### 5. Wire Up Observability

- [ ] Configure structured logging with error context fields
- [ ] Integrate error tracking (Sentry or equivalent)
- [ ] Set up alerting rules by error severity and rate
- [ ] Define error budgets tied to SLOs
- [ ] Create dashboards for error rate monitoring

#### 6. Test Error Paths

- [ ] Unit test every error branch and recovery path
- [ ] Test retry behavior with simulated transient failures
- [ ] Test circuit breaker state transitions (closed -> open -> half-open)
- [ ] Verify error responses match RFC 9457 schema
- [ ] Test graceful degradation under dependency failure
- [ ] Chaos test: inject random failures in staging

### Agentic Workflow Considerations

When an AI agent is implementing or modifying error handling:

1. **Preserve existing error contracts** -- Changing error types or codes is a breaking change for consumers. Always check for existing error handlers downstream before modifying.
2. **Never swallow errors silently** -- Every catch block must log, rethrow, or return a typed error. Empty catch blocks are defects.
3. **Test the unhappy path** -- Generate tests for error conditions, not just success paths. Cover retry exhaustion, circuit breaker trips, and fallback activation.
4. **Use structured errors for agent-to-agent communication** -- When agents call other agents or tools, use typed Result values or structured error objects, never raw strings.
5. **Implement compensation for multi-step operations** -- If step 3 of 5 fails, the agent should know how to undo steps 1 and 2 or leave the system in a consistent state.
6. **Surface errors clearly** -- When an agent encounters an error it cannot recover from, it should report the error with full context to the human, including what was attempted, what failed, and what the state is now.
7. **Respect error budgets** -- If an agent detects elevated error rates, it should slow down or pause rather than contributing to cascading failures.

## Checklist

### Error Types

- [ ] Base error class includes code, message, cause, context, and retryable flag
- [ ] Domain errors extend base with category-specific fields
- [ ] All error codes are registered in a central catalog
- [ ] Error messages are user-safe (no stack traces, internal IDs, or secrets)
- [ ] Errors carry correlation/trace IDs for distributed tracing

### Result Types (if using)

- [ ] All functions with expected failures return Result<T, E> instead of throwing
- [ ] Error variants are exhaustively handled (no unchecked `.value` access)
- [ ] Async operations use ResultAsync or equivalent
- [ ] Result chains use map/flatMap, not try-catch wrappers
- [ ] Error types in Result are specific, not `Error` or `unknown`

### Retry and Resilience

- [ ] Retry logic uses exponential backoff with jitter
- [ ] Maximum retry count and total timeout are configured
- [ ] Only transient errors trigger retries (not 400, 401, 403, 404, 422)
- [ ] Circuit breaker configured for external service calls
- [ ] Timeouts set on all I/O operations
- [ ] Fallback strategies defined for critical paths
- [ ] Retry attempts are logged with attempt number and delay

### API Errors

- [ ] All error responses follow RFC 9457 Problem Details format
- [ ] Content-Type is `application/problem+json` for error responses
- [ ] Error codes are stable strings from a published registry
- [ ] Validation errors include field-level details (field, code, message)
- [ ] Retryable errors include `retry_after_seconds`
- [ ] Error responses never expose stack traces, SQL, or internal paths

### Observability

- [ ] Errors logged with structured fields (code, severity, context, trace_id)
- [ ] Error tracking service captures unhandled exceptions with source maps
- [ ] Alert rules defined for error rate spikes and new error types
- [ ] Error budgets established and monitored against SLOs
- [ ] Dashboards show error rates by service, endpoint, and error code

## When to Escalate

- **Changing error codes or types on a public API** -- This is a breaking change. Requires versioning plan and consumer notification.
- **Error rates exceeding SLO budget** -- Indicates a systemic issue needing architecture review, not just error handling fixes.
- **Cascading failures across services** -- Circuit breaker and bulkhead patterns may need infrastructure-level changes.
- **Cryptographic or security-sensitive errors** -- Errors in auth, encryption, or secret handling need security team review.
- **Multi-service compensation logic** -- Saga/compensation patterns spanning multiple services need distributed systems expertise.
- **Error handling in life-safety or financial systems** -- Regulatory requirements may dictate specific error handling behaviors.
- **Persistent retry storms** -- If retries are amplifying failures rather than resolving them, the retry strategy needs redesign.
- **Agent error loops** -- If an agent repeatedly encounters the same error and cannot self-correct, it should halt and escalate to a human with full context.
