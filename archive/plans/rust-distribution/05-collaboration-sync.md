# Part 6: Collaboration & Sync

> **Goal**: Enable real-time human-AI collaboration where agents participate as first-class collaborators using the same command API as humans, with app-configurable sync strategies.

## The Vision

```
┌─────────────────────────────────────────────────────────────────┐
│                    Shared Workspace                             │
│                                                                  │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐            │
│  │  Alice  │  │   Bob   │  │ Claude  │  │  GPT-4  │            │
│  │ (human) │  │ (human) │  │ (agent) │  │ (agent) │            │
│  │  cursor │  │  cursor │  │  cursor │  │  cursor │            │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘            │
│                                                                  │
│  All collaborators:                                             │
│  - Use the SAME command API                                     │
│  - Appear with presence indicators                              │
│  - Receive conflict notifications                               │
│  - Can work simultaneously                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Core Principle**: Agents are collaborators, not tools. They use the exact same commands as humans—no duplicate API bolted on top.

---

## Research Grounding (2024-2025)

This architecture is grounded in current state-of-the-art patterns:

| Trend | Source | Our Approach |
|-------|--------|--------------|
| **CRDTs over OT** | Industry consensus | Automerge for `realtime` mode |
| **Local-first** | Replicache, Zero | Local SQLite as source of truth |
| **AI as collaborator** | Cursor, Canvas, Figma | Agents have presence, same API |
| **Command-based sync** | Replicache mutators | AFD commands = sync operations |
| **Separate presence** | Best practice | Ephemeral layer, not in history |

---

## The Problem

Traditional approaches treat AI as a separate system:

```
Human → UI → Commands → Database
Agent → Agent API → Commands → Database  ← Duplicate path!
```

This creates:
- Inconsistent behavior between human and agent actions
- No awareness of what agents are doing
- Conflicts when both edit simultaneously
- Agents can't see or respond to human edits

**The AFD Solution**: One command layer, multiple collaborators.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                 Presence Layer (Ephemeral)                      │
│                                                                  │
│  - Who's in the session (humans + agents)                       │
│  - Cursor/selection positions                                   │
│  - "Typing" / "Thinking" indicators                             │
│  - Does NOT persist to history                                  │
│                                                                  │
│  Transport: WebSocket / WebRTC (low latency)                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────────┐
│                 Command Layer (AFD Core)                        │
│                                                                  │
│  CommandEnvelope {                                               │
│    id: "cmd_abc123",                                            │
│    command: "item.update",                                      │
│    input: { id: "123", color: "#FF0000" },                      │
│    actor: { id: "claude-1", type: "agent", name: "Claude" },    │
│    timestamp: "2025-01-01T12:00:00Z",                           │
│    vector_clock: { "alice": 5, "claude-1": 3 },                 │
│  }                                                               │
│                                                                  │
│  Same envelope whether actor is human or agent.                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────────┐
│                 Sync Layer (App-Configurable)                   │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  sync: none  │  │ sync: queue  │  │sync: realtime│          │
│  │              │  │              │  │              │          │
│  │ Server-only  │  │ Offline +    │  │ CRDT-based   │          │
│  │ Always online│  │ Rebase sync  │  │ Collaboration│          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────────┐
│                 Storage Layer (Local-First)                     │
│                                                                  │
│  SQLite-WASM (local)  ←→  Postgres/D1 (cloud)                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Presence (Awareness)

The presence layer provides real-time awareness of all collaborators without persisting to history.

### Presence Trait

```rust
// src/services/presence.rs

/// Actor in a collaboration session (human or agent)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Actor {
    pub id: String,
    pub name: String,
    pub actor_type: ActorType,
    pub color: String,  // For cursor/avatar visualization
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ActorType {
    Human,
    Agent { 
        model: String,      // e.g., "claude-3-5-sonnet"
        provider: String,   // e.g., "anthropic"
    },
}

/// Collaborator with current state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collaborator {
    pub actor: Actor,
    pub cursor: Option<CursorPosition>,
    pub selection: Option<Selection>,
    pub status: CollaboratorStatus,
    pub last_seen: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CollaboratorStatus {
    Active,
    Idle,
    Typing,
    Thinking,  // Agent is processing
}

#[async_trait]
pub trait Presence: Send + Sync {
    /// Join a collaboration session
    async fn join(&self, session_id: &str, actor: Actor) -> Result<Vec<Collaborator>, PresenceError>;
    
    /// Leave a session
    async fn leave(&self, session_id: &str, actor_id: &str) -> Result<(), PresenceError>;
    
    /// Get all current collaborators
    async fn list(&self, session_id: &str) -> Result<Vec<Collaborator>, PresenceError>;
    
    /// Update cursor position
    async fn update_cursor(&self, session_id: &str, actor_id: &str, position: CursorPosition) -> Result<(), PresenceError>;
    
    /// Update status (typing, thinking, idle)
    async fn update_status(&self, session_id: &str, actor_id: &str, status: CollaboratorStatus) -> Result<(), PresenceError>;
    
    /// Subscribe to presence changes (real-time stream)
    fn subscribe(&self, session_id: &str) -> Pin<Box<dyn Stream<Item = PresenceEvent> + Send>>;
}
```

### Presence Adapters

| Adapter | Use Case | Latency |
|---------|----------|---------|
| `MemoryPresence` | Local dev, single instance | ~0ms |
| `WebSocketPresence` | Standard web apps | ~50ms |
| `WebRTCPresence` | P2P, lowest latency | ~20ms |
| `LiveblocksPresence` | Managed service | ~30ms |

---

## Layer 2: Command Envelopes

Commands are wrapped in envelopes that track the actor and enable causal ordering.

```rust
// src/sync/envelope.rs

/// Command wrapped with collaboration metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandEnvelope {
    /// Unique command ID (for deduplication)
    pub id: String,
    
    /// The AFD command name
    pub command: String,
    
    /// Command input (JSON)
    pub input: Value,
    
    /// Who issued this command
    pub actor: Actor,
    
    /// When the command was created (client time)
    pub timestamp: DateTime<Utc>,
    
    /// Vector clock for causal ordering
    pub vector_clock: VectorClock,
    
    /// Session this command belongs to
    pub session_id: Option<String>,
}

/// Vector clock for causal ordering
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VectorClock(pub HashMap<String, u64>);

impl VectorClock {
    pub fn increment(&mut self, actor_id: &str) {
        *self.0.entry(actor_id.to_string()).or_insert(0) += 1;
    }
    
    pub fn merge(&mut self, other: &VectorClock) {
        for (k, v) in &other.0 {
            let entry = self.0.entry(k.clone()).or_insert(0);
            *entry = (*entry).max(*v);
        }
    }
    
    /// Returns true if self happened-before other
    pub fn happened_before(&self, other: &VectorClock) -> bool {
        self.0.iter().all(|(k, v)| other.0.get(k).map_or(false, |ov| v <= ov))
            && self.0 != other.0
    }
}
```

---

## Layer 3: Sync Modes

Apps choose their sync strategy via configuration.

### Mode Overview

| Mode | Offline | Collaboration | Conflict Strategy | Library Analog |
|------|---------|---------------|-------------------|----------------|
| `none` | No | No | N/A | Direct API |
| `queue` | Yes | No | Rebase | Replicache/Zero |
| `realtime` | Optional | Yes | CRDT merge | Automerge |

### Configuration

```toml
# mint.toml

[sync]
mode = "realtime"  # "none" | "queue" | "realtime"

[sync.queue]
# For offline + rebase mode
max_pending = 100
sync_interval_ms = 5000

[sync.realtime]
# For CRDT collaboration
presence = true
conflict_strategy = "notify"  # "last_write_wins" | "notify" | "merge" | "prompt"
transport = "websocket"       # "websocket" | "webrtc" | "liveblocks"
```

### Mode 1: `none` (Server-Only)

No local state, no offline. Commands execute directly against server.

```rust
pub struct NoSync;

#[async_trait]
impl SyncEngine for NoSync {
    async fn submit(&self, envelope: CommandEnvelope) -> Result<CommandResult<Value>, SyncError> {
        // Direct server call, no local caching
        self.server.execute(&envelope.command, envelope.input).await
    }
}
```

**Use when**: App requires real-time server data (trading, live feeds).

### Mode 2: `queue` (Offline + Rebase)

Commands queue locally, sync with server rebase (Replicache-style).

```rust
pub struct QueueSync {
    local_db: Arc<dyn Database>,
    pending: Arc<Mutex<Vec<CommandEnvelope>>>,
    server: Arc<dyn SyncServer>,
}

#[async_trait]
impl SyncEngine for QueueSync {
    async fn submit(&self, envelope: CommandEnvelope) -> Result<CommandResult<Value>, SyncError> {
        // 1. Apply optimistically to local DB
        let result = self.apply_local(&envelope).await?;
        
        // 2. Queue for sync
        self.pending.lock().await.push(envelope.clone());
        
        // 3. Attempt sync (non-blocking)
        tokio::spawn(self.try_sync());
        
        Ok(result)
    }
    
    async fn sync(&self) -> Result<SyncResult, SyncError> {
        let server_state = self.server.pull().await?;
        let pending = self.pending.lock().await.drain(..).collect::<Vec<_>>();
        let rebased = self.rebase(pending, &server_state)?;
        self.server.push(&rebased).await?;
        Ok(SyncResult { commands_synced: rebased.len(), conflicts: vec![] })
    }
}
```

**Use when**: Single-user app with offline needs.

### Mode 3: `realtime` (CRDT Collaboration)

Full multi-user collaboration using Automerge.

```rust
pub struct RealtimeSync {
    doc: Arc<Mutex<AutomergeDoc>>,
    presence: Arc<dyn Presence>,
    transport: Arc<dyn SyncTransport>,
}

#[async_trait]
impl SyncEngine for RealtimeSync {
    async fn submit(&self, envelope: CommandEnvelope) -> Result<CommandResult<Value>, SyncError> {
        // 1. Update presence
        self.presence.update_status(&envelope.session_id, &envelope.actor.id, Typing).await?;
        
        // 2. Apply to local Automerge doc
        let mut doc = self.doc.lock().await;
        let result = self.apply_to_doc(&mut doc, &envelope)?;
        
        // 3. Broadcast changes
        let changes = doc.get_changes(&[])?;
        self.transport.broadcast(changes).await?;
        
        // 4. Check for conflicts
        let conflict = self.detect_conflict(&doc, &envelope)?;
        
        Ok(CommandResult {
            success: true,
            data: Some(result),
            conflict,
            ..Default::default()
        })
    }
}
```

**Use when**: Multi-user/multi-agent collaboration.

---

## Conflict Handling

All collaborators (human and agent) receive conflict notifications.

### Conflict Types

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conflict {
    pub conflict_type: ConflictType,
    pub your_command: CommandEnvelope,
    pub their_command: Option<CommandEnvelope>,
    pub current_state: Value,
    pub suggestion: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConflictType {
    ConcurrentEdit { field: String, your_value: Value, their_value: Value },
    StaleState { your_version: u64, current_version: u64 },
    DeletedByOther { deleted_by: Actor },
}
```

### Agent Response to Conflict

```typescript
const result = await mcp.callTool("item.update", { id: "123", color: "#FF0000" });

if (result.conflict) {
  // Agent sees the conflict just like a human would
  console.log(`Conflict with ${result.conflict.their_command?.actor.name}`);
  
  // Agent can adapt
  await mcp.callTool("comment.add", {
    target: "123",
    text: `I noticed you changed the color. Should I proceed with my suggestion?`
  });
}
```

---

## Human-AI Collaboration Patterns

### Pattern 1: Parallel Editing

Human and agent work on different parts simultaneously.

```
┌─────────────────────────────────────────────────────────────────┐
│  Document                                                       │
│                                                                  │
│  ┌──────────────┐                    ┌──────────────┐          │
│  │ Header       │ ← Alice (human)    │ Footer       │ ← Agent  │
│  │ [cursor]     │                    │ [cursor]     │          │
│  └──────────────┘                    └──────────────┘          │
│                                                                  │
│  No conflict - different regions                                │
└─────────────────────────────────────────────────────────────────┘
```

### Pattern 2: Review & Approve

Agent proposes, human approves.

```
Agent: item.update({ id: "X", status: "draft", suggestion: "..." })
Human: item.update({ id: "X", status: "approved" })
```

### Pattern 3: Concurrent Same-Region

Both edit same region, CRDT merges.

```
Alice: text.insert({ pos: 10, text: "Hello" })
Agent: text.insert({ pos: 10, text: "World" })

Result: "HelloWorld" or "WorldHello" (deterministic merge)
Both notified of concurrent edit
```

### Pattern 4: Agent Yields to Human

Agent detects human editing same area, backs off.

```typescript
// Agent monitors presence
presence.subscribe(session).on('cursor_moved', (event) => {
  if (event.actor.type === 'human' && isNearMyWorkArea(event.position)) {
    // Human is working here, I'll move elsewhere
    await switchToAlternateTask();
  }
});
```

---

## Activity Feed

All commands appear in a unified activity feed.

```typescript
interface ActivityItem {
  id: string;
  timestamp: DateTime;
  actor: Actor;
  command: string;
  summary: string;  // Human-readable: "Alice updated header color"
  affected: string[];  // IDs of affected items
}

// UI shows:
// 12:00:01  Alice (human)   Updated header color to #FF0000
// 12:00:02  Claude (agent)  Added footer section
// 12:00:03  Bob (human)     Commented on header
```

---

## Implementation Libraries

| Component | Recommended | Alternative |
|-----------|-------------|-------------|
| **CRDT Engine** | Automerge (Rust) | Yjs, Loro |
| **Presence** | Liveblocks | Custom WebSocket |
| **Transport** | WebSocket | WebRTC, SSE |
| **Local Storage** | SQLite-WASM | IndexedDB |

### Why Automerge?

- **JSON-like**: Fits AFD command inputs/outputs
- **Rust core**: Native performance, WASM compatible
- **Offline-first**: Designed for it
- **History**: Built-in time travel

---

## Mint Integration

```bash
# Enable collaboration in project
mint init --sync realtime

# Run with collaboration enabled
mint dev --sync

# View collaboration status
mint sync status
```

---

## Implementation Phases

### Phase 6.1: Presence Layer (Days 1-2)
- [ ] Actor and Collaborator types
- [ ] Presence trait definition
- [ ] MemoryPresence adapter (local dev)
- [ ] WebSocketPresence adapter

### Phase 6.2: Command Envelopes (Day 3)
- [ ] CommandEnvelope struct
- [ ] VectorClock implementation
- [ ] Envelope wrapping in command execution

### Phase 6.3: Sync Engines (Days 4-6)
- [ ] SyncEngine trait
- [ ] NoSync implementation
- [ ] QueueSync with rebase
- [ ] RealtimeSync with Automerge

### Phase 6.4: Conflict Handling (Days 7-8)
- [ ] Conflict types and detection
- [ ] Conflict in CommandResult
- [ ] Resolution strategies

### Phase 6.5: UI Integration (Days 9-10)
- [ ] Presence indicators in heads
- [ ] Activity feed component
- [ ] Conflict resolution UI

---

## State Management

AFD follows a command-first state model where all persistent state flows through commands.

### State Hierarchy

| Category | Scope | Sync | Example | Mechanism |
|----------|-------|------|---------|-----------|
| **Domain State** | Global | Yes | Items, projects, users | Domain commands (`item.*`) |
| **Session State** | Global | Yes | Current workspace, agent context | `session.*` commands |
| **Device Preferences** | Device | No | Window size, notification settings | Local storage |
| **UI State** | Head | No | Sidebar open, scroll position | Head-local (signals) |

### Why Session as Domain?

Session state (current workspace, user preferences, agent context) is managed via `session.*` commands:

```rust
// Session commands - same API as domain commands
session.set({ key: "current_workspace", value: "project-123" })
session.set({ key: "agent.context", value: { task: "refactoring", files: [...] } })
session.get({ key: "user.preferences" })
```

**Benefits:**
- Agent context syncs across devices (mobile → desktop continuity)
- Same command API for all state mutations
- Session changes appear in activity feed
- Offline-capable via Part 6 sync modes
- Agents can read/write session just like humans

### UI State (Not Synced)

Each head manages ephemeral UI state locally using modern reactive patterns (signals):

```typescript
// Web head - local signals (not synced)
const sidebarOpen = signal(false);
const scrollPosition = signal({ x: 0, y: 0 });
const activeTab = signal("overview");
```

This stays head-local because:
- Different heads have different UI structures
- No value in syncing scroll position across devices
- Performance (no round-trips for UI toggles)
- Ephemeral by nature (reset on page load is fine)

### Device Preferences

Some settings are device-specific and shouldn't sync:

```typescript
// Stored in localStorage, not synced
const devicePrefs = {
  windowBounds: { x: 100, y: 100, width: 1200, height: 800 },
  notificationsEnabled: true,
  theme: "system",  // May differ per device (dark on laptop, light on phone)
};
```

### Summary: What Goes Where

```
┌─────────────────────────────────────────────────────────────────┐
│  "Should this sync across devices and appear in activity?"     │
│                                                                  │
│  YES → Domain or Session command                                │
│        ├── User data? → item.*, project.*, etc.                │
│        └── Context/prefs? → session.*                          │
│                                                                  │
│  NO  → Local storage                                            │
│        ├── Device-specific? → Device preferences               │
│        └── UI-specific? → Head-local signals                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Success Criteria

1. **Same API**: Humans and agents use identical commands
2. **Visible Presence**: All collaborators appear with cursors
3. **Conflict Awareness**: Both humans and agents receive conflict notifications
4. **App Choice**: Sync mode is configurable per-app
5. **Offline Works**: Queue mode enables offline operation
6. **Real-time Works**: Changes propagate in < 100ms
