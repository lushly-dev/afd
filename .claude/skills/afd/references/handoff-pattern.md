# Handoff pattern

For traffic a request-response command can't carry (live collaboration, 60 Hz input, unbounded
event streams, bidirectional chat), a command hands off: it authorises the session and returns
where to connect. The design record is `docs/features/complete/handoff-pattern/` (schema,
lifecycle, client integration, agent behaviour, security).

## The handoff command

```typescript
import { createHandoff, type HandoffResult } from '@lushly-dev/afd-core';

const chatConnect = defineCommand({
  name: 'chat-connect',
  description: 'Connect to a chat room for real-time messaging',
  handoff: true,               // adds the `handoff` tag
  handoffProtocol: 'websocket', // adds `handoff:websocket`; also webrtc, sse, http-stream or your own
  input: z.object({ roomId: z.string() }),
  async handler(input) {
    const session = await chat.createSession(input.roomId);
    return success<HandoffResult>(createHandoff({
      protocol: 'websocket',
      endpoint: `wss://chat.example.com/rooms/${input.roomId}`,
      credentials: { token: session.token, sessionId: session.id },
      metadata: { expiresAt: session.expiresAt, capabilities: ['text', 'presence'] },
    }));
  },
});
```

`HandoffResult` is `{ protocol, endpoint, credentials?: { token?, headers?, sessionId? },
metadata?: { expectedLatency?, capabilities?, expiresAt?, reconnect?, description? } }`.
`createHandoff` fills `metadata.reconnect` with `{ allowed: true, maxAttempts: 3, backoffMs: 1000 }`
when you leave it out. Core also has `isHandoff`, `isHandoffCommand` and `getHandoffProtocol`.

On the client, `@lushly-dev/afd-client` has `connectHandoff`, `createReconnectingHandoff` and a
protocol-handler registry (`registerProtocolHandler`).

## Lifecycle commands

Give each handoff domain `<domain>-connect` (or `-start`), `<domain>-status`,
`<domain>-disconnect` (or `-end`) and `<domain>-reconnect`. A session is `pending`, `active`,
`disconnected` (it can reconnect), `closed` or `expired`. Tag a command whose sessions survive a
disconnect `handoff:resumable` yourself; only `handoff` and `handoff:<protocol>` are added for you.

## Agent fallback

Most agents can't hold a WebSocket. Pair every handoff with a request-response command that reads
the same state: `chat-connect` with `chat-poll`, `events-subscribe` with `events-list`,
`canvas-start` with `canvas-snapshot`.
