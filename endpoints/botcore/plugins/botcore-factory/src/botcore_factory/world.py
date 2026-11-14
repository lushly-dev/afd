"""The factory's only door to the outside.

Six protocols name everything the plugin reads or changes outside its own state: GitHub, git,
the clock, the machine, plans and processes. Commands receive a ``World`` holding one of each;
nothing else in the plugin imports ``subprocess`` or calls ``gh``. ``real_world`` implements
them against the machine and ``fixture_world`` against a scenario fixture.

A failed outside read or write raises ``WorldError``. Commands turn it into ``READ_FAILED`` or
``WRITE_FAILED``; a failed read is never reported as an empty, clean answer.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol, runtime_checkable

#: The repository variable naming the lane host, so every machine reads the same answer.
LANE_HOST_VARIABLE = "FACTORY_LANE_HOST"


class WorldError(Exception):
    """An outside read or write failed, or returned something that cannot be trusted."""


@dataclass(frozen=True)
class Issue:
    """An issue as GitHub reports it."""

    number: int
    title: str = ""
    labels: tuple[str, ...] = ()
    assignees: tuple[str, ...] = ()
    created_at: str = ""
    state: str = "OPEN"

    @property
    def assigned(self) -> bool:
        return bool(self.assignees)


@dataclass(frozen=True)
class Comment:
    """One issue comment, oldest first in every list."""

    id: str
    body: str
    author: str = ""
    created_at: str = ""


@dataclass(frozen=True)
class PullRequest:
    """An open pull request and the issues it would close."""

    number: int
    branch: str = ""
    closes: tuple[int, ...] = ()


@dataclass(frozen=True)
class HostRecord:
    """A machine's readiness record, as `lane-host-probe` publishes it to refs/factory/hosts."""

    id: str
    name: str = ""
    cores: int | None = None
    memory_gb: float | None = None
    free_disk_gb: float | None = None
    missing: tuple[str, ...] = ()
    measured: bool = False
    suggested_slots: int = 1
    probed_at: str | None = None
    extra: dict = field(default_factory=dict, compare=False)


@dataclass(frozen=True)
class Plan:
    """One plan's weekly window: shares of the window used and elapsed, in percent."""

    id: str
    provider: str
    used: float
    elapsed: float
    resets_at: str | None = None

    @property
    def room(self) -> float:
        return self.elapsed - self.used


@dataclass(frozen=True)
class Completed:
    """A finished process run."""

    args: tuple[str, ...]
    returncode: int
    stdout: str = ""
    stderr: str = ""


@runtime_checkable
class GitHub(Protocol):
    """Issues with labels, assignees and comments; open PRs; repository variables."""

    def repository(self) -> str:
        """The repository as ``owner/name``."""
        ...

    def list_issues(self) -> list[Issue]:
        """Every open issue. Raises WorldError on a failed or possibly truncated read."""
        ...

    def get_issue(self, number: int) -> Issue: ...

    def comments(self, number: int) -> list[Comment]: ...

    def edit_labels(
        self, number: int, add: Sequence[str] = (), remove: Sequence[str] = ()
    ) -> None: ...

    def add_comment(self, number: int, body: str) -> Comment: ...

    def open_pull_requests(self) -> list[PullRequest]: ...

    def get_variable(self, name: str) -> str | None:
        """A repository variable's value, or None when it is not set."""
        ...

    def set_variable(self, name: str, value: str) -> None: ...


@runtime_checkable
class Git(Protocol):
    """The checkout and the factory's refs on origin."""

    def host_records(self) -> list[HostRecord]:
        """The readiness records published to ``refs/factory/hosts/*`` on origin."""
        ...

    def head(self, worktree: str) -> str: ...

    def branch(self, worktree: str) -> str | None: ...

    def is_clean(self, worktree: str) -> bool: ...


@runtime_checkable
class Clock(Protocol):
    def now(self) -> datetime:
        """The current time, timezone-aware (UTC)."""
        ...


@runtime_checkable
class Machine(Protocol):
    """The machine this process runs on."""

    def id(self) -> str:
        """The machine's own name: COMPUTERNAME on Windows, LocalHostName on macOS."""
        ...

    def cores(self) -> int: ...

    def memory_gb(self) -> float: ...

    def free_memory_gb(self) -> float: ...

    def free_disk_gb(self, path: str) -> float: ...


@runtime_checkable
class Plans(Protocol):
    def read(self) -> list[Plan]:
        """Each plan's weekly window. Raises WorldError when the plans cannot be read."""
        ...


@runtime_checkable
class Processes(Protocol):
    def alive(self, pid: int, started_at: float | None = None) -> bool:
        """Whether ``pid`` runs and, when ``started_at`` is given and the platform reports
        process start times, is the same process that started then (not a reused pid)."""
        ...

    def start_time(self, pid: int) -> float | None:
        """The process's start as epoch seconds, or None where the platform cannot say."""
        ...

    def run(self, args: Sequence[str], cwd: str, timeout: float | None = None) -> Completed:
        """Run an argument list (never a shell string) and wait for it."""
        ...


@dataclass(frozen=True)
class World:
    """Everything outside the plugin's own state, injected into every command."""

    github: GitHub
    git: Git
    clock: Clock
    machine: Machine
    plans: Plans
    processes: Processes
