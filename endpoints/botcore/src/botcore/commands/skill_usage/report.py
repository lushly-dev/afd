"""`skill-usage-report`: which skills were used, how often, and by which harness and agent.

Read-only, from this machine's record (`skill-usage-collect` fills it). The unit is a session
that used a skill: a skill read three times in one session, in parts, is one use. A skill
keeps one identity across a rename. A session that changed a skill's files was writing it,
not using it, and a burst of loads across most of a project's skills was an audit of them;
neither is counted as use.
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Container
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from afd import CommandResult, error, success

from botcore.commands.disk.settings import SettingsError
from botcore.commands.disk.steps import run_blocking
from botcore.commands.skill.renames import SKILL_RENAMES
from botcore.commands.skill_usage.collect import UNKNOWN_PROJECT, settings_refused
from botcore.commands.skill_usage.events import (
    DELEGATE,
    EDIT,
    MAIN,
    PATHS,
    RECOGNIZER,
    SUBAGENT,
    TYPED,
    Event,
)
from botcore.commands.skill_usage.store import (
    InvalidMachine,
    Local,
    Record,
    load_record,
    local,
    state_dir,
)

STALE_AFTER = timedelta(hours=26)
MAX_DAYS = 3660
MAX_ROWS = 500
# After a person names a skill, the harness either puts it in context itself or the agent
# loads it with a tool. A tool load this soon after is that same load, not a second one.
SAME_LOAD = timedelta(minutes=10)
# Most of the skills a project's checkout holds, loaded by one session within this long, is
# someone reading the skills, not working with them: an audit, a rename, a listing. A working
# session, with its reviewers, can load a dozen and more in that time (measured: up to 16 of
# the 31 a checkout held), so the bar is a share of what the checkout holds, and never under
# a dozen. A checkout that holds fewer than a dozen skills therefore never has an audit.
AUDIT_SHARE = 2 / 3
AUDIT_SKILLS = 12
AUDIT_SPAN = timedelta(minutes=30)
AGENTS = (MAIN, DELEGATE, SUBAGENT)
EXTERNAL_PROJECT = "external"


@dataclass
class Held:
    """A skill a checkout holds: its SKILL.md size and what it adds to every session's
    skill listing."""

    size: int
    listing: int


@dataclass
class Row:
    project: str
    skill: str
    sessions: set[str] = field(default_factory=set)
    typed_sessions: set[str] = field(default_factory=set)
    authoring: set[str] = field(default_factory=set)
    by_harness: dict[str, set[str]] = field(default_factory=dict)
    by_model: dict[str, set[str]] = field(default_factory=dict)
    by_machine: dict[str, set[str]] = field(default_factory=dict)
    loads: int = 0
    agents: Counter = field(default_factory=Counter)
    paths: Counter = field(default_factory=Counter)
    names: set[str] = field(default_factory=set)
    last_used: str = ""


def _parse(stamp: object) -> datetime | None:
    try:
        moment = datetime.fromisoformat(stamp) if isinstance(stamp, str) else None
    except ValueError:
        return None
    if moment is None:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def _mapping(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def current_name(
    name: str,
    renames: dict[str, str],
    held: Container[str],
    external_known: Container[str] = (),
) -> str:
    """The name a skill has now. The project's own renames and aliases come first, then
    botcore's bundled renames (skipped when the skill is held locally or known under that
    name as an external/observed skill, so a personal skill keeps its measured identity)."""
    seen = {name}
    while name not in held:
        following = renames.get(name)
        if not following and name not in external_known:
            following = SKILL_RENAMES.get(name)
        if not following or following in seen:
            break
        seen.add(following)
        name = following
    return name


def audit_bar(held: int) -> int | None:
    """How many of the skills a checkout holds, loaded in one span, make an audit of them;
    None when the checkout is not known, since "most of them" then has no meaning."""
    return max(AUDIT_SKILLS, math.ceil(held * AUDIT_SHARE)) if held else None


def audit_reads(loads: list[tuple[datetime, str, str]], held: set[str]) -> set[str]:
    """The ids of the loads that belong to an audit: every load inside a span of AUDIT_SPAN
    in which one session loaded most of the skills the checkout holds (`audit_bar`). Only
    skills the checkout holds count toward the bar: a plugin's skill or another project's is
    not one of "its skills". `loads` is one session's, as (time, skill, id)."""
    bar = audit_bar(len(held))
    if bar is None:
        return set()
    ordered = sorted(loads)
    marked: set[str] = set()
    inside: Counter = Counter()
    left = 0
    for right, (moment, skill, _) in enumerate(ordered):
        if skill in held:
            inside[skill] += 1
        while moment - ordered[left][0] > AUDIT_SPAN:
            gone = ordered[left][1]
            if gone in inside:
                inside[gone] -= 1
                if not inside[gone]:
                    del inside[gone]
            left += 1
        if len(inside) >= bar:
            marked.update(identifier for _, _, identifier in ordered[left : right + 1])
    return marked


def record_warnings(record: Record, here: Local, now: datetime) -> list[str]:
    """What a reader must know of the record's reach: a machine whose collection is old,
    and a shared folder that was not there to read."""
    warnings: list[str] = []
    for machine in sorted({here.machine, *record.collected}):
        when = record.collected.get(machine)
        moment = _parse(when)
        if moment is not None and now - moment <= STALE_AFTER:
            continue
        if machine == here.machine:
            warnings.append(
                f"Last collected {when or 'never'}: run skill-usage-collect for current numbers"
            )
        else:
            warnings.append(
                f"{machine} last collected {when or 'never'}: its numbers end there. Run "
                "disk-status on it to see whether its scheduled collection stopped"
            )
    if record.missing:
        warnings.append(f"{record.missing}, so only this machine's record was read")
    for machine in record.partial:
        warnings.append(
            f"{machine} in the shared folder is not a whole copy of a machine's record, so it "
            "was not read: a sync may be part way through, and the machine's next collection "
            "writes it again. Remove the folder if no machine writes it any more"
        )
    return warnings


def _counts(groups: dict[str, set[str]]) -> dict[str, int]:
    return {name: len(members) for name, members in sorted(groups.items())}


def _row_json(row: Row, held: Held | None, of_sessions: int) -> dict:
    data: dict = {
        "project": row.project,
        "skill": row.skill,
        "sessions": len(row.sessions),
        "of_sessions": of_sessions,
        "share": round(len(row.sessions) / of_sessions, 3) if of_sessions else None,
        "loads": row.loads,
        "typed_sessions": len(row.typed_sessions),
        "harnesses": _counts(row.by_harness),
        "models": _counts(row.by_model),
        "machines": _counts(row.by_machine),
        "agents": dict(sorted(row.agents.items())),
        "paths": dict(sorted(row.paths.items())),
        "last_used": row.last_used,
    }
    earlier = sorted(row.names - {row.skill})
    if earlier:
        data["also_loaded_as"] = earlier
    if row.authoring:
        data["authoring_sessions"] = len(row.authoring)
    if held is not None:
        data["size_bytes"] = held.size
        data["max_context_bytes"] = held.size * row.loads
        data["listing_chars"] = held.listing
    return data


def _is_project(project: str | None, name: str) -> bool:
    return project is None or project in (name, name.rpartition("/")[2])


def held_skills(record: Record) -> dict[str, dict[str, Held]]:
    """Per project, the skills it holds: as the record says, never as a folder on this
    machine lies, so every machine that reads the record lists the same skills, with the
    same sizes, under the same names."""
    return {
        project: {name: Held(*facts) for name, facts in inventory["held"].items()}
        for project, inventory in record.skills.items()
    }


def _external_held(record: Record) -> dict[str, Held]:
    return {name: Held(*facts) for name, facts in record.external_held.items()}


def _external_observed(record: Record) -> dict[str, Held]:
    return {name: Held(*facts) for name, facts in record.external_observed.items()}


def _project_observed(record: Record) -> dict[str, dict[str, Held]]:
    return {
        project: {name: Held(*facts) for name, facts in skills.items()}
        for project, skills in record.project_observed.items()
    }


def _invalid(message: str, suggestion: str) -> CommandResult[dict]:
    return error("INVALID_INPUT", message, suggestion=suggestion)


def _unknown(what: str, value: str, known: set[str]) -> CommandResult[dict]:
    """A filter value the record has never seen is refused: an empty report would read as
    nobody using a skill, when the truth is a misspelling."""
    listed = ", ".join(sorted(known)[:20]) or "none yet"
    return _invalid(f"The record has no {what} '{value}'", f"Use one of: {listed}")


async def skill_usage_report(  # noqa: PLR0913 - command parameters
    days: int = 30,
    project: str | None = None,
    harness: str | None = None,
    ending_days_ago: int = 0,
    skill: str | None = None,
    agent: str | None = None,
    limit: int = 50,
) -> CommandResult[dict]:
    """Report skill use over `days` days from this machine's record.

    Per skill: the sessions that used it, out of how many sessions the project had; loads;
    which harness, model, machine and agent loaded it and how; the sessions where the person
    asked for it; the most context it can have cost (SKILL.md size times loads) and what it
    adds to every session's skill listing. `quiet` lists skills a project's checkout holds
    that nothing used in the window.

    Args:
        days: Length of the window in days.
        project: Only this project: `owner/name`, or the name alone.
        harness: Only loads by this harness, as the record names it (`claude`, `codex`).
        ending_days_ago: End the window this many days ago, to compare two periods.
        skill: Only this skill, by its current name or one it was loaded as.
        agent: Only loads by this agent: `main`, `delegate` or `subagent`.
        limit: At most this many skills, most used first; `more` says how many were cut.
    """
    return await run_blocking(
        _skill_usage_report_sync, days, project, harness, ending_days_ago, skill, agent, limit
    )


def _skill_usage_report_sync(  # noqa: C901, PLR0911, PLR0912, PLR0913, PLR0915 - one pass
    days: int,
    project: str | None,
    harness: str | None,
    ending_days_ago: int,
    skill: str | None,
    agent: str | None,
    limit: int,
) -> CommandResult[dict]:
    if not 1 <= days <= MAX_DAYS:
        return _invalid(
            f"days must be between 1 and {MAX_DAYS}",
            "Pass the number of days to report, for example 30",
        )
    if not 0 <= ending_days_ago <= MAX_DAYS:
        return _invalid(
            f"ending_days_ago must be between 0 and {MAX_DAYS}",
            "Pass how many days ago the window ends, for example 30 for the period before "
            "the last 30 days",
        )
    if not 1 <= limit <= MAX_ROWS:
        return _invalid(
            f"limit must be between 1 and {MAX_ROWS}",
            "Pass how many skills to list, for example 50",
        )
    if agent is not None and agent not in AGENTS:
        return _unknown("agent", agent, set(AGENTS))
    directory = state_dir()
    try:
        here = local()
        record = load_record(directory, here)
    except (SettingsError, InvalidMachine) as exc:
        return settings_refused(exc)
    except OSError as exc:
        return error(
            "RECORD_UNAVAILABLE",
            f"The skill usage record in {directory} could not be read: {exc}",
            suggestion="Check that it is a folder this user can read, or set "
            "BOTCORE_SKILL_USAGE_STATE to the folder that holds the record",
        )
    events, state, recorded = record.events, record.state, record.sessions
    if not events and not state and not record.collected:
        return error(
            "NOT_COLLECTED",
            "This machine has no skill usage record yet",
            suggestion="Run skill-usage-collect first; it reads what the harnesses recorded",
        )

    renames, aliases, on_disk = record.renames, record.aliases, held_skills(record)
    proj_observed = _project_observed(record)
    ext_held, ext_observed = _external_held(record), _external_observed(record)
    ext_known = set(ext_held) | set(ext_observed)
    known_projects = {event.project for event in events} | set(on_disk)
    known_projects |= {
        entry["project"] for entry in recorded.values() if isinstance(entry.get("project"), str)
    }
    if project is not None and not any(_is_project(project, name) for name in known_projects):
        return _unknown("project", project, known_projects)
    known_harnesses = {event.harness for event in events}
    known_harnesses |= {
        entry["harness"] for entry in recorded.values() if isinstance(entry.get("harness"), str)
    }
    if harness is not None and harness not in known_harnesses:
        return _unknown("harness", harness, known_harnesses)

    now = datetime.now(UTC)
    until = now - timedelta(days=ending_days_ago)
    since = until - timedelta(days=days)

    # Every event under its skill's current name; when each session loaded a skill by a
    # tool; and which sessions changed a skill's files
    named: list[tuple[tuple[str, str], Event, datetime]] = []
    by_session: dict[tuple[str, str], list[tuple[datetime, str, str]]] = {}
    tool_loads: dict[tuple[str, str, str], list[datetime]] = {}
    authored: set[tuple[str, str, str]] = set()
    last_ever: dict[tuple[str, str], str] = {}
    last_ever_any: dict[str, str] = {}
    known_skills: set[str] = (
        {name for held in on_disk.values() for name in held}
        | {name for obs in proj_observed.values() for name in obs}
        | set(ext_held)
        | set(ext_observed)
    )
    outdated = 0

    def _resolve_name(raw_skill: str, in_project: str) -> str:
        proj_map = {**renames.get(in_project, {}), **aliases.get(in_project, {})}
        measured_outside = ext_known | set(proj_observed.get(in_project, {}))
        return current_name(raw_skill, proj_map, on_disk.get(in_project, {}), measured_outside)

    def wanted(in_project: str) -> str:
        """The skill asked for, under the name it has now in a project."""
        return _resolve_name(skill or "", in_project)

    for event in events:
        outdated += event.v < RECOGNIZER
        moment = _parse(event.at)
        if moment is None or not _is_project(project, event.project):
            continue
        if event.path != EDIT and event.path not in PATHS:
            continue  # a kind of event a newer botcore wrote: not known to be a load
        name = _resolve_name(event.skill, event.project)
        key = (event.project, name)
        known_skills |= {name, event.skill}
        if event.path == EDIT:
            authored.add((*key, event.thread))
            continue
        # before any filter, so that a filter never changes what counts as an audit
        by_session.setdefault((event.project, event.thread), []).append((moment, name, event.id))
        if harness is not None and event.harness != harness:
            continue
        if agent is not None and event.agent != agent:
            continue
        if skill is not None and name != wanted(event.project):
            continue
        named.append((key, event, moment))
        if event.path != TYPED:
            tool_loads.setdefault((*key, event.thread), []).append(moment)
    if skill is not None and skill not in known_skills:
        return _unknown("skill", skill, known_skills)

    # A session that changed a skill's files was writing it, and a burst of loads across
    # most of a project's skills was an audit of them. Neither is use.
    audited: set[str] = set()
    audit_sessions: set[str] = set()
    for (in_project, session), loads in by_session.items():
        marked = audit_reads(loads, set(on_disk.get(in_project, {})))
        if marked:
            audited |= marked
            if any(since <= moment < until for moment, _, identifier in loads
                   if identifier in marked):  # fmt: skip
                audit_sessions.add(session)

    rows: dict[tuple[str, str], Row] = {}
    users: set[str] = set()
    by_harness: Counter = Counter()
    by_path: Counter = Counter()
    by_agent: Counter = Counter()
    machines: set[str] = {event.machine for event in events}
    authoring: dict[tuple[str, str], set[str]] = {}
    for key, event, moment in named:
        if (*key, event.thread) in authored:
            if since <= moment < until:
                authoring.setdefault(key, set()).add(event.thread)
            continue
        if event.id in audited:
            continue
        if event.at > last_ever.get(key, ""):
            last_ever[key] = event.at
        if event.at > last_ever_any.get(key[1], ""):
            last_ever_any[key[1]] = event.at
        if event.at > last_ever_any.get(event.skill, ""):
            last_ever_any[event.skill] = event.at
        if not since <= moment < until:
            continue
        row = rows.setdefault(key, Row(project=key[0], skill=key[1]))
        row.sessions.add(event.thread)
        row.names.add(event.skill)
        row.by_harness.setdefault(event.harness, set()).add(event.thread)
        row.by_machine.setdefault(event.machine, set()).add(event.thread)
        if event.model:
            row.by_model.setdefault(event.model, set()).add(event.thread)
        row.last_used = max(row.last_used, event.at)
        users.add(event.thread)
        if event.path == TYPED:
            row.typed_sessions.add(event.thread)
            followed = any(
                timedelta(0) <= other - moment <= SAME_LOAD
                for other in tool_loads.get((*key, event.thread), ())
            )
            if followed:  # the agent loaded it with a tool: that event is the load
                continue
        row.loads += 1
        row.agents[event.agent] += 1
        row.paths[event.path] += 1
        by_harness[event.harness] += 1
        by_path[event.path] += 1
        by_agent[event.agent] += 1
    for key, sessions in authoring.items():
        if key in rows:
            rows[key].authoring = sessions

    # Every session each project had in the window, whether or not it loaded a skill
    seen: dict[str, set[str]] = {}
    for session_id, entry in recorded.items():
        proj_name = entry.get("project")
        started, ended = _parse(entry.get("created_at")), _parse(entry.get("updated_at"))
        if started is None or not isinstance(proj_name, str) or not _is_project(project, proj_name):
            continue
        if harness is not None and entry.get("harness") != harness:
            continue
        if agent in (MAIN, DELEGATE) and entry.get("agent") != agent:
            continue
        if started < until and (ended or started) >= since:
            seen.setdefault(proj_name, set()).add(session_id)
    for key, row in rows.items():
        seen.setdefault(key[0], set()).update(row.sessions)

    ordered = sorted(
        rows.values(), key=lambda row: (-len(row.sessions), -row.loads, row.project, row.skill)
    )
    quiet: list[dict] = []
    for name, held in sorted(on_disk.items()):
        if not _is_project(project, name):
            continue
        for skill_name, facts in sorted(held.items()):
            if (name, skill_name) in rows or (skill is not None and wanted(name) != skill_name):
                continue
            entry = {
                "project": name,
                "skill": skill_name,
                "last_used": last_ever.get((name, skill_name)),
                "size_bytes": facts.size,
                "listing_chars": facts.listing,
            }
            if (name, skill_name) in authoring:
                entry["authoring_sessions"] = len(authoring[(name, skill_name)])
            quiet.append(entry)

    used_any: set[str] = {name for row in rows.values() for name in (row.skill, *row.names)}
    if project is None:
        for skill_name, facts in sorted(ext_held.items()):
            if skill_name in used_any or (skill is not None and skill != skill_name):
                continue
            quiet.append(
                {
                    "project": EXTERNAL_PROJECT,
                    "skill": skill_name,
                    "last_used": last_ever_any.get(skill_name),
                    "size_bytes": facts.size,
                    "listing_chars": facts.listing,
                }
            )

    warnings = record_warnings(record, here, now)
    for machine, lines in sorted(record.unreadable.items()):
        whose = "the record" if machine == here.machine else f"{machine}'s record"
        warnings.append(f"{lines} lines of {whose} could not be read and were skipped")
    if outdated and not (record.recognizer is not None and record.recognizer >= RECOGNIZER):
        warnings.append(
            f"{outdated} events were recognised by an older botcore: run skill-usage-collect "
            "--rebuild to read them again"
        )
    # Every project in scope, whether or not a skill was loaded in it: an empty `quiet` list
    # is as wrong as a missing size. Not the sessions no project is known for.
    in_scope = {row.project for row in ordered} | set(seen)
    unlisted = sorted(in_scope - set(on_disk) - {UNKNOWN_PROJECT})
    if unlisted:  # a record an earlier botcore wrote: this one always says, even "none"
        unlisted_label = ", ".join(unlisted[:3]) + (
            f" and {len(unlisted) - 3} more" if len(unlisted) > 3 else ""  # noqa: PLR2004
        )
        warnings.append(
            f"No machine's record says which skills these projects hold: {unlisted_label}. Their "
            "skills have no size here, none is listed as quiet and no read is marked as an "
            "audit, until skill-usage-collect runs on a machine that has them"
        )

    def _facts_for(row: Row) -> Held | None:
        return (
            on_disk.get(row.project, {}).get(row.skill)
            or proj_observed.get(row.project, {}).get(row.skill)
            or ext_held.get(row.skill)
            or ext_observed.get(row.skill)
        )

    shown = ordered[:limit]
    sessions_seen = sum(len(sessions) for sessions in seen.values())
    data = {
        "window": {
            "days": days,
            "since": since.isoformat(timespec="seconds"),
            "until": until.isoformat(timespec="seconds"),
        },
        "totals": {
            "skills": len(ordered),
            "sessions": len(users),
            "sessions_seen": sessions_seen,
            "loads": sum(row.loads for row in ordered),
            "harnesses": dict(sorted(by_harness.items())),
            "paths": dict(sorted(by_path.items())),
            "agents": dict(sorted(by_agent.items())),
            "authoring_sessions": len({s for sessions in authoring.values() for s in sessions}),
            "audit_sessions": len(audit_sessions),
        },
        "skills": [_row_json(row, _facts_for(row), len(seen[row.project])) for row in shown],
        "more": len(ordered) - len(shown),
        "quiet": quiet,
        "record": {
            "state_dir": str(directory),
            "shared": str(record.shared) if record.shared else None,
            "machines": sorted(machines | set(record.collected)),
            "events": len(events),
            "sessions": len(recorded),
            "collected_at": state.get("collected_at"),
            "collected": dict(sorted(record.collected.items())),
        },
        "warnings": warnings,
    }
    return success(
        data,
        reasoning=f"{len(ordered)} skills were used in {len(users)} of "
        f"{sessions_seen} sessions over {days} days; {len(quiet)} held by a "
        "checkout were not",
    )
