# Telemetry & Observability Middleware

Middleware for monitoring, debugging, and analytics of command execution.

## Quick Start — defaultMiddleware()

The fastest way to add observability. Returns a pre-configured stack of three middleware: auto trace ID, structured logging, and slow-command warnings.

```typescript
import { createMcpServer, defaultMiddleware } from '@lushly-dev/afd-server';

const server = createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  commands: [/* your commands */],
  middleware: defaultMiddleware(),
});
```

### Selective Disable

```typescript
// Disable timing warnings, keep logging + traceId
defaultMiddleware({ timing: false })

// Only trace IDs
defaultMiddleware({ logging: false, timing: false })
```

### Custom Options

```typescript
defaultMiddleware({
  logging: { log: myLogger.info, logInput: true },
  timing: { slowThreshold: 500, onSlow: (name, ms) => alert(name, ms) },
  traceId: { generate: () => `req-${Date.now()}` },
})
```

### Compose with Custom Middleware

```typescript
middleware: [...defaultMiddleware(), rateLimiter, authMiddleware]
```

## Auto Trace ID Middleware

`createAutoTraceIdMiddleware()` sets `context.traceId` when not already present. Uses `crypto.randomUUID()` by default. Must be outermost middleware so logging/timing see the trace ID.

```typescript
import { createAutoTraceIdMiddleware } from '@lushly-dev/afd-server';

// Standalone usage (included in defaultMiddleware by default)
const traceMiddleware = createAutoTraceIdMiddleware();

// Custom generator
const traceMiddleware = createAutoTraceIdMiddleware({
  generate: () => `trace-${Date.now()}`,
});
```

If `generate()` throws, the error propagates through the middleware chain.

## Telemetry Middleware

For detailed event capture beyond logging, use `createTelemetryMiddleware` with a `TelemetrySink`:

```typescript
import {
  createMcpServer,
  createTelemetryMiddleware,
  ConsoleTelemetrySink
} from '@lushly-dev/afd-server';

const server = createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  commands: [/* your commands */],
  middleware: [
    ...defaultMiddleware(),
    createTelemetryMiddleware({
      sink: new ConsoleTelemetrySink(),
    }),
  ],
});
```

## TelemetryEvent Interface

```typescript
interface TelemetryEvent {
  commandName: string;
  startedAt: string;        // ISO timestamp
  completedAt: string;
  durationMs: number;
  success: boolean;
  error?: CommandError;
  traceId?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
  input?: unknown;          // Opt-in
  commandVersion?: string;
}
```

## TelemetrySink Interface

```typescript
interface TelemetrySink {
  record(event: TelemetryEvent): void | Promise<void>;
  flush?(): void | Promise<void>;
}
```

## Built-in: ConsoleTelemetrySink

```typescript
// Human-readable (default)
const sink = new ConsoleTelemetrySink();
// Output: [Telemetry] [trace-abc] todo.create SUCCESS in 150ms (confidence: 0.95)

// JSON format for log aggregation
const jsonSink = new ConsoleTelemetrySink({ json: true });

// Custom logger
const customSink = new ConsoleTelemetrySink({
  log: (msg) => myLogger.info(msg),
  prefix: '[CMD]',
});
```

## Middleware Options

```typescript
interface TelemetryOptions {
  sink: TelemetrySink;
  includeInput?: boolean;       // default: false (may contain sensitive data)
  includeMetadata?: boolean;    // default: true
  filter?: (commandName: string) => boolean;  // default: all
}
```

## Custom Sink Examples

### Database Sink

```typescript
class DatabaseTelemetrySink implements TelemetrySink {
  private buffer: TelemetryEvent[] = [];

  constructor(private db: Database) {
    setInterval(() => this.flush(), 5000);
  }

  record(event: TelemetryEvent): void {
    this.buffer.push(event);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    await this.db.collection('telemetry').insertMany(events);
  }
}
```

### Multi-Sink (Fan-out)

```typescript
class MultiSink implements TelemetrySink {
  constructor(private sinks: TelemetrySink[]) {}

  record(event: TelemetryEvent): void {
    for (const sink of this.sinks) {
      try { sink.record(event); } catch { /* continue */ }
    }
  }

  async flush(): Promise<void> {
    await Promise.all(this.sinks.map((s) => s.flush?.()));
  }
}
```

## Error Handling

The telemetry middleware:
1. **Never blocks** command execution - recording is fire-and-forget
2. **Never throws** from sink errors - failures are silently ignored
3. **Always records** failures - even when commands throw exceptions

## Middleware Composition

Order matters - telemetry should be first to capture accurate timing:

```typescript
const server = createMcpServer({
  middleware: [
    createTelemetryMiddleware({ sink }),  // 1. Captures total time
    createLoggingMiddleware({ logInput: true }),  // 2. Detailed logging
    createRetryMiddleware({ maxRetries: 3 }),  // 3. Retries inside telemetry
  ],
});
```

## Best Practices

1. **Don't log sensitive input** - Use `includeInput: false` in production
2. **Use buffered sinks** - Batch writes to reduce I/O overhead
3. **Filter bootstrap commands** - Skip `afd-help`, `afd-docs`, `afd-schema`
4. **Implement flush()** - Ensure events are persisted on shutdown
5. **Handle sink errors** - Sinks should log and continue, never throw
