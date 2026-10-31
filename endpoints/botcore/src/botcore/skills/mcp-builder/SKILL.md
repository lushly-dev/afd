---
name: mcp-builder
source: botcore
description: >
  Guides construction of MCP servers using FastMCP 2.x with emphasis on
  measuring the tools/list payload, consolidating tools, bounding prose output
  without truncating structured output, and the execute pattern as a
  re-testable fallback for clients that mishandle complex schemas. Covers async
  subprocess patterns, output budgets, and action-based tool design. Use when
  creating MCP servers, debugging tool overload or context overflow, measuring
  token usage, diagnosing silent tool-call failures, or consolidating tools.
  Triggers: MCP, FastMCP, tool schema, token limit, context overflow, MCP
  server, execute pattern, tool consolidation.
version: 1.2.0
triggers:
  - MCP
  - FastMCP
  - tool schema
  - token limit
  - context overflow
  - MCP server
  - execute pattern
  - tool consolidation
portable: true
---

# Building MCP Servers

Expert guidance for building MCP servers with FastMCP 2.x that work reliably with Claude and other LLM clients.

## Capabilities

1. **FastMCP 2.x Server Setup** -- Modern async MCP server scaffolding with stdio and SSE transports
2. **Token Budget Management** -- Measure what the server costs a client per request and keep it small
3. **Tool Consolidation** -- Reduce tool count using action-based and provider-based patterns
4. **Output Bounding** -- Bound prose output; never truncate structured output
5. **Execute Pattern** -- A single `code: str` tool as a fallback for clients that mishandle complex schemas
6. **Async Subprocess** -- Non-blocking command execution with timeout and stdin isolation
7. **Troubleshooting** -- Diagnose connection failures, context overflow, and platform-specific issues

## Routing Logic

| Request type | Load reference |
|---|---|
| FastMCP setup, transports, resources, testing | [references/fastmcp-patterns.md](references/fastmcp-patterns.md) |
| Token budgets, description optimization, consolidation strategies | [references/token-budget.md](references/token-budget.md) |
| Debugging, Windows issues, CLI handoff, silent failures | [references/troubleshooting.md](references/troubleshooting.md) |

## Core Principles

### 1. Measure the `tools/list` Payload and Keep It Small

Every tool's name, description and input schema is sent to the client on `tools/list` and sits in the model's context for the whole session. The cost is the serialized payload, not the tool count, so measure it instead of aiming at a fixed number:

```python
import json
from fastmcp import Client

async with Client(mcp) as client:
    tools = await client.list_tools()
payload = json.dumps([tool.model_dump() for tool in tools])
print(f"tools/list is about {len(payload) // 4:,} tokens")
```

Record the number next to the tool list in the README, re-measure when tools change, and compare it with what the deployment can afford: a server that is one of many a session loads should cost a small fraction of the total, and Claude Code's `/doctor` reports per-server totals. When the payload grows, consolidate related operations behind one tool with an `action` parameter and move reference text out of descriptions into a docs tool:

```python
# GOOD: 1 consolidated tool
@mcp.tool(name="dev", description="Dev tools. Actions: lint, test, build.")
async def dev(action: str, params: dict = None) -> str:
    if action == "lint": ...
    elif action == "test": ...
    elif action == "build": ...
```

### 2. Write Descriptions That Earn Their Tokens

A description is loaded into context on every request. Say what the tool does and how to call it; put reference material, examples and option catalogs behind a docs tool or a resource. Measure the total (Principle 1) rather than policing each description against a fixed count.

```python
# BAD: reference text in the description
description="""Consolidated development tools for the monorepo.
Actions: lint, test, build. Params: {"package": "...", "fix": bool}
Example: {"action": "lint", "params": {"package": "core"}}"""

# GOOD: purpose and call shape only
description="""Dev tools. Actions: lint, test, build.
Params: {"package": "...", "fix": bool}"""
```

### 3. Bound Prose Outputs -- Never Truncate Structured Ones

Unbounded output consumes context that a long-running agent cannot get back. Bound
it -- but only where truncation *degrades* the result instead of destroying it.

Truncating log or diff text yields shorter log or diff text. Truncating JSON,
NDJSON, or any structured payload yields an unparseable string: the caller does not
get less data, it gets a decode error. Never apply a character budget to a tool
whose contract is "returns structured data."

```python
MAX_OUTPUT_LENGTH = 100_000  # ~25k tokens -- generous, still bounded

def truncate_output(output: str, max_length: int = MAX_OUTPUT_LENGTH) -> str:
    if len(output) <= max_length:
        return output
    truncated = output[:max_length]
    last_newline = truncated.rfind('\n')
    if last_newline > max_length * 0.8:
        truncated = truncated[:last_newline]
    return truncated + "\n\n... (truncated for token safety)"
```

Use `run_command(..., max_output=None)` for structured payloads, and always surface
the returned `truncated` flag so a clipped result is diagnosable rather than silent.
Botcore's `smart_truncate()` keeps the head and the tail of a stream, 40% and 60% of
the budget, so the summary at the top and the verdict at the bottom both survive.

> A budget bounds runaway output; it is not a context limit to fit. The old
> 8,000-character default was sized for small-context models, and the cost of
> corrupting a structured payload exceeds the cost of a larger read.

### 4. Consider the Execute Pattern -- Re-test Before Relying on It

Some client and model combinations have failed silently on tools whose parameters are complex Pydantic or JSON Schema structures (nested objects, enums, `dict[str, Any]`) while simpler tools on the same server worked. An execute tool with a single `code: str` parameter sidesteps structured parameter construction entirely:

```python
@mcp.tool()
async def my_execute(code: str) -> dict:
    """[Execute] Run Python with server functions available.
    Functions: search(query, top=5), graph_stats(). All async.
    Example: `results = await search("button"); print(results)`
    """
    import io
    from contextlib import redirect_stdout, redirect_stderr

    stdout_buf, stderr_buf = io.StringIO(), io.StringIO()
    namespace = _NAMESPACE.copy()

    with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
        if "await " in code:
            wrapped = "async def __main__():\n"
            wrapped += "\n".join(f"    {line}" for line in code.split("\n"))
            wrapped += "\n    return locals()"
            exec(compile(wrapped, "<execute>", "exec"), namespace)
            result_locals = await namespace["__main__"]()
            namespace.update(result_locals)
        else:
            exec(compile(code, "<execute>", "exec"), namespace)

    return {"stdout": stdout_buf.getvalue(), "stderr": stderr_buf.getvalue()}
```

**When to add it:** after reproducing the failure on the client and model you target, and re-tested on each model update. The failures recorded in the troubleshooting reference were observed on earlier model versions and may not reproduce on current ones. It is an option, not a rule: keep the structured tools, which other clients call directly, and treat the execute tool as a fallback and as a power-user surface (botcore's `{name}-run`).

### 5. Always Use Async Subprocess with stdin=DEVNULL

Sync subprocess blocks MCP heartbeats. On Windows, stdin inheritance causes deadlock with the MCP stdio transport.

```python
process = await asyncio.create_subprocess_exec(
    *cmd,
    stdin=asyncio.subprocess.DEVNULL,   # CRITICAL: prevents Windows deadlock
    stdout=asyncio.subprocess.PIPE,
    stderr=asyncio.subprocess.PIPE,
)
stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=300)
```

## Quick Reference

### Budgets to Measure

| Component | What to measure | Guidance |
|---|---|---|
| `tools/list` payload | Serialized names, descriptions and schemas; ~4 chars per token | Measure per release; keep it a small fraction of what the session can afford |
| Single tool description | Characters | Purpose and call shape only; reference text goes behind a docs tool |
| Prose output | Characters per response | Bound with `MAX_OUTPUT_LENGTH` (100,000 chars by default, ~25,000 tokens) and surface the `truncated` flag |
| Structured output | Nothing to bound | Never truncated: `max_output=None` |
| Research output | Characters per answer | `research_stream(..., max_length=...)`, 100,000 chars by default |
| Tool count | The payload, not the count | Consolidate when the payload grows, not at a fixed number |

### Minimal FastMCP 2.x Server

```python
from fastmcp import FastMCP

mcp = FastMCP("my-server", instructions="Brief description.")

@mcp.tool(name="my-tool", description="Concise description: purpose and call shape.")
async def my_tool(action: str) -> str:
    return "SUCCESS\n\nResult here"

def run_server():
    mcp.run()  # stdio transport (default)
```

### Consistent Return Format

```python
# Success
return "SUCCESS\n\nOutput here..."

# Failure
return "FAILED\nError: reason\n\nPartial output..."
```

### VS Code MCP Configuration

In `.vscode/mcp.json` (workspace-level):

```json
{
  "servers": {
    "my-server": {
      "type": "stdio",
      "command": "uv",
      "args": ["run", "python", "-m", "mypackage.mcp_server"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

**Critical fields:**
- `"type": "stdio"` — **required** by VS Code. Without it, the server silently fails to start.
- `"cwd"` — must point to the project that owns the venv with botcore installed.
  For consumer projects in a different repo, use an absolute path:
  ```json
  "cwd": "D:\\Github\\my-org\\my-bot"
  ```
- Use `uv run` (not bare `python`) to ensure the project's venv is activated.

For cross-workspace MCP servers (e.g., a bot defined in repo A, used from repo B),
add the server config to repo B's `.vscode/mcp.json` with `cwd` pointing to repo A.

### Claude Code Configuration

In `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "python",
      "args": ["-m", "mypackage.mcp_server"]
    }
  }
}
```

## Checklist

Before shipping an MCP server, verify:

- [ ] `tools/list` payload measured and recorded; re-measured when tools change
- [ ] Descriptions state purpose and call shape; reference text lives behind a docs tool
- [ ] Prose outputs bounded by `MAX_OUTPUT_LENGTH`; structured outputs use `max_output=None`
- [ ] All subprocess calls use `asyncio.create_subprocess_exec`
- [ ] All subprocess calls set `stdin=asyncio.subprocess.DEVNULL`
- [ ] Execute tool added only after reproducing a structured-schema failure on the target client, and re-tested on model updates
- [ ] Return format uses `SUCCESS`/`FAILED` prefix consistently
- [ ] FastMCP pinned to `>=2.13.0,<3`

## When to Escalate

- Context overflow persists despite following all guidelines above
- Need to expose 20+ distinct operations that resist consolidation
- Integration with non-Python MCP clients or SDKs
- Real-time streaming requirements beyond stdio/SSE
- Tool-call failures that persist on a target client even with the execute pattern
