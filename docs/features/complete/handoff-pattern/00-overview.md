# Handoff Pattern: Commands That Bootstrap Specialized Protocols

> **Status**: Active Spec  
> **GitHub Issue**: [#18](https://github.com/lushly-dev/afd/issues/18)

## Vision

Extend AFD's command-first architecture to support real-time, streaming, and high-frequency use cases without compromising the core principles of discoverability, CLI validation, and dual-interface support.

**The Pattern**: Commands bootstrap and orchestrate continuous connections, but don't own the traffic. AFD handles lifecycle; domain-specific protocols handle the stream.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AFD Command Layer                               │
│                                                                              │
│   client.call('session.start')  ───────────►  HandoffResult                 │
│                                                   │                          │
│                                                   ▼                          │
│                                        ┌─────────────────────┐               │
│                                        │  Specialized Protocol│              │
│                                        │  (WebSocket, WebRTC) │              │
│                                        │  High-frequency      │              │
│                                        │  Bidirectional       │              │
│                                        │  Domain-specific     │              │
│                                        └─────────────────────┘               │
│                                                   │                          │
│   client.call('session.end')  ◄─────────────────┘                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Why Handoff?

AFD commands are **request-response**. But real applications need:

| Traffic Type | Example | Why Commands Don't Fit |
|--------------|---------|------------------------|
| Real-time collaboration | Google Docs, Figma | Continuous CRDT operations |
| High-frequency input | Drawing apps, games | 60Hz updates, batched strokes |
| Event streams | Live feeds, Kafka consumers | Unbounded, long-running |
| Bidirectional comms | Video calls, chat | Simultaneous send/receive |

**The handoff pattern** lets AFD orchestrate these without trying to be a streaming layer.

## Core Principles

1. **Command-First Initiation** - Sessions start via discoverable commands
2. **CLI Testable** - Session lifecycle testable without UI
3. **Agent-Compatible** - Agents see the same handoff data as humans
4. **Clean Separation** - Commands handle lifecycle; protocols handle traffic
5. **Graceful Degradation** - Agents can ignore handoffs they can't consume

## Spec Documents

| Document | Description |
|----------|-------------|
| [01-schema.md](./01-schema.md) | `HandoffResult` type, command definition patterns |
| [02-lifecycle.md](./02-lifecycle.md) | Session lifecycle: start, status, end, reconnect |
| [03-client-integration.md](./03-client-integration.md) | How `@afd/client` surfaces handoffs |
| [04-agent-behavior.md](./04-agent-behavior.md) | AI agent interaction patterns |
| [05-security.md](./05-security.md) | Token rotation, expiry, CORS |
| [06-example.md](./06-example.md) | Complete streaming example |

## Success Criteria

- [ ] `HandoffResult` is a standard type in `@afd/core`
- [ ] Commands can declare `handoff: true` in their definition
- [ ] CLI can test session creation: `afd call session.start`
- [ ] `@afd/client` provides typed handoff handling
- [ ] Agent capability tags filter handoff commands
- [ ] Example app demonstrates real-time chat via handoff

## Use Cases

| Use Case | Command | Handoff Protocol |
|----------|---------|------------------|
| Real-time document collab | `document.joinSession` | WebSocket + CRDT ops |
| 60Hz creative tool input | `canvas.startSession` | WebSocket + raw events |
| Unbounded event streams | `events.subscribe` | SSE or WebSocket stream |
| Video/audio conferencing | `call.join` | WebRTC signaling |
| Chat/messaging | `chat.connect` | WebSocket + messages |

## Non-Goals

- AFD will **not** implement streaming transports (use existing libraries)
- AFD will **not** define domain-specific protocols (CRDT ops, video codecs, etc.)
- AFD will **not** replace MCP for agent communication

## Related

- DirectClient - See `afd-directclient` skill for in-process command execution
- [Mint Collaboration](./rust-distribution/05-collaboration-sync.md) - Real-time sync layer (builds on handoff)
