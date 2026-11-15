"""The todo server's contexts, the same as the TypeScript backend's ``src/contexts.ts``.

With no context entered every command is visible. Entering ``todo-reading`` limits an agent
to the commands that read, so it can review the list without changing it; ``todo-editing``
shows every command.
"""

from __future__ import annotations

from afd.server import ContextConfig

TODO_CONTEXTS = [
    ContextConfig(
        name="todo-reading",
        description="Review todos without changing them: list, get and stats only",
        triggers=["review", "summarize", "report", "what is left"],
    ),
    ContextConfig(
        name="todo-editing",
        description="Add, change, complete and remove todos",
        triggers=["add", "create", "complete", "update", "delete", "clear"],
    ),
]

READ_CONTEXTS = ["todo-reading", "todo-editing"]
"""Commands that only read, visible in both contexts."""

EDIT_CONTEXTS = ["todo-editing"]
"""Commands that change todos, hidden while reading."""
