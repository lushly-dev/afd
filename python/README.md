# AFD - Agent-First Development for Python

A Python toolkit for building applications with the Agent-First Development methodology.

## What is AFD?

**Agent-First Development** is a software development methodology where AI agents are treated as first-class users from day one. Instead of building UI first and adding API/agent access later, AFD inverts this:

```
Traditional:  UI → API → Agent Access (afterthought)
Agent-First:  Commands → Validation → UI (surface)
```

## Installation

```bash
# Core types only
pip install afd

# With MCP server support
pip install afd[server]

# With MCP client (network transports)
pip install afd[client]

# With CLI
pip install afd[cli]

# With testing utilities
pip install afd[testing]

# Everything
pip install afd[all]
```

## Quick Start

### Define a Command

```python
from afd import CommandResult, success, error
from afd.server import define_command
from pydantic import BaseModel

class Todo(BaseModel):
    id: str
    title: str
    done: bool = False

@define_command(
    name="todo.create",
    description="Create a new todo item",
)
async def create_todo(title: str) -> CommandResult[Todo]:
    todo = Todo(id="todo-1", title=title)
    return success(
        data=todo,
        reasoning="Created new todo with default status",
    )
```

### Create an MCP Server

```python
from afd.server import create_server

server = create_server(
    name="todo-app",
    version="1.0.0",
)

@server.command(
    name="todo.create",
    description="Create a todo",
)
async def create_todo(input):
    todo = Todo(id="todo-1", title=input["title"])
    return success(data=todo)

# Run the server (stdio for VS Code/Cursor)
server.run()
```

### Test Your Commands

```python
import pytest
from afd.testing import assert_success

# Use the mock_server fixture
async def test_create_todo(mock_server):
    @mock_server.command("todo.create")
    async def handler(input):
        from afd import success
        return success({"id": "1", "title": input["title"]})

    result = await mock_server.execute("todo.create", {"title": "Test"})

    data = assert_success(result)
    assert data["title"] == "Test"
```

## Core Types

### CommandResult

The standard return type for all commands:

```python
from afd import CommandResult, success, error

# Successful result
result = success(
    data={"id": "123"},
    reasoning="Created successfully",
    confidence=0.95,
)

# Error result
result = error(
    code="NOT_FOUND",
    message="Resource not found",
    suggestion="Check the ID and try again",
)
```

### UX-Enabling Fields

AFD results include optional fields that enable rich agent experiences:

| Field          | Purpose                                |
| -------------- | -------------------------------------- |
| `confidence`   | 0-1 score for UI confidence indicators |
| `reasoning`    | Explains "why" for transparency        |
| `sources`      | Attribution for verification           |
| `plan`         | Multi-step operation visibility        |
| `alternatives` | Other options considered               |
| `warnings`     | Non-fatal issues to surface            |

## MCP Client (Network)

Connect to remote MCP servers over SSE or HTTP:

```python
from afd import McpClient, McpClientConfig, create_client

# Quick setup
client = create_client("http://localhost:3100/sse")
await client.connect()

# Call a command (returns CommandResult)
result = await client.call("todo-create", {"title": "Hello"})
print(result.data)

# Raw tool call (no CommandResult wrapping)
raw = await client.call_tool("ping", {})

# Batch execution
batch_result = await client.batch([
    {"name": "todo-create", "input": {"title": "First"}},
    {"name": "todo-create", "input": {"title": "Second"}},
])

# Pipeline
pipe_result = await client.pipe([
    {"command": "user-get", "input": {"id": 1}, "as": "user"},
    {"command": "order-list", "input": {"user_id": "$user.id"}},
])

# Stream results
async for chunk in client.stream("long-task", {"query": "..."}):
    print(chunk)

await client.disconnect()
```

Use transports directly for lower-level control:

```python
from afd.transports import SseTransport, HttpTransport, create_transport

transport = create_transport("sse", "http://localhost:3100/sse")
await transport.connect()
result = await transport.call_tool("ping", {})
await transport.disconnect()
```

## Packages

| Extra       | Contents                                                             |
| ----------- | -------------------------------------------------------------------- |
| (core)      | `CommandResult`, `success()`, `error()`, error types, metadata types |
| `[server]`  | MCP server factory, `@define_command`, `create_server()`             |
| `[client]`  | `McpClient`, SSE/HTTP transports for remote MCP servers              |
| `[cli]`     | Click-based CLI for connecting to MCP servers                        |
| `[testing]` | `mock_server` fixture, assertions, `MockTransport`                   |

## Related

- [AFD TypeScript](../packages/) - Original TypeScript implementation
- [AFD Philosophy](../.claude/skills/afd-developer/references/philosophy.md) - Why AFD?
- [Command Schema Guide](../.claude/skills/afd/references/command-schema.md) - Designing commands

## License

MIT
