"""Pydantic models for the todo backend.

They mirror the Zod schemas of the TypeScript backend
(``backends/typescript/src/commands``) and the shared contract in
``spec/commands.schema.json``: same field names, limits and defaults.
"""

from __future__ import annotations

from typing import Annotated, Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, SerializerFunctionWrapHandler, model_serializer

Priority = Literal["low", "medium", "high"]
SortBy = Literal["createdAt", "updatedAt", "priority", "title"]
SortOrder = Literal["asc", "desc"]

TITLE_MAX_LENGTH = 200
DESCRIPTION_MAX_LENGTH = 1000
LIST_LIMIT_MAX = 100
BATCH_MAX_ITEMS = 100


class Todo(BaseModel):
    """A todo item, as stored and as returned by every command."""

    id: str
    title: str
    description: Optional[str] = None
    priority: Priority = "medium"
    completed: bool = False
    createdAt: str
    updatedAt: str
    completedAt: Optional[str] = None

    @model_serializer(mode="wrap")
    def _omit_absent(self, handler: SerializerFunctionWrapHandler) -> Dict[str, Any]:
        # The contract types description/completedAt as optional strings, not
        # nullable ones, so leave them out when unset (the TS backend omits
        # undefined properties the same way).
        return {key: value for key, value in handler(self).items() if value is not None}


class CreateTodoInput(BaseModel):
    """Input for todo-create, and one item of todo-create-batch."""

    title: str = Field(
        ...,
        min_length=1,
        max_length=TITLE_MAX_LENGTH,
        description="Todo title (1-200 characters)",
    )
    description: Optional[str] = Field(
        None, max_length=DESCRIPTION_MAX_LENGTH, description="Optional description"
    )
    priority: Priority = Field("medium", description="Priority: low, medium or high")


class ListTodosInput(BaseModel):
    """Input for todo-list."""

    completed: Optional[bool] = Field(None, description="Filter by completion status")
    priority: Optional[Priority] = Field(None, description="Filter by priority")
    search: Optional[str] = Field(None, description="Search in title and description")
    sortBy: SortBy = Field("createdAt", description="Sort field")
    sortOrder: SortOrder = Field("desc", description="Sort direction")
    limit: int = Field(20, ge=1, le=LIST_LIMIT_MAX, description="Maximum results (1-100)")
    offset: int = Field(0, ge=0, description="Offset for pagination")


class IdInput(BaseModel):
    """Input for commands that take a single todo ID."""

    id: str = Field(..., min_length=1, description="Todo ID")


class UpdateTodoInput(BaseModel):
    """Input for todo-update."""

    id: str = Field(..., min_length=1, description="Todo ID")
    title: Optional[str] = Field(
        None, min_length=1, max_length=TITLE_MAX_LENGTH, description="New title"
    )
    description: Optional[str] = Field(
        None, max_length=DESCRIPTION_MAX_LENGTH, description="New description"
    )
    completed: Optional[bool] = Field(None, description="Mark completed or pending")
    priority: Optional[Priority] = Field(None, description="New priority")


class ClearTodosInput(BaseModel):
    """Input for todo-clear."""

    all: Optional[bool] = Field(None, description="If true, clear all todos regardless of status")


class EmptyInput(BaseModel):
    """Input for commands that take no arguments."""


class BatchCreateInput(BaseModel):
    """Input for todo-create-batch."""

    todos: List[CreateTodoInput] = Field(
        ...,
        min_length=1,
        max_length=BATCH_MAX_ITEMS,
        description="Todos to create (1-100)",
    )


TodoId = Annotated[str, Field(min_length=1)]


class BatchIdsInput(BaseModel):
    """Input for todo-delete-batch."""

    ids: List[TodoId] = Field(
        ..., min_length=1, max_length=BATCH_MAX_ITEMS, description="Todo IDs (1-100)"
    )


class BatchToggleInput(BaseModel):
    """Input for todo-toggle-batch."""

    ids: List[TodoId] = Field(
        ..., min_length=1, max_length=BATCH_MAX_ITEMS, description="Todo IDs (1-100)"
    )
    completed: Optional[bool] = Field(
        None,
        description="If set, mark every todo with this state instead of toggling each one",
    )
