# Spec: Lushx Experimental Stack - Phase 1 (MVP)

**Status:** DRAFT  
**Proposal:** [lushx-experimental-stack.proposal.md](../proposed/lushx-experimental-stack/lushx-experimental-stack.proposal.md)
**Scope:** Phase 1 MVP - Validate the core concept works

## Overview

Implement the foundational lushx stack: MCP server with entry point, one workflow-as-code example, Convex state management, and Control Center app with agent panes. Goal is to prove the concept with minimal scope.

## Implementation Plan

### Component 1: MCP Server (`src/lushx/`)

#### New Files

- `src/lushx/__init__.py` - Package init, exports
- `src/lushx/cli.py` - CLI entry point (`lushx mcp serve`)
- `src/lushx/mcp_server.py` - FastMCP 2 server with tools
- `src/lushx/commands/entry.py` - `lushx-entry` meta-tool
- `src/lushx/commands/agent.py` - `agent-spawn`, `agent-status`, `agent-finish`
- `src/lushx/workflows/feature.py` - Example workflow-as-code

#### Command Schemas

**`lushx-entry` Return Schema:**
```python
class LushxCapabilities(BaseModel):
    workflows: list[str]           # ["review", "feature"]
    active_sessions: list[str]     # Agent IDs currently running
    suggested_action: str | None   # e.g., "Resume session abc123" or None
    version: str                   # "0.1.0"

# When to use: Agent calls this first to discover what's available
# vs agent-spawn: Call entry when unknown context, spawn when intent is clear
```

**`agent-spawn` Schema:**
```python
class AgentHandle(BaseModel):
    agent_id: str   # "agent-abc123"
    pane: int       # 0 for MVP (single pane)
    workflow: str   # "review"
    
# Success: CommandResult[AgentHandle] with reasoning
# Failure: See error handling below
```

**`agent-status` Schema:**
```python
class AgentStatus(BaseModel):
    state: Literal["running", "paused", "stopped", "complete"]
    pane: int
    output_lines: int
    updated_at: datetime
```

#### Error Handling

| Command | Error Code | Cause | Suggestion |
|---------|------------|-------|------------|
| `lushx-entry` | `CONVEX_UNREACHABLE` | Network/auth failure | "Check CONVEX_URL and network connection" |
| `agent-spawn` | `WORKFLOW_NOT_FOUND` | Invalid workflow name | "Available workflows: review, feature" |
| `agent-spawn` | `SPAWN_FAILED` | Claude CLI not found | "Ensure Claude CLI is installed and in PATH" |
| `agent-spawn` | `CONVEX_WRITE_FAILED` | Write failed | "Retry or check Convex dashboard for errors" |
| `agent-status` | `AGENT_NOT_FOUND` | Invalid agent_id | "Check agent_id or call lushx-entry for active sessions" |
| `agent-finish` | `ALREADY_COMPLETE` | Session already finished | "Session was already marked complete" |

**Convex unreachable fallback**: Return cached data if available, else error with suggestion.

#### CommandResult Examples

```json
// agent-spawn success
{
  "success": true,
  "data": { "agent_id": "agent-abc", "pane": 0, "workflow": "review" },
  "reasoning": "Spawned review workflow in pane 0",
  "confidence": 1.0
}

// agent-spawn failure
{
  "success": false,
  "error": {
    "code": "WORKFLOW_NOT_FOUND",
    "message": "Unknown workflow: invalid-name",
    "suggestion": "Available workflows: review, feature"
  }
}
```

#### Agent Lifecycle State Diagram

```
spawned → running ──→ complete
              │   (user clicks Finish)
              │
              ↓
           stopped
        (user clicks Stop)
```

**MVP scope**: Only `running` → `complete` and `running` → `stopped` transitions.
**Phase 2**: Add `paused` state with pause/resume transitions.

#### Files to Modify

- `pyproject.toml` - Add `lushx` entry point
- `src/lushbot/mcp_server.py` - Reference only (no changes, for comparison)

---

### Component 2: Convex Schema & Auth

#### New Files

- `convex/schema.ts` - Add `agentSessions` table (extend existing schema)
- `convex/agentSessions.ts` - Mutations/queries for session state

#### Authentication

**MCP Server (Python):**
- Uses `CONVEX_URL` env var (same as Myoso backend)
- Uses `convex` Python client with public client pattern
- No deploy key needed - uses same project as Myoso

**Control Center (Tauri/React):**
- Uses Convex React client (`convex/react`)
- Same project URL as Myoso frontend
- Anonymous access for session queries (public data)

**Environment:**
```bash
# Same env vars as Myoso - already configured
CONVEX_URL=https://your-project.convex.cloud
```

#### Schema Design

```typescript
// agentSessions table
{
  agentId: string,          // Unique identifier
  workflow: string,         // e.g., "review", "feature"
  issue: string | null,     // GitHub issue reference
  state: "running" | "paused" | "stopped" | "complete",
  pane: number,             // 0 for MVP (single pane)
  createdAt: number,        // Timestamp
  updatedAt: number,        // Last state change
  outputLines: number,      // For progress tracking
}
```

---

### Component 3: Control Center App

#### Technology

- **Framework**: Tauri 2.0 (Rust backend, web frontend)
- **Frontend**: Vanilla HTML/CSS/JS (no React - will be replaced with FAST-AF in Phase 2+)
- **Terminal**: xterm.js for embedded terminal panes
- **Convex**: Vanilla JS client (`convex/browser`)

#### New Files (in `lushbot/control-center/`)

- `src-tauri/` - Tauri Rust backend
- `src/index.html` - Main HTML structure
- `src/app.js` - Main application logic
- `src/styles.css` - Styles (can import Myoso tokens.css)
- `src/agent-pane.js` - Terminal pane component
- `src/pane-controls.js` - Pause/Stop/Finish button handlers
- `src/convex-client.js` - Convex client wrapper
- `src/spawn.js` - Claude CLI process spawning

#### Convex Real-Time Sync

**MVP approach**: Polling (simpler than subscriptions for vanilla JS)
- Poll `sessions:list` every 2 seconds for active sessions
- Poll `sessions:getStatus` on demand when agent-status called

**Phase 2**: Upgrade to Convex subscriptions for true real-time (requires more setup).

#### PTY Integration

**Chosen approach**: `portable-pty` Rust crate
- Tauri backend spawns PTY with Claude CLI
- Streams output to frontend via Tauri events
- xterm.js renders the output

Alternative considered: `tauri-plugin-shell` (simpler but less control)

---

## Task Breakdown

### Phase 1.1: MCP Server Foundation (~6 hours)

- [ ] Create `src/lushx/` package structure
- [ ] Implement `lushx-entry` tool (returns capabilities, current state)
- [ ] Implement `agent-spawn` tool (returns handle, writes to Convex)
- [ ] Implement `agent-status` tool (queries Convex)
- [ ] Implement `agent-finish` tool (updates Convex)
- [ ] Add CLI entry point (`lushx mcp serve`)
- [ ] Register in Claude Desktop config for testing
- [ ] Verify tools appear: `claude mcp list-tools | grep lushx`

### Phase 1.2: Convex Integration (~3 hours)

- [ ] Add `agentSessions` table to schema
- [ ] Create `sessions:create` mutation
- [ ] Create `sessions:updateStatus` mutation  
- [ ] Create `sessions:getStatus` query
- [ ] Create `sessions:list` query (for Control Center)
- [ ] Test from Python with convex client

### Phase 1.3: Control Center Shell (~8 hours)

- [ ] Initialize Tauri 2.0 project in `control-center/`
- [ ] Set up React with Myoso design tokens
- [ ] Create basic layout (sidebar + main pane area)
- [ ] Integrate xterm.js for terminal rendering
- [ ] Implement `AgentPane` component with embedded terminal
- [ ] Wire Convex for reactive session list
- [ ] Add Finish button that calls Convex mutation

### Phase 1.4: Integration & Test (~4 hours)

- [ ] Spawn agent from IDE via `agent-spawn` → appears in Control Center
- [ ] Click Finish → status updates → IDE agent can poll complete
- [ ] Create one pytest test for `agent-spawn` → `agent-status` flow
- [ ] Document the flow in README

---

## Verification Plan

### Automated Tests

```bash
# Run lushx tests
pytest tests/test_lushx/ -v

# Specific tests
pytest tests/test_lushx/test_agent_spawn.py -v
pytest tests/test_lushx/test_agent_status.py -v
```

- [ ] `test_agent_spawn_returns_command_result` - Validates CommandResult structure
- [ ] `test_agent_status_queries_convex` - Mock Convex, verify query
- [ ] `test_agent_finish_updates_state` - Complete lifecycle

### Manual Verification

- [ ] From Claude Desktop: call `agent-spawn workflow="review" issue="42"`
- [ ] Verify agent appears in Control Center with terminal output
- [ ] Interact with agent in pane (follow-up prompts)
- [ ] Click Finish button
- [ ] From Claude Desktop: call `agent-status agent_id="..."` → state = "complete"
- [ ] Verify session appears in history/log

---

## Phasing

**This spec covers Phase 1 only.**

| Phase | Scope | Spec Status |
|-------|-------|-------------|
| Phase 1 (this spec) | MVP - spawn/status/finish cycle | DRAFT |
| Phase 2 | Full lushbot replacement | Future |
| Phase 3 | IDE-lite features | Future |
| Phase 4 | Full Agentic IDE | Future |

Checkpoint: After Phase 1 validates the concept, create separate specs for subsequent phases.

---

## Dependencies

- `afd` package for CommandResult patterns
- `fastmcp` v2 for MCP server
- `convex` Python client
- Tauri 2.0 for desktop app
- xterm.js for terminal rendering

## Out of Scope

- Multiple panes (Phase 2)
- Settings panel (Phase 2)
- `lushx map` visualization (Phase 2)
- File explorer, grep panel (Phase 3)
- Orchestrator agent (Phase 2)
- **Workflow progress visualization** (Phase 3+) - Visual diagram showing completed/current/pending nodes in workflow flow
