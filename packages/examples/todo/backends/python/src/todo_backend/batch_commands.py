"""The todo commands that act on several todos with per-item failures, mirroring the TypeScript
``*-batch`` commands and ``todo-restore``.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from typing import Any

from afd import (
    AFD_IDEMPOTENCY_KEY_META_KEY,
    CommandResult,
    Recovery,
    Warning,
    error,
    success,
    system_clock,
)
from afd.server import define_command

from todo_backend.commands import EXAMPLE_ID
from todo_backend.contexts import EDIT_CONTEXTS
from todo_backend.models import (
    BatchCreateInput,
    BatchIdsInput,
    BatchToggleInput,
    CreateBatchOutput,
    DeleteBatchOutput,
    RestoreOutput,
    Todo,
    ToggleBatchOutput,
)
from todo_backend.shared import MCP, not_found_item, stamp_from
from todo_backend.store import Store

OTHER_ID = "todo-1700000000000-def5678"

ANSWER_TTL_MS = 86_400_000
"""How long a keyed batch's answer is kept: a day, as the server's idempotency step keeps one."""


def _summary(total: int, succeeded: int, failed: int) -> dict[str, int]:
    return {"total": total, "successCount": succeeded, "failureCount": failed}


def batch_commands(store: Store) -> list[Callable[..., Any]]:
    """todo-create-batch, todo-delete-batch, todo-toggle-batch and todo-restore."""
    # The answers of keyed batches, kept for this store and this process only. A store that
    # persists todos across restarts would commit the key with the todos in one transaction
    # instead, which is what lets a handler promise a batch is created once
    # (spec/idempotency.md, "Two tiers"); this example's promise ends with the process, as the
    # server's default idempotency store's does (S13).
    answers: dict[str, tuple[str, asyncio.Future[Any], float]] = {}

    @define_command(
        name="todo-create-batch",
        title="Create several todos",
        description="Create multiple todos at once with partial failure support",
        category="todo",
        input_schema=BatchCreateInput,
        output_schema=CreateBatchOutput,
        tags=["todo", "create", "write", "batch"],
        mutation=True,
        idempotency="keyed",
        undoable=True,
        approval="not-required",
        task="optional",
        version="1.0.0",
        contexts=EDIT_CONTEXTS,
        expose=MCP,
        examples=[
            {
                "title": "Two todos at once",
                "input": {
                    "todos": [
                        {"title": "Net the brassicas"},
                        {"title": "Sow the broad beans", "priority": "low"},
                    ]
                },
            }
        ],
    )
    async def create_batch(
        input: BatchCreateInput, context: Any = None
    ) -> CommandResult[dict[str, Any]]:
        # Keyed in its handler, not by the server's idempotency step: it may run as an MCP
        # task, on which the step does not act (spec/idempotency.md, D5 and S11).
        key = getattr(context, "idempotency_key", None)
        if key is None:
            return await create_all(input, context)
        clock = getattr(context, "clock", None) or system_clock
        now = clock.now()
        for held_scope in [s for s, answer in answers.items() if now > answer[2]]:
            del answers[held_scope]
        # The key's scope is the caller (its kind, id and whom it acts for) and the key (K5).
        actor = getattr(context, "actor", None)
        scope = json.dumps(
            [
                getattr(actor, "kind", None),
                getattr(actor, "id", None),
                getattr(actor, "on_behalf_of", None),
                key,
            ]
        )
        digest = json.dumps(input.model_dump(mode="json"), sort_keys=True)
        held = answers.get(scope)
        if held is not None:
            if held[0] != digest:
                return error(
                    "IDEMPOTENCY_KEY_REUSED",
                    "This idempotency key is already held for a batch with other todos",
                    suggestion=(
                        "Use a new idempotency key for a different batch. Reuse a key only to "
                        "repeat the same batch."
                    ),
                    retryable=False,
                    recovery=Recovery(kind="stop"),
                    details={"meta": AFD_IDEMPOTENCY_KEY_META_KEY},
                )
            return await asyncio.shield(held[1])
        # Kept before it settles, so a repeat that arrives while it runs waits for the same
        # answer; dropped if it fails, so a repeat after a failure runs again.
        running = asyncio.ensure_future(create_all(input, context))
        answers[scope] = (digest, running, now + ANSWER_TTL_MS)

        def drop_on_failure(done: asyncio.Future[Any]) -> None:
            failed = done.cancelled() or done.exception() is not None or not done.result().success
            if failed and answers.get(scope, (None, None))[1] is done:
                del answers[scope]

        running.add_done_callback(drop_on_failure)
        return await asyncio.shield(running)

    async def create_all(input: BatchCreateInput, context: Any) -> CommandResult[dict[str, Any]]:
        """Create every todo of the batch."""
        stamp = stamp_from(context)
        succeeded: list[Todo] = []
        failed: list[dict[str, Any]] = []
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
            succeeded.append(store.create(title, description, item.priority, stamp))

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
                "summary": _summary(total, len(succeeded), len(failed)),
            },
            reasoning=reasoning,
            confidence=len(succeeded) / total,
            warnings=warnings,
            undo_command="todo-delete-batch" if succeeded else None,
            undo_args={"ids": [todo.id for todo in succeeded]} if succeeded else None,
        )

    @define_command(
        name="todo-delete-batch",
        title="Delete several todos",
        description=(
            "Remove up to 100 todos in one call, reporting each id that fails. They stay "
            "restorable with todo-restore until todo-clear empties the deleted todos"
        ),
        category="todo",
        input_schema=BatchIdsInput,
        output_schema=DeleteBatchOutput,
        tags=["todo", "delete", "write", "batch", "destructive"],
        mutation=True,
        idempotency="natural",
        destructive=True,
        undoable=True,
        # It can be undone, so it is not held for approval
        approval="not-required",
        version="1.0.0",
        contexts=EDIT_CONTEXTS,
        expose=MCP,
        examples=[{"title": "Delete two todos", "input": {"ids": [EXAMPLE_ID, OTHER_ID]}}],
    )
    async def delete_batch(
        input: BatchIdsInput, context: Any = None
    ) -> CommandResult[dict[str, Any]]:
        now = stamp_from(context).now
        deleted_ids: list[str] = []
        failed: list[dict[str, Any]] = []
        for index, todo_id in enumerate(input.ids):
            if store.get(todo_id) is None:
                failed.append({"index": index, "id": todo_id, "error": not_found_item(todo_id)})
            elif store.delete(todo_id, now) is not None:
                deleted_ids.append(todo_id)
            else:
                failed.append(
                    {
                        "index": index,
                        "id": todo_id,
                        "error": {
                            "code": "DELETE_FAILED",
                            "message": f'Failed to delete todo "{todo_id}"',
                            "suggestion": "Try again or check if the todo still exists",
                        },
                    }
                )

        total = len(input.ids)
        if not failed:
            reasoning = f"Successfully deleted all {len(deleted_ids)} todos"
        elif not deleted_ids:
            reasoning = f"Failed to delete any todos. All {len(failed)} IDs were not found."
        else:
            reasoning = (
                f"Deleted {len(deleted_ids)} of {total} todos. {len(failed)} were not found."
            )
        warnings: list[Warning] = []
        if deleted_ids:
            warnings.append(
                Warning(
                    code="DESTRUCTIVE_BATCH",
                    message=(
                        f"Deleted {len(deleted_ids)} todos; todo-restore brings them back until "
                        "todo-clear empties the deleted todos"
                    ),
                    severity="caution",
                )
            )
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
                "summary": _summary(total, len(deleted_ids), len(failed)),
            },
            reasoning=reasoning,
            confidence=len(deleted_ids) / total,
            warnings=warnings or None,
            undo_command="todo-restore" if deleted_ids else None,
            undo_args={"ids": deleted_ids} if deleted_ids else None,
        )

    @define_command(
        name="todo-toggle-batch",
        title="Toggle several todos",
        description=(
            "Toggle the completion status of the listed todos, or set them all to completed: "
            "true or false"
        ),
        category="todo",
        input_schema=BatchToggleInput,
        output_schema=ToggleBatchOutput,
        tags=["todo", "toggle", "write", "batch"],
        requires=["todo-list"],
        mutation=True,
        idempotency="keyed",
        undoable=True,
        approval="not-required",
        version="1.0.0",
        contexts=EDIT_CONTEXTS,
        expose=MCP,
        examples=[
            {
                "title": "Mark two todos done",
                "input": {"ids": [EXAMPLE_ID, OTHER_ID], "completed": True},
            }
        ],
    )
    async def toggle_batch(
        input: BatchToggleInput, context: Any = None
    ) -> CommandResult[dict[str, Any]]:
        now = stamp_from(context).now
        succeeded: list[Todo] = []
        failed: list[dict[str, Any]] = []
        # The todos this call changed, and the state each had before
        changed: list[tuple[str, bool]] = []
        set_mode = input.completed is not None
        for index, todo_id in enumerate(input.ids):
            existing = store.get(todo_id)
            if existing is None:
                failed.append({"index": index, "id": todo_id, "error": not_found_item(todo_id)})
                continue
            updated: Todo | None
            if not set_mode:
                updated = store.toggle(todo_id, now)
                if updated is not None:
                    changed.append((todo_id, existing.completed))
            elif existing.completed != input.completed:
                updated = store.update(todo_id, completed=input.completed, now=now)
                if updated is not None:
                    changed.append((todo_id, existing.completed))
            else:
                updated = existing  # already in the requested state
            if updated is None:
                failed.append(
                    {
                        "index": index,
                        "id": todo_id,
                        "error": {
                            "code": "TOGGLE_FAILED",
                            "message": f'Failed to toggle todo "{todo_id}"',
                            "suggestion": "Try again or check if the todo still exists",
                        },
                    }
                )
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
        warnings: list[Warning] = []
        if failed and succeeded:
            warnings.append(
                Warning(
                    code="PARTIAL_SUCCESS",
                    message=f"{len(failed)} of {total} items could not be toggled",
                    severity="warning",
                )
            )
        # One call undoes this only when every changed todo had the same state before.
        previous_states = {previous for _, previous in changed}
        single_undo = len(previous_states) == 1
        if len(previous_states) > 1:
            warnings.append(
                Warning(
                    code="NO_SINGLE_UNDO",
                    message=(
                        "These todos had different states before, so no single call undoes this. "
                        "Set each group back with todo-toggle-batch and completed, or each todo "
                        "with todo-update."
                    ),
                    severity="info",
                )
            )
        return success(
            {
                "succeeded": succeeded,
                "failed": failed,
                "summary": {
                    **_summary(total, len(succeeded), len(failed)),
                    "markedComplete": marked_complete,
                    "markedIncomplete": marked_incomplete,
                },
            },
            reasoning=reasoning,
            confidence=len(succeeded) / total,
            warnings=warnings or None,
            undo_command="todo-toggle-batch" if single_undo else None,
            undo_args=(
                {"ids": [todo_id for todo_id, _ in changed], "completed": changed[0][1]}
                if single_undo
                else None
            ),
        )

    @define_command(
        name="todo-restore",
        title="Restore deleted todos",
        description=(
            "Bring deleted todos back exactly as they were. Find deleted todos with "
            "todo-list { deleted: true }; a delete result names this command and its ids as its "
            "undo"
        ),
        category="todo",
        input_schema=BatchIdsInput,
        output_schema=RestoreOutput,
        tags=["todo", "restore", "write", "batch", "undo"],
        mutation=True,
        idempotency="natural",
        undoable=True,
        approval="not-required",
        version="1.0.0",
        contexts=EDIT_CONTEXTS,
        expose=MCP,
        examples=[{"title": "Undo a delete", "input": {"ids": [EXAMPLE_ID]}}],
    )
    async def restore_todos(input: BatchIdsInput) -> CommandResult[dict[str, Any]]:
        restored: list[Todo] = []
        failed: list[dict[str, Any]] = []
        for index, todo_id in enumerate(input.ids):
            todo = store.restore(todo_id)
            if todo is not None:
                restored.append(todo)
                continue
            if store.get(todo_id) is not None:
                reason = {
                    "code": "NOT_FOUND",
                    "message": f'Todo "{todo_id}" is not deleted',
                    "suggestion": "It is already a live todo: use todo-get to read it",
                }
            else:
                reason = {
                    "code": "NOT_FOUND",
                    "message": f'No deleted todo has ID "{todo_id}"',
                    "suggestion": (
                        "Use todo-list { deleted: true } to see the deleted todos, and todo-list "
                        "to see the live ones"
                    ),
                }
            failed.append({"index": index, "id": todo_id, "error": reason})

        restored_ids = [todo.id for todo in restored]
        total = len(input.ids)
        if not failed:
            plural = "" if len(restored) == 1 else "s"
            reasoning = f"Restored {len(restored)} todo{plural}"
        elif not restored:
            which = "that ID" if total == 1 else "those IDs"
            reasoning = f"Restored none of {total}: no deleted todo has {which}"
        else:
            reasoning = (
                f"Restored {len(restored)} of {total} todos; {len(failed)} could not be restored"
            )
        return success(
            {
                "restoredIds": restored_ids,
                "restored": restored,
                "failed": failed,
                "summary": _summary(total, len(restored), len(failed)),
            },
            reasoning=reasoning,
            confidence=len(restored) / total,
            warnings=(
                [
                    Warning(
                        code="PARTIAL_SUCCESS",
                        message=f"{len(failed)} of {total} could not be restored",
                        severity="warning",
                    )
                ]
                if failed and restored
                else None
            ),
            undo_command="todo-delete-batch" if restored_ids else None,
            undo_args={"ids": restored_ids} if restored_ids else None,
        )

    return [create_batch, delete_batch, toggle_batch, restore_todos]
