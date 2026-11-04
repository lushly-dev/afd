# Telemetry and default middleware (TypeScript)

All from `@lushly-dev/afd-server`. Python's equivalents are described in [`python/README.md`](../../../../python/README.md); which
languages have what is in the "Handoff, telemetry and similarity" rows of
[`docs/language-parity.md`](../../../../docs/language-parity.md).

## Order

The first middleware in the array is the outermost. Put trace IDs first so everything after sees
`context.traceId`, and telemetry before retries so it times the whole call:

```typescript
middleware: [
  ...defaultMiddleware(),                             // trace ID, logging, slow-command warnings
  createTelemetryMiddleware({ sink }),
  createRetryMiddleware({ maxRetries: 3 }),
  createApprovalMiddleware({ secret, commands }),     // after anything that sets context.actor
]
```

## defaultMiddleware(options?)

Returns `[createAutoTraceIdMiddleware(), createLoggingMiddleware(), createTimingMiddleware()]`.
Pass `false` to drop one, or its options to configure it:

```typescript
defaultMiddleware({
  logging: { log: myLogger.info, logInput: false },
  timing: { slowThreshold: 500, onSlow: (name, ms) => report(name, ms) },
  traceId: { generate: () => `req-${Date.now()}` }, // default crypto.randomUUID(); kept if already set
});
defaultMiddleware({ logging: false, timing: false }); // trace IDs only
```

Default logging and the console sink write to stderr, so stdio MCP frames stay valid.

## createTelemetryMiddleware(options)

```typescript
createTelemetryMiddleware({
  sink: new ConsoleTelemetrySink({ json: true }), // also log, prefix ('[Telemetry]')
  includeInput: false,                            // default false: input may hold secrets
  includeMetadata: true,                          // default true
  filter: (name) => !name.startsWith('afd-'),     // default: every command
});
```

A `TelemetrySink` is `{ record(event): void | Promise<void>; flush?(): void | Promise<void> }`.
Each `TelemetryEvent` has `commandName`, `startedAt`, `completedAt`, `durationMs`, `success`, and
when present `error`, `traceId`, `confidence`, `metadata`, `input`, `commandVersion` and
`actorKind` (the caller's kind, never its id).

- Recording is fire-and-forget: a sink that throws or rejects is ignored and never fails the
  command. Buffer in the sink and implement `flush()` for shutdown.
- A handler that throws is still recorded as a failure, then the error is re-thrown.
- Timestamps and durations use the context's clock, so a fixed clock gives deterministic events.

For OpenTelemetry spans, see "OpenTelemetry Tracing" in `packages/server/README.md`.
