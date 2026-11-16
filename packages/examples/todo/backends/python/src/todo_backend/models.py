"""Pydantic models for the todo backend.

They mirror the Zod schemas of the TypeScript backend (``backends/typescript/src/commands`` and
``src/schemas.ts``) and the shared contract in ``spec/commands.schema.json``: same field names,
limits and defaults. The inputs validate each call; the outputs are the shapes each command
declares (``output_schema``), which the server reports and does not check.

Field names are the wire's camelCase, as the contract spells them.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, SerializerFunctionWrapHandler, model_serializer

Priority = Literal["low", "medium", "high"]
SortBy = Literal["createdAt", "updatedAt", "priority", "title", "deletedAt"]
SortOrder = Literal["asc", "desc"]

TITLE_MAX_LENGTH = 200
DESCRIPTION_MAX_LENGTH = 1000
LIST_LIMIT_MAX = 100
BATCH_MAX_ITEMS = 100


class Todo(BaseModel):
    """A todo item, as stored and as returned by every command."""

    id: str
    title: str
    description: str | None = None
    priority: Priority = "medium"
    completed: bool = False
    createdAt: str
    updatedAt: str
    completedAt: str | None = None
    deletedAt: str | None = Field(
        None, description="When it was deleted; set only on a deleted todo"
    )

    @model_serializer(mode="wrap")
    def _omit_absent(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        # The contract types the optional fields as optional strings, not nullable ones, so
        # leave them out when unset (the TS backend omits undefined properties the same way).
        return {key: value for key, value in handler(self).items() if value is not None}


# ─── Inputs ────────────────────────────────────────────────────────────────────


class CreateTodoInput(BaseModel):
    """Input for todo-create, and one item of todo-create-batch."""

    title: str = Field(
        ...,
        min_length=1,
        max_length=TITLE_MAX_LENGTH,
        description="Todo title (1-200 characters)",
    )
    description: str | None = Field(
        None, max_length=DESCRIPTION_MAX_LENGTH, description="Optional description"
    )
    priority: Priority = Field("medium", description="Priority: low, medium or high")


class ListTodosInput(BaseModel):
    """Input for todo-list."""

    deleted: bool | None = Field(
        None,
        description=(
            "If true, list the deleted todos, which todo-restore brings back, instead of live ones"
        ),
    )
    completed: bool | None = Field(None, description="Filter by completion status")
    priority: Priority | None = Field(None, description="Filter by priority")
    search: str | None = Field(None, description="Search in title and description")
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
    title: str | None = Field(
        None, min_length=1, max_length=TITLE_MAX_LENGTH, description="New title"
    )
    description: str | None = Field(
        None, max_length=DESCRIPTION_MAX_LENGTH, description="New description"
    )
    completed: bool | None = Field(None, description="Mark completed or pending")
    priority: Priority | None = Field(None, description="New priority")


class ClearTodosInput(BaseModel):
    """Input for todo-clear."""

    all: bool | None = Field(
        None, description="If true, remove every todo, live and deleted, regardless of status"
    )
    deleted: bool | None = Field(
        None, description="If true, empty the deleted todos instead of removing completed ones"
    )


class EmptyInput(BaseModel):
    """Input for commands that take no arguments."""


class BatchCreateInput(BaseModel):
    """Input for todo-create-batch."""

    todos: list[CreateTodoInput] = Field(
        ...,
        min_length=1,
        max_length=BATCH_MAX_ITEMS,
        description="Todos to create (1-100)",
    )


TodoId = Annotated[str, Field(min_length=1)]


class BatchIdsInput(BaseModel):
    """Input for todo-delete-batch and todo-restore."""

    ids: list[TodoId] = Field(
        ..., min_length=1, max_length=BATCH_MAX_ITEMS, description="Todo IDs (1-100)"
    )


class BatchToggleInput(BaseModel):
    """Input for todo-toggle-batch."""

    ids: list[TodoId] = Field(
        ..., min_length=1, max_length=BATCH_MAX_ITEMS, description="Todo IDs (1-100)"
    )
    completed: bool | None = Field(
        None,
        description="If set, mark every todo with this state instead of toggling each one",
    )


class HistoryInput(BaseModel):
    """Input for todo-history."""

    limit: int = Field(20, ge=1, le=100, description="Maximum entries (1-100)")
    offset: int = Field(0, ge=0, description="Offset for pagination")
    actor: str | None = Field(
        None,
        min_length=1,
        description="Only changes by this kind of actor: human, agent, service, script or test",
    )
    todoId: str | None = Field(
        None, min_length=1, description="Only changes that touched this todo"
    )


# ─── Outputs ───────────────────────────────────────────────────────────────────


class ListOutput(BaseModel):
    todos: list[Todo]
    total: int
    hasMore: bool


class DeleteOutput(BaseModel):
    deleted: bool
    id: str


class ClearOutput(BaseModel):
    cleared: int
    remaining: int
    clearedIds: list[str] = Field(..., description="The todos removed for good")


class PriorityCounts(BaseModel):
    low: int
    medium: int
    high: int


class StatsOutput(BaseModel):
    total: int
    completed: int
    pending: int
    byPriority: PriorityCounts
    completionRate: float


class ItemError(BaseModel):
    """An error inside a batch result: what failed and how to recover."""

    code: str
    message: str
    suggestion: str


class FailedById(BaseModel):
    """A batch item that failed, named by its id."""

    index: int
    id: str
    error: ItemError


class FailedCreate(BaseModel):
    """A todo-create-batch item that failed, with the input it was given."""

    index: int
    input: Any
    error: ItemError


class BatchSummary(BaseModel):
    total: int
    successCount: int
    failureCount: int


class ToggleSummary(BatchSummary):
    markedComplete: int
    markedIncomplete: int


class CreateBatchOutput(BaseModel):
    succeeded: list[Todo]
    failed: list[FailedCreate]
    summary: BatchSummary


class DeleteBatchOutput(BaseModel):
    deletedIds: list[str]
    failed: list[FailedById]
    summary: BatchSummary


class ToggleBatchOutput(BaseModel):
    succeeded: list[Todo]
    failed: list[FailedById]
    summary: ToggleSummary


class RestoreOutput(BaseModel):
    restoredIds: list[str]
    restored: list[Todo] = Field(..., description="The restored todos, as before the delete")
    failed: list[FailedById]
    summary: BatchSummary


class HistoryActor(BaseModel):
    kind: str
    id: str | None = None


class HistoryEntry(BaseModel):
    seq: int
    at: str
    actor: HistoryActor
    command: str
    ids: list[str]
    undoCommand: str | None = None
    undoArgs: dict[str, Any] | None = None
    superseded: Literal[True] | None = Field(
        None,
        description="Set when a later change touched the same todos, so its undo is not offered",
    )


class HistoryOutput(BaseModel):
    entries: list[HistoryEntry]
    total: int
    hasMore: bool
