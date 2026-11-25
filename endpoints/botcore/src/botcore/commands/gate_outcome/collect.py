"""`gate-outcome-collect`: read the repository's workflow runs from GitHub into the record.

Three steps, in order, each going on where the record already holds what GitHub would say:

1. The run lists for the window, every event. GitHub answers one query with at most 1,000
   runs, so a span whose count is over that is split in two until each part fits.
2. The earlier attempts of a run that has more than one.
3. The jobs and steps of each attempt: those that did not pass first, then the others,
   newest first. An attempt that ended `action_required` or `skipped` ran no step, and its
   jobs are not asked for.

A collection stops at its own limit (`requests`) or when the account's allowance is down to
half, whichever comes first, and the next goes on from there.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.disk.lock import LockHeld, RunLock
from botcore.commands.disk.settings import SettingsError
from botcore.commands.disk.steps import run_blocking
from botcore.commands.gate_outcome import github
from botcore.commands.gate_outcome.github import GitHub, NotFound, Stop
from botcore.commands.gate_outcome.record import (
    LOCK_FILE,
    RULES,
    RUN_FACTS,
    Record,
    append_lines,
    checked,
    load_record,
    load_state,
    parse_time,
    publish,
    repo_folder,
    repo_parts,
    save_state,
    shape_digest,
    stamp,
    state_dir,
)
from botcore.commands.skill_usage.collect import project_remote, settings_refused
from botcore.commands.skill_usage.store import InvalidMachine, Local, local
from botcore.utils.workspace import find_workspace

STATE_VERSION = 1
MAX_DAYS = 365
DEFAULT_REQUESTS = 1000
MAX_REQUESTS = 5000  # an account's hourly allowance
SOURCES = ("ci", "main", "reviews", "runs")  # the plan's sources
BUILT = ("ci",)  # the sources this botcore collects
CAP = 1000  # the most runs GitHub gives for one query
PAGE = 100
# A span listed this long after it ended, with every run in it finished, is not listed
# again: a run rerun later than this is seen by a rebuild only
SETTLE = timedelta(days=2)
FRESH = timedelta(hours=1)  # a span listed this recently is not listed again either
NOT_RUN = ("action_required", "skipped")
_QUEUE_BRANCH = re.compile(r"/pr-(\d+)-([0-9a-f]{40})$")
_NAME_MAX = 300


def share(part: float, whole: float) -> float:
    """A share to three places that reads 1.0 only when it is whole and 0.0 only when it is
    none: a window missing two minutes in seven days is not all read."""
    if whole <= 0 or part >= whole:
        return 1.0
    if part <= 0:
        return 0.0
    return min(max(round(part / whole, 3), 0.001), 0.999)


def _iso(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _day(moment: datetime) -> datetime:
    return moment.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


def _fail(code: str, message: str, suggestion: str, **extra: object) -> CommandResult[dict]:
    return error(code, message, suggestion=suggestion, **extra)  # type: ignore[arg-type]


def workspace_repo() -> tuple[Path, str] | None:
    """The checkout this is called from and its repository, `owner/name` from its origin."""
    root = find_workspace()
    if root is None:
        return None
    repo = project_remote(root)
    return (root, repo) if repo and repo_parts(repo) else None


def no_workspace() -> CommandResult[dict]:
    return _fail(
        "NO_WORKSPACE",
        "This is not called from a checkout whose origin names a GitHub repository",
        "Run it from inside a clone of the repository, whose origin is github.com/<owner>/<name>",
    )


def record_unavailable(folder: Path, exc: Exception) -> CommandResult[dict]:
    return _fail(
        "RECORD_UNAVAILABLE",
        f"The gate outcome record in {folder} could not be used: {exc}",
        "Check that it is a folder this user can read and write, or set "
        "BOTCORE_GATE_OUTCOME_STATE to one that is",
    )


# ── The run lists ───────────────────────────────────────────────────────────


def _span_key(start: datetime, end: datetime) -> str:
    return f"{_iso(start)}/{_iso(end)}"


def spans(state: dict) -> list[tuple[datetime, datetime, dict]]:
    """The spans of time a machine's state says were listed, with what it says of each."""
    found = []
    lists = state.get("lists")
    for key, entry in lists.items() if isinstance(lists, dict) else []:
        start, _, end = str(key).partition("/")
        begun, ended = parse_time(start), parse_time(end)
        if begun is not None and ended is not None and isinstance(entry, dict):
            found.append((begun, ended, entry))
    return found


def _covered(intervals: list[tuple[datetime, datetime]]) -> list[tuple[datetime, datetime]]:
    merged: list[list[datetime]] = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(start, end) for start, end in merged]


def gaps(
    start: datetime, end: datetime, have: list[tuple[datetime, datetime]]
) -> list[tuple[datetime, datetime]]:
    """What of [start, end) the spans in `have` leave out, cut at each UTC day."""
    left: list[tuple[datetime, datetime]] = []
    at = start
    for begun, ended in _covered(have):
        if ended <= at or begun >= end:
            continue
        if begun > at:
            left.append((at, begun))
        at = max(at, ended)
    if at < end:
        left.append((at, end))
    cut: list[tuple[datetime, datetime]] = []
    for begun, ended in left:
        while begun < ended:
            midnight = _day(begun) + timedelta(days=1)
            cut.append((begun, min(midnight, ended)))
            begun = min(midnight, ended)
    return cut


@dataclass
class Rebuild:
    """A rebuild under way: what was read before `since`, of runs created from `start` on,
    is read again. It goes on at the next collection until that window is all read."""

    since: datetime
    start: datetime

    def stale(self, at: datetime | None, created: datetime | None) -> bool:
        return (created is None or created >= self.start) and (at is None or at < self.since)


def listed_spans(record: Record, now: datetime, rebuild: Rebuild | None) -> list:
    """The spans no collection needs to list again, from every machine's state."""
    have = []
    for state in record.states.values():
        for begun, ended, entry in spans(state):
            at = parse_time(entry.get("at"))
            if at is None or (rebuild is not None and rebuild.stale(at, begun)):
                continue
            if entry.get("settled") is True or now - at < FRESH:
                have.append((begun, ended))
    return have


def _list_span(gh: GitHub, start: datetime, end: datetime, out: list) -> None:
    """List the runs created in [start, end), newest part first, appending each part that was
    listed whole to `out` as (start, end, runs). A part of more than CAP runs is split."""
    created = f"{_iso(start)}..{_iso(end - timedelta(seconds=1))}"
    first = gh.get("actions/runs", per_page=PAGE, page=1, created=created)
    total = first.get("total_count")
    if type(total) is not int:
        raise github.SourceUnreadable("the run list has no total_count")
    if total > CAP and end - start > timedelta(seconds=1):
        middle = start + timedelta(seconds=int((end - start).total_seconds()) // 2)
        _list_span(gh, middle, end, out)
        _list_span(gh, start, middle, out)
        return
    runs = {run["id"]: run for run in _runs(first)}
    out.append((start, end, list(runs.values()), False))
    for page in range(2, min(-(-total // PAGE), CAP // PAGE) + 1):
        more = _runs(gh.get("actions/runs", per_page=PAGE, page=page, created=created))
        runs.update((run["id"], run) for run in more)
        out[-1] = (start, end, list(runs.values()), False)
        if not more:
            break
    out[-1] = (start, end, list(runs.values()), True)


def _runs(body: dict) -> list[dict]:
    found = body.get("workflow_runs")
    return [run for run in found if isinstance(run, dict) and type(run.get("id")) is int] if (
        isinstance(found, list)
    ) else []  # fmt: skip


def run_line(run: dict, at: str, attempt: int | None = None) -> dict | None:
    """A run attempt as the record keeps it: no title, branch, actor or commit message."""
    pulls = run.get("pull_requests")
    pull: dict = (
        pulls[0] if isinstance(pulls, list) and pulls and isinstance(pulls[0], dict) else {}
    )
    base: dict = pull["base"] if isinstance(pull.get("base"), dict) else {}
    number, base_sha = pull.get("number"), base.get("sha")
    queued = _QUEUE_BRANCH.search(str(run.get("head_branch") or ""))
    if run.get("event") == "merge_group" and queued:
        number, base_sha = int(queued.group(1)), queued.group(2)
    line = {
        "id": "",
        "kind": "run",
        "v": RULES,
        "at": at,
        "run": run.get("id"),
        "attempt": attempt or run.get("run_attempt") or 1,
        "workflow": run.get("path"),
        "name": run.get("name"),
        "event": run.get("event"),
        "status": run.get("status"),
        "conclusion": run.get("conclusion"),
        "head": run.get("head_sha"),
        "base": base_sha,
        "pr": number,
        "created": run.get("created_at"),
        "started": run.get("run_started_at"),
        "updated": run.get("updated_at"),
    }
    line["id"] = f"run:{line['run']}:{line['attempt']}"
    return checked(line)


def _same(line: dict, held: dict | None) -> bool:
    return (
        held is not None
        and held["v"] >= RULES
        and all(line[key] == held.get(key) for key in RUN_FACTS)
    )


# ── Jobs and steps ──────────────────────────────────────────────────────────


def _seconds(item: dict) -> int | None:
    begun, ended = parse_time(item.get("started_at")), parse_time(item.get("completed_at"))
    if begun is None or ended is None:
        return None
    return max(0, int((ended - begun).total_seconds()))


def _named(value: object, fallback: str) -> str:
    return (value if isinstance(value, str) and value else fallback)[:_NAME_MAX]


def steps_lines(workflow: str, run: dict, jobs: list[dict], at: str) -> list[dict]:
    """An attempt's jobs as a shape line and a steps line. Jobs go by name, so one version of
    a workflow has one shape whatever order GitHub lists its jobs in."""
    ordered = sorted(
        (job for job in jobs if isinstance(job, dict)),
        key=lambda job: (_named(job.get("name"), "?"), job.get("id") or 0),
    )
    names, seconds, ends = [], [], []
    for job in ordered:
        steps = [step for step in job.get("steps") or [] if isinstance(step, dict)]
        steps.sort(key=lambda step: step.get("number") or 0)
        names.append(
            [_named(job.get("name"), "?"), [_named(step.get("name"), "?") for step in steps]]
        )
        seconds.append([_seconds(job), [_seconds(step) for step in steps]])
        ends.append([job.get("conclusion"), [step.get("conclusion") for step in steps]])
    digest = shape_digest(workflow, names)
    shape = {"id": f"shape:{digest}", "kind": "shape", "v": RULES, "at": at,
             "workflow": workflow, "jobs": names}  # fmt: skip
    line = {
        "id": f"steps:{run['run']}:{run['attempt']}",
        "kind": "steps",
        "v": RULES,
        "at": at,
        "run": run["run"],
        "attempt": run["attempt"],
        "shape": digest,
        "seconds": seconds,
    }
    if run.get("conclusion") != "success":
        line["conclusions"] = ends
    return [line for line in (checked(shape), checked(line)) if line is not None]


def _read_jobs(gh: GitHub, run: dict) -> list[dict]:
    jobs: list[dict] = []
    page = 1
    while True:
        body = gh.get(
            f"actions/runs/{run['run']}/attempts/{run['attempt']}/jobs", per_page=PAGE, page=page
        )
        found = body.get("jobs")
        found = [job for job in found if isinstance(job, dict)] if isinstance(found, list) else []
        jobs.extend(found)
        total = body.get("total_count")
        if not found or type(total) is not int or len(jobs) >= total:
            return jobs
        page += 1


# ── One collection ──────────────────────────────────────────────────────────


class Collection:
    """What one collection reads and adds, and where it got to."""

    def __init__(  # noqa: PLR0913 - the collection's inputs
        self, gh: GitHub, record: Record, folder: Path, state: dict, start: datetime,
        now: datetime, rebuild: Rebuild | None,
    ) -> None:  # fmt: skip
        self.gh, self.record, self.folder, self.state = gh, record, folder, state
        self.start, self.now, self.rebuild = start, now, rebuild
        self.added = 0
        self.step = "lists"
        self.listed_now = 0  # spans listed whole by this collection

    def _at(self) -> str:
        return stamp(datetime.now(UTC))

    def _write(self, lines: list[dict]) -> None:
        append_lines(self.folder, lines)
        for line in lines:
            self.record.add(line, self.state["machine"])
        self.added += len(lines)

    def _stale(self, line: dict | None) -> bool:
        """Whether a line must be read again: it is not there, or a rebuild began after it."""
        if line is None:
            return True
        at = parse_time(line["at"])
        created = parse_time(line.get("created")) if line["kind"] == "run" else None
        if line["kind"] == "steps":
            run = self.record.runs.get(f"run:{line['run']}:{line['attempt']}")
            created = parse_time(run["created"]) if run else None
        return self.rebuild is not None and self.rebuild.stale(at, created)

    def in_window(self, line: dict) -> bool:
        created = parse_time(line["created"])
        return created is not None and self.start <= created < self.now

    def lists(self) -> None:
        have = listed_spans(self.record, self.now, self.rebuild)
        lists = self.state.setdefault("lists", {})
        for begun, ended in reversed(gaps(self.start, self.now, have)):
            out: list = []
            try:
                _list_span(self.gh, begun, ended, out)
            finally:
                for start, end, runs, whole in out:
                    self._keep_runs(runs)
                    if whole:
                        finished = all(run.get("status") == "completed" for run in runs)
                        listed_at = datetime.now(UTC)
                        for begun_at, ended_at, _ in spans({"lists": dict(lists)}):
                            if start <= begun_at and ended_at <= end:  # this span holds it
                                lists.pop(_span_key(begun_at, ended_at), None)
                        lists[_span_key(start, end)] = {
                            "at": stamp(listed_at),
                            "settled": finished and listed_at - end >= SETTLE,
                            "runs": len(runs),
                            # it reaches the moment this collection began: what came after
                            # is the next collection's
                            "to_now": end == self.now,
                        }
                        self.listed_now += 1
                if out:
                    save_state(self.folder, self.state)

    def _keep_runs(self, runs: list[dict]) -> None:
        at = self._at()
        fresh = []
        for run in runs:
            line = run_line(run, at)
            if line is not None and not _same(line, self.record.runs.get(line["id"])):
                fresh.append(line)
        self._write(fresh)

    def latest(self) -> dict[int, dict]:
        """Each run's latest attempt in the window."""
        newest: dict[int, dict] = {}
        for line in self.record.runs.values():
            held = newest.get(line["run"])
            if self.in_window(line) and (held is None or line["attempt"] > held["attempt"]):
                newest[line["run"]] = line
        return newest

    def attempts_left(self) -> list[tuple[dict, int]]:
        left = []
        for line in sorted(self.latest().values(), key=lambda line: line["created"], reverse=True):
            for attempt in range(line["attempt"] - 1, 0, -1):
                held = self.record.runs.get(f"run:{line['run']}:{attempt}")
                # an attempt listed while it ran ended before the next one began
                if (
                    self._stale(held)
                    or held is None
                    or held["status"] not in ("completed", "unreadable")
                ):
                    left.append((line, attempt))
        return left

    def attempts(self) -> None:
        self.step = "attempts"
        for latest, attempt in self.attempts_left():
            at = self._at()
            identifier = f"run:{latest['run']}:{attempt}"
            try:
                body = self.gh.get(f"actions/runs/{latest['run']}/attempts/{attempt}")
                line = run_line(body, at, attempt)
            except NotFound:
                line = None
            if line is None:  # GitHub no longer has it
                held = self.record.runs.get(identifier)
                if held is not None and held["status"] == "completed":
                    # what was read before is kept, marked as no longer readable
                    line = checked({**held, "at": at, "unreadable": True})
                else:  # nothing known of it but the run it belongs to: its end unknown
                    line = checked({**latest, "id": identifier, "at": at, "attempt": attempt,
                                    "status": "unreadable", "conclusion": None,
                                    "started": None, "updated": None})  # fmt: skip
            if line is not None:
                self._write([line])

    def steps_left(self) -> list[dict]:
        wanted = [
            line
            for line in self.record.runs.values()
            if self.in_window(line)
            and line["status"] == "completed"
            and line["conclusion"] not in NOT_RUN
            and self._stale(self.record.steps.get(f"steps:{line['run']}:{line['attempt']}"))
        ]
        # those that did not pass first, then the others; newest first in each
        wanted.sort(key=lambda line: (line["created"], line["run"], line["attempt"]), reverse=True)
        wanted.sort(key=lambda line: line["conclusion"] == "success")
        return wanted

    def jobs(self) -> None:
        self.step = "jobs"
        for run in self.steps_left():
            held = self.record.steps.get(f"steps:{run['run']}:{run['attempt']}")
            try:
                lines = steps_lines(run["workflow"], run, _read_jobs(self.gh, run), self._at())
            except NotFound:  # GitHub no longer has it: what was read before is kept
                line = checked({
                    **(held or {"seconds": [], "shape": None}),
                    "id": f"steps:{run['run']}:{run['attempt']}", "kind": "steps", "v": RULES,
                    "at": self._at(), "run": run["run"], "attempt": run["attempt"],
                    "unreadable": True,
                })  # fmt: skip
                lines = [line] if line is not None else []
            self._write(
                [line for line in lines if line["kind"] != "shape"
                 or line["id"].removeprefix("shape:") not in self.record.shapes]
            )  # fmt: skip

    def reached(self) -> dict:
        window = (self.now - self.start).total_seconds()
        have = listed_spans(self.record, self.now, self.rebuild)
        missing = gaps(self.start, self.now, have)
        left = sum((end - begun).total_seconds() for begun, end in missing)
        latest = self.latest()
        return {
            "step": self.step,
            "window_listed": share(window - left, window),
            "listed_whole": not missing,
            "runs": len(latest),
            "attempts_left": len(self.attempts_left()),
            "steps_left": len(self.steps_left()),
        }


def _check_inputs(since_days: int, sources: list[str], requests: int) -> CommandResult[dict] | None:
    if type(since_days) is not int or not 1 <= since_days <= MAX_DAYS:
        return _fail(
            "VALIDATION_ERROR", f"since_days must be a whole number from 1 to {MAX_DAYS}",
            "Pass since_days from 1 to 365: the number of whole UTC days to collect, today "
            "included, for example 7",
        )  # fmt: skip
    if type(requests) is not int or not 1 <= requests <= MAX_REQUESTS:
        return _fail(
            "VALIDATION_ERROR", f"requests must be a whole number from 1 to {MAX_REQUESTS}",
            f"Pass requests from 1 to {MAX_REQUESTS}, or leave it out for {DEFAULT_REQUESTS}",
        )  # fmt: skip
    if not sources or any(source not in SOURCES for source in sources):
        unknown = [source for source in sources if source not in SOURCES]
        return _fail(
            "VALIDATION_ERROR",
            f"sources must name some of {', '.join(SOURCES)}"
            + (f"; not {', '.join(map(str, unknown))}" if unknown else ""),
            f"Pass sources from: {', '.join(SOURCES)}. This botcore collects: {', '.join(BUILT)}",
        )
    unbuilt = [source for source in sources if source not in BUILT]
    if unbuilt:
        return _fail(
            "VALIDATION_ERROR", f"This botcore does not collect {', '.join(unbuilt)} yet",
            f"Pass sources: [{', '.join(BUILT)}], the sources this botcore collects",
        )  # fmt: skip
    return None


async def gate_outcome_collect(
    since_days: int = 7,
    sources: list[str] | None = None,
    requests: int = DEFAULT_REQUESTS,
    rebuild: bool = False,
) -> CommandResult[dict]:
    """Read the repository's workflow runs, their attempts, jobs and steps from GitHub into
    this machine's gate outcome record, going on from what every machine's record holds.

    Args:
        since_days: Whole UTC days to collect, today included: 1 to 365 (default 7).
        sources: What to read: `ci` (the Actions runs). The plan's `main`, `reviews` and
            `runs` are refused until a botcore collects them.
        requests: The most GitHub requests this collection makes: 1 to 5000 (default 1000).
            It also stops when the account's hourly allowance is down to half.
        rebuild: Ask GitHub again for everything in the window, whatever the record holds.
    """
    chosen = list(sources) if sources is not None else ["ci"]
    refused = _check_inputs(since_days, chosen, requests)
    if refused is not None:
        return refused
    return await run_blocking(_collect_sync, since_days, requests, rebuild)


def _collect_sync(since_days: int, requests: int, rebuild: bool) -> CommandResult[dict]:  # noqa: PLR0911
    found = workspace_repo()
    if found is None:
        return no_workspace()
    _root, repo = found
    try:
        here = local()
    except (SettingsError, InvalidMachine) as exc:
        return settings_refused(exc)
    base = state_dir()
    folder = repo_folder(base, repo)
    try:
        with RunLock(base / LOCK_FILE, label="gate-outcome-collect"):
            result = _collect(repo, folder, here, since_days, requests, rebuild)
            _publish(result, folder, here, repo)
    except LockHeld:
        return _fail(
            "CONFLICT", "Another gate-outcome-collect is running on this machine",
            "Run it again when that one has finished; the hourly job may be collecting",
        )  # fmt: skip
    except OSError as exc:
        return record_unavailable(folder, exc)
    return result


def _publish(result: CommandResult[dict], folder: Path, here: Local, repo: str) -> None:
    """Write this machine's record to the shared folder. A shared folder that cannot take it
    does not undo the collection: the record here is whole, and the next one writes it."""
    if not result.success or result.data is None or here.shared is None:
        return
    shared: dict = {"path": str(here.shared)}
    try:
        shared["written"] = publish(folder, here.shared, here.machine, repo)
    except OSError as exc:
        shared["written"], shared["error"] = False, str(exc)
    result.data["shared"] = shared


def _collect(  # noqa: PLR0913 - one collection, start to end
    repo: str, folder: Path, here: Local, since_days: int, requests: int, rebuild: bool
) -> CommandResult[dict]:
    record = load_record(state_dir(), repo, here)
    state = load_state(folder)
    now = datetime.now(UTC).replace(microsecond=0)
    start = _day(now) - timedelta(days=since_days - 1)
    pending = state.get("rebuild") if isinstance(state.get("rebuild"), dict) else None
    if rebuild:  # to the millisecond: what this collection writes is after it
        pending = {"since": stamp(datetime.now(UTC)), "start": _iso(start)}
    since, begun = (parse_time(pending.get(k)) for k in ("since", "start")) if pending else (
        None, None
    )  # fmt: skip
    redo = Rebuild(since, begun) if since is not None and begun is not None else None
    state.update(
        version=STATE_VERSION, machine=here.machine, repo=repo,
        record_id=state.get("record_id") or uuid.uuid4().hex,
    )  # fmt: skip
    if pending:
        state["rebuild"] = pending
    record.states[here.machine] = state  # what this collection lists counts as it goes
    gh = GitHub(repo, requests)
    collection = Collection(gh, record, folder, state, start, now, redo)
    why: str | None = None
    try:
        collection.lists()
        collection.attempts()
        collection.jobs()
    except Stop as stop:
        why = {
            "requests": f"requests: reached the limit of {requests} requests",
            "allowance": "allowance: the account's hourly GitHub allowance is down to half",
        }[stop.why]
    except (github.ServiceUnavailable, github.SourceUnreadable, NotFound) as exc:
        if not collection.added and not collection.listed_now:
            if isinstance(exc, github.ServiceUnavailable):
                return _fail(
                    "SERVICE_UNAVAILABLE", f"GitHub could not be read: {exc}",
                    "Check that gh is installed and signed in (gh auth status) and that "
                    "GitHub answers, then run gate-outcome-collect again",
                    retryable=True,
                )  # fmt: skip
            return _fail(
                "SOURCE_UNREADABLE", f"GitHub's Actions runs for {repo} could not be read: {exc}",
                "Check that gh's account can read this repository's Actions (gh api "
                f"repos/{repo}/actions/runs), then run gate-outcome-collect again",
            )  # fmt: skip
        why = f"github: GitHub stopped answering as expected ({exc})"
    reached = collection.reached()
    whole = (
        why is None and reached.pop("listed_whole")
        and not reached["attempts_left"] and not reached["steps_left"]
    )  # fmt: skip
    status = "read" if whole else "partly"
    if whole and pending and (redo is None or start <= redo.start):
        state.pop("rebuild", None)
    going = sum(line["status"] != "completed" for line in collection.latest().values())
    source: dict = {"source": "ci", "status": status, "found": reached["runs"],
                    "added": collection.added, "still_going": going}  # fmt: skip
    if not whole:
        source["why"] = why or "the window is not all read"
        source["reached"] = reached
    state["collected_at"] = stamp(datetime.now(UTC))
    state["ci"] = {k: v for k, v in source.items() if k in ("status", "why", "reached")}
    state["ci"]["at"] = state["collected_at"]
    save_state(folder, state)
    data = {
        "machine": here.machine,
        "repository": repo,
        "state_dir": str(folder),
        "window": {
            "since_days": since_days,
            "first_day": start.date().isoformat(),
            "last_day": now.date().isoformat(),
        },  # fmt: skip
        "sources": [source],
        "requests_used": gh.used,
    }
    if gh.allowance is not None:
        data["allowance"] = gh.allowance
    reasoning = (
        f"{reached['runs']} runs in the window; {collection.added} lines added; ci is {status}"
        + (f" ({source['why']})" if not whole else "")
    )
    return success(data, reasoning=reasoning)
