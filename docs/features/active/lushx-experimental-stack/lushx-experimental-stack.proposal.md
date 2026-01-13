---
status: draft
created: 2026-01-12
author: agent
---

# Lushx: Experimental Workflow-as-Code Stack

## Problem Statement

The current lushbot tooling has reliability issues:

1. **Context Amnesia** - Agents lose workflow knowledge when context is trimmed
2. **Fragile Orchestration** - Tools break if not called in perfect order
3. **Discovery Gap** - New agents must read skills + workflows + tools to be effective
4. **Observability Blind Spots** - No way to know when long-running steps complete
5. **Testing Gaps** - Hard to detect when changes break workflows

## Command Definitions (AFD-First)

All lushx functionality is exposed as commands before any UI. Commands follow AFD patterns:
- Input/output schemas via Pydantic
- `CommandResult` with reasoning, confidence, warnings
- MCP-compatible tool decorators

### Core Commands

Commands extend existing lushbot patterns:

```python
from afd import CommandResult, success, failure

@mcp.tool()
async def work_start(issue: str) -> CommandResult[WorkSession]:
    """Start work on a GitHub issue. Creates branch and session."""
    # ... implementation
    return success(
        data=WorkSession(id="sess-123", branch="feat/issue-42"),
        reasoning="Created branch from issue title, initialized session"
    )

@mcp.tool()
async def agent_spawn(
    workflow: str,
    issue: Optional[str] = None,
    prompt: Optional[str] = None
) -> CommandResult[AgentHandle]:
    """Spawn a sub-agent in Control Center. Returns handle for status polling."""
    # ... implementation
    return success(
        data=AgentHandle(id="agent-abc", pane=1),
        reasoning="Spawned review agent in pane 1"
    )

@mcp.tool()
async def agent_status(agent_id: str) -> CommandResult[AgentStatus]:
    """Poll agent status from Convex. Non-blocking."""
    # ... queries Convex
    return success(
        data=AgentStatus(state="running", pane=1, output_lines=42),
        reasoning="Agent still processing, 42 lines of output"
    )

@mcp.tool()
async def map_generate(
    format: Literal["html", "json"] = "html"
) -> CommandResult[MapData]:
    """Generate workflow visualization from code analysis."""
    # ... implementation
    return success(data=MapData(workflows=[...], tools=[...]))
```

### Command Catalog

| Command | Extends | Purpose |
|---------|---------|---------|
| `lushx-entry` | New | Single entry point, returns capabilities |
| `work-start` | `lush-work start` | Begin work on issue |
| `work-complete` | `lush-work complete` | Finish work, create PR |
| `spec-create` | `lush-spec create` | Generate spec from proposal |
| `dev-lint` | `lush-dev lint` | Run linting |
| `agent-spawn` | New | Spawn sub-agent in Control Center |
| `agent-status` | New | Poll agent state from Convex |
| `agent-finish` | New | Mark agent complete (UI or MCP) |
| `map-generate` | New | Generate workflow visualization |

## Proposed Solution

Create `lushx` - an experimental parallel stack in the lushbot repo that explores:

### 1. Workflow-as-Code

Instead of sequential tool calls, agents write Python that chains tools:

```python
async def feature_workflow(issue: str):
    work = await lushx.work.start(issue)
    spec = await lushx.spec.create(work.feature_name)
    await lushx.dev.lint(package=spec.package)
    return await lushx.work.complete(work.id)
```

**Why**: Code is durable memory. The program survives context limits.

### 2. Single Entry Point

One `lush-x` meta-tool that returns:
- Available workflows (high-level capabilities)
- Current context (what's in progress)
- Suggested next action

**Why**: Solves discovery. Agent always knows where to start.

### 3. Progressive Disclosure via Files

Tools organized as folder structure with README.md front matter:

```
.lushx/
  ENTRY.md         # Always in context
  workflows/
    feature.md     # Discovered via grep when needed
```

**Why**: Aligns with Cursor/Claude patterns. Agent discovers via search, not preloading.

### 4. Workflow Testing

pytest suite that validates workflows end-to-end:

```python
def test_feature_workflow_happy_path():
    result = feature_workflow("test-issue-1")
    assert result.pr_created
    assert result.lint_passed
```

**Why**: Catch breaks on CI, not when agents hit failures.

### 5. Visual Workflow Map (`lushx map`)

CLI command that auto-generates human-readable documentation in browser:

```bash
lushx map          # Opens browser with workflow visualization
lushx map --json   # Export as JSON for other tools
```

**Renders from actual code:**

| Section | Source | Display |
|---------|--------|---------|
| Workflows | `src/lushx/workflows/*.py` | Flowcharts with steps |
| Tools | MCP tool decorators | Cards with params, returns |
| Dependencies | Import analysis | Dependency graph |
| Skills | `.claude/skills/*/SKILL.md` | Rendered markdown |
| Current State | Session files | "You are here" indicator |

**Why**: Solves human discoverability. No manual docs to maintain - always reflects actual system.

### 6. Control Center App (`lushx dashboard`)

> **AFD Alignment**: The Control Center is a UI projection of the commands defined above. All functionality is accessible via MCP commands (`agent-spawn`, `agent-status`, `agent-finish`) - the desktop app is one UI surface, not the source of truth.

Desktop app (Electron/Tauri) that provides visual orchestration:

**Commands ↔ UI Mapping**:
| Command | UI Equivalent |
|---------|---------------|
| `agent-spawn` | New Pane button, or spawned by IDE agent |
| `agent-status` | Real-time pane status display |
| `agent-finish` | ✓ Finish button |
| `map-generate` | Documentation tab |

**Agent Panes**: Sub-agents run in embedded terminal panes
- Spawned via `agent-spawn` command (from IDE agent or UI)
- Interactive - human can follow up before finishing
- Human clicks Finish → calls `agent-finish` → updates Convex

**Human Controls**:
| Button | Calls | Action |
|--------|-------|--------|
| ⏸ Pause | `agent-pause` | Suspend process |
| ⏹ Stop | `agent-stop` | Kill process |
| ✓ Finish | `agent-finish` | Mark complete, close pane |

**CLI Equivalence**: Everything achievable via UI can also be done via:
```bash
afd call agent-spawn --workflow review --issue 42
afd call agent-status --agent-id abc123
afd call agent-finish --agent-id abc123
```

**Why**: Unified surface for observing and controlling sub-agents. UI is a convenience layer over commands.

## Architecture

```
lushbot/
├── src/lushbot/          # Stable (unchanged)
├── src/lushx/            # Experimental
│   ├── mcp_server.py     # FastMCP 2 server
│   ├── workflows/        # Workflow-as-code patterns
│   └── entry.py          # Single entry point
├── tests/
│   └── test_lushx/       # Workflow validation (unit + JTBD)
```

### State Management: Convex

Session state stored in Convex (not files):

**Why Convex over files?**
| Concern | Files | Convex |
|---------|-------|--------|
| Real-time sync | Polling/watching | Built-in reactive queries |
| Race conditions | Manual locking | ACID transactions |
| Control Center ↔ MCP | Parse files | Direct queries |
| Already available | N/A | Running for Myoso, zero setup |
| Connectivity | Works offline | Requires connection |

**Decision**: Agentic workflows already require connectivity (Claude API, GitHub). Convex adds reliability without new constraints. Files remain an option for offline/air-gapped scenarios (future work).

**Usage**:
- Control Center writes status to Convex on state changes
- IDE agent polls via `agent-status` → Convex query
- Reactive UI updates automatically

```python
# MCP tool queries Convex
@mcp.tool()
async def agent_status(agent_id: str) -> CommandResult[AgentStatus]:
    data = await convex.query("sessions:getStatus", {"agentId": agent_id})
    return success(data=AgentStatus(**data))
```

### Testing Strategy

| Layer | Type | What It Validates |
|-------|------|-------------------|
| Unit | pytest | Individual tool functions work |
| JTBD | pytest | Complete workflows (user journeys) succeed |
| AFD Pipeline | Integration | CommandResult chains correctly |

Same dependencies as lushbot. Swap MCP config to test.

## Research Basis

Based on industry patterns from:
- **Cloudflare Code Mode** - TypeScript generation (98.7% token reduction)
- **Anthropic Tool Search Tool** - Meta-tool discovery (85% token reduction)
- **Cursor Dynamic Context** - Files as universal abstraction (46.9% reduction)
- **Claude Code Skills** - Progressive disclosure via folder structure

See: `AFD/docs/research/tool-scale-analysis.md`

## Success Metrics

| Metric | Target |
|--------|--------|
| Workflow completion rate | >90% (vs current ~60%) |
| Context limit failures | <10% of sessions |
| New agent onboarding | <3 tool calls to productive |
| CI workflow tests | 100% pass rate |

## Risks

- **Parallel maintenance** - Two stacks to keep working. Mitigation: graduate patterns to lushbot once proven.
- **Migration complexity** - Clear decision points needed. See "Relationship to Lushbot" below.
- **Code execution security** - Workflow-as-code means agents write Python. This is a **deployment concern**, not architectural:
  - Same risk as current Claude Code with `--dangerously-skip-permissions`
  - Operators can run lushx in containers/sandboxes if needed
  - Optional: Integrate with `firejail`, Docker, or Deno-style permission prompts
  - Not blocking: current setup accepts this risk already

### Relationship to Lushbot

| What | Action |
|------|--------|
| Existing commands | Extended (same patterns, new capabilities) |
| New commands | Added to lushx, graduate when stable |
| Graduation criteria | 90%+ workflow success rate, full test coverage |
| Dependency | lushx depends on lushbot (shared utils)

## Roadmap

### Phase 1: Foundation
- MCP server with entry point + workflow-as-code
- Control Center app (Tauri/Electron)
  - Agent panes (embedded terminals)
  - Human controls (pause/stop/finish)
  - Convex state management
- Unit + JTBD workflow tests
- Documentation viewer (`lushx map`)

### Phase 2: Orchestrator Agent
- Built-in chat in Control Center (like Myoso)
- DirectConnect for deep integration
- Natural language orchestration: "spawn review for #42"
- Wait for completion, coordinate multi-agent flows

### Phase 3: IDE-Lite Features
- File tree (drag files into context)
- Search/grep panel (ripgrep wrapper)
- File viewer with syntax highlighting
- Diff viewer for agent changes

### Phase 4: Feature Lifecycle Hub (Full Agentic IDE)
- Replace traditional IDE for agentic workflows
- Human role: direct, observe, correct
- Agents handle: coding, testing, refactoring
- **Features as first-class entities** (not just folders/files)
  - Rich specs with live Violet token references
  - Bi-directional links: spec ↔ code ↔ docs
  - Living documentation that stays in sync
  - Workflow progress visualization (completed/pending nodes)
- Minimal manual editing needed

## Cost Breakdown

### Phase 1: MVP Trial (~15-25 hours)

| Component | Effort | Notes |
|-----------|--------|-------|
| MCP Server scaffold | 2-4h | `src/lushx/`, entry point tool |
| Workflow-as-code example | 2-3h | One working workflow |
| Convex schema | 1-2h | Sessions table, mutations/queries |
| Control Center shell | 4-6h | Tauri app, one terminal pane |
| Basic controls | 2-3h | Finish button, status display |
| MCP ↔ Control Center | 2-3h | `agent.spawn()`, `agent.status()` |
| One pytest test | 1-2h | Validates workflow runs |

**Deliverable**: Spawn agent from IDE, see in Control Center, click Finish, poll status.

### Phase 2: Replace Lushbot (~30-45 hours)

| Component | Effort | Notes |
|-----------|--------|-------|
| Multiple panes | 3-4h | Wave-style parallel agents |
| Port all workflows | 8-12h | Review, spec, work, dev |
| Settings panel | 2-3h | Global flags, model selection |
| Documentation viewer | 4-6h | `lushx map` visualization |
| JTBD test suite | 4-6h | Cover major workflows |
| Sessions UI | 2-3h | History, completed work log |
| Error handling | 2-3h | Structured recovery, retry |
| Polish | 4-6h | UI refinement, edge cases |

**Deliverable**: Full lushbot replacement with Control Center as orchestration surface.

### Summary

| Phase | Effort | Outcome |
|-------|--------|---------|
| 1 (MVP) | 15-25h | Proof of concept |
| 2 (Replace) | 30-45h | Feature parity |
| **Total** | **45-70h** | ~1-2 weeks |

## Next Steps

1. Scaffold `src/lushx/` with minimal structure
2. Implement `lush-x` entry point  
3. Create one workflow-as-code example
4. Add pytest workflow validation (unit + JTBD)
5. Implement Control Center app (Convex state, agent panes)
6. Test with real agent session
