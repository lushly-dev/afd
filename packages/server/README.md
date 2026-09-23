# @lushly-dev/afd-server

Server-side utilities for building AFD-compliant MCP servers with Zod validation.

## Installation

```bash
npm install @lushly-dev/afd-server
# or
pnpm add @lushly-dev/afd-server
```

## Features

- **Zod-based Command Definition** - Define commands with Zod schemas for type-safe validation
- **Auto JSON Schema Generation** - Automatic conversion to JSON Schema for MCP tool definitions
- **Multiple Transport Support** - stdio for IDE/agent integration, HTTP/SSE for browser clients
- **Auto Transport Detection** - Automatically selects the right transport based on environment
- **Built-in Validation** - Automatic input validation before handler execution
- **Middleware System** - Logging, tracing, rate limiting, and custom middleware
- **Command Prerequisites** - Declare `requires` dependencies so agents can plan execution order
- **Full TypeScript Support** - Complete type inference from Zod schemas

## Quick Start

```typescript
import { z } from 'zod';
import { defineCommand, createMcpServer, defaultMiddleware, success, failure } from '@lushly-dev/afd-server';

// Define a command with Zod schema
const greet = defineCommand({
  expose: { mcp: true }, // Explicitly allow remote invocation
  name: 'greet',
  description: 'Greet a user by name',
  category: 'demo',
  input: z.object({
    name: z.string().min(1, 'Name is required'),
    formal: z.boolean().default(false),
  }),

  async handler(input) {
    const greeting = input.formal
      ? `Good day, ${input.name}.`
      : `Hello, ${input.name}!`;

    return success({ greeting }, {
      reasoning: `Generated ${input.formal ? 'formal' : 'casual'} greeting`,
      confidence: 1.0,
    });
  },
});

// Create and start the server (auto-detects transport)
const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  commands: [greet],
  middleware: defaultMiddleware(),  // Trace IDs, logging, slow-command warnings
  port: 3100,
});

await server.start();
console.error(`Server running at ${server.getUrl()}`);
```

## Remote Command Exposure

Remote invocation now enforces the core exposure contract: commands require `expose: { mcp: true }`. Omitting `expose`, omitting `expose.mcp`, or setting it to `false` keeps a command private. This applies to tool listing, discovery, direct MCP calls, `afd-call`, batch, pipelines, `/rpc`, and streaming. Existing applications should explicitly opt in their public commands. The server's in-process `execute()` and `executePipeline()` remain available for private commands.

Configured `contexts` automatically register `afd-context-list`, `afd-context-enter`, and `afd-context-exit`. Active contexts scope all remote execution paths. Context state belongs to the client, not the server: stdio has one stack, and each HTTP session has its own (see [Context Management](#context-management)).

## Embedding In A Host-Controlled HTTP Server

Use `createMcpHandler()` when your platform owns the HTTP server lifecycle and expects a request handler instead of a self-starting server object:

```typescript
import { createServer } from 'node:http';
import { createMcpHandler } from '@lushly-dev/afd-server';

const handler = createMcpHandler({
  name: 'my-server',
  version: '1.0.0',
  commands: [greet],
  host: '127.0.0.1',
  port: 3100,
});

createServer((req, res) => {
  void handler(req, res);
}).listen(3100, '127.0.0.1');
```

Call `handler.dispose()` when the embedding host shuts down to close active SSE/stream responses and drop HTTP sessions. The host still owns its listener and other connections.

Use `createMcpServer()` for the batteries-included standalone server. Use `createMcpHandler()` when you need AFD to plug into an existing Node HTTP host.

## Transport Protocols

The server supports multiple transport protocols for different use cases:

### Auto-Detection (Default)

By default, the server auto-detects the best transport based on the environment:

```typescript
const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  commands: [greet],
  // transport: 'auto' is the default
});

// When stdin is piped (IDE/agent context): uses stdio
// When stdin is a TTY (interactive context): uses HTTP
```

> **Pitfall:** `auto` picks stdio whenever stdin is not a TTY. Under Docker without `-t`, systemd, pm2 or CI, the server therefore speaks stdio and the HTTP port never opens. Set `transport: 'http'` for any server that must listen on the network. `start()` logs the resolved transport to stderr, for example `[my-server] MCP transport: stdio (auto-detected because stdin is not a TTY; set transport: 'http' to serve HTTP)`.

### stdio Transport (IDE/Agent Integration)

Use stdio for integration with IDE MCP clients like Cursor, Claude Code, or Antigravity:

```typescript
const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  commands: [greet],
  transport: 'stdio',  // Explicit stdio mode
});

await server.start();
// Server reads JSON-RPC from stdin, writes to stdout
```

In your IDE's MCP configuration (adjust the path to match your project):
```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["path/to/your/server.js"]
    }
  }
}
```

### HTTP Transport (Browser/Web UI)

Use HTTP for browser-based clients and web UIs:

```typescript
const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  commands: [greet],
  transport: 'http',  // Explicit HTTP mode
  port: 3100,
});

await server.start();
console.error(`Server running at ${server.getUrl()}`);
// Exposes /sse, /message, /health endpoints
```

## Defining Commands

### Basic Command

```typescript
import { z } from 'zod';
import { defineCommand, success, failure } from '@lushly-dev/afd-server';

const createUser = defineCommand({
  name: 'user-create',
  description: 'Create a new user',
  category: 'users',
  mutation: true,
  
  input: z.object({
    email: z.string().email(),
    name: z.string().min(1).max(100),
    role: z.enum(['admin', 'user', 'guest']).default('user'),
  }),
  
  async handler(input) {
    // Your implementation
    const user = await db.users.create(input);
    
    return success(user, {
      reasoning: `Created user ${user.email} with role ${user.role}`,
    });
  },
});
```

### Command with Error Handling

```typescript
const getUser = defineCommand({
  name: 'user-get',
  description: 'Get a user by ID',
  category: 'users',
  errors: ['NOT_FOUND'],
  
  input: z.object({
    id: z.string().uuid(),
  }),
  
  async handler(input) {
    const user = await db.users.find(input.id);
    
    if (!user) {
      return failure({
        code: 'NOT_FOUND',
        message: `User with ID "${input.id}" not found`,
        suggestion: 'Check the ID or use user-list to find available users',
      });
    }
    
    return success(user);
  },
});
```

### Command with Prerequisites

```typescript
const secretData = defineCommand({
  name: 'secret-data',
  description: 'Return sensitive data for the authenticated user',
  requires: ['auth-sign-in'],  // Agent sees this before calling
  input: z.object({}),

  async handler(input, context) {
    return success({ secret: '...' });
  },
});
```

Prerequisites are metadata — they tell agents what to call first but are not enforced at runtime (middleware handles enforcement). They appear in MCP tool `_meta` and `afd-help` output.

### Command with Output Schema

Declare what a command returns so agents know the response shape before calling:

```typescript
const Todo = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
});

const listTodos = defineCommand({
  name: 'todo-list',
  description: 'List all todo items',
  input: z.object({ filter: z.enum(['all', 'active', 'done']).optional() }),
  output: Todo.array(),  // Agents see this in _meta.outputSchema and afd-detail
  async handler(input) {
    const todos = await store.list(input.filter);
    return success(todos, { reasoning: `Found ${todos.length} todos` });
  },
});
```

Output schemas are optional (backward compatible). They describe the shape of `CommandResult.data`, not the full envelope. No runtime output validation is performed.

### Command with Context Scoping

Restrict commands to specific contexts for large command sets:

```typescript
const formatDoc = defineCommand({
  name: 'doc-format',
  description: 'Format the current document',
  contexts: ['editing'],  // Only visible when 'editing' context is active
  input: z.object({ style: z.string() }),
  async handler(input) { ... },
});
```

Commands without `contexts` are universal (always visible). See "Context Management" below for server-level context configuration.


## Server Configuration

```typescript
const server = createMcpServer({
  // Required
  name: 'my-server',
  version: '1.0.0',
  commands: [cmd1, cmd2, cmd3],

  // Optional
  port: 3100,              // Default: 3100
  host: 'localhost',       // Default: localhost
  transport: 'http',       // Default: 'auto' (see the pitfall above)
  cors: true,              // Send CORS headers (default: follows devMode)

  // Per-request context for HTTP calls (see "Request Context")
  createContext: (req) => ({ clientIp: req.socket.remoteAddress ?? 'unknown' }),

  // Middleware — zero-config observability
  middleware: defaultMiddleware(),

  // Callbacks
  onCommand(command, input, result) {
    console.log(`Executed ${command}:`, result.success);
  },
  onError(error) {
    console.error('Server error:', error);
  },
});
```

## Middleware

### Default Middleware (Recommended)

`defaultMiddleware()` returns a pre-configured stack of three middleware covering common observability needs:

1. **Auto Trace ID** — generates `context.traceId` via `crypto.randomUUID()` when not present
2. **Structured Logging** — logs command start/completion with trace ID correlation
3. **Slow-Command Warnings** — warns when commands exceed a configurable threshold (default: 1000ms)

```typescript
import { defaultMiddleware } from '@lushly-dev/afd-server';

// Zero-config — all three enabled
middleware: defaultMiddleware()

// Selective disable
middleware: defaultMiddleware({ timing: false })

// Custom options
middleware: defaultMiddleware({
  logging: { logInput: true },
  timing: { slowThreshold: 500, onSlow: (name, ms) => logger.warn(`${name}: ${ms}ms`) },
  traceId: { generate: () => `custom-${Date.now()}` },
})

// Compose with custom middleware
middleware: [...defaultMiddleware(), myAuthMiddleware, myRateLimiter]
```

### Logging

```typescript
import { createLoggingMiddleware } from '@lushly-dev/afd-server';

const middleware = createLoggingMiddleware({
  log: console.log,        // Custom log function
  logInput: false,         // Don't log input (may contain sensitive data)
  logResult: false,        // Don't log full results
});
```

### Timing

```typescript
import { createTimingMiddleware } from '@lushly-dev/afd-server';

const middleware = createTimingMiddleware({
  slowThreshold: 1000,     // Warn if command takes > 1s
  onSlow(command, durationMs) {
    console.warn(`Slow command: ${command} took ${durationMs}ms`);
  },
});
```

### OpenTelemetry Tracing

```typescript
import { trace } from '@opentelemetry/api';
import { createTracingMiddleware } from '@lushly-dev/afd-server';

const tracer = trace.getTracer('my-app');

const middleware = createTracingMiddleware({
  tracer,
  spanPrefix: 'command',   // Span names: command.user-create, etc.
});
```

### Rate Limiting

Key the limiter on a value that identifies the caller. Over HTTP, provide it with `createContext`; the default key (`'global'`) shares one budget between all clients, and `traceId` is unique per call, so it never limits anything.

```typescript
import { createMcpServer, createRateLimitMiddleware } from '@lushly-dev/afd-server';

const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  commands,
  transport: 'http',
  // Prefer an authenticated user ID; fall back to the socket address. Do not trust
  // X-Forwarded-For unless your own proxy sets it.
  createContext: (req) => ({
    clientId: authenticate(req)?.userId ?? req.socket.remoteAddress ?? 'unknown',
  }),
  middleware: [
    createRateLimitMiddleware({
      maxRequests: 100,
      windowMs: 60000,         // 100 requests per minute, per client
      keyFn: (context) => String(context.clientId ?? 'unknown'),
    }),
  ],
});
```

### Custom Middleware

```typescript
import type { CommandMiddleware } from '@lushly-dev/afd-server';

const myMiddleware: CommandMiddleware = async (commandName, input, context, next) => {
  console.log(`Before: ${commandName}`);
  const result = await next();
  console.log(`After: ${commandName}, success: ${result.success}`);
  return result;
};
```

## Validation Utilities

```typescript
import { validateInput, validateOrThrow, isValid, patterns } from '@lushly-dev/afd-server';

// Validate and get result
const result = validateInput(schema, data);
if (!result.success) {
  console.log(result.errors);
}

// Validate or throw
try {
  const data = validateOrThrow(schema, input);
} catch (e) {
  if (e instanceof ValidationException) {
    console.log(e.errors);
  }
}

// Check validity
if (isValid(schema, data)) {
  // data is typed
}

// Common patterns
const schema = z.object({
  id: patterns.uuid,
  email: patterns.email,
  count: patterns.positiveInt,
  ...patterns.pagination,
});
```

## API Reference

### defineCommand(options)

Create a command definition with Zod schema.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | string | Yes | Unique command name (e.g., `user-create`) |
| `description` | string | Yes | Human-readable description |
| `input` | ZodType | Yes | Zod schema for input validation |
| `handler` | function | Yes | Command implementation |
| `category` | string | No | Category for grouping |
| `mutation` | boolean | No | Whether command has side effects |
| `version` | string | No | Command version |
| `tags` | string[] | No | Additional tags |
| `output` | ZodType | No | Output schema — declares response `data` shape for agent introspection |
| `contexts` | string[] | No | Restrict command to specific contexts (omit for universal) |
| `requires` | string[] | No | Commands that should be called before this one (metadata only) |
| `errors` | string[] | No | Possible error codes |

### createMcpServer(options)

Create an MCP server from commands.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | string | Yes | Server name |
| `version` | string | Yes | Server version |
| `commands` | array | Yes | Command definitions |
| `transport` | `'stdio' \| 'http' \| 'auto'` | No | Transport protocol (default: `'auto'`, which picks stdio whenever stdin is not a TTY) |
| `port` | number | No | Port for HTTP transport (default: 3100) |
| `host` | string | No | Host for HTTP transport (default: localhost) |
| `toolStrategy` | `'individual' \| 'grouped' \| 'lazy'` | No | How commands appear as MCP tools (default: `'grouped'`) |
| `contexts` | `{ name, description }[]` | No | Context scopes for dynamic tool filtering |
| `devMode` | boolean | No | Enable development mode (default: false) |
| `cors` | boolean | No | Enable CORS for HTTP transport (default: follows devMode) |
| `allowedOrigins` | string[] | No | Additional exact browser origins |
| `allowedHosts` | string[] | No | Accepted HTTP hostnames, without ports |
| `maxBodyBytes` | number | No | Maximum JSON body bytes (default: 1048576) |
| `createContext` | `(req) => object \| Promise<object>` | No | Per-request values merged into the `CommandContext` of every remotely executed HTTP command |
| `maxSseConnections` | number | No | Concurrent `/sse` connections before HTTP 503 (default: 100) |
| `maxSessions` | number | No | Live HTTP sessions when `contexts` are set; the least recently used is evicted (default: 1000) |
| `sessionIdleTimeoutMs` | number | No | Idle time before an HTTP session expires (default: 1800000, 30 minutes) |
| `middleware` | array | No | Middleware functions |
| `onCommand` | function | No | Command execution callback |
| `onError` | function | No | Error callback |

### defaultMiddleware(options?)

Returns a pre-configured `CommandMiddleware[]` with trace ID generation, logging, and timing.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `logging` | `LoggingOptions \| false` | enabled | Structured logging config, or `false` to disable |
| `timing` | `TimingOptions \| false` | enabled (1000ms) | Slow-command warning config, or `false` to disable |
| `traceId` | `TraceIdOptions \| false` | enabled (UUID) | Trace ID auto-generation config, or `false` to disable |

### Server Methods

| Method | Description |
|--------|-------------|
| `start()` | Start the server |
| `stop()` | Stop the server |
| `getUrl()` | Get server URL (`"stdio://"` for stdio transport) |
| `getTransport()` | Get the resolved transport mode (`"stdio"` or `"http"`) |
| `getCommands()` | Get registered commands |
| `execute(name, input, context)` | Execute command directly |

## HTTP Endpoints

The server exposes these endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/sse` | GET | SSE connection for MCP clients |
| `/message` | POST | JSON-RPC message endpoint |
| `/rpc` | POST | Simple JSON-RPC for browser clients |
| `/health` | GET | Health check |
| `/batch` | POST | Batch command execution |
| `/stream/:name` | POST | SSE chunks with command input in the JSON body |
| `/stream/:name?input=...` | GET | Legacy streaming with JSON input in the query; refused (HTTP 405) for `mutation: true` commands |

### JSON-RPC Behavior (`/message` and `/rpc`)

- A message with `"jsonrpc": "2.0"` and no `id` is a notification. It is answered with HTTP 202 and an empty body. On `/message` it is not executed (MCP notifications need no work here, and a request method sent without an `id` could not return its result). On `/rpc` the command runs, but its result is not sent. The simple `/rpc` format without a `jsonrpc` member is always answered, with `id: null` if omitted.
- Protocol errors are JSON-RPC error objects, with recovery guidance in `error.data.suggestion`:

| Code | Meaning | HTTP status |
|------|---------|-------------|
| `-32700` | Body is not valid JSON | 400 |
| `-32600` | Not a valid request object (including batch arrays, which are not supported) | 400 |
| `-32601` | Unknown MCP method | 200 |
| `-32602` | Invalid `tools/call` params | 200 |
| `-32603` | Internal error (for example a throwing `createContext`); details only in `devMode` | 200 |
| `-32000` | Transport rejection: Host, Origin, Content-Type or body size | 400, 403, 413 or 415 |
| `-32001` | Unknown or expired `Mcp-Session-Id` | 404 |

Command failures are not protocol errors: they stay AFD `CommandResult` failures inside `result`. `/batch` and `/stream` are not JSON-RPC and answer errors with `{ success: false, error: { code, message, suggestion } }`.

### Sessions (`Mcp-Session-Id`)

When `contexts` are configured, `initialize` on `/message` returns an `Mcp-Session-Id` response header. Repeat it on later `/message`, `/rpc`, `/batch` and `/stream` requests to use that session's context stack. Requests without the header are stateless. An unknown or expired session ID is answered with HTTP 404; start a new session with `initialize`. `@lushly-dev/afd-client` does this automatically. Without `contexts`, no session is issued and the header is ignored.

### SSE Connections

`/sse` accepts at most `maxSseConnections` concurrent connections (default: 100); more receive HTTP 503 with `Retry-After`. Open connections get a `: ping` comment every 25 seconds so proxies keep them open and dead peers are detected. Closed connections are removed immediately, and `dispose()`/`stop()` closes the rest.

### Browser-Friendly `/rpc` Endpoint

The `/rpc` endpoint provides a simple JSON-RPC interface for browser clients:

```typescript
// Request format
{
  method: "command-name",  // The command to execute
  params: { ... },         // Input parameters
  id: 1                    // Optional request ID
}

// Response format
{
  jsonrpc: "2.0",
  id: 1,
  result: CommandResult    // The AFD CommandResult
}
```

### Browser Example (Vanilla JavaScript)

```javascript
async function callCommand(method, params) {
  const response = await fetch('http://localhost:3100/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params, id: Date.now() }),
  });

  const { result, error } = await response.json();
  if (error) throw new Error(error.message);
  return result;
}

// Usage
const result = await callCommand('greet', { name: 'World' });
console.log(result.data.greeting); // "Hello, World!"
```

### CORS Configuration

HTTP requests validate Host and browser Origin before dispatch. The default Host allowlist contains the configured host and loopback names. Requests without an Origin (such as CLI clients) and same-origin browser requests are accepted. Cross-site browser requests are rejected unless their exact Origin is listed in `allowedOrigins`. `cors: true` adds response headers for accepted origins; it does not disable request validation. `devMode: true` intentionally permits any browser origin, while Host checks remain enabled.

All POST endpoints require `Content-Type: application/json`. Request bodies are limited to 1 MiB by default; set `maxBodyBytes` to change the limit. Configure `allowedHosts` and `allowedOrigins` explicitly when embedding behind a proxy. Forwarded headers are not trusted automatically.

POST streaming is preferred because input stays out of URLs. Legacy GET streaming remains supported and applies the same browser-origin policy.

Configure a browser UI explicitly:

```typescript
const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  commands: [greet],
  transport: 'http',
  port: 3100,
  cors: true,
  allowedOrigins: ['https://app.example.com'],
  allowedHosts: ['localhost', 'api.example.com'],
  maxBodyBytes: 1024 * 1024,
});
```

## Lazy Strategy

For servers with many commands, the `lazy` strategy exposes 5 meta-tools instead of listing all commands:

```typescript
const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  commands: allCommands,
  toolStrategy: 'lazy',
});
```

Agents discover commands at runtime: `afd-discover` (filter/list) → `afd-detail` (get schemas) → `afd-call` (execute).

| Meta-Tool | Description |
|-----------|-------------|
| `afd-discover` | List commands by category, tag, or search (paginated, max 200) |
| `afd-detail` | Get full schema for 1–10 commands by name |
| `afd-call` | Universal dispatcher — available in all strategies |
| `afd-batch` | Execute multiple commands in one call |
| `afd-pipe` | Pipeline execution with step references |

## Context Management

Dynamic context scoping filters which commands are visible:

```typescript
const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  commands: allCommands,
  contexts: [
    { name: 'editing', description: 'Document editing tools' },
    { name: 'reviewing', description: 'Review and approval tools' },
  ],
});
```

When contexts are configured, the server registers three additional bootstrap commands:

- **`afd-context-list`** — Lists all contexts and the active context
- **`afd-context-enter`** — Pushes a context onto the stack (filters visible tools)
- **`afd-context-exit`** — Pops the current context (restores previous)

Commands without `contexts` are always visible. Context commands themselves are always visible.

Context state is per client:

- **stdio** serves one client, so it keeps one stack.
- **HTTP** keeps one stack per session. `initialize` returns an `Mcp-Session-Id` header, and requests that repeat it share that session's stack; one client entering a context never changes another client's `tools/list` or execution. Requests without the header see no active context, and `afd-context-enter`/`afd-context-exit` return `SESSION_REQUIRED` for them. Sessions expire after `sessionIdleTimeoutMs` of inactivity, and at most `maxSessions` are kept.
- A stack holds at most 16 contexts (`CONTEXT_DEPTH_EXCEEDED` beyond that), and re-entering the active context is a no-op.
- In-process `server.execute()` ignores contexts.

## Request Context

`createContext(req)` derives per-request values from the HTTP request, such as the authenticated user or the remote address. Its result is merged into the `CommandContext` of every command the request runs: `tools/call`, `afd-call`, `afd-batch` items, `afd-pipe` steps, `/rpc`, `/batch` and `/stream`. Middleware and handlers read the values from `context`:

```typescript
const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  commands,
  transport: 'http',
  createContext: async (req) => ({ user: await verifyBearerToken(req.headers.authorization) }),
  middleware: [
    async (command, input, context, next) =>
      context.user
        ? next()
        : failure({ code: 'UNAUTHORIZED', message: 'Sign in first', suggestion: 'Send a bearer token' }),
  ],
});
```

- The server sets `traceId`, `signal` and `interface` (`'mcp'`) itself; `createContext` cannot override them.
- `context.signal` aborts when the client disconnects before the response is finished, on every route, not only streams. Long-running handlers should honor it.
- A throw from `createContext` is reported to `onError` and answered as an internal error (`-32603` on JSON-RPC routes, HTTP 500 elsewhere).
- Pipeline `$input` does not expose these values, so a pipeline cannot copy them into step inputs.
- stdio has no HTTP request, so `createContext` is not called there.

## Related

- [@lushly-dev/afd-core](../core) - Core types and helpers
- [@lushly-dev/afd-client](../client) - MCP client library
- [@lushly-dev/afd-cli](../cli) - Command-line interface
- [Example: Todo App](../examples/todo/) - Complete working example

### Pipeline execution limits

Pipelines run sequentially. `parallel: true` returns an actionable `UNSUPPORTED_OPTION` failure before invoking a command. `timeoutMs` bounds each awaited step by the remaining pipeline deadline and aborts its `context.signal`; handlers must honor that signal to stop their own work. A timed-out mutation may still finish if its handler ignores cancellation, so inspect partial results before retrying. Numeric `$steps[n]` references use original request indices, including skipped or failed steps. `$first` refers to original step zero; `$prev` keeps the last successful result.

Variable references follow [`spec/pipeline-variables.md`](../../spec/pipeline-variables.md). `afd-pipe` accepts an optional top-level `input` (any JSON value) that steps read as `$input` and `$input.<path>`; `$input` never exposes the server's execution context (trace ID, auth or other context values), which it used to. Only whole strings of the reference forms are resolved: other `$` strings such as `$9.99` are literals, and `$$` sends a literal `$`. Paths follow only own keys of plain JSON objects and in-bounds array indices, so `constructor`, `__proto__` and other `__`-prefixed segments never resolve. Unresolved references are omitted from objects, become `null` in arrays, and make `when` comparisons false. Step inputs or `input` nested deeper than 64 levels are rejected with `VALIDATION_ERROR` before any step runs. Step data is copied between steps, so a handler that mutates its input cannot change another step's data.

Default logging and console telemetry write to stderr so stdio MCP frames remain valid. In-memory rate limiting expires old client keys as requests arrive and caps active keys with `maxKeys` (default: 10000); new keys receive `RATE_LIMITED` while capacity is full.
