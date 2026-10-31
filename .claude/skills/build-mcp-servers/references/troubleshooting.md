# MCP Server Troubleshooting

Common issues and solutions for MCP server development.

## Connection Issues

### Server Not Starting (VS Code)

**Symptom:** MCP server shows in the tools panel but stays "not started" or errors on start.

**Check:**

1. **`type` field is present** — VS Code requires `"type": "stdio"` in `.vscode/mcp.json`.
   Without it, the server silently fails to start:

   ```json
   {
     "servers": {
       "my-server": {
         "type": "stdio",
         "command": "uv",
         "args": ["run", "python", "-m", "mypackage"]
       }
     }
   }
   ```

2. **`cwd` points to the right project** — for consumer projects that live outside
   the botcore repo, `cwd` must point to the consumer project's root (where the
   venv with botcore is installed), not the workspace folder:

   ```json
   "cwd": "D:\\Github\\my-org\\my-bot"
   ```

3. **Build-system is defined** — without `[build-system]` in `pyproject.toml`,
   `uv sync` installs dependencies but NOT the project itself, so
   `python -m mypackage` fails with `ModuleNotFoundError`.

4. **Local deps have `[tool.uv.sources]`** — if the project depends on
   `botcore-agents`, `botcore-llm`, etc. (unpublished packages), they need
   local path references or `uv sync` fails with "package not found".

5. Module loads without errors:

   ```bash
   cd /path/to/my-bot
   uv run python -c "from mypackage.__main__ import main; print('OK')"
   ```

### Server Not Starting (Claude Code)

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

### Client Crashes on Large or Complex Schemas

**Symptom:** Agent terminates when the MCP server is active. Observed on earlier Claude model versions; re-test on the current one before working around it.

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

### Silent Tool Failures on One Model

**Symptom:** Specific tools return "Sorry, no response was returned" or silently fail on one client and model, while other tools on the same server work, and other models call the same tools successfully.

**Root cause (as observed on earlier Claude model versions):** the client failed to construct tool-call parameters for certain Pydantic model schemas. This is NOT about:

- Tool count (other tools work fine)
- Output size (compact responses still fail)
- Server errors (server logs show no request received)

**Diagnosis:**

1. Test the failing tool with another model or client -- if it works, the schema, not the server, is the problem
2. Check if the tool input uses Pydantic models with `Literal`, `EntityType` enums, or `dict[str, Any]` fields
3. Simpler tools (no input or basic `str` params) on the same server work
4. Re-test on the current model version before adding a workaround: the failures recorded here were observed on earlier versions and may not reproduce

**Fix: Add an execute tool (once the failure reproduces)**

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

**Why it works:** models write Python fluently; the failure was in structured tool-call parameter construction, not in reasoning about the operation. A simple `code: str` schema bypasses the parsing entirely.

**Production examples:**

- `lushx-execute` in lushbot (27 functions, 4 MCP tools total)
- `nexus-execute` in kb-tooling (search, graph_stats, graph_query, etc.)

**Keep original tools:** Do not remove the structured tools -- other clients call them directly. The execute tool is a compatibility fallback, not a replacement, and should be re-tested on each model update.

## Output Issues

### Truncated Results

**Symptom:** Tool output ends with "..." -- or, for a tool returning JSON, fails to parse

**Check:** Is output exceeding the budget?

```python
result = run_command(cmd)
if result["truncated"]:
    ...  # the payload was clipped
```

**If the tool returns structured data, do not raise the budget -- remove it.**
Truncated JSON is not shorter JSON, it is a decode error:

```python
run_command(cmd, max_output=None)
```

**For prose output, raise the budget:**

```python
run_command(cmd, max_output=250_000)
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
