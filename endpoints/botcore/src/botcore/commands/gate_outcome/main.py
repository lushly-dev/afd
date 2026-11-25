"""The `main` source of `gate-outcome-collect`: every fix commit and revert on the default
branch, read once into the record.

The default branch's tip is read through git (fetched first), never the caller's working tree.
A commit is a fix commit when its subject is of type `fix` (`fix:`, `fix(scope):`, either with
`!`), and a revert when its subject begins `Revert "`; it is in a window by the time it landed
(its committer time). Merge commits are not read. For each one the record keeps its revision,
when it landed, its type, the number its subject ends with (`(#123)`, its pull request), how
many files it changes, the units that hold them and the test paths among them (units.py), the
issues its message closes with GitHub's closing words, its `Found-by:` lines, and the newest
date of the lines it replaces (blamed at its parent, `last_edit`). No subject, message or diff
text is kept. The number of commits that landed each day is kept in the state, not as lines.

GitHub is read next, through its GraphQL API, many numbers to a request: the issues each pull
request closes and the state and labels of every issue a commit closes. A commit whose subject
ends with no number gets the pull request GitHub says it is the merge commit of, if any. Without
GitHub the commits are still read, and the source is `partly`, with why.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from botcore.commands.disk.git import GitError, git_out
from botcore.commands.gate_outcome import github
from botcore.commands.gate_outcome.checks import DEFAULT_REFS, OWN_REF, default_ref, toplevel
from botcore.commands.gate_outcome.github import GitHub, Stop
from botcore.commands.gate_outcome.record import (
    CHANNELS,
    CLASSES,
    MAIN_RULES,
    MAX_TEST_PATHS,
    Record,
    checked,
    parse_time,
    path_ok,
    stamp,
)
from botcore.commands.gate_outcome.units import (
    FileChange,
    Units,
    in_spans,
    named_test,
    parse_diff,
    read_units,
    rust_test_lines,
)

GIT_SECONDS = 120.0
FETCH_SECONDS = 120.0
MAX_BLAME_FILES = 20  # a fix that replaces lines in more files is not blamed: `too-many-files`
BATCH = 40  # numbers asked for in one GraphQL request
COMMIT_WEIGHT = 2  # a commit's pull requests count as two numbers: GitHub limits a query's nodes
FIX = re.compile(r"^fix(?:\([^)\n]*\))?!?:")
REVERT = re.compile(r'^Revert "')
ENDING_NUMBER = re.compile(r"\(#(\d+)\)\s*$")
# GitHub's closing words, then the issue: #12, owner/name#12 or its address
CLOSING = re.compile(
    r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?[ \t]+"
    r"(?:([\w.-]+/[\w.-]+)#(\d+)|#(\d+)|https://github\.com/([\w.-]+/[\w.-]+)/issues/(\d+))",
    re.IGNORECASE,
)
FOUND_BY = re.compile(r"^found-by:[ \t]*(.*?)[ \t]*$", re.IGNORECASE | re.MULTILINE)
_ISSUE_TOKEN = re.compile(r"^#(\d+)$")


def fetch(root: Path, branch: str) -> str | None:
    """Fetch the default branch from origin into its remote-tracking ref; why it could not be,
    or None. A test or a scenario harness replaces this one function."""
    try:
        git_out(
            root, "fetch", "--quiet", "--no-tags", "origin",
            f"+refs/heads/{branch}:refs/remotes/origin/{branch}", timeout=FETCH_SECONDS,
        )  # fmt: skip
    except GitError as exc:
        return str(exc)
    return None


def _git(root: Path, *args: str) -> str:
    return git_out(root, "-c", "core.quotePath=false", *args, timeout=GIT_SECONDS)


def _remote_branch(root: Path, ref: str) -> str | None:
    """The branch name on `origin` to fetch for `ref` (including when `default_ref` returned
    the hourly job's `OWN_REF` ahead of `refs/remotes/origin/*`)."""
    candidates = DEFAULT_REFS if ref == OWN_REF else (ref,)
    for candidate in candidates:
        if candidate == "refs/remotes/origin/HEAD":
            try:
                target = git_out(root, "symbolic-ref", "--quiet", candidate, timeout=GIT_SECONDS)
            except GitError:
                continue
            branch = target.strip().removeprefix("refs/remotes/origin/")
            if branch:
                return branch
        elif candidate.startswith("refs/remotes/origin/"):
            try:
                if git_out(
                    root, "rev-parse", "--verify", "--quiet", f"{candidate}^{{commit}}",
                    ok_codes=(0, 1), timeout=GIT_SECONDS,
                ).strip():  # fmt: skip
                    return candidate.removeprefix("refs/remotes/origin/")
            except GitError:
                continue
    return None


def tip(
    root: Path, *, do_fetch: bool = True
) -> tuple[str, str, str | None] | tuple[None, None, str]:
    """The default branch's ref and tip after fetching it (when `do_fetch` is true), and why the
    fetch failed if it did; or (None, None, why) when there is no default branch."""
    found = default_ref(root)
    if found is None:
        return None, None, "the checkout has no default branch (origin's HEAD, origin/main or main)"
    branch = _remote_branch(root, found[0]) if do_fetch else None
    why = fetch(root, branch) if branch else None
    if branch:
        found = default_ref(root) or found
    return found[0], found[1], why


def units_at(root: Path, commit: str) -> Units:
    try:
        listed = _git(root, "ls-tree", "-r", "-z", "--full-tree", "--name-only", commit)
    except GitError as exc:
        return Units(source="none", problem=f"the tree at the tip could not be listed: {exc}")

    def show(path: str) -> str | None:
        try:
            return _git(root, "show", f"{commit}:{path}")
        except GitError:
            return None

    return read_units([p for p in listed.split("\0") if p], show)


@dataclass
class Landed:
    sha: str
    landed: datetime
    parent: str | None
    type: str | None  # fix, revert, or None for any other commit
    pr: int | None


def commit_type(subject: str) -> str | None:
    if FIX.match(subject):
        return "fix"
    if REVERT.match(subject):
        return "revert"
    return None


def landed_since(root: Path, commit: str, since: datetime) -> list[Landed]:
    """Every commit but merges reachable from `commit` that landed from `since` on (a day's
    margin is listed and dropped, as git stops its walk by committer time)."""
    margin = since - timedelta(days=1)
    text = _git(
        root, "log", "-z", "--no-merges", f"--since={margin.isoformat()}",
        "--format=%H%x1f%ct%x1f%P%x1f%s", commit,
    )  # fmt: skip
    found = []
    for entry in text.split("\0"):
        parts = entry.split("\x1f", 3)
        if len(parts) != 4:  # noqa: PLR2004
            continue
        sha, seconds, parents, subject = parts
        moment = datetime.fromtimestamp(int(seconds), UTC)
        if moment < since:
            continue
        number = ENDING_NUMBER.search(subject)
        parent = parents.split()[0] if parents.split() else None
        pr = int(number.group(1)) if number else None
        found.append(Landed(sha.strip(), moment, parent, commit_type(subject), pr))
    return found


# ── One commit, from git ────────────────────────────────────────────────────


def closes(message: str, repo: str) -> list[int]:
    """The issues of this repository a message closes with GitHub's closing words."""
    found: set[int] = set()
    for match in CLOSING.finditer(message):
        other = match.group(1) or match.group(4)
        if other is not None and other.lower() != repo.lower():
            continue
        found.add(int(match.group(2) or match.group(3) or match.group(5)))
    return sorted(found)


def found_by(message: str) -> tuple[list[list], int]:
    """A message's `Found-by: <channel> <class> [#issue]` lines, each once, and how many
    could not be read (a word not on the plan's lists)."""
    lines: list[list] = []
    unread = 0
    for match in FOUND_BY.finditer(message):
        words = match.group(1).split()
        issue = _ISSUE_TOKEN.match(words[2]) if len(words) == 3 else None  # noqa: PLR2004
        if (
            len(words) not in (2, 3)
            or words[0].lower() not in CHANNELS
            or words[1].lower() not in CLASSES
            or (len(words) == 3 and issue is None)  # noqa: PLR2004
        ):
            unread += 1
            continue
        line = [words[0].lower(), words[1].lower(), int(issue.group(1)) if issue else None]
        if line not in lines:
            lines.append(line)
    return lines, unread


def _show(root: Path, revision: str, path: str) -> str | None:
    try:
        return _git(root, "show", f"{revision}:{path}")
    except GitError:
        return None


def rust_test(root: Path, landed: Landed, change: FileChange) -> bool:
    """Whether a Rust file's changed lines sit inside a test module, on either side."""
    if change.added and change.new:
        text = _show(root, landed.sha, change.new)
        if text is not None and in_spans(change.added, rust_test_lines(text)):
            return True
    if change.removed and change.old and landed.parent:
        text = _show(root, landed.parent, change.old)
        if text is not None and in_spans(change.removed, rust_test_lines(text)):
            return True
    return False


def _ranges(lines: list[int]) -> list[tuple[int, int]]:
    spans: list[list[int]] = []
    for line in sorted(set(lines)):
        if spans and line == spans[-1][1] + 1:
            spans[-1][1] = line
        else:
            spans.append([line, line])
    return [(first, last) for first, last in spans]


def last_edit(root: Path, landed: Landed, changes: list[FileChange]) -> tuple[str, str | None]:
    """How blaming the lines a fix replaces ended, and the newest time any of them landed."""
    replaced = [change for change in changes if change.old and change.removed]
    if not replaced:
        return "no-lines", None
    if landed.parent is None:
        return "no-parent", None
    if len(replaced) > MAX_BLAME_FILES:
        return "too-many-files", None
    newest: int | None = None
    for change in replaced:
        assert change.old is not None
        spans = [
            arg for first, last in _ranges(change.removed) for arg in ("-L", f"{first},{last}")
        ]
        try:
            text = _git(root, "blame", "--porcelain", *spans, landed.parent, "--", change.old)
        except GitError:
            return "unreadable", None
        for line in text.split("\n"):
            if line.startswith("committer-time "):
                seconds = int(line.split()[1])
                newest = seconds if newest is None else max(newest, seconds)
    if newest is None:
        return "unreadable", None
    return "read", stamp(datetime.fromtimestamp(newest, UTC))


def read_commit(root: Path, repo: str, landed: Landed, units: Units, at: str) -> dict | None:
    """A fix commit or revert as the record keeps it, from git: GitHub's fields are left
    unread (None)."""
    message = _git(root, "show", "-s", "--format=%B", landed.sha)
    files = [p for p in _git(root, "show", "-z", "--format=", "--name-only", "-M",
                             landed.sha).split("\0") if p.strip()]  # fmt: skip
    diff = _git(root, "show", "--format=", "-U0", "-M", "--no-color", "--no-ext-diff",
                "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/", landed.sha)  # fmt: skip
    changes = parse_diff(diff)
    by_path = {change.path: change for change in changes}
    tests = []
    for path in files:
        change = by_path.get(path)
        if named_test(path) or (
            path.endswith(".rs") and change is not None and rust_test(root, landed, change)
        ):
            tests.append(path)
    kept = [path for path in tests if path_ok(path)]  # a name the record cannot hold is counted
    _area, held = units.area(files)
    held = [unit for unit in held if path_ok(unit)]
    lines, unread = found_by(message)
    status, newest = last_edit(root, landed, changes)
    return checked({
        "id": f"commit:{landed.sha}", "kind": "commit", "v": MAIN_RULES, "at": at,
        "sha": landed.sha, "landed": stamp(landed.landed), "type": landed.type,
        "pr": landed.pr, "files": len(files), "units": held,
        "test_paths": kept[:MAX_TEST_PATHS], "tests": len(tests),
        "closes": closes(message, repo), "found_by": lines, "found_by_unread": unread,
        "last_edit": newest, "last_edit_status": status, "pr_closes": None, "issues": None,
    })  # fmt: skip


# ── GitHub ──────────────────────────────────────────────────────────────────

_LABELS = "labels(first: 50) { nodes { name } }"
_CLOSING_REFS = (
    "closingIssuesReferences(first: 50) { nodes { number state "
    f"repository {{ nameWithOwner }} {_LABELS} }} }}"
)
_NODE = (
    f"__typename ... on PullRequest {{ {_CLOSING_REFS} }} ... on Issue {{ number state {_LABELS} }}"
)
# A commit whose subject ends with no number: the pull requests GitHub ties it to
_COMMIT = (
    "... on Commit { associatedPullRequests(first: 2) { nodes { number mergeCommit { oid } "
    f"{_CLOSING_REFS} }} }} }}"
)


def query(repo: str, numbers: list[int], commits: list[str] | None = None) -> str:
    """One GraphQL query for `numbers`, each a pull request or an issue, answering under
    `n<number>`, and for `commits`, the pull requests each was merged by, under `c<sha>`."""
    owner, _, name = repo.partition("/")
    fields = [f"n{n}: issueOrPullRequest(number: {n}) {{ {_NODE} }}" for n in numbers]
    fields += [f'c{sha}: object(oid: "{sha}") {{ {_COMMIT} }}' for sha in commits or []]
    where = f"owner: {json.dumps(owner)}, name: {json.dumps(name)}"
    return f"query {{ repository({where}) {{ {' '.join(fields)} }} }}"


def _labels(node: dict) -> list[str]:
    found = (node.get("labels") or {}).get("nodes") if isinstance(node.get("labels"), dict) else []
    return [
        label["name"][:100]
        for label in found or []
        if isinstance(label, dict) and isinstance(label.get("name"), str) and label["name"]
    ]


def _issue(node: dict) -> list | None:
    state = str(node.get("state") or "").lower()
    number = node.get("number")
    if type(number) is not int or state not in ("open", "closed"):
        return None
    return [number, state, _labels(node)]


Failure = Stop | github.ServiceUnavailable | github.SourceUnreadable


def read_github(
    gh: GitHub, repo: str, lines: list[dict], at: str
) -> tuple[list[dict], Failure | None]:
    """The lines with GitHub's fields read, as many as the limits let (each batch is one
    request), and what stopped it, as `gh.graphql` raises it, if anything did."""
    done: list[dict] = []
    left = list(lines)
    try:
        while left:
            batch: list[dict] = []
            numbers: set[int] = set()
            commits: list[str] = []
            while left:
                wanted = {n for n in (left[0]["pr"], *left[0]["closes"]) if n is not None}
                orphan = [left[0]["sha"]] if left[0]["pr"] is None else []
                weight = COMMIT_WEIGHT * (len(commits) + len(orphan))
                if batch and len(numbers | wanted) + weight > BATCH:
                    break
                numbers |= wanted
                commits += orphan
                batch.append(left.pop(0))
            asked = numbers or commits
            data = gh.graphql(query(repo, sorted(numbers), commits)) if asked else {}
            held = data.get("repository") if asked else {}
            if not isinstance(held, dict):  # the account cannot see it, or it is gone
                raise github.SourceUnreadable(f"GitHub gave no repository {repo} in its answer")
            for line in batch:
                read = _with_github(line, held, repo, at)
                if read is not None:
                    done.append(read)
    except (Stop, github.ServiceUnavailable, github.SourceUnreadable) as exc:
        return done, exc
    return done, None


def _merged_by(node: object, sha: str) -> dict | None:
    """Of the pull requests GitHub ties a commit to, the one whose merge commit it is."""
    pulls = node.get("associatedPullRequests") if isinstance(node, dict) else None
    for pull in (pulls.get("nodes") if isinstance(pulls, dict) else None) or []:
        merge = pull.get("mergeCommit") if isinstance(pull, dict) else None
        if isinstance(merge, dict) and merge.get("oid") == sha and type(pull.get("number")) is int:
            return pull
    return None


def _with_github(line: dict, nodes: dict, repo: str, at: str) -> dict | None:
    """The line with GitHub's answer, or None where GitHub did not answer for its pull request
    or its commit: it stays unread, never read as closing nothing."""
    issues: dict[int, list] = {}
    pr_closes: list[int] = []
    pr = line["pr"]
    asked = f"n{pr}" if pr is not None else f"c{line['sha']}"
    if not isinstance(nodes.get(asked), dict):
        return None
    node = nodes.get(f"n{pr}") if pr is not None else None
    if pr is None:  # the subject names none: the pull request this commit merged, if any
        node = _merged_by(nodes.get(f"c{line['sha']}"), line["sha"])
        if node is not None:
            pr, node = node["number"], {**node, "__typename": "PullRequest"}
    if isinstance(node, dict) and node.get("__typename") == "PullRequest":
        refs = (node.get("closingIssuesReferences") or {}).get("nodes") or []
        for ref in refs:
            if not isinstance(ref, dict):
                continue
            where = (ref.get("repository") or {}).get("nameWithOwner")
            issue = _issue(ref)
            if issue is not None and (not where or str(where).lower() == repo.lower()):
                pr_closes.append(issue[0])
                issues[issue[0]] = issue
    for number in line["closes"]:
        node = nodes.get(f"n{number}")
        if isinstance(node, dict) and node.get("__typename") == "Issue":
            issue = _issue(node)
            if issue is not None:
                issues[number] = issue
    return checked({**line, "at": at, "pr": pr, "pr_closes": sorted(set(pr_closes)),
                    "issues": [issues[n] for n in sorted(issues)]})  # fmt: skip


# ── The source ──────────────────────────────────────────────────────────────


@dataclass
class MainRead:
    """What reading the `main` source found and wrote."""

    status: str  # read, partly or absent
    why: str | None
    found: int
    lines: list[dict]  # lines to write
    days: dict[str, dict]
    tip: str | None = None
    units: Units | None = None


def read_main(  # noqa: C901, PLR0912, PLR0913 - the source, start to end
    root: Path, repo: str, gh: GitHub, record: Record, start: datetime, now: datetime,
    stale, at: str,  # noqa: ANN001 - stale(line) -> whether a rebuild reads it again
    *, do_fetch: bool = True, fetch_error: str | None = None,
) -> MainRead:  # fmt: skip
    # A workspace can be a unit's own folder inside the checkout, and git blame takes a path
    # from the folder it runs in: every read below runs at the checkout's top.
    root = toplevel(root)
    ref, commit, why = tip(root, do_fetch=do_fetch)
    if ref is None or commit is None:
        return MainRead("absent", why, 0, [], {})
    if why is None and fetch_error is not None:
        why = fetch_error
    if why is not None:
        why = (f"git: the default branch could not be fetched ({why}); read {ref} as it was "
               "last fetched")  # fmt: skip
    try:
        landed = [c for c in landed_since(root, commit, start) if c.landed < now]
    except GitError as exc:
        return MainRead("absent", f"git: the default branch could not be read: {exc}", 0, [], {})
    units = units_at(root, commit)
    days: dict[str, dict] = {}
    day = start
    while day < now and why is None:  # a tip not fetched lists no day: it may lack commits
        until = min(day + timedelta(days=1), now)
        merged = sum(day <= c.landed < until for c in landed)
        days[day.date().isoformat()] = {"merged": merged, "until": stamp(until), "at": at}
        day += timedelta(days=1)
    picked = [c for c in landed if c.type is not None]
    lines: list[dict] = []
    wanted: list[dict] = []
    held_lines: list[dict] = []
    for found in picked:
        held = record.commits.get(f"commit:{found.sha}")
        if held is None or held["v"] < MAIN_RULES or stale(held):
            try:
                line = read_commit(root, repo, found, units, at)
            except GitError as exc:
                line, problem = None, str(exc)
            else:
                problem = "its line could not be made"
            if line is None:  # its day is not listed, so no report reads that day as whole
                why = why or f"git: commit {found.sha[:12]} could not be read: {problem}"
                days.pop(found.landed.date().isoformat(), None)
                continue
            lines.append(line)
            if line["issues"] is None:
                wanted.append(line)
        elif held["issues"] is None:
            wanted.append(held)
            held_lines.append(held)
    read, stopped = read_github(gh, repo, wanted, at) if wanted else ([], None)
    if isinstance(stopped, Stop):
        limits = {
            "requests": f"requests: reached the limit of {gh.limit} requests",
            "allowance": "allowance: the account's hourly GitHub allowance is down to half",
        }
        why = why or limits[stopped.why]
    elif isinstance(stopped, github.ServiceUnavailable):
        why = why or (f"gh: GitHub could not be read ({stopped}), so no pull request or "
                      "issue was: escapes are not counted")  # fmt: skip
    elif stopped is not None:
        why = why or f"github: GitHub stopped answering as expected ({stopped})"
    with_github = {line["id"]: line for line in read}
    out = [with_github.get(line["id"], line) for line in lines]
    out += [with_github[line["id"]] for line in held_lines if line["id"] in with_github]
    unread = len(wanted) - len(read)
    status = "read" if why is None and not unread else "partly"
    if status == "partly" and why is None:
        why = f"github: {unread} commits have no pull request or issue read yet"
    if units.problem:
        why = why or f"units: {units.problem}"
        status = "partly"
    return MainRead(status, why, len(picked), out, days, commit, units)


def days_known(states: dict[str, dict]) -> dict[str, dict]:
    """Each day's count of commits that landed, from every machine's state: the one listed
    furthest, then the one listed later."""
    best: dict[str, dict] = {}
    for state in states.values():
        main = state.get("main")
        days = main.get("days") if isinstance(main, dict) else None
        for day, entry in days.items() if isinstance(days, dict) else []:
            if not isinstance(entry, dict) or type(entry.get("merged")) is not int:
                continue
            until, at = parse_time(entry.get("until")), parse_time(entry.get("at"))
            if until is None or at is None:
                continue
            held = best.get(day)
            if held is None or (until, at) > (held["_until"], held["_at"]):
                best[day] = {**entry, "_until": until, "_at": at}
    return best
