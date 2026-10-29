# MCP Tool Architecture (run Pattern)

> Part of [Bot Core + Skill Registry Plan](./00-overview.md)

---

## The Problem with Individual Tools

Exposing every command as a separate MCP tool fails at scale:
- 50+ tool definitions bloat the context window
- Agents hallucinate tool names or pick the wrong tool from large lists
- Every new command requires MCP schema changes + client restart
- Tool descriptions must be terse to fit, losing useful guidance

---

## Battle-Tested Solution: 3-4 Meta-Tools

All three current bots converge on the same pattern — a small set of meta-tools
that provide discovery + execution. This is locked in as a kernel feature:

| Tool | Purpose | Description |
|------|---------|-------------|
| `{name}-start` | Discovery | Workflows, version, active sessions, what can I do? |
| `{name}-docs` | Reference | CLI/function documentation by topic |
| `{name}-run` | Execution | Run code with all functions available in scope |
| `{name}-research` | Research | Web research with Gemini + Google grounding (optional) |

Where `{name}` comes from the plugin's `set_mcp_name()`:
- lushbot → `lushx-start`, `lushx-docs`, `lushx-run`, `lushx-research`
- proto → `proto-start`, `proto-docs`, `proto-run`, `proto-research`
- fabux → `fabux-start`, `fabux-docs`, `fabux-run`

**Research is optional** — only registers if `botcore-research` module is installed.
Minimum deployment is 3 tools.

### Why This Works

1. **Low tool count** — agents handle 3-4 tools reliably. No hallucinated tool names.
2. **Context efficient** — 4 rich tool descriptions < 50 terse ones.
3. **Functions evolve freely** — install a new module, its commands are immediately
   available through `{name}-run`. No MCP schema change, no client restart.
4. **Self-documenting** — `{name}-docs topic='dev'` gives the agent full reference
   for just the topic it needs, on demand.

---

## Tool Contracts

### `{name}-start`

Returns structured JSON with:
- Available workflows (from plugins)
- Active sessions (if any)
- Bot version + installed modules
- Quick-start guidance

This is the first tool an agent calls. It orients.

### `{name}-docs`

Takes a `topic` parameter. Returns CLI/function documentation for that topic.
Topics map to module categories: `dev`, `docs`, `spec`, `cdp`, `skills`, `research`, etc.

Modules register their docs via:
```python
registry.add_docs("dev", """
## Dev Commands

### lint
Run linter for the detected language.
...
""")
```

The kernel auto-generates a topic index from all registered docs. Calling with
no topic returns the index.

### `{name}-run`

Executes Python code with all module functions available in scope. The kernel builds
the execution namespace by collecting exported functions from all loaded modules:

```python
# Agent sends:
{name}-run code='result = await dev_lint(fix=True)'

# Kernel builds namespace:
namespace = {
    'dev_lint': modules['ruff'].lint_command,
    'dev_test': modules['pytest'].test_command,
    'dev_check_size': core.check_size,
    'skill_seed': core.skill_seed,
    # ... all module functions
}
exec(code, namespace)
```

Key details:
- All functions are async — `await` required
- Output auto-truncated via `smart_truncate()` (~8000 chars for MCP context budget)
- Errors return structured CommandResult with suggestions
- `help()` and `list_functions()` available in namespace for discoverability

### `{name}-research` (optional)

Gemini + Google Search grounding. Two modes:
- `fast` — quick answer with sources
- `deep` — thorough analysis with multiple searches

Only available when `botcore-research` module is installed.

---

## How Modules Contribute to Tools

Modules don't create their own MCP tools. They register commands and docs — the
kernel composes them into the 3-4 meta-tools:

```python
class BiomeModule(ModuleContract):
    def register(self, registry: ModuleRegistry):
        # Commands available via {name}-run
        registry.add_commands([self.lint_cmd, self.format_cmd])

        # Docs available via {name}-docs topic='dev'
        registry.add_docs("dev", self.dev_docs)

        # Capabilities for dispatch
        registry.register_capability("lint", self.lint_cmd, language="typescript")
```

Plugins can add extra MCP tools beyond the standard 4 only if they have a genuine
need (e.g., a streaming tool). This is the escape hatch, not the norm.

---

## Migration from Current Names

| Current | New |
|---------|-----|
| `lushx-entry-tool` | `lushx-start` |
| `lushx-cli-docs` | `lushx-docs` |
| `lushx-execute` | `lushx-run` |
| `lushx-research` | `lushx-research` (unchanged) |
| `mcp_proto_execute` | `proto-run` |
| `mcp_proto_docs` | `proto-docs` |
| `mcp_proto_status` | `proto-start` |
| `nexus_execute` | `nexus-run` (if applicable) |
| `nexus_docs` | `nexus-docs` (if applicable) |

> **Note:** Nexus rename rows are speculative — Nexus is a separate project owned by
> the fabric-ux-system repo and may not adopt botcore's naming convention. Included
> for completeness only. Remove if Nexus stays independent.

**MCP config files to update during migration:**
- `.cursor/mcp.json` (Cursor)
- `claude_desktop_config.json` (Claude Desktop)
- `.vscode/mcp.json` (VS Code)
- `mcp.json` at project root (generic MCP)

Tool name changes are breaking for consumers — coordinate with a version bump.

---

## Security Boundary: Local/Internal Only

**The `run` tool is `exec()` — remote code execution by design.** This pattern is
appropriate for:

- **Local MCP servers** (stdio transport) — the agent runs on your machine, you are
  the only user. The attack surface is yourself.
- **Internal servers with corporate auth** — SSO/Entra login + audit logging creates
  accountability. Every execution is tied to an identity. Abuse is traceable.

**This pattern must NOT be used for externally hosted, public-facing MCP servers.**
An exposed `run` endpoint is an open invitation for arbitrary code execution attacks,
regardless of input validation or sandboxing attempts.

For external/public MCP servers, the correct pattern is **individual tool exposure** —
each command is a separate MCP tool with its own schema and input validation. The agent
can only call predefined operations, not execute arbitrary code. This is the standard
MCP model and what `afd-server`'s `createMcpServer()` already does.

```
┌─────────────────────────────────────────────────────────────────┐
│  Deployment model        │  Tool pattern       │  Why           │
├──────────────────────────┼─────────────────────┼────────────────┤
│  stdio (local agent)     │  run pattern (3-4)  │  You are the   │
│                          │                     │  only user     │
├──────────────────────────┼─────────────────────┼────────────────┤
│  Internal server +       │  run pattern (3-4)  │  Auth + audit  │
│  corporate auth          │                     │  = accountable │
├──────────────────────────┼─────────────────────┼────────────────┤
│  External / public       │  Individual tools   │  No exec(),    │
│  server                  │  (1 per command)    │  schema-only   │
└─────────────────────────────────────────────────────────────────┘
```

The kernel should make this easy to switch. Config flag:

```toml
[tool.botcore.mcp]
mode = "run"            # "run" (meta-tools) or "individual" (1 tool per command)
```

Default is `"run"` for local/stdio. Modules register the same commands either way —
the kernel decides how to surface them on MCP based on mode.

---

## Sandbox Reference: Nexus Execute Pattern

The Nexus KB server (`fabric-ux-system/kb-tooling`) already ships a production `run`
pattern with lightweight security. This is the reference implementation for bot core's
`{name}-run` tool when deployed on internal servers with auth.

**Security principle:** *"Trackable, recoverable, proportionate."* The sandbox prevents
accidents and casual misuse by authenticated employees — not determined insider attacks.
Every execution is identity-tracked via Entra OID.

### Three-Layer Defense

1. **AST validation** (parse-time) — walks the code AST before execution:
   - Import allowlist (`ALLOWED_IMPORTS`) — only safe stdlib modules (json, re, math,
     datetime, collections, itertools, functools, textwrap, string, pprint, typing).
     Blocks os, subprocess, pathlib, asyncio, sys, shutil, socket.
   - Blocked dunder attributes (`_BLOCKED_ATTRIBUTES`) — `__subclasses__`, `__globals__`,
     `__builtins__`, `__import__`, `__code__`, `__dict__`, etc. Prevents sandbox escapes.
   - Blocks `exec()`/`eval()`/`compile()` calls in user code.
   - Blocks `getattr()` with blocked attribute name literals.
   - Blocks `__import__()` with non-literal args.
   - Code length cap (8000 chars).

2. **Restricted builtins** (runtime) — exec namespace gets a curated safe dict:
   - Removed: `open`, `eval`, `exec`, `compile`, `__import__`, `globals`, `vars`,
     `breakpoint`, `input` (DoS via stdin block).
   - Kept: types, iteration helpers, string/repr, math, print, exceptions, `locals`.
   - Custom `__import__` wrapper re-checks the allowlist at runtime (dual layer).

3. **Auth at gateway** (architecture) — Python backend has NO auth on internal endpoints.
   Auth is handled by the .NET Entra gateway. Backend runs with `backendExternalIngress=false`
   (no public network access). Every request carries the caller's OID for audit.

### Audit Logging

Every `nexus_execute` call logs to Cosmos DB:
- Caller OID, code preview (first 500 chars — never full code), code length, duration
- Result status: `success`, `policy_violation`, `syntax_error`, `error`
- Code hash (SHA-256, first 12 chars) for correlation without secret leakage

### What Bot Core Should Adopt

| Nexus pattern | Bot core equivalent | Priority |
|---|---|---|
| `ALLOWED_IMPORTS` allowlist | Module-declared import allowlist (each module declares safe imports for its namespace) | P0 — ship with first internal deployment |
| AST validation | Shared `validate_code()` in kernel, modules can extend blocked patterns | P0 |
| Restricted builtins dict | Reusable `build_safe_builtins()` in kernel | P0 |
| Dual-layer import guard | Same pattern — AST + runtime `__import__` wrapper | P0 |
| Cosmos audit logging | Pluggable audit sink (Cosmos, SQLite, file, none) | P1 |
| Entra gateway auth | Out of scope for kernel — deployment concern, not code | — |
| Path traversal guard (`is_relative_to`) | Any file-access commands must use this pattern | P0 |
| Code length cap | Configurable in `[tool.botcore.mcp]` section | P1 |

### Key Design Decision: Module-Scoped Allowlists

Each module declares what imports it needs in its namespace:

```python
class ResearchModule(ModuleContract):
    def allowed_imports(self) -> set[str]:
        return {"json", "re", "textwrap", "datetime"}

class BiomeModule(ModuleContract):
    def allowed_imports(self) -> set[str]:
        return set()  # No execute namespace needed — runs subprocess only
```

The kernel merges all module allowlists into the master `ALLOWED_IMPORTS` for the
`run` tool. Modules that don't need an execute namespace return empty set and their
commands are still callable — they just can't be composed with arbitrary code.

### Known Limitations (Accept and Document)

From Nexus experience:
- Computed getattr strings (`getattr(t, '__sub'+'classes__')`) bypass literal AST checks.
  Restricted builtins limit blast radius.
- Not all reflection paths are coverable. The security model is identity + audit, not
  perfect sandboxing.
- `asyncio` must be excluded from allowlist despite being useful — it exposes
  `create_subprocess_shell`/`create_subprocess_exec` which bypass all builtins restrictions.
