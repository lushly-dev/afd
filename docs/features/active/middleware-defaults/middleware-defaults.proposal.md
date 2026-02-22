# Feature Proposal: Middleware Defaults

## 1. Summary
Provide a `defaultMiddleware()` bundle that covers common observability needs (timing, logging, trace IDs) out of the box.

## 2. Motivation
AFD provides middleware primitives (logging, timing, retry, rate-limit, telemetry), but they are opt-in per server. Most servers want timing, structured logging, and trace IDs. Assembling them manually introduces needless friction and ceremony.

## 3. Proposed Solution
- Export a new `defaultMiddleware()` function from `@afd/core` or `@afd/server`.
- The default bundle will include:
  - Timing on every command (populating `metadata.executionTimeMs`).
  - Structured logging (command name, success/failure, duration).
  - Trace ID propagation (auto-generating if not provided).

## 4. Breaking Changes
**None.** The `middleware` option in `McpServerOptions` remains an opt-in `CommandMiddleware[]`. This simply provides a convenient pre-packaged array of middleware.

## 5. Alternatives Considered
- Keeping middleware strictly manual to enforce explicit configuration. This was rejected because the common case is overwhelmingly uniform.

## 6. Specification
See [middleware-defaults.spec.md](./middleware-defaults.spec.md) for the full technical specification.
