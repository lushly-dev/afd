"""The world as it is: GitHub through ``gh``, git, the system clock, this machine, T3 Code's
plan caches and the operating system's processes.

This is the only module that starts processes. Every command is an argument list, never a
shell string, and on Windows the program is started by its resolved path (``shutil.which``),
so ``gh`` is found without a shell. Each class takes a ``run`` callable so tests can answer
for ``gh`` and ``git`` without calling them.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from collections.abc import Callable, Sequence
from pathlib import Path

from botcore_factory.real_run import Run, make_runner, parse_json, resolve_program, run_process
from botcore_factory.real_system import LocalMachine, OsProcesses, SystemClock, T3Plans
from botcore_factory.world import (
    Comment,
    HostRecord,
    Issue,
    MergeOutcome,
    PullRequest,
    World,
    WorldError,
)

READ_LIMIT = 2000  # Issues or PRs per read; a read that reaches it may be cut short.
ISSUE_FIELDS = "number,title,state,labels,assignees,createdAt"
__all__ = [
    "CliGit",
    "GhGitHub",
    "LocalMachine",
    "OsProcesses",
    "Run",
    "SystemClock",
    "T3Plans",
    "make_runner",
    "real_world",
    "resolve_program",
    "run_process",
]


def _issue(raw: dict) -> Issue:
    return Issue(
        number=raw["number"],
        title=raw.get("title", ""),
        labels=tuple(label["name"] for label in raw.get("labels") or []),
        assignees=tuple(person["login"] for person in raw.get("assignees") or []),
        created_at=raw.get("createdAt", ""),
        state=raw.get("state", "OPEN"),
    )


class GhGitHub:
    """GitHub through the ``gh`` CLI, run in the target checkout."""

    def __init__(self, run: Run) -> None:
        self.run = run
        self._repository: str | None = None

    def repository(self) -> str:
        if self._repository is None:
            data = parse_json(
                self.run(["gh", "repo", "view", "--json", "nameWithOwner"]), "gh repo"
            )
            self._repository = data["nameWithOwner"]
        return self._repository

    def list_issues(self) -> list[Issue]:
        rows = parse_json(
            self.run(
                [
                    "gh",
                    "issue",
                    "list",
                    "--state",
                    "open",
                    "--limit",
                    str(READ_LIMIT),
                    "--json",
                    ISSUE_FIELDS,
                ]
            ),
            "gh issue list",
        )
        if len(rows) >= READ_LIMIT:
            raise WorldError(f"gh returned {len(rows)} issues, the read limit; the list may be cut")
        return [_issue(row) for row in rows]

    def get_issue(self, number: int) -> Issue:
        raw = self.run(["gh", "issue", "view", str(number), "--json", ISSUE_FIELDS])
        return _issue(parse_json(raw, "gh issue view"))

    def comments(self, number: int) -> list[Comment]:
        data = parse_json(
            self.run(["gh", "issue", "view", str(number), "--json", "comments"]), "gh"
        )
        return [
            Comment(
                str(item.get("id", "")),
                item.get("body", ""),
                (item.get("author") or {}).get("login", ""),
                item.get("createdAt", ""),
            )
            for item in data.get("comments", [])
        ]

    def edit_labels(self, number: int, add: Sequence[str] = (), remove: Sequence[str] = ()) -> None:
        args = ["gh", "issue", "edit", str(number)]
        for label in add:
            args += ["--add-label", label]
        for label in remove:
            args += ["--remove-label", label]
        self.run(args)

    def add_comment(self, number: int, body: str) -> Comment:
        url = self.run(["gh", "issue", "comment", str(number), "--body-file", "-"], body).strip()
        return Comment(url.rsplit("#issuecomment-", 1)[-1], body, "", "")

    def open_pull_requests(self) -> list[PullRequest]:
        rows = parse_json(
            self.run(
                [
                    "gh",
                    "pr",
                    "list",
                    "--state",
                    "open",
                    "--limit",
                    str(READ_LIMIT),
                    "--json",
                    "number,headRefName,closingIssuesReferences",
                ]
            ),
            "gh pr list",
        )
        if len(rows) >= READ_LIMIT:
            raise WorldError(f"gh returned {len(rows)} PRs, the read limit; the list may be cut")
        return [
            PullRequest(
                row["number"],
                row.get("headRefName", ""),
                tuple(ref["number"] for ref in row.get("closingIssuesReferences") or []),
            )
            for row in rows
        ]

    def get_variable(self, name: str) -> str | None:
        try:
            return self.run(["gh", "variable", "get", name]).strip()
        except WorldError as exc:
            if "not found" in str(exc).lower():
                return None
            raise

    def set_variable(self, name: str, value: str) -> None:
        self.run(["gh", "variable", "set", name, "--body", value])

    def signed_in(self) -> bool:
        try:
            self.run(["gh", "auth", "status"])
        except WorldError:
            return False
        return True

    def required_checks(self, branch: str) -> list[str]:
        """Required status checks from branch protection and from rulesets, together."""
        repository = self.repository()
        checks: set[str] = set()
        try:
            raw = self.run(
                [
                    "gh",
                    "api",
                    f"repos/{repository}/branches/{branch}/protection/required_status_checks",
                ]
            )
            checks |= set(parse_json(raw, "gh api").get("contexts") or [])
        except WorldError as exc:
            if "404" not in str(exc) and "not protected" not in str(exc).lower():
                raise
        rules = parse_json(
            self.run(["gh", "api", f"repos/{repository}/rules/branches/{branch}"]), "gh"
        )
        for rule in rules:
            if rule.get("type") == "required_status_checks":
                for check in (rule.get("parameters") or {}).get("required_status_checks", []):
                    checks.add(check.get("context", ""))
        return sorted(name for name in checks if name)

    def open_pr(self, branch: str, title: str, body: str, base: str = "main") -> int:
        found = parse_json(
            self.run(
                [
                    "gh",
                    "pr",
                    "list",
                    "--head",
                    branch,
                    "--base",
                    base,
                    "--state",
                    "open",
                    "--json",
                    "number,isCrossRepository",
                ]
            ),
            "gh pr list",
        )
        # A fork's branch of the same name is not the lane's.
        own = [pr for pr in found if not pr.get("isCrossRepository")]
        if own:
            return int(own[0]["number"])
        url = self.run(
            [
                "gh",
                "pr",
                "create",
                "--head",
                branch,
                "--base",
                base,
                "--title",
                title,
                "--body-file",
                "-",
            ],
            body,
        ).strip()
        return int(url.rstrip("/").rsplit("/", 1)[-1])

    def check_status(self, pr: int, name: str, head: str) -> str:
        """The check run (else the commit status) called ``name`` on ``head`` itself."""
        repository = self.repository()
        runs = parse_json(
            self.run(["gh", "api", f"repos/{repository}/commits/{head}/check-runs?per_page=100"]),
            "gh api check-runs",
        ).get("check_runs", [])
        mine = [run for run in runs if run.get("name") == name]
        if mine:
            latest = max(mine, key=lambda run: run.get("started_at") or "")
            if latest.get("status") != "completed":
                return "pending"
            conclusion = latest.get("conclusion")
            if conclusion == "success":
                return "success"
            return "cancelled" if conclusion in ("cancelled", "stale", "skipped") else "failure"
        statuses = parse_json(
            self.run(["gh", "api", f"repos/{repository}/commits/{head}/status"]), "gh api status"
        ).get("statuses", [])
        for status in statuses:
            if status.get("context") == name:
                state = status.get("state")
                return {"success": "success", "pending": "pending"}.get(state, "failure")
        return "missing"

    def merge_pr(self, pr: int, head: str) -> None:
        self.run(["gh", "pr", "merge", str(pr), "--squash", "--match-head-commit", head])

    def pr_state(self, pr: int) -> str:
        data = parse_json(self.run(["gh", "pr", "view", str(pr), "--json", "state"]), "gh pr")
        return str(data.get("state", "OPEN"))

    def merge_commit(self, pr: int) -> str | None:
        data = parse_json(self.run(["gh", "pr", "view", str(pr), "--json", "mergeCommit"]), "gh pr")
        return (data.get("mergeCommit") or {}).get("oid") or None

    def commit_checks(self, commit: str) -> dict[str, str]:
        """Each check run name's worst state across the workflows (check suites) that ran it,
        the latest run of each within a suite; then each workflow run, as ``workflow: <name>``,
        so a job GitHub has not created yet still holds the answer at ``pending``."""
        repository = self.repository()
        runs = self._pages(f"repos/{repository}/commits/{commit}/check-runs", "check_runs")
        latest: dict[tuple, dict] = {}
        for run in runs:
            key = ((run.get("check_suite") or {}).get("id"), run.get("name", ""))
            if (run.get("started_at") or "") >= (latest.get(key, {}).get("started_at") or ""):
                latest[key] = run
        checks: dict[str, str] = {}
        for (_, name), run in latest.items():
            _worst(checks, name, _run_state(run))
        statuses = parse_json(
            self.run(["gh", "api", f"repos/{repository}/commits/{commit}/status"]),
            "gh api status",
        ).get("statuses", [])
        seen = set()
        for status in statuses:  # Newest first: the first of each context is its state.
            name = status.get("context", "")
            if name not in seen:
                seen.add(name)
                state = {"success": "success", "pending": "pending"}.get(status.get("state"))
                _worst(checks, name, state or "failure")
        workflows = self._pages(
            f"repos/{repository}/actions/runs?head_sha={commit}", "workflow_runs"
        )
        for run in workflows:
            _worst(checks, f"workflow: {run.get('name', '')}", _run_state(run))
        return checks

    def _pages(self, path: str, key: str) -> list[dict]:
        """Every item of a paged list; a read that stops short raises."""
        items: list[dict] = []
        separator = "&" if "?" in path else "?"
        for page in range(1, 11):
            found = parse_json(
                self.run(["gh", "api", f"{path}{separator}per_page=100&page={page}"]),
                f"gh api {key}",
            )
            batch = found.get(key, [])
            items += batch
            if len(items) >= found.get("total_count", len(items)) or not batch:
                break
        if len(items) < found.get("total_count", len(items)):
            raise WorldError(f"{path} lists more {key} than were read")
        return items


#: A state's weight: the worst of several runs of one name is what that name is.
_WEIGHT = {"success": 0, "skipped": 1, "cancelled": 2, "pending": 3, "failure": 4}


def _worst(checks: dict[str, str], name: str, state: str) -> None:
    if _WEIGHT[state] >= _WEIGHT.get(checks.get(name, "success"), 0):
        checks[name] = state


def _run_state(run: dict) -> str:
    """A check run's or workflow run's state."""
    if run.get("status") != "completed":
        return "pending"
    conclusion = run.get("conclusion")
    if conclusion in ("success", "neutral"):
        return "success"
    if conclusion == "skipped":
        return "skipped"
    return "cancelled" if conclusion in ("cancelled", "stale") else "failure"


#: ``git diff`` as plain patch text whatever the repository's config says, which a cell's
#: worktree shares and could set: no colour, external diff, text conversion, relative paths or
#: dropped context.
_PLAIN_DIFF = (
    "-c",
    "core.quotePath=false",
    "-c",
    "color.ui=never",
    "-c",
    "diff.relative=false",
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    "-U3",  # Context, whatever diff.context says: patch-id ignores line numbers.
)


class CliGit:
    """git in the target checkout. Host records are fetched from origin's refs/factory/hosts."""

    def __init__(self, run: Run, target: str = ".") -> None:
        self.run = run
        self.target = target

    def host_records(self) -> list[HostRecord]:
        self.run(
            [
                "git",
                "fetch",
                "--quiet",
                "--no-tags",
                "origin",
                "+refs/factory/hosts/*:refs/factory/hosts/*",
            ]
        )
        refs = self.run(["git", "for-each-ref", "--format=%(refname)", "refs/factory/hosts"])
        return [
            HostRecord.read(
                parse_json(self.run(["git", "show", f"{ref}:host.json"]), f"git show {ref}"),
                ref.rsplit("/", 1)[-1],
            )
            for ref in refs.split()
        ]

    def head(self, worktree: str) -> str:
        return self.run(["git", "-C", worktree, "rev-parse", "HEAD"]).strip()

    def branch(self, worktree: str) -> str | None:
        try:
            return self.run(
                ["git", "-C", worktree, "symbolic-ref", "--quiet", "--short", "HEAD"]
            ).strip()
        except WorldError:
            return None  # Detached HEAD.

    def uncommitted(self, worktree: str) -> list[str]:
        out = self.run(["git", "-C", worktree, "status", "--porcelain", "--untracked-files=all"])
        # Each line is "XY path" (or "XY old -> new" for a rename); the path is what changed.
        return [line[3:].split(" -> ")[-1] for line in out.splitlines() if line.strip()]

    def changed_files(self, worktree: str, since: str | None = None) -> list[str]:
        return self._names(worktree, f"{since or 'origin/HEAD'}...HEAD")

    def repair_edits(
        self, worktree: str, base: str, since: str | None, keep: Callable[[str], bool]
    ) -> list[str]:
        now = [path for path in self._names(worktree, f"{base}...HEAD") if keep(path)]
        if since is None:
            return now
        # The branch's own diff at the ejected head: from where it then left the base.
        before = [path for path in self._names(worktree, f"{base}...{since}") if keep(path)]
        edits = [path for path in now if path not in before]
        for path in before:  # A change it made, now changed or taken back: still a gate edit.
            if path not in now or self._change_id(worktree, base, "HEAD", path) != self._change_id(
                worktree, base, since, path
            ):
                edits.append(path)
        return edits

    def _names(self, worktree: str, spec: str) -> list[str]:
        """Both sides of a rename, and paths unquoted, so a gate file renamed out of the gate
        globs, or one with a non-ASCII name, still matches them."""
        out = self.run(["git", "-C", worktree, *_PLAIN_DIFF, "--name-only", spec])
        return [line for line in out.splitlines() if line.strip()]

    def _change_id(self, worktree: str, base: str, head: str, path: str) -> str:
        """The branch's own change to ``path`` at ``head``, as ``git patch-id --verbatim``: equal
        for the same lines with the same context when a rebase only moves them in the file.
        Whitespace counts, since indentation changes what a YAML workflow means; main editing
        near the branch's own lines changes the context and so fails closed."""
        patch = self.run(["git", "-C", worktree, *_PLAIN_DIFF, f"{base}...{head}", "--", path])
        if not patch.strip():
            return ""
        out = self.run(["git", "-C", worktree, "patch-id", "--verbatim"], patch).split()
        if not out:  # A patch patch-id cannot read must never compare equal to another.
            raise WorldError(f"git patch-id could not read the diff of {path} at {head}")
        return out[0]

    def push_queue_ref(self, worktree: str, branch: str, head: str) -> None:
        self.run(
            [
                "git",
                "-C",
                worktree,
                "push",
                "--force",
                "--quiet",
                "origin",
                f"{head}:refs/factory/queue/{branch}",
            ]
        )

    def queue_refs(self) -> list[dict]:
        out = self.run(["git", "ls-remote", "origin", "refs/factory/queue/*"])
        refs = []
        for line in out.splitlines():
            if "\t" in line:
                head, ref = line.split("\t", 1)
                refs.append({"branch": ref.removeprefix("refs/factory/queue/"), "head": head})
        return refs

    def delete_queue_ref(self, branch: str, head: str) -> None:
        ref = f"refs/factory/queue/{branch}"
        if not self.run(["git", "ls-remote", "origin", ref]).strip():
            return
        self.run(
            ["git", "push", "--quiet", f"--force-with-lease={ref}:{head}", "origin", f":{ref}"]
        )

    def publish_host_record(self, record: HostRecord) -> None:
        """A one-file commit on refs/factory/hosts/<id>, made without touching the checkout."""
        body = json.dumps(record.describe(), indent=2, sort_keys=True) + "\n"
        blob = self.run(["git", "hash-object", "-w", "--stdin"], body).strip()
        tree = self.run(["git", "mktree"], f"100644 blob {blob}\thost.json\n").strip()
        commit = self.run(
            [
                "git",
                "-c",
                "user.name=botcore-factory",
                "-c",
                "user.email=factory@localhost",
                "commit-tree",
                tree,
                "-m",
                f"Readiness of {record.id}",
            ]
        ).strip()
        self.run(
            [
                "git",
                "push",
                "--force",
                "--quiet",
                "origin",
                f"{commit}:refs/factory/hosts/{record.id}",
            ]
        )

    def origin_reachable(self) -> bool:
        try:
            self.run(["git", "ls-remote", "--heads", "origin"])
        except WorldError:
            return False
        return True

    def read_file(self, worktree: str, path: str) -> str | None:
        root = Path(worktree).resolve()
        target = (root / path).resolve()
        if not target.is_relative_to(root):
            return None  # Outside the worktree: never read.
        try:
            return target.read_text(encoding="utf-8")
        except OSError:
            return None

    def fetch_base(self, base: str) -> str:
        # An explicit refspec: the configured one is shared with cell worktrees, which could
        # point origin's base at their own branch.
        self.run(
            [
                "git",
                "fetch",
                "--quiet",
                "--no-tags",
                "origin",
                f"+refs/heads/{base}:refs/remotes/origin/{base}",
            ]
        )
        return self.run(["git", "rev-parse", f"refs/remotes/origin/{base}"]).strip()

    def _slot_path(self, slot: str) -> str:
        """``<checkout>.factory-slots/<slot>``, beside the repository and never inside it.

        Not under ``.git``: TypeScript refuses some declarations in a project whose path has a
        ``.git`` segment (TS2883), so a slot there fails checks that pass everywhere else.
        """
        common = Path(
            self.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"]).strip()
        )
        repository = common.parent if common.name == ".git" else common
        if not repository.name or ".git" in repository.parts:
            raise WorldError(
                f"Lane slots cannot go beside {repository}: a repository at a filesystem root or"
                " inside a .git directory (a submodule) has no place for them outside .git"
            )
        return str(repository.with_name(f"{repository.name}.factory-slots") / slot)

    def prepare_slot(self, slot: str, branch: str, head: str) -> str:
        path = self._slot_path(slot)
        if branch:  # A queued branch; the base's coverage checks origin's head out instead.
            self.run(
                [
                    "git",
                    "fetch",
                    "--quiet",
                    "origin",
                    f"+refs/factory/queue/{branch}:refs/factory/queue/{branch}",
                ]
            )
        if not Path(path).exists():
            self.run(["git", "worktree", "add", "--force", "--detach", path, head])
        else:
            self.run(["git", "-C", path, "reset", "--hard", "--quiet"])
            self.run(["git", "-C", path, "checkout", "--force", "--detach", "--quiet", head])
        self.run(["git", "-C", path, "clean", "-fd", "--quiet"])
        return path

    def park_slot(self, slot: str, name: str) -> str:
        """Move the slot's checkout, with its git directory and the validation record kept
        there, to the lane's checkout ``name`` (``git worktree move``: a rename, so nothing is
        copied); the slot's path is free for ``prepare_slot`` to check out afresh."""
        source, target = self._slot_path(slot), self._slot_path(name)
        if Path(target).exists():
            self.remove_checkout(target)
        self.run(["git", "worktree", "move", source, target])
        return target

    def remove_checkout(self, path: str) -> None:
        """Forget one lane checkout: ``git worktree move`` renames it aside at once, keeping
        git's record of it in step, then a detached process runs ``git worktree remove --force``
        on it, so the step never waits on deleting a checkout's dependencies. Only this checkout
        is unregistered: never ``git worktree prune``, which would drop every worktree of the
        repository whose directory is missing, other sessions' among them. Absent is done."""
        place = Path(path)
        if not place.exists():
            return
        trash = place.with_name(f".removing-{place.name}-{os.getpid()}-{time.time_ns()}")
        self.run(["git", "worktree", "move", str(place), str(trash)])
        _remove_detached(self.target, trash)

    _IDENTITY = ("-c", "user.name=botcore-factory", "-c", "user.email=factory@localhost")

    def _unmerged(self, path: str) -> tuple[str, ...]:
        found = self.run(["git", "-C", path, "diff", "--name-only", "--diff-filter=U"])
        return tuple(line for line in found.splitlines() if line.strip())

    def merge_main(
        self, path: str, main: str, keep_open: Callable[[tuple[str, ...]], bool] | None = None
    ) -> MergeOutcome:
        identity = list(self._IDENTITY)
        # A conflict exits nonzero; the unmerged paths say so, and the merge is aborted.
        self.run(["git", "-C", path, *identity, "merge", "--no-edit", "--quiet", main], None, False)
        files = self._unmerged(path)
        if files:
            if keep_open is not None and keep_open(files):
                return MergeOutcome(False, conflicts=files, open=True)
            self.run(["git", "-C", path, "merge", "--abort"])
            return MergeOutcome(False, conflicts=files)
        # No conflict is not a merge: the base must now be in the head's history.
        if not self._ancestor(path, main):
            raise WorldError(f"Merging {main} into the slot did not happen")
        return MergeOutcome(True, head=self.head(path))

    def finish_merge(self, path: str) -> MergeOutcome:
        files = self._unmerged(path)
        if files:
            self.abort_merge(path)
            return MergeOutcome(False, conflicts=files)
        # A commit runs pre-commit, which a clean ``git merge`` never does: the repository's
        # hooks would check every file main brought in, before the slot is even installed.
        self.run(
            ["git", "-C", path, *self._IDENTITY, "commit", "--no-edit", "--no-verify", "--quiet"]
        )
        return MergeOutcome(True, head=self.head(path))

    def abort_merge(self, path: str) -> None:
        self.run(["git", "-C", path, "merge", "--abort"], None, False)

    def _ancestor(self, path: str, commit: str) -> bool:
        try:
            self.run(["git", "-C", path, "merge-base", "--is-ancestor", commit, "HEAD"])
        except WorldError:
            return False
        return True

    def tree(self, path: str) -> str:
        return self.run(["git", "-C", path, "rev-parse", "HEAD^{tree}"]).strip()

    def diff_names(self, old: str, new: str) -> list[str]:
        out = self.run(["git", "diff", "--name-only", "--no-renames", old, new])
        return [line for line in out.splitlines() if line.strip()]

    def merges_cleanly(self, head: str, base: str) -> MergeOutcome:
        args = ["git", "merge-tree", "--write-tree", "--name-only", "--no-messages", head, base]
        try:
            out = self.run(args)  # Exit 0: clean; its first line is the merged tree.
        except WorldError:
            # Exit 1 is a conflict: the tree, then the conflicting paths. Anything else (an
            # unknown commit, a git without --write-tree) prints no conflict and is an error.
            lines = [line for line in self.run(args, None, False).splitlines() if line.strip()]
            if len(lines) < 2:
                raise
            return MergeOutcome(False, conflicts=tuple(dict.fromkeys(lines[1:])))
        lines = out.split()
        if not lines:
            raise WorldError(f"git merge-tree gave no tree for {head} onto {base}")
        return MergeOutcome(True, head=lines[0])

    def push_head(self, path: str, branch: str, head: str, lease: str | None) -> None:
        """Use the validated checkout's pre-push record and push its exact commit.

        A slot stays reserved until pushed. Refuse unexpected reuse, and keep the explicit
        refspec so even a concurrent checkout change cannot substitute another commit.
        """
        if self.head(path) != head:
            raise WorldError(f"Validation checkout {path} no longer holds {head}; validate again")
        args = ["git", "-C", path, "push", "--quiet", "--porcelain"]
        if lease:
            args.append(f"--force-with-lease=refs/heads/{branch}:{lease}")
        self.run([*args, "origin", f"{head}:refs/heads/{branch}"])


def _remove_detached(repository: str, path: Path) -> None:
    """``git worktree remove --force`` the checkout at ``path`` in a process of its own that
    outlives the lane step, then delete whatever is left (best effort: a leftover
    ``.removing-*`` directory holds no lane state)."""
    options: dict = (
        {"creationflags": subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP}
        if sys.platform == "win32"
        else {"start_new_session": True}
    )
    code = (
        "import shutil, subprocess, sys\n"
        "subprocess.run(['git', '-C', sys.argv[1], 'worktree', 'remove', '--force', sys.argv[2]],"
        " stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)\n"
        "shutil.rmtree(sys.argv[2], ignore_errors=True)\n"
    )
    try:
        subprocess.Popen(  # noqa: S603 - an argument list, no shell
            [sys.executable, "-c", code, repository, str(path)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            **options,
        )
    except OSError as exc:
        raise WorldError(f"Cannot start removing {path}: {exc}") from exc


def real_world(target: Path, *, caches: Path | None = None) -> World:
    """The world for a repository checked out at ``target``."""
    run = make_runner(str(target))
    clock = SystemClock()
    return World(
        github=GhGitHub(run),
        git=CliGit(run, str(target)),
        clock=clock,
        machine=LocalMachine(run),
        plans=T3Plans(clock, caches),
        processes=OsProcesses(),
    )
