"""Batch todo commands with per-item failures, mirroring the TS *-batch commands."""

from __future__ import annotations

from typing import Any, Dict, List

from afd import CommandResult, Warning, success
from afd.server import MCPServer

from todo_backend.commands import MCP, not_found_item
from todo_backend.models import BatchCreateInput, BatchIdsInput, BatchToggleInput, Todo
from todo_backend.store import MemoryStore


def register_batch_commands(server: MCPServer, store: MemoryStore) -> None:
    """Register todo-create-batch, todo-delete-batch and todo-toggle-batch."""

    @server.command(
        name="todo-create-batch",
        description="Create multiple todos at once with partial failure support",
        category="todo",
        input_schema=BatchCreateInput,
        tags=["todo", "create", "write", "batch"],
        mutation=True,
        expose=MCP,
    )
    async def create_batch(input: BatchCreateInput) -> CommandResult[Dict[str, Any]]:
        succeeded: List[Todo] = []
        failed: List[Dict[str, Any]] = []
        for index, item in enumerate(input.todos):
            title = item.title.strip()
            if not title:
                failed.append(
                    {
                        "index": index,
                        "input": item.model_dump(mode="json", exclude_none=True),
                        "error": {
                            "code": "VALIDATION_ERROR",
                            "message": "Title is required",
                            "suggestion": "Provide a non-empty title for this todo",
                        },
                    }
                )
                continue
            description = item.description.strip() if item.description is not None else None
            succeeded.append(store.create(title, description, item.priority))

        total = len(input.todos)
        if not failed:
            reasoning = f"Successfully created all {len(succeeded)} todos"
        elif not succeeded:
            reasoning = f"Failed to create any todos. All {len(failed)} items had errors."
        else:
            reasoning = (
                f"Created {len(succeeded)} of {total} todos. {len(failed)} failed validation."
            )
        warnings = (
            [
                Warning(
                    code="PARTIAL_SUCCESS",
                    message=f"{len(failed)} of {total} items failed",
                    severity="warning",
                )
            ]
            if failed and succeeded
            else None
        )
        return success(
            {
                "succeeded": succeeded,
                "failed": failed,
                "summary": {
                    "total": total,
                    "successCount": len(succeeded),
                    "failureCount": len(failed),
                },
            },
            reasoning=reasoning,
            confidence=len(succeeded) / total,
            warnings=warnings,
        )

    @server.command(
        name="todo-delete-batch",
        description="Delete multiple todos at once",
        category="todo",
        input_schema=BatchIdsInput,
        tags=["todo", "delete", "write", "batch", "destructive"],
        mutation=True,
        expose=MCP,
    )
    async def delete_batch(input: BatchIdsInput) -> CommandResult[Dict[str, Any]]:
        deleted_ids: List[str] = []
        failed: List[Dict[str, Any]] = []
        for index, todo_id in enumerate(input.ids):
            if store.delete(todo_id):
                deleted_ids.append(todo_id)
            else:
                failed.append({"index": index, "id": todo_id, "error": not_found_item(todo_id)})

        total = len(input.ids)
        if not failed:
            reasoning = f"Successfully deleted all {len(deleted_ids)} todos"
        elif not deleted_ids:
            reasoning = f"Failed to delete any todos. All {len(failed)} IDs were not found."
        else:
            reasoning = (
                f"Deleted {len(deleted_ids)} of {total} todos. {len(failed)} were not found."
            )
        warnings = [
            Warning(
                code="DESTRUCTIVE_BATCH",
                message=f"This operation permanently deleted {len(deleted_ids)} todos",
                severity="caution",
            )
        ]
        if failed and deleted_ids:
            warnings.append(
                Warning(
                    code="PARTIAL_SUCCESS",
                    message=f"{len(failed)} of {total} items could not be deleted",
                    severity="warning",
                )
            )
        return success(
            {
                "deletedIds": deleted_ids,
                "failed": failed,
                "summary": {
                    "total": total,
                    "successCount": len(deleted_ids),
                    "failureCount": len(failed),
                },
            },
            reasoning=reasoning,
            confidence=len(deleted_ids) / total,
            warnings=warnings,
        )

    @server.command(
        name="todo-toggle-batch",
        description="Toggle completion status of multiple todos, or set all to a specific state",
        category="todo",
        input_schema=BatchToggleInput,
        tags=["todo", "toggle", "write", "batch"],
        requires=["todo-list"],
        mutation=True,
        expose=MCP,
    )
    async def toggle_batch(input: BatchToggleInput) -> CommandResult[Dict[str, Any]]:
        succeeded: List[Todo] = []
        failed: List[Dict[str, Any]] = []
        set_mode = input.completed is not None
        for index, todo_id in enumerate(input.ids):
            existing = store.get(todo_id)
            if existing is None:
                failed.append({"index": index, "id": todo_id, "error": not_found_item(todo_id)})
                continue
            if not set_mode:
                updated = store.toggle(todo_id)
            elif existing.completed != input.completed:
                updated = store.update(todo_id, completed=input.completed)
            else:
                updated = existing  # already in the requested state
            if updated is None:
                failed.append({"index": index, "id": todo_id, "error": not_found_item(todo_id)})
                continue
            succeeded.append(updated)

        marked_complete = sum(1 for todo in succeeded if todo.completed)
        marked_incomplete = len(succeeded) - marked_complete
        total = len(input.ids)
        mode = (
            f"set to {'complete' if input.completed else 'incomplete'}" if set_mode else "toggled"
        )
        if not failed:
            reasoning = f"Successfully {mode} all {len(succeeded)} todos"
            if set_mode:
                reasoning += f" ({marked_complete} complete, {marked_incomplete} incomplete)"
        elif not succeeded:
            reasoning = f"Failed to update any todos. All {len(failed)} IDs were not found."
        else:
            reasoning = (
                f"{mode[0].upper()}{mode[1:]} {len(succeeded)} of {total} todos. "
                f"{len(failed)} were not found."
            )
        warnings = (
            [
                Warning(
                    code="PARTIAL_SUCCESS",
                    message=f"{len(failed)} of {total} items could not be toggled",
                    severity="warning",
                )
            ]
            if failed and succeeded
            else None
        )
        return success(
            {
                "succeeded": succeeded,
                "failed": failed,
                "summary": {
                    "total": total,
                    "successCount": len(succeeded),
                    "failureCount": len(failed),
                    "markedComplete": marked_complete,
                    "markedIncomplete": marked_incomplete,
                },
            },
            reasoning=reasoning,
            confidence=len(succeeded) / total,
            warnings=warnings,
        )
