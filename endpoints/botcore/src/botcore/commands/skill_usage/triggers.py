"""`skill-usage-triggers`: the merged changes that needed a skill, and whether the session
that made each had loaded it.

A repository declares which paths require which skill (`[[skills.required]]`). The changes
come from git, the loads and the changes each session made from this machine's record
(`skill-usage-collect`), and the tie between a merged change and its sessions from the pull
requests the harness linked to them. Wherever the record cannot establish who made a change,
or whether the skill was loaded before it, the change is unknown, never a miss. Read-only.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.disk.git import GitError, git_out
from botcore.commands.disk.scan import compile_pattern
from botcore.commands.skill_usage.collect import (
    GIT_SECONDS,
    _strings,
    project_remote,
    required_skills,
    rule_id,
)
from botcore.commands.skill_usage.events import PATHS, Trigger
from botcore.commands.skill_usage.report import (
    MAX_DAYS,
    STALE_AFTER,
    _inventory,
    _mapping,
    _parse,
    current_name,
)
from botcore.commands.skill_usage.store import (
    load_events,
    load_sessions,
    load_state,
    load_triggers,
    state_dir,
)
from botcore.config import load_config
from botcore.utils.workspace import find_workspace

# The branch changes are merged to, where a checkout says which it is. Never the checked-out
# commit: on a topic branch that would report unmerged work as merged.
_DEFAULT_BRANCHES = (
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
    "refs/remotes/origin/master",
    "refs/heads/main",
    "refs/heads/master",
)
_PULL_REQUEST = re.compile(r"\(#(\d+)\)\s*$|^Merge pull request #(\d+)\b")
_RECORD, _FIELD = "\x1e", "\x1f"
LOADED, MISSED, UNORDERED = "loaded", "missed", "same_turn"
AMBIGUOUS = "between_pull_requests"
_UNKNOWN = (
    "no_pull_request", "no_session", "no_link_time", "no_recorded_change", AMBIGUOUS, UNORDERED,
)  # fmt: skip


@dataclass
class Change:
    """A change merged to the default branch."""

    at: datetime
    number: int | None  # its pull request, from the subject git gives a merged change
    files: list[str]


class _NoBranch(Exception):
    """The checkout does not say which branch changes are merged to."""


def merged_changes(root: Path, since: datetime) -> list[Change]:
    """The changes merged to the default branch since a moment, oldest first, each with every
    path it touched: both sides of a rename, and names git would otherwise quote."""
    for ref in _DEFAULT_BRANCHES:
        try:
            git_out(root, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}",
                    timeout=GIT_SECONDS)  # fmt: skip
            break
        except GitError:
            continue
    else:
        raise _NoBranch
    text = git_out(
        root, "log", ref, "--first-parent", f"--since={since.isoformat()}", "--no-renames",
        "-z", "--name-only", f"--format={_RECORD}%cI{_FIELD}%s", timeout=GIT_SECONDS * 2,
    )  # fmt: skip
    changes: list[Change] = []
    for record in text.split(_RECORD)[1:]:
        head, _, rest = record.partition("\0")
        stamp, _, subject = head.partition(_FIELD)
        moment = _parse(stamp.strip())
        if moment is None:
            continue
        found = _PULL_REQUEST.search(subject.strip())
        number = int(found.group(1) or found.group(2)) if found else None
        files = [name.strip("\n") for name in rest.split("\0") if name.strip("\n")]
        changes.append(Change(moment, number, files))
    return sorted(changes, key=lambda change: change.at)


def _fail(code: str, message: str, suggestion: str) -> CommandResult[dict]:
    return error(code, message, suggestion=suggestion)


def _verdict(found: list[Trigger], loads: list[datetime]) -> str:
    """Whether a session had loaded the skill before the changes it made. The end of a turn
    shows only that a change happened during it (`since` to `at`), so the skill counts as
    loaded first only when it was loaded before the earliest moment any of the changes can
    have happened, and as missed only when it was not loaded by the first moment one is
    known to have. Between the two the order is unknown."""
    known = [_parse(trigger.at) for trigger in found]
    possible = [_parse(trigger.since) if trigger.since else _parse(trigger.at) for trigger in found]
    if any(moment is None for moment in (*known, *possible)):
        return UNORDERED
    if any(load < min(possible) for load in loads):
        return LOADED
    return UNORDERED if any(load <= min(known) for load in loads) else MISSED


async def skill_usage_triggers(  # noqa: C901, PLR0911, PLR0912, PLR0915 - one report
    days: int = 30, repo: str | None = None
) -> CommandResult[dict]:
    """For each skill a repository requires, the merged changes to its paths and whether the
    session that made each had loaded the skill first.

    A change is `loaded` when every session linked to its pull request that changed a required
    path had loaded the skill before its first such change, itself or through a subagent; a
    load at review time, after the change, does not count. It is `missed` when one had not,
    and names those sessions. It is `unknown` when the record cannot say: `unknown_why` gives
    the reason.

    Args:
        days: Length of the window in days.
        repo: The repository's checkout; the one holding the working directory when left out.
    """
    if not 1 <= days <= MAX_DAYS:
        return _fail(
            "INVALID_INPUT",
            f"days must be between 1 and {MAX_DAYS}",
            "Pass the number of days to report, for example 30",
        )
    root = Path(repo).expanduser() if repo else find_workspace()
    if root is None or not root.is_dir():
        return _fail(
            "NO_WORKSPACE",
            f"No repository checkout at {repo}" if repo else "Not inside a repository checkout",
            "Run it from inside the repository, or pass repo with the path of its checkout",
        )
    try:
        load_config(workspace=root)
    except Exception as exc:  # noqa: BLE001 - any way the configuration fails to load
        return _fail(
            "CONFIG_INVALID",
            f"The botcore configuration of {root} could not be read: {exc}",
            "Fix its botcore.toml (or [tool.botcore] in pyproject.toml) and run it again",
        )
    rules = required_skills(root)  # each skill once, with every path declared for it
    if not rules:
        return _fail(
            "NO_REQUIRED_SKILLS",
            f"{root.name} declares no required skill",
            'Declare one in its botcore.toml: [[skills.required]] with skill = "<name>" and '
            'paths = ["<glob>", ...], then run skill-usage-collect --rebuild',
        )
    directory = state_dir()
    try:
        events, unreadable_events = load_events(directory)
        triggers, unreadable_triggers = load_triggers(directory)
        state = load_state(directory)
        sessions = load_sessions(directory)
    except OSError as exc:
        return _fail(
            "RECORD_UNAVAILABLE",
            f"The skill usage record in {directory} could not be read: {exc}",
            "Check that it is a folder this user can read, or set BOTCORE_SKILL_USAGE_STATE to "
            "the folder that holds the record",
        )
    if not events and not state:
        return _fail(
            "NOT_COLLECTED",
            "This machine has no skill usage record yet",
            "Run skill-usage-collect first; it reads what the harnesses recorded",
        )
    if unreadable_events or unreadable_triggers:
        # a lost load would turn a session into a miss, and a lost change the other way
        return _fail(
            "RECORD_DAMAGED",
            f"{unreadable_events + unreadable_triggers} lines of the skill usage record cannot "
            "be read, so no change can be judged from it",
            "Run skill-usage-collect --rebuild: it reads the store again and writes the record "
            "without the damaged lines",
        )

    projects = _mapping(state.get("projects"))
    project = next(
        (
            name
            for name, entry in projects.items()
            if str(root) in _strings(_mapping(entry).get("roots"))
        ),
        project_remote(root) or root.name,
    )
    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    try:
        changes = merged_changes(root, since)
    except _NoBranch:
        return _fail(
            "GIT_FAILED",
            f"{root} does not say which branch changes are merged to: it has no origin/HEAD, "
            "origin/main, origin/master, main or master",
            "Run it in a checkout that has the repository's default branch, or fetch it first",
        )
    except GitError as exc:
        return _fail(
            "GIT_FAILED",
            f"git could not list the changes merged in {root}: {exc}",
            "Check that it is a git checkout this user can read, and run it again",
        )

    renames, on_disk = _inventory(projects)
    project_renames, held = renames.get(project, {}), on_disk.get(project, {})

    def named(skill: str) -> str:
        return current_name(skill, project_renames, held)

    # A skill once, under the name it has now, with every path declared for it
    declared: dict[str, list[str]] = {}
    for skill, paths in rules.items():
        declared.setdefault(named(skill), []).extend(paths)
    current = {rule_id(skill, paths) for skill, paths in rules.items()}

    loads: dict[tuple[str, str], list[datetime]] = {}  # (skill, session) -> when it loaded it
    for event in events:
        moment = _parse(event.at)
        if moment is not None and event.project == project and event.path in PATHS:
            loads.setdefault((named(event.skill), event.thread), []).append(moment)
    changed: dict[tuple[str, str], list[Trigger]] = {}  # (skill, session), oldest first
    for trigger in sorted(triggers, key=lambda trigger: trigger.at):
        if trigger.project != project or _parse(trigger.at) is None:
            continue
        if trigger.rule in current:  # not one seen under paths the repository has since changed
            changed.setdefault((named(trigger.skill), trigger.thread), []).append(trigger)

    # The pull requests of this project each session was linked to, with when
    links: dict[str, dict[int, datetime | None]] = {}
    prefix = f"{project}#"
    for session_id, entry in sessions.items():
        references = entry.get("pull_requests")
        for item in references if isinstance(references, list) else []:
            reference = item.get("ref") if isinstance(item, dict) else item
            linked_at = _parse(item.get("linked_at")) if isinstance(item, dict) else None
            if isinstance(reference, str) and reference.startswith(prefix):
                number = reference[len(prefix) :]
                if number.isdigit():
                    links.setdefault(session_id, {})[int(number)] = linked_at
    linked: dict[int, list[str]] = {}
    for session_id, its_links in sorted(links.items()):
        for number in its_links:
            linked.setdefault(number, []).append(session_id)

    merged_at = {change.number: change.at for change in changes if change.number is not None}

    def built(skill: str, session_id: str, change: Change) -> list[Trigger] | str:
        """The required changes a session made while it built one pull request: after it
        linked the one before, up to the next one it linked or the merge, whichever came
        first. Or why they cannot be told apart: a link with no time, or a change made
        while the pull request before was still open, which may be a fix to that one."""
        its_links = links[session_id]
        if len(its_links) > 1 and any(moment is None for moment in its_links.values()):
            return "no_link_time"
        ordered = sorted(its_links.items(), key=lambda link: link[1] or change.at)
        position = next(at for at, link in enumerate(ordered) if link[0] == change.number)
        before, after = ordered[position - 1] if position else (None, None)
        following = ordered[position + 1][1] if position + 1 < len(ordered) else None
        until = min(following, change.at) if following else change.at
        found = [
            trigger
            for trigger in changed.get((skill, session_id), [])
            if (after is None or _parse(trigger.at) > after) and _parse(trigger.at) <= until
        ]
        if found and after is not None:
            closed = merged_at.get(before)  # when the one before merged, if it did here
            still_open = _parse(found[0].at) <= closed if closed else after >= since
            if still_open:
                return AMBIGUOUS
        return found

    report: list[dict] = []
    for skill, paths in sorted(declared.items()):
        patterns = [compile_pattern(path) for path in paths]
        counts = {LOADED: 0, MISSED: 0}
        unknown = dict.fromkeys(_UNKNOWN, 0)
        misses: list[dict] = []
        matching = [
            change
            for change in changes
            if any(pattern.match(file) for file in change.files for pattern in patterns)
        ]
        for change in matching:
            if change.number is None:
                unknown["no_pull_request"] += 1
                continue
            its_sessions = linked.get(change.number, [])
            if not its_sessions:
                unknown["no_session"] += 1
                continue
            made = {session_id: built(skill, session_id, change) for session_id in its_sessions}
            unclear = [found for found in made.values() if isinstance(found, str)]
            if unclear:
                unknown[unclear[0]] += 1
                continue
            verdicts = {
                session_id: _verdict(found, loads.get((skill, session_id), []))
                for session_id, found in made.items()
                if found
            }
            if not verdicts:
                unknown["no_recorded_change"] += 1
            elif MISSED in verdicts.values():
                counts[MISSED] += 1
                without = [s for s, verdict in verdicts.items() if verdict == MISSED]
                misses.append({"change": change.number, "sessions": without})
            elif UNORDERED in verdicts.values():
                unknown[UNORDERED] += 1
            else:
                counts[LOADED] += 1
        # Whatever was merged: the sessions that changed a required path in the window,
        # each judged by its first such change
        touched = {
            session_id: _verdict(found, loads.get((name, session_id), []))
            for (name, session_id), found in changed.items()
            if name == skill and any(_parse(trigger.at) >= since for trigger in found)
        }
        judged = counts[LOADED] + counts[MISSED]
        report.append(
            {
                "skill": skill,
                "paths": sorted(paths),
                "changes": len(matching),
                "loaded": counts[LOADED],
                "missed": counts[MISSED],
                "unknown": sum(unknown.values()),
                "unknown_why": unknown,
                "rate": round(counts[LOADED] / judged, 3) if judged else None,
                "misses": misses,
                "sessions_changed": len(touched),
                "sessions_loaded_first": sum(v == LOADED for v in touched.values()),
                "sessions_order_unknown": sum(v == UNORDERED for v in touched.values()),
            }
        )

    warnings: list[str] = []
    collected = _parse(state.get("collected_at"))
    if collected is None or now - collected > STALE_AFTER:
        when = state.get("collected_at") or "never"
        warnings.append(f"Last collected {when}: run skill-usage-collect for current numbers")
    if not any(event.project == project for event in events) and not any(
        entry.get("project") == project for entry in sessions.values()
    ):
        known = sorted({event.project for event in events})
        warnings.append(
            f"The record holds nothing for {project}, so every change is unknown; it holds "
            f"{', '.join(known) or 'no project'}. Collect on a machine that works in it"
        )
    read_under = _mapping(_mapping(_mapping(state.get("triggers")).get("rules")).get(project))
    now_rules = {skill: rule_id(skill, paths) for skill, paths in rules.items()}
    if read_under != now_rules:
        warnings.append(
            "The record's history was not read under the required skills as they are declared "
            "now, so changes made before that are unknown: run skill-usage-collect --rebuild"
        )

    judged = sum(rule["loaded"] + rule["missed"] for rule in report)
    return success(
        {
            "project": project,
            "window": {
                "days": days,
                "since": since.isoformat(timespec="seconds"),
                "until": now.isoformat(timespec="seconds"),
            },
            "rules": report,
            "record": {
                "state_dir": str(directory),
                "machines": sorted({event.machine for event in events}),
                "collected_at": state.get("collected_at"),
            },
            "warnings": warnings,
        },
        reasoning=f"{sum(rule['changes'] for rule in report)} merged changes needed a skill; "
        f"{sum(rule['missed'] for rule in report)} of the {judged} the record can judge were "
        "made without it",
    )
