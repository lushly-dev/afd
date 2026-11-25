"""`gate-outcome-report`: how often each workflow, or each check, ran in each event, how its runs
ended and what they cost, or the fix commits and escapes by area, from every machine's gate
outcome record. Read-only.

A run is counted once, as its latest attempt, in the window of whole UTC days its creation
falls in. How a run ended is never merged: passed, failed, cancelled, `action_required`,
skipped (and any other conclusion, as `other`) are counted apart. A run still going is in no
count and is named in `warnings`. By check, see report_checks.py; by area, report_areas.py.

A repository can name its verdict workflows (botcore.toml `[gate_outcome] verdict_workflows`):
one that judges the others fails whenever another did, so it keeps its own row, marked, and the
totals and the queue's failed groups leave it out and say so.
"""

from __future__ import annotations

import difflib
import tomllib
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from afd import CommandResult, error, success
from pydantic import ValidationError

from botcore.commands.disk.settings import SettingsError
from botcore.commands.disk.steps import run_blocking
from botcore.commands.gate_outcome import record as record_module
from botcore.commands.gate_outcome.checks import Known, read_known, toplevel
from botcore.commands.gate_outcome.collect import (
    FRESH,
    MAX_DAYS,
    SETTLE,
    gaps,
    no_workspace,
    record_unavailable,
    share,
    spans,
    workspace_repo,
)
from botcore.commands.gate_outcome.record import (
    Record,
    load_record,
    parse_time,
    repo_folder,
    state_dir,
)
from botcore.commands.gate_outcome.report_areas import (
    by_area,
    known_areas,
    main_coverage,
    unknown_area,
)
from botcore.commands.gate_outcome.report_checks import (
    by_check,
    close_checks,
    observed_ids,
    observed_jobs,
)
from botcore.commands.skill_usage.collect import settings_refused
from botcore.commands.skill_usage.store import InvalidMachine, local
from botcore.config import GateOutcomeConfig, config_table

EVENTS = ("pull_request", "merge_group", "schedule", "push", "workflow_dispatch")
WHERE = (*EVENTS, "local")  # the plan's values; `local` is not collected yet
BY = ("workflow", "check", "area", "class", "decision")  # the plan's groupings
BY_BUILT = ("workflow", "check", "area")
# The plan's filters, and the groupings each goes with
FILTERS = ("where", "workflow", "check", "area", "finding_class", "decision", "pull_request", "due")
GOES_WITH = {
    "workflow": ("where", "workflow"),
    "check": ("where", "workflow", "check"),
    "area": ("area",),
    "class": ("finding_class", "area", "check", "decision", "pull_request"),
    "decision": ("check", "area", "due"),
}
SOURCES = ("ci", "main", "reviews", "runs")  # the plan's; this botcore collects `ci`, `main`
SORTS = ("minutes", "failed", "runs")
# The largest limit keeps the widest answer (by check, every event) under the local server's
# cut of 100,000 characters: 79,201 characters at 75 on a whole day of this repository's runs
# (lushly-dev/afd#2484), 103,058 at 100 and about 201,000 at 200
DEFAULT_LIMIT, MAX_LIMIT = 25, 75
WALL_CAP = timedelta(hours=6)  # a run's wall time counts at most this
MIN_RATE = 20  # passed and failed runs a rate needs
STALE_AFTER = timedelta(hours=26)
ENDS = {
    "success": "passed",
    "failure": "failed",
    "timed_out": "failed",
    "startup_failure": "failed",
    "cancelled": "cancelled",
    "action_required": "action_required",
    "skipped": "skipped",
}
COUNTS = ("passed", "failed", "cancelled", "action_required", "skipped", "other")
RAN = ("passed", "failed", "cancelled")  # ends after which steps had run
AFTER = ("failed", "cancelled", "unknown")  # what came before a pass on a later attempt
NOT_SEEN = (
    f"A run rerun more than {SETTLE.days} days after its day ended, until a rebuild "
    "(gate-outcome-collect --rebuild)",
    "Local runs: work before pnpm verify, and pnpm verify itself, are not collected yet",
)


def _validation(message: str, suggestion: str) -> CommandResult[dict]:
    return error("VALIDATION_ERROR", message, suggestion=suggestion)


def _check_inputs(  # noqa: PLR0911, PLR0913 - one refusal per input
    days: int, ending_days_ago: int, by: str, where: str | None, sort: str, limit: int,
    filters: Mapping[str, object],
) -> CommandResult[dict] | None:  # fmt: skip
    if type(days) is not int or not 1 <= days <= MAX_DAYS:
        return _validation(
            f"days must be a whole number from 1 to {MAX_DAYS}",
            "Pass days from 1 to 365, the whole UTC days to report, for example 7",
        )
    if type(ending_days_ago) is not int or not 0 <= ending_days_ago <= MAX_DAYS:
        return _validation(
            f"ending_days_ago must be a whole number from 0 to {MAX_DAYS}",
            "Pass ending_days_ago from 0 (the window ends today) to 365, for example 2",
        )
    built = f"{', '.join(BY_BUILT[:-1])} or {BY_BUILT[-1]}"
    if by not in BY:
        return _validation(f"by must be one of {', '.join(BY)}", f"Pass by: {built}")
    if by not in BY_BUILT:
        return _validation(
            f"This botcore does not report by {by} yet",
            f"Pass by: {built}, the groupings this botcore reports",
        )
    given = [name for name in FILTERS if filters.get(name) is not None]
    stray = [name for name in given if name not in GOES_WITH[by]]
    if stray:
        name = stray[0]
        others = [grouping for grouping, names in GOES_WITH.items() if name in names]
        return error(
            "INVALID_INPUT",
            f"The filter {name} does not go with by {by}",
            suggestion=f"With by {by}, filter by {', '.join(GOES_WITH[by])}; {name} goes with "
            f"by {' or '.join(others)}",
        )
    if where is not None and where not in WHERE:
        return _validation(
            f"where must be one of {', '.join(WHERE)}",
            f"Pass where as one of {', '.join(EVENTS)}, or leave it out for every event",
        )
    if where == "local":
        return _validation(
            "Local runs are not collected by this botcore yet",
            f"Pass where as one of {', '.join(EVENTS)}, or leave it out for every event",
        )
    for name in ("workflow", "check", "area"):
        if filters.get(name) is not None and not isinstance(filters[name], str):
            return _validation(f"{name} must be text", f"Pass {name} as it is written")
    if by == "area" and sort != "minutes":
        return error(
            "INVALID_INPUT",
            "sort does not go with by area: areas come by fix commits, most first",
            suggestion="Leave sort out with by area; it orders rows by workflow or by check",
        )
    if sort not in SORTS:
        return _validation(
            f"sort must be one of {', '.join(SORTS)}",
            f"Pass sort as one of {', '.join(SORTS)} (largest first); minutes is the default",
        )
    if type(limit) is not int or not 1 <= limit <= MAX_LIMIT:
        return _validation(
            f"limit must be a whole number from 1 to {MAX_LIMIT}",
            f"Pass limit from 1 to {MAX_LIMIT}, or leave it out for {DEFAULT_LIMIT}",
        )
    return None


@dataclass
class Row:
    file: str
    where: str
    name: str = ""
    named_at: str = ""
    verdict: bool = False
    counts: Counter = field(default_factory=Counter)
    later: Counter = field(default_factory=Counter)  # passed after: failed, cancelled, unknown
    wall: float = 0.0  # seconds
    heads: set[str] = field(default_factory=set)
    failed_heads: set[str] = field(default_factory=set)

    @property
    def runs(self) -> int:
        return sum(self.counts.values())

    def to_json(self) -> dict:
        data: dict = {"workflow": self.name, "file": self.file, "where": self.where,
                      "runs": self.runs}  # fmt: skip
        if self.verdict:
            data["verdict"] = True
        for end in COUNTS:
            if end != "other" or self.counts[end]:
                data[end] = self.counts[end]
        data["passed_on_later_attempt"] = sum(self.later.values())
        data["passed_after"] = {kind: self.later[kind] for kind in AFTER}
        data["wall_hours"] = round(self.wall / 3600, 1)
        if self.where == "merge_group":
            data["groups"], data["groups_failed"] = len(self.heads), len(self.failed_heads)
        data.update(rate(self.counts))
        return data


def rate(counts: Counter) -> dict:
    """Failed runs per 100 of those that passed or failed, on MIN_RATE of them or more."""
    over = counts["passed"] + counts["failed"]
    if over < MIN_RATE:
        return {"rates": "too-few"}
    return {"rates": "given", "failed_per_100_completed": round(100 * counts["failed"] / over, 1)}


def later_kind(earlier: list[str], missing: bool) -> str | None:
    """What came before a pass on a later attempt, from how the earlier attempts ended."""
    if "failed" in earlier:
        return "failed"
    if "cancelled" in earlier:
        return "cancelled"
    if missing:
        return "unknown"  # an earlier attempt not read yet
    return None  # passed again after passing: no failure to follow


def _file(path: str) -> str:
    return path.rsplit("/", 1)[-1]


def _known_workflows(record: Record, known: Known | None = None) -> dict[str, set[str]]:
    """Each workflow's file path, by every way a person may name it: its name, its file."""
    found: dict[str, set[str]] = {}
    for line in _workflow_lines(record):
        for name in (line["name"], _file(line["workflow"]), line["workflow"]):
            found.setdefault(name.lower(), set()).add(line["workflow"])
    for file in known.files if known else ():
        found.setdefault(file.lower(), set()).add(f".github/workflows/{file}")
    return found


def _workflow_lines(record: Record) -> list[dict]:
    """Every line that names a workflow: the runs, and a folded day's workflow lines."""
    return [
        *record.runs.values(),
        *(line for line in record.folds.values() if line["kind"] == "folded-workflow"),
    ]


def _unknown_workflow(workflow: str, record: Record) -> CommandResult[dict]:
    lines = _workflow_lines(record)
    names = sorted({line["name"] for line in lines})
    files = sorted({_file(line["workflow"]) for line in lines})
    close = difflib.get_close_matches(workflow, [*names, *files], n=5, cutoff=0.4)
    count = len({line["workflow"] for line in lines})
    return error(
        "INVALID_INPUT",
        f"The record knows no workflow '{workflow}'",
        suggestion=(f"Closest: {', '.join(close)}. " if close else "")
        + f"The record knows {count} workflows; pass one by its name or its file",
    )


def _unparsed(top: Path) -> str | None:
    """The configuration file botcore would read that does not parse, if one does not."""
    for name in ("pyproject.toml", "botcore.toml"):
        path = top / name
        try:
            data = tomllib.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            continue
        except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError):
            return name
        if name == "pyproject.toml" and "botcore" not in data.get("tool", {}):
            continue
        return None
    return None


def verdict_workflows(root: Path, record: Record) -> tuple[set[str], list[str]]:
    """The paths of the workflows the repository's botcore.toml (at the top of the checkout,
    as it is in the working tree) names as verdicts, and what to warn of."""
    top = toplevel(root)
    broken = _unparsed(top)
    if broken:
        return set(), [f"{broken} does not parse: no verdict workflow is left out of the totals"]
    table = config_table(top).get("gate_outcome", {})
    try:
        names = GateOutcomeConfig.model_validate(table).verdict_workflows
    except ValidationError as exc:
        first = exc.errors()[0]
        return set(), [
            f"botcore.toml's [gate_outcome] is not valid for this botcore ({first['msg']}): "
            "no verdict workflow is left out of the totals"
        ]
    known = _known_workflows(record)
    paths: set[str] = set()
    warnings = []
    for name in names:
        found = known.get(name.lower())
        if found:
            paths |= found
        else:
            warnings.append(
                f"The verdict workflow {name} named in botcore.toml is not in the record"
            )
    return paths, warnings


async def gate_outcome_report(  # noqa: PLR0913 - the command's inputs
    days: int = 7,
    ending_days_ago: int = 0,
    by: str = "workflow",
    where: str | None = None,
    workflow: str | None = None,
    check: str | None = None,
    area: str | None = None,
    finding_class: str | None = None,
    decision: str | None = None,
    pull_request: int | None = None,
    due: bool | None = None,
    sort: str = "minutes",
    limit: int = DEFAULT_LIMIT,
) -> CommandResult[dict]:
    """Report, for the repository of this checkout, each workflow's or each check's runs in
    each event over a window of whole UTC days: how they ended, counted apart, what they cost
    and, for the merge queue, its groups and how many had a failure. Read-only.

    Args:
        days: Whole UTC days in the window: 1 to 365 (default 7).
        ending_days_ago: The window's last day is this many days before today: 0 to 365.
        by: `workflow`, `check` (a step of a job, or a command of a hook group step) or
            `area` (the fix commits on the default branch by the unit that holds their files,
            and the escapes they close). The plan's `class` and `decision` are refused until a
            botcore reports them.
        where: Only runs of this event: `pull_request`, `merge_group`, `schedule`, `push` or
            `workflow_dispatch`. Left out, every one of them. Goes with both groupings.
        workflow: Only this workflow, by its name (`CI`) or its file (`ci.yml`). Goes with
            both groupings.
        check: Only this check, written as its id (`ci.yml / TypeScript (Node 26.x) / Quality
            gate / lint`). Goes with `by: check`.
        area: Only this area, with `by: area`: a unit's folder (`packages/core`),
            `repository` or `several`; its commits are then listed in `examples`, newest
            first, with the issues each closes.
        finding_class: The plan's filter for `by: class`; refused here.
        decision: The plan's filter for `by: class` and `decision`; refused here.
        pull_request: The plan's filter for `by: class`; refused here.
        due: The plan's filter for `by: decision`; refused here.
        sort: `minutes` (the default), `failed` or `runs`; largest first.
        limit: Rows to give, and entries of each other list: 1 to 75 (default 25); `more`
            says how many each list left out.
    """
    filters = {"where": where, "workflow": workflow, "check": check, "area": area,
               "finding_class": finding_class, "decision": decision,
               "pull_request": pull_request, "due": due}  # fmt: skip
    refused = _check_inputs(days, ending_days_ago, by, where, sort, limit, filters)
    if refused is not None:
        return refused
    return await run_blocking(
        _report_sync, days, ending_days_ago, by, where, workflow, check, sort, limit,
        record_module.now(), area,
    )  # fmt: skip


@dataclass
class Window:
    first: object
    last: object
    since: datetime
    until: datetime


@dataclass
class Scan:
    """One pass over the window's runs, and the folded lines of its folded days."""

    rows: dict[tuple[str, str], Row] = field(default_factory=dict)
    finished: list[tuple[dict, dict[int, dict]]] = field(default_factory=list)
    left_out: Counter = field(default_factory=Counter)
    going: list[int] = field(default_factory=list)
    ran: int = 0
    with_steps: int = 0
    unreadable_steps: int = 0
    queue_heads: set[str] = field(default_factory=set)
    queue_failed: set[str] = field(default_factory=set)
    folded: list[dict] = field(default_factory=list)  # folded-workflow lines in scope
    folded_days: set[str] = field(default_factory=set)  # the window's folded days

    def add(  # noqa: C901, PLR0912, PLR0913 - one run
        self, record: Record, run_id: int, held: dict[int, dict], where: str | None,
        wanted: set[str] | None, verdicts: set[str],
    ) -> None:  # fmt: skip
        """One run, as its latest attempt, with its earlier attempts in `held`."""
        latest = held[max(held)]
        if latest["event"] not in EVENTS:
            self.left_out[latest["event"]] += 1
            return
        if (where is not None and latest["event"] != where) or (
            wanted is not None and latest["workflow"] not in wanted
        ):
            return
        if latest["status"] != "completed":
            self.going.append(run_id)
            return
        self.finished.append((latest, held))
        end = ENDS.get(latest["conclusion"] or "", "other")
        key = (latest["workflow"], latest["event"])
        verdict = latest["workflow"] in verdicts
        row = self.rows.setdefault(
            key, Row(file=_file(latest["workflow"]), where=latest["event"], verdict=verdict)
        )
        if latest["created"] >= row.named_at:
            row.name, row.named_at = latest["name"], latest["created"]
        row.counts[end] += 1
        created = parse_time(latest["created"])
        assert created is not None
        updated = parse_time(latest["updated"]) or created
        row.wall += min(max(updated - created, timedelta(0)), WALL_CAP).total_seconds()
        if end == "passed" and latest["attempt"] > 1:
            earlier = [held[k] for k in range(1, latest["attempt"]) if k in held]
            kind = later_kind(
                [ENDS.get(line["conclusion"] or "", "other") for line in earlier],
                len(earlier) < latest["attempt"] - 1
                or any(line["status"] != "completed" for line in earlier),
            )
            if kind is not None:
                row.later[kind] += 1
        if end in RAN:
            self.ran += 1
            steps = record.steps.get(f"steps:{run_id}:{latest['attempt']}")
            if steps is not None and steps.get("unreadable") and not steps["seconds"]:
                self.unreadable_steps += 1  # GitHub no longer has them: on record as unreadable
            else:
                self.with_steps += steps is not None
        if latest["event"] == "merge_group" and latest["head"]:
            row.heads.add(latest["head"])
            if end == "failed":
                row.failed_heads.add(latest["head"])
            if not verdict:
                self.queue_heads.add(latest["head"])
                if end == "failed":
                    self.queue_failed.add(latest["head"])

    def add_folded(
        self, line: dict, where: str | None, wanted: set[str] | None, verdicts: set[str]
    ) -> None:
        """A folded day's line for one workflow and event, as `add` counts its runs."""
        if line["event"] not in EVENTS:
            self.left_out[line["event"]] += line["left_out"]
            return
        if (where is not None and line["event"] != where) or (
            wanted is not None and line["workflow"] not in wanted
        ):
            return
        self.folded.append(line)
        self.going.extend(line["going"])
        self.ran += line["ran"]
        self.with_steps += line["with_steps"]
        self.unreadable_steps += line["unreadable_steps"]
        if not any(line["counts"].values()):
            return  # only runs still going: no row, as for runs not folded
        verdict = line["workflow"] in verdicts
        row = self.rows.setdefault(
            (line["workflow"], line["event"]),
            Row(file=_file(line["workflow"]), where=line["event"], verdict=verdict),
        )
        if line["named_at"] >= row.named_at:
            row.name, row.named_at = line["name"], line["named_at"]
        row.counts.update({end: count for end, count in line["counts"].items() if count})
        row.later.update({kind: count for kind, count in line["later"].items() if count})
        row.wall += line["wall"]
        row.heads.update(line["heads"])
        row.failed_heads.update(line["failed_heads"])
        if not verdict:
            self.queue_heads.update(line["heads"])
            self.queue_failed.update(line["failed_heads"])


def by_run(record: Record) -> dict[int, dict[int, dict]]:
    """Each run's attempts on record, by number."""
    attempts: dict[int, dict[int, dict]] = {}
    for line in record.runs.values():
        attempts.setdefault(line["run"], {})[line["attempt"]] = line
    return attempts


def _scan(  # noqa: PLR0913 - the window and its filters
    record: Record, window: Window, where: str | None, wanted: set[str] | None,
    verdicts: set[str],
) -> Scan:  # fmt: skip
    scan = Scan()
    for run_id, held in by_run(record).items():
        created = parse_time(held[max(held)]["created"])
        if created is None or not window.since <= created < window.until:
            continue
        scan.add(record, run_id, held, where, wanted, verdicts)
    first, last = str(window.first), str(window.last)
    for line in sorted(record.folds.values(), key=lambda line: line["id"]):
        if line["kind"] == "folded-workflow" and first <= line["day"] <= last:
            scan.folded_days.add(line["day"])
            scan.add_folded(line, where, wanted, verdicts)
    return scan


def day_ranges(days: set[str]) -> list[dict]:
    """Days as runs of consecutive days: [{first, last}]."""
    ranges: list[dict] = []
    for day in sorted(days):
        if ranges and date.fromisoformat(ranges[-1]["last"]) + timedelta(days=1) == (
            date.fromisoformat(day)
        ):
            ranges[-1]["last"] = day
        else:
            ranges.append({"first": day, "last": day})
    return ranges


def _totals(scan: Scan, where: str | None) -> dict:
    """Every row in scope, shown or not, but a verdict's."""
    counted = [row for row in scan.rows.values() if not row.verdict]
    totals: Counter = Counter()
    after: Counter = Counter()
    for row in counted:
        totals.update(row.counts)
        after.update(row.later)
    data: dict = {"runs": sum(totals.values())}
    for end in COUNTS:
        if end != "other" or totals[end]:
            data[end] = totals[end]
    data["passed_on_later_attempt"] = sum(after.values())
    data["passed_after"] = {kind: after[kind] for kind in AFTER}
    data["wall_hours"] = round(sum(row.wall for row in counted) / 3600, 1)
    if where in (None, "merge_group") and scan.queue_heads:
        data["groups"], data["groups_failed"] = len(scan.queue_heads), len(scan.queue_failed)
    data.update(rate(totals))
    left_out = sorted({row.file for row in scan.rows.values() if row.verdict})
    if left_out:
        data["verdicts_left_out"] = left_out
    return data


def _report_sync(  # noqa: C901, PLR0912, PLR0913, PLR0915 - one report
    days: int, ending_days_ago: int, by: str, where: str | None, workflow: str | None,
    check: str | None, sort: str, limit: int, now: datetime, area: str | None = None,
) -> CommandResult[dict]:  # fmt: skip
    found = workspace_repo()
    if found is None:
        return no_workspace()
    root, repo = found
    base = state_dir()
    try:
        here = local()
        record = load_record(base, repo, here)
    except (SettingsError, InvalidMachine) as exc:
        return settings_refused(exc)
    except OSError as exc:
        return record_unavailable(repo_folder(base, repo), exc)
    known = read_known(root) if by == "check" else None
    if check is not None and known is not None:
        ids = set(known.ids(observed_jobs(record))) | observed_ids(record, known)
        if check not in ids:
            close = close_checks(check, ids)
            return error(
                "INVALID_INPUT",
                f"No check '{check}' is known or on record",
                suggestion=(f"Closest: {'; '.join(close)}. " if close else "")
                + f"{len(ids)} checks are known; pass one as its id is written, "
                "<workflow file> / <job> / <step>[ / <command>], or leave check out to list them. "
                "The legs of a job whose matrix an expression decides are known by the names a "
                "collection has seen: run gate-outcome-collect first",
            )
    units = None
    if by == "area":
        areas, units = known_areas(root, record)
        if area is not None and area.rstrip("/") not in areas:
            refusal = unknown_area(area, areas)
            return error("INVALID_INPUT", refusal["message"], suggestion=refusal["suggestion"])
        area = area.rstrip("/") if area is not None else None
    if record.empty:
        return error(
            "NOT_COLLECTED",
            f"No machine's gate outcome record holds {repo} yet",
            suggestion="Run gate-outcome-collect from this checkout first: sources: [ci] "
            "reads the Actions runs from GitHub, and sources: [main] the fix commits on the "
            "default branch",
        )
    wanted: set[str] | None = None
    if workflow is not None:
        wanted = _known_workflows(record, known).get(workflow.lower())
        if wanted is None:
            return _unknown_workflow(workflow, record)
    verdicts, warnings = verdict_workflows(root, record) if by != "area" else (set(), [])

    last = now.date() - timedelta(days=ending_days_ago)
    first = last - timedelta(days=days - 1)
    since = datetime(first.year, first.month, first.day, tzinfo=UTC)
    window = Window(first, last, since, since + timedelta(days=days))
    seen_until = min(window.until, now)
    scan = _scan(record, window, where, wanted, verdicts)

    # what of the window was listed, by any machine, at any time
    told = [
        (begun, ended, parse_time(entry.get("at")) if entry.get("to_now") is True else None)
        for state in record.states.values()
        for begun, ended, entry in spans(state)
    ]
    have = [(begun, ended) for begun, ended, _ in told] + record.folded_spans()
    listed_until = max((ended for _, ended, _ in told), default=None)
    # The seconds since a collection, within the hour, that listed up to the moment it began
    # are not missing: a run created since is the next collection's, as `collected` says
    fresh = [ended for _, ended, at in told if at is not None and now - at < FRESH]
    if fresh:
        have.append((max(fresh), now))
    missing = gaps(since, seen_until, have) if since < seen_until else []
    unlisted = sum((end - begun).total_seconds() for begun, end in missing)
    length = (seen_until - since).total_seconds()
    listed_share = share(length - unlisted, length)
    steps_share = share(scan.with_steps, scan.ran) if scan.ran else None
    observed = bool(scan.rows or scan.going or scan.left_out)  # a run in the window is on record
    if not missing and scan.with_steps + scan.unreadable_steps == scan.ran:
        status = "read"
    elif unlisted >= length and not observed:
        status = "absent"  # nothing of the window was read: no counts are given
    else:
        status = "partly"

    key_of = {
        "minutes": lambda row: row.wall,
        "failed": lambda row: row.counts["failed"],
        "runs": lambda row: row.runs,
    }[sort]
    ordered = sorted(scan.rows.values(), key=lambda row: (row.name, row.file, row.where))
    ordered.sort(key=key_of, reverse=True)
    shown = ordered[:limit]
    total_json = _totals(scan, where)

    machines: dict[str, dict] = {}
    newest: datetime | None = None
    for machine, state in sorted(record.states.items()):
        collected = state.get("collected_at")
        ci: dict = state["ci"] if isinstance(state.get("ci"), dict) else {}
        main: dict = state["main"] if isinstance(state.get("main"), dict) else {}
        machines[machine] = {"collected_at": collected, "ci": ci.get("status"),
                             "main": main.get("status")}  # fmt: skip
        if ci.get("why"):
            machines[machine]["why"] = ci["why"]
        if main.get("why"):
            machines[machine]["main_why"] = main["why"]
        # How old the source this report rests on is: each source says when it was read
        source, held = ("main", main) if by == "area" else ("ci", ci)
        when = held.get("at") or (collected if held and source == "ci" else None)
        moment = parse_time(when)
        if source == "ci" and moment is not None and (newest is None or moment > newest):
            newest = moment
        if moment is None or now - moment > STALE_AFTER:
            warnings.append(
                f"{machine} last collected {source} {when or 'never'}: run gate-outcome-collect "
                f"with sources: [{source}] for current numbers"
            )
    ci_warnings = by != "area"  # a report by area rests on the main source alone
    hint = ""
    if missing:
        named = sorted({begun.date().isoformat() for begun, _ in missing})
        reach = (now.date() - first).days + 1
        hint = f"The record does not hold every run of {', '.join(named)}: run " + (
            f"gate-outcome-collect with since_days {reach}" if reach <= MAX_DAYS else
            f"gate-outcome-collect with since_days {MAX_DAYS}; days before that cannot be "
            "collected"
        )  # fmt: skip
    if status == "absent" and ci_warnings:  # one warning, which says what to run
        warnings.append(
            f"ci is absent: nothing of {first} to {last} was collected, so no figure is given. "
            + (hint or "Run gate-outcome-collect")
        )
    if scan.going and ci_warnings:
        listed = ", ".join(str(run) for run in sorted(scan.going)[:5])
        warnings.append(
            f"{len(scan.going)} runs were still going when last listed and are in no count "
            f"(runs {listed}{' and more' if len(scan.going) > 5 else ''})"  # noqa: PLR2004
        )
    if hint and status != "absent" and ci_warnings:
        warnings.append(hint)
    if record.missing:
        warnings.append(f"{record.missing}, so only this machine's record was read")
    for machine in record.partial:
        warnings.append(
            f"{machine}'s copy in the shared folder is not whole and was not read: a sync may "
            "be part way through"
        )
    for machine, lines in sorted(record.unreadable.items()):
        warnings.append(f"{lines} lines of {machine}'s record could not be read and were skipped")
    if scan.left_out and ci_warnings:
        warnings.append(
            f"{sum(scan.left_out.values())} runs of other events are left out: "
            + ", ".join(f"{event} {count}" for event, count in sorted(scan.left_out.items()))
        )

    sources = dict.fromkeys(SOURCES, "absent")  # the others are not collected yet
    sources["ci"] = status
    sources["main"] = main_coverage(record, since, window.until, now).status
    data: dict = {
        "repository": repo,
        "window": {
            "days": days,
            "ending_days_ago": ending_days_ago,
            "first_day": first.isoformat(),
            "last_day": last.isoformat(),
            "since": since.isoformat(),
            "until": window.until.isoformat(),
        },
        "totals": total_json if status != "absent" else None,
        "rows": [row.to_json() for row in shown],
        "coverage": {
            "sources": sources,
            "collected": {
                "ci": {
                    "newest": newest.isoformat() if newest else None,
                    "age_hours": round((now - newest).total_seconds() / 3600, 1)
                    if newest
                    else None,
                }
            },
            "events": [where] if where else list(EVENTS),
            "other_events_left_out": dict(sorted(scan.left_out.items())),
            "window_listed": listed_share,
            "listed_until": listed_until.isoformat() if listed_until else None,
            "steps_share": steps_share,
            "steps_unreadable": scan.unreadable_steps,
            "folded": day_ranges(scan.folded_days),
            "not_seen": list(NOT_SEEN),
        },
        "machines": machines,
        "warnings": warnings,
        "more": {"rows": len(ordered) - len(shown)},
    }
    if by == "area":
        reasoning = by_area(data, record, units, window, area, limit, now, warnings)
        return success(data, reasoning=reasoning)
    if by == "check":
        assert known is not None
        by_check(data, record, known, scan, verdicts, where, wanted, check, sort, limit,
                 status)  # fmt: skip
        return success(
            data,
            reasoning=f"{len(data['rows'])} of {len(data['rows']) + data['more']['rows']} check "
            f"rows and {data['more']['not_observed'] + len(data['not_observed'])} checks not "
            f"observed, {first} to {last}; ci is {status} and steps_share {steps_share}",
        )
    return success(
        data,
        reasoning=(
            f"Nothing of {first} to {last} was collected: run gate-outcome-collect"
            if status == "absent"
            else ""
        )
        or f"{total_json['runs']} finished runs of {len(ordered)} workflow and event "
        f"rows from {first} to {last}; ci is {status} for the window",
    )
