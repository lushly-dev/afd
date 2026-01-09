# Telemetry Middleware Guide

> **When to Use**: Telemetry middleware captures execution data for every command invocation, enabling monitoring, debugging, and analytics.

## Quick Start

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
    createTelemetryMiddleware({
      sink: new ConsoleTelemetrySink(),
    }),
  ],
});
```

## TelemetryEvent Interface

Every command execution generates a `TelemetryEvent`:

```typescript
interface TelemetryEvent {
  // Required fields
  commandName: string;      // e.g., "todo.create"
  startedAt: string;        // ISO timestamp
  completedAt: string;      // ISO timestamp
  durationMs: number;       // Execution time in ms
  success: boolean;         // Whether command succeeded

  // Optional fields
  error?: CommandError;     // Error details if failed
  traceId?: string;         // Correlation ID
  confidence?: number;      // Result confidence (0-1)
  metadata?: Record<string, unknown>; // Custom metadata
  input?: unknown;          // Command input (opt-in)
  commandVersion?: string;  // Command version
}
```

## TelemetrySink Interface

Implement `TelemetrySink` to send events to your preferred storage:

```typescript
interface TelemetrySink {
  // Record a telemetry event (can be sync or async)
  record(event: TelemetryEvent): void | Promise<void>;

  // Optional: Flush pending events (for buffered sinks)
  flush?(): void | Promise<void>;
}
```

## Built-in: ConsoleTelemetrySink

The default sink logs events to the console:

```typescript
// Human-readable format (default)
const sink = new ConsoleTelemetrySink();
// Output: [Telemetry] [trace-abc] todo.create SUCCESS in 150ms (confidence: 0.95)

// JSON format for log aggregation
const jsonSink = new ConsoleTelemetrySink({ json: true });
// Output: {"commandName":"todo.create","success":true,...}

// Custom logger
const customSink = new ConsoleTelemetrySink({
  log: (msg) => myLogger.info(msg),
  prefix: '[CMD]',
});
```

## Middleware Options

```typescript
interface TelemetryOptions {
  // Required: where to send events
  sink: TelemetrySink;

  // Include command input (default: false)
  // Warning: May contain sensitive data
  includeInput?: boolean;

  // Include result metadata (default: true)
  includeMetadata?: boolean;

  // Filter which commands to track (default: all)
  filter?: (commandName: string) => boolean;
}
```

### Example: Production Configuration

```typescript
const server = createMcpServer({
  name: 'production-app',
  version: '1.0.0',
  commands: [...],
  middleware: [
    createTelemetryMiddleware({
      sink: productionSink,
      includeInput: false,  // Don't log sensitive data
      includeMetadata: true,
      filter: (name) => !name.startsWith('afd-'), // Skip bootstrap commands
    }),
  ],
});
```

## Custom Sink Examples

### Database Sink

```typescript
class DatabaseTelemetrySink implements TelemetrySink {
  private buffer: TelemetryEvent[] = [];
  private flushInterval: NodeJS.Timer;

  constructor(private db: Database) {
    // Flush every 5 seconds
    this.flushInterval = setInterval(() => this.flush(), 5000);
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

### Cloud Monitoring Sink

```typescript
class CloudMonitoringSink implements TelemetrySink {
  constructor(private client: MonitoringClient) {}

  async record(event: TelemetryEvent): Promise<void> {
    await this.client.writePoints([
      {
        measurement: 'command_execution',
        tags: {
          command: event.commandName,
          success: String(event.success),
        },
        fields: {
          duration: event.durationMs,
          confidence: event.confidence ?? null,
        },
        timestamp: new Date(event.startedAt),
      },
    ]);
  }
}
```

### Multi-Sink (Fan-out)

```typescript
class MultiSink implements TelemetrySink {
  constructor(private sinks: TelemetrySink[]) {}

  record(event: TelemetryEvent): void {
    for (const sink of this.sinks) {
      try {
        sink.record(event);
      } catch {
        // Continue to other sinks even if one fails
      }
    }
  }

  async flush(): Promise<void> {
    await Promise.all(
      this.sinks.map((sink) => sink.flush?.())
    );
  }
}

// Usage
const multiSink = new MultiSink([
  new ConsoleTelemetrySink(),
  new DatabaseTelemetrySink(db),
  new CloudMonitoringSink(client),
]);
```

## Error Handling

The telemetry middleware:

1. **Never blocks** command execution - recording is fire-and-forget
2. **Never throws** from sink errors - failures are silently ignored
3. **Always records** failures - even when commands throw exceptions

```typescript
// When a command throws, you'll still get a telemetry event:
{
  commandName: 'user.delete',
  success: false,
  error: {
    code: 'UNHANDLED_ERROR',
    message: 'Connection refused',
  },
  durationMs: 5,
}
```

## Combining with Other Middleware

Telemetry works well with other middleware. Order matters - telemetry should typically be first to capture accurate timing:

```typescript
const server = createMcpServer({
  middleware: [
    // 1. Telemetry first - captures total time including all middleware
    createTelemetryMiddleware({ sink }),

    // 2. Logging second - detailed logging
    createLoggingMiddleware({ logInput: true }),

    // 3. Retry middleware last - retries happen inside telemetry
    createRetryMiddleware({ maxRetries: 3 }),
  ],
});
```

## Best Practices

1. **Don't log sensitive input** - Use `includeInput: false` in production
2. **Use buffered sinks** - Batch writes to reduce I/O overhead
3. **Filter bootstrap commands** - Skip `afd-help`, `afd-docs`, `afd-schema`
4. **Implement flush()** - Ensure events are persisted on shutdown
5. **Handle sink errors** - Sinks should log and continue, never throw
