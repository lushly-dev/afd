# @lushly-dev/afd-client

MCP client library for Agent-First Development.

## Installation

```bash
npm install @lushly-dev/afd-client
# or
pnpm add @lushly-dev/afd-client
```

## Overview

This package provides a client for connecting to MCP (Model Context Protocol) servers. It supports:

- **SSE Transport**: Real-time streaming with Server-Sent Events
- **HTTP Transport**: Simple request/response communication
- **Direct Transport**: Zero-overhead in-process execution for co-located agents
- **Auto-reconnection**: Automatic reconnection with exponential backoff
- **Type-safe API**: Full TypeScript support with CommandResult integration

## Usage

### Basic Connection

```typescript
import { createClient } from '@lushly-dev/afd-client';

// Create client
const client = createClient({
  url: 'http://localhost:3100/sse',
  transport: 'sse', // or 'http'
});

// Connect
await client.connect();

// List available tools
const tools = await client.listTools();
console.log('Available tools:', tools.map(t => t.name));

// Disconnect when done
await client.disconnect();
```

### Calling Commands

```typescript
import { createClient, type CommandResult } from '@lushly-dev/afd-client';
import { isSuccess, isFailure } from '@lushly-dev/afd-core';

const client = createClient({ url: 'http://localhost:3100/sse' });
await client.connect();

// Call a command - returns CommandResult
const result = await client.call<Document>('document-create', {
  title: 'My Document',
  content: 'Hello, world!'
});

if (isSuccess(result)) {
  console.log('Created document:', result.data);
  console.log('Confidence:', result.confidence);
  console.log('Reasoning:', result.reasoning);
} else {
  console.error('Error:', result.error.message);
  console.error('Suggestion:', result.error.suggestion);
}
```

### Event Handling

```typescript
const client = createClient({
  url: 'http://localhost:3100/sse',
  autoReconnect: true,
  maxReconnectAttempts: 5,
});

// Subscribe to events
client.on('connected', (info) => {
  console.log('Connected to:', info.serverInfo.name);
});

client.on('disconnected', (reason) => {
  console.log('Disconnected:', reason);
});

client.on('reconnecting', (attempt, max) => {
  console.log(`Reconnecting... (${attempt}/${max})`);
});

client.on('error', (error) => {
  console.error('Client error:', error);
});

client.on('toolsChanged', (tools) => {
  console.log('Tools updated:', tools.length);
});

await client.connect();
```

### Client Status

```typescript
const status = client.getStatus();

console.log('State:', status.state);
console.log('Server:', status.serverInfo?.name);
console.log('Connected at:', status.connectedAt);
console.log('Pending requests:', status.pendingRequests);
```

### Raw Tool Calls

For low-level access, use `callTool` which returns the raw MCP response:

```typescript
// Raw MCP response
const rawResult = await client.callTool('document-create', {
  title: 'Test'
});

console.log('Content:', rawResult.content);
console.log('Is error:', rawResult.isError);
```

## Configuration

```typescript
interface McpClientConfig {
  // Required
  url: string;                    // Server URL

  // Optional
  transport?: 'sse' | 'http';     // Default: 'sse'
  clientName?: string;            // Default: '@lushly-dev/afd-client'
  clientVersion?: string;         // Default: '0.1.0'
  timeout?: number;               // Default: 30000 (30s)
  autoReconnect?: boolean;        // Default: true
  maxReconnectAttempts?: number;  // Default: 5
  reconnectDelay?: number;        // Default: 1000 (1s)
  headers?: Record<string, string>;
  debug?: boolean;                // Default: false
}
```

## Transports

### SSE Transport (Default)

Best for real-time applications. Maintains a persistent connection for server-pushed events.

```typescript
const client = createClient({
  url: 'http://localhost:3100/sse',
  transport: 'sse',
});
```

### HTTP Transport

Simple request/response. Good for serverless environments or when SSE isn't supported.

```typescript
const client = createClient({
  url: 'http://localhost:3100/message',
  transport: 'http',
});
```

### Direct Transport (Zero Overhead)

For co-located agents (same runtime as the application), use `createDirectClient` to bypass all transport overhead. Build the registry with `createDirectRegistry` from `@lushly-dev/afd-server`: it runs each call through the same engine as the MCP server (Zod input validation, middleware, error sanitization) and only offers commands exposed to agents (`expose.agent`, on by default).

```typescript
import { isSuccess } from '@lushly-dev/afd-core';
import { createDirectClient, isUnknownToolError } from '@lushly-dev/afd-client';
import { createDirectRegistry } from '@lushly-dev/afd-server';
import { commands } from '@my-app/commands';

// Direct execution - ~0.03-0.1ms latency vs 2-10ms for MCP
const client = createDirectClient(createDirectRegistry(commands));

const result = await client.call<Todo>('todo-create', { title: 'Fast!' });
if (isUnknownToolError(result)) {
  console.log(result.data?.hint); // "Did you mean 'todo-create'?"
} else if (isSuccess(result)) {
  console.log('Created:', result.data.id); // result is CommandResult<Todo>
}
```

`call<T>()` returns `CommandResult<T> | CommandResult<UnknownToolError>`, so
`result.success` alone does not narrow it. Rule out the unknown-tool case with
`isUnknownToolError(result)` first.

**Performance comparison:**

| Transport | Avg Latency | Use Case |
|-----------|-------------|----------|
| Direct | ~0.03-0.1ms | Same runtime, max performance |
| MCP HTTP | ~2-5ms | External services |
| MCP SSE | ~5-10ms | Remote agents, real-time |

#### DirectClient Options

```typescript
const client = createDirectClient(registry, {
  source: 'my-agent',      // Identifier propagated to handlers
  debug: true,             // Enable debug logging
  validateInputs: true,    // Shallow checks for registries with getCommand() (default: true)
  middleware: [],          // Client-side middleware, outside the registry's own
  allow: (name) => name.startsWith('todo-'), // Others get COMMAND_NOT_ALLOWED
});
```

`allow` narrows what the client may call. Refused commands return a
`COMMAND_NOT_ALLOWED` failure without reaching the registry, and are left out of
`listCommands()`, `listCommandNames()` and `hasCommand()`.

#### Context Propagation and Timeouts

Pass context to individual calls for tracing, cancellation and timeouts:

```typescript
const result = await client.call('command', args, {
  traceId: 'custom-trace-123',
  timeout: 5000,
  signal: abortController.signal,
});

// Context is propagated to command handlers
// Handler receives: { traceId, source, timeout, signal, ... }
```

`timeout` is enforced (per step in `pipe()`). When it passes, the `signal` the
handler receives aborts (it combines your `signal` with the timeout), and the
call resolves to a `TIMEOUT` failure even if the handler ignores the signal. The
handler may still finish its work, so check a mutation's effect before retrying.

#### Input Validation

`createDirectRegistry` validates every call with the command's Zod schema, so
wrong types, nested objects and out-of-range values are rejected before the
handler runs:

```typescript
const result = await client.call('todo-create', { title: { nested: true } });
// Result: { success: false, error: { code: 'VALIDATION_ERROR', ... } }
```

With a custom registry, DirectClient only performs shallow checks (required
top-level fields, primitive types, enums), and only when the registry implements
`getCommand()`.

#### DirectRegistry Interface

`createDirectRegistry` returns a compatible registry. A custom registry must
implement the following, and is then responsible for its own validation and
exposure checks:

```typescript
import type { CommandDefinition, DirectRegistry } from '@lushly-dev/afd-client';
import type { CommandResult, CommandContext } from '@lushly-dev/afd-core';

class MyRegistry implements DirectRegistry {
  // Required methods
  async execute<T>(
    name: string,
    input?: unknown,
    context?: CommandContext  // Receives traceId, source, etc.
  ): Promise<CommandResult<T>>;

  listCommandNames(): string[];
  listCommands(): Array<{ name: string; description: string }>;
  hasCommand(name: string): boolean;

  // Optional - enables DirectClient's shallow input checks
  getCommand?(name: string): CommandDefinition | undefined;
}
```

## Error Handling

The client wraps all errors in the standard `CommandResult` format:

```typescript
const result = await client.call('document-get', { id: 'not-found' });

if (isFailure(result)) {
  // Error contains:
  // - code: Machine-readable error code
  // - message: Human-readable message
  // - suggestion: What the user can do
  // - retryable: Whether retrying might help
  console.error(`[${result.error.code}] ${result.error.message}`);
  
  if (result.error.suggestion) {
    console.log('Suggestion:', result.error.suggestion);
  }
  
  if (result.error.retryable) {
    // Consider retrying
  }
}
```

## License

MIT
