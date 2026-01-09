# @afd/server

Server-side utilities for building AFD-compliant MCP servers with Zod validation.

## Installation

```bash
npm install @afd/server
# or
pnpm add @afd/server
```

## Features

- **Zod-based Command Definition** - Define commands with Zod schemas for type-safe validation
- **Auto JSON Schema Generation** - Automatic conversion to JSON Schema for MCP tool definitions
- **Multiple Transport Support** - stdio for IDE/agent integration, HTTP/SSE for browser clients
- **Auto Transport Detection** - Automatically selects the right transport based on environment
- **Built-in Validation** - Automatic input validation before handler execution
- **Middleware System** - Logging, tracing, rate limiting, and custom middleware
- **Full TypeScript Support** - Complete type inference from Zod schemas

## Quick Start

```typescript
import { z } from 'zod';
import { defineCommand, createMcpServer, success, failure } from '@afd/server';

// Define a command with Zod schema
const greet = defineCommand({
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
  port: 3100,
});

await server.start();
console.log(`Server running at ${server.getUrl()}`);
```

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
console.log(`Server running at ${server.getUrl()}`);
// Exposes /sse, /message, /health endpoints
```

## Defining Commands

### Basic Command

```typescript
import { z } from 'zod';
import { defineCommand, success, failure } from '@afd/server';

const createUser = defineCommand({
  name: 'user.create',
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
  name: 'user.get',
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
        suggestion: 'Check the ID or use user.list to find available users',
      });
    }
    
    return success(user);
  },
});
```

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
  cors: true,              // Enable CORS (default: true)
  
  // Middleware
  middleware: [
    createLoggingMiddleware(),
    createTimingMiddleware({ slowThreshold: 1000 }),
  ],
  
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

### Logging

```typescript
import { createLoggingMiddleware } from '@afd/server';

const middleware = createLoggingMiddleware({
  log: console.log,        // Custom log function
  logInput: false,         // Don't log input (may contain sensitive data)
  logResult: false,        // Don't log full results
});
```

### Timing

```typescript
import { createTimingMiddleware } from '@afd/server';

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
import { createTracingMiddleware } from '@afd/server';

const tracer = trace.getTracer('my-app');

const middleware = createTracingMiddleware({
  tracer,
  spanPrefix: 'command',   // Span names: command.user.create, etc.
});
```

### Rate Limiting

```typescript
import { createRateLimitMiddleware } from '@afd/server';

const middleware = createRateLimitMiddleware({
  maxRequests: 100,
  windowMs: 60000,         // 100 requests per minute
  keyFn: (context) => context.userId ?? 'anonymous',
});
```

### Custom Middleware

```typescript
import type { CommandMiddleware } from '@afd/server';

const myMiddleware: CommandMiddleware = async (commandName, input, context, next) => {
  console.log(`Before: ${commandName}`);
  const result = await next();
  console.log(`After: ${commandName}, success: ${result.success}`);
  return result;
};
```

## Validation Utilities

```typescript
import { validateInput, validateOrThrow, isValid, patterns } from '@afd/server';

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
| `name` | string | Yes | Unique command name (e.g., `user.create`) |
| `description` | string | Yes | Human-readable description |
| `input` | ZodType | Yes | Zod schema for input validation |
| `handler` | function | Yes | Command implementation |
| `category` | string | No | Category for grouping |
| `mutation` | boolean | No | Whether command has side effects |
| `version` | string | No | Command version |
| `tags` | string[] | No | Additional tags |
| `errors` | string[] | No | Possible error codes |

### createMcpServer(options)

Create an MCP server from commands.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | string | Yes | Server name |
| `version` | string | Yes | Server version |
| `commands` | array | Yes | Command definitions |
| `transport` | `'stdio' \| 'http' \| 'auto'` | No | Transport protocol (default: `'auto'`) |
| `port` | number | No | Port for HTTP transport (default: 3100) |
| `host` | string | No | Host for HTTP transport (default: localhost) |
| `devMode` | boolean | No | Enable development mode (default: false) |
| `cors` | boolean | No | Enable CORS for HTTP transport (default: follows devMode) |
| `middleware` | array | No | Middleware functions |
| `onCommand` | function | No | Command execution callback |
| `onError` | function | No | Error callback |

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

The server exposes these endpoints when using HTTP transport:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/sse` | GET | SSE connection for MCP clients |
| `/message` | POST | MCP JSON-RPC message endpoint (for MCP protocol) |
| `/rpc` | POST | Simple JSON-RPC endpoint (for browser clients) |
| `/batch` | POST | Batch command execution |
| `/stream/{command}` | GET | SSE streaming for command results |
| `/health` | GET | Health check |

### Browser-Friendly `/rpc` Endpoint

The `/rpc` endpoint provides a simple JSON-RPC interface for browser clients. Unlike `/message` which uses the full MCP protocol, `/rpc` calls commands directly by name:

**Request format:**
```json
{
  "method": "command-name",
  "params": { "key": "value" },
  "id": 1
}
```

**Response format:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "success": true,
    "data": { ... },
    "reasoning": "...",
    "confidence": 1.0
  }
}
```

### Browser Example (Vanilla JavaScript)

```html
<!DOCTYPE html>
<html>
<head>
  <title>AFD Browser Example</title>
</head>
<body>
  <input type="text" id="name" placeholder="Enter name" />
  <button onclick="greet()">Greet</button>
  <div id="result"></div>

  <script>
    async function greet() {
      const name = document.getElementById('name').value;

      const response = await fetch('http://localhost:3100/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'greet',
          params: { name },
          id: 1
        })
      });

      const data = await response.json();

      if (data.result?.success) {
        document.getElementById('result').textContent = data.result.data.greeting;
      } else {
        document.getElementById('result').textContent =
          'Error: ' + (data.error?.message || data.result?.error?.message);
      }
    }
  </script>
</body>
</html>
```

### CORS Configuration

CORS is automatically enabled in development mode (`devMode: true`). For production, explicitly enable CORS:

```typescript
const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  commands: [greet],
  cors: true,        // Enable CORS for browser access
  devMode: false,    // Production mode (CORS origin is restricted)
});
```

In development mode, CORS allows all origins (`*`). In production with `cors: true`, it allows requests from the same origin or the `Origin` header value.

## Related

- [@afd/core](../core) - Core types and helpers
- [@afd/client](../client) - MCP client library
- [@afd/cli](../cli) - Command-line interface
- [Example: Todo App](../examples/todo-app) - Complete working example
