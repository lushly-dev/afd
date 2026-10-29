# Plan: Agent Memory System

> **Status:** Complete
> **Date:** 2026-02-25
> **Updated:** 2026-02-25 — AFD Python parity integration
> **Scope:** Per-agent private memory, shared team memory, and task-scoped memory. Separate botcore plugin package (`botcore-memory`), backed by Azure Cosmos DB.
> **Depends on:** [Agent Orchestration](../agent-orchestration/00-overview.plan.md) (`botcore-agents`), [Connectors](../connectors/00-overview.plan.md) (`botcore-connectors`, Azure auth), `afd` Python package (validation, middleware, telemetry)

---

## Summary

Agents need persistent memory across tasks and sessions. This feature adds three memory scopes:

1. **Agent memory** — Private to one agent. Preferences, learned patterns, domain knowledge.
2. **Team memory** — Shared across all agents. Project context, conventions, decisions, user preferences.
3. **Task memory** — Scoped to a single task. Working state, intermediate results. Auto-cleaned on completion.

Memory is accessed exclusively through typed botcore commands — agents never touch the storage backend directly.

---

## Architecture

```
Agent (via Copilot session tool call)
    ↓
memory_set / memory_get / memory_search commands
    ↓
Memory Store interface
    ↓
┌──────────────┬──────────────────┐
│ Local Store   │ Azure Cosmos DB  │
│ (dev/test)    │ (production)     │
│ JSON files    │ NoSQL documents  │
└──────────────┴──────────────────┘
```

### Three Memory Scopes

```
┌─────────────────────────────────────────────────────────┐
│  TEAM MEMORY (shared)                                   │
│  "Our coding standards use Biome for linting"           │
│  "Sprint goal: ship v2.1 by March 15"                   │
│  "User prefers concise responses"                       │
│  Partition: /team/{team_id}                              │
├─────────────────────────────────────────────────────────┤
│  AGENT MEMORY (private per agent)                       │
│  ┌──────────────────┐  ┌──────────────────┐            │
│  │ researcher        │  │ developer         │           │
│  │ "GitHub search    │  │ "Prefers pytest   │           │
│  │  syntax notes"    │  │  over unittest"   │           │
│  │ Partition:        │  │ Partition:        │           │
│  │ /agent/researcher │  │ /agent/developer  │           │
│  └──────────────────┘  └──────────────────┘            │
├─────────────────────────────────────────────────────────┤
│  TASK MEMORY (ephemeral, auto-cleaned)                  │
│  "Research findings so far: [...]"                      │
│  "Files modified: src/config.py, src/server.py"         │
│  Partition: /task/{task_id}                              │
│  TTL: 7 days after task completion                      │
└─────────────────────────────────────────────────────────┘
```

---

## Data Model

```python
@dataclass
class MemoryEntry:
    id: str                                    # UUID
    scope: Literal["agent", "team", "task"]
    scope_id: str                              # Agent name, team ID, or task ID
    key: str                                   # Hierarchical key: "coding/style" or "sprint/goals"
    value: str                                 # Plain text content
    tags: list[str] = field(default_factory=list)   # For search/filtering
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    created_by: str = ""                       # Agent name that created this
    ttl: int | None = None                     # Seconds until auto-delete (task memory)
```

### Cosmos DB Document Structure

```json
{
    "id": "mem_abc123",
    "partitionKey": "/agent/researcher",
    "scope": "agent",
    "scopeId": "researcher",
    "key": "github/search-syntax",
    "value": "Use 'is:issue is:open label:bug' for open bugs. Qualifier 'in:title' searches titles only.",
    "tags": ["github", "search", "reference"],
    "createdAt": "2026-02-25T10:30:00Z",
    "updatedAt": "2026-02-25T10:30:00Z",
    "createdBy": "researcher",
    "ttl": null
}
```

**Partition strategy:**
- `/agent/{name}` — per-agent isolation, fast reads
- `/team/{id}` — shared reads, no cross-team leakage
- `/task/{id}` — ephemeral, TTL-based auto-cleanup

---

## Commands

```python
# Core memory operations
async def memory_set(
    key: str,
    value: str,
    scope: Literal["agent", "team", "task"] = "agent",
    scope_id: str | None = None,       # Defaults to calling agent's name
    tags: list[str] | None = None,
) -> CommandResult[dict]:
    """Store or update a memory entry."""

async def memory_get(
    key: str,
    scope: Literal["agent", "team", "task"] = "agent",
    scope_id: str | None = None,
) -> CommandResult[dict]:
    """Retrieve a specific memory entry by key."""

async def memory_search(
    query: str,
    scope: Literal["agent", "team", "task", "all"] = "all",
    scope_id: str | None = None,
    tags: list[str] | None = None,
    limit: int = 10,
) -> CommandResult[list[dict]]:
    """Search memory by keyword or tags. Scope 'all' searches agent + team."""

async def memory_delete(
    key: str,
    scope: Literal["agent", "team", "task"] = "agent",
    scope_id: str | None = None,
) -> CommandResult[dict]:
    """Delete a memory entry."""

async def memory_list(
    scope: Literal["agent", "team", "task"] = "agent",
    scope_id: str | None = None,
    prefix: str | None = None,         # Key prefix filter: "github/"
    pagination: PaginationParams = PaginationParams(),  # AFD pagination
) -> CommandResult[list[dict]]:
    """List memory entries with optional key prefix filter and pagination."""

# Bulk operations for orchestrator
async def memory_share(
    key: str,
    value: str,
    tags: list[str] | None = None,
) -> CommandResult[dict]:
    """Convenience: store in team scope. All agents can read."""

async def memory_import(
    entries: list[dict],
    scope: Literal["agent", "team"] = "team",
) -> CommandResult[dict]:
    """Bulk import memory entries. For initial team knowledge seeding."""
```

---

## Store Interface

```python
from abc import ABC, abstractmethod

class MemoryStore(ABC):
    """Backend-agnostic memory storage."""
    
    @abstractmethod
    async def set(self, entry: MemoryEntry) -> None: ...
    
    @abstractmethod
    async def get(self, scope: str, scope_id: str, key: str) -> MemoryEntry | None: ...
    
    @abstractmethod
    async def search(self, scope: str, scope_id: str | None, 
                     query: str, tags: list[str] | None, limit: int) -> list[MemoryEntry]: ...
    
    @abstractmethod
    async def delete(self, scope: str, scope_id: str, key: str) -> bool: ...
    
    @abstractmethod
    async def list(self, scope: str, scope_id: str, prefix: str | None, 
                   limit: int) -> list[MemoryEntry]: ...
```

### Two Implementations

**Local Store** (development / testing):
```python
class LocalMemoryStore(MemoryStore):
    """JSON file-backed store for development. One file per scope_id."""
    # Stores in ~/.botcore/memory/{scope}/{scope_id}.json
```

**Azure Cosmos DB Store** (production):
```python
class CosmosMemoryStore(MemoryStore):
    """Azure Cosmos DB backed store. Uses partition key for isolation."""
    # Container: agent-memory
    # Partition key: /{scope}/{scope_id}
    # TTL: enabled for task-scoped entries
```

---

## Configuration

```toml
# botcore.toml

[memory]
store = "local"                        # "local" or "cosmos"
local_path = "~/.botcore/memory"       # For local store

[memory.cosmos]
endpoint = ""                          # Cosmos DB endpoint
database = "botcore"
container = "agent-memory"
# Auth via DefaultAzureCredential — no keys in config

[memory.retention]
task_ttl_days = 7                      # Auto-delete task memory after 7 days
max_entries_per_agent = 1000           # Prevent unbounded growth
max_entry_size_bytes = 10240           # 10KB per entry
```

---

## Agent Memory Integration

When an agent starts, its Copilot session gets memory commands as tools:

```python
# In agent orchestrator — when building agent tools
def build_agent_tools(agent: AgentConfig) -> list:
    tools = []
    
    # Memory tools — always available
    tools.extend([
        botcore_command_to_copilot_tool(memory_set),    # Can write own + team
        botcore_command_to_copilot_tool(memory_get),
        botcore_command_to_copilot_tool(memory_search),
        botcore_command_to_copilot_tool(memory_list),
    ])
    
    # Scope restriction via system prompt
    # "You are agent '{name}'. Your private memory scope_id is '{name}'.
    #  You can read team memory with scope='team'.
    #  You can read/write task memory with scope='task', scope_id='{current_task_id}'."
    
    return tools
```

### Memory Access Matrix

| Scope | Agent can read | Agent can write |
|-------|---------------|-----------------|
| Own agent memory | ✅ | ✅ |
| Other agent memory | ❌ | ❌ |
| Team memory | ✅ | ✅ (if `memory_scope = "team"`) |
| Own task memory | ✅ | ✅ |
| Other task memory | ❌ | ❌ |

Access control is enforced in the command layer via AFD middleware, not the LLM prompt:

```python
from afd.middleware import compose_middleware
from afd.validation import validate_input_enhanced, UuidStr

# Memory access control as composable middleware
_memory_middleware = compose_middleware([
    _scope_access_control_middleware,  # Enforce agent/team/task scope rules
    _entry_size_limit_middleware,      # Reject entries exceeding max_entry_size_bytes
])

async def memory_set(key, value, scope, scope_id, tags):
    caller = get_calling_agent()  # From invocation context
    
    if scope == "agent" and scope_id != caller.name:
        return error("MEMORY_ACCESS_DENIED", 
                      f"Agent '{caller.name}' cannot write to agent '{scope_id}' memory",
                      suggestion=f"Use scope='agent' without scope_id to write to your own memory")
    
    if scope == "team" and caller.config.memory_scope != "team":
        return error("MEMORY_SCOPE_RESTRICTED",
                      f"Agent '{caller.name}' is not configured for team memory access",
                      suggestion="Ask an admin to set memory_scope='team' in agent config")
    ...
```

---

## Package Structure

Shipped as a standalone pip-installable plugin — **not** inside `src/botcore/`.

```
botcore-memory/
├── pyproject.toml                # entry-point: [project.entry-points."botcore.plugins"]
├── src/
│   └── botcore_memory/
│       ├── __init__.py               # BotCorePlugin implementation
│       ├── models.py                 # MemoryEntry dataclass
│       ├── store.py                  # MemoryStore ABC
│       ├── local_store.py            # JSON file backend (dev)
│       ├── cosmos_store.py           # Azure Cosmos DB backend (prod)
│       ├── access.py                 # Scope-based access control
│       └── commands.py               # memory_* commands
└── tests/
    └── ...
```

### Plugin Registration

```toml
# botcore-memory/pyproject.toml
[project]
name = "botcore-memory"
dependencies = ["botcore", "afd"]

[project.optional-dependencies]
cosmos = ["azure-cosmos", "azure-identity"]

[project.entry-points."botcore.plugins"]
memory = "botcore_memory:MemoryPlugin"
```

```python
# botcore_memory/__init__.py
from botcore.plugin import BotCorePlugin

class MemoryPlugin(BotCorePlugin):
    def register(self, registry):
        from .commands import MEMORY_COMMANDS
        registry.add_commands(MEMORY_COMMANDS)
        registry.set_mcp_name("memory")
        registry.add_docs("memory", MEMORY_DOCS)
```

---

## Phases

### Phase 1: Local Store + Core Commands

- [ ] Scaffold `botcore-memory` plugin package with `pyproject.toml` + entry-point
- [ ] `MemoryPlugin` implementing `BotCorePlugin.register()`
- [ ] `MemoryEntry` model
- [ ] `MemoryStore` interface
- [ ] `LocalMemoryStore` (JSON file backend)
- [ ] Commands: `memory_set`, `memory_get`, `memory_search`, `memory_delete`, `memory_list` (with AFD `PaginationParams`)
- [ ] Input validation using AFD `validate_input_enhanced()` for key format and value size
- [ ] Access control middleware using AFD `compose_middleware()`
- [ ] Config model (`MemoryConfig` in `BotCoreConfig`)
- [ ] Unit tests with local store
- [ ] JTBD scenario tests for memory lifecycle (using AFD Python `afd.testing` scenario runner)

**Acceptance criteria:**
- [ ] `memory_set(key="test", value="hello")` stores and `memory_get(key="test")` retrieves
- [ ] `memory_search(query="hello")` finds matching entries
- [ ] Scope isolation: agent A cannot read agent B's private memory
- [ ] Tests pass with local file store

### Phase 2: Team + Task Memory

- [ ] Team scope with shared read/write
- [ ] Task scope with TTL-based auto-cleanup
- [ ] `memory_share` convenience command
- [ ] `memory_import` for bulk seeding
- [ ] Access control enforcement (agent config `memory_scope`)

### Phase 3: Azure Cosmos DB Store

- [ ] `CosmosMemoryStore` implementation
- [ ] `DefaultAzureCredential` auth
- [ ] Partition key strategy: `/{scope}/{scope_id}`
- [ ] TTL on task-scoped documents
- [ ] Integration tests with Cosmos DB emulator

### Phase 4: Search Enhancement

- [ ] Tag-based filtering
- [ ] Key prefix hierarchy (`github/search-syntax`, `github/api-patterns`)
- [ ] Entry size limits and per-agent quotas
- [ ] Memory usage reporting command

---

## Security Model

| Threat | Mitigation |
|--------|-----------|
| Cross-agent memory access | Command-layer access control. Agent can only write own scope. |
| Unbounded memory growth | Per-agent entry limits + per-entry size limits in config. |
| Sensitive data in memory | Memory is plain text, no structured secrets. For credentials, use connector auth. |
| Task memory leakage | TTL-based auto-delete. Partition isolation in Cosmos DB. |
| Cosmos DB credential exposure | `DefaultAzureCredential` — managed identity in prod, no keys in config. |

---

## AFD Integration Summary

| AFD Module | Used For | Replaces |
|---|---|---|
| `afd.validation` | Input validation (`validate_input_enhanced`), `UuidStr` for entry IDs, `PaginationParams` for `memory_list` | Custom validators per command |
| `afd.middleware` | Access control middleware for scope enforcement + entry size limits | Inline scope checks in each command |
| `afd.telemetry` | `TelemetryEvent` for memory operation metrics | Custom logging |
| `afd.testing` | JTBD scenario tests for memory lifecycle | Ad-hoc pytest fixtures |

---

## Usage Patterns

### Agent Learning From Past Tasks

```
Agent: memory_search(query="biome lint", scope="agent")
→ Found: "Biome requires tab indentation. Use --write flag for auto-fix."

Agent: (applies learned knowledge to current task)
Agent: memory_set(key="biome/config-gotchas", value="When biome.json has 'useEditorConfig: true', .editorconfig takes precedence over biome settings.", scope="agent")
```

### Shared Team Knowledge

```
User (via Teams): "Remember: we use Conventional Commits for all repos"
Bot: memory_share(key="conventions/commits", value="Use Conventional Commits format. Types: feat, fix, docs, chore, refactor, test, ci.", tags=["conventions", "git"])
→ All agents can now access this convention
```

### Task Working State

```
Agent: memory_set(key="findings", value="Found 3 security issues in auth module...", scope="task", scope_id="task-abc123")
→ Available during task execution, auto-deleted 7 days after task completes
```
