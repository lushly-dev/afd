# Spec Review: Lushx Experimental Stack - Phase 1 (MVP)

**Reviewer:** Claude Opus 4.5
**Date:** 2026-01-12
**Spec Version:** DRAFT
**Verdict:** Approve with suggestions

---

## Summary

The spec is well-structured and scoped appropriately for an MVP. It correctly follows AFD command-first principles by defining MCP commands (`agent-spawn`, `agent-status`, `agent-finish`) before the Control Center UI. The Convex state management choice is justified. A few clarifications and missing details should be addressed before implementation.

---

## BLOCKERS

### 1. Missing `lushx-entry` Tool Definition

**Location:** Component 1, line 20

The spec lists `lushx-entry` as a "meta-tool" but doesn't specify its return schema or behavior. The proposal mentions it should return "capabilities, current state, suggested next action" but the spec doesn't define this.

**Required:**
- Define the `LushxCapabilities` schema (workflows available, active sessions, etc.)
- Specify what "suggested next action" means algorithmically
- Document when/why an agent would call this vs. going directly to `agent-spawn`

### 2. Missing Error Handling Contract

**Location:** Throughout spec

No error scenarios are documented. For AFD compliance, each command needs:
- Error codes that can occur
- Recovery suggestions for each error
- What happens if Convex is unreachable

**Required:** Add error handling section or table for each command.

### 3. Convex Authentication Not Addressed

**Location:** Component 2, lines 35-51

The schema is defined but no mention of:
- How the Python MCP server authenticates to Convex
- How the Tauri app authenticates to Convex
- Whether CONVEX_DEPLOY_KEY or public client is used

**Required:** Document the auth flow for both MCP server and Control Center.

---

## SUGGESTIONS

### 1. Add CommandResult Examples to Spec

**Location:** Component 1

The proposal has example code with `CommandResult` but the spec doesn't. Adding explicit examples makes implementation unambiguous:

```typescript
// agent-spawn success
{
  success: true,
  data: { agentId: "agent-abc", pane: 1 },
  reasoning: "Spawned review workflow in pane 1",
  confidence: 1.0
}

// agent-spawn failure
{
  success: false,
  error: {
    code: "WORKFLOW_NOT_FOUND",
    message: "Unknown workflow: invalid-name",
    suggestion: "Available workflows: review, feature"
  }
}
```

### 2. Clarify Pane Assignment in Single-Pane MVP

**Location:** Schema Design, line 48

The schema includes `pane: number` but Phase 1 is single-pane. Suggest:
- Hardcode `pane: 0` for MVP
- Or remove from schema and add in Phase 2

This avoids confusion about what values are valid in MVP.

### 3. Add Agent Lifecycle State Diagram

A simple state machine diagram would clarify valid transitions:

```
spawned → running → paused → running → complete
                  ↘        ↗
                    stopped
```

### 4. Specify `agent-pause` and `agent-stop` in MVP

**Location:** Lines 84-85 (proposal), not in spec

The proposal mentions `agent-pause` and `agent-stop` commands for UI controls, but the spec only implements `agent-finish`. Clarify:
- Are Pause/Stop in MVP scope or Phase 2?
- If out of scope, remove from Control Center button list

### 5. Add Verification for MCP Tool Registration

**Location:** Phase 1.1 tasks

Add explicit verification step:
```bash
# After registering in Claude Desktop
claude mcp list-tools | grep lushx  # Verify tools appear
```

### 6. Define Convex Real-Time Sync Requirements

**Location:** Component 2

The proposal mentions "reactive queries" but doesn't specify:
- Polling interval if using REST (non-reactive)
- Whether to use Convex subscriptions or polling for MVP
- How Control Center receives session updates

### 7. Specify xterm.js PTY Integration

**Location:** Component 3, line 68

Embedding a terminal requires PTY (pseudo-terminal) integration. Tauri doesn't have built-in PTY support. Options:
- `tauri-plugin-shell` with PTY fork
- Native Rust PTY crate (`portable-pty`)
- Web-based terminal without true PTY (limited)

Document the chosen approach.

---

## OUT OF SCOPE

The following items are correctly deferred to later phases:

1. **Multiple panes** - Phase 2 (spec line 169)
2. **Settings panel** - Phase 2 (spec line 170)
3. **`lushx map` visualization** - Phase 2 (spec line 171)
4. **File explorer, grep panel** - Phase 3 (spec line 172)
5. **Orchestrator agent** - Phase 2 (spec line 173)
6. **Offline/air-gapped file fallback** - Future (proposal line 222)
7. **DirectConnect integration** - Phase 2 (proposal line 299)

---

## AFD Compliance Assessment

| Criteria | Status | Notes |
|----------|--------|-------|
| Command-first architecture | ✅ Pass | Commands defined before UI |
| `CommandResult` structure | ⚠️ Partial | Examples in proposal, not spec |
| Schema design | ✅ Pass | Convex schema well-defined |
| Error handling | ❌ Missing | No error codes/suggestions |
| CLI testability | ✅ Pass | `afd call` equivalence documented |
| Test plan | ✅ Pass | pytest tests specified |

---

## Positive Highlights

1. **Clean phase separation** - MVP scope is realistic and validates core concept
2. **Proposal → Spec traceability** - Clear link to design rationale
3. **Tech choices justified** - Convex vs files comparison is well-reasoned
4. **Task breakdown is actionable** - Clear checkboxes with time estimates
5. **Manual verification steps** - End-to-end flow documented for testing

---

## Recommended Next Steps

1. Address BLOCKERS before implementation begins
2. Add CommandResult examples for implementer clarity
3. Create a simple state diagram for agent lifecycle
4. Confirm PTY approach for xterm.js integration
