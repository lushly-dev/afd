"""`skill-usage-triggers`: the merged changes that needed a skill, and whether a session that
published each had loaded it.

A repository declares which paths require which skill (`[[skills.required]]`). Three things
are known for certain, and the report uses only those: which merged changes touched those
paths (git), which sessions the harness linked to each change's pull request and when (the
record), and when each session loaded the skill (the record). What a session changed turn by
turn is not used: a checkout is moved under a session by merges, sync scripts and other
sessions, and a moved file looks like a changed one.

Read-only. Where those three cannot settle it, a change is unknown, never a miss.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.disk.git import GitError, git_out
from botcore.commands.disk.scan import compile_pattern
from botcore.commands.skill_usage.collect import GIT_SECONDS, _strings, project_remote
from botcore.commands.skill_usage.events import PATHS
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
_UNKNOWN = ("no_pull_request", "no_session", "no_link_time", "after_publication")


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


def required_skills(root: Path) -> dict[str, list[str]]:
    """A checkout's `[[skills.required]]` as it stands in its working tree: each skill with
    every path declared for it, so that several tables for one skill are one rule."""
    rules: dict[str, set[str]] = {}
    for rule in load_config(workspace=root).skills.required:
        rules.setdefault(rule.skill, set()).update(rule.paths)
    return {skill: sorted(paths) for skill, paths in rules.items()}


def _fail(code: str, message: str, suggestion: str) -> CommandResult[dict]:
    return error(code, message, suggestion=suggestion)


async def skill_usage_triggers(  # noqa: C901, PLR0911, PLR0912, PLR0915 - one report
    days: int = 30, repo: str | None = None
) -> CommandResult[dict]:
    """For each skill a repository requires, the merged changes to its paths and whether a
    session that published each had loaded the skill by then.

    A change is `loaded` when a session linked to its pull request had loaded the skill,
    itself or through a subagent, by the time it linked it. It is `missed` when no linked
    session loaded the skill before the change merged, and names those sessions. Between the
    two, and wherever the record cannot say, it is `unknown`: `unknown_why` gives the reason.

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
        rules = required_skills(root)
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
            'paths = ["<glob>", ...]',
        )
    directory = state_dir()
    try:
        events, unreadable = load_events(directory)
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
    if unreadable:
        return _fail(  # a lost load would turn a change into a miss
            "RECORD_DAMAGED",
            f"{unreadable} lines of the skill usage record cannot be read, so no change can be "
            "judged from it",
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

    loads: dict[tuple[str, str], list[datetime]] = {}  # (skill, session) -> when it loaded it
    for event in events:
        moment = _parse(event.at)
        if moment is not None and event.project == project and event.path in PATHS:
            loads.setdefault((named(event.skill), event.thread), []).append(moment)

    # Each pull request of this project: the sessions linked to it and when, and the sessions
    # that worked on the branch it came from. In a fleet a script publishes the change, and
    # the session that made it is known only by its branch.
    linked: dict[int, dict[str, datetime | None]] = {}
    branches: dict[int, set[str]] = {}
    prefix = f"{project}#"
    for session_id, entry in sorted(sessions.items()):
        references = entry.get("pull_requests")
        for item in references if isinstance(references, list) else []:
            reference = item.get("ref") if isinstance(item, dict) else item
            if not isinstance(reference, str) or not reference.startswith(prefix):
                continue
            number = reference[len(prefix) :]
            if not number.isdigit():
                continue
            linked_at = _parse(item.get("linked_at")) if isinstance(item, dict) else None
            linked.setdefault(int(number), {})[session_id] = linked_at
            branch = item.get("branch") if isinstance(item, dict) else None
            if isinstance(branch, str) and branch:
                branches.setdefault(int(number), set()).add(branch)
    on_branch: dict[str, list[str]] = {}
    for session_id, entry in sorted(sessions.items()):
        if isinstance(entry.get("branch"), str) and entry.get("project") == project:
            on_branch.setdefault(entry["branch"], []).append(session_id)
    for number, its_branches in branches.items():
        published = [moment for moment in linked[number].values() if moment]
        for session_id in (s for branch in its_branches for s in on_branch.get(branch, [])):
            # it made the change; the change was published when the first session linked it
            linked[number].setdefault(session_id, min(published, default=None))

    report: list[dict] = []
    for skill, paths in sorted(declared.items()):
        patterns = [compile_pattern(path) for path in paths]
        counts = {"loaded": 0, "missed": 0}
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
            its_sessions = linked.get(change.number, {})
            if not its_sessions:
                unknown["no_session"] += 1
                continue
            by_publication = before_merge = untimed = False
            for session_id, linked_at in its_sessions.items():
                its_loads = loads.get((skill, session_id), [])
                if not any(load <= change.at for load in its_loads):
                    continue
                before_merge = True
                if linked_at is None:
                    untimed = True
                elif any(load <= min(linked_at, change.at) for load in its_loads):
                    by_publication = True
            if by_publication:
                counts["loaded"] += 1
            elif not before_merge:
                counts["missed"] += 1
                misses.append({"change": change.number, "sessions": sorted(its_sessions)})
            elif untimed:
                unknown["no_link_time"] += 1
            else:
                unknown["after_publication"] += 1
        judged = counts["loaded"] + counts["missed"]
        report.append(
            {
                "skill": skill,
                "paths": sorted(paths),
                "changes": len(matching),
                "loaded": counts["loaded"],
                "missed": counts["missed"],
                "unknown": sum(unknown.values()),
                "unknown_why": unknown,
                "rate": round(counts["loaded"] / judged, 3) if judged else None,
                "misses": misses,
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
        "published by sessions that never loaded it",
    )
