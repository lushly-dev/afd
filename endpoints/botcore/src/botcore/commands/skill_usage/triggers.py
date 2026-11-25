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
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.disk.git import GitError, git_out
from botcore.commands.disk.scan import compile_pattern
from botcore.commands.disk.settings import SettingsError
from botcore.commands.disk.steps import run_blocking
from botcore.commands.skill_usage.collect import (
    DEFAULT_BRANCHES,
    GIT_SECONDS,
    NOTHING_HELD,
    _strings,
    project_remote,
    settings_refused,
    skill_inventory,
)
from botcore.commands.skill_usage.events import DELEGATE, EDIT, MAIN, PATHS, RECOGNIZER, SUBAGENT
from botcore.commands.skill_usage.report import (
    MAX_DAYS,
    _mapping,
    _parse,
    current_name,
    record_warnings,
)
from botcore.commands.skill_usage.store import (
    InvalidMachine,
    load_record,
    local,
    newest_inventory,
    state_dir,
)
from botcore.config import load_config
from botcore.utils.workspace import find_workspace

# Changes are read from the branch they are merged to (`DEFAULT_BRANCHES`), the first of
# those names a checkout has. Never the checked-out commit: on a topic branch that would
# report unmerged work as merged.
# A pull request's number as a forge writes it: a number no forge would write is not one
_NUMBER = r"\d{1,9}"
_PULL_REQUEST = re.compile(rf"\(#({_NUMBER})\)\s*$|^Merge pull request #({_NUMBER})\b", re.ASCII)
_RECORD, _FIELD = "\x1e", "\x1f"
# Why a change cannot be judged, in the order they are asked
_UNKNOWN = (
    "no_pull_request",
    "no_session",
    "opened_elsewhere",
    "no_link_time",
    "after_opening",
    "possibly_loaded",
    "incomplete_record",
)
LOADED, MISSED = "loaded", "missed"
# A load's time is its machine's and a merge's is the forge's: a load this soon after the
# merge may have come before it, and is no ground for a miss
CLOCKS = timedelta(minutes=5)


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
    shared: set[int]  # numbers that more than one change of the branch carries, ever


class _NoBranch(Exception):
    """The checkout does not say which branch changes are merged to."""


def _number(subject: str) -> int | None:
    found = _PULL_REQUEST.search(subject.strip())
    return int(found.group(1) or found.group(2)) if found else None


def merged_changes(root: Path, since: datetime) -> Merged:
    """The changes merged to the default branch since a moment, each with every path it
    touched: both sides of a rename, and names git would otherwise quote."""
    for ref in DEFAULT_BRANCHES:
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
        files = [name.strip("\n") for name in rest.split("\0") if name.strip("\n")]
        changes.append(Change(moment, _number(subject), files))
    # Over the branch's whole history, so that the answer does not depend on the window
    subjects = git_out(root, "log", ref, "--first-parent", "--format=%s", timeout=GIT_SECONDS * 2)
    carried = Counter(_number(subject) for subject in subjects.splitlines())
    shared = {number for number, times in carried.items() if number is not None and times > 1}
    try:  # origin/HEAD by the name of the branch it points at
        branch = git_out(root, "rev-parse", "--abbrev-ref", ref, timeout=GIT_SECONDS).strip()
    except GitError:
        branch = ""
    branch = branch or ref.removeprefix("refs/remotes/").removeprefix("refs/heads/")
    return Merged(branch, latest, sorted(changes, key=lambda c: (c.at, c.number or 0)), shared)


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
            if repository.casefold() != project.casefold():
                continue
            if not re.fullmatch(_NUMBER, number, re.ASCII):
                continue
            found.attached.add(int(number))
            opened = item.get("opened") if isinstance(item, dict) else None
            if opened is True:
                moment = _parse(item.get("linked_at"))
                found.opened.setdefault(int(number), {})[session_id] = moment
            elif opened is not False:
                found.unsaid += 1
    return found


def _near(sessions: dict[str, dict], opener: str) -> set[str]:
    """The sessions whose loads may have reached an opener's change: the sessions it was
    forked from, whose conversation it carries, and the tasks it or they delegated, which may
    have made the change. Never its siblings: forty cells of one fleet do not answer for each
    other."""

    def parent(session_id: str) -> str | None:
        found = sessions.get(session_id, {}).get("parent")
        return found if isinstance(found, str) and found else None

    def agent(session_id: str) -> object:
        return sessions.get(session_id, {}).get("agent")

    tasks: dict[str, list[str]] = {}
    for session_id in sessions:
        if agent(session_id) == DELEGATE and (delegator := parent(session_id)):
            tasks.setdefault(delegator, []).append(session_id)
    near: set[str] = set()
    current = opener
    while agent(current) == MAIN and (origin := parent(current)) and origin not in near:
        if origin == opener:
            break
        near.add(origin)  # a fork is a person's thread that came from another
        current = origin
    queue = [opener, *near]
    while queue:
        for task in tasks.get(queue.pop(), []):
            if task not in near and task != opener:
                near.add(task)
                queue.append(task)
    return near


@dataclass
class _Loads:
    """What the record says of one skill, by session."""

    known: dict[str, list[tuple[datetime, bool]]]  # each load, and whether a subagent's
    unsure: dict[str, list[datetime]]  # events of a kind this botcore does not know


def _judge(
    change: Change, openers: dict[str, datetime | None], loads: _Loads, sessions: dict[str, dict]
) -> tuple[str, bool]:
    """One merged change against the sessions that opened its pull request: `loaded`,
    `missed` or the reason it is unknown; and, when loaded, whether only by a subagent."""
    verdicts: set[str] = set()
    own_agent = False
    merged_by = change.at + CLOCKS
    for session_id, opened_at in openers.items():
        before_merge = [load for load in loads.known.get(session_id, []) if load[0] <= merged_by]
        by_opening = [load for load in before_merge if opened_at and load[0] <= opened_at]
        if opened_at is None or opened_at > change.at:
            verdicts.add("no_link_time")  # the record does not place the opening before the merge
        elif by_opening:
            verdicts.add(LOADED)
            own_agent = own_agent or not all(subagent for _, subagent in by_opening)
        elif before_merge:
            verdicts.add("after_opening")  # at a review or a repair: after the change was made
        elif any(
            moment <= merged_by
            for near in (session_id, *sorted(_near(sessions, session_id)))
            for moment in (
                *loads.unsure.get(near, []),
                *(load[0] for load in loads.known.get(near, []) if near != session_id),
            )
        ):
            verdicts.add("possibly_loaded")  # not by the opener, or not known to be a load
        else:
            verdicts.add(MISSED)
    verdict = next(verdict for verdict in (LOADED, *_UNKNOWN, MISSED) if verdict in verdicts)
    return verdict, verdict == LOADED and not own_agent


def _fail(code: str, message: str, suggestion: str) -> CommandResult[dict]:
    return error(code, message, suggestion=suggestion)


async def skill_usage_triggers(days: int = 30, repo: str | None = None) -> CommandResult[dict]:
    """For each skill a repository requires, the merged changes to its paths and whether the
    session that opened each one's pull request had loaded the skill by then.

    A change is `loaded` when that session had loaded the skill, itself or through a
    subagent, by the time it opened the pull request. It is `missed` when that session never
    loaded it before the change merged, and names the session. Everything else is `unknown`,
    and `unknown_why` gives the reason: the change has no pull request of its own, no session
    in the record is linked to it, no session linked to it is known to have opened it, the
    record does not place the opening before the merge, the session loaded the skill only
    after opening it, the skill may have been loaded where the record cannot be sure, or the
    record does not yet reach the change's merge on every machine.

    Args:
        days: Length of the window in days.
        repo: The repository's checkout; the one holding the working directory when left out.
    """
    return await run_blocking(_skill_usage_triggers_sync, days, repo)


def _skill_usage_triggers_sync(  # noqa: C901, PLR0911, PLR0912, PLR0915 - one report
    days: int, repo: str | None
) -> CommandResult[dict]:
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
        here = local()
        record = load_record(directory, here)
    except (SettingsError, InvalidMachine) as exc:
        return settings_refused(exc)
    except OSError as exc:
        return _fail(
            "RECORD_UNAVAILABLE",
            f"The skill usage record in {directory} could not be read: {exc}",
            "Check that it is a folder this user can read, or set BOTCORE_SKILL_USAGE_STATE to "
            "the folder that holds the record",
        )
    events, state, sessions = record.events, record.state, record.sessions
    if not events and not state and not record.collected:
        return _fail(
            "NOT_COLLECTED",
            "This machine has no skill usage record yet",
            "Run skill-usage-collect first; it reads what the harnesses recorded",
        )
    if record.damaged:  # a lost load would turn a change into a miss
        whose = ", ".join(
            "this machine" if machine == here.machine else machine
            for machine in sorted(record.unreadable)
        )
        return _fail(
            "RECORD_DAMAGED",
            f"{record.damaged} lines of the skill usage record cannot be read ({whose}), so "
            "no change can be judged from it",
            "Run skill-usage-collect --rebuild on that machine: it reads the store again and "
            "writes the record without the damaged lines. Another machine's copy in the "
            "shared folder may only be half synced: try again once it is",
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

    # What the project's skills are called now: as the newest commit of its default branch
    # has them, in the checkout in hand (whether or not any machine ever collected in it) or
    # in the record, whichever read the newer one. Never the checked-out files: on a topic
    # branch those are unmerged work, and on an old one the project as it was. The list and
    # the renames it is read with come from that one account; the others only add names it
    # does not know.
    try:
        here_now = skill_inventory(root)
    except (GitError, ValueError):  # git stopped answering since the changes were read
        here_now = None
    accounts = [here_now, record.skills.get(project)]
    account: dict = newest_inventory([one for one in accounts if one]) or dict(NOTHING_HELD)
    account_aliases = account.get("aliases")
    project_renames = {
        **(here_now["renames"] if here_now else {}),
        **record.renames.get(project, {}),
        **account["renames"],
        **(account_aliases if isinstance(account_aliases, dict) else {}),
    }
    held = account["held"]

    # A miss needs every machine's record up to the change's merge: a load made on another
    # machine, or after this one last collected, is a load all the same. Every machine is
    # waited for but those the owner names as away; this machine always is.
    waits = {
        machine: _parse(when)
        for machine, when in record.collected.items()
        if machine == here.machine or machine not in here.away
    }
    awaited: set[str] = set()  # the machines a change that would be a miss is waiting for

    def certain(change: Change) -> bool:
        late = {name for name, moment in waits.items() if moment is None or moment < change.at}
        awaited.update(late)
        return record.whole and not late

    def named(skill: str) -> str:
        return current_name(skill, project_renames, held)

    # A skill once, under the name it has now, with every path declared for it
    declared: dict[str, list[str]] = {}
    for skill, paths in rules.items():
        declared.setdefault(named(skill), []).extend(paths)

    # A session's loads count whichever project the harness filed the session under: one
    # started in another project can open a pull request here, and it loaded the skill all
    # the same.
    loads: dict[str, _Loads] = {}
    outdated = 0
    for event in events:
        outdated += event.v < RECOGNIZER
        moment = _parse(event.at)
        if moment is None or event.path == EDIT:
            continue
        of_skill = loads.setdefault(named(event.skill), _Loads({}, {}))
        if event.path in PATHS:
            load = (moment, event.agent == SUBAGENT)
            of_skill.known.setdefault(event.thread, []).append(load)
        else:  # a kind of event a newer botcore wrote: it may be a load
            of_skill.unsure.setdefault(event.thread, []).append(moment)

    links = _links(sessions, project)
    report: list[dict] = []
    for skill, paths in sorted(declared.items()):
        patterns = [_matcher(path) for path in paths]
        counts = {LOADED: 0, MISSED: 0}
        unknown = dict.fromkeys(_UNKNOWN, 0)
        misses: list[dict] = []
        by_subagent = 0
        matching = [
            change
            for change in merged.changes
            if any(pattern.match(file) for file in change.files for pattern in patterns)
        ]
        for change in matching:
            openers = links.opened.get(change.number, {}) if change.number else {}
            # a number two merged changes carry is neither's own: a later push that names it
            if change.number is None or change.number in merged.shared:
                verdict = "no_pull_request"
            elif openers:
                verdict, only_subagent = _judge(
                    change, openers, loads.get(skill, _Loads({}, {})), sessions
                )
                by_subagent += only_subagent
                if verdict == MISSED and not certain(change):
                    verdict = "incomplete_record"
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
                "loaded_by_subagent": by_subagent,
                "missed": counts[MISSED],
                "unknown": sum(unknown.values()),
                "unknown_why": unknown,
                "rate": round(counts[LOADED] / judged, 3) if judged else None,
                "misses": misses,
            }
        )

    warnings = record_warnings(record, here, now)
    if outdated and not (record.recognizer is not None and record.recognizer >= RECOGNIZER):
        warnings.append(  # a load an older botcore did not know reads as a miss
            f"{outdated} events were recognised by an older botcore, which may have missed "
            "loads: run skill-usage-collect --rebuild to read them again"
        )
    if awaited:
        warnings.append(
            f"No change is called missed until every machine has collected since it merged, "
            f"and {', '.join(sorted(awaited))} had not for some: run skill-usage-collect "
            "there. A machine that is switched off can be named in skill_usage_away in this "
            "machine's settings, and is then not waited for"
        )
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
                "shared": str(record.shared) if record.shared else None,
                "machines": sorted({event.machine for event in events} | set(record.collected)),
                "collected_at": state.get("collected_at"),
                "collected": dict(sorted(record.collected.items())),
            },
            "warnings": warnings,
        },
        reasoning=f"{sum(rule['changes'] for rule in report)} merged changes needed a skill; "
        f"{sum(rule[MISSED] for rule in report)} of the {judged} the record can judge came "
        "from a session that never loaded it",
    )
