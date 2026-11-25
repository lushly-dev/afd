"""`gate-outcome-report` by area: the fix commits on the default branch by the unit that holds
their files, the escapes they close and the commits that close none, from the `main` source.

A fix commit is an entry in an inventory, not a bug: one can close five issues and one can
answer a check that did its job. An **escape** is a closed issue with a bug label (one named
`bug` or `security`, or ending `:bug` or `:security`) that a fix commit closes, through its
message or its pull request, counted once however many commits close it. A fix commit that
closes no issue is **unconfirmed**. Where GitHub was not read for a commit, its row gives no
escape or unconfirmed count at all, and says how many commits it lacks. Reverts are counted
apart and close no escape.

The age of the last edit (`last_edit`) is the time from the newest of the lines a fix replaces
landing to the fix landing: the median over the commits it could be read for, with how many
those are. It is not the age of the bug.
"""

from __future__ import annotations

import difflib
import statistics
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from botcore.commands.gate_outcome.checks import default_ref
from botcore.commands.gate_outcome.collect import FRESH, MAX_DAYS, share
from botcore.commands.gate_outcome.main import days_known, units_at
from botcore.commands.gate_outcome.record import CHANNELS, CLASSES, Record, parse_time
from botcore.commands.gate_outcome.units import REPOSITORY, SEVERAL, Units

MIN_RATE = 20  # fix commits a rate needs
BUG_LABELS = ("bug", "security")
NOT_SEEN = (
    "Fixes that travel inside a commit of another type, such as a feat commit, are not seen: "
    "only fix commits and reverts are read",
)


def is_bug(label: str) -> bool:
    name = label.lower()
    return name in BUG_LABELS or name.endswith(tuple(f":{kind}" for kind in BUG_LABELS))


def area_of(units: list[str]) -> str:
    if not units:
        return REPOSITORY
    return units[0] if len(units) == 1 else SEVERAL


@dataclass
class Fix:
    """One commit line, read for the report."""

    line: dict
    landed: datetime
    area: str
    closed: list[int] | None  # every issue it closes; None where GitHub was not read
    escapes: list[int] | None  # those that are closed and carry a bug label

    @property
    def github(self) -> bool:
        return self.closed is not None

    def found(self, issue: int | None) -> tuple[str, str | None]:
        """How an issue it closes was found and its class, from the commit's lines: the line
        that names it, else one that names none; `absent` where no line fits."""
        lines = self.line["found_by"]
        for channel, kind, named in lines:
            if issue is not None and named == issue:
                return channel, kind
        for channel, kind, named in lines:
            if named is None:
                return channel, kind
        return "absent", None

    @property
    def channel(self) -> str:
        channels = {channel for channel, _, _ in self.line["found_by"]}
        if not channels:
            return "unreadable" if self.line["found_by_unread"] else "absent"
        return channels.pop() if len(channels) == 1 else "several"

    @property
    def age_days(self) -> float | None:
        newest = parse_time(self.line["last_edit"])
        if self.line["last_edit_status"] != "read" or newest is None:
            return None
        return max((self.landed - newest).total_seconds(), 0.0) / 86400


def read_fix(line: dict) -> Fix | None:
    landed = parse_time(line["landed"])
    if landed is None:
        return None
    if line["issues"] is None:
        return Fix(line, landed, area_of(line["units"]), None, None)
    issues = {number: (state, labels) for number, state, labels in line["issues"]}
    closed = sorted(issues)
    escapes = [
        n for n in closed if issues[n][0] == "closed" and any(map(is_bug, issues[n][1]))
    ] if line["type"] == "fix" else []  # fmt: skip
    return Fix(line, landed, area_of(line["units"]), closed, escapes)


def median_days(ages: list[float]) -> float | None:
    return round(statistics.median(ages), 1) if ages else None


@dataclass
class AreaRow:
    area: str
    fixes: list[Fix] = field(default_factory=list)
    reverts: int = 0
    reverted: list[Fix] = field(default_factory=list)  # the reverts, for the units they name

    def to_json(self) -> dict:
        fixes = self.fixes
        unread = sum(not fix.github for fix in fixes)
        escapes = {n for fix in fixes for n in fix.escapes or []}
        tested = sum(fix.line["tests"] > 0 for fix in fixes)
        ages = [age for fix in fixes if (age := fix.age_days) is not None]
        data: dict = {
            "area": self.area,
            "fix_commits": len(fixes),
            "reverts": self.reverts,
            "escapes": len(escapes) if not unread else None,
            "unconfirmed": sum(not fix.closed for fix in fixes) if not unread else None,
            "with_test_path": tested,
            "last_edit": {"read": len(ages), "of": len(fixes), "median_days": median_days(ages)},
        }
        if unread:
            data["github_unread"] = unread
        if self.area == SEVERAL:
            data["units"] = several_units(fixes or self.reverted)
        if len(fixes) < MIN_RATE:
            data["rates"] = "too-few"
        else:
            data["rates"] = "given"
            data["with_test_path_per_100"] = round(100 * tested / len(fixes), 1)
            if data["unconfirmed"] is not None:
                data["unconfirmed_per_100"] = round(100 * data["unconfirmed"] / len(fixes), 1)
        return data


def several_units(fixes: list[Fix]) -> list[str]:
    """The units the commits of `several` name: named by most commits first, then where they
    stand in a commit (the unit that holds most of its files first), then by name."""
    named: Counter = Counter()
    place: dict[str, int] = {}
    for fix in fixes:
        for index, unit in enumerate(fix.line["units"]):
            named[unit] += 1
            place[unit] = min(place.get(unit, index), index)
    return sorted(named, key=lambda unit: (-named[unit], place[unit], unit))


@dataclass
class MainCoverage:
    status: str  # read, partly or absent
    days: list[str]  # the window's days up to now
    listed: list[str]  # those the record holds every commit of
    merged: int | None
    lines: list[dict]


def main_coverage(record: Record, since: datetime, until: datetime, now: datetime) -> MainCoverage:
    """What of the `main` source the record holds for a window."""
    known = days_known(record.states)
    days, listed = [], []
    day = since
    while day < min(until, now):
        key = day.date().isoformat()
        days.append(key)
        end = day + timedelta(days=1)
        entry = known.get(key)
        if entry is not None and entry["_until"] >= (end if end <= now else now - FRESH):
            listed.append(key)
        day = end
    lines = [
        line
        for line in record.commits.values()
        if (landed := parse_time(line["landed"])) is not None and since <= landed < until
    ]
    whole = len(listed) == len(days)
    merged = sum(known[key]["merged"] for key in listed) if whole else None
    if not listed and not lines:
        status = "absent"
    elif whole and all(line["issues"] is not None for line in lines):
        status = "read"
    else:
        status = "partly"
    return MainCoverage(status, days, listed, merged, lines)


def known_areas(root: Path, record: Record) -> tuple[set[str], Units | None]:
    """Every area a person may name: the units at the default branch's tip, those the record's
    commits name, `repository` and `several`."""
    found = default_ref(root)
    units = units_at(root, found[1]) if found else None
    areas = {REPOSITORY, SEVERAL, *(units.folders if units else [])}
    for line in record.commits.values():
        areas.update(line["units"])
    return areas, units


def unknown_area(area: str, areas: set[str]) -> dict:
    close = difflib.get_close_matches(area, sorted(areas), n=5, cutoff=0.5)
    return {
        "message": f"No area '{area}' is known or on record",
        "suggestion": (f"Closest: {', '.join(close)}. " if close else "")
        + f"{len(areas)} areas are known: a unit's folder (as packages/core), repository or "
        "several; leave area out to list them by fix commits",
    }


def _example(fix: Fix) -> dict:
    line = fix.line
    data: dict = {
        "commit": line["sha"][:12],
        "landed": line["landed"],
        "type": line["type"],
        "pull_request": line["pr"],
        "closes": fix.closed,
        "escapes": None
        if fix.escapes is None
        else [
            {"issue": n, "found_by": fix.found(n)[0], "class": fix.found(n)[1]} for n in fix.escapes
        ],
        "found_by": fix.channel,
        "found_by_lines": [
            {"channel": channel, "class": kind, "issue": issue}
            for channel, kind, issue in line["found_by"]
        ],
        "test_paths": line["tests"],
        "last_edit": line["last_edit_status"],
        "last_edit_days": None if fix.age_days is None else round(fix.age_days, 1),
    }
    if fix.area == SEVERAL:
        data["units"] = line["units"]
    return data


def _totals(fixes: list[Fix], reverts: int, merged: int | None) -> dict:
    unread = sum(not fix.github for fix in fixes)
    by_issue: dict[int, tuple[str, str | None]] = {}
    for fix in sorted(fixes, key=lambda fix: fix.landed, reverse=True):
        for issue in fix.escapes or []:
            by_issue.setdefault(issue, fix.found(issue))
    channels = Counter(channel for channel, _ in by_issue.values())
    classes = Counter(kind or "absent" for _, kind in by_issue.values())
    ages = [age for fix in fixes if (age := fix.age_days) is not None]
    data: dict = {
        "merged": merged,
        "fix_commits": len(fixes),
        "reverts": reverts,
        "escapes": len(by_issue) if not unread else None,
        "unconfirmed": sum(not fix.closed for fix in fixes) if not unread else None,
        "with_test_path": sum(fix.line["tests"] > 0 for fix in fixes),
        "escapes_found_by": None
        if unread
        else {channel: channels[channel] for channel in (*CHANNELS, "absent")},
        "escapes_by_class": None
        if unread
        else {kind: classes[kind] for kind in (*CLASSES, "absent")},
        "found_by_absent": sum(
            not fix.line["found_by"] and not fix.line["found_by_unread"] for fix in fixes
        ),
        "found_by_unreadable": sum(
            not fix.line["found_by"] and fix.line["found_by_unread"] > 0 for fix in fixes
        ),
        "last_edit": {"read": len(ages), "of": len(fixes), "median_days": median_days(ages)},
    }
    if unread:
        data["github_unread"] = unread
    return data


def by_area(  # noqa: PLR0913 - one report
    data: dict, record: Record, units: Units | None, window, area: str | None, limit: int,
    now: datetime, warnings: list[str],
) -> str:  # fmt: skip
    """Fill `data` with the rows by area; the answer's reasoning."""
    cover = main_coverage(record, window.since, window.until, now)
    rows: dict[str, AreaRow] = {}
    fixes: list[Fix] = []
    reverts = 0
    for line in cover.lines:
        fix = read_fix(line)
        if fix is None:
            continue
        row = rows.setdefault(fix.area, AreaRow(fix.area))
        if line["type"] == "revert":
            row.reverts += 1
            row.reverted.append(fix)
            reverts += 1
        else:
            row.fixes.append(fix)
            fixes.append(fix)
    ordered = sorted(rows.values(), key=lambda row: (-len(row.fixes), -row.reverts, row.area))
    if area is not None:
        ordered = [row for row in ordered if row.area == area]
    shown = ordered[:limit]
    data["totals"] = _totals(fixes, reverts, cover.merged) if cover.status != "absent" else None
    data["rows"] = [row.to_json() for row in shown]
    data["more"] = {"rows": len(ordered) - len(shown)}
    if area is not None:
        commits = [read_fix(line) for line in cover.lines]
        mine = sorted(
            (fix for fix in commits if fix is not None and fix.area == area),
            key=lambda fix: (fix.landed, fix.line["sha"]),
            reverse=True,
        )
        data["examples"] = [_example(fix) for fix in mine[:limit]]
        data["more"]["examples"] = len(mine) - len(data["examples"])
    newest = max(
        (
            moment
            for state in record.states.values()
            if isinstance(state.get("main"), dict)
            and (moment := parse_time(state["main"].get("at"))) is not None
        ),
        default=None,
    )
    unread = sum(line["issues"] is None for line in cover.lines)
    coverage = data["coverage"]
    coverage["sources"]["main"] = cover.status
    coverage["collected"] = {
        "main": {
            "newest": newest.isoformat() if newest else None,
            "age_hours": round((now - newest).total_seconds() / 3600, 1) if newest else None,
        }
    }
    coverage["days_listed"] = share(len(cover.listed), len(cover.days)) if cover.days else None
    coverage["github_read"] = (
        share(len(cover.lines) - unread, len(cover.lines)) if cover.lines else None
    )
    coverage["last_edit_read"] = (
        share(sum(fix.age_days is not None for fix in fixes), len(fixes)) if fixes else None
    )
    coverage["found_by_share"] = (
        share(sum(bool(fix.line["found_by"]) for fix in fixes), len(fixes)) if fixes else None
    )
    coverage["units"] = {
        "source": units.source if units else "none",
        "count": len(units.folders) if units else 0,
    }
    if units is not None and units.problem:
        coverage["units"]["problem"] = units.problem
    coverage["not_seen"] = list(NOT_SEEN)
    for key in ("events", "other_events_left_out", "window_listed", "listed_until",
                "steps_share", "steps_unreadable"):  # fmt: skip
        coverage.pop(key, None)
    if cover.status == "absent":
        warnings.append(
            f"main is absent: nothing of the default branch from {window.first} to {window.last} "
            "was collected, so no figure is given; run gate-outcome-collect with sources: [main]"
        )
    elif len(cover.listed) < len(cover.days):
        missing = [day for day in cover.days if day not in cover.listed]
        reach = (now.date() - window.first).days + 1
        warnings.append(
            f"The record does not hold every commit of {', '.join(missing)}, so merged is not "
            f"given: run gate-outcome-collect with sources: [main] and since_days "
            f"{min(reach, MAX_DAYS)}"
        )
    if unread:
        warnings.append(
            f"{unread} commits have no pull request or issue read from GitHub, so their areas "
            "give no escapes or unconfirmed count: run gate-outcome-collect with sources: [main] "
            "where gh is signed in"
        )
    if units is not None and units.problem:
        warnings.append(f"The units could not all be read: {units.problem}")
    return (
        f"Nothing of the default branch from {window.first} to {window.last} was collected"
        if cover.status == "absent"
        else f"{len(fixes)} fix commits and {reverts} reverts in {len(ordered)} areas from "
        f"{window.first} to {window.last}; main is {cover.status}"
    )
