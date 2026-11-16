"""Shared fixtures: each store kind, and a server on it with approvals off unless a test asks."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from afd.core.wire import to_wire
from afd.server import MCPServer
from afd.testing import assert_has_warnings

from todo_backend import FileStore, MemoryStore, SqliteStore, Store, create_app

StoreFactory = Callable[[], Store]


@pytest.fixture(params=["memory", "file", "sqlite"])
def make_store(request: pytest.FixtureRequest, tmp_path: Path) -> Iterator[StoreFactory]:
    """A factory for one kind of store; every store it makes in a test shares one location."""
    opened: list[SqliteStore] = []

    def make() -> Store:
        if request.param == "memory":
            return MemoryStore()
        if request.param == "file":
            return FileStore(tmp_path / "todos.json")
        store = SqliteStore(tmp_path / "todos.db")
        opened.append(store)
        return store

    yield make
    for store in opened:
        store.close()


@pytest.fixture
def store(make_store: StoreFactory) -> Store:
    return make_store()


@pytest.fixture
def server(store: Store) -> MCPServer:
    """The todo server on ``store``, approvals off (the conformance suites' setting)."""
    return create_app(store, {"APPROVALS": "off"})


async def call(server: MCPServer, name: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Call a tool the way an MCP client does (an agent) and return the JSON it would receive."""
    return to_wire(await server.call_tool(name, args or {}))


def warning_codes(result: Any) -> set[str]:
    """The codes of a result's warnings, which must have at least one."""
    return {
        warning["code"] if isinstance(warning, dict) else warning.code
        for warning in assert_has_warnings(result)
    }
