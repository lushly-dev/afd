# Client Integration

> Part 3 of [Handoff Pattern Spec](./00-overview.md)

## `@afd/client` Handoff Support

The client package provides utilities for handling handoff results.

### Type-Safe Handoff Calls

```typescript
import { DirectClient, HandoffResult, isHandoff } from '@afd/client';

const client = new DirectClient(registry);

// Option 1: Know it's a handoff command
const result = await client.call<HandoffResult>('chat-connect', { roomId: 'room-123' });

if (result.success && result.data) {
  const handoff = result.data;
  // handoff is typed as HandoffResult
}

// Option 2: Check at runtime
const result = await client.call('some-command', { ... });

if (result.success && isHandoff(result.data)) {
  // TypeScript narrows to HandoffResult
  connectToProtocol(result.data);
}
```

### Handoff Type Guard

```typescript
// @afd/client export
export function isHandoff(data: unknown): data is HandoffResult {
  return (
    typeof data === 'object' &&
    data !== null &&
    'protocol' in data &&
    'endpoint' in data &&
    typeof (data as HandoffResult).protocol === 'string' &&
    typeof (data as HandoffResult).endpoint === 'string'
  );
}
```

### Protocol Handlers

Clients can register protocol handlers for automatic connection:

```typescript
import { DirectClient, registerProtocolHandler } from '@afd/client';

// Register WebSocket handler
registerProtocolHandler('websocket', async (handoff, options) => {
  const ws = new WebSocket(handoff.endpoint);
  
  ws.onopen = () => {
    // Authenticate if credentials provided
    if (handoff.credentials?.token) {
      ws.send(JSON.stringify({ 
        type: 'auth', 
        token: handoff.credentials.token,
      }));
    }
    options.onConnect?.(ws);
  };
  
  ws.onmessage = (event) => {
    options.onMessage?.(JSON.parse(event.data));
  };
  
  ws.onclose = (event) => {
    options.onDisconnect?.(event.code, event.reason);
  };
  
  return {
    send: (data: unknown) => ws.send(JSON.stringify(data)),
    close: () => ws.close(),
  };
});

// Use it
const result = await client.call<HandoffResult>('chat-connect', { roomId: 'room-123' });

if (result.success && result.data) {
  const connection = await client.connectHandoff(result.data, {
    onConnect: (ws) => console.log('Connected!'),
    onMessage: (msg) => console.log('Message:', msg),
    onDisconnect: (code, reason) => console.log('Disconnected:', code),
  });
  
  // Send message
  connection.send({ type: 'message', text: 'Hello!' });
  
  // Later: close
  connection.close();
}
```

### Reconnection Helper

```typescript
import { DirectClient, createReconnectingHandoff } from '@afd/client';

const result = await client.call<HandoffResult>('chat-connect', { roomId: 'room-123' });

if (result.success && result.data) {
  const connection = await createReconnectingHandoff(client, result.data, {
    // Reconnect command to call on disconnect
    reconnectCommand: 'chat-reconnect',
    
    // Session ID to pass to reconnect
    sessionId: result.data.credentials?.sessionId,
    
    // Callbacks
    onConnect: () => console.log('Connected'),
    onReconnect: (attempt) => console.log(`Reconnecting (attempt ${attempt})`),
    onReconnectFailed: () => console.log('Reconnection failed'),
    onMessage: (msg) => handleMessage(msg),
    onDisconnect: () => console.log('Disconnected'),
  });
}
```

### Handoff Discovery

List available handoff commands:

```typescript
const handoffCommands = await client.call('afd-help', {
  tags: ['handoff'],
});

// Result:
// [
//   { name: 'chat-connect', tags: ['chat', 'handoff', 'handoff:websocket'] },
//   { name: 'canvas-start', tags: ['canvas', 'handoff', 'handoff:websocket'] },
//   { name: 'call-join', tags: ['call', 'handoff', 'handoff:webrtc'] },
// ]

// Filter by protocol capability
const wsHandoffs = await client.call('afd-help', {
  tags: ['handoff:websocket'],
});
```

## Browser Integration

For web clients, additional considerations:

### CORS Headers

Handoff endpoints must allow the client origin:

```typescript
// Server-side WebSocket upgrade
app.ws('/rooms/:roomId', (ws, req) => {
  // CORS is handled during HTTP upgrade
  // Token validation
  const token = req.query.token;
  if (!validateToken(token)) {
    ws.close(4001, 'Invalid token');
    return;
  }
  // ...
});
```

### Connection State UI

```typescript
import { HandoffConnectionState } from '@afd/client';

type ConnectionState = 
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed';

// React hook example
function useChatConnection(roomId: string) {
  const [state, setState] = useState<ConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    let connection: HandoffConnection | null = null;
    
    async function connect() {
      setState('connecting');
      
      const result = await client.call<HandoffResult>('chat-connect', { roomId });
      
      if (!result.success) {
        setState('failed');
        setError(result.error?.message ?? 'Connection failed');
        return;
      }
      
      connection = await client.connectHandoff(result.data, {
        onConnect: () => setState('connected'),
        onReconnect: () => setState('reconnecting'),
        onDisconnect: () => setState('disconnected'),
      });
    }
    
    connect();
    
    return () => connection?.close();
  }, [roomId]);
  
  return { state, error };
}
```

## Node.js Integration

For server-side clients (e.g., agents):

```typescript
import WebSocket from 'ws';
import { registerProtocolHandler } from '@afd/client';

// Node.js WebSocket handler
registerProtocolHandler('websocket', async (handoff, options) => {
  const ws = new WebSocket(handoff.endpoint, {
    headers: handoff.credentials?.headers,
  });
  
  ws.on('open', () => {
    if (handoff.credentials?.token) {
      ws.send(JSON.stringify({ type: 'auth', token: handoff.credentials.token }));
    }
    options.onConnect?.(ws);
  });
  
  ws.on('message', (data) => {
    options.onMessage?.(JSON.parse(data.toString()));
  });
  
  ws.on('close', (code, reason) => {
    options.onDisconnect?.(code, reason.toString());
  });
  
  return {
    send: (data: unknown) => ws.send(JSON.stringify(data)),
    close: () => ws.close(),
  };
});
```
