"""The gate outcome record: where it lives, its lines, and every machine's read as one.

A repository's record is `record.jsonl` in a folder of its own under botcore's state folder
(`<state>/<owner>/<name>/`), so two repositories are never mixed. Lines are appended; each has
an `id`, the version of the rules that made it (`v`) and when it was written (`at`). A fact
learned later is a newer line for the same id, and a reader keeps the newest. Only the fold
(fold.py) rewrites the record, to put the runs of days older than 180 days in a few lines.
`state.json` beside it says which spans of time were listed and how the last collection ended.

Five kinds of line, and the fold's two:

- `run`: one attempt of a workflow run, as the run list or the attempt says: the workflow's
  file and name, the event, the attempt, the revision tested and its base, the pull request's
  number, the times and how it ended. Its id is `run:<run id>:<attempt>`, GitHub's own, so two
  machines that collect one attempt keep it once.
- `shape`: the names of a workflow's jobs and their steps, once for each version of them. Its
  id is `shape:<digest of the names>`.
- `steps`: for one attempt, the seconds of each job and step, in its shape's order, and, for
  an attempt that did not pass or where a job or step did not succeed (one skipped included),
  each one's conclusion. `groups` gives, for each job with a hook group step, its place in the
  shape and GitHub's id for it, so its log can be read later. `unreadable` marks an attempt
  GitHub no longer has.
- `group`: for one attempt, what the hook runner's closing summary said in each hook group step
  whose log was read: each command's name, how it ended and its seconds. A command's name is
  kept only when the group has it at the default branch's tip, so no text of the log is kept;
  a summary that could not be read says why, from a fixed list.
- `folded-workflow` and `folded-check`: a folded day's runs, one line for each workflow and
  event and one for each check and event, with the counts and seconds the reports give
  (fold.py). Their ids name the day, so a reader keeps one for each whichever machine folded.

- `commit`: one fix commit or revert on the default branch (the `main` source, main.py): its
  revision, when it landed, its type, the pull request its subject ends with, how many files
  it changes, the units that hold them, the test paths among them, the issues its message
  closes, its `Found-by:` lines, the newest date of the lines it replaces and, once GitHub is
  read, the issues its pull request closes and each issue's state and labels. Its id is
  `commit:<revision>`. Its `v` is the main source's rules (`MAIN_RULES`).

Nothing else is kept: no log, no output, no title, no branch name, no file contents, no
commit subject, message or diff.

A machine that names a shared folder (the one skill usage uses, `skill_usage_shared`) also
writes its record to `<shared>/<machine>/gate-outcome/<owner>/<name>/`, and a reader reads
every machine's there. Botcore does not sync the folder.
"""

from __future__ import annotations

import errno
import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

from botcore.commands.disk.steps import doing
from botcore.commands.skill_usage.store import Local

STATE_ENV = "BOTCORE_GATE_OUTCOME_STATE"
# The version of the rules lines are made by. 2: a passed attempt keeps its conclusions where
# a job or step did not succeed, so a step that was skipped is told from one that passed
RULES = 2
RECORD_FILE = "record.jsonl"
STATE_FILE = "state.json"
LOCK_FILE = "collect.lock"
SHARED_FOLDER = "gate-outcome"  # inside a machine's folder in the shared one
KINDS = ("run", "shape", "steps", "group", "commit")
FOLDED = ("folded-workflow", "folded-check")  # the fold's lines (fold.py)
MAIN_RULES = 2  # the version of the rules a commit line is made by (2: records excluded)
COMMIT_TYPES = ("fix", "revert")
# How a `Found-by:` line says a bug was found, and its class: the plan's lists
CHANNELS = ("review", "check", "daily", "use", "sweep", "unknown")
CLASSES = ("logic", "contract", "parity", "claim", "security", "concurrency", "interface", "other")
# How reading the age of the last edit of the lines a fix replaces ended: read, or why not
LAST_EDIT = ("read", "no-lines", "too-many-files", "no-parent", "unreadable")
ISSUE_STATES = ("open", "closed")
MAX_TEST_PATHS = 100  # test paths a commit line names; `tests` counts them all
# How reading a group step's summary ended: read, or why not
SUMMARY = ("read", "no-summary", "mismatch", "log-gone", "unreadable")
COMMAND_ENDS = ("passed", "failed")
COMMAND = re.compile(r"[A-Za-z0-9][A-Za-z0-9 :_.@+-]{0,99}")  # a command name the record keeps
_PART = re.compile(r"[a-z0-9_][a-z0-9._-]{0,99}")
_SHA = re.compile(r"[0-9a-f]{40}")
_NAME_MAX = 300  # longer than any workflow, job or step name GitHub allows
# The names Windows keeps for devices, which no folder can have
_DEVICES = {
    "con",
    "prn",
    "aux",
    "nul",
    *(f"{port}{n}" for port in ("com", "lpt") for n in range(10)),
}


def now() -> datetime:
    """The time, from one place, so a scenario harness can set it."""
    return datetime.now(UTC)


def state_dir() -> Path:
    """Where every repository's record lives; BOTCORE_GATE_OUTCOME_STATE overrides it."""
    override = os.environ.get(STATE_ENV)
    if override:
        return Path(override)
    home = Path.home()
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or home / "AppData" / "Local")
    else:
        base = Path(os.environ.get("XDG_STATE_HOME") or home / ".local" / "state")
    return base / "botcore" / "gate-outcome"


def repo_parts(repo: str) -> tuple[str, str] | None:
    """`owner/name` as two folder names, lower case (GitHub does not tell them apart), or None
    when either cannot name a folder on every system."""
    owner, _, name = repo.lower().partition("/")
    for part in (owner, name):
        if not _PART.fullmatch(part) or part.endswith(".") or part.split(".")[0] in _DEVICES:
            return None
    return owner, name


def repo_folder(base: Path, repo: str) -> Path:
    parts = repo_parts(repo)
    if parts is None:
        raise ValueError(f"{repo!r} cannot name a folder")
    return base.joinpath(*parts)


def stamp(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def parse_time(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def day_of(value: object) -> str | None:
    """The UTC day (`YYYY-MM-DD`) a time falls in."""
    moment = parse_time(value)
    return moment.astimezone(UTC).date().isoformat() if moment is not None else None


def _name(value: object) -> bool:
    return isinstance(value, str) and 0 < len(value) <= _NAME_MAX


def _opt(value: object, check) -> bool:  # noqa: ANN001 - a predicate
    return value is None or check(value)


def _count(value: object) -> bool:
    return type(value) is int and value >= 0


def _seconds(value: object) -> bool:
    return value is None or _count(value)


def _conclusion(value: object) -> bool:
    return value is None or (isinstance(value, str) and len(value) <= 40)  # noqa: PLR2004


def _nested(value: object, leaf, length: int | None = None) -> bool:  # noqa: ANN001
    """`[[job, [step, ...]], ...]` with every leaf passing `leaf`."""
    if not isinstance(value, list) or (length is not None and len(value) != length):
        return False
    for job in value:
        if not (isinstance(job, list) and len(job) == 2 and isinstance(job[1], list)):  # noqa: PLR2004
            return False
        if not leaf(job[0]) or not all(leaf(step) for step in job[1]):
            return False
    return True


def shape_digest(workflow: str, jobs: list) -> str:
    text = json.dumps([workflow, jobs], separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]


def checked(line: object) -> dict | None:  # noqa: C901, PLR0911, PLR0912 - one check per field
    """A line as this botcore can use it: one of the five kinds with every field of the type
    it should have, and nothing else (`checked` drops unknown fields, so a hand or another
    program cannot put text into what is shared). None for anything else."""
    if isinstance(line, dict) and line.get("kind") in FOLDED:
        from botcore.commands.gate_outcome.fold import checked_folded

        return checked_folded(line)
    if not isinstance(line, dict) or line.get("kind") not in KINDS:
        return None
    kind, identifier = line["kind"], line.get("id")
    if not isinstance(identifier, str) or not _count(line.get("v")):
        return None
    if parse_time(line.get("at")) is None:
        return None
    base = {"id": identifier, "kind": kind, "v": line["v"], "at": line["at"]}
    if kind == "shape":
        jobs, workflow = line.get("jobs"), line.get("workflow")
        if not isinstance(workflow, str) or not _name(workflow) or not _nested(jobs, _name):
            return None
        assert isinstance(jobs, list)
        if identifier != f"shape:{shape_digest(workflow, jobs)}":
            return None
        return {**base, "workflow": workflow, "jobs": jobs}
    if kind == "commit":
        return _commit(line, base)
    run, attempt = line.get("run"), line.get("attempt")
    if not _count(run) or not _count(attempt) or identifier != f"{kind}:{run}:{attempt}":
        return None
    if kind == "group":
        entries = line.get("steps")
        if not isinstance(entries, list) or not all(_group_entry(e) for e in entries):
            return None
        return {**base, "run": run, "attempt": attempt, "steps": entries}
    if kind == "steps":
        shape, seconds, ends = line.get("shape"), line.get("seconds"), line.get("conclusions")
        if not _opt(shape, lambda s: isinstance(s, str) and len(s) == 24):  # noqa: PLR2004
            return None
        if (
            not isinstance(seconds, list)
            or not _nested(seconds, _seconds)
            or not _opt(ends, lambda e: _nested(e, _conclusion, len(seconds)))
        ):
            return None
        groups = line.get("groups")
        if not _opt(groups, lambda g: isinstance(g, list) and all(_pair(p) for p in g)):
            return None
        unreadable = line.get("unreadable") is True
        out = {**base, "run": run, "attempt": attempt, "shape": shape, "seconds": seconds}
        if ends is not None:
            out["conclusions"] = ends
        if groups:
            out["groups"] = groups
        if unreadable:
            out["unreadable"] = True
        return out
    facts = {key: line.get(key) for key in RUN_FACTS}
    if not _name(facts["workflow"]) or not _name(facts["name"]) or not _name(facts["event"]):
        return None
    if not _conclusion(facts["status"]) or not _conclusion(facts["conclusion"]):
        return None
    if not _opt(facts["head"], _SHA.fullmatch) or not _opt(facts["base"], _SHA.fullmatch):
        return None
    if not _opt(facts["pr"], _count) or parse_time(facts["created"]) is None:
        return None
    if not _opt(facts["started"], parse_time) or not _opt(facts["updated"], parse_time):
        return None
    out = {**base, "run": run, "attempt": attempt, **facts}
    if line.get("unreadable") is True:  # read once, and GitHub no longer has it
        out["unreadable"] = True
    return out


_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def path_ok(value: object) -> bool:
    """A path in the repository, or a label's name, the record can hold: text, no control
    character."""
    return isinstance(value, str) and 0 < len(value) <= 500 and not _CONTROL.search(value)  # noqa: PLR2004


_path = path_ok


def _numbers(value: object) -> bool:
    return isinstance(value, list) and all(_count(n) for n in value)


def _found_by(value: object) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 3  # noqa: PLR2004
        and value[0] in CHANNELS
        and value[1] in CLASSES
        and _opt(value[2], _count)
    )


def _issue(value: object) -> bool:
    """`[number, state, [label, ...]]`."""
    return (
        isinstance(value, list)
        and len(value) == 3  # noqa: PLR2004
        and _count(value[0])
        and value[1] in ISSUE_STATES
        and isinstance(value[2], list)
        and all(_path(label) and len(label) <= 100 for label in value[2])  # noqa: PLR2004
    )


def _commit(line: dict, base: dict) -> dict | None:  # noqa: C901, PLR0911 - one check per field
    sha = line.get("sha")
    if not isinstance(sha, str) or not _SHA.fullmatch(sha) or base["id"] != f"commit:{sha}":
        return None
    if parse_time(line.get("landed")) is None or line.get("type") not in COMMIT_TYPES:
        return None
    if not _opt(line.get("pr"), _count) or not _count(line.get("files")):
        return None
    units, tests = line.get("units"), line.get("test_paths")
    if not (isinstance(units, list) and all(_path(u) for u in units)):
        return None
    if not (isinstance(tests, list) and len(tests) <= MAX_TEST_PATHS and all(map(_path, tests))):
        return None
    if not _count(line.get("tests")) or not _numbers(line.get("closes")):
        return None
    found_by = line.get("found_by")
    if not (isinstance(found_by, list) and all(_found_by(f) for f in found_by)):
        return None
    if not _count(line.get("found_by_unread")) or line.get("last_edit_status") not in LAST_EDIT:
        return None
    if not _opt(line.get("last_edit"), parse_time):
        return None
    pr_closes, issues = line.get("pr_closes"), line.get("issues")
    if not _opt(pr_closes, _numbers):
        return None
    if not _opt(issues, lambda i: isinstance(i, list) and all(_issue(x) for x in i)):
        return None
    if (pr_closes is None) != (issues is None):  # GitHub was read for both, or for neither
        return None
    records_only = line.get("records_only", False)
    if type(records_only) is not bool:
        return None
    keys = ("sha", "landed", "type", "pr", "files", "units", "test_paths", "tests", "closes",
            "found_by", "found_by_unread", "last_edit", "last_edit_status", "pr_closes",
            "issues")  # fmt: skip
    return {**base, **{key: line.get(key) for key in keys}, "records_only": records_only}


def _pair(value: object) -> bool:
    return isinstance(value, list) and len(value) == 2 and all(_count(v) for v in value)  # noqa: PLR2004


def _group_entry(value: object) -> bool:
    """`[job, step, how the read ended, commands not kept, [[command, end, seconds], ...]]`."""
    if not (isinstance(value, list) and len(value) == 5):  # noqa: PLR2004
        return False
    job, step, status, dropped, commands = value
    if not (_name(job) and _name(step) and status in SUMMARY and _count(dropped)):
        return False
    if not isinstance(commands, list):
        return False
    for command in commands:
        if not (isinstance(command, list) and len(command) == 3):  # noqa: PLR2004
            return False
        name, end, seconds = command
        if not (isinstance(name, str) and COMMAND.fullmatch(name) and end in COMMAND_ENDS):
            return False
        if not (seconds is None or (type(seconds) in (int, float) and 0 <= seconds < 10**6)):  # noqa: PLR2004
            return False
    return True


RUN_FACTS = (
    "workflow", "name", "event", "status", "conclusion", "head", "base", "pr", "created",
    "started", "updated",
)  # fmt: skip


def parse_lines(data: bytes) -> tuple[list[dict], int]:
    """The lines of a record file that can be used, in order, and how many could not."""
    lines: list[dict] = []
    unreadable = 0
    for text in data.decode("utf-8", errors="replace").splitlines():
        if not text.strip():
            continue
        try:
            line = checked(json.loads(text))
        except ValueError:
            line = None
        if line is None:
            unreadable += 1
        else:
            lines.append(line)
    return lines, unreadable


def _serialize(line: dict) -> bytes:
    return (json.dumps(line, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def append_lines(folder: Path, lines: list[dict]) -> None:
    """Add lines to a record. A final line an interrupted write left unfinished is ended
    first, so it is one unreadable line and not the start of the next one."""
    if not lines:
        return
    doing("writing the gate outcome record in", folder)
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / RECORD_FILE).open("a+b") as handle:
        handle.seek(0, os.SEEK_END)
        if handle.tell():
            handle.seek(handle.tell() - 1)
            if handle.read(1) != b"\n":
                handle.write(b"\n")
        handle.write(b"".join(_serialize(line) for line in lines))
        handle.flush()
        os.fsync(handle.fileno())


def _replace(path: Path, data: bytes) -> None:
    """Write a file in one step, so a reader never sees half of it. Bytes, so that Windows
    writes the same line ends as every other system."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def load_state(folder: Path) -> dict:
    try:
        data = json.loads((folder / STATE_FILE).read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def save_state(folder: Path, state: dict) -> None:
    doing("writing the gate outcome record in", folder)
    _replace(folder / STATE_FILE, (json.dumps(state, indent=1, sort_keys=True) + "\n").encode())


def _rank(line: dict, machine: str) -> tuple:
    """Which of two lines for one id wins: the newer rules, then the one that knows the
    attempt's steps (a line that could not read them never displaces one that did), then
    for a run what GitHub last updated, then the later written, then the machine by name."""
    if line["kind"] == "commit":  # one that read GitHub outranks one that could not
        known = line["issues"] is not None
    elif line["kind"] == "steps":
        known = not line.get("unreadable") or bool(line["seconds"])
    elif line["kind"] == "group":  # one that read a summary outranks one that could not
        known = sum(entry[2] == "read" for entry in line["steps"])  # type: ignore[assignment]
    else:
        known = line.get("status") != "unreadable"
    updated = line.get("updated") or "" if line["kind"] == "run" else ""
    return (line["v"], known, updated, line["at"], machine)


@dataclass
class Record:
    """One repository's record from this machine and every machine in the shared folder."""

    runs: dict[str, dict] = field(default_factory=dict)  # id -> newest run line
    steps: dict[str, dict] = field(default_factory=dict)  # id -> newest steps line
    groups: dict[str, dict] = field(default_factory=dict)  # id -> newest group line
    commits: dict[str, dict] = field(default_factory=dict)  # id -> newest commit line
    shapes: dict[str, dict] = field(default_factory=dict)  # digest -> shape line
    folds: dict[str, dict] = field(default_factory=dict)  # id -> newest folded line
    states: dict[str, dict] = field(default_factory=dict)  # machine -> its state
    unreadable: dict[str, int] = field(default_factory=dict)  # machine -> lines not read
    partial: list[str] = field(default_factory=list)  # machines whose copy is not whole
    missing: str | None = None  # why the shared folder was not read
    own_lines: int = 0
    own_days: set[str] = field(default_factory=set)  # the days of this machine's run lines
    _ranks: dict[str, tuple] = field(default_factory=dict)

    def add(self, line: dict, machine: str) -> None:
        rank = _rank(line, machine)
        if line["kind"] == "shape":
            self.shapes.setdefault(line["id"].removeprefix("shape:"), line)
            return
        held = self._ranks.get(line["id"])
        if held is None or rank > held:
            self._ranks[line["id"]] = rank
            kept = self.folds if line["kind"] in FOLDED else {
                "run": self.runs, "steps": self.steps, "group": self.groups,
                "commit": self.commits,
            }[line["kind"]]  # fmt: skip
            kept[line["id"]] = line

    def folded_days(self) -> set[str]:
        """The days (`YYYY-MM-DD`) any machine has folded."""
        return {line["day"] for line in self.folds.values()}

    def folded_spans(self) -> list[tuple[datetime, datetime]]:
        """Each folded day as a span of time, to count as listed."""
        spans = []
        for day in sorted(self.folded_days()):
            begun = parse_time(f"{day}T00:00:00Z")
            if begun is not None:
                spans.append((begun, begun + timedelta(days=1)))
        return spans

    def settle(self) -> None:
        """Leave out the runs of a folded day, with their steps and summaries: a fold holds
        them, and a machine's copy that is not folded yet would count them twice."""
        days = self.folded_days()
        if not days:
            return
        latest: dict[int, dict] = {}
        for line in self.runs.values():
            held = latest.get(line["run"])
            if held is None or line["attempt"] > held["attempt"]:
                latest[line["run"]] = line
        gone = {run for run, line in latest.items() if day_of(line["created"]) in days}
        for kept in (self.runs, self.steps, self.groups):
            for identifier in [i for i, line in kept.items() if line["run"] in gone]:
                del kept[identifier]

    @property
    def empty(self) -> bool:
        """Whether nothing was collected: no line, and no state that says a span was listed.
        A collection that stopped before it read anything leaves a state, and nothing else."""
        return not (self.runs or self.steps or self.commits or self.folds) and not any(
            (isinstance(state.get("lists"), dict) and state["lists"])
            or (isinstance(state.get("main"), dict) and state["main"].get("days"))
            for state in self.states.values()
        )


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _copy(folder: Path) -> tuple[dict, list[dict], int] | None:
    """A machine's copy in the shared folder when it is whole: the state names the record's
    digest, and the record has it. None otherwise (a sync part way through)."""
    state = load_state(folder)
    try:
        data = (folder / RECORD_FILE).read_bytes()
    except FileNotFoundError:
        return None
    if state.get("record") != _digest(data):
        return None
    lines, unreadable = parse_lines(data)
    return state, lines, unreadable


def load_record(base: Path, repo: str, here: Local) -> Record:
    """One repository's record: this machine's and each other machine's copy in the shared
    folder, each id once, the same whichever machine reads. Raises OSError for this
    machine's own record."""
    folder = repo_folder(base, repo)
    record = Record()
    doing("reading the gate outcome record in", folder)
    for there in (folder, *folder.parents):  # the nearest part of the path that exists
        if there.exists():
            if not there.is_dir():
                # Windows reads a file under a file as missing: that would pass for no record
                raise NotADirectoryError(errno.ENOTDIR, "not a folder", str(there))
            break
    try:
        lines, unreadable = parse_lines((folder / RECORD_FILE).read_bytes())
    except FileNotFoundError:
        lines, unreadable = [], 0
    state = load_state(folder)
    if lines or state:
        record.states[here.machine] = state
    record.own_lines = len(lines)
    record.own_days = {day for line in lines if line["kind"] == "run"
                       and (day := day_of(line["created"])) is not None}  # fmt: skip
    if unreadable:
        record.unreadable[here.machine] = unreadable
    for line in lines:
        record.add(line, here.machine)
    if here.shared is None:
        record.settle()
        return record
    doing("reading the shared folder", here.shared)
    try:
        machines = sorted(here.shared.iterdir())
    except OSError:
        record.missing = f"{here.shared} is not a folder this machine can see"
        record.settle()
        return record
    for machine_folder in machines:
        machine = machine_folder.name.lower()
        if machine == here.machine or machine_folder.name.startswith("."):
            continue
        theirs = machine_folder / SHARED_FOLDER
        try:
            theirs = repo_folder(theirs, repo)
            if machine_folder.is_symlink() or not theirs.is_dir():
                continue  # no gate outcome record of this repository there
            doing("reading the shared folder", theirs)
            copy = _copy(theirs)
        except (OSError, ValueError):
            copy = None
        if copy is None or machine in record.states:  # or two folders for one name
            record.partial.append(machine_folder.name)
            continue
        their_state, their_lines, their_unreadable = copy
        record.states[machine] = their_state
        if their_unreadable:
            record.unreadable[machine] = their_unreadable
        for line in their_lines:
            record.add(line, machine)
    record.settle()
    return record


class SharedUnavailable(OSError):
    """The shared folder cannot take this machine's record."""


SHARED_STATE = (
    "version", "machine", "record_id", "repo", "collected_at", "lists", "ci", "main",
)  # fmt: skip


def publish(folder: Path, shared: Path, machine: str, repo: str) -> bool:
    """Write this machine's record of a repository to its folder in the shared one: the lines
    that could be read, each id's newest, and the state, which goes last and names the
    record's digest. Whether anything was written: a file that did not change is left alone.
    The shared folder itself is never created, and a folder that holds another record of
    this machine's name is not written over."""
    doing("writing the shared folder", shared)
    if not shared.is_dir():
        raise SharedUnavailable(f"{shared} is not a folder this machine can see")
    target = repo_folder(shared / machine / SHARED_FOLDER, repo)
    state = load_state(folder)
    try:
        data = (folder / RECORD_FILE).read_bytes()
    except FileNotFoundError:
        data = b""
    lines, _ = parse_lines(data)
    newest = Record()
    for line in lines:
        newest.add(line, machine)
    kept = [
        *newest.shapes.values(), *newest.runs.values(), *newest.steps.values(),
        *newest.groups.values(), *newest.commits.values(), *newest.folds.values(),
    ]  # fmt: skip
    record = b"".join(_serialize(line) for line in sorted(kept, key=lambda line: line["id"]))
    theirs = load_state(target).get("record_id")
    if theirs and theirs != state.get("record_id"):
        raise SharedUnavailable(
            f"{target} holds the record of another machine named {machine}: give this "
            "machine a name of its own (skill_usage_machine), or remove that folder if it is "
            "this machine's old record"
        )
    shared_state = {key: state[key] for key in SHARED_STATE if key in state}
    shared_state["record"] = _digest(record)
    files = {
        RECORD_FILE: record,
        STATE_FILE: (json.dumps(shared_state, indent=1, sort_keys=True) + "\n").encode(),
    }
    written = False
    for name, content in files.items():  # the state last: it names the record's digest
        destination = target / name
        try:
            if destination.read_bytes() == content:
                continue
        except FileNotFoundError:
            pass
        doing("writing the shared folder", shared)
        _replace(destination, content)
        written = True
    return written
