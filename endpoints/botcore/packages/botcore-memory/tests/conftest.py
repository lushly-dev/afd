"""Shared fixtures for botcore-memory tests."""

from __future__ import annotations

from pathlib import Path

import pytest
from botcore._test_temp import configure_pytest_temp

from botcore_memory.access import current_agent
from botcore_memory.commands import configure, reset
from botcore_memory.local_store import LocalMemoryStore
from botcore_memory.models import MemoryConfig


@pytest.fixture()
def tmp_store(tmp_path: Path) -> LocalMemoryStore:
    """A LocalMemoryStore rooted in a temporary directory."""
    return LocalMemoryStore(tmp_path)


@pytest.fixture()
def memory_config(tmp_path: Path) -> MemoryConfig:
    """MemoryConfig pointing at a temporary directory."""
    return MemoryConfig(local_path=str(tmp_path))


@pytest.fixture(autouse=True)
def _setup_commands(tmp_path: Path) -> None:
    """Configure the commands module to use a tmp_path store for every test."""
    config = MemoryConfig(local_path=str(tmp_path))
    configure(config)
    # Set a default agent context
    token = current_agent.set("test-agent")
    yield
    current_agent.reset(token)
    reset()


@pytest.fixture()
def set_agent():
    """Fixture to set the current agent for a test.

    Cleanup is handled by the autouse _setup_commands fixture which resets
    current_agent. We don't reset tokens here because pytest-asyncio runs
    async tests in a different Context than the fixture teardown.
    """

    def _set(name: str):
        current_agent.set(name)

    return _set


@pytest.fixture()
def memory_host(tmp_path: Path):
    """Build a remote-caller host serving the memory commands, optionally with an actor.

    The policies are test-only: the memory plugin declares none for managed hosts.
    """
    from botcore.context import ExecutionContext
    from botcore.host import CommandHost, CommandPolicy

    from botcore_memory.commands import MEMORY_COMMANDS

    writes = {"memory_set", "memory_delete"}

    def _build(actor=None) -> CommandHost:
        host = CommandHost("mem", ExecutionContext(tmp_path, profile="remote-caller"), actor=actor)
        for command in MEMORY_COMMANDS:
            name = command.__name__
            host.register(
                name, command, CommandPolicy(("history-write",) if name in writes else ("inspect",))
            )
        return host

    return _build


@pytest.fixture()
def no_direct_caller():
    """Clear the direct-call name the autouse fixture sets, so host paths cannot lean on it."""
    token = current_agent.set("")
    yield
    current_agent.reset(token)


def pytest_configure(config: pytest.Config) -> None:
    """On Windows, move ``tmp_path`` off a ``%TEMP%`` the token store refuses (#2713)."""
    configure_pytest_temp(config)
