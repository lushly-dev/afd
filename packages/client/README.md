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

The default `streamable-http` transport is built on the official MCP TypeScript SDK client
(`@modelcontextprotocol/client`). It talks to an AFD server's `/mcp` endpoint, to the Python and
Rust AFD servers, and to any server built on an official MCP SDK. It negotiates the protocol
revision with `protocolMode`:

| `protocolMode` | Behavior |
|----------------|----------|
| `'auto'` (default) | Probe `server/discover`; use MCP 2026-07-28 (stateless, per-request `_meta`) when offered, else the 2025 `initialize` handshake |
| `'legacy'` | Always use the 2025 `initialize` handshake |
| `'modern'` | Require MCP 2026-07-28; `connect()` fails otherwise |

`connect()` resolves with the negotiated `protocolVersion`, the server's capabilities and
identity. The transport is chosen from the URL unless `transport` is set: `sse` for a URL ending
in `/sse`, `streamable-http` otherwise.

| Route | Used for |
|-------|----------|
| `POST <base>/mcp` | MCP requests of the `streamable-http` transport |
| `POST <base>/stream/<command>` | `stream()` (a `/mcp` URL streams from the sibling `/stream` path) |
| `GET <base>/sse`, `POST <base>/message` | The deprecated `sse` and `http` transports (AFD servers' 2024-11-05 lane) |
| `GET <base>/health` | Reachability check on connect (`http` transport) |

## Usage

### Basic Connection

```typescript
import { createClient } from '@lushly-dev/afd-client';

// Create client
const client = createClient({
  url: 'http://localhost:3100/mcp', // streamable-http, MCP 2026-07-28 when offered
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

const client = createClient({ url: 'http://localhost:3100/mcp' });
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

Pass per-request deadlines and cancellation to `call()`, `callTool()`, or `request()`:

```typescript
const result = await client.call('item-get', { id: '123' }, {
  timeout: 5_000,
  signal: controller.signal,
});
```

With the direct transport, deadlines and cancellation settle the request even when a handler
ignores its abort signal. Disconnecting also aborts active execution. A handler that has already
started may still complete its side effects; check a mutation's effect before retrying.
Direct discovery preserves the registry's input schema and planning metadata.
HTTP and SSE session renewal requires a successful JSON-RPC initialize result and a replacement
session ID before replaying a rejected request. Concurrent requests share renewal work.

### Event Handling

```typescript
const client = createClient({
  url: 'http://localhost:3100/mcp',
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

On the deprecated `sse` and `http` transports a stream runs in the client's MCP session: it
sends the `Mcp-Session-Id` from `initialize`, so it sees the active context entered with
`afd-context-enter`, like `call()`. The `streamable-http` transport has no session, so its
streams run with no active context. If the server has
expired the session (HTTP 404), the client starts a new session and retries the stream once.

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

### Streamable HTTP Transport (Default)

MCP Streamable HTTP through the official MCP SDK client. Each request is its own POST, so it
works behind load balancers and in serverless environments.

```typescript
const client = createClient({
  url: 'http://localhost:3100/mcp',
  transport: 'streamable-http', // the default for this URL
  protocolMode: 'auto',
});
```

On MCP 2026-07-28 there is no session: select a context per request with
`_meta["dev.afd/context"]` (see `@lushly-dev/afd-server`), not `afd-context-enter`.

### SSE Transport (Deprecated)

The AFD server's 2024-11-05 lane: a persistent `/sse` stream plus `POST /message`. It is kept for
servers that predate `/mcp` and is removed in 3.0.

```typescript
const client = createClient({
  url: 'http://localhost:3100/sse',
  transport: 'sse',
});
```

### HTTP Transport (Deprecated)

Request/response against the AFD server's `POST /message`. Removed in 3.0.

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
`COMMAND_EXECUTION_ERROR` failure without the exception text. `listTools()` returns the
registry's MCP tool list when it has a tool surface (`createDirectToolSurface()`), so it names
the meta-tools and grouped tools that `call()` routes, and one tool per command otherwise.

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
  actor: { kind: 'agent', label: 'Assistant', onBehalfOf: userId }, // Default: { kind: 'human' }
  clock: fixedClock('2026-01-01T00:00:00Z'), // context.clock (default: the registry's)
  random: seededRandom('test-seed'),         // context.random (default: the registry's)
  onApprovalNeeded: async ({ summary }) => askUser(summary), // APPROVAL_REQUIRED: true retries once
});
```

`actor`, `clock` and `random` become `context.actor`, `context.clock` and
`context.random` for every call, unless the call's own context sets them. The
default actor is `{ kind: 'human' }`: set `{ kind: 'agent' }` when an in-app
assistant drives the client, so middleware, telemetry and `metadata.actorKind`
can tell it apart from the user.

`allow` narrows what the client may call. Refused commands return a
`COMMAND_NOT_ALLOWED` failure without reaching the registry, and are left out of
`listCommands()`, `listCommandNames()`, `hasCommand()` and `listTools()`. The
client also passes its check to the registry as the `allow` call option, on
every call, `pipe()` step and approval retry, so a `createDirectRegistry()`
registry enforces it on every command a call runs (see below).

#### AFD Contexts and Tools

With a registry built by `createDirectRegistry(commands, { contexts, tools:
createDirectToolSurface() })` from `@lushly-dev/afd-server`:

```typescript
// The context of this call only; pipe() passes it with every step, and an approval retry runs in it.
await client.call('invoice-pay', { id: 'in-1' }, { activeContext: 'billing' });

// What an MCP server with the same commands lists, minus the tools `allow` refuses.
client.listTools({ strategy: 'lazy', activeContext: 'billing' });
```

`activeContext` reaches the registry as a call option beside the command
context, so handlers never see it. `listTools()` throws a `TypeError` when the
registry cannot list tools.

`allow` is enforced per routed command. It checks the tool name a call names
and, through the registry's `allow` call option, every command that tool runs:
the `afd-call` target, each `afd-batch` item, each `afd-pipe` step and a grouped
tool's action. A refused command fails with `COMMAND_NOT_ALLOWED`, and
`afd-discover`, `afd-detail` and `listTools()` leave it out (a grouped tool
lists only the actions `allow` permits). Allow a grouped tool by its group
name, such as `note`. A grouped tool resolves its action among the permitted
commands only: a refused action reads as one the group does not have
(`COMMAND_NOT_FOUND`), and a group with no permitted action is refused with
`COMMAND_NOT_ALLOWED`. A hand-written registry whose `execute` ignores call
options gets name checks only.

```typescript
const allowed = new Set(['afd-call', 'afd-batch', 'afd-pipe', 'note-list']);
const client = createDirectClient(registry, { allow: (name) => allowed.has(name) });

await client.call('afd-call', { command: 'note-list', input: {} });   // runs
await client.call('afd-call', { command: 'note-delete', input: {} }); // COMMAND_NOT_ALLOWED
```

#### Approvals

With `createApprovalMiddleware` installed on the registry, a gated command returns
`APPROVAL_REQUIRED` before its handler runs. `onApprovalNeeded` receives
`{ command, input, summary, expiresAt, actor, reason?, signal? }`:

- On `true`, the client retries the same call once, with the same input and
  actor using a private credential exchange, and
  returns the retry's result. If the token expired while the human decided, the
  retry is held again (`details.reason: 'expired'`) and returned as is; the
  client never retries twice.
- On `false`, a non-`true` value, a hook error, or without a hook, the original
  `APPROVAL_REQUIRED` result is returned unchanged.
- The hook never sees the token. With exchange-aware registries, credentials are absent from results, result
  observer hooks and failure journals. Public `call()`/`pipe()` contexts strip caller-supplied `approval`.
- Pair current `afd-client`, `afd-core` and `afd-server` versions. Custom registries must
  support the private exchange; legacy token-in-result registries remain held and their
  credential field is removed from the returned failure. This cannot remove a credential
  that a legacy registry already sent to its own middleware, observers or journals.
- The application owns the hook and registry configuration. This boundary protects tool
  callers; arbitrary hostile JavaScript in the host process requires process isolation.
- `timeout` applies to each attempt, not the wait. The hook's `signal` is the
  call's signal; a call cancelled during the wait counts as denied.
- In `pipe()`, each gated step asks when it is reached, with its resolved input,
  since tokens are bound to the input. A denied step fails like any other, and
  the pipeline's `timeoutMs` includes the wait.

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
import type { CommandResult, CommandContext, McpTool } from '@lushly-dev/afd-core';

class MyRegistry implements DirectRegistry {
  // Required methods
  async execute<T>(
    name: string,
    input?: unknown,
    context?: CommandContext,  // Receives traceId, source, etc.
    options?: { activeContext?: string }  // Ignore it if you do not scope by context
  ): Promise<CommandResult<T>>;

  listCommandNames(): string[];
  listCommands(): Array<{ name: string; description: string }>;
  hasCommand(name: string): boolean;

  // Optional - enables DirectClient's shallow input checks
  getCommand?(name: string): CommandDefinition | undefined;

  // Optional - enables DirectClient.listTools()
  listTools?(options?: { strategy?: string; activeContext?: string }): McpTool[];
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

`maxAttempts` and `backoffMs` come from `options`, else from the handoff's
`metadata.reconnect`, else from core's `defaultReconnectPolicy` (3 attempts, 1000 ms base
backoff), the same policy `createHandoff()` applies on the server.

## License

MIT
