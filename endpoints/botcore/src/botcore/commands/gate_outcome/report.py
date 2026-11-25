"""`gate-outcome-report`: how often each workflow ran in each event, how its runs ended and what
they cost, from every machine's gate outcome record. Read-only.

A run is counted once, as its latest attempt, in the window of whole UTC days its creation
falls in. How a run ended is never merged: passed, failed, cancelled, `action_required`,
skipped (and any other conclusion, as `other`) are counted apart. A run still going is in no
count and is named in `warnings`.
"""

from __future__ import annotations

import difflib
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from afd import CommandResult, error, success

from botcore.commands.disk.settings import SettingsError
from botcore.commands.disk.steps import run_blocking
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
from botcore.commands.skill_usage.collect import settings_refused
from botcore.commands.skill_usage.store import InvalidMachine, local

EVENTS = ("pull_request", "merge_group", "schedule", "push", "workflow_dispatch")
WHERE = (*EVENTS, "local")  # the plan's values; `local` is not collected yet
BY = ("workflow", "check", "area", "class", "decision")  # the plan's groupings
BY_BUILT = ("workflow",)
SORTS = ("minutes", "failed", "runs")
DEFAULT_LIMIT, MAX_LIMIT = 25, 200
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
    days: int, ending_days_ago: int, by: str, where: str | None, sort: str, limit: int
) -> CommandResult[dict] | None:
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
    if by not in BY:
        return _validation(
            f"by must be one of {', '.join(BY)}", f"Pass by: {' or '.join(BY_BUILT)}"
        )
    if by not in BY_BUILT:
        return _validation(
            f"This botcore does not report by {by} yet",
            f"Pass by: {', '.join(BY_BUILT)}, the grouping this botcore reports",
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


def _file(path: str) -> str:
    return path.rsplit("/", 1)[-1]


def _known_workflows(record: Record) -> dict[str, set[str]]:
    """Each workflow's file path, by every way a person may name it: its name, its file."""
    known: dict[str, set[str]] = {}
    for line in record.runs.values():
        for name in (line["name"], _file(line["workflow"]), line["workflow"]):
            known.setdefault(name.lower(), set()).add(line["workflow"])
    return known


def _unknown_workflow(workflow: str, record: Record) -> CommandResult[dict]:
    names = sorted({line["name"] for line in record.runs.values()})
    files = sorted({_file(line["workflow"]) for line in record.runs.values()})
    close = difflib.get_close_matches(workflow, [*names, *files], n=5, cutoff=0.4)
    count = len({line["workflow"] for line in record.runs.values()})
    return error(
        "INVALID_INPUT",
        f"The record knows no workflow '{workflow}'",
        suggestion=(f"Closest: {', '.join(close)}. " if close else "")
        + f"The record knows {count} workflows; pass one by its name or its file",
    )


async def gate_outcome_report(  # noqa: PLR0913 - the command's inputs
    days: int = 7,
    ending_days_ago: int = 0,
    by: str = "workflow",
    where: str | None = None,
    workflow: str | None = None,
    sort: str = "minutes",
    limit: int = DEFAULT_LIMIT,
) -> CommandResult[dict]:
    """Report, for the repository of this checkout, each workflow's runs in each event over a
    window of whole UTC days: how they ended, counted apart, their wall hours and, for the
    merge queue, its groups and how many had a failure. Read-only.

    Args:
        days: Whole UTC days in the window: 1 to 365 (default 7).
        ending_days_ago: The window's last day is this many days before today: 0 to 365.
        by: `workflow`. The plan's `check`, `area`, `class` and `decision` are refused until
            a botcore reports them.
        where: Only runs of this event: `pull_request`, `merge_group`, `schedule`, `push` or
            `workflow_dispatch`. Left out, every one of them.
        workflow: Only this workflow, by its name (`CI`) or its file (`ci.yml`).
        sort: `minutes` (wall time, the default), `failed` or `runs`; largest first.
        limit: Rows to give: 1 to 200 (default 25); `more` says how many were left out.
    """
    refused = _check_inputs(days, ending_days_ago, by, where, sort, limit)
    if refused is not None:
        return refused
    return await run_blocking(
        _report_sync, days, ending_days_ago, where, workflow, sort, limit, datetime.now(UTC)
    )


def _report_sync(  # noqa: C901, PLR0912, PLR0913, PLR0915 - one pass over the record
    days: int, ending_days_ago: int, where: str | None, workflow: str | None, sort: str,
    limit: int, now: datetime,
) -> CommandResult[dict]:  # fmt: skip
    found = workspace_repo()
    if found is None:
        return no_workspace()
    _root, repo = found
    base = state_dir()
    try:
        here = local()
        record = load_record(base, repo, here)
    except (SettingsError, InvalidMachine) as exc:
        return settings_refused(exc)
    except OSError as exc:
        return record_unavailable(repo_folder(base, repo), exc)
    if record.empty:
        return error(
            "NOT_COLLECTED",
            f"No machine's gate outcome record holds {repo} yet",
            suggestion="Run gate-outcome-collect from this checkout first (sources: [ci]); "
            "it reads the Actions runs from GitHub",
        )
    wanted: set[str] | None = None
    if workflow is not None:
        wanted = _known_workflows(record).get(workflow.lower())
        if wanted is None:
            return _unknown_workflow(workflow, record)

    last = now.date() - timedelta(days=ending_days_ago)
    first = last - timedelta(days=days - 1)
    since = datetime(first.year, first.month, first.day, tzinfo=UTC)
    until = since + timedelta(days=days)
    seen_until = min(until, now)

    attempts: dict[int, dict[int, dict]] = {}
    for line in record.runs.values():
        attempts.setdefault(line["run"], {})[line["attempt"]] = line
    rows: dict[tuple[str, str], Row] = {}
    left_out: Counter = Counter()
    going: list[int] = []
    ran = with_steps = unreadable_steps = 0
    queue_heads: set[str] = set()
    queue_failed: set[str] = set()
    for run_id, held in attempts.items():
        latest = held[max(held)]
        created = parse_time(latest["created"])
        if created is None or not since <= created < until:
            continue
        if latest["event"] not in EVENTS:
            left_out[latest["event"]] += 1
            continue
        if (where is not None and latest["event"] != where) or (
            wanted is not None and latest["workflow"] not in wanted
        ):
            continue
        if latest["status"] != "completed":
            going.append(run_id)
            continue
        end = ENDS.get(latest["conclusion"] or "", "other")
        key = (latest["workflow"], latest["event"])
        row = rows.setdefault(key, Row(file=_file(latest["workflow"]), where=latest["event"]))
        if latest["created"] >= row.named_at:
            row.name, row.named_at = latest["name"], latest["created"]
        row.counts[end] += 1
        updated = parse_time(latest["updated"]) or created
        row.wall += min(max(updated - created, timedelta(0)), WALL_CAP).total_seconds()
        if end == "passed" and latest["attempt"] > 1:
            earlier = [held[k] for k in range(1, latest["attempt"]) if k in held]
            ends = {ENDS.get(line["conclusion"] or "", "other") for line in earlier}
            if "failed" in ends:
                kind: str | None = "failed"
            elif "cancelled" in ends:
                kind = "cancelled"
            elif len(earlier) < latest["attempt"] - 1 or any(
                line["status"] != "completed" for line in earlier
            ):
                kind = "unknown"  # an earlier attempt not read yet
            else:
                kind = None  # passed again after passing: no failure to follow
            if kind is not None:
                row.later[kind] += 1
        if end in RAN:
            ran += 1
            steps = record.steps.get(f"steps:{run_id}:{latest['attempt']}")
            if steps is not None and steps.get("unreadable") and not steps["seconds"]:
                unreadable_steps += 1  # GitHub no longer has them: on record as not readable
            else:
                with_steps += steps is not None
        if latest["event"] == "merge_group" and latest["head"]:
            row.heads.add(latest["head"])
            queue_heads.add(latest["head"])
            if end == "failed":
                row.failed_heads.add(latest["head"])
                queue_failed.add(latest["head"])

    # what of the window was listed, by any machine, at any time
    told = [
        (begun, ended, parse_time(entry.get("at")) if entry.get("to_now") is True else None)
        for state in record.states.values()
        for begun, ended, entry in spans(state)
    ]
    have = [(begun, ended) for begun, ended, _ in told]
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
    steps_share = share(with_steps, ran) if ran else None  # runs whose steps are known
    observed = bool(rows or going or left_out)  # a run in the window is on record
    if not missing and with_steps + unreadable_steps == ran:
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
    ordered = sorted(rows.values(), key=lambda row: (row.name, row.file, row.where))
    ordered.sort(key=key_of, reverse=True)
    shown = ordered[:limit]

    totals: Counter = Counter()
    for row in ordered:
        totals.update(row.counts)
    total_json: dict = {"runs": sum(totals.values())}
    for end in COUNTS:
        if end != "other" or totals[end]:
            total_json[end] = totals[end]
    after: Counter = Counter()
    for row in ordered:
        after.update(row.later)
    total_json["passed_on_later_attempt"] = sum(after.values())
    total_json["passed_after"] = {kind: after[kind] for kind in AFTER}
    total_json["wall_hours"] = round(sum(row.wall for row in ordered) / 3600, 1)
    if where in (None, "merge_group") and queue_heads:
        total_json["groups"], total_json["groups_failed"] = len(queue_heads), len(queue_failed)
    total_json.update(rate(totals))

    machines: dict[str, dict] = {}
    warnings: list[str] = []
    newest: datetime | None = None
    for machine, state in sorted(record.states.items()):
        collected = state.get("collected_at")
        ci: dict = state["ci"] if isinstance(state.get("ci"), dict) else {}
        machines[machine] = {"collected_at": collected, "ci": ci.get("status")}
        if ci.get("why"):
            machines[machine]["why"] = ci["why"]
        moment = parse_time(collected)
        if moment is not None and (newest is None or moment > newest):
            newest = moment
        if moment is None or now - moment > STALE_AFTER:
            warnings.append(
                f"{machine} last collected {collected or 'never'}: run gate-outcome-collect "
                "for current numbers"
            )
    if going:
        listed = ", ".join(str(run) for run in sorted(going)[:5])
        warnings.append(
            f"{len(going)} runs were still going when last listed and are in no count "
            f"(runs {listed}{' and more' if len(going) > 5 else ''})"  # noqa: PLR2004
        )
    if missing:
        named = sorted({begun.date().isoformat() for begun, _ in missing})
        reach = (now.date() - first).days + 1
        warnings.append(
            f"The record does not hold every run of {', '.join(named)}: run "
            + (f"gate-outcome-collect with since_days {reach}" if reach <= MAX_DAYS else
               f"gate-outcome-collect with since_days {MAX_DAYS}; days before that cannot "
               "be collected")
        )  # fmt: skip
    if record.missing:
        warnings.append(f"{record.missing}, so only this machine's record was read")
    for machine in record.partial:
        warnings.append(
            f"{machine}'s copy in the shared folder is not whole and was not read: a sync may "
            "be part way through"
        )
    for machine, lines in sorted(record.unreadable.items()):
        warnings.append(f"{lines} lines of {machine}'s record could not be read and were skipped")
    if left_out:
        warnings.append(
            f"{sum(left_out.values())} runs of other events are left out: "
            + ", ".join(f"{event} {count}" for event, count in sorted(left_out.items()))
        )

    data = {
        "repository": repo,
        "window": {
            "days": days,
            "ending_days_ago": ending_days_ago,
            "first_day": first.isoformat(),
            "last_day": last.isoformat(),
            "since": since.isoformat(),
            "until": until.isoformat(),
        },
        "totals": total_json if status != "absent" else None,
        "rows": [row.to_json() for row in shown],
        "coverage": {
            "sources": {"ci": status},
            "collected": {
                "ci": {
                    "newest": newest.isoformat() if newest else None,
                    "age_hours": round((now - newest).total_seconds() / 3600, 1)
                    if newest
                    else None,
                }
            },
            "events": [where] if where else list(EVENTS),
            "other_events_left_out": dict(sorted(left_out.items())),
            "window_listed": listed_share,
            "listed_until": listed_until.isoformat() if listed_until else None,
            "steps_share": steps_share,
            "steps_unreadable": unreadable_steps,
            "not_seen": list(NOT_SEEN),
        },
        "machines": machines,
        "warnings": warnings,
        "more": {"rows": len(ordered) - len(shown)},
    }
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
