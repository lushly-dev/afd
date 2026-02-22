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

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3100 | Server port |
| `HOST` | localhost | Server host |
| `LOG_LEVEL` | info | Logging level |
| `CORS_ORIGIN` | * | Allowed origins |
