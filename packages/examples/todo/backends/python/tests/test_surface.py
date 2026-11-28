"""``afd validate --surface`` reports no undeclared mutation on this backend
(``spec/idempotency.md``, D4): each of its nine mutations declares ``natural`` or ``keyed``, as the
TypeScript backend's do.

The commands are collected as the CLI collects them from a connected server's tool listing and
its ``afd-help`` (the ``afd`` package's ``tests/test_cli_surface_commands.py`` covers the CLI's
own collection); this backend does not install the CLI. The keyed batch that may run as a task
keeps its promise in its handler (D5), which the last test checks.
"""

from __future__ import annotations

from typing import Any

from afd.core.wire import to_wire
from afd.testing.surface.validate import validate_command_surface

from todo_backend import create_app

MUTATIONS = {
    "todo-create": "keyed",
    "todo-update": "keyed",
    "todo-toggle": "keyed",
    "todo-delete": "natural",
    "todo-create-batch": "keyed",
    "todo-toggle-batch": "keyed",
    "todo-delete-batch": "natural",
    "todo-restore": "natural",
    "todo-clear": "natural",
}


def _undeclared(commands: list[dict[str, Any]]) -> list[str]:
    result = validate_command_surface(commands)
    assert "missing-idempotency" in result.summary.rules_evaluated
    return [
        name
        for finding in result.findings
        if finding.rule == "missing-idempotency"
        for name in finding.commands
    ]


async def test_afd_help_reports_each_declaration(store):
    helped = to_wire(await create_app(store).execute("afd-help", {"format": "full"}))
    commands = [
        {
            "name": item["name"],
            "description": item.get("description", ""),
            "mutation": item.get("mutation"),
            "idempotency": item.get("idempotency"),
        }
        for item in helped["data"]["commands"]
        if not item["name"].startswith("afd-")
    ]
    declared = {c["name"]: c["idempotency"] for c in commands if c["mutation"] is True}
    assert declared == MUTATIONS
    assert _undeclared(commands) == []


def _listed(tool: dict[str, Any]) -> list[dict[str, Any]]:
    """The commands a tool lists: the tool's own, or a grouped tool's ``_meta.actions``."""
    meta = tool.get("_meta") or {}
    if "actions" not in meta:
        return [{"name": tool["name"], "description": tool.get("description", ""), **meta}]
    return [{"name": action["command"], **action} for action in meta["actions"]]


def test_the_tool_listing_reports_each_declaration(store):
    commands = [
        {
            "name": entry["name"],
            "description": entry.get("description", ""),
            "mutation": entry.get("mutation"),
            "idempotency": entry.get("idempotency"),
        }
        for tool in create_app(store).get_tool_definitions()
        for entry in _listed(tool)
        if not entry["name"].startswith("afd-")
    ]
    declared = {c["name"]: c["idempotency"] for c in commands if c["mutation"] is True}
    assert declared == MUTATIONS
    assert _undeclared(commands) == []


async def test_an_undeclared_mutation_is_reported():
    commands = [
        {"name": "todo-archive", "description": "Archive a todo", "mutation": True},
        {"name": "todo-list", "description": "List todos", "mutation": False},
    ]
    assert _undeclared(commands) == ["todo-archive"]


async def test_a_repeated_keyed_batch_task_run_creates_its_todos_once(store):
    """todo-create-batch may run as an MCP task, on which the server's step does not act (S11),
    so it answers a repeat with the same key itself (D5)."""
    from afd import Actor
    from afd.core.commands import CommandContext

    server = create_app(store, {})
    batch = {"todos": [{"title": "Net the brassicas"}, {"title": "Sow the broad beans"}]}

    def task_run(key: str) -> CommandContext:
        return CommandContext(
            actor=Actor(kind="agent", id="a1"), idempotency_key=key, _task_run=True
        )

    first = await server.execute("todo-create-batch", batch, task_run("b1"))
    again = await server.execute("todo-create-batch", batch, task_run("b1"))
    assert first.success and again.success
    assert [t.id for t in again.data["succeeded"]] == [t.id for t in first.data["succeeded"]]
    other = await server.execute(
        "todo-create-batch", {"todos": [{"title": "Prune"}]}, task_run("b1")
    )
    assert other.error.code == "IDEMPOTENCY_KEY_REUSED"
    assert other.error.suggestion
    listed = await server.execute("todo-list", {})
    assert listed.data["total"] == 2
