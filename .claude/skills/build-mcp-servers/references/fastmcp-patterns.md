# FastMCP 2.x Patterns

Best practices for building MCP servers with FastMCP 2.x (Prefect).

## Installation

```bash
pip install "fastmcp>=2.13.0,<3"
```

Pin to v2 to avoid breaking changes when v3 releases.

## Server Transports

### stdio (Recommended for Claude Code)

```python
from fastmcp import FastMCP

mcp = FastMCP("my-server", instructions="Brief description.")

@mcp.tool(name="my-tool")
async def my_tool(query: str) -> str:
    return "Result"

if __name__ == "__main__":
    mcp.run()  # Default: stdio transport
```

### SSE (For web dashboards)

```python
mcp.run(transport="sse", host="127.0.0.1", port=8765)
```

## Tool Patterns

### Action-Based Consolidation

Reduce tool count by accepting an `action` parameter:

```python
@mcp.tool(
    name="dev",
    description="Dev tools. Actions: lint, test, build."
)
async def dev(action: str, params: dict = None) -> str:
    if action not in ["lint", "test", "build"]:
        return f"FAILED\nUnknown action: {action}"

    # Dispatch to appropriate handler
    return await run_action(action, params)
```

### Consistent Return Format

Always return strings with clear status:

```python
# Success
return "SUCCESS\n\nOutput here..."

# Failure
return "FAILED\nError: reason\n\nPartial output..."
```

### Async Subprocess Execution

```python
import asyncio
import sys

async def run_command(cmd: list[str], timeout: int = 300) -> dict:
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=timeout
        )
    except asyncio.TimeoutError:
        process.kill()
        return {"success": False, "error": "Timeout"}

    return {
        "success": process.returncode == 0,
        "output": stdout.decode("utf-8", errors="replace"),
        "error": stderr.decode("utf-8", errors="replace"),
    }
```

## Resources (Optional)

Expose read-only data:

```python
@mcp.resource("config://settings")
def get_settings() -> str:
    return json.dumps({"version": "1.0"})
```

## Testing

Use FastMCP's built-in client:

```python
from fastmcp import Client

async def test_server():
    async with Client(mcp) as client:
        result = await client.call_tool("dev", {"action": "lint"})
        assert "SUCCESS" in result
```

## Configuration for Claude Code

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

## Version Compatibility

| FastMCP | MCP SDK | Notes |
|---------|---------|-------|
| 2.13+ | <1.23 | Pinned for stability |
| 2.14+ | 1.23+ | Updated protocol support |
| 3.0 | TBD | Breaking changes expected |
