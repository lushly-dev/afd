"""todo-clear, as ``backends/typescript/src/commands/clear.ts``.

The one todo change with no way back, so the one held for approval: any caller that is not a
person waits until a person approves (the server's approval middleware, ``APPROVALS``).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Literal

from afd import CommandResult, Warning, success
from afd.server import define_command

from todo_backend.contexts import EDIT_CONTEXTS
from todo_backend.models import ClearOutput, ClearTodosInput
from todo_backend.shared import MCP
from todo_backend.store import Store

Scope = Literal["all", "deleted", "completed"]


def _scope(input: Any) -> Scope:
    """What a clear with this input removes: completed todos, deleted ones, or everything."""
    if not isinstance(input, ClearTodosInput):
        return "completed"
    if input.all:
        return "all"
    if input.deleted:
        return "deleted"
    return "completed"


def summarize_clear(store: Store, input: Any) -> str:
    """The text a person approves: what goes for good, and how many that is when the call is
    held. The approval covers the call's input, not those todos, so the text says the count is
    as of now."""

    def now(count: int) -> str:
        return f" ({count} {'todo' if count == 1 else 'todos'} now)"

    what = _scope(input)
    if what == "all":
        live = store.count()
        deleted = store.count_matching(deleted=True)
        return f"Remove every todo for good, live and deleted{now(live + deleted)}"
    if what == "deleted":
        return f"Empty the deleted todos for good{now(store.count_matching(deleted=True))}"
    return f"Remove the completed todos for good{now(store.count_matching(completed=True))}"


def _approval(input: Any, context: Any) -> str:
    # Nothing undoes a clear, so only a person runs it without approval.
    actor = getattr(context, "actor", None)
    return "not-required" if getattr(actor, "kind", None) == "human" else "required"


def clear_command(store: Store, *, held: bool = True) -> Callable[..., Any]:
    """todo-clear, bound to ``store``. With ``held=False`` it declares no approval policy: the
    server has no approval step then (``APPROVALS=off``), and the engine refuses a command that
    declares a policy without one (``APPROVAL_UNAVAILABLE``)."""

    @define_command(
        name="todo-clear",
        title="Clear todos for good",
        description=(
            "Remove todos for good: completed ones, or the deleted todos with deleted: true, or "
            "every todo with all: true. Nothing undoes it. Where the server holds clears for "
            "approval, a caller that is not a person waits for a person to approve; elsewhere it "
            "is gated only by its confirmation prompt, where the server enforces confirmations"
        ),
        category="todo",
        input_schema=ClearTodosInput,
        output_schema=ClearOutput,
        tags=["todo", "clear", "write", "batch", "destructive"],
        mutation=True,
        idempotency="natural",
        destructive=True,
        # Enforced when the server runs with CONFIRMATIONS=enforce (spec/confirmation-cases.json).
        confirm_prompt="Delete these todos? This cannot be undone.",
        approval=_approval if held else None,
        version="1.0.0",
        contexts=EDIT_CONTEXTS,
        expose=MCP,
        examples=[
            {"title": "Remove the completed todos", "input": {}},
            {"title": "Empty the deleted todos", "input": {"deleted": True}},
        ],
    )
    async def clear_todos(input: ClearTodosInput) -> CommandResult[dict[str, Any]]:
        what = _scope(input)
        if what == "all":
            result = store.clear_all()
        elif what == "deleted":
            result = store.clear_deleted()
        else:
            result = store.clear_completed()
        cleared = len(result.cleared_ids)
        remaining = result.remaining
        plural = "" if cleared == 1 else "s"
        if what == "all":
            reasoning = f"Cleared all {cleared} todos"
        elif what == "deleted":
            reasoning = f"Emptied {cleared} deleted todo{plural}, {remaining} remaining"
        elif cleared > 0:
            reasoning = f"Cleared {cleared} completed todo{plural}, {remaining} remaining"
        else:
            reasoning = f"No completed todos to clear, {remaining} remaining"
        return success(
            {"cleared": cleared, "remaining": remaining, "clearedIds": result.cleared_ids},
            reasoning=reasoning,
            confidence=1.0,
            warnings=(
                [Warning(code="PERMANENT", message="This action cannot be undone", severity="info")]
                if cleared > 0
                else None
            ),
        )

    return clear_todos
