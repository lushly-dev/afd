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

    def describe(self) -> dict:
        """The record as published (``host.json``) and as lane-host-list shows it."""
        return {
            "id": self.id,
            "name": self.name or self.id,
            "cores": self.cores,
            "memoryGb": self.memory_gb,
            "freeDiskGb": self.free_disk_gb,
            "missing": list(self.missing),
            "measured": self.measured,
            "suggestedSlots": self.suggested_slots,
            "probedAt": self.probed_at,
            **self.extra,
        }

    @classmethod
    def read(cls, raw: dict, fallback_id: str = "") -> HostRecord:
        known = {
            "id",
            "name",
            "cores",
            "memoryGb",
            "freeDiskGb",
            "missing",
            "measured",
            "suggestedSlots",
            "probedAt",
            "reachable",
        }
        return cls(
            id=raw.get("id") or fallback_id,
            name=raw.get("name", ""),
            cores=raw.get("cores"),
            memory_gb=raw.get("memoryGb"),
            free_disk_gb=raw.get("freeDiskGb"),
            missing=tuple(raw.get("missing", [])),
            measured=bool(raw.get("measured", False)),
            suggested_slots=int(raw.get("suggestedSlots", 1)),
            probed_at=raw.get("probedAt"),
            extra={key: value for key, value in raw.items() if key not in known},
        )


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
class MergeOutcome:
    """Merging the default branch into a slot: the merged head, or the conflicting paths."""

    clean: bool
    head: str = ""
    conflicts: tuple[str, ...] = ()


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

    def signed_in(self) -> bool:
        """Whether ``gh`` is signed in on this machine."""
        ...

    def required_checks(self, branch: str) -> list[str]:
        """The status checks required on ``branch`` (branch protection and rulesets)."""
        ...

    def open_pr(self, branch: str, title: str, body: str) -> int:
        """Open a PR from ``branch`` to the default branch, or return the open one's number."""
        ...

    def check_status(self, pr: int, name: str) -> str:
        """The PR's check ``name``: ``success``, ``failure``, ``pending`` or ``missing``."""
        ...

    def merge_pr(self, pr: int, head: str) -> None:
        """Squash-merge the PR, only if its head is still ``head``."""
        ...

    def pr_state(self, pr: int) -> str:
        """``OPEN``, ``MERGED`` or ``CLOSED``."""
        ...


@runtime_checkable
class Git(Protocol):
    """The checkout and the factory's refs on origin."""

    def host_records(self) -> list[HostRecord]:
        """The readiness records published to ``refs/factory/hosts/*`` on origin."""
        ...

    def head(self, worktree: str) -> str: ...

    def branch(self, worktree: str) -> str | None: ...

    def uncommitted(self, worktree: str) -> list[str]:
        """The paths with uncommitted changes (tracked or untracked); empty when clean."""
        ...

    def changed_files(self, worktree: str, since: str | None = None) -> list[str]:
        """The paths the worktree's HEAD changed since ``since`` (a commit), or since it left
        origin's default branch when ``since`` is None."""
        ...

    def push_queue_ref(self, worktree: str, branch: str, head: str) -> None:
        """Push ``head`` to ``refs/factory/queue/<branch>`` on origin, so a replacement host can
        rebuild the queue."""
        ...

    def queue_refs(self) -> list[dict]:
        """``{branch, head}`` for every ``refs/factory/queue/*`` on origin."""
        ...

    def publish_host_record(self, record: HostRecord) -> None:
        """Publish this machine's readiness record to ``refs/factory/hosts/<id>`` on origin."""
        ...

    def origin_reachable(self) -> bool: ...

    def read_file(self, worktree: str, path: str) -> str | None:
        """A file in a worktree (a PR body), or None when it is not there."""
        ...

    def fetch_main(self) -> str:
        """Fetch origin and return the default branch's head. Failing is the lane's trouble."""
        ...

    def prepare_slot(self, slot: str, branch: str, head: str) -> str:
        """Check ``head`` out, detached and clean, in the lane's worktree for ``slot``; its path.

        Raises WorldError when the head cannot be checked out (the entry is invalid).
        """
        ...

    def merge_main(self, path: str, main: str) -> MergeOutcome:
        """Merge ``main`` into the slot's head. A conflict is aborted and reported, never
        resolved."""
        ...

    def tree(self, path: str) -> str: ...

    def push_branch(self, path: str, branch: str) -> str:
        """Push the slot's HEAD to ``branch`` on origin (no force); the head pushed."""
        ...


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

    def has_program(self, name: str) -> bool: ...

    def symlinks(self) -> bool:
        """Whether this user can create symlinks (Windows needs Developer Mode)."""
        ...

    def tool_version(self, tool: str) -> str | None:
        """The installed version of ``tool`` (node, pnpm, ...), or None when it is missing."""
        ...


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

    def run(
        self,
        args: Sequence[str],
        cwd: str,
        timeout: float | None = None,
        *,
        label: str | None = None,
    ) -> Completed:
        """Run an argument list (never a shell string) and wait for it.

        ``label`` says what the run is for (``prequeue:lint``, ``review-evidence``), so a fixture
        world can answer it; the real world ignores it.
        """
        ...

    def start(self, args: Sequence[str], cwd: str, log: str, *, label: str) -> str:
        """Start a background run writing its output to ``log``; a handle to poll."""
        ...

    def poll(self, handle: str) -> Completed | None:
        """The finished run (``stdout`` carries its log's tail), or None while it runs."""
        ...

    def kill(self, handle: str) -> None: ...

    def start_detached(self, args: Sequence[str], cwd: str, log: str) -> int:
        """Start a process that outlives this one (the lane); its pid.

        Windows: DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP. POSIX: a new session.
        """
        ...

    def terminate(self, pid: int) -> None: ...


@dataclass(frozen=True)
class World:
    """Everything outside the plugin's own state, injected into every command."""

    github: GitHub
    git: Git
    clock: Clock
    machine: Machine
    plans: Plans
    processes: Processes
