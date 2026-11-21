"""`skill-usage-report`: which skills were used, how often, and by which harness and agent.

Read-only, from this machine's record (`skill-usage-collect` fills it). The unit is a thread
that used a skill: a skill read three times in one thread, in parts, is one use. A skill keeps
one identity across a rename.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.skill.renames import SKILL_RENAMES
from botcore.commands.skill_usage.events import TYPED, Event
from botcore.commands.skill_usage.store import load_events, load_state, state_dir
from botcore.commands.skill_usage.t3 import SKILL_DIRS

STALE_AFTER = timedelta(hours=26)


@dataclass
class Row:
    project: str
    skill: str
    threads: set[str] = field(default_factory=set)
    typed_threads: set[str] = field(default_factory=set)
    by_harness: dict[str, set[str]] = field(default_factory=dict)
    loads: int = 0
    agents: Counter = field(default_factory=Counter)
    paths: Counter = field(default_factory=Counter)
    names: set[str] = field(default_factory=set)
    last_used: str = ""


def _parse(stamp: str | None) -> datetime | None:
    try:
        moment = datetime.fromisoformat(stamp) if stamp else None
    except ValueError:
        return None
    if moment is None:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def skills_on_disk(root: str) -> dict[str, int]:
    """Each skill a checkout holds, with the size of its SKILL.md in bytes."""
    found: dict[str, int] = {}
    for folder in SKILL_DIRS:
        try:
            children = sorted(Path(root, folder).iterdir())
        except OSError:
            continue
        for child in children:
            try:
                size = (child / "SKILL.md").stat().st_size
            except OSError:
                continue
            found.setdefault(child.name, size)
    return found


def current_name(name: str, renames: dict[str, str], on_disk: dict[str, int]) -> str:
    """The name a skill has now. The project's own renames come first, then botcore's for the
    skills it ships; a name the checkout still holds is never renamed."""
    seen = {name}
    while name not in on_disk:
        following = renames.get(name) or SKILL_RENAMES.get(name)
        if not following or following in seen:
            break
        seen.add(following)
        name = following
    return name


def _row_json(row: Row, sizes: dict[str, int]) -> dict:
    data: dict = {
        "project": row.project,
        "skill": row.skill,
        "threads": len(row.threads),
        "loads": row.loads,
        "typed_threads": len(row.typed_threads),
        "harnesses": {name: len(threads) for name, threads in sorted(row.by_harness.items())},
        "agents": dict(sorted(row.agents.items())),
        "paths": dict(sorted(row.paths.items())),
        "last_used": row.last_used,
    }
    earlier = sorted(row.names - {row.skill})
    if earlier:
        data["also_loaded_as"] = earlier
    size = sizes.get(row.skill)
    if size is not None:
        data["size_bytes"] = size
        data["context_bytes"] = size * row.loads
    return data


async def skill_usage_report(  # noqa: PLR0912, PLR0915 - one pass over the record
    days: int = 30,
    project: str | None = None,
    harness: str | None = None,
) -> CommandResult[dict]:
    """Report skill use over the last `days` days from this machine's record.

    Per skill: the threads that used it, loads, which harness and which agent (main, subagent
    or delegate) loaded it, how it was loaded, how many threads the person asked for it in, and
    its context cost (SKILL.md size times loads). `quiet` lists skills a project's checkout
    holds that nothing loaded in the window. `project` and `harness` narrow the report.
    """
    if days < 1:
        return error(
            "INVALID_INPUT",
            "days must be at least 1",
            suggestion="Pass the number of days to report, for example 30",
        )
    directory = state_dir()
    events, unreadable = load_events(directory)
    state = load_state(directory)
    if not events and not state:
        return error(
            "NOT_COLLECTED",
            "This machine has no skill usage record yet",
            suggestion="Run skill-usage-collect first; it reads what the harnesses recorded",
        )

    projects = state.get("projects") if isinstance(state.get("projects"), dict) else {}
    renames: dict[str, dict[str, str]] = {}
    on_disk: dict[str, dict[str, int]] = {}
    for name, entry in projects.items():
        entry = entry if isinstance(entry, dict) else {}
        renames[name] = entry.get("renames") if isinstance(entry.get("renames"), dict) else {}
        root = entry.get("root")
        on_disk[name] = skills_on_disk(root) if isinstance(root, str) else {}

    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    rows: dict[tuple[str, str], Row] = {}
    last_ever: dict[tuple[str, str], str] = {}
    totals_threads: set[str] = set()
    by_harness: Counter = Counter()
    by_path: Counter = Counter()
    by_agent: Counter = Counter()
    machines: set[str] = set()

    def matches(event: Event) -> bool:
        return (project is None or event.project == project) and (
            harness is None or event.harness == harness
        )

    for event in events:
        if not matches(event):
            continue
        machines.add(event.machine)
        name = current_name(
            event.skill, renames.get(event.project, {}), on_disk.get(event.project, {})
        )
        key = (event.project, name)
        if event.at > last_ever.get(key, ""):
            last_ever[key] = event.at
        moment = _parse(event.at)
        if moment is None or moment < since:
            continue
        row = rows.setdefault(key, Row(project=event.project, skill=name))
        row.threads.add(event.thread)
        row.names.add(event.skill)
        row.by_harness.setdefault(event.harness, set()).add(event.thread)
        row.last_used = max(row.last_used, event.at)
        totals_threads.add(event.thread)
        if event.path == TYPED:
            row.typed_threads.add(event.thread)
            continue
        row.loads += 1
        row.agents[event.agent] += 1
        row.paths[event.path] += 1
        by_harness[event.harness] += 1
        by_path[event.path] += 1
        by_agent[event.agent] += 1

    ordered = sorted(
        rows.values(), key=lambda row: (-len(row.threads), -row.loads, row.project, row.skill)
    )
    quiet = [
        {"project": name, "skill": skill, "last_used": last_ever.get((name, skill))}
        for name, skills in sorted(on_disk.items())
        if project is None or name == project
        for skill in sorted(skills)
        if (name, skill) not in rows
    ]

    warnings: list[str] = []
    collected = _parse(
        state.get("collected_at") if isinstance(state.get("collected_at"), str) else None
    )
    if collected is None or now - collected > STALE_AFTER:
        when = state.get("collected_at") or "never"
        warnings.append(f"Last collected {when}: run skill-usage-collect for current numbers")
    if unreadable:
        warnings.append(f"{unreadable} lines of the record could not be read and were skipped")

    data = {
        "window": {
            "days": days,
            "since": since.isoformat(timespec="seconds"),
            "until": now.isoformat(timespec="seconds"),
        },
        "totals": {
            "skills": len(ordered),
            "threads": len(totals_threads),
            "loads": sum(row.loads for row in ordered),
            "harnesses": dict(sorted(by_harness.items())),
            "paths": dict(sorted(by_path.items())),
            "agents": dict(sorted(by_agent.items())),
        },
        "skills": [_row_json(row, on_disk.get(row.project, {})) for row in ordered],
        "quiet": quiet,
        "record": {
            "state_dir": str(directory),
            "machines": sorted(machines),
            "events": len(events),
            "collected_at": state.get("collected_at"),
        },
        "warnings": warnings,
    }
    return success(
        data,
        reasoning=f"{len(ordered)} skills were used in {len(totals_threads)} threads over the "
        f"last {days} days; {len(quiet)} held by a checkout were not",
    )
