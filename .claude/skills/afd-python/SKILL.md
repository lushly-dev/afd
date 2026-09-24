---
name: afd-python
description: >
  Python implementation patterns for AFD commands using Pydantic models,
  afd package, and FastMCP. Covers command definition with decorators,
  schema design, error handling, MCP server setup, and testing. Use when:
  implementing commands in Python, setting up Python MCP servers, writing
  Pydantic models, or debugging Python AFD code.
  Triggers: python afd, py command, pydantic model, @server.command,
  python implementation, fastmcp, afd python.
---

# AFD Python Implementation

Patterns for implementing AFD commands in Python.

## Parity Rule

Python implementations SHOULD match the shared AFD capability set and agent-visible behavior, while keeping Pythonic APIs and Pydantic-friendly data models where that better fits the language.

- Core command surfaces MUST stay framework-agnostic.
- React or browser integrations SHOULD stay in examples or separate ecosystem layers.
- Cross-language parity does NOT require a 1:1 port of TypeScript helper names or module boundaries.

## Command Metadata Parity

Python command definitions now carry the same planning and discovery metadata that agents see in the TypeScript surface.

- Use `output_schema=` to declare the response shape. It is exported as `returns` and surfaced through MCP `_meta.outputSchema`.
- Use `requires=` for planning-order dependencies. This is metadata only and is not enforced at runtime.
- Use `contexts=` to scope commands to named contexts.
- Use `examples=` with concrete payloads. Examples are validated against the input model at decoration time.
- Use `category=` when grouped tools should use a stable explicit group name instead of the first kebab-case segment.

```python
from pydantic import BaseModel, Field
from afd import CommandResult, success
from afd.server import create_server


class DraftInput(BaseModel):
    title: str = Field(..., min_length=1)


class DraftOutput(BaseModel):
    id: str


server = create_server("docs", tool_strategy="lazy")


@server.command(
    name="doc-create",
    description="Create a draft document",
    category="docs",
    input_schema=DraftInput,
    output_schema=DraftOutput,
    mutation=True,
    requires=["workspace-open"],
    contexts=["editing"],
    examples=[{"title": "Basic draft", "input": {"title": "Q2 plan"}}],
)
async def create_doc(input: DraftInput) -> CommandResult[DraftOutput]:
    return success(DraftOutput(id="doc-1"), reasoning="Created draft document")
```

## Package Imports

```python
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime
import uuid

from afd import success, error, CommandResult
from afd.server import create_server, MCPServer
```

## Command Definition

### Basic Command with Decorator

```python
from pydantic import BaseModel, Field
from afd import success, error, CommandResult
from afd.server import create_server

# Create server
server = create_server(
    name="my-app",
    version="1.0.0",
    description="My AFD application",
)

# Define input model
class CreateTodoInput(BaseModel):
    """Input for creating a todo."""
    title: str = Field(..., description="Todo title", min_length=1, max_length=200)
    description: Optional[str] = Field(None, description="Optional description")
    priority: str = Field("medium", description="Priority: low, medium, high")


class CreateTodoOutput(BaseModel):
    id: str
    title: str
    priority: str

# Define command
@server.command(
    name="todo-create",
    description="Create a new todo item",
    category="todo",
    input_schema=CreateTodoInput,
    output_schema=CreateTodoOutput,
    requires=["workspace-open"],
    contexts=["editing"],
    examples=[{"title": "Basic todo", "input": {"title": "Buy milk"}}],
    mutation=True
)
async def create_todo(input: CreateTodoInput) -> CommandResult[CreateTodoOutput]:
    if input.priority not in ["low", "medium", "high"]:
        return error(
            code="INVALID_PRIORITY",
            message=f"Invalid priority: {input.priority}",
            suggestion="Use 'low', 'medium', or 'high'"
        )

    todo = CreateTodoOutput(
        id=str(uuid.uuid4())[:8],
        title=input.title,
        priority=input.priority,
    )
    todos[todo.id] = todo

    return success(
        data=todo,
        reasoning=f"Created todo '{todo.title}' with {input.priority} priority"
    )
```

### Command with Query Parameters

```python
class ListTodosInput(BaseModel):
    """Input for listing todos."""
    completed: Optional[bool] = None
    priority: Optional[str] = None
    search: Optional[str] = None
    limit: int = Field(20, ge=1, le=100)
    offset: int = Field(0, ge=0)


class TodoSummary(BaseModel):
    id: str
    title: str
    priority: str


class ListTodosOutput(BaseModel):
    todos: List[TodoSummary]
    total: int
    has_more: bool

@server.command(
    name="todo-list",
    description="List all todo items with optional filtering",
    category="todo",
    input_schema=ListTodosInput,
    output_schema=ListTodosOutput,
    examples=[{"title": "High priority", "input": {"priority": "high", "limit": 10}}],
)
async def list_todos(input: ListTodosInput) -> CommandResult[ListTodosOutput]:
    items = list(todos.values())

    # Apply filters
    if input.completed is not None:
        items = [t for t in items if t.completed == input.completed]
    if input.priority:
        items = [t for t in items if t.priority == input.priority]
    if input.search:
        s = input.search.lower()
        items = [t for t in items if s in t.title.lower()]

    total = len(items)
    items = items[input.offset : input.offset + input.limit]

    return success(
        data=ListTodosOutput(
            todos=[TodoSummary(id=t.id, title=t.title, priority=t.priority) for t in items],
            total=total,
            has_more=total > input.offset + input.limit,
        ),
        reasoning=f"Found {total} todo(s)"
    )
```

## Pydantic Model Patterns

### Domain Models

```python
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional

class Todo(BaseModel):
    """A todo item."""
    id: str
    title: str
    description: Optional[str] = None
    completed: bool = False
    priority: str = "medium"
    createdAt: str = Field(
        default_factory=lambda: datetime.utcnow().isoformat() + "Z"
    )
    updatedAt: str = Field(
        default_factory=lambda: datetime.utcnow().isoformat() + "Z"
    )
    completedAt: Optional[str] = None
```

### Input Models with Validation

```python
from pydantic import BaseModel, Field, field_validator
from typing import Optional, List

class CreateTodoInput(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=1000)
    priority: str = Field("medium")
    tags: List[str] = Field(default_factory=list, max_length=10)

    @field_validator('priority')
    @classmethod
    def validate_priority(cls, v: str) -> str:
        allowed = ['low', 'medium', 'high']
        if v not in allowed:
            raise ValueError(f"Priority must be one of {allowed}")
        return v

    @field_validator('tags')
    @classmethod
    def validate_tags(cls, v: List[str]) -> List[str]:
        return [tag.lower().strip() for tag in v]
```

### Update Models with Optional Fields

```python
class UpdateTodoInput(BaseModel):
    """Input for updating a todo."""
    id: str = Field(..., description="Todo ID")
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=1000)
    completed: Optional[bool] = None
    priority: Optional[str] = None

    @field_validator('priority')
    @classmethod
    def validate_priority(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ['low', 'medium', 'high']:
            raise ValueError("Priority must be 'low', 'medium', or 'high'")
        return v
```

### Empty Input Model

```python
class EmptyInput(BaseModel):
    """Input for commands requiring no arguments."""
    pass
```

### Batch Input Models

```python
class BatchCreateInput(BaseModel):
    """Input for batch creation."""
    todos: List[CreateTodoInput]

class BatchDeleteInput(BaseModel):
    """Input for batch deletion."""
    ids: List[str]

class BatchToggleInput(BaseModel):
    """Input for batch toggle."""
    ids: List[str]
    completed: Optional[bool] = None  # If None, toggle current state
```

## Success Responses

```python
# Basic success
return success(data=todo)

# With reasoning (recommended)
return success(
    data=todo,
    reasoning=f"Created todo '{todo.title}'"
)

# With confidence (for AI-generated content)
return success(
    data=suggestion,
    reasoning="Generated based on user history",
    confidence=0.85
)

# With warnings
return success(
    data=result,
    reasoning="Deleted 5 items",
    warnings=[
        {"code": "PERMANENT", "message": "This action cannot be undone"}
    ]
)

# With suggestions
return success(
    data=user,
    reasoning="User created successfully",
    suggestions=["Add profile photo", "Set notification preferences"]
)
```

## Error Responses

```python
# Not found
return error(
    code="NOT_FOUND",
    message=f"Todo '{todo_id}' not found",
    suggestion="Use todo-list to see available todos"
)

# Validation error
return error(
    code="VALIDATION_ERROR",
    message="Title cannot be empty",
    suggestion="Provide a title between 1 and 200 characters"
)

# Permission denied
return error(
    code="FORBIDDEN",
    message="You cannot modify this resource",
    suggestion="Contact the owner to request access"
)

# Conflict
return error(
    code="CONFLICT",
    message="Email already registered",
    suggestion="Use user.login instead, or reset password"
)

# Invalid input
return error(
    code="INVALID_PRIORITY",
    message=f"Invalid priority: {input.priority}",
    suggestion="Use 'low', 'medium', or 'high'"
)
```

## MCP Server Setup

### Basic Server

```python
from afd.server import create_server

server = create_server(
    name="todo-app",
    version="1.0.0",
    description="A todo list manager using AFD patterns",
    tool_strategy="lazy",
    contexts=[
        ContextConfig(name="editing", description="Commands that create or edit todos"),
        ContextConfig(name="reviewing", description="Commands that review or summarize todos"),
    ],
)

# Register commands using decorators
@server.command(name="todo-create", output_schema=CreateTodoOutput, contexts=["editing"], ...)
async def create_todo(input): ...

@server.command(name="todo-list", output_schema=ListTodosOutput, contexts=["reviewing"], ...)
async def list_todos(input): ...

# Run server
if __name__ == "__main__":
    import logging
    import sys
    logging.basicConfig(stream=sys.stderr, level=logging.INFO)
    server.run()
```

### Wire Format

The server sends results in the cross-language wire format (`spec/wire/`), the same JSON
as the TypeScript server:

- keys are camelCase (`undoCommand`, `executionTimeMs`, `successCount`); Python attributes
  stay snake_case, and parsing accepts both;
- unset fields are omitted, never `null`;
- failures are sent with MCP `isError: true`;
- a missing or mistyped argument returns `VALIDATION_ERROR` with `details.errors`,
  `details.expectedFields`/`missingFields`/`unexpectedFields` and a `suggestion`;
- every command result carries `metadata.executionTimeMs` and a per-call
  `metadata.traceId`;
- built-in payloads (`afd-schema`, `afd-help`, `afd-detail`, `create_handoff()`) follow
  the same rules.

Use `afd.core.wire.to_wire(result)` to produce the same JSON yourself.

### Tool Strategies and Bootstrap Tools

Python servers support the same three discovery modes as the shared AFD surface:

- `tool_strategy="individual"` — one MCP tool per command
- `tool_strategy="grouped"` — one MCP tool per category/group with `action`
- `tool_strategy="lazy"` — stable meta-tools for large command sets

```python
from afd.server import ContextConfig, create_server

server = create_server(
    name="todo-app",
    version="1.0.0",
    tool_strategy="lazy",
    contexts=[
        ContextConfig(name="editing", description="Write and edit documents"),
        ContextConfig(name="reviewing", description="Review and approve documents"),
    ],
)
```

Built-in tools exposed by strategy:

- All strategies: `afd-call`, `afd-batch`, `afd-pipe`, `afd-help`, `afd-docs`, `afd-schema`
- Lazy only: `afd-discover`, `afd-detail`
- When contexts are configured: `afd-context-list`, `afd-context-enter`, `afd-context-exit`

Context-scoped commands stay hidden from discovery outside the active context and return actionable `COMMAND_NOT_IN_CONTEXT` errors when called directly.

### Surface Validation

Use the Python CLI to validate the agent-facing command surface, not just handler behavior.

```bash
afd validate --surface
afd validate --surface --strict --verbose
```

The parity work adds validation for:

- missing output schemas
- missing configured contexts
- unresolved or circular prerequisites
- category, description, and schema quality issues

### Client and CLI Discovery Workflows

The shared lazy-tool workflow is:

1. `afd-discover` to find candidate commands
2. `afd-detail` to inspect input/output schemas, examples, `requires`, and `contexts`
3. `afd-call` to execute the selected command

`afd-call`, `afd-batch`, and `afd-pipe` are available in every tool strategy, not just lazy mode.

Batch and pipeline rules:

- Items and steps must be commands. `afd-batch`, `afd-pipe`, `afd-call`,
  `afd-discover` and `afd-detail` inside a batch or pipeline, or a malformed `when`
  condition, reject the whole request before anything runs. Commands cannot use those
  five names.
- A batch holds at most 500 commands with `parallelism` at most 16
  (`create_server(max_batch_size=..., max_batch_parallelism=...)`); more returns
  `INVALID_BATCH_REQUEST`.
- When a batch stops (`stopOnError` failure or `timeout`), in-flight commands are
  cancelled (`COMMAND_CANCELLED` / `BATCH_TIMEOUT`) and awaited before it returns.
- A handler that returns something other than a `CommandResult` gives its item an
  `INVALID_COMMAND_RESULT` failure.

```python
from afd import McpClient, McpClientConfig

client = McpClient(McpClientConfig(endpoint="http://127.0.0.1:3100/sse"))
await client.connect()

todo = await client.call("todo-create", {"title": "Ship parity docs"})
batch = await client.batch([
    {"command": "todo-create", "input": {"title": "Write tests"}},
    {"command": "todo-create", "input": {"title": "Review docs"}},
])
pipeline = await client.pipe([
    {"command": "todo-create", "input": {"title": "Follow up"}, "as": "todo"},
    {"command": "todo-get", "input": {"id": "$steps.todo.id"}},
])
```

Pipeline variables follow `spec/pipeline-variables.md` in every language: `$prev`,
`$first`, `$steps[N]`, `$steps.<alias>` and `$input` (the request's `input` field), each
optionally followed by a path (`$prev.items[0].id`). Other `$` strings are literals, `$$`
escapes a literal `$`, and an unresolved reference is omitted from the step input.

```bash
# Inspect tools and their metadata
afd tools --detail

# Validate the live agent surface
afd validate --surface --strict
```

When contexts are configured, agents can use `afd-context-list`, `afd-context-enter`, and `afd-context-exit` to switch scopes before calling context-bound commands.

### Server with Custom Port

```python
import os

PORT = int(os.environ.get("PORT", 3100))

if __name__ == "__main__":
    server.run(port=PORT)
```

## Complete Command Example

```python
"""Todo List MCP Server using AFD patterns."""

import asyncio
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime
import uuid

from afd import success, error, CommandResult
from afd.server import create_server

# Domain Model
class Todo(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    completed: bool = False
    priority: str = "medium"
    createdAt: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
    updatedAt: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")

# In-memory store
todos: Dict[str, Todo] = {}

# Server setup
server = create_server(
    name="todo-app",
    version="1.0.0",
    description="Todo list manager",
    tool_strategy="lazy",
    contexts=[
        ContextConfig(name="editing", description="Create and edit todos"),
        ContextConfig(name="reviewing", description="Read-only review commands"),
    ],
)

# Input models
class CreateTodoInput(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    priority: str = "medium"

class IdInput(BaseModel):
    id: str


class TodoOutput(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    completed: bool = False
    priority: str = "medium"


class DeleteTodoOutput(BaseModel):
    id: str
    deleted: bool

# Commands
@server.command(
    name="todo-create",
    description="Create a new todo item",
    category="todo",
    input_schema=CreateTodoInput,
    output_schema=TodoOutput,
    requires=["workspace-open"],
    contexts=["editing"],
    examples=[{"title": "Basic create", "input": {"title": "Plan sprint"}}],
    mutation=True
)
async def create_todo(input: CreateTodoInput) -> CommandResult[TodoOutput]:
    todo = TodoOutput(
        id=str(uuid.uuid4())[:8],
        title=input.title,
        description=input.description,
        priority=input.priority,
    )
    todos[todo.id] = todo
    return success(data=todo, reasoning=f"Created todo '{todo.title}'")

@server.command(
    name="todo-get",
    description="Get a todo by ID",
    category="todo",
    input_schema=IdInput,
    output_schema=TodoOutput,
    contexts=["editing", "reviewing"],
)
async def get_todo(input: IdInput) -> CommandResult[TodoOutput]:
    if input.id not in todos:
        return error(
            code="NOT_FOUND",
            message=f"Todo '{input.id}' not found",
            suggestion="Use todo-list to see available todos"
        )
    return success(data=todos[input.id])

@server.command(
    name="todo-delete",
    description="Delete a todo by ID",
    category="todo",
    input_schema=IdInput,
    output_schema=DeleteTodoOutput,
    contexts=["editing"],
    mutation=True
)
async def delete_todo(input: IdInput) -> CommandResult[DeleteTodoOutput]:
    if input.id not in todos:
        return error(code="NOT_FOUND", message=f"Todo '{input.id}' not found")

    deleted = todos.pop(input.id)
    return success(
        data=DeleteTodoOutput(id=input.id, deleted=True),
        reasoning=f"Deleted todo '{deleted.title}'",
        warnings=[{"code": "PERMANENT", "message": "This action cannot be undone"}]
    )

# Entry point
if __name__ == "__main__":
    server.run()
```

## Testing Commands

### pytest Setup

```python
# conftest.py
import pytest
from server import server, todos

@pytest.fixture(autouse=True)
def clear_store():
    """Clear todos before each test."""
    todos.clear()
    yield
    todos.clear()
```

### Unit Tests

```python
# test_commands.py
import pytest
from server import create_todo, get_todo, delete_todo, CreateTodoInput, IdInput

@pytest.mark.asyncio
async def test_create_todo():
    input = CreateTodoInput(title="Test", priority="high")
    result = await create_todo(input)

    assert result.success is True
    assert result.data.title == "Test"
    assert result.data.priority == "high"
    assert result.reasoning is not None

@pytest.mark.asyncio
async def test_get_todo_not_found():
    input = IdInput(id="nonexistent")
    result = await get_todo(input)

    assert result.success is False
    assert result.error.code == "NOT_FOUND"
    assert result.error.suggestion is not None

@pytest.mark.asyncio
async def test_create_get_delete_flow():
    # Create
    create_input = CreateTodoInput(title="Flow Test")
    created = await create_todo(create_input)
    assert created.success is True
    todo_id = created.data.id

    # Get
    get_input = IdInput(id=todo_id)
    fetched = await get_todo(get_input)
    assert fetched.data.title == "Flow Test"

    # Delete
    delete_input = IdInput(id=todo_id)
    deleted = await delete_todo(delete_input)
    assert deleted.success is True

    # Verify deleted
    not_found = await get_todo(get_input)
    assert not_found.success is False
    assert not_found.error.code == "NOT_FOUND"
```

### AFD Compliance Tests

```python
@pytest.mark.asyncio
async def test_success_includes_reasoning():
    input = CreateTodoInput(title="Compliance Test")
    result = await create_todo(input)

    assert result.success is True
    assert result.reasoning is not None
    assert len(result.reasoning) > 0

@pytest.mark.asyncio
async def test_error_includes_suggestion():
    input = IdInput(id="nonexistent")
    result = await get_todo(input)

    assert result.success is False
    assert result.error.suggestion is not None
```

### Testing Helpers

Execute and validate commands with automatic timing:

```python
from afd.testing import test_command, test_command_multiple, create_mock_command

# Run handler with timing + validation
result = await test_command(my_handler, {"title": "Test"})
assert result.is_success
assert result.execution_time_ms >= 0
assert result.validation.valid

# Batch-test with expectations
results = await test_command_multiple(my_handler, [
    {"input": {"title": "OK"}, "expect_success": True},
    {"input": {}, "expect_success": False, "expect_error": "VALIDATION_ERROR"},
])
assert all(r["passed"] for r in results)

# Create mock commands for testing dependencies
cmd = create_mock_command("user-get", lambda inp: {"id": inp["id"]})
```

### Validators

Non-throwing validators for programmatic checks:

```python
from afd.testing import validate_result, validate_error, validate_command_definition
from afd.testing import ResultValidationOptions

# Validate result structure
vr = validate_result(result)
assert vr.valid  # True when no errors

# Validate with stricter options
vr = validate_result(result, ResultValidationOptions(require_confidence=True))
for w in vr.warnings:
    print(f"{w.code}: {w.message}")

# Validate command definitions
vr = validate_command_definition(my_command)
assert vr.valid  # Checks kebab-case name, description, handler, parameters
```

### Additional Assertions

```python
from afd.testing import assert_has_suggestion, assert_retryable, assert_step_status, assert_ai_result

# Error quality assertions
assert_has_suggestion(error_result)        # Error has recovery suggestion
assert_retryable(error_result, expected=False)  # Retryable flag matches

# Plan step assertions
assert_step_status(result, "fetch", "complete")  # Step has expected status

# Composite AI result assertion
assert_ai_result(result, min_confidence=0.9, require_sources=True)
```

## Project Configuration

### pyproject.toml

```toml
[project]
name = "my-afd-app"
version = "1.0.0"
requires-python = ">=3.11"
dependencies = [
    "afd>=0.1.0",
    "pydantic>=2.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "pytest-asyncio>=0.21.0",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
```

### Type Hints

Always include type hints on function signatures:

```python
from typing import Optional, List, Dict, Any
from afd import CommandResult

async def create_todo(input: CreateTodoInput) -> CommandResult[Todo]:
    ...

async def list_todos(input: ListTodosInput) -> CommandResult[Dict[str, Any]]:
    ...
```

## Telemetry

Track command execution with standardized events:

```python
from afd import create_telemetry_event, ConsoleTelemetrySink, is_telemetry_event

# Create event (duration_ms auto-calculated from timestamps)
event = create_telemetry_event(
    command_name="todo-create",
    started_at="2024-01-15T10:30:00.000Z",
    completed_at="2024-01-15T10:30:00.150Z",
    success=True,
    trace_id="trace-abc123",
)
assert event.duration_ms == 150.0

# Console sink (text or JSON format)
sink = ConsoleTelemetrySink(format="json")
sink.record(event)

# Type guard
assert is_telemetry_event(event) is True
assert is_telemetry_event({"command_name": "test", ...}) is True

# Custom sink (implements TelemetrySink protocol)
class DatabaseSink:
    def record(self, event):
        db.insert("telemetry", event.model_dump(exclude_none=True))
    def flush(self):
        db.commit()
```

## DirectClient (Python)

Zero-overhead in-process command execution, same API as MCP client:

```python
from afd import DirectClient

client = DirectClient(registry)
result = await client.call('todo-create', {'title': 'Fast!'})
commands = await client.list_commands()
exists = client.has_command('todo-create')

# Same pipeline variables as afd-pipe
piped = await client.pipe(
    [
        {'command': 'user-get', 'input': {'id': '$input.userId'}, 'as': 'user'},
        {'command': 'order-list', 'input': {'userId': '$steps.user.id'},
         'when': {'$exists': '$steps.user.id'}},
    ],
    input={'userId': 123},
)
```

Use DirectClient when the AI agent runs in the same Python process.

## Handoff Connections

Connect to streaming protocols returned by handoff commands:

```python
from afd import (
    connect_handoff,
    create_reconnecting_handoff,
    register_builtin_handlers,
    register_handoff_handler,
    HandoffConnectionOptions,
    ReconnectionOptions,
)
from afd.core.handoff import is_handoff

# Register built-in WebSocket + SSE handlers
register_builtin_handlers()

# Connect to a handoff result from a command
result = await client.call('chat-connect', {'room_id': 'room-123'})
if result.success and is_handoff(result.data):
    conn = await connect_handoff(result.data, HandoffConnectionOptions(
        on_message=lambda msg: print('Message:', msg),
        on_error=lambda err: print('Error:', err),
    ))

    # With auto-reconnect via DirectClient
    conn = await client.create_reconnecting_handoff(result.data,
        ReconnectionOptions(
            reconnect_command='chat-reconnect',
            session_id=result.data.get('credentials', {}).get('sessionId'),
            max_attempts=5,
            backoff_ms=1000,
        ),
    )
```

The built-in WebSocket and SSE handlers read messages in a background task and report
a server close through `on_disconnect`. The credentials token is sent as an
`Authorization: Bearer` header, never in the URL. `create_handoff()` returns camelCase
keys (`sessionId`, `expiresAt`, `maxAttempts`, `backoffMs`). A reconnect calls
`reconnect_command` with `reconnect_args` plus `sessionId` from the `session_id`
option, so declare the reconnect command's parameter as `sessionId`, as in TypeScript.

### Custom Protocol Handlers

```python
# Register a custom protocol handler
async def my_handler(handoff, options):
    # Create and return a HandoffConnection
    ...

register_handoff_handler('my-protocol', my_handler)
```

### Install

```bash
pip install afd[client]  # adds websockets + httpx
```

## Related Skills

- `afd-developer` - Core AFD methodology
- `afd-typescript` - TypeScript implementation patterns
- `afd-rust` - Rust implementation patterns
