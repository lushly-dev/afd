# @afd/client

MCP client library for Agent-First Development.

## Installation

```bash
npm install @afd/client
# or
pnpm add @afd/client
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
import { createClient } from '@afd/client';

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
import { createClient, type CommandResult } from '@afd/client';
import { isSuccess, isFailure } from '@afd/core';

const client = createClient({ url: 'http://localhost:3100/sse' });
await client.connect();

// Call a command - returns CommandResult
const result = await client.call<Document>('document.create', {
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
const rawResult = await client.callTool('document.create', {
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
  clientName?: string;            // Default: '@afd/client'
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

For co-located agents (same runtime as the application), use `DirectClient` to bypass all transport overhead:

```typescript
import { DirectClient } from '@afd/client';
import { registry } from '@my-app/commands';

// Direct execution - ~0.01ms latency vs 10-100ms for MCP
const client = new DirectClient(registry);

const result = await client.call<Todo>('todo-create', { title: 'Fast!' });
if (result.success) {
  console.log('Created:', result.data.id);
}
```

**Performance comparison:**

| Transport | Avg Latency | Use Case |
|-----------|-------------|----------|
| Direct | ~0.01ms | Same runtime, max performance |
| SSE | ~20-50ms | Real-time streaming |
| HTTP | ~20-100ms | Request/response, serverless |

Your registry must implement the `DirectRegistry` interface:

```typescript
import { DirectRegistry } from '@afd/client';
import type { CommandResult } from '@afd/core';

class MyRegistry implements DirectRegistry {
  async execute<T>(name: string, input?: unknown): Promise<CommandResult<T>>;
  listCommandNames(): string[];
  listCommands(): Array<{ name: string; description: string }>;
  hasCommand(name: string): boolean;
}
```

## Error Handling

The client wraps all errors in the standard `CommandResult` format:

```typescript
const result = await client.call('document.get', { id: 'not-found' });

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
