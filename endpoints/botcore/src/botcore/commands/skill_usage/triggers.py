"""`skill-usage-triggers`: the merged changes that needed a skill, and whether the session
that made each had loaded it.

A repository declares which paths require which skill (`[[skills.required]]`). The changes
come from git, the loads and the changes each session made from this machine's record
(`skill-usage-collect`), and the tie between a merged change and its sessions from the pull
requests the harness linked to them. A change with no session in the record is unknown, never
a miss. Read-only.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.disk.git import GitError, git_out
from botcore.commands.disk.scan import compile_pattern
from botcore.commands.skill_usage.collect import GIT_SECONDS, project_remote
from botcore.commands.skill_usage.events import EDIT, RECOGNIZER, TRIGGER
from botcore.commands.skill_usage.report import (
    MAX_DAYS,
    STALE_AFTER,
    _inventory,
    _mapping,
    _parse,
    current_name,
)
from botcore.commands.skill_usage.store import load_events, load_sessions, load_state, state_dir
from botcore.config import load_config
from botcore.utils.workspace import find_workspace

MAX_MISSES = 50
_REFS = ("refs/remotes/origin/HEAD", "refs/remotes/origin/main", "HEAD")
_PULL_REQUEST = re.compile(r"\(#(\d+)\)\s*$|^Merge pull request #(\d+)\b")
_RECORD, _FIELD = "\x1e", "\x1f"


@dataclass
class Change:
    """A change merged to the default branch."""

    at: datetime
    number: int | None  # its pull request, from the subject git gives a merged change
    files: list[str]


class _NoBranch(Exception):
    """The checkout has no commit to read changes from."""


def merged_changes(root: Path, since: datetime) -> list[Change]:
    """The changes merged to the default branch since a moment, oldest first."""
    for ref in _REFS:
        try:
            git_out(root, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}",
                    timeout=GIT_SECONDS)  # fmt: skip
            break
        except GitError:
            continue
    else:
        raise _NoBranch
    text = git_out(
        root, "log", ref, "--first-parent", f"--since={since.isoformat()}", "--name-only",
        f"--format={_RECORD}%cI{_FIELD}%s", timeout=GIT_SECONDS * 2,
    )  # fmt: skip
    changes: list[Change] = []
    for record in text.split(_RECORD)[1:]:
        head, _, rest = record.partition("\n")
        stamp, _, subject = head.partition(_FIELD)
        moment = _parse(stamp)
        if moment is None:
            continue
        found = _PULL_REQUEST.search(subject)
        number = int(found.group(1) or found.group(2)) if found else None
        changes.append(Change(moment, number, [line for line in rest.splitlines() if line]))
    return sorted(changes, key=lambda change: change.at)


def _fail(code: str, message: str, suggestion: str) -> CommandResult[dict]:
    return error(code, message, suggestion=suggestion)


async def skill_usage_triggers(  # noqa: C901, PLR0911, PLR0912, PLR0915 - one report
    days: int = 30, repo: str | None = None
) -> CommandResult[dict]:
    """For each skill a repository requires, the merged changes to its paths and whether the
    session that made each had loaded the skill first.

    A change is `loaded` when every session linked to its pull request that changed a required
    path had loaded the skill before its first such change, itself or through a subagent; a
    load at review time, after the change, does not count. It is `missed` otherwise, and names
    the sessions. It is `unknown` when the record cannot say: no pull request number, no
    session linked to it on a collected machine, or no change recorded in the session.

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
        rules = load_config(workspace=root).skills.required
    except Exception as exc:  # noqa: BLE001 - any way the configuration fails to load
        return _fail(
            "CONFIG_INVALID",
            f"The botcore configuration of {root} could not be read: {exc}",
            "Fix its botcore.toml (or [tool.botcore] in pyproject.toml) and run it again",
        )
    if not rules:
        return _fail(
            "NO_REQUIRED_SKILLS",
            f"{root.name} declares no required skill",
            'Declare one in its botcore.toml: [[skills.required]] with skill = "<name>" and '
            'paths = ["<glob>", ...], then run skill-usage-collect --rebuild',
        )
    directory = state_dir()
    try:
        events, _ = load_events(directory)
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

    projects = _mapping(state.get("projects"))
    project = next(
        (
            name
            for name, entry in projects.items()
            if str(root) in (_mapping(entry).get("roots") or [])
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
            f"{root} has no commit to read merged changes from",
            "Run it in a checkout of the repository that has its default branch",
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

    loads: dict[tuple[str, str], list[datetime]] = {}  # (skill, session) -> when it loaded it
    changed: dict[tuple[str, str], list[datetime]] = {}  # (skill, session) -> required changes
    for event in events:
        moment = _parse(event.at)
        if moment is None or event.project != project or event.path == EDIT:
            continue
        key = (named(event.skill), event.thread)
        (changed if event.path == TRIGGER else loads).setdefault(key, []).append(moment)

    # The pull requests of this project each session was linked to, in the order it linked them
    links: dict[str, list[tuple[datetime | None, int]]] = {}
    prefix = f"{project}#"
    for session_id, entry in sessions.items():
        references = entry.get("pull_requests")
        for item in references if isinstance(references, list) else []:
            reference = item.get("ref") if isinstance(item, dict) else item
            linked_at = _parse(item.get("linked_at")) if isinstance(item, dict) else None
            if isinstance(reference, str) and reference.startswith(prefix):
                number = reference[len(prefix) :]
                if number.isdigit():
                    links.setdefault(session_id, []).append((linked_at, int(number)))
    linked: dict[int, list[str]] = {}
    for session_id, its_links in links.items():
        for _, number in its_links:
            linked.setdefault(number, []).append(session_id)

    def first_change(skill: str, session_id: str, number: int | None = None) -> datetime | None:
        """When a session first changed a path the skill is required for. For one pull request
        of a session that linked several, only the stretch that built it counts: after the
        one it linked before, up to this one's link, and for its last, everything after."""
        times = changed.get((skill, session_id), [])
        timed = sorted(link for link in links.get(session_id, []) if link[0] is not None)
        position = next((at for at, link in enumerate(timed) if link[1] == number), None)
        if number is not None and position is not None and len(timed) > 1:
            after = timed[position - 1][0] if position else None
            until = timed[position][0] if position < len(timed) - 1 else None
            times = [
                moment
                for moment in times
                if (after is None or moment > after) and (until is None or moment <= until)
            ]
        return min(times, default=None)

    def loaded_before(skill: str, session_id: str, moment: datetime) -> bool:
        return any(load <= moment for load in loads.get((skill, session_id), ()))

    report: list[dict] = []
    for rule in rules:
        skill = named(rule.skill)
        patterns = [compile_pattern(path) for path in rule.paths]
        counts = {"loaded": 0, "missed": 0}
        unknown = {"no_pull_request": 0, "no_session": 0, "no_recorded_change": 0}
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
            made = {
                session_id: first_change(skill, session_id, change.number)
                for session_id in sorted(set(its_sessions))
            }
            made = {session_id: moment for session_id, moment in made.items() if moment}
            if not made:
                unknown["no_recorded_change"] += 1
                continue
            without = [
                session_id
                for session_id, moment in made.items()
                if not loaded_before(skill, session_id, moment)
            ]
            if without:
                counts["missed"] += 1
                misses.append({"change": change.number, "sessions": without})
            else:
                counts["loaded"] += 1
        # Whatever was merged: the sessions that changed a required path in the window
        touched = {
            session_id: min(moments)
            for (name, session_id), moments in changed.items()
            if name == skill and min(moments) >= since
        }
        judged = counts["loaded"] + counts["missed"]
        report.append(
            {
                "skill": skill,
                "paths": list(rule.paths),
                "changes": len(matching),
                "loaded": counts["loaded"],
                "missed": counts["missed"],
                "unknown": sum(unknown.values()),
                "unknown_why": unknown,
                "rate": round(counts["loaded"] / judged, 3) if judged else None,
                "misses": misses[-MAX_MISSES:],
                "more_misses": max(0, len(misses) - MAX_MISSES),
                "sessions_changed": len(touched),
                "sessions_loaded_first": sum(
                    loaded_before(skill, session_id, moment)
                    for session_id, moment in touched.items()
                ),
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
    recorded_rules = _mapping(projects.get(project)).get("required")
    current_rules = [{"skill": rule.skill, "paths": list(rule.paths)} for rule in rules]
    older = not (isinstance(state.get("recognizer"), int) and state["recognizer"] >= RECOGNIZER)
    if older or recorded_rules != current_rules:
        warnings.append(
            "The record was collected before these required skills were declared as they are "
            "now: run skill-usage-collect --rebuild, or changes already recorded are unknown"
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
