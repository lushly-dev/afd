"""The todo commands, called through the MCP tool router on every store kind: the contract's
metadata, inputs and errors, undo, deleted todos and restore, and the change history."""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path
from typing import Any

import pytest
from afd import Actor, fixed_clock, seeded_random
from afd.core.commands import CommandContext
from afd.testing import (
    assert_error,
    assert_has_suggestion,
    assert_success,
    validate_command_definition,
)
from conftest import call, warning_codes

from todo_backend import MemoryStore, all_commands, create_app
from todo_backend.history import RECORDED_COMMANDS
from todo_backend.store import EXAMPLE_ROOT, HISTORY_LIMIT

SPEC_PATH = EXAMPLE_ROOT / "spec" / "commands.schema.json"


def spec_commands() -> dict[str, Any]:
    """The spec's commands that Python implements: those without ``implementedBy``, or naming it."""
    commands = json.loads(SPEC_PATH.read_text(encoding="utf-8"))["commands"]
    return {
        name: entry
        for name, entry in commands.items()
        if "python" in entry.get("implementedBy", ["python"])
    }


# ─── The contract ──────────────────────────────────────────────────────────────


def test_registers_exactly_the_spec_commands():
    spec = set(spec_commands())
    server = create_app(MemoryStore(), {})

    assert {command.name for command in server.list_commands()} == spec
    tools = {tool["name"] for tool in server.get_tool_definitions()}
    assert spec <= tools
    for command in server.list_commands():
        assert command.expose is not None and command.expose.mcp, command.name


def test_declares_the_spec_metadata():
    spec = spec_commands()
    for command in create_app(MemoryStore(), {}).list_commands():
        expected = dict(spec[command.name]["metadata"])
        expected["contexts"] = sorted(expected["contexts"])
        declared: dict[str, Any] = {
            "mutation": command.mutation,
            "destructive": bool(command.destructive),
            "contexts": sorted(command.contexts),
        }
        if command.confirm_prompt:
            declared["confirmPrompt"] = command.confirm_prompt
        assert declared == expected, command.name


def test_accepts_every_spec_input_property():
    """Each input property the spec gives Python (``x-implementedBy`` included) is accepted."""
    definitions = {
        command.name: command for command in create_app(MemoryStore(), {}).list_commands()
    }
    for name, entry in spec_commands().items():
        properties = entry["input"].get("properties", {})
        accepted = set(definitions[name].input_schema.get("properties", {}))
        for prop, schema in properties.items():
            if "python" in schema.get("x-implementedBy", ["python"]):
                assert prop in accepted, f"{name}.{prop}"


def test_every_command_has_a_title_an_output_schema_and_examples():
    for command in create_app(MemoryStore(), {}).list_commands():
        assert command.title, command.name
        assert command.returns, command.name
        assert command.examples, command.name
        assert command.version == "1.0.0", command.name
        assert validate_command_definition(command).valid, command.name


def test_every_mutation_declares_approval_and_undo_as_typescript():
    undoable = {
        "todo-create",
        "todo-update",
        "todo-toggle",
        "todo-delete",
        "todo-create-batch",
        "todo-delete-batch",
        "todo-toggle-batch",
        "todo-restore",
    }
    for command in create_app(MemoryStore(), {}).list_commands():
        if command.mutation:
            assert command.approval is not None, command.name
        assert bool(command.undoable) == (command.name in undoable), command.name
    assert set(RECORDED_COMMANDS) == undoable | {"todo-clear"}


def test_history_description_states_the_limit():
    history = next(
        c for c in all_commands(MemoryStore()) if c.__afd_command__.name == "todo-history"
    )
    assert f"latest {HISTORY_LIMIT} changes" in history.__afd_command__.description


def test_registers_the_todo_contexts():
    tools = {tool["name"] for tool in create_app(MemoryStore(), {}).get_tool_definitions()}
    assert {"afd-context-list", "afd-context-enter", "afd-context-exit"} <= tools


async def test_reading_context_hides_the_changes():
    server = create_app(MemoryStore(), {"APPROVALS": "off"})
    assert_success(await call(server, "afd-context-enter", {"context": "todo-reading"}))

    assert_success(await call(server, "todo-history"))
    assert_error(await call(server, "todo-restore", {"ids": ["x"]}), "COMMAND_NOT_IN_CONTEXT")


def test_todo_server_script_is_installed():
    scripts = Path(sys.executable).parent
    assert shutil.which("todo-server", path=str(scripts)) is not None


# ─── Behaviour ─────────────────────────────────────────────────────────────────


async def test_create_applies_defaults_omits_unset_fields_and_names_its_undo(server):
    result = await call(server, "todo-create", {"title": "Write tests"})

    todo = assert_success(result)
    assert todo["title"] == "Write tests"
    assert todo["priority"] == "medium"
    assert todo["completed"] is False
    assert todo["id"].startswith("todo-")
    assert todo["createdAt"].endswith("Z")
    assert "description" not in todo
    assert "completedAt" not in todo
    assert result["undoCommand"] == "todo-delete"
    assert result["undoArgs"] == {"id": todo["id"]}


async def test_ids_and_times_come_from_the_context_as_in_typescript(store):
    """A fixed clock and a seeded random give TypeScript's id: todo-<ms>-<7 base-36 digits>."""
    server = create_app(store, {"APPROVALS": "off"})
    context = CommandContext(clock=fixed_clock("2026-11-15T09:00:00Z"), random=seeded_random("a"))
    todo = assert_success(await server.execute("todo-create", {"title": "Seeded"}, context))

    assert todo.createdAt == "2026-11-15T09:00:00.000Z"
    assert todo.id.startswith("todo-1794733200000-")
    assert len(todo.id.rsplit("-", 1)[1]) == 7


@pytest.mark.parametrize(
    "args",
    [
        {"title": ""},
        {"title": "x" * 201},
        {"title": "Bad priority", "priority": "urgent"},
        {"title": "Long description", "description": "d" * 1001},
    ],
)
async def test_create_rejects_invalid_input(server, args):
    result = await call(server, "todo-create", args)
    assert_error(result, "VALIDATION_ERROR")
    assert_has_suggestion(result)


async def test_list_filters_paginates_and_offers_alternatives(server):
    for title, priority in [("A", "high"), ("B", "low"), ("C", "high")]:
        await call(server, "todo-create", {"title": title, "priority": priority})

    page = assert_success(await call(server, "todo-list", {"limit": 2}))
    assert page["total"] == 3
    assert len(page["todos"]) == 2
    assert page["hasMore"] is True

    high = await call(
        server, "todo-list", {"priority": "high", "sortBy": "title", "sortOrder": "asc"}
    )
    assert [todo["title"] for todo in assert_success(high)["todos"]] == ["A", "C"]
    assert high["alternatives"][0]["data"]["total"] == 3

    assert_error(await call(server, "todo-list", {"limit": 101}), "VALIDATION_ERROR")


async def test_missing_todos_say_where_deleted_ones_are(server):
    for name, args in [
        ("todo-get", {"id": "missing"}),
        ("todo-update", {"id": "missing", "title": "New"}),
        ("todo-toggle", {"id": "missing"}),
        ("todo-delete", {"id": "missing"}),
    ]:
        result = await call(server, name, args)
        assert_error(result, "NOT_FOUND")
        suggestion = assert_has_suggestion(result)
        assert "todo-list { deleted: true }" in suggestion, name
        assert "todo-restore" in suggestion, name


async def test_update_without_fields_returns_no_changes(server):
    created = assert_success(await call(server, "todo-create", {"title": "Same"}))
    result = await call(server, "todo-update", {"id": created["id"]})
    assert_error(result, "NO_CHANGES")
    assert_has_suggestion(result)


async def test_update_names_the_previous_values_as_its_undo(server):
    todo = assert_success(await call(server, "todo-create", {"title": "Before", "priority": "low"}))
    result = await call(
        server,
        "todo-update",
        {"id": todo["id"], "title": "After", "description": "Added", "priority": "high"},
    )
    assert_success(result)
    assert result["undoCommand"] == "todo-update"
    assert result["undoArgs"] == {
        "id": todo["id"],
        "title": "Before",
        "description": "",
        "priority": "low",
    }

    undone = assert_success(await call(server, "todo-update", result["undoArgs"]))
    assert undone["title"] == "Before"
    assert undone["priority"] == "low"
    assert "description" not in undone


async def test_toggle_sets_and_clears_completed_at_and_names_its_undo(server):
    todo_id = assert_success(await call(server, "todo-create", {"title": "Toggle"}))["id"]

    done = await call(server, "todo-toggle", {"id": todo_id})
    assert assert_success(done)["completed"] is True
    assert done["data"]["completedAt"]
    assert done["undoCommand"] == "todo-update"
    assert done["undoArgs"] == {"id": todo_id, "completed": False}

    pending = assert_success(await call(server, "todo-toggle", {"id": todo_id}))
    assert pending["completed"] is False
    assert "completedAt" not in pending


async def test_delete_keeps_the_todo_until_restored(server):
    todo = assert_success(await call(server, "todo-create", {"title": "Back", "priority": "high"}))
    deleted = await call(server, "todo-delete", {"id": todo["id"]})

    assert assert_success(deleted) == {"deleted": True, "id": todo["id"]}
    assert "RESTORABLE" in warning_codes(deleted)
    assert deleted["undoCommand"] == "todo-restore"
    assert deleted["undoArgs"] == {"ids": [todo["id"]]}
    assert_error(await call(server, "todo-get", {"id": todo["id"]}), "NOT_FOUND")
    listed = assert_success(await call(server, "todo-list", {"deleted": True}))
    assert listed["total"] == 1
    assert listed["todos"][0]["deletedAt"]
    assert assert_success(await call(server, "todo-stats"))["total"] == 0

    restored = await call(server, "todo-restore", deleted["undoArgs"])
    assert assert_success(restored)["restoredIds"] == [todo["id"]]
    assert restored["undoCommand"] == "todo-delete-batch"
    again = assert_success(await call(server, "todo-get", {"id": todo["id"]}))
    assert again == todo


async def test_restore_reports_each_id_it_cannot_restore(server):
    live = assert_success(await call(server, "todo-create", {"title": "Live"}))
    result = await call(server, "todo-restore", {"ids": ["never", live["id"]]})

    data = assert_success(result)
    assert data["summary"] == {"total": 2, "successCount": 0, "failureCount": 2}
    assert [item["error"]["message"] for item in data["failed"]] == [
        'No deleted todo has ID "never"',
        f'Todo "{live["id"]}" is not deleted',
    ]
    assert all(item["error"]["suggestion"] for item in data["failed"])
    assert result["reasoning"] == "Restored none of 2: no deleted todo has those IDs"
    assert "undoCommand" not in result


async def test_list_sorts_deleted_todos_by_deleted_at(store):
    server = create_app(store, {"APPROVALS": "off"})
    first = assert_success(await server.execute("todo-create", {"title": "First"}))
    second = assert_success(await server.execute("todo-create", {"title": "Second"}))
    for todo, at in [(second, "2026-11-15T09:00:00Z"), (first, "2026-11-15T10:00:00Z")]:
        context = CommandContext(clock=fixed_clock(at))
        assert_success(await server.execute("todo-delete", {"id": todo.id}, context))

    listed = assert_success(
        await server.execute("todo-list", {"deleted": True, "sortBy": "deletedAt"})
    )
    assert [todo.title for todo in listed["todos"]] == ["First", "Second"]


async def test_clear_completed_deleted_and_all(server):
    first = assert_success(await call(server, "todo-create", {"title": "Done", "priority": "high"}))
    await call(server, "todo-create", {"title": "Pending"})
    gone = assert_success(await call(server, "todo-create", {"title": "Gone"}))
    await call(server, "todo-toggle", {"id": first["id"]})
    await call(server, "todo-delete", {"id": gone["id"]})

    stats = assert_success(await call(server, "todo-stats"))
    assert stats == {
        "total": 2,
        "completed": 1,
        "pending": 1,
        "byPriority": {"low": 0, "medium": 1, "high": 1},
        "completionRate": 0.5,
    }

    cleared = await call(server, "todo-clear")
    assert assert_success(cleared) == {"cleared": 1, "remaining": 1, "clearedIds": [first["id"]]}
    assert "PERMANENT" in warning_codes(cleared)

    emptied = await call(server, "todo-clear", {"deleted": True})
    assert assert_success(emptied) == {"cleared": 1, "remaining": 1, "clearedIds": [gone["id"]]}
    assert emptied["reasoning"] == "Emptied 1 deleted todo, 1 remaining"

    cleared_all = assert_success(await call(server, "todo-clear", {"all": True}))
    assert cleared_all["cleared"] == 1
    assert cleared_all["remaining"] == 0


async def test_batch_commands_report_partial_failures_and_their_undo(server):
    created = await call(
        server, "todo-create-batch", {"todos": [{"title": "One"}, {"title": "   "}]}
    )
    data = assert_success(created)
    assert data["summary"] == {"total": 2, "successCount": 1, "failureCount": 1}
    assert data["failed"][0]["index"] == 1
    assert data["failed"][0]["error"]["code"] == "VALIDATION_ERROR"
    assert created["confidence"] == 0.5
    todo_id = data["succeeded"][0]["id"]
    assert created["undoCommand"] == "todo-delete-batch"
    assert created["undoArgs"] == {"ids": [todo_id]}

    toggled = await call(server, "todo-toggle-batch", {"ids": [todo_id], "completed": True})
    assert assert_success(toggled)["summary"]["markedComplete"] == 1
    assert toggled["undoArgs"] == {"ids": [todo_id], "completed": False}

    deleted = await call(server, "todo-delete-batch", {"ids": [todo_id, "missing"]})
    assert assert_success(deleted)["deletedIds"] == [todo_id]
    assert deleted["data"]["failed"][0]["error"]["code"] == "NOT_FOUND"
    assert "DESTRUCTIVE_BATCH" in warning_codes(deleted)
    assert "PARTIAL_SUCCESS" in warning_codes(deleted)
    assert deleted["undoArgs"] == {"ids": [todo_id]}

    assert_error(await call(server, "todo-delete-batch", {"ids": []}), "VALIDATION_ERROR")


async def test_a_mixed_toggle_has_no_single_undo(server):
    open_todo = assert_success(await call(server, "todo-create", {"title": "Open"}))
    done = assert_success(await call(server, "todo-create", {"title": "Done"}))
    await call(server, "todo-toggle", {"id": done["id"]})

    result = await call(server, "todo-toggle-batch", {"ids": [open_todo["id"], done["id"]]})
    assert_success(result)
    assert "NO_SINGLE_UNDO" in warning_codes(result)
    assert "undoCommand" not in result


# ─── History ───────────────────────────────────────────────────────────────────


async def test_history_records_actor_time_ids_and_undo(store):
    server = create_app(store, {"APPROVALS": "off"})
    agent = await call(server, "todo-create", {"title": "By an agent"})
    agent_id = assert_success(agent)["id"]
    person = CommandContext(
        actor=Actor(kind="human", id="jas"),
        clock=fixed_clock("2026-11-15T09:00:00Z"),
    )
    assert_success(await server.execute("todo-toggle", {"id": agent_id}, person))

    history = assert_success(await call(server, "todo-history"))
    assert history["total"] == 2
    latest, first = history["entries"]
    assert latest == {
        "seq": 2,
        "at": "2026-11-15T09:00:00.000Z",
        "actor": {"kind": "human", "id": "jas"},
        "command": "todo-toggle",
        "ids": [agent_id],
        "undoCommand": "todo-update",
        "undoArgs": {"id": agent_id, "completed": False},
    }
    # A later change touched the same todo, so the create's undo is no longer offered
    assert first["actor"] == {"kind": "agent"}
    assert first["superseded"] is True
    assert "undoCommand" not in first

    by_agents = assert_success(await call(server, "todo-history", {"actor": "agent"}))
    assert [entry["command"] for entry in by_agents["entries"]] == ["todo-create"]
    by_todo = assert_success(await call(server, "todo-history", {"todoId": "other"}))
    assert by_todo == {"entries": [], "total": 0, "hasMore": False}


async def test_history_skips_failures_and_changes_that_touched_nothing(server):
    await call(server, "todo-get", {"id": "missing"})
    await call(server, "todo-delete", {"id": "missing"})
    await call(server, "todo-clear")

    assert assert_success(await call(server, "todo-history"))["total"] == 0


async def test_history_keeps_the_latest_changes(store, monkeypatch):
    limit = 5  # HISTORY_LIMIT, made small so the file and SQLite stores stay quick
    monkeypatch.setattr("todo_backend.store.memory.HISTORY_LIMIT", limit)
    monkeypatch.setattr("todo_backend.store.sqlite.HISTORY_LIMIT", limit)
    for index in range(limit + 2):
        store.record({"at": "t", "actor": {"kind": "test"}, "command": f"c{index}", "ids": ["a"]})

    history = store.history()
    assert [entry["seq"] for entry in history] == list(range(3, limit + 3))
