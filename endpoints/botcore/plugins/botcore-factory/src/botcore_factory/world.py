"""The factory's only door to the outside.

Six protocols name everything the plugin reads or changes outside its own state: GitHub, git,
the clock, the machine, plans and processes. Commands receive a ``World`` holding one of each;
nothing else in the plugin imports ``subprocess`` or calls ``gh``. ``real_world`` implements
them against the machine and ``fixture_world`` against a scenario fixture.

A failed outside read or write raises ``WorldError``. Commands turn it into ``READ_FAILED`` or
``WRITE_FAILED``; a failed read is never reported as an empty, clean answer.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol, runtime_checkable

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
    extra: dict[str, Any] = field(default_factory=dict, compare=False)

    def describe(self) -> dict[str, Any]:
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
    def read(cls, raw: dict[str, Any], fallback_id: str = "") -> HostRecord:
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
    #: The conflicts are left for the lane to regenerate: the merge is still in progress.
    open: bool = False


@dataclass(frozen=True)
class FoldOutcome:
    """Folding a slot's merged head into one commit on the base: the commit, or why not."""

    head: str = ""
    #: Why the branch cannot be folded, which is its own to fix: it has no commit of its own,
    #: or its own commits have more than one author.
    refused: str = ""


@dataclass(frozen=True)
class MergeProgress:
    """Where a pull request stands, read after the lane asked GitHub to merge it.

    A base that takes merges only through a merge queue answers the request by queueing the pull
    request: it is still ``OPEN``, and merges minutes later when the queue's own run of the
    required check passes, or leaves the queue unmerged. Everything here is GitHub's answer,
    never configuration, so one lane is right before and after a queue is turned on.
    """

    #: ``OPEN``, ``MERGED`` or ``CLOSED``.
    state: str = "OPEN"
    #: The pull request's head commit now (empty when the read does not say).
    head: str = ""
    #: Its base takes merges only through a merge queue.
    queue_required: bool = False
    #: It is in the merge queue now.
    queued: bool = False
    #: Auto-merge is set on it: GitHub queues or merges it once its requirements pass.
    waiting: bool = False
    #: The queue's word for the entry (``QUEUED``, ``AWAITING_CHECKS``, ``MERGEABLE``,
    #: ``UNMERGEABLE``, ``LOCKED``), and its place in the queue.
    queue_state: str = ""
    position: int | None = None
    #: The queue entry's head commit, as GitHub names it while the entry is there.
    group_head: str = ""
    #: When GitHub last took it out of a merge queue (GitHub's clock; empty: never), and why:
    #: ``merged`` for a merge, which is logged as a removal too, ``failed_checks`` when the
    #: required check failed on the queue's commit, or another word of GitHub's.
    removed_at: str = ""
    removal_reason: str = ""
    #: The commit the queue had built for it when it let it go: the pull request rebased or
    #: squashed, by the queue's method, onto the base and whatever was queued ahead (the removal
    #: event's ``beforeCommit``; read on lushly-dev/afd#1621, whose squash carried the
    #: ``Co-authored-by:`` line its group failed for).
    removed_commit: str = ""

    @property
    def pending(self) -> bool:
        """GitHub holds the request: nothing more is asked of the lane but to wait."""
        return self.state == "OPEN" and (self.queued or self.waiting)


#: How many of a job log's last lines a finished job's ``stdout`` holds.
TAIL_LINES = 200


@dataclass(frozen=True)
class Completed:
    """A finished process run."""

    args: tuple[str, ...]
    returncode: int
    stdout: str = ""
    stderr: str = ""
    step: str | None = None  # The job step that failed (``install``, ``validate``), if any.
    #: A failed job's failing tests, read from its whole log where ``stdout`` is only the tail
    #: (``failures.failing_tests``); None when not read.
    failures: tuple[str, ...] | None = None
    #: A failed job's line saying the disk is full, read from its whole log
    #: (``failures.disk_full``); None when it says nothing of the kind.
    disk_full: str | None = None


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

    def open_pr(self, branch: str, title: str, body: str, base: str = "main") -> int:
        """Open a PR from ``branch`` to ``base``, or return an open one's number on that base."""
        ...

    def check_status(self, pr: int, name: str, head: str) -> str:
        """Check ``name`` on commit ``head`` (never another head of the PR): ``success``,
        ``failure``, ``cancelled``, ``pending`` or ``missing``."""
        ...

    def merge_pr(self, pr: int, head: str) -> None:
        """Ask GitHub to squash-merge the PR, only if its head is still ``head``. Returning
        does not mean it merged: a base behind a merge queue queues it instead, and a failure
        may still have merged or queued it. Read ``merge_progress`` before deciding."""
        ...

    def enqueue_pr(self, pr: int, head: str) -> None:
        """Add the PR to its base's merge queue, only if its head is still ``head`` (GraphQL
        ``enqueuePullRequest`` with ``expectedHeadOid``). It never sets auto-merge, which the
        CLI's merge does there when a required check has not finished. GitHub then locks
        the head branch: nothing can be pushed to it until it merged or left the queue. A
        failure may still have queued it: read ``merge_progress`` before deciding."""
        ...

    def merge_progress(self, pr: int) -> MergeProgress:
        """Where the PR stands: merged, closed, in a merge queue, waiting to join one, or
        open with nothing pending."""
        ...

    def commit_message(self, commit: str) -> str:
        """The full message of ``commit`` (the commit a merge queue built)."""
        ...

    def pr_state(self, pr: int) -> str:
        """``OPEN``, ``MERGED`` or ``CLOSED``."""
        ...

    def merge_commit(self, pr: int) -> str | None:
        """The commit a merged PR made on its base, or None while GitHub does not name one."""
        ...

    def commit_checks(self, commit: str) -> dict[str, str]:
        """Every check run (and commit status) on ``commit`` by name, the latest of each:
        ``success``, ``failure``, ``cancelled``, ``skipped`` or ``pending``. Raises WorldError
        on a failed or possibly truncated read."""
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

    def repair_edits(
        self, worktree: str, base: str, since: str | None, keep: Callable[[str], bool]
    ) -> list[str]:
        """The paths ``keep`` selects whose change by the branch itself differs from its change
        at ``since`` (the ejected head). Each side is the branch's own diff from where it left
        ``base``, a commit the lane fetched (never a ref the worktree controls), so what main
        changed, brought in by a rebase or a merge of the base, is not counted. With ``since``
        None, every selected path the branch changes."""
        ...

    def push_queue_ref(self, worktree: str, branch: str, head: str) -> None:
        """Push ``head`` to ``refs/factory/queue/<branch>`` on origin, so a replacement host can
        rebuild the queue."""
        ...

    def queue_refs(self) -> list[dict[str, Any]]:
        """``{branch, head}`` for every ``refs/factory/queue/*`` on origin."""
        ...

    def delete_queue_ref(self, branch: str, head: str) -> None:
        """Delete the queue ref only if it still names ``head``; absent is already done."""
        ...

    def publish_host_record(self, record: HostRecord) -> None:
        """Publish this machine's readiness record to ``refs/factory/hosts/<id>`` on origin."""
        ...

    def origin_reachable(self) -> bool: ...

    def read_file(self, worktree: str, path: str) -> str | None:
        """A file in a worktree (a PR body), or None when it is not there."""
        ...

    def fetch_base(self, base: str) -> str:
        """Fetch origin and return the head of its ``base`` branch. Failing is the lane's
        trouble."""
        ...

    def slots_dir(self) -> str:
        """The directory that holds the lane's slot checkouts and their build output (it may
        not exist yet); free disk is measured there."""
        ...

    def prepare_slot(self, slot: str, branch: str, head: str) -> str:
        """Check ``head`` out, detached and clean, in the lane's worktree for ``slot``; its path.

        Raises WorldError when the head cannot be checked out (the entry is invalid).
        """
        ...

    def park_slot(self, slot: str, name: str) -> str:
        """Move the checkout of ``slot`` to the lane checkout ``name``, keeping its git
        directory (a validation record lives there), and return the new path. The slot's own
        path is then free: the next ``prepare_slot`` checks it out afresh."""
        ...

    def remove_checkout(self, path: str) -> None:
        """Forget the lane checkout at ``path`` (one ``park_slot`` made); absent is done."""
        ...

    def remove_build(self, path: str) -> None:
        """Remove a slot's build directory (its ``CARGO_TARGET_DIR``) without waiting on the
        deletion: it is moved aside at once and deleted in the background; absent is done."""
        ...

    def clean_slot_paths(self, slot: str, paths: Sequence[str]) -> list[str]:
        """Remove configured ignored build directories inside ``slot``'s checkout (such as a
        tool that overrides ``CARGO_TARGET_DIR``, lushly-dev/afd#1659) without waiting on
        deletion.

        Each entry in ``paths`` is a literal relative path inside the slot checkout; symlinks
        and paths escaping the slot root are never followed or removed. Returns the relative
        paths that existed and were moved aside for background deletion; missing paths are
        skipped.
        """
        ...

    def merge_main(
        self, path: str, main: str, keep_open: Callable[[tuple[str, ...]], bool] | None = None
    ) -> MergeOutcome:
        """Merge ``main`` into the slot's head. A conflict is aborted and reported, never
        resolved, unless ``keep_open`` accepts its paths: then the merge stays in progress
        (``open``) for ``finish_merge`` or ``abort_merge``. A merge that failed otherwise raises
        WorldError (never reported clean)."""
        ...

    def finish_merge(self, path: str) -> MergeOutcome:
        """Commit the open merge once nothing is unmerged; with paths still unmerged, abort it
        and report them."""
        ...

    def abort_merge(self, path: str) -> None:
        """Abort the open merge, if any."""
        ...

    def fold(self, path: str, base: str, sessions: Sequence[str] = ()) -> FoldOutcome:
        """Make the slot's head, which has merged ``base``, one commit whose parent is ``base``
        and whose tree is the head's: authored and committed as the branch's own commits were,
        with their messages folded (``squash.fold_message``) and a ``Factory-session:`` trailer
        for each of ``sessions``, the cell's threads (``squash.with_sessions``). A rebase merge
        drops a branch's merges and lands each of its own commits, so the lane hands it one
        (lushly-dev/afd#1809); a squash of one commit is that commit. A head that already is
        such a commit is kept. A refusal (``refused``) leaves the head as it was; a fold that
        failed otherwise raises WorldError, and the head is as it was."""
        ...

    def tree(self, path: str) -> str: ...

    def diff_names(self, old: str, new: str) -> list[str]:
        """The paths that differ between commits ``old`` and ``new`` (both sides of a rename)."""
        ...

    def merges_cleanly(self, head: str, base: str) -> MergeOutcome:
        """Whether ``head`` merges onto ``base`` without a conflict, computed without a checkout
        (``git merge-tree``); ``head`` of the outcome is the merged tree. Raises WorldError when
        git cannot say."""
        ...

    def push_head(self, path: str, branch: str, head: str, lease: str | None) -> None:
        """Push commit ``head`` from its validated checkout ``path`` to ``branch`` on origin.
        Refuse if the checkout no longer holds it. With ``lease`` (the head the lane last
        pushed there), a forced push that refuses if origin moved from it; without, a fast
        forward. A refusal's message says ``rejected``."""
        ...


def nvmrc_version(spec: str) -> str | None:
    """An ``.nvmrc``'s version numbers (``26``, ``26.13``, ``26.13.0``, without a ``v``), or
    None for an alias (``lts/*``, ``node``) the lane does not resolve."""
    wanted = spec.strip().removeprefix("v")
    return wanted if re.fullmatch(r"\d+(\.\d+){0,2}", wanted) else None


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

    def is_dir(self, path: str) -> bool:
        """Whether ``path`` is an existing directory (a mounted volume's, for ``host.buildDir``)."""
        ...

    def has_program(self, name: str) -> bool: ...

    def disk_warnings(self) -> list[str]:
        """What botcore's disk hygiene found worth the owner's attention on this machine
        (repositories with too many idle worktrees, Cargo output nothing removes); empty when
        it is not set up here. Shown to the foreman, never a reason to refuse work."""
        ...

    def symlinks(self) -> bool:
        """Whether this user can create symlinks (Windows needs Developer Mode)."""
        ...

    def tool_version(self, tool: str, path: Sequence[str] = ()) -> str | None:
        """The installed version of ``tool`` (node, pnpm, ...), or None when it is missing.
        ``path`` (directories) is searched before ``PATH`` and put first on the ``PATH`` the
        tool runs with, as a lane job step's is: the ``.nvmrc`` Node's bin directory."""
        ...

    def node_bin(self, spec: str) -> str | None:
        """The directory holding the ``node`` a version manager (fnm, nvm, nvm-windows)
        installed for ``spec`` (an ``.nvmrc``: ``26``, ``26.13`` or ``v26.13.0``; the newest
        match), or None when no installed Node matches it."""
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

    def start_job(self, steps: Sequence[dict[str, Any]], cwd: str, log: str, *, label: str) -> str:
        """Start a background job: ``steps`` (``{label, args, timeout?}``) run in order until
        one fails, their output appended to ``log``. A handle to poll."""
        ...

    def poll(self, handle: str) -> Completed | None:
        """The finished job (``stdout`` its log's tail, ``step`` the step that failed, ``failures``
        the failing tests in all it wrote to the log), or None
        while it runs. Raises WorldError for a handle this process did not start."""
        ...

    def kill(self, handle: str) -> None:
        """Kill a job and every process it started, if it is still the one started."""
        ...

    def start_detached(self, args: Sequence[str], cwd: str, log: str) -> int:
        """Start a process that outlives this one (the lane); its pid.

        Windows: DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP. POSIX: a new session.
        """
        ...

    def terminate(self, pid: int, started_at: float | None) -> bool:
        """Kill ``pid`` and its children, only when it is still the process that started at
        ``started_at`` (never a reused pid); whether it did."""
        ...


@runtime_checkable
class ValidationLockProtocol(Protocol):
    """Host-wide validation lock shared across merge lanes on one machine."""

    def check_available(
        self,
        repository: str,
        pid: int,
        *,
        register_waiter: bool = True,
        lane: str = "botcore-factory",
    ) -> dict[str, Any] | None:
        """None when this lane may take a new hold; otherwise a deterministic blocker summary."""
        ...

    def try_acquire(
        self,
        hold_id: str,
        repository: str,
        pid: int,
        *,
        lane: str = "botcore-factory",
    ) -> dict[str, Any] | None:
        """Acquire ``hold_id``; returns None on success or a deterministic blocker summary."""
        ...

    def set_job(
        self,
        hold_id: str,
        repository: str,
        pid: int,
        job_pid: int | None,
        job_started_at: float | None,
        *,
        lane: str = "botcore-factory",
    ) -> None:
        """Record the spawned validation child's PID and start time on an active hold."""
        ...

    def release(
        self,
        hold_id: str,
        repository: str,
        pid: int,
        *,
        lane: str = "botcore-factory",
    ) -> None:
        """Release ``hold_id`` if owned by this lane; clears ``owner`` when its last hold ends."""
        ...

    def reconcile(
        self,
        repository: str,
        pid: int,
        active_hold_ids: Sequence[str],
        *,
        lane: str = "botcore-factory",
    ) -> None:
        """Drop any holds of this lane not in ``active_hold_ids``."""
        ...

    def withdraw_waiter(
        self,
        repository: str,
        pid: int,
        *,
        lane: str = "botcore-factory",
    ) -> None:
        """Remove this lane from ``waiters`` when it is no longer waiting to start work."""
        ...

    def status(self) -> dict[str, Any]:
        """Pruned snapshot of the shared host validation lock."""
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
    validation_lock: ValidationLockProtocol | None = None
