"""`skill-usage-triggers`: the merged changes that needed a skill, and whether the session
that opened each one's pull request had loaded it.

A repository declares which paths require which skill (`[[skills.required]]`). Three things
are known for certain, and the report uses only those: which merged changes touched those
paths (git), which session opened each change's pull request and when (the harness says so,
and the record keeps it), and when that session loaded the skill (the record).

Nothing else ties a session to a change. What a session changed turn by turn is not used: a
checkout is moved under a session by merges, sync scripts and other sessions, and a moved
file looks like a changed one. A session that attached itself to a pull request to repair,
review or merge it is not judged, and neither is one that only worked on the same branch.

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
# Why a change cannot be judged, in the order they are asked
_UNKNOWN = ("no_pull_request", "no_session", "opened_elsewhere", "no_link_time", "after_opening")
LOADED, MISSED = "loaded", "missed"


@dataclass
class Change:
    """A change merged to the default branch."""

    at: datetime
    number: int | None  # its pull request, from the subject git gives a merged change
    files: list[str]


@dataclass
class Merged:
    """What merged to the default branch in a window, and how far the checkout knows it."""

    branch: str  # as the checkout names it, for example origin/main
    latest: datetime | None  # its newest change: a checkout that was not fetched ends early
    changes: list[Change]  # oldest first


class _NoBranch(Exception):
    """The checkout does not say which branch changes are merged to."""


def merged_changes(root: Path, since: datetime) -> Merged:
    """The changes merged to the default branch since a moment, each with every path it
    touched: both sides of a rename, and names git would otherwise quote."""
    for ref in _DEFAULT_BRANCHES:
        try:
            git_out(root, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}",
                    timeout=GIT_SECONDS)  # fmt: skip
            break
        except GitError:
            continue
    else:
        raise _NoBranch
    latest = _parse(git_out(root, "log", "-1", "--format=%cI", ref, timeout=GIT_SECONDS).strip())
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
    try:  # origin/HEAD by the name of the branch it points at
        branch = git_out(root, "rev-parse", "--abbrev-ref", ref, timeout=GIT_SECONDS).strip()
    except GitError:
        branch = ""
    branch = branch or ref.removeprefix("refs/remotes/").removeprefix("refs/heads/")
    return Merged(branch, latest, sorted(changes, key=lambda change: change.at))


def required_skills(root: Path) -> dict[str, list[str]]:
    """A checkout's `[[skills.required]]` as it stands in its working tree: each skill with
    every path declared for it, so that several tables for one skill are one rule."""
    rules: dict[str, set[str]] = {}
    for rule in load_config(workspace=root).skills.required:
        rules.setdefault(rule.skill, set()).update(rule.paths)
    return {skill: sorted(paths) for skill, paths in rules.items()}


def _matcher(path: str) -> re.Pattern[str]:
    """A rule's glob over the paths git names. Git tells `Makefile` from `makefile` on every
    system, so the match is by case even where the file system's is not."""
    return re.compile(compile_pattern(path).pattern)


@dataclass
class _Links:
    """What the record says of a repository's pull requests."""

    opened: dict[int, dict[str, datetime | None]]  # number -> who opened it, and when
    attached: set[int]  # every number some session is linked to, whoever opened it
    unsaid: int  # links that do not say whether their session opened the pull request


def _links(sessions: dict[str, dict], project: str) -> _Links:
    found = _Links({}, set(), 0)
    for session_id, entry in sorted(sessions.items()):
        references = entry.get("pull_requests")
        for item in references if isinstance(references, list) else []:
            reference = item.get("ref") if isinstance(item, dict) else item
            reference = reference if isinstance(reference, str) else ""
            repository, _, number = reference.rpartition("#")
            # a repository's name is the same in any case
            if repository.casefold() != project.casefold() or not number.isdigit():
                continue
            found.attached.add(int(number))
            opened = item.get("opened") if isinstance(item, dict) else None
            if opened is True:
                moment = _parse(item.get("linked_at"))
                found.opened.setdefault(int(number), {})[session_id] = moment
            elif opened is not False:
                found.unsaid += 1
    return found


def _judge(
    change: Change, openers: dict[str, datetime | None], loads: dict[str, list[datetime]]
) -> str:
    """One merged change against the sessions that opened its pull request: `loaded`,
    `missed`, or the reason it is unknown."""
    verdicts: set[str] = set()
    for session_id, opened_at in openers.items():
        before_merge = [load for load in loads.get(session_id, []) if load <= change.at]
        if opened_at is None or opened_at > change.at:
            verdicts.add("no_link_time")  # the record does not place the opening before the merge
        elif any(load <= opened_at for load in before_merge):
            verdicts.add(LOADED)
        elif before_merge:
            verdicts.add("after_opening")  # at a review or a repair: after the change was made
        else:
            verdicts.add(MISSED)
    return next(verdict for verdict in (LOADED, *_UNKNOWN, MISSED) if verdict in verdicts)


def _fail(code: str, message: str, suggestion: str) -> CommandResult[dict]:
    return error(code, message, suggestion=suggestion)


async def skill_usage_triggers(  # noqa: C901, PLR0911, PLR0912, PLR0915 - one report
    days: int = 30, repo: str | None = None
) -> CommandResult[dict]:
    """For each skill a repository requires, the merged changes to its paths and whether the
    session that opened each one's pull request had loaded the skill by then.

    A change is `loaded` when that session had loaded the skill, itself or through a
    subagent, by the time it opened the pull request. It is `missed` when that session never
    loaded it before the change merged, and names the session. Everything else is `unknown`,
    and `unknown_why` gives the reason: the change has no pull request, no session in the
    record is linked to it, the sessions linked to it only attached themselves to a pull
    request something else opened, the record does not place the opening before the merge,
    or the session loaded the skill only after opening it.

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
        merged = merged_changes(root, since)
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

    # skill -> session -> when it loaded it. A session's loads count whichever project the
    # harness filed the session under: one started in another project can open a pull
    # request here, and it loaded the skill all the same.
    loads: dict[str, dict[str, list[datetime]]] = {}
    for event in events:
        moment = _parse(event.at)
        if moment is not None and event.path in PATHS:
            loads.setdefault(named(event.skill), {}).setdefault(event.thread, []).append(moment)

    links = _links(sessions, project)
    report: list[dict] = []
    for skill, paths in sorted(declared.items()):
        patterns = [_matcher(path) for path in paths]
        counts = {LOADED: 0, MISSED: 0}
        unknown = dict.fromkeys(_UNKNOWN, 0)
        misses: list[dict] = []
        matching = [
            change
            for change in merged.changes
            if any(pattern.match(file) for file in change.files for pattern in patterns)
        ]
        for change in matching:
            openers = links.opened.get(change.number, {}) if change.number else {}
            if change.number is None:
                verdict = "no_pull_request"
            elif openers:
                verdict = _judge(change, openers, loads.get(skill, {}))
            else:
                attached = change.number in links.attached
                verdict = "opened_elsewhere" if attached else "no_session"
            if verdict in counts:
                counts[verdict] += 1
            else:
                unknown[verdict] += 1
            if verdict == MISSED:
                misses.append({"change": change.number, "sessions": sorted(openers)})
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
            }
        )

    warnings: list[str] = []
    collected = _parse(state.get("collected_at"))
    if collected is None or now - collected > STALE_AFTER:
        when = state.get("collected_at") or "never"
        warnings.append(f"Last collected {when}: run skill-usage-collect for current numbers")
    if links.unsaid:
        warnings.append(
            f"{links.unsaid} links to {project} pull requests do not say which session opened "
            "them, so their changes are unknown: run skill-usage-collect with this botcore to "
            "record it"
        )
    if not any(event.project == project for event in events) and not any(
        entry.get("project") == project for entry in sessions.values()
    ):
        known = sorted({event.project for event in events})
        warnings.append(
            f"The record holds nothing for {project}, so every change is unknown; it holds "
            f"{', '.join(known) or 'no project'}. Collect on a machine that works in it"
        )

    judged = sum(rule[LOADED] + rule[MISSED] for rule in report)
    return success(
        {
            "project": project,
            "window": {
                "days": days,
                "since": since.isoformat(timespec="seconds"),
                "until": now.isoformat(timespec="seconds"),
            },
            "merged": {
                "branch": merged.branch,
                "latest": merged.latest.isoformat(timespec="seconds") if merged.latest else None,
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
        f"{sum(rule[MISSED] for rule in report)} of the {judged} the record can judge came "
        "from a session that never loaded it",
    )
