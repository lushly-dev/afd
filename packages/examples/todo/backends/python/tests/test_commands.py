"""Smoke tests for the todo commands, called through the MCP tool router."""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path
from typing import Any, Dict

import pytest

from todo_backend import MemoryStore, create_app
from todo_backend.store import EXAMPLE_ROOT

SPEC_PATH = EXAMPLE_ROOT / "spec" / "commands.schema.json"


@pytest.fixture
def server():
    return create_app(MemoryStore())


async def call(server, name: str, args: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Call a tool the way an MCP client does and return the JSON it would receive."""
    result = await server.call_tool(name, args or {})
    return json.loads(json.dumps(result.model_dump(mode="json")))


def test_registers_exactly_the_spec_commands():
    spec_commands = set(json.loads(SPEC_PATH.read_text(encoding="utf-8"))["commands"])
    server = create_app(MemoryStore())

    registered = {command.name for command in server.list_commands()}
    assert registered == spec_commands

    tools = {tool["name"] for tool in server.get_tool_definitions()}
    assert spec_commands <= tools
    for command in server.list_commands():
        assert command.expose is not None and command.expose.mcp, command.name


def test_todo_server_script_is_installed():
    scripts = Path(sys.executable).parent
    assert shutil.which("todo-server", path=str(scripts)) is not None


async def test_create_applies_defaults_and_omits_unset_fields(server):
    result = await call(server, "todo-create", {"title": "Write tests"})

    assert result["success"] is True
    todo = result["data"]
    assert todo["title"] == "Write tests"
    assert todo["priority"] == "medium"
    assert todo["completed"] is False
    assert todo["id"].startswith("todo-")
    assert todo["createdAt"].endswith("Z")
    assert "description" not in todo
    assert "completedAt" not in todo


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

    assert result["success"] is False
    assert result["error"]["code"] == "VALIDATION_ERROR"
    assert result["error"]["suggestion"]


async def test_create_accepts_a_200_character_title(server):
    result = await call(server, "todo-create", {"title": "x" * 200})
    assert result["success"] is True


async def test_list_filters_and_paginates(server):
    for title, priority in [("A", "high"), ("B", "low"), ("C", "high")]:
        await call(server, "todo-create", {"title": title, "priority": priority})

    page = await call(server, "todo-list", {"limit": 2})
    assert page["data"]["total"] == 3
    assert len(page["data"]["todos"]) == 2
    assert page["data"]["hasMore"] is True

    high = await call(
        server, "todo-list", {"priority": "high", "sortBy": "title", "sortOrder": "asc"}
    )
    assert [todo["title"] for todo in high["data"]["todos"]] == ["A", "C"]
    assert high["alternatives"][0]["data"]["total"] == 3

    too_many = await call(server, "todo-list", {"limit": 101})
    assert too_many["error"]["code"] == "VALIDATION_ERROR"


async def test_missing_todos_return_not_found_with_a_kebab_case_suggestion(server):
    for name, args in [
        ("todo-get", {"id": "missing"}),
        ("todo-update", {"id": "missing", "title": "New"}),
        ("todo-toggle", {"id": "missing"}),
        ("todo-delete", {"id": "missing"}),
    ]:
        result = await call(server, name, args)
        assert result["error"]["code"] == "NOT_FOUND", name
        assert "todo-list" in result["error"]["suggestion"], name


async def test_update_without_fields_returns_no_changes(server):
    created = await call(server, "todo-create", {"title": "Same"})
    result = await call(server, "todo-update", {"id": created["data"]["id"]})

    assert result["error"]["code"] == "NO_CHANGES"
    assert result["error"]["suggestion"]


async def test_toggle_sets_and_clears_completed_at(server):
    created = await call(server, "todo-create", {"title": "Toggle"})
    todo_id = created["data"]["id"]

    done = await call(server, "todo-toggle", {"id": todo_id})
    assert done["data"]["completed"] is True
    assert done["data"]["completedAt"]

    pending = await call(server, "todo-toggle", {"id": todo_id})
    assert pending["data"]["completed"] is False
    assert "completedAt" not in pending["data"]


async def test_clear_and_stats(server):
    first = await call(server, "todo-create", {"title": "Done", "priority": "high"})
    await call(server, "todo-create", {"title": "Pending"})
    await call(server, "todo-toggle", {"id": first["data"]["id"]})

    stats = await call(server, "todo-stats")
    assert stats["data"] == {
        "total": 2,
        "completed": 1,
        "pending": 1,
        "byPriority": {"low": 0, "medium": 1, "high": 1},
        "completionRate": 0.5,
    }

    cleared = await call(server, "todo-clear")
    assert cleared["data"] == {"cleared": 1, "remaining": 1}
    assert cleared["warnings"][0]["code"] == "PERMANENT"

    cleared_all = await call(server, "todo-clear", {"all": True})
    assert cleared_all["data"] == {"cleared": 1, "remaining": 0}


async def test_batch_commands_report_partial_failures(server):
    created = await call(
        server, "todo-create-batch", {"todos": [{"title": "One"}, {"title": "   "}]}
    )
    assert created["data"]["summary"] == {"total": 2, "successCount": 1, "failureCount": 1}
    assert created["data"]["failed"][0]["index"] == 1
    assert created["data"]["failed"][0]["error"]["code"] == "VALIDATION_ERROR"
    assert created["confidence"] == 0.5

    todo_id = created["data"]["succeeded"][0]["id"]
    toggled = await call(server, "todo-toggle-batch", {"ids": [todo_id], "completed": True})
    assert toggled["data"]["summary"]["markedComplete"] == 1

    deleted = await call(server, "todo-delete-batch", {"ids": [todo_id, "missing"]})
    assert deleted["data"]["deletedIds"] == [todo_id]
    assert deleted["data"]["failed"][0]["error"]["code"] == "NOT_FOUND"
    assert {warning["code"] for warning in deleted["warnings"]} == {
        "DESTRUCTIVE_BATCH",
        "PARTIAL_SUCCESS",
    }

    empty = await call(server, "todo-delete-batch", {"ids": []})
    assert empty["error"]["code"] == "VALIDATION_ERROR"
