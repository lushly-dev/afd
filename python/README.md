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
    name="todo-create",
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
    name="todo-create",
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
    @mock_server.command("todo-create")
    async def handler(input):
        from afd import success
        return success({"id": "1", "title": input["title"]})

    result = await mock_server.execute("todo-create", {"title": "Test"})

    data = assert_success(result)
    assert data["title"] == "Test"
```

### Testing Helpers

Execute and validate commands with automatic timing and error wrapping:

```python
from afd.testing import test_command, create_mock_command, create_test_context

# Run a handler with timing + validation
result = await test_command(my_handler, {"title": "Test"})
assert result.is_success
assert result.execution_time_ms >= 0

# Create mock commands for testing dependencies
cmd = create_mock_command("user-get", lambda inp: {"id": inp["id"]})
result = await cmd.handler({"id": 1}, None)
assert result.success

# Batch-test with expectations
from afd.testing import test_command_multiple

results = await test_command_multiple(my_handler, [
    {"input": {"title": "OK"}, "expect_success": True},
    {"input": {}, "expect_success": False, "expect_error": "VALIDATION_ERROR"},
])
assert all(r["passed"] for r in results)
```

### Validators

Non-throwing validators return a `ValidationResult` for programmatic use:

```python
from afd.testing import validate_result, validate_error, validate_command_definition

vr = validate_result(result)
assert vr.valid
assert len(vr.errors) == 0

# Validate with stricter options
from afd.testing import ResultValidationOptions
vr = validate_result(result, ResultValidationOptions(require_confidence=True))
for warning in vr.warnings:
    print(f"{warning.path}: {warning.message}")
```

### Additional Assertions

```python
from afd.testing import (
    assert_has_suggestion,   # Error includes recovery suggestion
    assert_retryable,        # Error retryable flag matches
    assert_step_status,      # Plan step has expected status
    assert_ai_result,        # Composite: confidence + reasoning + optional sources
)

# Validate error quality
error_result = error("NOT_FOUND", "Missing", suggestion="Check ID")
assert_has_suggestion(error_result)
assert_retryable(error_result, expected=False)

# Validate AI command output
ai_result = success(data, confidence=0.95, reasoning="Computed from input")
assert_ai_result(ai_result, min_confidence=0.9)
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

### Telemetry

Track command execution with standardized telemetry events:

```python
from afd import create_telemetry_event, ConsoleTelemetrySink

# Create an event from execution data
event = create_telemetry_event(
    command_name="todo-create",
    started_at="2024-01-15T10:30:00.000Z",
    completed_at="2024-01-15T10:30:00.150Z",
    success=True,
    trace_id="trace-abc123",
)
# duration_ms is auto-calculated: 150.0

# Log to console (text or JSON format)
sink = ConsoleTelemetrySink(format="json")
sink.record(event)

# Implement a custom sink
class MyMonitoringSink:
    def record(self, event):
        send_to_monitoring(event.model_dump(exclude_none=True))

    def flush(self):
        pass
```

### Middleware

Add cross-cutting concerns to command execution:

```python
from afd.server import (
    default_middleware,
    compose_middleware,
    create_logging_middleware,
    create_timing_middleware,
    create_retry_middleware,
)

# Zero-config: logging, timing, and auto trace ID
middleware = default_middleware()

# Or compose custom middleware stacks
middleware = compose_middleware([
    create_logging_middleware(),
    create_timing_middleware(threshold_ms=500),
    create_retry_middleware(max_retries=3),
])
```

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

## Handoff Connections

Connect to streaming protocols (WebSocket, SSE) returned by handoff commands:

```bash
# Install with client dependencies
pip install afd[client]
```

```python
from afd import (
    connect_handoff,
    create_reconnecting_handoff,
    register_builtin_handlers,
    HandoffConnectionOptions,
    ReconnectionOptions,
)
from afd.core.handoff import is_handoff

# Register built-in WebSocket and SSE handlers
register_builtin_handlers()

# Connect to a handoff result
result = await client.call('chat-connect', {'room_id': 'room-123'})

if result.success and is_handoff(result.data):
    # Simple connection
    conn = await connect_handoff(result.data, HandoffConnectionOptions(
        on_message=lambda msg: print('Message:', msg),
    ))

    # Or with auto-reconnect
    conn = await create_reconnecting_handoff(client, result.data,
        ReconnectionOptions(
            reconnect_command='chat-reconnect',
            session_id=result.data.get('credentials', {}).get('session_id'),
            on_reconnect=lambda n: print(f'Reconnecting (attempt {n})'),
        ),
    )
```

## Packages

| Extra       | Contents                                                             |
| ----------- | -------------------------------------------------------------------- |
| (core)      | `CommandResult`, `success()`, `error()`, error types, metadata types |
| `[server]`  | MCP server factory, `@define_command`, `create_server()`             |
| `[client]`  | `McpClient`, SSE/HTTP transports, handoff connection handlers       |
| `[cli]`     | Click-based CLI for connecting to MCP servers                        |
| `[testing]` | Assertions, helpers, validators, scenario runner, `mock_server` fixture |

## Related

- [AFD TypeScript](../packages/) - Original TypeScript implementation
- [AFD Philosophy](../.claude/skills/afd-developer/references/philosophy.md) - Why AFD?
- [Command Schema Guide](../.claude/skills/afd/references/command-schema.md) - Designing commands

## License

MIT
