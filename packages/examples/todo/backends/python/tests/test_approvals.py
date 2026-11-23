"""The approval hold on todo-clear (``APPROVALS``, ``TODO_APPROVAL_SECRET``), as the TypeScript
backend's ``src/server-options.ts``: held for any caller that is not a person, with a summary of
what would go, and run once a person's approval comes back."""

from __future__ import annotations

import pytest
from afd import Actor
from afd.core.commands import CommandContext
from afd.testing import assert_error, assert_has_suggestion, assert_retryable, assert_success
from conftest import call

from todo_backend import MemoryStore, create_app
from todo_backend.server import resolve_approval_secret, resolve_approvals

SECRET = "a-test-secret-that-is-at-least-32-bytes-long"
PERSON = Actor(kind="human", id="jas")


def test_approvals_default_to_agents_and_refuse_other_values():
    assert resolve_approvals({}) == "agents"
    assert resolve_approvals({"APPROVALS": "off"}) == "off"
    with pytest.raises(ValueError, match="APPROVALS must be agents or off"):
        resolve_approvals({"APPROVALS": "everyone"})


def test_the_secret_is_random_unless_set_and_at_least_32_bytes():
    assert len(resolve_approval_secret({})) == 32
    assert resolve_approval_secret({}) != resolve_approval_secret({})
    assert resolve_approval_secret({"TODO_APPROVAL_SECRET": SECRET}) == SECRET
    with pytest.raises(ValueError, match="at least 32 bytes"):
        resolve_approval_secret({"TODO_APPROVAL_SECRET": "short"})
    with pytest.raises(ValueError):
        create_app(MemoryStore(), {"TODO_APPROVAL_SECRET": "short"})


async def held_clear(server, input: dict | None = None) -> str:
    """Hold a clear from an agent and return the summary the person would see."""
    result = await call(server, "todo-clear", input or {})
    error = assert_error(result, "APPROVAL_REQUIRED")
    assert_has_suggestion(result)
    assert_retryable(result, expected=False)
    assert "approvalToken" not in error.details
    return error.details["summary"]


async def test_an_agents_clear_is_held_with_what_it_would_remove(store):
    server = create_app(store, {"TODO_APPROVAL_SECRET": SECRET})
    done = assert_success(await call(server, "todo-create", {"title": "Done"}))
    gone = assert_success(await call(server, "todo-create", {"title": "Gone"}))
    await call(server, "todo-toggle", {"id": done["id"]})
    await call(server, "todo-delete", {"id": gone["id"]})

    assert await held_clear(server) == "Remove the completed todos for good (1 todo now)"
    assert (
        await held_clear(server, {"deleted": True})
        == "Empty the deleted todos for good (1 todo now)"
    )
    assert (
        await held_clear(server, {"all": True})
        == "Remove every todo for good, live and deleted (2 todos now)"
    )
    # Nothing was removed, and nothing held was recorded
    assert assert_success(await call(server, "todo-list", {"completed": True}))["total"] == 1
    history = assert_success(await call(server, "todo-history"))
    assert "todo-clear" not in [entry["command"] for entry in history["entries"]]


async def test_only_the_clear_is_held(store):
    server = create_app(store, {})
    todo = assert_success(await call(server, "todo-create", {"title": "Delete me"}))
    assert_success(await call(server, "todo-delete", {"id": todo["id"]}))
    assert_success(await call(server, "todo-restore", {"ids": [todo["id"]]}))
    assert_success(await call(server, "todo-delete-batch", {"ids": [todo["id"]]}))


async def test_a_person_clears_without_approval(store):
    server = create_app(store, {})
    assert_success(await server.execute("todo-create", {"title": "Done"}))
    todo = store.list()[0]
    store.toggle(todo.id)

    cleared = assert_success(await server.execute("todo-clear", {}, CommandContext(actor=PERSON)))
    assert cleared["cleared"] == 1
    entry = store.history()[-1]
    assert entry["command"] == "todo-clear"
    assert entry["actor"] == {"kind": "human", "id": "jas"}


async def test_an_approved_clear_runs_once(store):
    """The surface retries with the token once a person approves; the token works once."""
    server = create_app(store, {"TODO_APPROVAL_SECRET": SECRET})
    agent = Actor(kind="agent", id="copilot")
    todo = assert_success(await server.execute("todo-create", {"title": "Done"}))
    store.toggle(todo.id)

    held = await server.execute("todo-clear", {}, CommandContext(actor=agent))
    token = assert_error(held, "APPROVAL_REQUIRED").details["approvalToken"]

    approved = CommandContext(actor=agent, approval=token)
    assert assert_success(await server.execute("todo-clear", {}, approved))["cleared"] == 1
    assert store.history()[-1]["actor"] == {"kind": "agent", "id": "copilot"}

    again = await server.execute("todo-clear", {}, CommandContext(actor=agent, approval=token))
    assert assert_error(again, "APPROVAL_REQUIRED").details["reason"] == "already-used"


async def test_approvals_off_holds_nothing(store):
    server = create_app(store, {"APPROVALS": "off"})
    assert_success(await call(server, "todo-clear", {"all": True}))
