"""The world as it is: GitHub through ``gh``, git, the system clock, this machine, T3 Code's
plan caches and the operating system's processes.

This is the only module that starts processes. Every command is an argument list, never a
shell string, and on Windows the program is started by its resolved path (``shutil.which``),
so ``gh`` is found without a shell. Each class takes a ``run`` callable so tests can answer
for ``gh`` and ``git`` without calling them.
"""

from __future__ import annotations

import errno
import json
import os
import re
import stat
import subprocess
import sys
import time
from collections.abc import Callable, Sequence
from pathlib import Path, PurePosixPath
from typing import Any

from botcore_factory.adapter import _slot_clean_path
from botcore_factory.real_run import Run, make_runner, parse_json, resolve_program, run_process
from botcore_factory.real_system import LocalMachine, OsProcesses, SystemClock, T3Plans
from botcore_factory.squash import clean_message, fold_message, squash_body, with_sessions
from botcore_factory.validation_lock import ValidationLock
from botcore_factory.world import (
    Comment,
    FoldOutcome,
    HostRecord,
    Issue,
    MergeOutcome,
    MergeProgress,
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


def _issue(raw: dict[str, Any]) -> Issue:
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
        """A squash bound to ``head``, with the branch's messages as its body (``squash_body``).

        Behind a merge queue ``gh`` exits 0 once the pull request is queued (or set to join the
        queue when its requirements pass), bound to the same head; the queue writes the squash
        message itself, so the body is not used there. ``merge_progress`` says which happened.
        """
        body = squash_body(self._commits(pr))
        self.run(
            ["gh", "pr", "merge", str(pr), "--squash", "--match-head-commit", head]
            + ["--body-file", "-"],
            body,
        )

    def _commits(self, pr: int) -> list[dict[str, Any]]:
        """A pull request's commits, which GitHub lists up to 250 of, 100 to a page."""
        commits: list[dict[str, Any]] = []
        path = f"repos/{self.repository()}/pulls/{pr}/commits"
        for page in range(1, 4):
            batch = parse_json(
                self.run(["gh", "api", f"{path}?per_page=100&page={page}"]), "gh api commits"
            )
            commits += batch
            if len(batch) < 100:
                break
        return commits

    def pr_state(self, pr: int) -> str:
        data = parse_json(self.run(["gh", "pr", "view", str(pr), "--json", "state"]), "gh pr")
        return str(data.get("state", "OPEN"))

    def enqueue_pr(self, pr: int, head: str) -> None:
        node = parse_json(self.run(["gh", "pr", "view", str(pr), "--json", "id"]), "gh pr")
        if not node.get("id"):
            raise WorldError(f"GitHub gave no id for PR {pr}")
        raw = self.run(
            ["gh", "api", "graphql", "-f", f"query={_ENQUEUE}"]
            + ["-f", f"id={node['id']}", "-f", f"head={head}"]
        )
        found = parse_json(raw, "gh api graphql")
        if found.get("errors") or not (found.get("data") or {}).get("enqueuePullRequest"):
            raise WorldError(f"GitHub did not queue PR {pr}: {raw.strip()[:300]}")

    def merge_progress(self, pr: int) -> MergeProgress:
        """One GraphQL read: ``gh pr view`` has no field for the merge queue's entry."""
        owner, _, name = self.repository().partition("/")
        raw = self.run(
            ["gh", "api", "graphql", "-f", f"query={_MERGE_PROGRESS}"]
            + ["-f", f"owner={owner}", "-f", f"name={name}", "-F", f"number={pr}"]
        )
        found = parse_json(raw, "gh api graphql")
        node = ((found.get("data") or {}).get("repository") or {}).get("pullRequest")
        if not isinstance(node, dict) or not node.get("state"):
            raise WorldError(f"GitHub returned no pull request {pr}: {raw.strip()[:200]}")
        entry = node.get("mergeQueueEntry") or {}
        removed = ((node.get("timelineItems") or {}).get("nodes") or [{}])[-1] or {}
        return MergeProgress(
            state=str(node["state"]),
            head=str(node.get("headRefOid") or ""),
            queue_required=bool(node.get("isMergeQueueEnabled")),
            queued=bool(node.get("isInMergeQueue") or entry),
            waiting=node.get("autoMergeRequest") is not None,
            queue_state=str(entry.get("state") or ""),
            position=entry.get("position"),
            group_head=str((entry.get("headCommit") or {}).get("oid") or ""),
            removed_at=str(removed.get("createdAt") or ""),
            removal_reason=str(removed.get("reason") or ""),
            removed_commit=str((removed.get("beforeCommit") or {}).get("oid") or ""),
        )

    def commit_message(self, commit: str) -> str:
        path = f"repos/{self.repository()}/commits/{commit}"
        data = parse_json(self.run(["gh", "api", path]), "gh api commit")
        return str((data.get("commit") or {}).get("message") or "")

    def merge_commit(self, pr: int) -> str | None:
        data = parse_json(self.run(["gh", "pr", "view", str(pr), "--json", "mergeCommit"]), "gh pr")
        return (data.get("mergeCommit") or {}).get("oid") or None

    def commit_checks(self, commit: str) -> dict[str, str]:
        """Each check run name's worst state across the workflows (check suites) that ran it,
        the latest run of each within a suite; then each workflow run, as ``workflow: <name>``,
        so a job GitHub has not created yet still holds the answer at ``pending``."""
        repository = self.repository()
        runs = self._pages(f"repos/{repository}/commits/{commit}/check-runs", "check_runs")
        latest: dict[tuple[Any, str], dict[str, Any]] = {}
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

    def _pages(self, path: str, key: str) -> list[dict[str, Any]]:
        """Every item of a paged list; a read that stops short raises."""
        items: list[dict[str, Any]] = []
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


#: Into the merge queue, bound to the head: GitHub answers a head that moved with "expected
#: head oid does not match the current head oid" and changes nothing.
_ENQUEUE = """mutation($id: ID!, $head: GitObjectID!) {
  enqueuePullRequest(input: {pullRequestId: $id, expectedHeadOid: $head}) {
    mergeQueueEntry { state position }
  }
}"""

#: A pull request's merge state, its merge queue entry and the last time a queue let it go.
_MERGE_PROGRESS = """query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    state headRefOid isMergeQueueEnabled isInMergeQueue
    autoMergeRequest { enabledAt }
    mergeQueueEntry { state position headCommit { oid } }
    timelineItems(last: 1, itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT]) {
      nodes { ... on RemovedFromMergeQueueEvent { createdAt reason beforeCommit { oid } } }
    }
  } }
}"""

#: A state's weight: the worst of several runs of one name is what that name is.
_WEIGHT = {"success": 0, "skipped": 1, "cancelled": 2, "pending": 3, "failure": 4}


def _worst(checks: dict[str, str], name: str, state: str) -> None:
    if _WEIGHT[state] >= _WEIGHT.get(checks.get(name, "success"), 0):
        checks[name] = state


def _run_state(run: dict[str, Any]) -> str:
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
        if since is not None and not self._has_commit(worktree, since):
            # The ejected head is gone (pruned, or never fetched here): every gate edit the
            # branch makes counts, rather than none.
            since = None
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

    def _has_commit(self, worktree: str, sha: str) -> bool:
        try:
            self.run(["git", "-C", worktree, "cat-file", "-e", f"{sha}^{{commit}}"])
        except WorldError:
            return False
        return True

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

    def queue_refs(self) -> list[dict[str, Any]]:
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

    def slots_dir(self) -> str:
        return str(Path(self._slot_path("slot")).parent)

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
        try:
            self.run(["git", "worktree", "move", str(place), str(trash)])
        except WorldError as exc:
            if "not a working tree" not in str(exc):
                raise
            # Left behind unregistered (a crash mid-move): git has nothing to forget.
            try:
                place.rename(trash)
            except OSError as again:
                raise WorldError(f"Cannot move {path} aside to remove it: {again}") from again
        _remove_detached(self.target, trash)

    def remove_build(self, path: str) -> None:
        place = Path(path)
        if not place.exists():
            return
        trash = place.with_name(f".removing-{place.name}-{os.getpid()}-{time.time_ns()}")
        try:
            place.rename(trash)
        except OSError as exc:
            raise WorldError(f"Cannot move {path} aside to remove it: {exc}") from exc
        _remove_detached(self.target, trash, checkout=False)

    def clean_slot_paths(self, slot: str, paths: Sequence[str]) -> list[str]:
        """Remove configured ignored build directories inside ``slot``'s checkout by renaming
        each aside into the slots parent directory (never inside the worktree, where git or
        linters would see untracked ``.removing-*`` files) and deleting it in a detached process
        (lushly-dev/afd#1659).

        Only ignored directories containing no tracked files are removed; symlinks, Windows
        junctions/reparse points, mount crossings and escaping paths are never followed or
        deleted. On POSIX the walk and rename are anchored to opened ``O_NOFOLLOW`` directory
        file descriptors; on Windows each directory's reparse status and identity are verified.
        """
        if not paths:
            return []
        slot_root = Path(self._slot_path(slot))
        try:
            root_info = os.lstat(slot_root)
        except FileNotFoundError:
            return []
        except OSError as exc:
            raise WorldError(f"Cannot inspect slot checkout {slot_root}: {exc}") from exc
        if (
            _is_link_stat(root_info)
            or _is_junction(slot_root)
            or not stat.S_ISDIR(root_info.st_mode)
        ):
            return []
        safe_slot = re.sub(r"[^A-Za-z0-9._-]+", "-", slot).strip("-") or "slot"
        removed: list[str] = []
        for index, raw in enumerate(paths):
            try:
                rel = _slot_clean_path(raw)
            except ValueError as exc:
                raise WorldError(f"Invalid slot_clean_paths entry {raw!r}: {exc}") from exc
            parts = PurePosixPath(rel).parts
            # Verify the path is ignored and holds no tracked files before touching disk.
            if self.run(["git", "-C", str(slot_root), "ls-files", "--", rel]).strip():
                continue
            if not self.run(
                ["git", "-C", str(slot_root), "check-ignore", "--", rel], None, False
            ).strip():
                continue
            trash_name = (
                f".removing-slot-{safe_slot}-{index}-{parts[-1]}-{os.getpid()}-{time.time_ns()}"
            )
            trash = (
                _rename_slot_dir_posix(slot_root, parts, trash_name)
                if _DIR_FD_RENAME
                else _rename_slot_dir_windows(slot_root, parts, trash_name)
            )
            if trash is None:
                continue
            _remove_detached(self.target, trash, checkout=False)
            removed.append(rel)
        return removed

    #: The lane commits as itself. ``committer.*`` is set too: it outranks ``user.*``, so a
    #: host that configures it would otherwise commit the lane's merges as someone else.
    _IDENTITY = (
        *("-c", "user.name=botcore-factory", "-c", "user.email=factory@localhost"),
        *("-c", "committer.name=botcore-factory", "-c", "committer.email=factory@localhost"),
    )

    def _branch_author(self, path: str) -> str:
        """Who a merge of the base is authored as: the author of the branch's newest commit of
        its own (first parents only, no merges, so never an earlier merge of the lane's nor a
        commit main brought in), as ``Name <email>``.

        GitHub's own squash message credits every commit author but the pull request's with a
        ``Co-authored-by:`` line. Merging directly, the lane writes the body itself
        (``squash_body``); a merge queue writes its own and takes none, so a merge commit
        authored as ``botcore-factory`` puts that line into the queue's squash. Authored as
        the branch's own author it adds nobody. An author that cannot be read is an error,
        never a merge authored as the lane after all.
        """
        found = self.run(
            ["git", "-C", path, "log", "-1", "--first-parent", "--no-merges"]
            + ["--format=%an%n%ae", "HEAD"]
        )
        name, email = [*(line.strip() for line in found.splitlines()), "", ""][:2]
        if not name or not email:
            raise WorldError(f"The author of the branch in {path} cannot be read")
        return f"{name} <{email}>"

    def _author_merge(self, path: str, author: str) -> None:
        """Record ``author`` on the merge commit ``git merge`` just made. ``git merge`` takes no
        author, and ``GIT_AUTHOR_*`` in the lane's environment outranks any configuration;
        ``--author`` outranks both."""
        self.run(
            ["git", "-C", path, *self._IDENTITY, "commit", "--amend", "--no-edit"]
            + ["--no-verify", "--quiet", "--author", author]
        )

    def _unmerged(self, path: str) -> tuple[str, ...]:
        found = self.run(["git", "-C", path, "diff", "--name-only", "--diff-filter=U"])
        return tuple(line for line in found.splitlines() if line.strip())

    def merge_main(
        self, path: str, main: str, keep_open: Callable[[tuple[str, ...]], bool] | None = None
    ) -> MergeOutcome:
        author, before = self._branch_author(path), self.head(path)
        # A conflict exits nonzero; the unmerged paths say so, and the merge is aborted.
        self.run(
            ["git", "-C", path, *self._IDENTITY, "merge", "--no-edit", "--quiet", main], None, False
        )
        files = self._unmerged(path)
        if files:
            if keep_open is not None and keep_open(files):
                return MergeOutcome(False, conflicts=files, open=True)
            self.run(["git", "-C", path, "merge", "--abort"])
            return MergeOutcome(False, conflicts=files)
        # No conflict is not a merge: the base must now be in the head's history.
        if not self._ancestor(path, main):
            raise WorldError(f"Merging {main} into the slot did not happen")
        # Only a commit this merge created is re-authored: its parents are the head it merged
        # into and the base. A fast-forward moved the head onto the base's own commit (a merge
        # commit of the base's, whose first parent may be that head, included): amending it
        # would copy main's commit, and main would no longer be in the branch's history.
        made = self.run(["git", "-C", path, "rev-list", "--parents", "-n", "1", "HEAD"]).split()
        base = self.run(["git", "-C", path, "rev-parse", "--verify", f"{main}^{{commit}}"]).strip()
        if made and made[0] not in (before, base) and made[1:] == [before, base]:
            self._author_merge(path, author)
        return MergeOutcome(True, head=self.head(path))

    def finish_merge(self, path: str) -> MergeOutcome:
        files = self._unmerged(path)
        if files:
            self.abort_merge(path)
            return MergeOutcome(False, conflicts=files)
        # A commit runs pre-commit, which a clean ``git merge`` never does: the repository's
        # hooks would check every file main brought in, before the slot is even installed.
        author = self._branch_author(path)
        self.run(
            ["git", "-C", path, *self._IDENTITY, "commit", "--no-edit", "--no-verify", "--quiet"]
            + ["--author", author]
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

    def fold(self, path: str, base: str, sessions: Sequence[str] = ()) -> FoldOutcome:
        before = self.head(path)
        onto = self.run(["git", "-C", path, "rev-parse", "--verify", f"{base}^{{commit}}"]).strip()
        if not self._ancestor(path, onto):
            raise WorldError(f"The slot {path} has not merged {base}: nothing is folded")
        # The branch's own commits, oldest first: never a merge, nor a commit the base holds.
        out = self.run(
            ["git", "-C", path, "log", "--reverse", "--no-merges", "-z"]
            + ["--format=%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%B", f"{onto}..HEAD"]
        )
        own = [entry.split("\x1f", 5) for entry in out.split("\0") if entry.strip()]
        if any(len(entry) != 6 for entry in own):
            raise WorldError(f"The commits of the branch in {path} cannot be read")
        if not own:
            return FoldOutcome(
                refused=f"FOLD_REFUSED: {before} has no commit of its own past {base}, so a "
                "rebase merge would land nothing of it: commit the branch's change"
            )
        # One author is one address, whatever name each machine's git gave it.
        authors: dict[str, str] = {}
        for entry in own:
            authors.setdefault(entry[1].strip().lower(), f"{entry[0]} <{entry[1].strip()}>")
        if len(authors) > 1:
            return FoldOutcome(
                refused=f"FOLD_REFUSED: its own commits have {len(authors)} authors "
                f"({', '.join(authors.values())}), and the one commit it is folded into can "
                "credit only one: author every commit of the branch as the pull request's author"
            )
        name, email, date, committer, committer_email, _ = own[-1]
        message = fold_message([entry[5] for entry in own])
        if not message.strip():
            return FoldOutcome(
                refused="FOLD_REFUSED: its own commits fold to an empty message once "
                "Co-authored-by: lines are left out: give the branch's commit a message"
            )
        message = with_sessions(message, sessions)
        parents = self.run(["git", "-C", path, "rev-list", "--parents", "-n", "1", "HEAD"]).split()
        if parents[1:] == [onto] and len(own) == 1 and clean_message(own[0][5]) == message:
            return FoldOutcome(head=before)  # Already one commit of its own on the base.
        tree = self.tree(path)
        # ``commit-tree`` runs no hook (``git commit --no-verify`` still runs
        # ``prepare-commit-msg``, which could add a co-author), and the identity is set here:
        # ``GIT_*`` in the lane's environment would outrank any configuration.
        identity = {
            "GIT_AUTHOR_NAME": name,
            "GIT_AUTHOR_EMAIL": email,
            "GIT_AUTHOR_DATE": date,
            "GIT_COMMITTER_NAME": committer,
            "GIT_COMMITTER_EMAIL": committer_email,
        }
        made = self.run(
            ["git", "-C", path, "commit-tree", tree, "-p", onto], message, True, env=identity
        ).strip()
        found = self.run(
            ["git", "-C", path, "log", "-1", "-z"]
            + ["--format=%an%x1f%ae%x1f%cn%x1f%ce%x1f%P%x1f%T%x1f%B", made]
        ).split("\x1f", 6)
        if len(found) != 7 or found[4:6] != [onto, tree]:
            raise WorldError(f"The fold of {before} in {path} is not one commit of its tree")
        stored = [name, email, committer, committer_email]
        if found[:4] != stored:
            # git cleans an identity it stores (a quote, a stray ``;``, a leading space): one
            # another tool wrote is the branch's to fix, never a fold crediting someone else.
            return FoldOutcome(
                refused=f"FOLD_REFUSED: git would credit {found[0]} <{found[1]}> (committed by "
                f"{found[2]} <{found[3]}>) where the branch's commits say {name} <{email}> "
                f"(committed by {committer} <{committer_email}>): commit as one identity git "
                "keeps as written"
            )
        if clean_message(found[6].rstrip("\0")) != message:
            raise WorldError(f"The fold of {before} in {path} did not keep its message")
        # Moved only from the head the fold read: the slot's HEAD is detached.
        self.run(["git", "-C", path, "update-ref", "--no-deref", "HEAD", made, before])
        return FoldOutcome(head=made)

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


#: Windows ``FILE_ATTRIBUTE_REPARSE_POINT`` flag: identifies NTFS junctions and symlinks on 3.11+.
REPARSE_POINT = 0x400
_DIR_FD_RENAME = (
    os.name != "nt"
    and os.open in os.supports_dir_fd
    and os.stat in os.supports_dir_fd
    and os.rename in os.supports_dir_fd
    and hasattr(os, "O_NOFOLLOW")
)


def _is_link_stat(info: os.stat_result) -> bool:
    if stat.S_ISLNK(info.st_mode):
        return True
    return bool(getattr(info, "st_file_attributes", 0) & REPARSE_POINT)


def _is_junction(path: Path) -> bool:
    """True for Windows NTFS directory junctions/reparse points on Python 3.11+."""
    try:
        if _is_link_stat(os.lstat(path)):
            return True
    except OSError:
        return False
    check = getattr(path, "is_junction", None)
    try:
        return bool(check()) if check is not None else False
    except OSError:
        return False


def _rename_slot_dir_posix(slot_root: Path, parts: tuple[str, ...], trash_name: str) -> Path | None:
    """Walk ``parts`` inside ``slot_root`` using opened ``O_NOFOLLOW`` directory fds and
    atomically rename the final directory into ``slot_root.parent``."""
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    parent_fd: int | None = None
    cur_fd: int | None = None
    try:
        try:
            parent_fd = os.open(slot_root.parent, flags)
            cur_fd = os.open(slot_root.name, flags, dir_fd=parent_fd)
        except FileNotFoundError:
            return None
        except OSError as exc:
            if exc.errno in (errno.ELOOP, errno.ENOTDIR):
                return None
            raise WorldError(f"Cannot open slot checkout {slot_root}: {exc}") from exc
        parent_dev = os.fstat(parent_fd).st_dev
        root_dev = os.fstat(cur_fd).st_dev
        if parent_dev != root_dev:
            return None
        for part in parts[:-1]:
            try:
                next_fd = os.open(part, flags, dir_fd=cur_fd)
            except FileNotFoundError:
                return None
            except OSError as exc:
                if exc.errno in (errno.ELOOP, errno.ENOTDIR):
                    return None
                raise WorldError(f"Cannot open {part} in {slot_root}: {exc}") from exc
            os.close(cur_fd)
            cur_fd = next_fd
            if os.fstat(cur_fd).st_dev != root_dev:
                return None
        leaf = parts[-1]
        try:
            info = os.stat(leaf, dir_fd=cur_fd, follow_symlinks=False)
        except FileNotFoundError:
            return None
        except OSError as exc:
            raise WorldError(f"Cannot inspect {leaf} in {slot_root}: {exc}") from exc
        if _is_link_stat(info) or not stat.S_ISDIR(info.st_mode) or info.st_dev != root_dev:
            return None
        try:
            os.rename(leaf, trash_name, src_dir_fd=cur_fd, dst_dir_fd=parent_fd)
        except FileNotFoundError:
            return None
        except OSError as exc:
            raise WorldError(f"Cannot move {slot_root.joinpath(*parts)} aside: {exc}") from exc
        return slot_root.parent / trash_name
    finally:
        if cur_fd is not None:
            os.close(cur_fd)
        if parent_fd is not None:
            os.close(parent_fd)


def _rename_slot_dir_windows(
    slot_root: Path, parts: tuple[str, ...], trash_name: str
) -> Path | None:
    """Verify non-reparse status, containment and parent identity along ``parts`` inside
    ``slot_root`` before renaming into ``slot_root.parent``."""
    try:
        root_info = os.lstat(slot_root)
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise WorldError(f"Cannot inspect slot checkout {slot_root}: {exc}") from exc
    if _is_link_stat(root_info) or _is_junction(slot_root) or not stat.S_ISDIR(root_info.st_mode):
        return None
    try:
        resolved_root = slot_root.resolve()
    except (OSError, RuntimeError) as exc:
        raise WorldError(f"Cannot resolve slot checkout {slot_root}: {exc}") from exc
    cur = slot_root
    parent_id = (root_info.st_dev, root_info.st_ino)
    for index, part in enumerate(parts):
        cur = cur / part
        try:
            info = os.lstat(cur)
        except FileNotFoundError:
            return None
        except OSError as exc:
            raise WorldError(f"Cannot inspect {cur}: {exc}") from exc
        if _is_link_stat(info) or _is_junction(cur) or not stat.S_ISDIR(info.st_mode):
            return None
        if index < len(parts) - 1:
            parent_id = (info.st_dev, info.st_ino)
    try:
        resolved_target = cur.resolve()
    except (OSError, RuntimeError) as exc:
        raise WorldError(f"Cannot resolve {cur}: {exc}") from exc
    if resolved_target == resolved_root or not resolved_target.is_relative_to(resolved_root):
        return None
    try:
        parent_now = os.lstat(cur.parent)
        target_now = os.lstat(cur)
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise WorldError(f"Cannot re-verify {cur}: {exc}") from exc
    if (
        (parent_now.st_dev, parent_now.st_ino) != parent_id
        or _is_link_stat(parent_now)
        or _is_junction(cur.parent)
        or _is_link_stat(target_now)
        or _is_junction(cur)
        or not stat.S_ISDIR(target_now.st_mode)
    ):
        return None
    trash = slot_root.parent / trash_name
    try:
        cur.rename(trash)
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise WorldError(f"Cannot move {cur} aside to remove it: {exc}") from exc
    return trash


def _remove_detached(repository: str, path: Path, *, checkout: bool = True) -> None:
    """``git worktree remove --force`` the checkout at ``path`` (only a ``checkout``) in a
    process of its own that outlives the lane step, then delete whatever is left (best effort:
    a leftover ``.removing-*`` directory holds no lane state)."""
    options: dict[str, Any]
    if sys.platform == "win32":
        options = {
            "creationflags": subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        }
    else:
        options = {"start_new_session": True}
    code = (
        "import os, shutil, stat, subprocess, sys\n"
        "path = sys.argv[2]\n"
        "if sys.argv[3] == 'checkout':\n"
        "    subprocess.run(['git', '-C', sys.argv[1], 'worktree', 'remove', '--force',"
        " path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)\n"
        "def _unlink_reparse(p):\n"
        "    try:\n"
        "        info = os.lstat(p)\n"
        "    except OSError:\n"
        "        return False\n"
        "    is_link = stat.S_ISLNK(info.st_mode) or bool(\n"
        "        getattr(info, 'st_file_attributes', 0) & 0x400\n"
        "    )\n"
        "    if not is_link:\n"
        "        return False\n"
        "    try:\n"
        "        os.rmdir(p) if stat.S_ISDIR(info.st_mode) else os.unlink(p)\n"
        "    except OSError:\n"
        "        pass\n"
        "    return True\n"
        "def _rm(root):\n"
        "    if _unlink_reparse(root):\n"
        "        return\n"
        "    if os.path.isfile(root):\n"
        "        try:\n"
        "            os.unlink(root)\n"
        "        except OSError:\n"
        "            pass\n"
        "        return\n"
        "    if os.name == 'nt':\n"
        "        for cur, dirs, _files in os.walk(root, topdown=True, followlinks=False):\n"
        "            keep = []\n"
        "            for d in dirs:\n"
        "                full = os.path.join(cur, d)\n"
        "                if not _unlink_reparse(full):\n"
        "                    keep.append(d)\n"
        "            dirs[:] = keep\n"
        "    shutil.rmtree(root, ignore_errors=True)\n"
        "_rm(path)\n"
    )
    try:
        subprocess.Popen(  # noqa: S603 - an argument list, no shell
            [sys.executable, "-c", code, repository, str(path), "checkout" if checkout else "dir"],
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
    processes = OsProcesses()
    return World(
        github=GhGitHub(run),
        git=CliGit(run, str(target)),
        clock=clock,
        machine=LocalMachine(run),
        plans=T3Plans(clock, caches),
        processes=processes,
        validation_lock=ValidationLock(processes=processes, clock=clock),
    )
