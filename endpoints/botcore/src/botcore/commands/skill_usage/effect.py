"""`skill-usage-effect`: whether a loaded skill prevents the mistakes it names.

A repository names checkable mistakes (`[[skills.traps]]`): a skill, the paths a change must
touch, and a regular expression over the lines it adds or over its commit message. For each
merged change to those paths, `skill-usage-triggers`' rules say whether the session that made
it had loaded the skill (`loaded`), had not (`missed`) or cannot be told (`unknown`), and the
trap's check says whether the change made the mistake. The report compares the two arms.

Read-only, and it sees only what reached the default branch: a mistake that review or a
check caught before the merge is never counted. Nothing of what a session said or ran is
read, and no matched line is reported, only the change it is in (lushly-dev/afd#1829).

The history is read in a few batched `git log` calls, whatever the machine's git settings
say: renames are found explicitly, so a file moved into a trap's paths adds only the lines
the move changed, and paths are given to git literally.
"""

from __future__ import annotations

import codecs
import re
import secrets
from dataclasses import dataclass, field
from pathlib import Path

from afd import CommandResult, success

from botcore.commands.disk.git import GitError, git_out
from botcore.commands.disk.steps import run_blocking
from botcore.commands.skill_usage.collect import GIT_SECONDS
from botcore.commands.skill_usage.triggers import (
    _UNKNOWN,
    LOADED,
    MISSED,
    Change,
    Judging,
    _fail,
    _matcher,
    checkout_root,
    config_refused,
    prepare_judging,
    touching,
)
from botcore.config import SkillTrap, load_config

# An arm needs this many judged changes before the two arms' rates are compared: a mistake
# that escapes a few times in a hundred changes moves a rate of a handful by a fifth at once
MIN_SAMPLES = 20
# The changes that made a trap's mistake that one report names, newest first
MAX_EXAMPLES = 20
# A pattern is matched against no longer a line than this, nor a longer message: a minified
# file's one line would make a backtracking pattern take minutes
MAX_LINE = 10_000
MAX_MESSAGE = 100_000
# Paths given to one `git log`: well inside any system's command-line limit
PATHS_PER_CALL = 500
# A record starts with a marker no commit is likely to hold: a fresh one in each process
_MARK = "\x1e" + secrets.token_hex(8)
_FIELD = "\x1f"
# The same output on every machine: no colours, no external diff or text conversion, the
# usual prefixes, and paths as they are (core.quotePath off; git still quotes a path holding
# a tab, a newline or a quote, which `_unquote` reads)
_DIFF = (
    "--no-color", "--no-ext-diff", "--no-textconv", "-U0",
    "--src-prefix=a/", "--dst-prefix=b/",
)  # fmt: skip


def _git(root: Path, *args: str, timeout: float = GIT_SECONDS * 4) -> str:
    return git_out(
        root, "-c", "core.quotePath=false", "--literal-pathspecs", *args, timeout=timeout
    )


def _unquote(path: str) -> str:
    if len(path) >= 2 and path[0] == path[-1] == '"':
        raw = codecs.escape_decode(path[1:-1].encode("utf-8"))[0]
        return bytes(raw).decode("utf-8", errors="replace")
    return path


def _added_by_file(text: str) -> dict[str, list[str]]:
    """The lines a patch adds, by the path they are added to. A line is read as added only
    inside a hunk, so an added `++count;` is not taken for a file's header."""
    added: dict[str, list[str]] = {}
    current: str | None = None
    in_hunk = False
    for line in text.split("\n"):
        if line.startswith("diff --git "):
            current, in_hunk = None, False
        elif not in_hunk and line.startswith("+++ "):
            name = _unquote(line[4:].rstrip("\t"))
            current = name[2:] if name.startswith("b/") else None  # /dev/null: a deletion
        elif line.startswith("@@"):
            in_hunk = True
        elif in_hunk and current is not None and line.startswith("+"):
            added.setdefault(current, []).append(line[1:])
    return added


@dataclass
class _History:
    """What the window's merged changes say that the traps read: each one's message and the
    lines it added, by file."""

    messages: dict[str, str] = field(default_factory=dict)
    added: dict[str, dict[str, list[str]]] = field(default_factory=dict)
    long_lines: int = 0


def _window(judging: Judging) -> list[str]:
    merged = judging.merged
    return [merged.ref, "--first-parent", f"--since={judging.since.isoformat()}"]


def _read_messages(judging: Judging, history: _History) -> None:
    text = _git(
        judging.root, "log", *_window(judging), "--no-show-signature",
        f"--format={_MARK}%H{_FIELD}%B",
    )  # fmt: skip
    for record in text.split(_MARK)[1:]:
        commit, _, message = record.partition(_FIELD)
        history.messages[commit.strip()] = message[:MAX_MESSAGE]


def _renamed_into(judging: Judging, wanted: set[str]) -> dict[str, list[tuple[str, str]]]:
    """The files of `wanted` each change renamed from another path, found with rename
    detection whatever the machine's settings say, and however many files a change holds
    (`-l0`). A copy is not looked for: its lines read as added."""
    text = _git(
        judging.root, "log", *_window(judging), "--diff-merges=first-parent", "-M", "-l0",
        "--name-status", "-z", f"--format={_MARK}%H",
    )  # fmt: skip
    found: dict[str, list[tuple[str, str]]] = {}
    for record in text.split(_MARK)[1:]:
        fields = record.split("\0")
        commit = fields[0].strip()
        rest = [item.strip("\n") for item in fields[1:]]
        index = 0
        while index < len(rest):
            status = rest[index]
            if status[:1] in ("R", "C") and index + 2 < len(rest):
                old, new = rest[index + 1], rest[index + 2]
                if new in wanted:
                    found.setdefault(commit, []).append((old, new))
                index += 3
            else:
                index += 2 if status else 1
    return found


def _read_added(judging: Judging, history: _History, wanted: set[str]) -> None:
    files = sorted(wanted)
    for start in range(0, len(files), PATHS_PER_CALL):
        text = _git(
            judging.root, "log", *_window(judging), "--diff-merges=first-parent", "--root",
            "--no-renames", "-p", *_DIFF, f"--format={_MARK}%H", "--",
            *files[start : start + PATHS_PER_CALL],
        )  # fmt: skip
        for record in text.split(_MARK)[1:]:
            commit, _, patch = record.partition("\n")
            for name, lines in _added_by_file(patch).items():
                history.added.setdefault(commit.strip(), {}).setdefault(name, []).extend(lines)
    # A file renamed into a trap's paths adds only what the rename changed
    for commit, pairs in _renamed_into(judging, wanted).items():
        paths = [path for pair in pairs for path in pair]
        patch = _git(
            judging.root, "diff-tree", "-r", "-p", "-M", "-l0", "--root", "-m",
            "--first-parent", "--no-commit-id", *_DIFF, commit, "--", *paths,
        )  # fmt: skip
        moved = _added_by_file(patch)
        of_commit = history.added.setdefault(commit, {})
        for _, new in pairs:
            of_commit[new] = moved.get(new, [])


def read_history(judging: Judging, traps: list[SkillTrap]) -> _History:
    """The messages and added lines the traps need, for the window's merged changes."""
    history = _History()
    if any(trap.commit_pattern for trap in traps):
        _read_messages(judging, history)
    wanted: set[str] = set()
    for trap in traps:
        if trap.added_pattern:
            patterns = [_matcher(path) for path in trap.paths]
            for change in touching(judging.merged.changes, trap.paths):
                wanted.update(f for f in change.files if any(p.match(f) for p in patterns))
    if wanted:
        _read_added(judging, history, wanted)
    return history


@dataclass
class _Check:
    """A trap compiled once."""

    trap: SkillTrap
    paths: list[re.Pattern[str]]
    added: re.Pattern[str] | None
    message: re.Pattern[str] | None

    @classmethod
    def of(cls, trap: SkillTrap) -> _Check:
        return cls(
            trap,
            [_matcher(path) for path in trap.paths],
            re.compile(trap.added_pattern) if trap.added_pattern else None,
            re.compile(trap.commit_pattern) if trap.commit_pattern else None,
        )

    def makes_mistake(self, change: Change, history: _History) -> bool | None:
        """Whether a change made the trap's mistake; None when it is exempt."""
        if self.trap.unless_paths and touching([change], self.trap.unless_paths):
            return None
        if self.message and self.message.search(history.messages.get(change.commit, "")):
            return True
        if self.added:
            for name, lines in history.added.get(change.commit, {}).items():
                if not any(pattern.match(name) for pattern in self.paths):
                    continue
                for line in lines:
                    if len(line) > MAX_LINE:
                        history.long_lines += 1
                    elif self.added.search(line):
                        return True
        return False


@dataclass
class _Arm:
    changes: int = 0
    hits: int = 0

    def view(self) -> dict:
        rate = round(self.hits / self.changes, 3) if self.changes else None
        return {"changes": self.changes, "hits": self.hits, "rate": rate}


@dataclass
class _Tally:
    loaded: _Arm = field(default_factory=_Arm)
    missed: _Arm = field(default_factory=_Arm)
    unknown: _Arm = field(default_factory=_Arm)
    unknown_why: dict[str, int] = field(default_factory=lambda: dict.fromkeys(_UNKNOWN, 0))
    exempt: int = 0
    examples: list[dict] = field(default_factory=list)


def traps_of(root: Path) -> list[SkillTrap]:
    """A checkout's `[[skills.traps]]` as its working tree declares them."""
    return list(load_config(workspace=root).skills.traps)


def _tally(judging: Judging, check: _Check, history: _History) -> tuple[str, list[Change], _Tally]:
    skill = judging.named(check.trap.skill)
    matching = touching(judging.merged.changes, check.trap.paths)
    tally = _Tally()
    for change in matching:
        hit = check.makes_mistake(change, history)
        if hit is None:
            tally.exempt += 1
            continue
        found = judging.judge(change, skill)
        if found.verdict == LOADED:
            arm, name = tally.loaded, LOADED
        elif found.verdict == MISSED:
            arm, name = tally.missed, MISSED
        else:
            arm, name = tally.unknown, "unknown"
            tally.unknown_why[found.verdict] += 1
        arm.changes += 1
        arm.hits += hit
        if hit:
            tally.examples.append(
                {
                    "change": change.number if found.own else None,
                    "commit": change.commit[:12],
                    "arm": name,
                    "sessions": found.openers if name != "unknown" else [],
                }
            )
    return skill, matching, tally


def _row(trap: SkillTrap, skill: str, matching: list[Change], tally: _Tally) -> dict:
    loaded, missed = tally.loaded.view(), tally.missed.view()
    enough = min(tally.loaded.changes, tally.missed.changes) >= MIN_SAMPLES
    delta = (
        round(missed["rate"] - loaded["rate"], 3)
        if enough and loaded["rate"] is not None and missed["rate"] is not None
        else None
    )
    return {
        "trap": trap.id,
        "skill": skill,
        "paths": sorted(trap.paths),
        "changes": len(matching),
        "exempt": tally.exempt,
        "loaded": loaded,
        "missed": missed,
        "unknown": {"changes": tally.unknown.changes, "hits": tally.unknown.hits},
        "unknown_why": tally.unknown_why,
        "delta": delta,
        "examples": list(reversed(tally.examples))[:MAX_EXAMPLES],
    }


def _row_warnings(row: dict, judging: Judging) -> list[str]:
    name, loaded, missed = row["trap"], row["loaded"], row["missed"]
    unknown = row["unknown"]["changes"]
    warnings = []
    if row["skill"] not in judging.held and row["skill"] not in judging.loads:
        warnings.append(
            f"{name}: the project holds no skill named {row['skill']} and no session loaded "
            "one, so every change it judges is missed: check the trap's skill"
        )
    if row["delta"] is None and row["changes"]:
        warnings.append(
            f"{name}: {loaded['changes']} loaded and {missed['changes']} missed changes were "
            f"judged; each arm needs {MIN_SAMPLES} before the two are compared"
        )
    elif row["delta"] is not None and not loaded["hits"] and not missed["hits"]:
        warnings.append(
            f"{name}: neither arm made the mistake, so a difference of 0 says nothing yet"
        )
    if unknown > loaded["changes"] + missed["changes"]:
        warnings.append(
            f"{name}: {unknown} of its changes cannot be judged, more than the "
            f"{loaded['changes'] + missed['changes']} that can: the arms may not stand for "
            "the rest"
        )
    return warnings


async def skill_usage_effect(days: int = 30, repo: str | None = None) -> CommandResult[dict]:
    """For each mistake a repository names (`[[skills.traps]]`), how often its merged changes
    made it when their session had loaded the skill that names it, and when it had not.

    Each change to a trap's paths is judged as `skill-usage-triggers` judges it: `loaded`,
    `missed` or `unknown` with the reason. The trap's check says whether the change made the
    mistake. Per trap: `changes`, `exempt` (it also touched an `unless_paths` glob), each arm's
    `changes`, `hits` and `rate`, the unknown changes, `delta` (the missed arm's rate less the
    loaded arm's, once each arm has twenty judged changes; null before) and `examples`, the
    changes that made the mistake, newest first. Only what reached the default branch is seen.

    Args:
        days: Length of the window in days.
        repo: The repository's checkout; the one holding the working directory when left out.
    """
    return await run_blocking(_skill_usage_effect_sync, days, repo)


def _shallow(root: Path) -> bool:
    try:
        return git_out(root, "rev-parse", "--is-shallow-repository").strip() == "true"
    except GitError:
        return False


def _skill_usage_effect_sync(days: int, repo: str | None) -> CommandResult[dict]:
    root = checkout_root(days, repo)
    if not isinstance(root, Path):
        return root
    try:
        traps = traps_of(root)
    except Exception as exc:  # noqa: BLE001 - any way the configuration fails to load
        return config_refused(root, exc)
    if not traps:
        return _fail(
            "NO_TRAPS",
            f"{root.name} names no mistake for a skill to prevent",
            'Declare one in its botcore.toml: [[skills.traps]] with id, skill = "<name>", '
            'paths = ["<glob>", ...] and added_pattern or commit_pattern',
        )
    judging = prepare_judging(root, days)
    if not isinstance(judging, Judging):
        return judging
    try:
        history = read_history(judging, traps)
    except GitError as exc:
        return _fail(
            "GIT_FAILED",
            f"git could not read the changes merged in {root}: {exc}",
            "Check that the checkout's default branch is fetched and readable, and run it again",
        )
    rows = [_row(trap, *_tally(judging, _Check.of(trap), history)) for trap in traps]
    warnings = judging.warnings()
    for row in rows:
        warnings.extend(_row_warnings(row, judging))
    if history.long_lines:
        warnings.append(
            f"{history.long_lines} added lines longer than {MAX_LINE:,} characters were not "
            "checked: a pattern is not run over a minified file's one line"
        )
    if _shallow(root):
        warnings.append(
            "The checkout is shallow: its oldest commit reads as adding every file it holds. "
            "Fetch the whole history (git fetch --unshallow) for a true count"
        )
    frame = judging.frame()
    judged = sum(row["loaded"]["hits"] + row["missed"]["hits"] for row in rows)
    unknown = sum(row["unknown"]["hits"] for row in rows)
    return success(
        {
            "project": frame["project"],
            "window": frame["window"],
            "merged": frame["merged"],
            "traps": rows,
            "record": frame["record"],
            "warnings": warnings,
        },
        reasoning=f"Across {len(rows)} traps, {judged} judged changes and {unknown} that cannot "
        "be judged made a trap's mistake (a change counts once for each trap it touches); "
        "only what reached the default branch is seen, so a mistake caught before the merge "
        "is not counted",
    )
