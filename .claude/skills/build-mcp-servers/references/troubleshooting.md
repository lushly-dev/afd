# MCP Server Troubleshooting

Common issues and solutions for MCP server development.

## Connection Issues

### Server Not Starting

**Symptom:** MCP server does not appear in Claude Code

**Check:**

1. Module loads without errors:

   ```bash
   python -c "from mypackage.mcp_server import mcp; print('OK')"
   ```

2. Configuration path is correct:

   ```json
   {
     "command": "python",
     "args": ["-m", "mypackage.mcp_server"]
   }
   ```

3. Use absolute paths for Python interpreter:
   ```json
   {
     "command": "/path/to/.venv/bin/python",
     "args": ["-m", "mypackage.mcp_server"]
   }
   ```

### Timeout on Tool Calls

**Symptom:** Tools hang or timeout

**Causes:**

1. Sync subprocess blocking event loop
2. Long-running commands without timeout
3. **stdin conflicts with MCP transport** (critical on Windows)

**Fix:**

```python
process = await asyncio.create_subprocess_exec(
    *cmd,
    stdin=asyncio.subprocess.DEVNULL,  # CRITICAL: Prevent stdin deadlock
    stdout=asyncio.subprocess.PIPE,
    stderr=asyncio.subprocess.PIPE,
)

try:
    stdout, stderr = await asyncio.wait_for(
        process.communicate(),
        timeout=300  # 5 minute timeout
    )
except asyncio.TimeoutError:
    process.kill()
    return "FAILED\nCommand timed out"
```

> **Critical:** Without `stdin=DEVNULL`, subprocesses on Windows will inherit the MCP server's stdin, which is used by the JSON-RPC transport. This causes a deadlock where both the MCP host and the child process are waiting to read from the same stream.

## Context Overflow

### "Context low" Warning

**Symptom:** `/compact` warning appears immediately

**Diagnosis:**

```bash
/doctor
```

Look for "Large MCP tools context" in output.

**Solutions:**

1. Reduce tool descriptions (see [token-budget.md](token-budget.md))
2. Consolidate tools with action parameters
3. Disable unused MCP servers

### Claude Opus 4.5/4.6 Crashes

**Symptom:** Agent terminates when MCP server is active

**Common culprits:**

- Tools with complex JSON schemas (nested objects, arrays)
- Tools with large enum types
- Open-ended `Dict[str, Any]` parameters

**Fix:** Simplify parameter types:

```python
# Risky: Complex nested schema
def tool(config: Dict[str, Dict[str, Any]]): ...

# Safer: Simple parameters
def tool(action: str, target: str = None): ...
```

### Claude Opus Silent Tool Failures

**Symptom:** Specific tools return "Sorry, no response was returned" or silently fail, while other tools on the same server work perfectly. Gemini and GPT call the same tools successfully.

**Root cause:** Opus has issues with certain Pydantic model schemas during tool-call serialization. This is NOT about:

- Tool count (other tools work fine)
- Output size (compact responses still fail)
- Server errors (server logs show no request received)

**Diagnosis:**

1. Test the failing tool with Gemini -- if it works, it is an Opus issue
2. Check if the tool input uses Pydantic models with `Literal`, `EntityType` enums, or `dict[str, Any]` fields
3. Simpler tools (no input or basic `str` params) on the same server work

**Fix: Add an execute tool (recommended)**

Add a code-execution tool with a single `code: str` parameter that exposes the failing functionality through async wrapper functions:

```python
@mcp.tool()
async def my_execute(code: str) -> dict:
    """[Execute] Run code with functions: search(query), graph_stats().
    All async. Example: `r = await search("topic"); print(r)`
    """
    # See SKILL.md "Execute Pattern" for full implementation
    ...
```

**Why it works:** Opus writes Python fluently. The issue is in structured tool-call parameter construction, not in the model's ability to reason about the operation. A simple `code: str` schema bypasses the parsing entirely.

**Production examples:**

- `lushx-execute` in lushbot (27 functions, 4 MCP tools total)
- `nexus-execute` in kb-tooling (search, graph_stats, graph_query, etc.)

**Keep original tools:** Do not remove the structured tools -- they work fine for Gemini, GPT, and other models. The execute tool is an Opus compatibility layer, not a replacement.

## Output Issues

### Truncated Results

**Symptom:** Tool output ends with "..."

**Check:** Is output exceeding limits?

```python
MAX_OUTPUT_LENGTH = 8000

if len(output) > MAX_OUTPUT_LENGTH:
    output = output[:MAX_OUTPUT_LENGTH] + "\n... (truncated)"
```

**Increase limit if needed:**

```bash
export MAX_MCP_OUTPUT_TOKENS=50000
```

### Missing Output

**Symptom:** Tool returns but output is empty

**Check:**

1. Capturing both stdout and stderr
2. Decoding with error handling:
   ```python
   output = stdout.decode("utf-8", errors="replace")
   ```

## Windows-Specific Issues

### Subprocess Fails

**Symptom:** `create_subprocess_exec` fails on Windows

**Fix:** Use full paths and proper executable:

```python
import sys
cmd = [sys.executable, "-m", "mypackage.cli", "command"]
```

### Path Separators

**Symptom:** Path not found errors

**Fix:** Use `pathlib` for cross-platform paths:

```python
from pathlib import Path
workspace = Path(__file__).parent / "data"
```

### Rich/Terminal Output Pollution

**Symptom:** Tool output contains terminal escape codes or `rich` formatting

**Fix:** Pass an environment variable to silence terminal output:

```python
# In mcp_server.py
env = os.environ.copy()
env["LUSHBOT_MCP"] = "1"  # Signal to child processes

process = await asyncio.create_subprocess_exec(
    *cmd,
    env=env,
    ...
)
```

```python
# In cli.py
import os
from rich.console import Console

console = Console(force_terminal=False if os.getenv("LUSHBOT_MCP") else None)
```

### Workspace Detection Fails

**Symptom:** "Workspace not found" when running tools

**Cause:** MCP server CWD might differ from expected workspace location.

**Fix:** Add resilient workspace detection:

```python
from pathlib import Path

ws = find_workspace()  # Start from CWD

if not ws:
    # Fallback: Check sibling directories relative to this file
    sibling = Path(__file__).resolve().parents[3] / "lushly"
    if (sibling / "pnpm-workspace.yaml").exists():
        ws = sibling
```

## Debugging Tips

### Enable Verbose Logging

```python
import sys

# Print diagnostics to stderr (not captured by MCP transport)
print(f"Executing: {cmd}", file=sys.stderr)
```

### Test Without MCP

Run the CLI directly to isolate issues:

```bash
python -m mypackage.cli command --agent
```

### Check Environment Variables

```python
import os

api_key = os.environ.get("MY_API_KEY")
if not api_key:
    return "FAILED\nMY_API_KEY environment variable not set"
```

## FastMCP-Specific

### Event Loop Conflicts

**Symptom:** `RuntimeError: This event loop is already running`

**Cause:** Calling `asyncio.run()` inside FastMCP

**Fix:** FastMCP's `run()` handles its own event loop:

```python
def run_server():
    # DON'T do this:
    # asyncio.run(mcp.run())

    # DO this:
    mcp.run()
```

### Version Conflicts

**Symptom:** Import errors or unexpected behavior

**Fix:** Pin FastMCP version:

```toml
dependencies = [
    "fastmcp>=2.13.0,<3",
]
```

## CLI Handoff Pattern

Some operations do not work well via MCP subprocess calls:

- **GitHub CLI (`gh`)** -- Prompts for auth, conflicts with stdin
- **Git operations** -- Interactive prompts, credential managers
- **Long-running tasks** -- Minutes of execution with no progress feedback
- **Interactive commands** -- Anything that requires user input

### Pattern: MCP Tracks, CLI Executes

1. **MCP tracks state** (pure Python, safe):

   ```python
   save_history("spec.sync", {
       "created_issues": [42, 43, 44],
   })
   ```

2. **MCP returns CLI instructions**:

   ```python
   return (
       "SUCCESS\n\n"
       "Rollback available. Run in terminal:\n"
       "  gh issue close 42 43 44"
   )
   ```

3. **Agent tells user to run CLI command** or runs it via the IDE terminal.

### When to Use This Pattern

| Operation | MCP Safe? | Use Handoff? |
|---|---|---|
| Read files | Yes | No |
| Run pnpm/npm | Yes | No |
| Call `gh` CLI | No | Yes |
| Interactive git | No | Yes |
| Long polling (>2min) | Maybe | Consider |
