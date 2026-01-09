# Handoff Pattern: Commands That Bootstrap Specialized Protocols

*Status: Concept — to be explored further*

---

## The Idea

A command that **bootstraps and hands off** to a specialized protocol, rather than owning the entire interaction. AFD's command layer handles orchestration; domain-specific protocols handle continuous/bidirectional/high-frequency operations.

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Client calls AFD command                                     │
│     → canvas.startSession { documentId: 'doc-123' }             │
│                                                                  │
│  2. Command returns handoff credentials                          │
│     ← { sessionId, websocketUrl, token, protocol: 'canvas-v1' } │
│                                                                  │
│  3. Client connects to specialized protocol                      │
│     → WebSocket at wss://rt.example.com/canvas/session-abc      │
│     → Speaks domain-specific protocol (60Hz input, CRDTs, etc.) │
│                                                                  │
│  4. Client calls AFD command to close                            │
│     → canvas.endSession { sessionId }                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Why It Works With AFD

| AFD Principle        | How Handoff Honors It                                              |
| -------------------- | ------------------------------------------------------------------ |
| Command-First        | Initiation is still a discoverable command.                        |
| CLI Validation       | Session creation testable via CLI. Handoff URL is verifiable.     |
| Transparency         | `reasoning` explains what happens next. `data` is structured.      |
| Dual Interface       | Agents get the same handoff data as UI. They can connect or not.  |

---

## Proposed Schema Extension

```typescript
// A typed handoff result for @afd/core
interface HandoffResult {
  protocol: string;              // 'websocket' | 'webrtc' | 'sse-v2' | custom
  endpoint: string;              // URL to connect to
  credentials?: {
    token?: string;
    headers?: Record<string, string>;
  };
  metadata?: {
    expectedLatency?: number;    // hint for the client
    capabilities?: string[];     // what the channel supports
    expiresAt?: string;          // handoff validity window
  };
}
```

---

## Use Cases

| Use Case                          | Command                     | Handoff Protocol          |
| --------------------------------- | --------------------------- | ------------------------- |
| Real-time collaboration           | `document.joinSession`      | WebSocket + CRDT ops      |
| 60Hz creative tool input          | `canvas.startSession`       | WebSocket + raw events    |
| Unbounded event streams (Kafka)   | `events.subscribe`          | SSE or WebSocket stream   |
| Video/audio conferencing          | `call.join`                 | WebRTC signaling          |

---

## Key Insight

AFD becomes the **orchestration layer**:
- Agents can discover and invoke lifecycle commands (`start`, `end`)
- CLI validation works for session management
- High-frequency / continuous / bidirectional traffic stays outside the command layer

**The command layer stays clean and discoverable.** The messy, domain-specific stuff lives in the handed-off protocol.

---

## Open Questions

1. **Should `HandoffResult` be a standard type in `@afd/core`?**
2. **How do agents decide whether to connect to a handoff?** (Capability detection?)
3. **Should there be a standard "heartbeat" or "status" command for active sessions?**
4. **How does this interact with MCP transport layers?**

---

*To be expanded with implementation details, examples, and integration with existing streaming infrastructure.*
