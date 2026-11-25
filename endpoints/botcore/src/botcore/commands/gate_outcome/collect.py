"""`gate-outcome-collect`: read the repository's workflow runs from GitHub, and the fix commits
and reverts on its default branch (main.py), into the record.

The `main` source is read first: git, then a few GraphQL requests. Then the `ci` source, in
four steps, in order, each going on where the record already holds what GitHub would say:

1. The run lists for the window, every event. GitHub answers one query with at most 1,000
   runs, so a span whose count is over that is split in two until each part fits.
2. The earlier attempts of a run that has more than one.
3. The jobs and steps of each attempt: those that did not pass first, then the others,
   newest first. An attempt that ended `action_required` or `skipped` ran no step, and its
   jobs are not asked for. Where a hook group step failed, that job's log is read with them,
   once, for the hook runner's summary (summary.py).
4. The logs of the other jobs with a group step that ran: a failed one whose log a limit kept
   from being read first, then those that passed, newest first. These are what a collection
   reads last, so a group step that passed has its commands' seconds as the allowance permits.

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
from botcore.commands.gate_outcome import fold, github, record
from botcore.commands.gate_outcome import main as main_source
from botcore.commands.gate_outcome.checks import Job, Known, read_known
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
from botcore.commands.gate_outcome.summary import Read, read_steps
from botcore.commands.skill_usage.collect import project_remote, settings_refused
from botcore.commands.skill_usage.store import InvalidMachine, Local, local
from botcore.utils.workspace import find_workspace

STATE_VERSION = 1
MAX_DAYS = 365
DEFAULT_REQUESTS = 1000
MAX_REQUESTS = 5000  # an account's hourly allowance
SOURCES = ("ci", "main", "reviews", "runs")  # the plan's sources
BUILT = ("ci", "main")  # the sources this botcore collects
CAP = 1000  # the most runs GitHub gives for one query
PAGE = 100
# A span listed this long after it ended, with every run in it finished, is not listed
# again: a run rerun later than this is seen by a rebuild only
SETTLE = timedelta(days=2)
FRESH = timedelta(hours=1)  # a span listed this recently is not listed again either
NOT_RUN = ("action_required", "skipped")
REBUILD_KEYS = {"ci": "rebuild", "main": "main_rebuild"}  # where a source's rebuild is kept
_QUEUE_BRANCH = re.compile(r"/pr-(\d+)-([0-9a-f]{40})$")
_NAME_MAX = 300


def record_now() -> datetime:
    return record.now()


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


def checkout_repo(root: Path) -> tuple[Path, str] | None:
    """A checkout named by path (the hourly job's) and its repository, from its origin."""
    repo = project_remote(root) if root.is_dir() else None
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
    """The spans no collection needs to list again, from every machine's state, and every
    folded day: what a fold holds is never asked for again, by a rebuild either."""
    have = list(record.folded_spans())
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
        # A run of a workflow that failed to start has no name (and a path such as
        # `BuildFailed`): it goes by its path, so it is counted and not dropped
        "name": run.get("name") or run.get("path"),
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


def group_steps(known: Known | None, workflow: str, names: list) -> dict[int, list]:
    """A shape's hook group steps, by the place of their job: [(step's place, Step)]."""
    found: dict[int, list] = {}
    if known is None or known.error:
        return found
    file = workflow.rsplit("/", 1)[-1]
    for place, (job_name, step_names) in enumerate(names):
        job: Job | None = known.job(file, job_name)
        if job is None:
            continue
        steps = [(index, job.step(name)) for index, name in enumerate(step_names)]
        grouped = [(index, step) for index, step in steps if step is not None and step.group]
        if grouped:
            found[place] = grouped
    return found


def steps_lines(
    workflow: str, run: dict, jobs: list[dict], at: str, known: Known | None = None
) -> list[dict]:
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
    # A passed attempt keeps them too where anything did not succeed: a skipped step
    if run.get("conclusion") != "success" or any(
        job_end != "success" or any(end != "success" for end in step_ends or [])
        for job_end, step_ends in ends
    ):
        line["conclusions"] = ends
    grouped = group_steps(known, workflow, names)
    ids = [job.get("id") for job in ordered]
    pairs = [[place, ids[place]] for place in sorted(grouped) if type(ids[place]) is int]
    if pairs:
        line["groups"] = pairs
    return [line for line in (checked(shape), checked(line)) if line is not None]


def _step_end(steps: dict, place: int, index: int) -> str | None:
    """How a step of an attempt ended: a line without conclusions is one where all passed."""
    ends = steps.get("conclusions")
    if ends is None:
        return "success"
    try:
        return ends[place][1][index]
    except IndexError:
        return None


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
        now: datetime, rebuild: Rebuild | None, known: Known | None = None,
    ) -> None:  # fmt: skip
        self.gh, self.record, self.folder, self.state = gh, record, folder, state
        self.start, self.now, self.rebuild = start, now, rebuild
        self.known = known
        self.added = 0
        self.step = "lists"
        self.listed_now = 0  # spans listed whole by this collection

    def _at(self) -> str:
        return stamp(record.now())

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
        if line["kind"] in ("steps", "group"):
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
                        listed_at = record.now()
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
            and self._steps_stale(self.record.steps.get(f"steps:{line['run']}:{line['attempt']}"))
        ]
        # those that did not pass first, then the others; newest first in each
        wanted.sort(key=lambda line: (line["created"], line["run"], line["attempt"]), reverse=True)
        wanted.sort(key=lambda line: line["conclusion"] == "success")
        return wanted

    def _steps_stale(self, line: dict | None) -> bool:
        """A steps line to read again: not there, before a rebuild, or made by older rules
        (which did not tell a skipped step of a passed attempt from one that passed)."""
        return self._stale(line) or (
            line is not None and line["v"] < RULES and not line.get("unreadable")
        )

    def jobs(self) -> None:
        self.step = "jobs"
        for run in self.steps_left():
            held = self.record.steps.get(f"steps:{run['run']}:{run['attempt']}")
            try:
                jobs = _read_jobs(self.gh, run)
                lines = steps_lines(run["workflow"], run, jobs, self._at(), self.known)
            except NotFound:  # GitHub no longer has it: what was read before is kept
                line = checked({
                    **(held or {"seconds": [], "shape": None}),
                    # what was read before keeps the rules it was read by
                    "id": f"steps:{run['run']}:{run['attempt']}", "kind": "steps",
                    "v": held["v"] if held else RULES,
                    "at": self._at(), "run": run["run"], "attempt": run["attempt"],
                    "unreadable": True,
                })  # fmt: skip
                lines = [line] if line is not None else []
            self._write(
                [line for line in lines if line["kind"] != "shape"
                 or line["id"].removeprefix("shape:") not in self.record.shapes]
            )  # fmt: skip
            # A failed group step: its job's log, read once, now
            for job in self.groups_left(run, failed_only=True):
                self._read_summary(run, *job)

    # ── Group steps' summaries ──────────────────────────────────────────────

    def groups_left(self, run: dict, failed_only: bool = False) -> list[tuple]:
        """The jobs of an attempt whose group steps ran and have no summary on record:
        (job's place, its id, its name, [(step name, Step)], whether one failed)."""
        steps = self.record.steps.get(f"steps:{run['run']}:{run['attempt']}")
        if steps is None or not steps.get("groups") or self.known is None:
            return []
        shape = self.record.shapes.get(steps["shape"] or "")
        if shape is None:
            return []
        held = self.record.groups.get(f"group:{run['run']}:{run['attempt']}")
        done = {(entry[0], entry[1]) for entry in held["steps"]} if held and not (
            self._stale(held)
        ) else set()  # fmt: skip
        grouped = group_steps(self.known, run["workflow"], shape["jobs"])
        left = []
        for place, job_id in steps["groups"]:
            if place >= len(shape["jobs"]) or place not in grouped:
                continue
            job_name, step_names = shape["jobs"][place]
            ran, failed = [], False
            for index, step in grouped[place]:
                end = _step_end(steps, place, index)
                if end in ("success", "failure", "timed_out"):
                    ran.append((step_names[index], step))
                    failed = failed or end != "success"
            if not ran or all((job_name, name) in done for name, _ in ran):
                continue
            if failed or not failed_only:
                left.append((place, job_id, job_name, ran, failed))
        return left

    def _read_summary(  # noqa: PLR0913 - one job of one attempt
        self, run: dict, _place: int, job_id: int, job_name: str, ran: list, _failed: bool
    ) -> None:
        commands: list[tuple[str, ...]] = [step.commands for _, step in ran]
        try:
            reads = read_steps(self.gh.log(job_id), commands)
        except NotFound:  # logs expire
            reads = [Read("log-gone", []) for _ in ran]
        except github.LogUnreadable:  # GitHub answered, not with the log: said, and gone on
            reads = [Read("unreadable", []) for _ in ran]
        identifier = f"group:{run['run']}:{run['attempt']}"
        held = self.record.groups.get(identifier)
        entries = {(entry[0], entry[1]): entry for entry in (held["steps"] if held else [])}
        for (name, _step), read in zip(ran, reads, strict=True):
            kept = entries.get((job_name, name))
            if read.status != "read" and kept is not None and kept[2] == "read":
                continue  # a summary read before is kept when it cannot be read again
            entries[(job_name, name)] = [job_name, name, read.status, read.dropped, read.commands]
        line = checked({"id": identifier, "kind": "group", "v": RULES, "at": self._at(),
                        "run": run["run"], "attempt": run["attempt"],
                        "steps": [entries[key] for key in sorted(entries)]})  # fmt: skip
        if line is not None:
            self._write([line])

    def summaries_left(self) -> list[tuple[dict, tuple]]:
        """Every job left to read a summary from: failed ones first, then the others, newest
        first in each."""
        left = [
            (run, job)
            for run in self.record.runs.values()
            if self.in_window(run) and run["status"] == "completed"
            for job in self.groups_left(run)
        ]
        left.sort(key=lambda item: (item[0]["created"], item[0]["run"], item[0]["attempt"]),
                  reverse=True)  # fmt: skip
        left.sort(key=lambda item: not item[1][4])
        return left

    def logs(self) -> None:
        self.step = "logs"
        for run, job in self.summaries_left():
            self._read_summary(run, *job)

    def reached(self) -> dict:
        window = (self.now - self.start).total_seconds()
        have = listed_spans(self.record, self.now, self.rebuild)
        missing = gaps(self.start, self.now, have)
        left = sum((end - begun).total_seconds() for begun, end in missing)
        latest = self.latest()
        summaries = self.summaries_left()
        return {
            "step": self.step,
            "window_listed": share(window - left, window),
            "listed_whole": not missing,
            "runs": len(latest),
            "attempts_left": len(self.attempts_left()),
            "steps_left": len(self.steps_left()),
            "failed_summaries_left": sum(job[4] for _, job in summaries),
            "passed_summaries_left": sum(not job[4] for _, job in summaries),
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
            f"Pass sources from: {', '.join(SOURCES)}. This botcore collects: "
            f"{' and '.join(BUILT)}",
        )
    unbuilt = [source for source in sources if source not in BUILT]
    if unbuilt:
        return _fail(
            "VALIDATION_ERROR", f"This botcore does not collect {', '.join(unbuilt)} yet",
            f"Pass sources from: {', '.join(BUILT)}, the sources this botcore collects",
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
        sources: What to read: `ci` (the Actions runs) and `main` (the fix commits and
            reverts on the default branch, and the issues they close). The plan's `reviews`
            and `runs` are refused until a botcore collects them. Default: `ci`.
        requests: The most GitHub requests this collection makes: 1 to 5000 (default 1000).
            It also stops when the account's hourly allowance is down to half.
        rebuild: Ask GitHub again for everything in the window, whatever the record holds.
    """
    chosen = list(sources) if sources is not None else ["ci"]
    if all(isinstance(source, str) for source in chosen):
        chosen = list(dict.fromkeys(chosen))  # each once: `ci` twice is `ci` alone
    refused = _check_inputs(since_days, chosen, requests)
    if refused is not None:
        return refused
    return await run_blocking(_collect_sync, since_days, chosen, requests, rebuild)


def collect_at(
    root: Path,
    sources: list[str] | None = None,
    requests: int = DEFAULT_REQUESTS,
    *,
    do_fetch: bool = False,
    fetch_error: str | None = None,
) -> CommandResult[dict]:
    """A collection for the checkout at `root`, as `gate_outcome_collect` makes one for the
    checkout it is called from: what the hourly job runs for each checkout the machine's
    settings name. Synchronous, for the job's own step."""
    chosen = list(sources) if sources is not None else ["ci"]
    if all(isinstance(source, str) for source in chosen):
        chosen = list(dict.fromkeys(chosen))
    refused = _check_inputs(7, chosen, requests)
    if refused is not None:
        return refused
    return _collect_sync(
        7, chosen, requests, False, root=root, do_fetch=do_fetch, fetch_error=fetch_error
    )


def _collect_sync(  # noqa: PLR0911, PLR0913 - the collection's entry
    since_days: int,
    sources: list[str],
    requests: int,
    rebuild: bool,
    *,
    root: Path | None = None,
    do_fetch: bool = True,
    fetch_error: str | None = None,
) -> CommandResult[dict]:
    found = workspace_repo() if root is None else checkout_repo(root)
    if found is None:
        return no_workspace()
    root, repo = found
    try:
        here = local()
    except (SettingsError, InvalidMachine) as exc:
        return settings_refused(exc)
    base = state_dir()
    folder = repo_folder(base, repo)
    known = read_known(root) if "ci" in sources else None
    try:
        with RunLock(base / LOCK_FILE, label="gate-outcome-collect"):
            result = _collect(
                repo, folder, here, since_days, requests, rebuild, known, root=root,
                sources=sources, do_fetch=do_fetch, fetch_error=fetch_error,
            )  # fmt: skip
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


def _collect(  # noqa: PLR0913, C901, PLR0912, PLR0915 - one collection, start to end
    repo: str, folder: Path, here: Local, since_days: int, requests: int, rebuild: bool,
    known: Known | None = None, root: Path | None = None, sources: list[str] | None = None,
    *, do_fetch: bool = True, fetch_error: str | None = None,
) -> CommandResult[dict]:  # fmt: skip
    sources = sources or ["ci"]
    record = load_record(state_dir(), repo, here)
    state = load_state(folder)
    now = record_now().replace(microsecond=0)
    start = _day(now) - timedelta(days=since_days - 1)
    # A rebuild under way is each source's own: collecting one never ends the other's
    redo: dict[str, Rebuild | None] = {}
    for source, key in REBUILD_KEYS.items():
        pending = state.get(key) if isinstance(state.get(key), dict) else None
        if rebuild and source in sources:  # to the millisecond: what this writes is after it
            pending = state[key] = {"since": stamp(record_now()), "start": _iso(start)}
        since, begun = (parse_time(pending.get(k)) for k in ("since", "start")) if pending else (
            None, None
        )  # fmt: skip
        redo[source] = Rebuild(since, begun) if since is not None and begun is not None else None
    state.update(
        version=STATE_VERSION, machine=here.machine, repo=repo,
        record_id=state.get("record_id") or uuid.uuid4().hex,
    )  # fmt: skip
    record.states[here.machine] = state  # what this collection lists counts as it goes
    gh = GitHub(repo, requests)
    collection = Collection(gh, record, folder, state, start, now, redo["ci"], known)
    found: dict[str, dict] = {}

    def rebuilt(source: str) -> None:
        held = redo[source]
        if REBUILD_KEYS[source] in state and (held is None or start <= held.start):
            state.pop(REBUILD_KEYS[source])

    if "main" in sources:
        main_source, whole = _collect_main(
            root or Path.cwd(), repo, collection, redo["main"],
            do_fetch=do_fetch, fetch_error=fetch_error,
        )  # fmt: skip
        found["main"] = main_source
        if whole:
            rebuilt("main")
        if main_source["status"] == "absent" and sources == ["main"]:
            return _fail(
                "SOURCE_UNREADABLE", f"The default branch of {repo} could not be read: "
                f"{main_source['why']}",
                "Run it from a clone whose origin's default branch has been fetched "
                "(git fetch origin), then run gate-outcome-collect again",
            )  # fmt: skip

    if "ci" in sources:
        outcome = _collect_ci(collection, requests, alone=sources == ["ci"], repo=repo)
        if isinstance(outcome, CommandResult):
            return outcome
        found["ci"], whole = outcome
        if whole:
            rebuilt("ci")

    folded = fold.fold_record(folder, record, known, now, here.machine) if "ci" in sources else None
    state["collected_at"] = stamp(record_now())
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
        "sources": [found[source] for source in SOURCES if source in found],
        "requests_used": gh.used,
    }
    if gh.allowance is not None:
        data["allowance"] = gh.allowance
    if gh.graphql_allowance is not None:
        data["allowance_graphql"] = gh.graphql_allowance
    if folded is not None:
        data["folded"] = folded
    if known is not None and known.error:
        data["warnings"] = [
            f"No hook group step's summary was read: {known.error}, so the checks known "
            "could not be read"
        ]
    told = [found[source] for source in SOURCES if source in found]
    reasoning = "; ".join(
        f"{source['source']} is {source['status']}"
        + (f": {source['found']} found, {source['added']} lines added" if "found" in source else "")
        + (f" ({source['why']})" if source.get("why") else "")
        for source in told
    )
    return success(data, reasoning=reasoning)


def _collect_main(  # noqa: PLR0913 - the main source's inputs
    root: Path,
    repo: str,
    collection: Collection,
    redo: Rebuild | None,
    *,
    do_fetch: bool = True,
    fetch_error: str | None = None,
) -> tuple[dict, bool]:
    """The `main` source: the fix commits and reverts in the window, and what GitHub says of
    the issues they close. Its entry, and whether it read all."""
    at = stamp(record.now())

    def stale(line: dict) -> bool:
        return redo is not None and redo.stale(parse_time(line["at"]), parse_time(line["landed"]))

    read = main_source.read_main(
        root, repo, collection.gh, collection.record, collection.start, collection.now, stale, at,
        do_fetch=do_fetch, fetch_error=fetch_error,
    )  # fmt: skip
    collection._write(read.lines)  # noqa: SLF001 - the collection's own writer
    state = collection.state
    held = state.get("main")
    kept = held.get("days") if isinstance(held, dict) else None
    days = dict(kept) if isinstance(kept, dict) else {}
    days.update(read.days)
    entry: dict = {"status": read.status, "at": at, "days": days}
    if read.why:
        entry["why"] = read.why
    if read.tip:
        entry["tip"] = read.tip
    state["main"] = entry
    source: dict = {"source": "main", "status": read.status}
    if read.status != "absent":
        source.update(found=read.found, added=len(read.lines))
    if read.why:
        source["why"] = read.why
    return source, read.status == "read"


def _collect_ci(
    collection: Collection, requests: int, alone: bool, repo: str
) -> CommandResult[dict] | tuple[dict, bool]:
    """The `ci` source: its entry and whether it read all, or the refusal when it read
    nothing and was the only source asked for."""
    why: str | None = None
    added_before = collection.added
    try:
        collection.lists()
        collection.attempts()
        collection.jobs()
        collection.logs()
    except Stop as stop:
        why = {
            "requests": f"requests: reached the limit of {requests} requests",
            "allowance": "allowance: the account's hourly GitHub allowance is down to half",
        }[stop.why]
    except (github.ServiceUnavailable, github.SourceUnreadable, NotFound) as exc:
        if collection.added == added_before and not collection.listed_now:
            if not alone:  # another source was read: this one is absent, and says why
                reason = (
                    f"gh: GitHub could not be read ({exc})"
                    if isinstance(exc, github.ServiceUnavailable)
                    else f"github: GitHub's Actions runs could not be read ({exc})"
                )
                collection.state["ci"] = {"status": "absent", "why": reason,
                                          "at": stamp(record_now())}  # fmt: skip
                return {"source": "ci", "status": "absent", "why": reason, "added": 0}, False
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
        and not reached["failed_summaries_left"]
    )  # fmt: skip
    status = "read" if whole else "partly"
    going = sum(line["status"] != "completed" for line in collection.latest().values())
    source: dict = {"source": "ci", "status": status, "found": reached["runs"],
                    "added": collection.added - added_before, "still_going": going}  # fmt: skip
    if not whole:
        source["why"] = why or "the window is not all read"
        source["reached"] = reached
    collection.state["ci"] = {k: v for k, v in source.items() if k in ("status", "why", "reached")}
    collection.state["ci"]["at"] = stamp(record_now())
    return source, bool(whole)
