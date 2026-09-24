# @lushly-dev/afd-client

MCP client library for Agent-First Development.

## Installation

```bash
npm install @lushly-dev/afd-client
# or
pnpm add @lushly-dev/afd-client
```

## Overview

This package provides clients for AFD command servers. It supports:

- **SSE Transport**: Real-time streaming with Server-Sent Events
- **HTTP Transport**: Simple request/response communication
- **Direct Transport**: Zero-overhead in-process execution for co-located agents
- **Auto-reconnection**: Exponential backoff with jitter and a cap
- **Type-safe API**: Full TypeScript support with CommandResult integration

### Supported servers

`McpClient` talks to **AFD servers**: `createMcpServer()` from `@lushly-dev/afd-server`
(and the AFD Python server), through their HTTP transport:

| Route | Used for |
|-------|----------|
| `GET <base>/sse` | Event stream of the `sse` transport |
| `POST <base>/message` | JSON-RPC requests (`initialize`, `tools/list`, `tools/call`) |
| `GET <base>/health` | Reachability check on connect (`http` transport) |
| `POST <base>/stream/<command>` | `stream()` |

`McpClient` is **not a general MCP client**. It does not implement the MCP Streamable HTTP
transport (the `Accept: application/json, text/event-stream` negotiation and its session
handling), and it ignores the `endpoint` event of the legacy MCP SSE transport. Servers built
on the official MCP SDK answer it with HTTP 406 or 400. To talk to those servers, use the
official `@modelcontextprotocol/sdk` client.

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

- `connected` fires once the server is initialized **and** the tools list is loaded, so
  `client.getTools()` is ready inside the handler. A failed tools refresh does not fail the
  connection; the list stays empty.
- While reconnecting, each attempt emits `reconnecting`; failed attempts emit nothing else. If
  every attempt fails, the client emits one `error` ("Max reconnection attempts reached", with the
  last failure as `cause`) and moves to the `error` state.
- The delay before attempt *n* is `reconnectDelay * 2^(n-1)` plus up to 100 ms of jitter, capped
  at `maxReconnectDelay`.
- The `sse` transport notices a closed event stream. The `http` transport has no persistent
  connection, so it reports the connection as lost after 3 consecutive requests get no HTTP
  response at all; `autoReconnect` then applies to it too.

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

`callTool()` and `request()` take an optional `{ timeout }` that overrides the client timeout
for that request. They throw `NotConnectedError`, `RequestTimeoutError`, `JsonRpcResponseError`
(with the JSON-RPC `code` and `data`) or `HttpStatusError`; `call()`, `batch()`, `pipe()` and
`stream()` never throw and return these as failures instead.

### Batches and Pipelines

```typescript
const batch = await client.batch(
  [
    { command: 'todo-create', input: { title: 'First' } },
    { command: 'todo-create', input: { title: 'Second' } },
  ],
  { timeout: 60_000 } // server-side deadline for the whole batch
);

const pipeline = await client.pipe(
  [{ command: 'user-get', input: { id: 1 }, as: 'user' }],
  { timeoutMs: 60_000 } // server-side deadline for the whole pipeline
);
```

The request waits for the batch `timeout` or pipeline `timeoutMs` plus a 5 second margin
(`SERVER_DEADLINE_MARGIN_MS`), and never less than the client `timeout`, so the server's own
timeout result arrives first.

If the server rejected the request (a JSON-RPC error, an HTTP 4xx) or the client was not
connected, nothing ran and the result is a definite failure. If the request timed out or the
connection failed after it was sent, the server may already have run some commands, so the
client does not guess: the result is an `OUTCOME_UNKNOWN` failure with `retryable: false`. A
batch then has no per-command `results` and zero success and failure counts; a pipeline has a
single pipeline-level step entry (`index: -1`) carrying the error. Check the commands' effects
before retrying.

### Streaming

```typescript
for await (const chunk of client.stream('report-generate', { month: 9 }, { timeout: 60_000 })) {
  if (chunk.type === 'data') render(chunk.data);
  if (chunk.type === 'error') console.error(chunk.error.code, chunk.error.suggestion);
}
```

`stream()` posts to `<base>/stream/<command>`, where `<base>` is the client URL without a
trailing `/sse`, `/message` or `/messages` (so `https://host/api/mcp/sse` streams from
`https://host/api/mcp/stream/<command>`). It parses the event stream per the SSE spec
(`data:` with or without a space, multi-line `data`, comments, CRLF), and the last chunk is
always a `complete` or `error` chunk. The client makes the error chunk itself when:

| Code | When |
|------|------|
| `NOT_CONNECTED` | `stream()` was called before `connect()` (nothing is sent) |
| `STREAM_TRUNCATED` | The stream ended without a `complete` or `error` chunk |
| `STREAM_TIMEOUT` | `options.timeout` passed |
| `STREAM_CANCELLED` | `options.signal` aborted, or `disconnect()` was called |
| `STREAM_EVENT_TOO_LARGE` | One event exceeded `maxStreamEventSize` (default 1 MiB) |

## Configuration

```typescript
interface McpClientConfig {
  url?: string;                   // Server URL (required unless transport is 'direct')
  endpoint?: string;              // Alias for url

  transport?: 'sse' | 'http' | 'direct'; // Default: 'sse'
  registry?: DirectRegistry;      // Required with transport: 'direct'
  clientName?: string;            // Default: '@lushly-dev/afd-client'
  clientVersion?: string;         // Default: '0.1.0'
  timeout?: number;               // Default: 30000 (30s)
  autoReconnect?: boolean;        // Default: true
  maxReconnectAttempts?: number;  // Default: 5
  reconnectDelay?: number;        // Default: 1000 (1s), doubles per attempt
  maxReconnectDelay?: number;     // Default: 30000 (30s)
  maxStreamEventSize?: number;    // Default: 1048576 characters
  headers?: Record<string, string>;
  debug?: boolean;                // Default: false
}
```

Other transport names (`'websocket'`, `'stdio'`) are rejected by the type and, for JavaScript
callers, by the constructor with an error that names the supported ones.

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

### Direct Transport with McpClient

`transport: 'direct'` runs an `McpClient` against an in-process registry, so code written for a
remote AFD server works unchanged in tests or embedded setups. `call()`, `batch()`, `pipe()`
and `stream()` all work (batches and pipelines run through the same core executors as the
server). No URL is needed.

```typescript
import { createClient } from '@lushly-dev/afd-client';
import { createDirectRegistry } from '@lushly-dev/afd-server';

const client = createClient({ transport: 'direct', registry: createDirectRegistry(commands) });
await client.connect();
const result = await client.call('todo-list', {});
```

An unknown command returns an `UNKNOWN_TOOL` failure whose `suggestion` names the closest
command, exactly as `DirectClient` does, and a command that throws returns a
`COMMAND_EXECUTION_ERROR` failure without the exception text.

### DirectClient (Zero Overhead)

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

`call()` never rejects. If a registry, handler or client middleware throws, it returns a
`COMMAND_EXECUTION_ERROR` failure without the exception text (turn on `debug` to log the
exception), the same result `createDirectRegistry()` and the MCP server give.

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

Protocol and transport errors map to AFD codes with a `suggestion` and no stack trace. The
server's own `error.data.suggestion` is used when it sends one.

| Cause | `code` | `retryable` |
|-------|--------|-------------|
| JSON-RPC -32700 | `PARSE_ERROR` | no |
| JSON-RPC -32600 | `INVALID_REQUEST` | no |
| JSON-RPC -32601 | `METHOD_NOT_FOUND` | no |
| JSON-RPC -32602 | `INVALID_INPUT` | no |
| JSON-RPC -32603 | `INTERNAL_ERROR` | yes |
| JSON-RPC -32000 (AFD: Host, Origin, Content-Type or size rejected) | `REQUEST_REJECTED` | no |
| JSON-RPC -32001 (AFD: unknown or expired `Mcp-Session-Id`) | `SESSION_NOT_FOUND` | yes |
| Other JSON-RPC codes | `JSON_RPC_ERROR` | no |
| Other HTTP status | `HTTP_<status>` | 5xx and 429 only |
| No response within `timeout` | `TIMEOUT` | yes |
| Network failure | `CONNECTION_ERROR` | yes |
| Called before `connect()` | `NOT_CONNECTED` | no |

The details carry `jsonRpcCode` for JSON-RPC errors.

## Handoff Reconnection

`createReconnectingHandoff(client, handoff, options)` accepts any client with a
`call(name, args)` method (`HandoffCommandClient`), so both `McpClient` and `DirectClient` work.
If the initial connection fails, the promise rejects and nothing keeps running: a browser
WebSocket that reports a failed handshake as `error` followed by `close` (1006) does not start
a background reconnect loop.

## License

MIT
