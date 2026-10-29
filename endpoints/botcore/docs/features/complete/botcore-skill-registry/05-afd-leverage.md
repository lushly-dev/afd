# AFD Leverage

> Part of [Bot Core + Skill Registry Plan](./00-overview.md)

---

## What AFD Already Provides (Use, Don't Rebuild)

After deep research of AFD Python 0.2.0 and AFD TypeScript, these patterns directly apply:

### 1. SimpleRegistry → Module Registration Foundation

AFD's `SimpleRegistry` provides exactly the pattern modules need:

```python
# AFD SimpleRegistry today:
registry = SimpleRegistry()

@registry.command(name='hello', description='Say hello')
async def hello(name: str = 'World'):
    return success({'message': f'Hello, {name}!'})

client = DirectClient(registry)
result = await client.call('hello', {'name': 'Agent'})
```

**For bot core:** Each module registers its commands into a shared registry. The kernel
composes all module registries into one master registry. DirectClient provides
zero-overhead in-process execution for MCP tools calling module commands.

### 2. DirectClient → In-Process Module Execution

AFD's `DirectClient` (~0.1ms latency) is the execution engine for module commands:
- Zero transport overhead — no JSON-RPC, no IPC
- Input validation via `CommandParameter` definitions
- Unknown tool error with Levenshtein similarity suggestions ("Did you mean 'dev-lint'?")
- Trace ID propagation for debugging
- Pipeline execution built in

**For bot core:** The MCP server and CLI both use DirectClient to call module commands.
Modules don't need to know whether they're being called from CLI, MCP, or another command.

### 3. Pipeline → Command Composition

AFD's Pipeline system enables chaining module commands with variable resolution:

```python
result = await client.pipe([
    {'command': 'dev-lint', 'input': {'fix': True}, 'as': 'lint'},
    {'command': 'dev-test', 'input': {}, 'when': '$lint.success'},
    {'command': 'docs-check-changelog', 'input': {}},
])
```

**For bot core:** Quality gate commands (`botcore dev check`) become pipelines:
lint → test → check-size → check-coverage → check-changelog. Users can define
custom pipelines in config. Modules contribute pipeline steps by capability.

The pipeline.py `execute_pipeline()` function is standalone — takes a request and
an executor function. Bot core can use it directly:

```python
from afd.core.pipeline import execute_pipeline, PipelineRequest, PipelineStep

result = await execute_pipeline(request, master_registry.execute)
```

### 4. Bootstrap Commands → Ship with Kernel

AFD auto-adds three commands to every server:
- `afd-help` — list commands with tag filtering and category grouping
- `afd-docs` — generate markdown docs for all registered commands
- `afd-schema` — export JSON schemas

**For bot core:** These ship in the kernel, renamed to `botcore-help`, `botcore-docs`,
`botcore-schema`. They automatically reflect all loaded modules + plugins. When a new
module is installed, help/docs/schema immediately include it — zero config.

### 5. CommandResult → Universal Return Type

All modules return `CommandResult` from AFD. This is already decided — AFD is the
command framework, bot core is the opinionated bot built on it. Key fields:
- `success` / `data` / `error` (required)
- `confidence`, `reasoning` (recommended for agent consumption)
- `warnings`, `suggestions` (for interactive feedback)

Proto's raw dict returns need migration to `success()` / `error()`.

### 6. What's in TypeScript But Not Python (Port Candidates)

| Feature | TS Location | Python gap | Priority for bot core |
|---------|-------------|------------|----------------------|
| **ExposeOptions** | `core/types.ts` | Missing | Medium — controls which surfaces see a command (`{palette, mcp, agent, cli}`) |
| **Middleware** | `server/middleware/` | Missing | Low — bot core modules are simpler than full MCP servers |
| **Batch execution** | `core/types.ts` | Missing | Low — modules rarely need batch |
| **JTBD testing** | `testing/` | Missing | Medium — great for module integration tests |
| **Connectors** | `core/platform/connectors/` | Missing | Low — GitHub/PM connectors are convenience wrappers |

**Recommendation:** Port `ExposeOptions` to Python. A module command that only makes
sense in CLI shouldn't clutter the MCP tool list. The other features can wait.

---

## AFD Patterns NOT to Use

- **Full Pydantic pipeline types** — the typed condition system ($exists, $eq, $gt, etc.)
  is powerful but over-engineered for bot core's use case. DirectClient's simpler
  `pipe()` with string conditions (`'$prev.success'`) is sufficient.
- **Transport layer** — bot core uses FastMCP directly, not AFD's MCP transport.
  AFD's transport is designed for the TS/Rust/Python polyglot case. Bot core is Python-only.
