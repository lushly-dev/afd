"""Example: Todo List MCP Server using AFD.

This example demonstrates a complete MCP server for managing todos,
following Agent-First Development principles.

Environment variables:
    TODO_STORE_TYPE - "memory" or "file" (default: "file")
    TODO_STORE_PATH - Path to the JSON file (default: ../data/todos.json)
"""

import asyncio
import json
import os
from pathlib import Path
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime
import uuid

from afd import success, error, CommandResult
from afd.server import create_server, MCPServer


# ==============================================================================
# Configuration
# ==============================================================================

STORE_TYPE = os.environ.get("TODO_STORE_TYPE", "file")
# Default path shared with TypeScript backend (relative to this file's location)
DEFAULT_STORE_PATH = Path(__file__).parent.parent.parent.parent / "data" / "todos.json"
STORE_PATH = Path(os.environ.get("TODO_STORE_PATH", str(DEFAULT_STORE_PATH)))


# ==============================================================================
# Domain Models
# ==============================================================================

class Todo(BaseModel):
    """A todo item."""
    id: str
    title: str
    description: Optional[str] = None
    completed: bool = False
    priority: str = "medium"
    createdAt: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
    updatedAt: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
    completedAt: Optional[str] = None


class CreateTodoInput(BaseModel):
    """Input for creating a todo."""
    title: str = Field(..., description="Todo title")
    description: Optional[str] = Field(None, description="Optional description")
    priority: str = Field("medium", description="Priority: low, medium, high")


class UpdateTodoInput(BaseModel):
    """Input for updating a todo."""
    id: str = Field(..., description="Todo ID")
    title: Optional[str] = Field(None, description="New title")
    description: Optional[str] = Field(None, description="New description")
    completed: Optional[bool] = Field(None, description="Mark completed/pending")
    priority: Optional[str] = Field(None, description="New priority")


class ListTodosInput(BaseModel):
    """Input for listing todos."""
    completed: Optional[bool] = None
    priority: Optional[str] = None
    search: Optional[str] = None
    limit: int = 20
    offset: int = 0


class BatchCreateInput(BaseModel):
    """Input for batch creation."""
    todos: List[CreateTodoInput]


class BatchDeleteInput(BaseModel):
    """Input for batch deletion."""
    ids: List[str]


class BatchToggleInput(BaseModel):
    """Input for batch toggle."""
    ids: List[str]
    completed: Optional[bool] = None


class ClearTodosInput(BaseModel):
    """Input for clearing todos."""
    all: Optional[bool] = Field(False, description="If true, clear all todos regardless of status")


class IdInput(BaseModel):
    """Input for commands requiring an ID."""
    id: str = Field(..., description="Todo ID")


class EmptyInput(BaseModel):
    """Input for commands requiring no arguments."""
    pass


# ==============================================================================
# File-Based Store (shared storage between processes)
# ==============================================================================

class FileStore:
    """File-based todo store with JSON persistence."""
    
    def __init__(self, path: Path):
        self.path = path
        # Ensure directory exists
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # Initialize empty file if it doesn't exist
        if not self.path.exists():
            self._save({})
    
    def _load(self) -> Dict[str, Todo]:
        """Load todos from file."""
        try:
            with open(self.path, 'r') as f:
                data = json.load(f)
                # Handle array format (from TypeScript)
                if isinstance(data, list):
                    return {t['id']: Todo(**t) for t in data}
                # Handle object format
                return {k: Todo(**v) for k, v in data.items()}
        except (FileNotFoundError, json.JSONDecodeError):
            return {}
    
    def _save(self, data: Dict[str, Todo]) -> None:
        """Save todos to file as array for compatibility with TypeScript."""
        # Save as array for better readability and TypeScript compatibility
        todos_list = [t.model_dump() if hasattr(t, 'model_dump') else t for t in data.values()]
        with open(self.path, 'w') as f:
            json.dump(todos_list, f, indent=2)
    
    def get_all(self) -> Dict[str, Todo]:
        return self._load()
    
    def get(self, id: str) -> Optional[Todo]:
        return self._load().get(id)
    
    def set(self, id: str, todo: Todo) -> None:
        data = self._load()
        data[id] = todo
        self._save(data)
    
    def delete(self, id: str) -> bool:
        data = self._load()
        if id in data:
            del data[id]
            self._save(data)
            return True
        return False
    
    def clear(self) -> None:
        self._save({})


# Initialize store based on environment
if STORE_TYPE == "memory":
    print("[Store] Using in-memory storage (isolated per process)", file=__import__('sys').stderr)
    todos: Dict[str, Todo] = {}
    _file_store = None
else:
    print(f"[Store] Using file storage at {STORE_PATH}", file=__import__('sys').stderr)
    _file_store = FileStore(STORE_PATH)
    todos = {}  # Placeholder, we'll use _file_store methods


def _get_todos() -> Dict[str, Todo]:
    """Get todos from the appropriate store."""
    if _file_store:
        return _file_store.get_all()
    return todos


def _set_todo(id: str, todo: Todo) -> None:
    """Set a todo in the appropriate store."""
    if _file_store:
        _file_store.set(id, todo)
    else:
        todos[id] = todo


def _delete_todo(id: str) -> bool:
    """Delete a todo from the appropriate store."""
    if _file_store:
        return _file_store.delete(id)
    if id in todos:
        del todos[id]
        return True
    return False


def _clear_todos() -> None:
    """Clear all todos from the appropriate store."""
    if _file_store:
        _file_store.clear()
    else:
        todos.clear()


# ==============================================================================
# Server Setup
# ==============================================================================

server = create_server(
    name="todo-app",
    version="1.0.0",
    description="A simple todo list manager demonstrating AFD patterns",
)


# ==============================================================================
# Commands
# ==============================================================================

@server.command(name="todo.create", description="Create a new todo item", input_schema=CreateTodoInput, mutation=True)
async def create_todo(input: CreateTodoInput) -> CommandResult[Todo]:
    if input.priority not in ["low", "medium", "high"]:
        return error(code="INVALID_PRIORITY", message=f"Invalid priority: {input.priority}")
    
    todo = Todo(
        id=str(uuid.uuid4())[:8],
        title=input.title,
        description=input.description,
        priority=input.priority,
    )
    _set_todo(todo.id, todo)
    return success(data=todo, reasoning=f"Created todo '{todo.title}'")


@server.command(name="todo.list", description="List all todo items", input_schema=ListTodosInput)
async def list_todos(input: ListTodosInput) -> CommandResult[Dict[str, Any]]:
    current_todos = _get_todos()
    items = list(current_todos.values())
    
    # Filtering
    if input.completed is not None:
        items = [t for t in items if t.completed == input.completed]
    if input.priority:
        items = [t for t in items if t.priority == input.priority]
    if input.search:
        s = input.search.lower()
        items = [t for t in items if s in t.title.lower() or (t.description and s in t.description.lower())]
    
    total = len(items)
    items = items[input.offset : input.offset + input.limit]
    
    return success(
        data={"todos": items, "total": total, "hasMore": total > input.offset + input.limit},
        reasoning=f"Found {total} todo(s)"
    )


@server.command(name="todo.get", description="Get a specific todo by ID", input_schema=IdInput)
async def get_todo(input: IdInput) -> CommandResult[Todo]:
    todo_id = input.id
    current_todos = _get_todos()
    if not todo_id or todo_id not in current_todos:
        return error(code="NOT_FOUND", message=f"Todo '{todo_id}' not found")
    return success(data=current_todos[todo_id])


@server.command(name="todo.update", description="Update a todo item", input_schema=UpdateTodoInput, mutation=True)
async def update_todo(input: UpdateTodoInput) -> CommandResult[Todo]:
    current_todos = _get_todos()
    if input.id not in current_todos:
        return error(code="NOT_FOUND", message=f"Todo '{input.id}' not found")
    
    todo = current_todos[input.id]
    if input.title is not None: todo.title = input.title
    if input.description is not None: todo.description = input.description
    if input.completed is not None:
        if input.completed and not todo.completed:
            todo.completedAt = datetime.utcnow().isoformat() + "Z"
        elif not input.completed:
            todo.completedAt = None
        todo.completed = input.completed
    if input.priority is not None:
        if input.priority not in ["low", "medium", "high"]:
            return error(code="INVALID_PRIORITY", message=f"Invalid priority: {input.priority}")
        todo.priority = input.priority
    
    todo.updatedAt = datetime.utcnow().isoformat() + "Z"
    _set_todo(todo.id, todo)
    return success(data=todo, reasoning=f"Updated todo '{todo.id}'")


@server.command(name="todo.toggle", description="Toggle completion status", input_schema=IdInput, mutation=True)
async def toggle_todo(input: IdInput) -> CommandResult[Todo]:
    todo_id = input.id
    current_todos = _get_todos()
    if not todo_id or todo_id not in current_todos:
        return error(code="NOT_FOUND", message=f"Todo '{todo_id}' not found")
    
    todo = current_todos[todo_id]
    todo.completed = not todo.completed
    if todo.completed:
        todo.completedAt = datetime.utcnow().isoformat() + "Z"
    else:
        todo.completedAt = None
    
    todo.updatedAt = datetime.utcnow().isoformat() + "Z"
    _set_todo(todo.id, todo)
    return success(data=todo, reasoning=f"Toggled todo '{todo.id}' to {todo.completed}")


@server.command(name="todo.delete", description="Delete a todo item", input_schema=IdInput, mutation=True)
async def delete_todo(input: IdInput) -> CommandResult[Dict[str, Any]]:
    todo_id = input.id
    current_todos = _get_todos()
    if not todo_id or todo_id not in current_todos:
        return error(code="NOT_FOUND", message=f"Todo '{todo_id}' not found")
    
    deleted = current_todos[todo_id]
    _delete_todo(todo_id)
    return success(data={"id": todo_id, "deleted": True}, reasoning=f"Deleted todo '{deleted.title}'")


@server.command(name="todo.clear", description="Clear completed todos", input_schema=ClearTodosInput, mutation=True)
async def clear_completed(input: ClearTodosInput) -> CommandResult[Dict[str, int]]:
    current_todos = _get_todos()
    if input.all:
        count = len(current_todos)
        _clear_todos()
        return success(data={"cleared": count}, reasoning=f"Cleared all {count} todos")
    
    to_delete = [tid for tid, t in current_todos.items() if t.completed]
    for tid in to_delete:
        _delete_todo(tid)
    return success(data={"cleared": len(to_delete)}, reasoning=f"Cleared {len(to_delete)} completed todos")


@server.command(name="todo.stats", description="Get todo statistics", input_schema=EmptyInput)
async def todo_stats(input: EmptyInput) -> CommandResult[Dict[str, Any]]:
    current_todos = _get_todos()
    total = len(current_todos)
    completed = sum(1 for t in current_todos.values() if t.completed)
    
    by_priority = {"low": 0, "medium": 0, "high": 0}
    for t in current_todos.values():
        by_priority[t.priority] = by_priority.get(t.priority, 0) + 1
        
    return success(data={
        "total": total,
        "completed": completed,
        "pending": total - completed,
        "completionRate": completed / total if total > 0 else 0,
        "byPriority": by_priority
    })


@server.command(name="todo.createBatch", description="Create multiple todos", input_schema=BatchCreateInput, mutation=True)
async def create_batch(input: BatchCreateInput) -> CommandResult[Dict[str, Any]]:
    created = []
    for t_in in input.todos:
        todo = Todo(
            id=str(uuid.uuid4())[:8],
            title=t_in.title,
            description=t_in.description,
            priority=t_in.priority
        )
        _set_todo(todo.id, todo)
        created.append(todo)
    return success(data={"succeeded": created, "failed": []}, reasoning=f"Created {len(created)} todos")


@server.command(name="todo.deleteBatch", description="Delete multiple todos", input_schema=BatchDeleteInput, mutation=True)
async def delete_batch(input: BatchDeleteInput) -> CommandResult[Dict[str, Any]]:
    current_todos = _get_todos()
    deleted = []
    for tid in input.ids:
        if tid in current_todos:
            _delete_todo(tid)
            deleted.append(tid)
    return success(data={"deletedIds": deleted, "failed": []}, reasoning=f"Deleted {len(deleted)} todos")


@server.command(name="todo.toggleBatch", description="Toggle multiple todos", input_schema=BatchToggleInput, mutation=True)
async def toggle_batch(input: BatchToggleInput) -> CommandResult[Dict[str, Any]]:
    current_todos = _get_todos()
    updated = []
    now = datetime.utcnow().isoformat() + "Z"
    for tid in input.ids:
        if tid in current_todos:
            todo = current_todos[tid]
            new_completed = input.completed if input.completed is not None else not todo.completed
            
            if new_completed and not todo.completed:
                todo.completedAt = now
            elif not new_completed:
                todo.completedAt = None
                
            todo.completed = new_completed
            todo.updatedAt = now
            _set_todo(tid, todo)
            updated.append(todo)
    return success(data={"succeeded": updated, "failed": []}, reasoning=f"Updated {len(updated)} todos")


# ==============================================================================
# Main Entry Point
# ==============================================================================

if __name__ == "__main__":
    import logging
    import sys
    logging.basicConfig(stream=sys.stderr, level=logging.INFO)
    server.run()
