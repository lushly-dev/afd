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

# Define command
@server.command(
    name="todo-create",
    description="Create a new todo item",
    input_schema=CreateTodoInput,
    mutation=True
)
async def create_todo(input: CreateTodoInput) -> CommandResult[Todo]:
    if input.priority not in ["low", "medium", "high"]:
        return error(
            code="INVALID_PRIORITY",
            message=f"Invalid priority: {input.priority}",
            suggestion="Use 'low', 'medium', or 'high'"
        )

    todo = Todo(
        id=str(uuid.uuid4())[:8],
        title=input.title,
        description=input.description,
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

@server.command(
    name="todo-list",
    description="List all todo items with optional filtering",
    input_schema=ListTodosInput
)
async def list_todos(input: ListTodosInput) -> CommandResult[Dict[str, Any]]:
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
        data={
            "todos": [t.model_dump() for t in items],
            "total": total,
            "hasMore": total > input.offset + input.limit
        },
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
)

# Register commands using decorators
@server.command(name="todo-create", ...)
async def create_todo(input): ...

@server.command(name="todo-list", ...)
async def list_todos(input): ...

# Run server
if __name__ == "__main__":
    import logging
    import sys
    logging.basicConfig(stream=sys.stderr, level=logging.INFO)
    server.run()
```

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
)

# Input models
class CreateTodoInput(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    priority: str = "medium"

class IdInput(BaseModel):
    id: str

# Commands
@server.command(
    name="todo-create",
    description="Create a new todo item",
    input_schema=CreateTodoInput,
    mutation=True
)
async def create_todo(input: CreateTodoInput) -> CommandResult[Todo]:
    todo = Todo(
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
    input_schema=IdInput
)
async def get_todo(input: IdInput) -> CommandResult[Todo]:
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
    input_schema=IdInput,
    mutation=True
)
async def delete_todo(input: IdInput) -> CommandResult[Dict[str, Any]]:
    if input.id not in todos:
        return error(code="NOT_FOUND", message=f"Todo '{input.id}' not found")

    deleted = todos.pop(input.id)
    return success(
        data={"id": input.id, "deleted": True},
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

## Related Skills

- `afd-developer` - Core AFD methodology
- `afd-typescript` - TypeScript implementation patterns
- `afd-rust` - Rust implementation patterns
