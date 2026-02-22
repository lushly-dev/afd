# Middleware Defaults Specification

> Production-ready observability out of the box, without duplicating what the base handler already provides.

## Summary

Add a `defaultMiddleware()` factory function to `@lushly-dev/afd-server` that returns a pre-configured `CommandMiddleware[]` bundle covering the three most common observability needs: trace ID generation, structured logging, and slow-command warnings.

## User Value

- **Zero-config observability** — New servers get structured logging and tracing without assembling middleware manually
- **No duplication** — Complements the base handler's existing `executionTimeMs`, `commandVersion`, and `traceId` propagation rather than re-implementing them
- **Composable** — Spread into the `middleware` array alongside custom middleware
- **Gradual override** — Disable individual pieces or replace with project-specific alternatives
- **Consistent baseline** — Every AFD server shares the same observability floor

## User Stories

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-1 | Server author | Call one function for common middleware | I don't manually assemble logging + timing + traceId |
| US-2 | Ops engineer | Get structured logs from every server | I can diagnose production issues without custom setup |
| US-3 | Developer | See slow-command warnings during development | I catch performance regressions early |
| US-4 | Developer | Compose defaults with my own middleware | I can add rate limiting or retry without losing the baseline |
| US-5 | Developer | Disable pieces I don't need | I avoid overhead from unwanted middleware in hot paths |

---

## Existing Behavior (Critical Context)

The base handler in `createMcpServer` already provides three pieces of metadata on every `CommandResult`:

```typescript
// server.ts — executeCommand() base handler
const runHandler = async (): Promise<CommandResult> => {
  const startTime = Date.now();
  const result = await command.handler(validation.data, context);

  if (!result.metadata) result.metadata = {};
  result.metadata.executionTimeMs = Date.now() - startTime;
  result.metadata.commandVersion = command.version;
  if (context.traceId) result.metadata.traceId = context.traceId;

  return result;
};
```

This means:
1. **`executionTimeMs`** is always present — middleware must NOT duplicate this measurement. (Note: logging and timing middleware measure full middleware + handler chain duration, which is broader. See [Middleware Execution Order](#middleware-execution-order) for the distinction.)
2. **`traceId`** is propagated from `context.traceId` to `result.metadata.traceId` — but nobody auto-generates `context.traceId` if the caller omits it. That's the gap.
3. **`commandVersion`** is always present — no middleware involvement needed.

The `defaultMiddleware()` bundle fills the gaps around this base behavior.

---

## Functional Requirements

### FR-1: `defaultMiddleware()` Factory

```typescript
interface DefaultMiddlewareOptions {
  /**
   * Logging options, or `false` to disable logging middleware entirely.
   * Default: enabled with default LoggingOptions.
   */
  logging?: LoggingOptions | false;

  /**
   * Timing (slow-command warning) options, or `false` to disable.
   * Default: enabled with 1000ms threshold.
   */
  timing?: TimingOptions | false;

  /**
   * Trace ID auto-generation options, or `false` to disable.
   * Default: enabled with crypto.randomUUID().
   */
  traceId?: TraceIdOptions | false;
}

/**
 * Returns a pre-configured array of middleware covering common
 * observability needs: trace ID generation, structured logging,
 * and slow-command warnings.
 *
 * Designed to complement — not duplicate — the base handler's
 * built-in executionTimeMs, commandVersion, and traceId propagation.
 */
function defaultMiddleware(options?: DefaultMiddlewareOptions): CommandMiddleware[];
```

The returned array always follows a fixed order:

| Position | Middleware | Purpose | Complements |
|----------|-----------|---------|-------------|
| 0 | Trace ID | Auto-generate `context.traceId` if not present | Base handler propagates it to `result.metadata.traceId` |
| 1 | Logging | Structured log of command name, success/failure, duration | Base handler provides the timing value |
| 2 | Timing | Warn when a command exceeds the slow threshold | Base handler tracks raw `executionTimeMs` |

Ordering matters: trace ID runs first (outermost) so that logging and timing see the generated `traceId` in `context`.

### FR-2: Trace ID Auto-Generation Middleware

A new lightweight middleware factory that fills the gap identified above. Named `createAutoTraceIdMiddleware` (with "Auto") to distinguish from the existing `createTracingMiddleware`, which creates OpenTelemetry spans. This middleware only ensures a `traceId` exists in `context`.

```typescript
interface TraceIdOptions {
  /**
   * Function to generate trace IDs.
   * Default: () => crypto.randomUUID()
   */
  generate?: () => string;
}

/**
 * Middleware that ensures every command invocation has a traceId
 * in context. If context.traceId is already set (e.g., by the caller
 * or an MCP client), it is left untouched.
 */
function createAutoTraceIdMiddleware(options?: TraceIdOptions): CommandMiddleware;
```

**Behavior:**
- If `context.traceId` is falsy (`undefined`, empty string, `null`), set it to `generate()`.
- If `context.traceId` is already set to a truthy value, pass through unchanged.
- If `generate()` throws, the error propagates through the middleware chain and is caught by the server's top-level error handler (returns `COMMAND_EXECUTION_ERROR`).
- The base handler then propagates `context.traceId` to `result.metadata.traceId` automatically.

**Context mutation contract:** This middleware mutates the shared `context` object directly. This is the intended pattern — `CommandContext` is a mutable bag passed by reference through the entire middleware chain. All subsequent middleware and the handler see the updated `traceId`.

**Implementation:**

```typescript
export function createAutoTraceIdMiddleware(options: TraceIdOptions = {}): CommandMiddleware {
  const { generate = () => crypto.randomUUID() } = options;

  return async (_commandName, _input, context, next) => {
    if (!context.traceId) {
      context.traceId = generate();
    }
    return next();
  };
}
```

### FR-3: Logging Middleware (Existing — Reused)

`defaultMiddleware()` reuses the existing `createLoggingMiddleware()` with its default options:
- Logs command name, traceId, success/failure, and duration.
- `logInput` defaults to `false` (sensitive data protection).
- `logResult` defaults to `false`.

Users can customize via `options.logging`:

```typescript
defaultMiddleware({
  logging: { logInput: true, log: myStructuredLogger },
});
```

> **Logger signature:** The `log` function signature is `(message: string, data?: unknown) => void`. When using libraries like pino that have a different signature (e.g., `(obj, msg)`), wrap them to match: `log: (msg, data) => pino.info({ data }, msg)`.

### FR-4: Timing Middleware (Existing — Reused)

`defaultMiddleware()` reuses the existing `createTimingMiddleware()` with its default options:
- `slowThreshold` defaults to `1000ms`.
- `onSlow` defaults to `console.warn`.

This does NOT duplicate `executionTimeMs` on the result — the base handler handles that. This middleware purely provides the warning side-effect when a command is slow.

Users can customize via `options.timing`:

```typescript
defaultMiddleware({
  timing: { slowThreshold: 500, onSlow: (name, ms) => alerting.warn(name, ms) },
});
```

### FR-5: Selective Disabling

Any piece can be disabled by passing `false`:

```typescript
// Only logging, no timing or trace ID auto-generation
defaultMiddleware({ timing: false, traceId: false });

// Only trace ID, no logging or timing
defaultMiddleware({ logging: false, timing: false });

// Everything disabled (returns [])
defaultMiddleware({ logging: false, timing: false, traceId: false });
```

### FR-6: Composition with Custom Middleware

The returned array is plain `CommandMiddleware[]` — it composes naturally:

```typescript
const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  commands: [myCommand],
  middleware: [
    ...defaultMiddleware(),
    createRetryMiddleware({ maxRetries: 2 }),
    createRateLimitMiddleware({ maxRequests: 100, windowMs: 60_000 }),
  ],
});
```

Middleware executes in array order (outermost first), so defaults run before custom middleware. Users who need different ordering can pick individual factories instead.

---

## API Design

### Exports

Add to `@lushly-dev/afd-server`:

```typescript
// New exports
export { defaultMiddleware } from './middleware.js';
export type { DefaultMiddlewareOptions, TraceIdOptions } from './middleware.js';
export { createAutoTraceIdMiddleware } from './middleware.js';
```

### Full API Surface (After)

```typescript
// Existing (unchanged)
export { createLoggingMiddleware } from './middleware.js';
export { createTimingMiddleware } from './middleware.js';
export { createRetryMiddleware } from './middleware.js';
export { createTracingMiddleware } from './middleware.js';
export { createRateLimitMiddleware } from './middleware.js';
export { createTelemetryMiddleware } from './middleware.js';
export { composeMiddleware } from './middleware.js';
export { ConsoleTelemetrySink } from './middleware.js';

// New
export { defaultMiddleware } from './middleware.js';
export { createAutoTraceIdMiddleware } from './middleware.js';
```

---

## Examples

### Example 1: Zero-Config Server

```typescript
import { createMcpServer, defaultMiddleware, defineCommand, success } from '@lushly-dev/afd-server';

const ping = defineCommand({
  name: 'ping',
  description: 'Health check',
  input: z.object({}),
  async handler() {
    return success({ pong: true });
  },
});

const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  commands: [ping],
  middleware: defaultMiddleware(),
});

// Console output when ping is called:
// [a1b2c3d4-...] Executing: ping
// [a1b2c3d4-...] Completed: ping (2ms) - SUCCESS
```

### Example 2: Custom Thresholds

```typescript
const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  commands,
  middleware: defaultMiddleware({
    timing: { slowThreshold: 200 },
    logging: { log: (msg, data) => pino.info({ data }, msg) },
  }),
});
```

### Example 3: Production Stack

```typescript
import {
  defaultMiddleware,
  createRetryMiddleware,
  createTelemetryMiddleware,
  ConsoleTelemetrySink,
} from '@lushly-dev/afd-server';

const server = createMcpServer({
  name: 'prod-server',
  version: '2.1.0',
  commands,
  middleware: [
    ...defaultMiddleware({ timing: { slowThreshold: 500 } }),
    createRetryMiddleware({ maxRetries: 2 }),
    createTelemetryMiddleware({ sink: new ConsoleTelemetrySink({ json: true }) }),
  ],
});
```

### Example 4: Minimal — Trace ID Only

```typescript
const server = createMcpServer({
  name: 'lightweight-server',
  version: '1.0.0',
  commands,
  middleware: defaultMiddleware({ logging: false, timing: false }),
});

// Only effect: context.traceId is auto-generated if not present.
// Base handler then propagates it to result.metadata.traceId.
```

### Example 5: Custom Trace ID Format

```typescript
let counter = 0;

const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  commands,
  middleware: defaultMiddleware({
    traceId: { generate: () => `req-${++counter}` },
  }),
});
```

---

## Implementation Notes

### `defaultMiddleware()` Implementation

```typescript
export function defaultMiddleware(
  options: DefaultMiddlewareOptions = {}
): CommandMiddleware[] {
  const stack: CommandMiddleware[] = [];

  // 1. Trace ID (outermost — ensures ID exists for logging/timing)
  if (options.traceId !== false) {
    stack.push(createAutoTraceIdMiddleware(options.traceId || undefined));
  }

  // 2. Logging
  if (options.logging !== false) {
    stack.push(createLoggingMiddleware(options.logging || undefined));
  }

  // 3. Timing (slow-command warnings)
  if (options.timing !== false) {
    stack.push(createTimingMiddleware(options.timing || undefined));
  }

  return stack;
}
```

### Why Not Make Defaults Automatic?

The `middleware` option in `McpServerOptions` defaults to `[]` today. We considered changing this default to `defaultMiddleware()` but rejected it for two reasons:

1. **Breaking change** — Existing servers with `middleware: []` (implicit or explicit) would suddenly see console output.
2. **Explicit is better** — Middleware affects runtime behavior. Users should opt in deliberately, even if the opt-in is a single function call.

### `crypto.randomUUID()` Availability

The implementation uses the global `crypto.randomUUID()`, which is available in:
- Node.js 19+ (global `crypto` object available without flags)
- All modern browsers
- Deno, Bun, Cloudflare Workers

For Node.js 16.7–18, `randomUUID()` is available via `import { randomUUID } from 'node:crypto'` but not on the global `crypto` object. Users on these versions should pass a custom `generate` function:

```typescript
import { randomUUID } from 'node:crypto';

defaultMiddleware({
  traceId: { generate: randomUUID },
});
```

### Middleware Execution Order

Given `middleware: [...defaultMiddleware(), customMiddleware]`, execution flows:

```
Request arrives
  → createAutoTraceIdMiddleware (sets context.traceId)
    → createLoggingMiddleware (logs start with traceId)
      → createTimingMiddleware (starts timer)
        → customMiddleware
          → base handler (sets metadata.executionTimeMs, metadata.traceId)
        ← customMiddleware
      ← createTimingMiddleware (warns if slow)
    ← createLoggingMiddleware (logs completion with duration)
  ← createAutoTraceIdMiddleware (pass-through)
Response returned
```

> **Duration callout:** The logging/timing middleware measures the full middleware + handler chain duration, which is broader than `result.metadata.executionTimeMs` (handler-only timing set by the base handler). They are complementary, not redundant.

> **Trace ID contract:** `createAutoTraceIdMiddleware` must be the outermost middleware so that all inner middleware (logging, timing, custom) see the generated `traceId` in `context`.

---

## Relationship to Existing Types

| Existing | Role in This Spec |
|----------|-------------------|
| `CommandMiddleware` | Return type element of `defaultMiddleware()` |
| `createLoggingMiddleware` | Reused inside `defaultMiddleware()` |
| `createTimingMiddleware` | Reused inside `defaultMiddleware()` |
| `LoggingOptions` | Accepted via `DefaultMiddlewareOptions.logging` |
| `TimingOptions` | Accepted via `DefaultMiddlewareOptions.timing` |
| `CommandContext.traceId` | Auto-populated by `createAutoTraceIdMiddleware` |
| `result.metadata.executionTimeMs` | Set by base handler, NOT by this middleware |
| `result.metadata.traceId` | Set by base handler from `context.traceId` |
| `composeMiddleware` | Not used — `defaultMiddleware()` returns an array for flexibility |

---

## Out of Scope

- [ ] Changing the default value of `McpServerOptions.middleware` from `[]` to `defaultMiddleware()` (breaking change)
- [ ] Adding retry or rate limiting to the defaults bundle (too opinionated)
- [ ] Telemetry sink integration (requires sink configuration, not "zero-config")
- [ ] OpenTelemetry tracing in defaults (requires tracer instance)
- [ ] Middleware ordering configuration (users control order via array position)
- [ ] DirectClient middleware support (follow-on — `DirectClient` should accept an optional `middleware` array using the same onion-pattern chain, preserving zero-overhead when omitted)
- [ ] Python/Rust implementations (follow-on work after TypeScript ships)

---

## Success Criteria

- [ ] `createAutoTraceIdMiddleware` factory exported from `@lushly-dev/afd-server`
- [ ] `defaultMiddleware()` factory exported from `@lushly-dev/afd-server`
- [ ] `DefaultMiddlewareOptions` and `TraceIdOptions` types exported
- [ ] Default bundle includes trace ID, logging, and timing in correct order
- [ ] Each piece is individually disableable via `false`
- [ ] Custom options pass through to underlying factories
- [ ] No duplication of `executionTimeMs` tracking (base handler owns this)
- [ ] `context.traceId` auto-generated only when not already present
- [ ] Composable with existing middleware via array spread
- [ ] Unit tests for `createAutoTraceIdMiddleware` (generation, pass-through, throwing generator)
- [ ] Unit tests for `defaultMiddleware()` (all combinations of enabled/disabled)
- [ ] Integration test: `defaultMiddleware()` + custom middleware composed in `createMcpServer`, verifying end-to-end trace ID propagation, logging output, and slow-command warning
- [ ] Documentation updated with `defaultMiddleware()` usage examples
