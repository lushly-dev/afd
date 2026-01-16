# Handoff Pattern

The handoff pattern extends AFD's command-first architecture to support real-time, streaming, and high-frequency use cases.

## When to Use Handoff

| Traffic Type | Example | Why Commands Don't Fit |
|--------------|---------|------------------------|
| Real-time collaboration | Google Docs, Figma | Continuous CRDT operations |
| High-frequency input | Drawing apps, games | 60Hz updates |
| Event streams | Live feeds, Kafka | Unbounded, long-running |
| Bidirectional comms | Video calls, chat | Simultaneous send/receive |

## Handoff Command Definition

Mark commands that return protocol handoffs with `handoff: true`:

```typescript
import { defineCommand, HandoffResult } from '@afd/server';

const chatConnect = defineCommand({
  name: 'chat-connect',
  category: 'chat',
  description: 'Connect to a chat room for real-time messaging',
  handoff: true,
  tags: ['chat', 'handoff', 'handoff:websocket'],

  inputSchema: z.object({
    roomId: z.string(),
  }),

  async handler(input, ctx) {
    const session = await ctx.chatService.createSession(input);

    return success<HandoffResult>({
      protocol: 'websocket',
      endpoint: `wss://chat.example.com/rooms/${input.roomId}`,
      credentials: {
        token: session.token,
        sessionId: session.id,
      },
      metadata: {
        expiresAt: session.expiresAt,
        capabilities: ['text', 'typing', 'presence'],
        reconnect: { allowed: true, maxAttempts: 5 },
      },
    });
  },
});
```

## Handoff Capability Tags

| Tag | Meaning |
|-----|---------|
| `handoff` | Command returns a protocol handoff |
| `handoff:websocket` | Uses WebSocket protocol |
| `handoff:webrtc` | Uses WebRTC protocol |
| `handoff:sse` | Uses Server-Sent Events |
| `handoff:resumable` | Session can resume after disconnect |

## Lifecycle Commands

Every handoff domain should implement:

| Command | Purpose |
|---------|---------|
| `{domain}.connect` / `{domain}.start` | Initiate session, return `HandoffResult` |
| `{domain}.status` | Query session state |
| `{domain}.disconnect` / `{domain}.end` | Gracefully close session |
| `{domain}.reconnect` | Resume disconnected session |

Session states: `pending` → `active` → `disconnected` → `closed` / `expired`

## Agent Fallback Pattern

Most AI agents (L1/L2) cannot consume real-time protocols. Provide polling fallbacks:

| Handoff Command | Fallback Command | Description |
|-----------------|------------------|-------------|
| `chat-connect` | `chat-poll` | Poll for messages periodically |
| `events-subscribe` | `events-list` | List recent events |
| `canvas-start` | `canvas-snapshot` | Get current state |

```typescript
// Fallback for agents without WebSocket capability
const chatPoll = defineCommand({
  name: 'chat-poll',
  description: 'Poll for messages (agent-friendly fallback)',
  tags: ['chat', 'read', 'agent-friendly'],

  async handler(input, ctx) {
    const messages = await ctx.chatService.getMessages({
      roomId: input.roomId,
      after: input.since,
    });

    return success({
      messages,
      hasMore: messages.length === input.limit,
    }, {
      _agentHints: {
        nextAction: 'Poll again with since=lastMessageId',
        pollInterval: 5000,
      },
    });
  },
});
```
