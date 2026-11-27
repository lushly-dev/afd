"""`skill-usage-triggers`: the merged changes that needed a skill, and whether the session
that opened each one's pull request had loaded it.

A repository declares which paths require which skill (`[[skills.required]]`). Three things
are known for certain, and the report uses only those: which merged changes touched those
paths (git), which session opened each change's pull request and when (the harness says so,
and the record keeps it), and when that session loaded the skill (the record). A fleet's
merge lane opens its cells' pull requests itself, so for those the session is the one the
lane names in the commit it folds the cell's branch into (a `Factory-session:` trailer), and
the moment is that commit's author time.

Nothing else ties a session to a change. What a session changed turn by turn is not used: a
checkout is moved under a session by merges, sync scripts and other sessions, and a moved
file looks like a changed one. A session that attached itself to a pull request to repair,
review or merge it is not judged, and neither is one that only worked on the same branch.

Read-only. Where those three cannot settle it, a change is unknown, never a miss.
"""

from __future__ import annotations

import hashlib
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

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


# The trailer a fleet's merge lane writes in the commit it folds a cell's branch into, once
# per thread that worked on the cell: the lane opens the pull request, so no session is
# recorded as its opener (lushly-dev/afd#1887). Its value is `session_tag` of the thread.
SESSION_TRAILER = "Factory-session"


def session_tag(session_id: str) -> str:
    """A session's id as the trailer gives it, opaque in public history: `sha256:` and the
    first 24 hex digits of its SHA-256 (botcore-factory's `squash.session_tag`)."""
    return "sha256:" + hashlib.sha256(session_id.encode("utf-8")).hexdigest()[:24]


@dataclass
class Change:
    """A change merged to the default branch."""

    at: datetime
    number: int | None  # its pull request, from the subject git gives a merged change
    files: list[str]
    commit: str = ""
    authored: datetime | None = None  # a rebasing queue keeps the cell's commit time
    sessions: tuple[str, ...] = ()  # its `Factory-session:` trailers, as written


@dataclass
class Merged:
    """What merged to the default branch in a window, and how far the checkout knows it."""

    branch: str  # as the checkout names it, for example origin/main
    latest: datetime | None  # its newest change: a checkout that was not fetched ends early
    changes: list[Change]  # oldest first
    shared: set[int]  # numbers that more than one change of the branch carries, ever
    ref: str = ""  # the ref read, as git resolves it (origin/HEAD, origin/main, ...)


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
        "-z", "--name-only",
        f"--format={_RECORD}%H{_FIELD}%cI{_FIELD}%aI{_FIELD}"
        f"%(trailers:key={SESSION_TRAILER},valueonly,separator=%x1d){_FIELD}%s",
        timeout=GIT_SECONDS * 2,
    )  # fmt: skip
    changes: list[Change] = []
    for record in text.split(_RECORD)[1:]:
        head, _, rest = record.partition("\0")
        fields = head.split(_FIELD, 4)
        if len(fields) != 5:
            continue
        commit, stamp, authored, trailers, subject = fields
        moment = _parse(stamp.strip())
        if moment is None:
            continue
        files = [name.strip("\n") for name in rest.split("\0") if name.strip("\n")]
        tags = tuple(tag.strip() for tag in trailers.split("\x1d") if tag.strip())
        changes.append(
            Change(moment, _number(subject), files, commit.strip(), _parse(authored.strip()), tags)
        )
    # Over the branch's whole history, so that the answer does not depend on the window
    subjects = git_out(root, "log", ref, "--first-parent", "--format=%s", timeout=GIT_SECONDS * 2)
    carried = Counter(_number(subject) for subject in subjects.splitlines())
    shared = {number for number, times in carried.items() if number is not None and times > 1}
    try:  # origin/HEAD by the name of the branch it points at
        branch = git_out(root, "rev-parse", "--abbrev-ref", ref, timeout=GIT_SECONDS).strip()
    except GitError:
        branch = ""
    branch = branch or ref.removeprefix("refs/remotes/").removeprefix("refs/heads/")
    ordered = sorted(changes, key=lambda c: (c.at, c.number or 0))
    return Merged(branch, latest, ordered, shared, ref)


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


def _fleet_openers(change: Change, tags: dict[str, str]) -> dict[str, datetime | None]:
    """The sessions a change's `Factory-session:` trailers name that the record holds, each
    with the moment it handed the change over: the commit's author time, which a rebasing
    queue keeps and a squashing one may not, so never later than the merge."""
    handed = min(change.authored, change.at) if change.authored else change.at
    return {tags[tag]: handed for tag in change.sessions if tag in tags}


def _fail(code: str, message: str, suggestion: str) -> CommandResult[dict]:
    return error(code, message, suggestion=suggestion)


async def skill_usage_triggers(days: int = 30, repo: str | None = None) -> CommandResult[dict]:
    """For each skill a repository requires, the merged changes to its paths and whether the
    session that opened each one's pull request had loaded the skill by then.

    A change is `loaded` when that session had loaded the skill, itself or through a
    subagent, by the time it opened the pull request. A fleet cell's change, whose pull
    request the merge lane opened, is judged by the sessions its commit's `Factory-session:`
    trailers name, as of the commit's author time. It is `missed` when that session never
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


def checkout_root(days: int, repo: str | None) -> Path | CommandResult[dict]:
    """The checkout a report reads, or why it cannot: `days` out of range or no checkout."""
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
    return root


def config_refused(root: Path, exc: Exception) -> CommandResult[dict]:
    return _fail(
        "CONFIG_INVALID",
        f"The botcore configuration of {root} could not be read: {exc}",
        "Fix its botcore.toml (or [tool.botcore] in pyproject.toml) and run it again",
    )


@dataclass
class Verdict:
    """How one merged change stands against one skill."""

    verdict: str  # `loaded`, `missed` or the reason it is unknown
    only_subagent: bool  # loaded only through a subagent
    openers: list[str]  # the sessions judged: its opener, or those its fold names
    fleet: bool  # judged by its fold's `Factory-session:` trailers
    own: bool  # its subject names a pull request no other change on the branch names


@dataclass
class Judging:
    """Everything a report needs to judge a repository's merged changes against skills: the
    record, the merged changes, each skill's loads and the project's names for its skills."""

    root: Path
    project: str
    days: int
    now: datetime
    since: datetime
    merged: Merged
    directory: Path
    record: Any
    here: Any
    links: _Links
    tags: dict[str, str]
    loads: dict[str, _Loads]
    waits: dict[str, datetime | None]
    renames: dict[str, str]
    held: Any
    outdated: int
    awaited: set[str] = field(default_factory=set)

    def named(self, skill: str) -> str:
        """A skill under the name the project's default branch gives it now."""
        return current_name(skill, self.renames, self.held)

    def certain(self, change: Change) -> bool:
        """Whether every machine waited for has collected since the change merged."""
        late = {name for name, when in self.waits.items() if when is None or when < change.at}
        self.awaited.update(late)
        return self.record.whole and not late

    def judge(self, change: Change, skill: str) -> Verdict:
        """One merged change against one skill (named as `named` names it)."""
        links, merged = self.links, self.merged
        # a number two merged changes carry is neither's own: a later push that names it
        own = change.number is not None and change.number not in merged.shared
        openers = links.opened.get(change.number, {}) if own and change.number else {}
        fleet = not openers and bool(change.sessions)
        if fleet:
            # A fleet cell's change: the lane opened its pull request, and the sessions its
            # fold names made it. They handed it over when the commit was written.
            openers = _fleet_openers(change, self.tags)
        only_subagent = False
        if openers:
            verdict, only_subagent = _judge(
                change, openers, self.loads.get(skill, _Loads({}, {})), self.record.sessions
            )
            # A miss needs every session its fold names: one no record holds may be the one
            # that loaded it. A load by any of them stands.
            unheld = fleet and len(openers) < len(set(change.sessions))
            if verdict == MISSED and (unheld or not self.certain(change)):
                verdict = "incomplete_record"
        elif change.sessions:
            verdict = "no_session"  # no machine's record holds a session its fold names
        elif not own:
            verdict = "no_pull_request"
        else:
            attached = change.number in links.attached
            verdict = "opened_elsewhere" if attached else "no_session"
        return Verdict(verdict, only_subagent, sorted(openers), fleet, own)

    def warnings(self) -> list[str]:
        record, events, project = self.record, self.record.events, self.project
        warnings = record_warnings(record, self.here, self.now)
        if self.outdated and not (
            record.recognizer is not None and record.recognizer >= RECOGNIZER
        ):
            warnings.append(  # a load an older botcore did not know reads as a miss
                f"{self.outdated} events were recognised by an older botcore, which may have "
                "missed loads: run skill-usage-collect --rebuild to read them again"
            )
        if self.awaited:
            warnings.append(
                f"No change is called missed until every machine has collected since it "
                f"merged, and {', '.join(sorted(self.awaited))} had not for some: run "
                "skill-usage-collect there. A machine that is switched off can be named in "
                "skill_usage_away in this machine's settings, and is then not waited for"
            )
        if self.links.unsaid:
            warnings.append(
                f"{self.links.unsaid} links to {project} pull requests do not say which "
                "session opened them, so their changes are unknown: run skill-usage-collect "
                "with this botcore to record it"
            )
        if not any(event.project == project for event in events) and not any(
            entry.get("project") == project for entry in record.sessions.values()
        ):
            known = sorted({event.project for event in events})
            warnings.append(
                f"The record holds nothing for {project}, so every change is unknown; it "
                f"holds {', '.join(known) or 'no project'}. Collect on a machine that works in it"
            )
        return warnings

    def frame(self) -> dict[str, Any]:
        """The window, branch and record a report was read from."""
        record, merged = self.record, self.merged
        return {
            "project": self.project,
            "window": {
                "days": self.days,
                "since": self.since.isoformat(timespec="seconds"),
                "until": self.now.isoformat(timespec="seconds"),
            },
            "merged": {
                "branch": merged.branch,
                "latest": merged.latest.isoformat(timespec="seconds") if merged.latest else None,
            },
            "record": {
                "state_dir": str(self.directory),
                "shared": str(record.shared) if record.shared else None,
                "machines": sorted(
                    {event.machine for event in record.events} | set(record.collected)
                ),
                "collected_at": record.state.get("collected_at"),
                "collected": dict(sorted(record.collected.items())),
            },
        }


def prepare_judging(root: Path, days: int) -> Judging | CommandResult[dict]:  # noqa: PLR0911
    """Read the record and the default branch's changes for a report, or say why not."""
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
    renames = {
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
        of_skill = loads.setdefault(current_name(event.skill, renames, held), _Loads({}, {}))
        if event.path in PATHS:
            load = (moment, event.agent == SUBAGENT)
            of_skill.known.setdefault(event.thread, []).append(load)
        else:  # a kind of event a newer botcore wrote: it may be a load
            of_skill.unsure.setdefault(event.thread, []).append(moment)

    return Judging(
        root=root,
        project=project,
        days=days,
        now=now,
        since=since,
        merged=merged,
        directory=directory,
        record=record,
        here=here,
        links=_links(sessions, project),
        tags={session_tag(session_id): session_id for session_id in sessions},
        loads=loads,
        waits=waits,
        renames=renames,
        held=held,
        outdated=outdated,
    )


def touching(changes: list[Change], paths: list[str]) -> list[Change]:
    """The changes that touched any of the globs."""
    patterns = [_matcher(path) for path in paths]
    return [
        change
        for change in changes
        if any(pattern.match(file) for file in change.files for pattern in patterns)
    ]


def _skill_usage_triggers_sync(days: int, repo: str | None) -> CommandResult[dict]:
    root = checkout_root(days, repo)
    if not isinstance(root, Path):
        return root
    try:
        rules = required_skills(root)
    except Exception as exc:  # noqa: BLE001 - any way the configuration fails to load
        return config_refused(root, exc)
    if not rules:
        return _fail(
            "NO_REQUIRED_SKILLS",
            f"{root.name} declares no required skill",
            'Declare one in its botcore.toml: [[skills.required]] with skill = "<name>" and '
            'paths = ["<glob>", ...]',
        )
    judging = prepare_judging(root, days)
    if not isinstance(judging, Judging):
        return judging

    # A skill once, under the name it has now, with every path declared for it
    declared: dict[str, list[str]] = {}
    for skill, paths in rules.items():
        declared.setdefault(judging.named(skill), []).extend(paths)

    report: list[dict] = []
    for skill, paths in sorted(declared.items()):
        counts = {LOADED: 0, MISSED: 0}
        unknown = dict.fromkeys(_UNKNOWN, 0)
        misses: list[dict] = []
        by_subagent = 0
        matching = touching(judging.merged.changes, paths)
        for change in matching:
            found = judging.judge(change, skill)
            by_subagent += found.only_subagent
            if found.verdict in counts:
                counts[found.verdict] += 1
            else:
                unknown[found.verdict] += 1
            if found.verdict == MISSED and found.fleet:
                # its subject may carry no number: the lane merged the commit it validated,
                # before the pull request had one (lushly-dev/afd#2023)
                misses.append(
                    {
                        "change": change.number if found.own else None,
                        "commit": change.commit[:12],
                        "sessions": found.openers,
                    }
                )
            elif found.verdict == MISSED:
                misses.append({"change": change.number, "sessions": found.openers})
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

    frame = judging.frame()
    judged = sum(rule[LOADED] + rule[MISSED] for rule in report)
    return success(
        {
            "project": frame["project"],
            "window": frame["window"],
            "merged": frame["merged"],
            "rules": report,
            "record": frame["record"],
            "warnings": judging.warnings(),
        },
        reasoning=f"{sum(rule['changes'] for rule in report)} merged changes needed a skill; "
        f"{sum(rule[MISSED] for rule in report)} of the {judged} the record can judge came "
        "from a session that never loaded it",
    )
