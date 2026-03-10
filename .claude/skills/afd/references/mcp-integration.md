# MCP Integration

Setting up Model Context Protocol servers and clients.

## Server Setup

### Basic Server

```typescript
import { createMcpServer } from '@lushly-dev/afd-server';
import { allCommands } from './commands/index.js';

const server = createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  commands: allCommands,
});

const PORT = process.env.PORT ?? 3100;
server.listen(PORT, () => {
  console.log(`MCP server running at http://localhost:${PORT}`);
});
```

### With Middleware

```typescript
import {
  createMcpServer,
  defaultMiddleware,
  createRateLimitMiddleware,
} from '@lushly-dev/afd-server';

// Recommended: use defaultMiddleware() for zero-config observability
const server = createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  commands: allCommands,
  middleware: [
    ...defaultMiddleware(),  // Trace IDs, logging, slow-command warnings
    createRateLimitMiddleware({
      maxRequests: 100,
      windowMs: 60000
    }),
  ],
});
```

### Server Endpoints

The server exposes these endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/sse` | GET | Server-Sent Events connection |
| `/message` | POST | MCP JSON-RPC requests |

## Client Setup

### HTTP Transport (Recommended)

```typescript
import { McpClient, HttpTransport } from '@lushly-dev/afd-client';

const client = new McpClient();
await client.connect(new HttpTransport('http://localhost:3100/sse'));

// List available tools
const tools = await client.listTools();
console.log(tools);

// Call a tool
const result = await client.call('todo-create', { 
  title: 'Test',
  priority: 'high' 
});
```

### SSE Transport

```typescript
import { McpClient, SseTransport } from '@lushly-dev/afd-client';

const client = new McpClient();
await client.connect(new SseTransport('http://localhost:3100/sse'));
```

### Connection Management

```typescript
const client = new McpClient();

// Check connection status
console.log(client.state); // 'disconnected' | 'connecting' | 'connected'

// Connect
await client.connect(transport);

// Disconnect
await client.disconnect();

// Reconnect
await client.reconnect();
```

## MCP Protocol Basics

### Request Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "todo-create",
    "arguments": {
      "title": "Test todo",
      "priority": "high"
    }
  }
}
```

### Response Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"success\":true,\"data\":{...}}"
      }
    ]
  }
}
```

### Error Response

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32600,
    "message": "Invalid request"
  }
}
```

## Registering Commands

### Export Pattern

```typescript
// commands/create.ts
export const createTodo = defineCommand({...});

// commands/list.ts
export const listTodos = defineCommand({...});

// commands/index.ts
import { createTodo } from './create.js';
import { listTodos } from './list.js';
import { getTodo } from './get.js';
// ... other imports

export { createTodo, listTodos, getTodo, /* ... */ };

export const allCommands = [
  createTodo,
  listTodos,
  getTodo,
  // ... all commands
];
```

### Server Registration

```typescript
import { allCommands } from './commands/index.js';

const server = createMcpServer({
  name: 'todo-app',
  version: '1.0.0',
  commands: allCommands,
});
```

## Middleware

### Default Middleware (Recommended)

```typescript
import { defaultMiddleware } from '@lushly-dev/afd-server';

// Zero-config: trace IDs, logging, slow-command warnings
middleware: defaultMiddleware()

// Selective disable
middleware: defaultMiddleware({ timing: false })

// Custom options + compose with additional middleware
middleware: [
  ...defaultMiddleware({ timing: { slowThreshold: 500 } }),
  createRateLimitMiddleware({ maxRequests: 100, windowMs: 60000 }),
]
```

### Logging Middleware

```typescript
import { createLoggingMiddleware } from '@lushly-dev/afd-server';

const logging = createLoggingMiddleware({
  log: console.log,
  logInput: false,   // Don't log sensitive input
  logResult: false,
});
```

### Timing Middleware

```typescript
import { createTimingMiddleware } from '@lushly-dev/afd-server';

const timing = createTimingMiddleware({
  slowThreshold: 1000,  // Warn if > 1s
  onSlow: (name, ms) => console.warn(`Slow: ${name} (${ms}ms)`),
});
```

### Rate Limiting

```typescript
import { createRateLimitMiddleware } from '@lushly-dev/afd-server';

const rateLimit = createRateLimitMiddleware({
  maxRequests: 100,
  windowMs: 60000,  // 1 minute
});
```

### Custom Middleware

```typescript
import type { CommandMiddleware } from '@lushly-dev/afd-server';

const authMiddleware: CommandMiddleware = async (
  commandName,
  input,
  context,
  next
) => {
  // Check auth
  if (!context.userId) {
    throw new Error('Unauthorized');
  }
  
  // Call next middleware/handler
  return next();
};
```

## CORS Configuration

For browser clients, configure CORS:

```typescript
const server = createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  commands: allCommands,
  cors: {
    origin: ['http://localhost:5173'],
    methods: ['GET', 'POST', 'OPTIONS'],
    headers: ['Content-Type'],
  },
});
```

## Health Checks

The server provides a `/health` endpoint:

```bash
curl http://localhost:3100/health
# {"status":"ok","name":"my-app","version":"1.0.0"}
```

## Integration with FAST Element

```typescript
import { FASTElement, customElement, observable } from '@microsoft/fast-element';
import { McpClient, HttpTransport } from '@lushly-dev/afd-client';

@customElement({ name: 'app-root' })
export class AppRoot extends FASTElement {
  private client = new McpClient();
  @observable connected = false;
  
  async connectedCallback() {
    super.connectedCallback();
    await this.client.connect(
      new HttpTransport('http://localhost:3100/sse')
    );
    this.connected = true;
  }
  
  async createTodo(title: string) {
    const result = await this.client.call('todo-create', { title });
    if (result.success) {
      console.log('Created:', result.data);
    } else {
      console.error('Error:', result.error?.message);
    }
  }
  
  disconnectedCallback() {
    super.disconnectedCallback();
    this.client.disconnect();
  }
}
```

## Tool Metadata (`_meta`)

When commands have metadata fields set, the MCP `tools/list` response includes a `_meta` object on each tool:

```json
{
  "name": "order-create",
  "description": "Creates a new order",
  "inputSchema": { "type": "object", "properties": { ... } },
  "_meta": {
    "requires": ["auth-sign-in"],
    "mutation": true,
    "examples": [{ "name": "Basic order", "input": { "item": "Widget" } }],
    "outputSchema": { "type": "object", "properties": { "id": { "type": "string" } } },
    "contexts": ["ordering"]
  }
}
```

| Field | Source | Purpose |
|-------|--------|---------|
| `requires` | `defineCommand({ requires })` | Planning-order dependencies |
| `mutation` | `defineCommand({ mutation })` | Whether command changes state |
| `examples` | `defineCommand({ examples })` | Example inputs for agent reference |
| `outputSchema` | `defineCommand({ output })` | JSON Schema of response `data` shape |
| `contexts` | `defineCommand({ contexts })` | Context scopes where command is visible |

`_meta` is only emitted when there is content (no empty objects). Agents can read `_meta.requires` to plan command execution order without trial-and-error.

## Lazy Strategy (Large Command Sets)

For servers with many commands (50+), the `lazy` strategy exposes 5 meta-tools instead of enumerating all commands:

```typescript
const server = createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  commands: allCommands,
  toolStrategy: 'lazy',
});
```

### Discovery Workflow

```
Agent → afd-discover (filter/search) → afd-detail (get schemas) → afd-call (execute)
```

1. **`afd-discover`** — List commands with filtering (category, tag, search). Returns names + short descriptions. Paginated (default limit 50, max 200).
2. **`afd-detail`** — Get full schema for 1–10 commands by name. Returns input schema, output schema, examples, prerequisites, and contexts.
3. **`afd-call`** — Universal dispatcher. Accepts `{ command, input }` and runs the full middleware chain. Available in **all** strategies.

### afd-call (Universal)

`afd-call` works in all three strategies (individual, grouped, lazy):

```typescript
// Agent calls via afd-call
await tools.call('afd-call', {
  command: 'todo-create',
  input: { title: 'Buy milk', priority: 'high' },
});
```

On error, `afd-call` returns fuzzy suggestions for misspelled command names.

## Context Management

For large command sets, contexts dynamically scope which commands are visible:

```typescript
const server = createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  commands: allCommands,
  contexts: [
    { name: 'editing', description: 'Document editing tools' },
    { name: 'reviewing', description: 'Review and approval tools' },
  ],
});
```

### Context Commands

| Command | Description |
|---------|-------------|
| `afd-context-list` | List all configured contexts and the active context |
| `afd-context-enter` | Enter a context (pushes to stack, filters visible tools) |
| `afd-context-exit` | Exit current context (pops stack, restores previous) |

### Command Context Scoping

Commands declare which contexts they belong to:

```typescript
const formatDoc = defineCommand({
  name: 'doc-format',
  description: 'Format the current document',
  contexts: ['editing'],  // Only visible in 'editing' context
  // ...
});
```

- Commands **without** `contexts` are universal (always visible)
- Context commands (`afd-context-*`) are always visible regardless of active context
- When no context is active, all commands are visible
- Contexts use a stack — entering a new context pushes to stack, exiting pops

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3100 | Server port |
| `HOST` | localhost | Server host |
| `LOG_LEVEL` | info | Logging level |
| `CORS_ORIGIN` | * | Allowed origins |
