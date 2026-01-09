# Example: Real-Time Chat

> Part 6 of [Handoff Pattern Spec](./00-overview.md)

A complete example implementing the handoff pattern for a real-time chat feature.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Chat Architecture                               │
│                                                                              │
│   ┌─────────────────┐        ┌─────────────────┐        ┌───────────────┐  │
│   │    AFD Server   │        │  Chat Service   │        │  WebSocket    │  │
│   │  (Commands)     │ ──────►│  (Sessions)     │ ──────►│   Server      │  │
│   │                 │        │                 │        │               │  │
│   │ chat-connect    │        │ createSession() │        │ /ws/:roomId   │  │
│   │ chat-status     │        │ getSession()    │        │               │  │
│   │ chat-disconnect │        │ endSession()    │        │ broadcast()   │  │
│   │ chat-poll       │        │                 │        │               │  │
│   └─────────────────┘        └─────────────────┘        └───────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Command Definitions

### `chat-connect`

```typescript
// packages/examples/chat/src/commands/connect.ts
import { defineCommand, success, failure, HandoffResult } from '@afd/server';
import { z } from 'zod';

export const chatConnect = defineCommand({
  name: 'chat-connect',
  category: 'chat',
  description: 'Connect to a chat room for real-time messaging',
  
  handoff: true,
  tags: ['chat', 'handoff', 'handoff:websocket'],
  
  inputSchema: z.object({
    roomId: z.string().min(1).describe('Chat room ID'),
    nickname: z.string().min(1).max(50).optional().describe('Display name'),
  }),
  
  async handler(input, ctx) {
    // Check room exists
    const room = await ctx.chatService.getRoom(input.roomId);
    if (!room) {
      return failure('ROOM_NOT_FOUND', `Room "${input.roomId}" does not exist`, {
        suggestion: 'Use chat-rooms to list available rooms',
      });
    }
    
    // Check room capacity
    if (room.participants >= room.maxParticipants) {
      return failure('ROOM_FULL', 'Room is at capacity', {
        suggestion: 'Try again later or join a different room',
      });
    }
    
    // Create session
    const session = await ctx.chatService.createSession({
      roomId: input.roomId,
      userId: ctx.userId,
      nickname: input.nickname ?? ctx.userName ?? 'Anonymous',
    });
    
    return success<HandoffResult>({
      protocol: 'websocket',
      endpoint: `${ctx.config.wsBaseUrl}/rooms/${input.roomId}`,
      credentials: {
        token: session.token,
        sessionId: session.id,
      },
      metadata: {
        expiresAt: session.expiresAt.toISOString(),
        capabilities: ['text', 'typing', 'presence', 'reactions'],
        reconnect: {
          allowed: true,
          maxAttempts: 5,
          backoffMs: 1000,
        },
        description: `Real-time chat in "${room.name}"`,
      },
    }, {
      reasoning: `Session created for room "${room.name}". Connect to the WebSocket URL within 5 minutes.`,
      _agentHints: {
        handoffType: 'websocket',
        consumable: false,
        delegateToUser: true,
        fallbackCommand: 'chat-poll',
      },
    });
  },
});
```

### `chat-status`

```typescript
// packages/examples/chat/src/commands/status.ts
export const chatStatus = defineCommand({
  name: 'chat-status',
  category: 'chat',
  description: 'Get status of a chat session',
  tags: ['chat', 'read'],
  
  inputSchema: z.object({
    sessionId: z.string(),
  }),
  
  async handler(input, ctx) {
    const session = await ctx.chatService.getSession(input.sessionId);
    
    if (!session) {
      return failure('SESSION_NOT_FOUND', 'Session does not exist');
    }
    
    // Check ownership
    if (session.userId !== ctx.userId) {
      return failure('FORBIDDEN', 'Not your session');
    }
    
    return success({
      sessionId: session.id,
      roomId: session.roomId,
      state: session.state,
      nickname: session.nickname,
      connectedAt: session.connectedAt?.toISOString(),
      lastActivity: session.lastActivity?.toISOString(),
      metrics: {
        messagesSent: session.messagesSent,
        messagesReceived: session.messagesReceived,
      },
    });
  },
});
```

### `chat-disconnect`

```typescript
// packages/examples/chat/src/commands/disconnect.ts
export const chatDisconnect = defineCommand({
  name: 'chat-disconnect',
  category: 'chat',
  description: 'End a chat session',
  tags: ['chat', 'write', 'safe'],
  
  inputSchema: z.object({
    sessionId: z.string(),
    reason: z.string().optional(),
  }),
  
  async handler(input, ctx) {
    const session = await ctx.chatService.getSession(input.sessionId);
    
    if (!session) {
      return failure('SESSION_NOT_FOUND', 'Session does not exist');
    }
    
    if (session.userId !== ctx.userId) {
      return failure('FORBIDDEN', 'Not your session');
    }
    
    const closedSession = await ctx.chatService.endSession(session.id, {
      reason: input.reason,
    });
    
    return success({
      sessionId: closedSession.id,
      closedAt: closedSession.closedAt.toISOString(),
      duration: closedSession.duration,
      messagesSent: closedSession.messagesSent,
    }, {
      reasoning: 'Session closed. Any active WebSocket connection will be terminated.',
    });
  },
});
```

### `chat-poll` (Agent Fallback)

```typescript
// packages/examples/chat/src/commands/poll.ts
export const chatPoll = defineCommand({
  name: 'chat-poll',
  category: 'chat',
  description: 'Poll for new messages (fallback for agents without WebSocket)',
  tags: ['chat', 'read', 'agent-friendly'],
  
  inputSchema: z.object({
    roomId: z.string(),
    since: z.string().optional().describe('Last message ID seen'),
    limit: z.number().min(1).max(100).default(50),
  }),
  
  async handler(input, ctx) {
    const room = await ctx.chatService.getRoom(input.roomId);
    if (!room) {
      return failure('ROOM_NOT_FOUND', 'Room does not exist');
    }
    
    const messages = await ctx.chatService.getMessages({
      roomId: input.roomId,
      after: input.since,
      limit: input.limit,
    });
    
    return success({
      roomId: input.roomId,
      messages: messages.map(m => ({
        id: m.id,
        sender: m.nickname,
        text: m.text,
        timestamp: m.createdAt.toISOString(),
      })),
      hasMore: messages.length === input.limit,
      lastMessageId: messages[messages.length - 1]?.id,
    }, {
      _agentHints: {
        nextAction: messages.length > 0
          ? `Process ${messages.length} messages. Poll again with since="${messages[messages.length - 1].id}"`
          : 'No new messages. Wait 3-5 seconds and poll again.',
        pollInterval: 5000,
      },
    });
  },
});
```

## WebSocket Server

```typescript
// packages/examples/chat/src/ws-server.ts
import { WebSocketServer } from 'ws';
import { validateHandoffToken } from './auth';
import { chatService } from './services/chat';

const wss = new WebSocketServer({ port: 3001 });

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url!, `ws://${req.headers.host}`);
  const roomId = url.pathname.split('/').pop()!;
  const token = url.searchParams.get('token');
  
  if (!token) {
    ws.close(4001, 'Missing token');
    return;
  }
  
  // Validate token
  const claims = await validateHandoffToken(token, roomId);
  if (!claims) {
    ws.close(4001, 'Invalid token');
    return;
  }
  
  // Get session
  const session = await chatService.getSession(claims.sid);
  if (!session || session.roomId !== roomId) {
    ws.close(4003, 'Session mismatch');
    return;
  }
  
  // Mark as connected
  await chatService.markConnected(session.id);
  
  // Add to room
  const room = chatService.joinRoom(roomId, {
    ws,
    sessionId: session.id,
    userId: claims.sub,
    nickname: session.nickname,
  });
  
  // Broadcast join
  room.broadcast({
    type: 'user_joined',
    nickname: session.nickname,
    timestamp: Date.now(),
  }, ws);
  
  // Handle messages
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      switch (msg.type) {
        case 'message':
          const saved = await chatService.saveMessage({
            roomId,
            sessionId: session.id,
            nickname: session.nickname,
            text: msg.text,
          });
          
          room.broadcast({
            type: 'message',
            id: saved.id,
            sender: session.nickname,
            text: msg.text,
            timestamp: saved.createdAt.getTime(),
          });
          break;
          
        case 'typing':
          room.broadcast({
            type: 'typing',
            nickname: session.nickname,
          }, ws);
          break;
          
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
      }
    } catch (err) {
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Invalid message format',
      }));
    }
  });
  
  // Handle disconnect
  ws.on('close', async () => {
    await chatService.markDisconnected(session.id);
    
    room.broadcast({
      type: 'user_left',
      nickname: session.nickname,
      timestamp: Date.now(),
    });
    
    room.removeClient(ws);
  });
});
```

## Client Usage

### Browser

```typescript
// Frontend: React component
function ChatRoom({ roomId }: { roomId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  
  useEffect(() => {
    async function connect() {
      // Call handoff command
      const result = await client.call<HandoffResult>('chat-connect', { 
        roomId,
        nickname: 'User123',
      });
      
      if (!result.success) {
        console.error('Failed to connect:', result.error);
        return;
      }
      
      // Connect to WebSocket
      const ws = new WebSocket(
        `${result.data.endpoint}?token=${result.data.credentials!.token}`
      );
      
      ws.onopen = () => setConnected(true);
      
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'message') {
          setMessages(prev => [...prev, msg]);
        }
      };
      
      ws.onclose = () => setConnected(false);
      
      wsRef.current = ws;
    }
    
    connect();
    
    return () => wsRef.current?.close();
  }, [roomId]);
  
  const sendMessage = (text: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'message', text }));
  };
  
  return (
    <div>
      <div>{connected ? '🟢 Connected' : '🔴 Disconnected'}</div>
      <MessageList messages={messages} />
      <MessageInput onSend={sendMessage} />
    </div>
  );
}
```

### Agent (Polling Fallback)

```typescript
// Agent using polling
async function agentChatLoop(roomId: string) {
  let lastMessageId: string | undefined;
  
  while (true) {
    const result = await client.call('chat-poll', {
      roomId,
      since: lastMessageId,
      limit: 50,
    });
    
    if (!result.success) {
      console.error('Poll failed:', result.error);
      break;
    }
    
    for (const msg of result.data.messages) {
      console.log(`[${msg.sender}]: ${msg.text}`);
      
      // Respond to questions
      if (msg.text.includes('?')) {
        const reply = await generateResponse(msg.text);
        await client.call('chat-send', { roomId, text: reply });
      }
    }
    
    lastMessageId = result.data.lastMessageId;
    
    // Wait before next poll
    await sleep(result.data._agentHints?.pollInterval ?? 5000);
  }
}
```

## Testing via CLI

```bash
# List rooms
afd call chat-rooms

# Connect (returns handoff)
afd call chat-connect '{"roomId": "general", "nickname": "CLI-User"}'
# Returns: { protocol: "websocket", endpoint: "wss://...", credentials: {...} }

# Status
afd call chat-status '{"sessionId": "sess-123"}'

# Poll (for agents)
afd call chat-poll '{"roomId": "general"}'

# Disconnect
afd call chat-disconnect '{"sessionId": "sess-123"}'
```

## File Structure

```
packages/examples/chat/
├── src/
│   ├── commands/
│   │   ├── connect.ts
│   │   ├── disconnect.ts
│   │   ├── status.ts
│   │   ├── poll.ts
│   │   └── index.ts
│   ├── services/
│   │   └── chat.ts
│   ├── ws-server.ts
│   ├── server.ts
│   └── index.ts
├── frontend/
│   └── src/
│       ├── App.tsx
│       └── ChatRoom.tsx
├── package.json
└── README.md
```
