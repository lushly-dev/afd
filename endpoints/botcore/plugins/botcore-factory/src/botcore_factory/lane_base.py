"""What every phase of a lane step uses: records, events, ejection, the lane's own trouble, the
base branch's head, and where a branch that must be validated again goes in the queue.

A failure ejects a branch only when the branch must change to get past it: a conflict, a
validation that failed, a real check failure, a push refused after the lease, a head that changed
under a merge, a PR GitHub refuses, that was closed or that left a merge queue unmerged.
Anything else that failed outside (the
network, GitHub, a registry, a timeout) is the lane's trouble: it pauses and ejects nothing. Of
the ejections, only the branch's own failures count toward ``cells.maxEjections``: a conflict
with a moved main and the push, PR and merge plumbing (``EXCUSED_CAUSES``) do not, nor one the
foreman excused (``ejection-excuse``).
"""

from __future__ import annotations

import contextlib
import re

from botcore_factory import dials, records
from botcore_factory.claims import format_time, parse_time
from botcore_factory.events import emit
from botcore_factory.failures import failing_tests
from botcore_factory.runtime import Factory
from botcore_factory.world import WorldError

FIRST_LINES = 10
#: At most this many failing tests go into an ejection event's lines, and at most
#: ``FAILURES_KEPT`` into its record (``failureCount`` keeps the total), so a broken shared helper
#: does not write one huge record line.
FAILURES_SHOWN = 50
FAILURES_KEPT = 5000
_FAILURE = re.compile(r"(FAIL|Error|ERR!|error|✗|×|failed|Failed)")
#: ``pnpm -r``'s prefix on a package's output: its directory, then the script (``packages/x
#: test: ``).
_PREFIX = r"^(?:\S*/\S* [\w:.-]+: )?"
#: A runner's own mark that one test failed: the line a reader looks for first.
_FAILED_MARK = re.compile(_PREFIX + r"\s*(?:[✖✗×]|FAIL\b|not ok\b|FAILED\b)|\bAssertionError\b")
#: Other failure marks, read after the summary: an exception line, pytest's ``E`` lines.
_ERROR_MARK = re.compile(_PREFIX + r"\s*(?:\S*Error\b[^:]*:|E\s{2,})")
#: ``pnpm verify``'s summary row for a suite that failed: ``  FAIL  612s  hosted-fixtures``.
_SUMMARY_FAIL = re.compile(r"^\s*FAIL\s+\d+s\s+\S")
#: A runner's mark that a test passed. Its name may say "failed" ("a failed restart remains a
#: failure"), so it is never taken for the failure (lushly-dev/afd#1373).
_PASSED_MARK = re.compile(_PREFIX + r"\s*(?:[✔✓√]|ok\b|PASS\b|pass\b|PASSED\b)")
_ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
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
#: A job that ran out of disk: the host's trouble, never the branch's (lushly-dev/afd#1641).
DISK_FULL = re.compile(
    r"\bENOSPC\b|No space left on device|not enough space on the disk|disk quota exceeded", re.I
)


def out_of_disk(output: str) -> str | None:
    """The first line of a job's output that says the disk is full, or None. A line a runner
    marked passed is skipped: a test may be named for the case."""
    for line in output.splitlines():
        clean = _ANSI.sub("", line).strip()
        if DISK_FULL.search(clean) and not _PASSED_MARK.match(clean):
            return clean
    return None


#: The state of a queue entry whose pull request GitHub was asked to merge and has not merged
#: yet: it waits in GitHub's merge queue (``lane_merge``).
MERGE_QUEUED = "merge-queued"
#: The states of an entry whose pull request is open: it stays ahead of every other entry.
AT_THE_FRONT = ("merging", MERGE_QUEUED)
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
    "units",
    "advanced",
    "validatedBase",
    "checkStandsIn",
    "checkBase",
    "mergeQueue",
)


#: Ejections that are not the branch's own failure, and so never count toward
#: ``cells.maxEjections``: main moved under it, or pushing, opening or merging its PR failed on
#: GitHub's side of the plumbing. Each still ejects, so the cell repairs and enqueues again.
EXCUSED_CAUSES = {
    "conflict": "main moved under it",
    "push-failed": "the push was refused",
    "pr-failed": "GitHub refused the pull request",
    "merge-failed": "GitHub refused the merge",  # Or let it go from a merge queue.
}


def counted_ejections(cell: dict) -> int:
    """The ejections that count toward ``cells.maxEjections``: all but the excused ones."""
    return max(0, int(cell.get("ejections", 0)) - int(cell.get("excused", 0)))


def count_ejection(cell: dict, attempt: int, cause: str, at: str) -> None:
    """Count one ejection on the cell; one whose cause is excused is counted as excused."""
    excuse = EXCUSED_CAUSES.get(cause)
    cell["ejections"] = int(cell.get("ejections", 0)) + 1
    cell.setdefault("excused", 0)
    if excuse:
        cell["excused"] += 1
    cell["lastEjection"] = {"attempt": attempt, "cause": cause, "at": at, "excused": excuse}


def ejection_detail(cell: dict, limit: int) -> str:
    return (
        f"{counted_ejections(cell)} ejections count ({cell.get('excused', 0)} of "
        f"{cell.get('ejections', 0)} excused); cells.maxEjections is {limit}"
    )


class LaneTrouble(Exception):
    """The lane's own trouble: pause, eject nothing."""


def first_lines(text: str) -> list[str]:
    """The lines a reader needs first, most telling first, else the last ones.

    In order: the first test a runner marked failed (``✖``, ``FAIL``, ``not ok``, an
    ``AssertionError``), ``pnpm verify``'s summary rows that name the failed suites, the runner's
    other failed tests, exception lines (``Error:``, pytest's ``E``), then any other line that
    mentions a failure. A line a runner marked passed is never one of them, whatever its test is
    called.
    """
    lines = [_ANSI.sub("", line).rstrip() for line in text.splitlines() if line.strip()]
    lines = [line for line in lines if line.strip()]
    candidates = [
        line
        for line in lines
        if not _PASSED_MARK.match(line) or _FAILED_MARK.search(line) or _ERROR_MARK.match(line)
    ]
    summary = [line for line in candidates if _SUMMARY_FAIL.match(line)]
    marked = [line for line in candidates if _FAILED_MARK.search(line) and line not in summary]
    errors = [
        line
        for line in candidates
        if _ERROR_MARK.search(line) and line not in summary and line not in marked
    ]
    taken = {*summary, *marked, *errors}
    loose = [line for line in candidates if _FAILURE.search(line) and line not in taken]
    ordered = [*marked[:1], *summary, *marked[1:], *errors, *loose]
    return (ordered or lines[-FIRST_LINES:])[:FIRST_LINES]


def failure_lines(text: str, tests: list[str] | None = None) -> tuple[list[str], list[str]]:
    """An ejection's lines (``first_lines``, then each failing test under a count) and the
    failing tests themselves: ``tests`` when the world read them from the whole log (``text`` is
    its tail), else those in ``text`` (lushly-dev/afd#1607)."""
    lines = first_lines(text)
    tests = failing_tests(text) if tests is None else list(tests)
    if not tests:
        return lines, tests
    shown = tests[:FAILURES_SHOWN]
    more = len(tests) - len(shown)
    return [
        *lines,
        f"{len(tests)} failing test{'s' if len(tests) != 1 else ''}:",
        *(f"  {test}" for test in shown),
        *([f"  … and {more} more: the ejected record's failures"] if more else []),
    ], tests


def log_path(branch: str, attempt: int, kind: str = "") -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", branch).strip("-")
    return f"attempts/{safe}-{attempt}{'-' + kind if kind else ''}.log"


def open_index(queue: list[dict], exclude: dict | None = None) -> int:
    """Where a branch may join at the front: after any branch already merging, never ahead."""
    index = 0
    for entry in queue:
        if entry is exclude:
            continue
        if entry.get("state") not in AT_THE_FRONT:
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

    def requeue(
        self, entry: dict, reason: str, *, front: bool = True, detail: str | None = None
    ) -> None:
        """Validate it again: its validation was lost, or the base moved since it started.

        It keeps its open PR and goes to the front, behind any branch already merging.
        With ``front=False`` it keeps its position while giving up a reserved slot.
        """
        if entry.get("run"):
            with contextlib.suppress(WorldError):
                self.world.processes.kill(entry["run"])
        self.record(
            "rerun", branch=entry["branch"], attempt=entry["attempt"], reason=reason, detail=detail
        )
        for key in VALIDATION_FIELDS:
            entry.pop(key, None)
        entry["state"] = "queued"
        if front:
            queue = self.state["queue"]
            queue.remove(entry)
            queue.insert(open_index(queue), entry)
        self.actions.append(f"rerun {entry['branch']} ({reason})")

    def eject(
        self,
        entry: dict,
        cause: str,
        text: str,
        log: str | None = None,
        failures: tuple[str, ...] | None = None,
    ) -> None:
        self.world.git.delete_queue_ref(entry["branch"], entry["head"])
        if entry.get("run"):
            with contextlib.suppress(WorldError):  # Already gone.
                self.world.processes.kill(entry["run"])
        self.state["queue"].remove(entry)
        lines, tests = failure_lines(text, list(failures) if failures is not None else None)
        lines = lines or [cause]
        branch = entry["branch"]
        excuse = EXCUSED_CAUSES.get(cause)
        self.record(
            "ejected",
            branch=branch,
            attempt=entry["attempt"],
            cause=cause,
            head=entry.get("head"),
            logPath=log,
            detail=lines[0],
            counted=excuse is None,
            **({"excuse": excuse} if excuse else {}),
            **({"failures": tests[:FAILURES_KEPT], "failureCount": len(tests)} if tests else {}),
        )
        self.event(
            "ejected",
            branch=branch,
            reason=cause,
            detail=lines[0],
            lines=lines,
            logPath=log,
            excused=excuse,
        )
        cell = self.cell(branch)
        if cell is not None:
            from botcore_factory.cells import holding_seats  # cells imports this module.

            full = len(holding_seats(self.state)) >= self.dial("cells.max")
            cell["state"] = "ejected"
            count_ejection(cell, entry["attempt"], cause, self.at)
            limit = self.dial("cells.maxEjections")
            if excuse is None and counted_ejections(cell) >= limit:
                self.event("ejection-limit", branch=branch, detail=ejection_detail(cell, limit))
                # It waits on the owner now, and frees its seat (lushly-dev/afd#1593).
                if full and len(holding_seats(self.state)) < self.dial("cells.max"):
                    self.event("queue-room", detail=f"A seat is free: {branch} waits on the owner")
        self.actions.append(f"ejected {branch} ({cause})")

    def trouble(self, detail: str) -> None:
        self.lane["paused"] = True
        self.lane["pauseReason"] = detail
        needs = "sign-in" if re.search(r"auth|sign.?in|401|credential", detail, re.I) else None
        self.event("lane-error", detail=detail, needsOwner=needs)
