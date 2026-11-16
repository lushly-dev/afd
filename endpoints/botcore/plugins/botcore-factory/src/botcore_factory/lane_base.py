"""What every phase of a lane step uses: records, events, ejection, the lane's own trouble, the
base branch's head, and where a branch that must be validated again goes in the queue.

A failure ejects a branch only when it is the branch's own: a conflict, a validation that
failed, a real check failure, a push refused after the lease, a head that changed under a merge,
a PR GitHub refuses or that was closed. Anything else that failed outside (the network,
GitHub, a registry, a timeout) is the lane's trouble: it pauses and ejects nothing.
"""

from __future__ import annotations

import contextlib
import re

from botcore_factory import dials, records
from botcore_factory.claims import format_time, parse_time
from botcore_factory.events import emit
from botcore_factory.runtime import Factory
from botcore_factory.world import WorldError

FIRST_LINES = 10
_FAILURE = re.compile(r"(FAIL|Error|ERR!|error|✗|×|failed|Failed)")
NON_FAST_FORWARD = re.compile(r"rejected|non-fast-forward|stale info|fetch first", re.I)
HEAD_MISMATCH = re.compile(r"head branch was modified|head commit|match-head|expected head", re.I)
PR_REFUSED = re.compile(r"No commits between|Validation Failed|\b422\b", re.I)
NOT_MERGEABLE = re.compile(r"not mergeable|merge conflict", re.I)
BAD_REVISION = re.compile(
    r"unknown revision|not a valid object|couldn't find remote ref|bad object|invalid reference",
    re.I,
)
INFRASTRUCTURE = re.compile(
    r"timed? ?out|timeout|could not resolve|connection|network|unreachable|temporar|"
    r"HTTP 5\d\d|\b50[0234]\b|TLS|SSL|ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|unable to access|"
    r"rate limit|socket",
    re.I,
)
#: The fields a validation adds to a queue entry; cleared when it must be validated again.
VALIDATION_FIELDS = (
    "run",
    "slot",
    "base",
    "startedAt",
    "validatedHead",
    "tree",
    "path",
    "changed",
    "checkSince",
)


class LaneTrouble(Exception):
    """The lane's own trouble: pause, eject nothing."""


def first_lines(text: str) -> list[str]:
    """The lines a reader needs first: those that look like failures, else the last ones."""
    lines = [line.rstrip() for line in text.splitlines() if line.strip()]
    failing = [line for line in lines if _FAILURE.search(line)]
    return (failing or lines[-FIRST_LINES:])[:FIRST_LINES]


def log_path(branch: str, attempt: int, kind: str = "") -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", branch).strip("-")
    return f"attempts/{safe}-{attempt}{'-' + kind if kind else ''}.log"


def open_index(queue: list[dict], exclude: dict | None = None) -> int:
    """Where a branch may join at the front: after any branch already merging, never ahead."""
    index = 0
    for entry in queue:
        if entry is exclude:
            continue
        if entry.get("state") != "merging":
            break
        index += 1
    return index


class StepBase:
    """One step over the lane's state, under the state lock."""

    def __init__(self, factory: Factory, state: dict) -> None:
        self.factory = factory
        self.world = factory.world
        self.config = factory.config
        self.state = state
        self.lane = state["lane"]
        self.now = factory.world.clock.now()
        self.at = format_time(self.now)
        self.actions: list[str] = []
        self._base: str | None = None
        for entry in [*state["queue"], *state["held"]]:  # Entries a fixture or recovery wrote.
            entry.setdefault("attempt", 1)
            entry.setdefault("state", "queued" if entry in state["queue"] else "held")
            entry.setdefault("issues", (self.cell(entry["branch"]) or {}).get("issues", []))

    def record(self, kind: str, **fields) -> None:
        self.factory.store.append_record(
            records.make(kind, self.at, self.lane.get("runId"), **fields)
        )

    def event(self, kind: str, **fields) -> dict:
        self.actions.append(f"event {kind} {fields.get('branch', '')}".rstrip())
        return emit(self.state, self.at, kind, **fields)

    def dial(self, key: str):
        return dials.value(self.state["dials"], key)

    def cell(self, branch: str) -> dict | None:
        return next((c for c in self.state["cells"] if c.get("branch") == branch), None)

    def minutes(self, since: str | None) -> float:
        if not since:
            return 0.0
        return round((self.now - parse_time(since)).total_seconds() / 60, 1)

    def absolute(self, relative: str) -> str:
        return str(self.factory.store.root / relative)

    def base_head(self, fresh: bool = False) -> str:
        """The base branch's head on origin, fetched once a step (again when ``fresh``)."""
        if self._base is None or fresh:
            try:
                self._base = self.world.git.fetch_base(self.config.base_branch)
            except WorldError as exc:
                raise LaneTrouble(f"Fetching origin failed: {exc}") from exc
        return self._base

    def current_run(self) -> dict | None:
        run_id = self.lane.get("runId")
        return next((run for run in self.state["runs"] if run.get("id") == run_id), None)

    def requeue(self, entry: dict, reason: str, *, front: bool = True) -> None:
        """Validate it again: its validation was lost, or the base moved since it started.

        It keeps its open PR and goes to the front, behind any branch already merging.
        With ``front=False`` it keeps its position while giving up a reserved slot.
        """
        if entry.get("run"):
            with contextlib.suppress(WorldError):
                self.world.processes.kill(entry["run"])
        self.record("rerun", branch=entry["branch"], attempt=entry["attempt"], reason=reason)
        for key in VALIDATION_FIELDS:
            entry.pop(key, None)
        entry["state"] = "queued"
        if front:
            queue = self.state["queue"]
            queue.remove(entry)
            queue.insert(open_index(queue), entry)
        self.actions.append(f"rerun {entry['branch']} ({reason})")

    def eject(self, entry: dict, cause: str, text: str, log: str | None = None) -> None:
        self.world.git.delete_queue_ref(entry["branch"], entry["head"])
        if entry.get("run"):
            with contextlib.suppress(WorldError):  # Already gone.
                self.world.processes.kill(entry["run"])
        self.state["queue"].remove(entry)
        lines = first_lines(text) or [cause]
        branch = entry["branch"]
        self.record(
            "ejected",
            branch=branch,
            attempt=entry["attempt"],
            cause=cause,
            head=entry.get("head"),
            logPath=log,
            detail=lines[0],
        )
        self.event(
            "ejected", branch=branch, reason=cause, detail=lines[0], lines=lines, logPath=log
        )
        cell = self.cell(branch)
        if cell is not None:
            cell["state"] = "ejected"
            cell["ejections"] = int(cell.get("ejections", 0)) + 1
            limit = self.dial("cells.maxEjections")
            if cell["ejections"] >= limit:
                self.event(
                    "ejection-limit",
                    branch=branch,
                    detail=f"{cell['ejections']} ejections; cells.maxEjections is {limit}",
                )
        self.actions.append(f"ejected {branch} ({cause})")

    def trouble(self, detail: str) -> None:
        self.lane["paused"] = True
        self.lane["pauseReason"] = detail
        needs = "sign-in" if re.search(r"auth|sign.?in|401|credential", detail, re.I) else None
        self.event("lane-error", detail=detail, needsOwner=needs)
