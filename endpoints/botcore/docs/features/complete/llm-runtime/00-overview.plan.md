# Plan: LLM Runtime — Copilot SDK Integration

> **Status:** Complete
> **Date:** 2026-02-25
> **Updated:** 2026-02-25 — AFD Python parity integration
> **Scope:** Copilot SDK wrapper as separate botcore plugin package (`botcore-llm`), bridging botcore commands to LLM tool calling
> **Depends on:** botcore core (commands, plugins, config, MCP server factory), `afd` Python package (middleware, telemetry, streaming, validation)

---

## Summary

Add LLM conversation capabilities to botcore by wrapping the **GitHub Copilot SDK** (Python). Each LLM session gets a `CopilotClient` → `CopilotSession` backed by Copilot CLI, with botcore commands automatically bridged as Copilot tools. The team has unlimited inference through Copilot and Copilot CLI, making the CLI dependency an advantage rather than a constraint.

This is the foundational layer that the agent orchestration, connectors, and Teams interface features build on.

---

## Architecture

```
botcore command namespace
    ↓ auto-bridge
Copilot SDK tools (per session)
    ↓ JSON-RPC (stdio/TCP)
Copilot CLI (server mode)
    ↓
LLM providers (GPT-4o, Claude, Gemini — via Copilot)
```

### Core Concept: The Command-Tool Bridge

Every botcore `CommandResult`-returning function can be exposed as a Copilot SDK tool. The bridge converts:

- **Input:** Copilot tool args → botcore command parameters (validated by Pydantic)
- **Output:** `CommandResult` → Copilot `ToolResultObject` (success/failure + text for LLM)
- **Errors:** `CommandResult.error.suggestion` → included in LLM result text (recovery hints)

```python
def botcore_command_to_copilot_tool(command: Callable) -> Tool:
    """Auto-convert any botcore command into a Copilot SDK tool."""
    return define_tool(
        name=command.__name__,
        description=command.__doc__,
        parameters=extract_schema(command),
        handler=lambda args, inv: _bridge_handler(command, args)
    )

async def _bridge_handler(command, args):
    result = await command(**args)
    return {
        "textResultForLlm": json.dumps(
            result.data if result.success else {
                "error": result.error.code,
                "message": result.error.message,
                "suggestion": result.error.suggestion,
            }
        ),
        "resultType": "success" if result.success else "failure",
    }
```

### AFD Middleware Integration

The bridge wraps each tool call in AFD's composable middleware stack, reusing the Python `afd` package's built-in middleware rather than hand-rolling observability:

```python
from afd.middleware import compose_middleware, default_middleware
from afd.telemetry import TelemetrySink, create_telemetry_event

# Bridge middleware stack — applied to every tool invocation
_bridge_middleware = compose_middleware([
    *default_middleware(),           # auto trace ID + logging + timing
    _cost_tracking_middleware,       # Per-session token budget (see Phase 3)
    _permission_gate_middleware,     # Deny shell/filesystem
])
```

This replaces the hand-rolled `onPreToolUse` / `onPostToolUse` hooks from the original design with AFD's middleware protocol, which already provides trace ID propagation, structured logging, and slow-command warnings.

### Command Prerequisites

Bridged tools emit `requires` metadata (from AFD's `CommandDefinition.requires` field) so agents can reason about command ordering at discovery time:

```python
def botcore_command_to_copilot_tool(command: Callable) -> Tool:
    tool = define_tool(...)
    # Emit requires metadata for agent planning
    if hasattr(command, '_requires'):
        tool._meta = {"requires": command._requires}
    return tool
```

### Streaming via AFD

The `llm_chat` streaming mode uses AFD's `execute_stream()` async generator and `StreamChunk` discriminated union for progressive response delivery:

```python
from afd.streaming import execute_stream, StreamChunk

async def llm_chat_stream(session_id: str, message: str):
    async for chunk in execute_stream(session, message):
        match chunk:
            case StreamChunk(type="delta"):    yield chunk.content
            case StreamChunk(type="tool_use"): yield chunk.tool_name
            case StreamChunk(type="done"):     break
```

### Session Management

```python
# New botcore commands
async def llm_session_create(
    model: str = "gpt-4.1",
    tools: list[str] | None = None,     # Command names to expose as tools
    system_prompt: str | None = None,
    streaming: bool = True,
) -> CommandResult[dict]:
    """Create a new Copilot SDK session with bridged botcore tools."""

async def llm_chat(
    session_id: str,
    message: str,
    attachments: list[dict] | None = None,
) -> CommandResult[dict]:
    """Send a message to an active LLM session."""

async def llm_session_list() -> CommandResult[list[dict]]:
    """List active LLM sessions with status and model info."""

async def llm_session_destroy(session_id: str) -> CommandResult[dict]:
    """Destroy an LLM session and clean up resources."""

async def llm_model_list() -> CommandResult[list[dict]]:
    """List available models from Copilot CLI."""
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Copilot SDK, not raw API clients** | Team has unlimited Copilot inference. SDK handles tool calling loop, context management, streaming, session persistence. |
| **Bridge pattern, not dual registration** | Commands defined once (botcore), automatically available as LLM tools. No duplication. |
| **Permission gate denies shell/filesystem by default** | OpenClaw lesson: 30+ exec bypass GHSAs. Agents call typed commands, never raw shell. |
| **Session-scoped tool exposure** | Each session declares which commands are available. Agents can't call commands outside their scope. |
| **Infinite sessions enabled by default** | Copilot SDK handles compaction at 80%/95% thresholds. Agents remember across interactions. |
| **`CommandResult.error.suggestion` in LLM text** | Recovery hints flow to the LLM, enabling self-correction without human intervention. |
| **AFD middleware for bridge hooks** | Reuse AFD Python `compose_middleware()` + `default_middleware()` rather than hand-rolling trace ID, logging, and timing. Reduces custom code and ensures consistency with AFD's observability patterns. |
| **AFD telemetry for cost tracking** | `TelemetrySink` protocol from AFD provides the interface for Phase 3 cost tracking without coupling to a specific backend. |
| **AFD `execute_stream()` for chat** | Reuse AFD's `StreamChunk` discriminated union and async generator pattern for `llm_chat` streaming mode, avoiding a custom streaming implementation. |
| **Command `requires` for agent planning** | AFD's `requires` field on `CommandDefinition` lets agents discover tool ordering dependencies at MCP tool listing time. Bridge emits `_meta.requires` on each tool. |

---

## Configuration

```toml
# botcore.toml
[llm]
default_model = "gpt-4.1"
cli_url = ""                          # Empty = auto-spawn CLI
streaming = true
infinite_sessions = true

[llm.permissions]
allow_shell = false                    # Never
allow_filesystem = false               # Use connectors instead
allow_mcp = true                       # MCP servers are typed
allow_custom_tools = true              # Botcore bridged commands

[llm.cost]
warn_tokens_per_session = 100000       # Warning threshold
max_tokens_per_session = 500000        # Hard limit (0 = unlimited)
```

---

## Package Structure

Shipped as a standalone pip-installable plugin — **not** inside `src/botcore/`.

```
botcore-llm/
├── pyproject.toml                # entry-point: [project.entry-points."botcore.plugins"]
├── src/
│   └── botcore_llm/
│       ├── __init__.py           # BotCorePlugin implementation
│       ├── client.py             # CopilotClient lifecycle (singleton)
│       ├── bridge.py             # Command → Tool bridge + AFD middleware stack
│       ├── session.py            # Session registry + management
│       ├── permissions.py        # Permission gate middleware (AFD middleware protocol)
│       ├── telemetry.py          # TelemetrySink implementation for cost tracking
│       └── commands.py           # llm_session_create, llm_chat, etc.
└── tests/
    ├── scenarios/                # JTBD scenario files (AFD scenario runner)
    └── ...
```

### Plugin Registration

```toml
# botcore-llm/pyproject.toml
[project]
name = "botcore-llm"
dependencies = ["botcore", "copilot-sdk", "afd"]

[project.entry-points."botcore.plugins"]
llm = "botcore_llm:LlmPlugin"
```

```python
# botcore_llm/__init__.py
from botcore.plugin import BotCorePlugin

class LlmPlugin(BotCorePlugin):
    def register(self, registry):
        from .commands import LLM_COMMANDS
        registry.add_commands(LLM_COMMANDS)
        registry.set_mcp_name("llm")
        registry.add_docs("llm", LLM_DOCS)
```

---

## Phases

### Phase 1: Client + Bridge Foundation

- [ ] Scaffold `botcore-llm` plugin package with `pyproject.toml` + entry-point
- [ ] `LlmPlugin` implementing `BotCorePlugin.register()`
- [ ] `CopilotClient` wrapper with lifecycle management (start/stop)
- [ ] Command-to-tool bridge (`botcore_command_to_copilot_tool`)
- [ ] Bridge middleware stack using AFD `compose_middleware()` + `default_middleware()`
- [ ] Permission gate as AFD middleware (deny shell + filesystem)
- [ ] `llm_session_create` / `llm_session_destroy` commands
- [ ] Config model (`LlmConfig` in `BotCoreConfig`)
- [ ] Unit tests with mock Copilot client
- [ ] JTBD scenario tests for session lifecycle (using AFD Python `afd.testing` scenario runner)

**Acceptance criteria:**
- [ ] `llm_session_create(model="gpt-4.1", tools=["info_workspace"])` returns session ID
- [ ] Bridged tool calls go through botcore command, return `CommandResult`-based tool result
- [ ] Shell/filesystem permission requests are denied
- [ ] Bridge middleware emits trace IDs and structured logs for each tool invocation
- [ ] Tests pass without real Copilot CLI (mocked)

### Phase 2: Chat + Streaming

- [ ] `llm_chat` command with `sendAndWait` and streaming modes
- [ ] Streaming via AFD `execute_stream()` async generator + `StreamChunk` discriminated union
- [ ] Event forwarding (delta → progress updates)
- [ ] `llm_session_list` and `llm_model_list` commands
- [ ] Infinite session configuration
- [ ] Integration test with real Copilot CLI (optional, CI-gated)

### Phase 3: Telemetry + Cost Tracking

- [ ] Implement `TelemetrySink` (from AFD `afd.telemetry`) for cost tracking backend
- [ ] Cost tracking middleware emitting `TelemetryEvent` per tool invocation with token counts
- [ ] Audit logging via AFD's structured logging middleware (already in bridge stack)
- [ ] Retry middleware using AFD's built-in retry middleware with configurable backoff
- [ ] Token usage reporting per session (aggregate from `TelemetryEvent` stream)
- [ ] Budget enforcement (warn + hard limit)

---

## Security Model

| Threat | Mitigation |
|--------|-----------|
| Shell execution via tool call | Permission gate denies all shell requests |
| Filesystem access | Permission gate denies; use connector commands instead |
| Prompt injection blast radius | Session-scoped tools — agent can only call declared commands |
| Cost runaway | Per-session token budget with warn + hard limit |
| Credential exposure | Copilot CLI handles auth; no tokens in botcore config |

---

## Dependencies

- `copilot-sdk` (Python) — Copilot SDK client
- `afd` (Python) — Middleware stack (`compose_middleware`, `default_middleware`), telemetry (`TelemetrySink`, `TelemetryEvent`), streaming (`execute_stream`, `StreamChunk`), validation (`validate_input`), testing (`afd.testing` scenario runner)
- Copilot CLI — installed on host, reachable via stdio or TCP
- `botcore` — commands, config, plugin system (pip dependency)

Consumers install via: `pip install botcore-llm` (pulls in `botcore` + `copilot-sdk` + `afd`). Existing botcore users who don't need LLM capabilities are unaffected — no new deps in the core package.

---

## AFD Integration Summary

| AFD Module | Used For | Replaces |
|---|---|---|
| `afd.middleware` | Bridge middleware stack (trace ID, logging, timing, permission gate) | Hand-rolled `onPreToolUse` / `onPostToolUse` hooks |
| `afd.telemetry` | Cost tracking backend interface (`TelemetrySink`) | Custom token counting hooks |
| `afd.streaming` | `llm_chat` streaming mode (`execute_stream`, `StreamChunk`) | Custom event forwarding |
| `afd.validation` | Input validation for bridged tool args | Custom Pydantic extraction |
| `afd.testing` | JTBD scenario tests for session lifecycle | Ad-hoc pytest fixtures |
