# MCP Server Factory Reference

## Overview

The server factory in `botcore/server.py` creates fully-configured MCP servers using the **meta-tool pattern**: instead of exposing every command as a separate MCP tool (which would blow token budgets), it creates 3-4 meta-tools that act as dispatchers.

## build_namespace()

```python
def build_namespace(extra_commands=None) -> tuple[dict, PluginRegistry]:
```

Combines botcore's core commands with plugin-contributed commands into a single namespace dict.

**Parameters:**
- `extra_commands` — Optional list of additional command functions to include

**Returns:**
- `namespace_dict` — `{command_name: callable}` mapping all available commands
- `plugin_registry` — The populated `PluginRegistry` from plugin discovery

**Behavior:**
1. Discovers all installed plugins via `discover_plugins()`
2. Creates a `PluginRegistry` and calls `register()` on each plugin
3. Collects botcore core commands + plugin commands + extra commands
4. Returns the combined namespace and registry

## build_docs()

```python
def build_docs(registry, extra_docs=None) -> dict[str, str]:
```

Merges core botcore docs with plugin-registered docs and optional extra docs.

**Parameters:**
- `registry` — The `PluginRegistry` from `build_namespace()`
- `extra_docs` — Optional `dict[str, str]` of additional documentation sections

**Returns:** Combined `{topic: content}` dictionary

## create_mcp_server()

```python
def create_mcp_server(
    name: str,
    version: str = "0.1.0",
    description: str | None = None,
    include_research: bool = False,
    extra_commands: list | None = None,
    extra_docs: list | None = None,
) -> FastMCP:
```

Factory that creates a complete MCP server with the meta-tool pattern.

### Meta-Tools Created

| Tool | Purpose | Description |
|---|---|---|
| `{name}-start` | Orientation | Returns full command reference docs. Call first to learn available commands. |
| `{name}-docs` | Deep docs | Returns documentation for a specific topic section. |
| `{name}-run` | Command execution | Executes any command by name with arguments as a Python code block. |
| `{name}-research` | Web research | *(Optional)* Searches the web. Only created when `include_research=True`. |

### The Meta-Tool Pattern

Instead of:
```
tool: dev_lint()
tool: dev_test()
tool: dev_build()
... 40+ individual tools
```

The server exposes:
```
tool: my-start   → "What commands are available?"
tool: my-docs    → "Tell me about the dev commands"
tool: my-run     → "Execute dev_lint()"
```

This keeps the MCP tool count under 5, saving thousands of tokens in tool descriptions.

### {name}-run Code Validation

The `run` tool accepts a Python code string and validates it before execution:

- Maximum 8000 characters
- Must be valid Python (parsed via `ast.parse`)
- Executed against the command namespace — all registered commands are available as globals
- Returns the command's `CommandResult`

Example call:
```python
# Client sends to {name}-run:
result = await dev_lint()
```

### Usage Example

```python
from botcore.server import create_mcp_server

# In your plugin's MCP entry point:
server = create_mcp_server(
    name="my-plugin",
    version="0.1.0",
    description="My plugin's MCP server",
    include_research=False,
)

# Run with: python -m my_plugin.mcp
server.run()
```

### With Extra Commands

```python
from botcore.server import create_mcp_server

async def my_custom_command(x: int) -> CommandResult[dict]:
    """Custom command not registered via plugin."""
    return success({"doubled": x * 2})

server = create_mcp_server(
    name="my-server",
    extra_commands=[my_custom_command],
)
```

## Architecture Diagram

```
pyproject.toml entry points
        │
        ▼
discover_plugins()
        │
        ▼
build_namespace()  ──→  {command_name: callable}
        │
        ▼
create_mcp_server()
        │
        ├──→  {name}-start  (returns full docs)
        ├──→  {name}-docs   (returns topic docs)
        ├──→  {name}-run    (executes commands)
        └──→  {name}-research (optional web search)
```

## Key Source

All factory logic is in `botcore/server.py`. The internal `_validate_code()` function checks code blocks before execution.
