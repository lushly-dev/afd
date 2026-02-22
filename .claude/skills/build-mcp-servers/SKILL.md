---
name: build-mcp-servers
source: botcore
description: >
  Guides construction of MCP servers using FastMCP 2.x with emphasis on token budget management, tool consolidation, output truncation, and the execute pattern for Opus compatibility. Covers async subprocess patterns, safe output limits, and action-based tool design. Use when creating MCP servers, debugging tool overload or context overflow, optimizing token usage, fixing Opus silent failures, or consolidating tools. Triggers: MCP, FastMCP, tool schema, token limit, context overflow, MCP server, execute pattern, tool consolidation.

version: 1.0.0
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

Expert guidance for building MCP servers with FastMCP 2.x that work reliably with Claude and other LLMs.

## Capabilities

1. **FastMCP 2.x Server Setup** -- Modern async MCP server scaffolding with stdio and SSE transports
2. **Token Budget Management** -- Prevent context overflow and model crashes with safe limits
3. **Tool Consolidation** -- Reduce tool count using action-based and provider-based patterns
4. **Output Truncation** -- Enforce safe character limits on all tool outputs
5. **Execute Pattern** -- Code-execution tool that bypasses Opus schema incompatibilities
6. **Async Subprocess** -- Non-blocking command execution with timeout and stdin isolation
7. **Troubleshooting** -- Diagnose connection failures, context overflow, and platform-specific issues

## Routing Logic

| Request type | Load reference |
|---|---|
| FastMCP setup, transports, resources, testing | [references/fastmcp-patterns.md](references/fastmcp-patterns.md) |
| Token budgets, description optimization, consolidation strategies | [references/token-budget.md](references/token-budget.md) |
| Debugging, Windows issues, CLI handoff, silent failures | [references/troubleshooting.md](references/troubleshooting.md) |

## Core Principles

### 1. Keep Tool Count Under 10

LLMs struggle when presented with 10-20+ tools. Consolidate related operations behind a single tool using an `action` parameter.

```python
# GOOD: 1 consolidated tool
@mcp.tool(name="dev", description="Dev tools. Actions: lint, test, build.")
async def dev(action: str, params: dict = None) -> str:
    if action == "lint": ...
    elif action == "test": ...
    elif action == "build": ...
```

### 2. Keep Descriptions Under 50 Tokens Each

Tool descriptions are loaded into context on every request. Target less than 500 tokens total across all tools, under 50 per tool.

```python
# BAD (~100 tokens)
description="""Consolidated development tools for the monorepo.
Actions: lint, test, build. Params: {"package": "...", "fix": bool}
Example: {"action": "lint", "params": {"package": "core"}}"""

# GOOD (~30 tokens)
description="""Dev tools. Actions: lint, test, build.
Params: {"package": "...", "fix": bool}"""
```

### 3. Truncate All Outputs

Large outputs crash Opus 4.5 and consume excessive context. Enforce a hard limit.

```python
MAX_OUTPUT_LENGTH = 8000  # ~2000 tokens

def truncate_output(output: str, max_length: int = 8000) -> str:
    if len(output) <= max_length:
        return output
    truncated = output[:max_length]
    last_newline = truncated.rfind('\n')
    if last_newline > max_length * 0.8:
        truncated = truncated[:last_newline]
    return truncated + "\n\n... (truncated for token safety)"
```

### 4. Use the Execute Pattern for Opus Compatibility

Claude Opus can silently fail on tools with complex Pydantic/JSON Schema parameters while simpler tools on the same server work fine. The fix: expose an execute tool with a single `code: str` parameter.

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

**Why it works:** The schema is trivially simple (`code: str`). Opus writes Python fluently -- it is the structured parameter serialization that fails. Keep original tools for Gemini/GPT compatibility.

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

### Safe Token Budgets

| Component | Limit | Reasoning |
|---|---|---|
| Tool descriptions (total) | <500 tokens | Loaded on every request |
| Single tool description | <50 tokens | Keep concise |
| Command output | 8,000 chars | ~2,000 tokens |
| Research output | 12,000 chars | ~3,000 tokens, still safe |
| Tool count | <10 tools | LLMs degrade above 10-20 |

### Minimal FastMCP 2.x Server

```python
from fastmcp import FastMCP

mcp = FastMCP("my-server", instructions="Brief description.")

@mcp.tool(name="my-tool", description="Concise description under 50 tokens.")
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

- [ ] Tool count is under 10 (`@mcp.tool` decorator count)
- [ ] Total description tokens under 500 (estimate ~4 chars per token)
- [ ] All outputs truncated with `MAX_OUTPUT_LENGTH`
- [ ] All subprocess calls use `asyncio.create_subprocess_exec`
- [ ] All subprocess calls set `stdin=asyncio.subprocess.DEVNULL`
- [ ] Execute tool added if any tools fail silently on Opus
- [ ] Return format uses `SUCCESS`/`FAILED` prefix consistently
- [ ] FastMCP pinned to `>=2.13.0,<3`

## When to Escalate

- Context overflow persists despite following all guidelines above
- Need to expose 20+ distinct operations that resist consolidation
- Integration with non-Python MCP clients or SDKs
- Real-time streaming requirements beyond stdio/SSE
- Opus failures that persist even with the execute pattern
