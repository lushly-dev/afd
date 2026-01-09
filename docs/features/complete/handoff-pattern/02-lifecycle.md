# Session Lifecycle

> Part 2 of [Handoff Pattern Spec](./00-overview.md)

## Lifecycle Commands

Every handoff domain should implement a standard set of lifecycle commands:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Session Lifecycle                                  │
│                                                                              │
│   ┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐           │
│   │  start  │ ───► │ [active]│ ───► │  end    │ ───► │ [closed]│           │
│   └─────────┘      └────┬────┘      └─────────┘      └─────────┘           │
│                         │                                                    │
│                         │ disconnect                                         │
│                         ▼                                                    │
│                    ┌─────────┐                                              │
│                    │reconnect│ ───► [active] or [error]                     │
│                    └─────────┘                                              │
│                                                                              │
│   status: query session state at any point                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Standard Commands

### `{domain}.start` / `{domain}.connect`

Initiates a session, returns `HandoffResult`.

```typescript
// Example: chat.connect
defineCommand({
  name: 'chat-connect',
  handoff: true,
  tags: ['chat', 'handoff', 'handoff:websocket'],
  inputSchema: z.object({
    roomId: z.string(),
    options: z.object({
      nickname: z.string().optional(),
      invisible: z.boolean().default(false),
    }).optional(),
  }),
  async handler(input, ctx) {
    const session = await ctx.chatService.createSession(input);
    return success<HandoffResult>({
      protocol: 'websocket',
      endpoint: session.wsUrl,
      credentials: { sessionId: session.id, token: session.token },
      metadata: { 
        expiresAt: session.expiresAt,
        reconnect: { allowed: true, maxAttempts: 5 },
      },
    });
  },
});
```

### `{domain}.status`

Query session state without affecting it.

```typescript
// Example: chat.status
defineCommand({
  name: 'chat-status',
  tags: ['chat', 'read'],
  inputSchema: z.object({
    sessionId: z.string(),
  }),
  async handler(input, ctx) {
    const session = await ctx.chatService.getSession(input.sessionId);
    if (!session) {
      return failure('SESSION_NOT_FOUND', 'Session does not exist');
    }
    
    return success<SessionStatus>({
      sessionId: session.id,
      state: session.state, // 'active' | 'disconnected' | 'closed'
      connectedAt: session.connectedAt,
      lastActivity: session.lastActivity,
      participants: session.participants,
      metrics: {
        messagesSent: session.messagesSent,
        messagesReceived: session.messagesReceived,
      },
    });
  },
});

interface SessionStatus {
  sessionId: string;
  state: 'active' | 'disconnected' | 'closed' | 'expired';
  connectedAt?: string;
  lastActivity?: string;
  participants?: Participant[];
  metrics?: Record<string, number>;
}
```

### `{domain}.end` / `{domain}.disconnect`

Gracefully close a session.

```typescript
// Example: chat.disconnect
defineCommand({
  name: 'chat-disconnect',
  tags: ['chat', 'write', 'safe'],
  inputSchema: z.object({
    sessionId: z.string(),
    reason: z.string().optional(),
  }),
  async handler(input, ctx) {
    const session = await ctx.chatService.endSession(input.sessionId, {
      reason: input.reason,
    });
    
    return success({
      sessionId: session.id,
      closedAt: session.closedAt,
      summary: {
        duration: session.duration,
        messagesSent: session.messagesSent,
      },
    }, {
      reasoning: 'Session closed. WebSocket connection should be terminated.',
    });
  },
});
```

### `{domain}.reconnect`

Resume a disconnected session (if allowed).

```typescript
// Example: chat.reconnect
defineCommand({
  name: 'chat-reconnect',
  handoff: true,
  tags: ['chat', 'handoff', 'handoff:websocket'],
  inputSchema: z.object({
    sessionId: z.string(),
    lastMessageId: z.string().optional(), // For catching up
  }),
  async handler(input, ctx) {
    const session = await ctx.chatService.getSession(input.sessionId);
    
    if (!session) {
      return failure('SESSION_NOT_FOUND', 'Session does not exist');
    }
    
    if (session.state === 'closed') {
      return failure('SESSION_CLOSED', 'Session was explicitly closed', {
        suggestion: 'Create a new session with chat-connect',
      });
    }
    
    if (session.reconnectAttempts >= session.maxReconnects) {
      return failure('MAX_RECONNECTS', 'Maximum reconnection attempts exceeded');
    }
    
    // Issue new token, same session
    const newToken = await ctx.chatService.issueReconnectToken(session.id);
    
    return success<HandoffResult>({
      protocol: 'websocket',
      endpoint: session.wsUrl,
      credentials: { 
        sessionId: session.id, 
        token: newToken,
      },
      metadata: {
        reconnect: {
          allowed: session.reconnectAttempts < session.maxReconnects - 1,
          maxAttempts: session.maxReconnects - session.reconnectAttempts - 1,
        },
        // Include missed messages
        catchUp: input.lastMessageId ? {
          fromMessageId: input.lastMessageId,
        } : undefined,
      },
    });
  },
});
```

## Session States

```typescript
type SessionState = 
  | 'pending'      // Session created, client not yet connected
  | 'active'       // Client connected, traffic flowing
  | 'disconnected' // Client lost, reconnect possible
  | 'closed'       // Explicitly ended, no reconnect
  | 'expired';     // Timed out, no reconnect
```

State transitions:

```
pending ──connect──► active
active ──disconnect──► disconnected
active ──end──► closed
active ──timeout──► expired
disconnected ──reconnect──► active
disconnected ──timeout──► expired
disconnected ──end──► closed
```

## Server-Side Session Management

Sessions must be tracked server-side:

```typescript
interface Session {
  id: string;
  userId: string;
  state: SessionState;
  
  // Handoff details
  protocol: HandoffProtocol;
  endpoint: string;
  
  // Lifecycle
  createdAt: Date;
  connectedAt?: Date;
  disconnectedAt?: Date;
  closedAt?: Date;
  expiresAt: Date;
  
  // Reconnection
  reconnectAttempts: number;
  maxReconnects: number;
  
  // Metrics
  lastActivity?: Date;
  messagesSent: number;
  messagesReceived: number;
}
```

## Timeout Policy

Sessions should have configurable timeouts:

| Timeout | Description | Default |
|---------|-------------|---------|
| `handoffExpiry` | How long handoff credentials are valid | 5 minutes |
| `idleTimeout` | Disconnect after inactivity | 30 minutes |
| `reconnectWindow` | How long to allow reconnect | 5 minutes |
| `maxSessionDuration` | Hard cap on session length | 24 hours |

```typescript
const session = await createSession({
  roomId: 'room-123',
  timeouts: {
    handoffExpiry: 5 * 60 * 1000,    // 5 min
    idleTimeout: 30 * 60 * 1000,     // 30 min
    reconnectWindow: 5 * 60 * 1000,  // 5 min
    maxDuration: 24 * 60 * 60 * 1000, // 24 hours
  },
});
```
