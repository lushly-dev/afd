# Handoff Schema

> Part 1 of [Handoff Pattern Spec](./00-overview.md)

## HandoffResult Type

The core type returned by commands that bootstrap streaming connections.

```typescript
// @afd/core - New export

/**
 * Result returned by commands that hand off to specialized protocols.
 * 
 * @example
 * const result = await client.call<HandoffResult>('chat.connect', { roomId });
 * if (result.success && result.data) {
 *   const ws = new WebSocket(result.data.endpoint);
 *   ws.send(JSON.stringify({ auth: result.data.credentials?.token }));
 * }
 */
export interface HandoffResult {
  /** Protocol type for client dispatch */
  protocol: HandoffProtocol;
  
  /** Full URL to connect to */
  endpoint: string;
  
  /** Authentication credentials for the handoff */
  credentials?: HandoffCredentials;
  
  /** Metadata for client decision-making */
  metadata?: HandoffMetadata;
}

export type HandoffProtocol = 
  | 'websocket'
  | 'webrtc'
  | 'sse'
  | 'http-stream'
  | string;  // Custom protocols allowed

export interface HandoffCredentials {
  /** Bearer token for authentication */
  token?: string;
  
  /** Additional headers to include */
  headers?: Record<string, string>;
  
  /** Session ID for correlation */
  sessionId?: string;
}

export interface HandoffMetadata {
  /** Expected latency in ms (hint for client) */
  expectedLatency?: number;
  
  /** Capabilities the channel supports */
  capabilities?: string[];
  
  /** When the handoff credentials expire (ISO 8601) */
  expiresAt?: string;
  
  /** Reconnection policy */
  reconnect?: {
    allowed: boolean;
    maxAttempts?: number;
    backoffMs?: number;
  };
  
  /** Human-readable description of the handoff */
  description?: string;
}
```

## Command Definition Pattern

Commands that return handoffs should be explicitly marked.

```typescript
import { defineCommand, HandoffResult } from '@afd/server';
import { z } from 'zod';

const chatConnect = defineCommand({
  name: 'chat-connect',
  category: 'chat',
  description: 'Connect to a chat room for real-time messaging',
  
  // NEW: Handoff marker
  handoff: true,
  
  // Tags for filtering
  tags: ['chat', 'handoff', 'handoff:websocket'],
  
  inputSchema: z.object({
    roomId: z.string().describe('Chat room ID'),
    nickname: z.string().optional().describe('Display name'),
  }),
  
  // Output is always HandoffResult for handoff commands
  outputSchema: HandoffResultSchema,
  
  async handler(input, ctx) {
    // Create session in your backend
    const session = await ctx.chatService.createSession({
      roomId: input.roomId,
      userId: ctx.userId,
    });
    
    return success<HandoffResult>({
      protocol: 'websocket',
      endpoint: `wss://chat.example.com/rooms/${input.roomId}`,
      credentials: {
        token: session.token,
        sessionId: session.id,
      },
      metadata: {
        expiresAt: session.expiresAt,
        capabilities: ['text', 'typing-indicator', 'presence'],
        reconnect: {
          allowed: true,
          maxAttempts: 5,
          backoffMs: 1000,
        },
        description: `Real-time chat in room "${input.roomId}"`,
      },
    });
  },
});
```

## Zod Schema for HandoffResult

```typescript
import { z } from 'zod';

export const HandoffCredentialsSchema = z.object({
  token: z.string().optional(),
  headers: z.record(z.string()).optional(),
  sessionId: z.string().optional(),
});

export const HandoffMetadataSchema = z.object({
  expectedLatency: z.number().optional(),
  capabilities: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().optional(),
  reconnect: z.object({
    allowed: z.boolean(),
    maxAttempts: z.number().optional(),
    backoffMs: z.number().optional(),
  }).optional(),
  description: z.string().optional(),
});

export const HandoffResultSchema = z.object({
  protocol: z.string(),
  endpoint: z.string().url(),
  credentials: HandoffCredentialsSchema.optional(),
  metadata: HandoffMetadataSchema.optional(),
});
```

## Capability Tags

Commands should include capability tags for agent filtering:

| Tag | Meaning |
|-----|---------|
| `handoff` | This command returns a handoff |
| `handoff:websocket` | Handoff uses WebSocket |
| `handoff:webrtc` | Handoff uses WebRTC |
| `handoff:sse` | Handoff uses Server-Sent Events |
| `handoff:resumable` | Session can be resumed after disconnect |

Agents can filter:
```typescript
// List only commands I can handle
const tools = await afdHelp({ 
  tags: ['handoff:websocket'],
  excludeTags: ['handoff:webrtc'],  // Can't do WebRTC
});
```

## Integration with CommandResult

`HandoffResult` is a data payload, not a replacement for `CommandResult`:

```typescript
// Handoff command returns CommandResult<HandoffResult>
type HandoffCommandResult = CommandResult<HandoffResult>;

// Success case
{
  success: true,
  data: {
    protocol: 'websocket',
    endpoint: 'wss://...',
    credentials: { token: '...' },
    metadata: { ... },
  },
  reasoning: 'Session created. Connect to the WebSocket URL to start chatting.',
}

// Error case (session creation failed)
{
  success: false,
  error: {
    code: 'ROOM_NOT_FOUND',
    message: 'Chat room does not exist',
    suggestion: 'Use chat-list to find available rooms',
  },
}
```
