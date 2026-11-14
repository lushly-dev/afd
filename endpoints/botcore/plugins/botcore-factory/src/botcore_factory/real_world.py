"""The world as it is: GitHub through ``gh``, git, the system clock, this machine, T3 Code's
plan caches and the operating system's processes.

This is the only module that starts processes. Every command is an argument list, never a
shell string, and on Windows the program is started by its resolved path (``shutil.which``),
so ``gh`` is found without a shell. Each class takes a ``run`` callable so tests can answer
for ``gh`` and ``git`` without calling them.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
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

    def open_pr(self, branch: str, title: str, body: str) -> int:
        found = parse_json(
            self.run(["gh", "pr", "list", "--head", branch, "--state", "open", "--json", "number"]),
            "gh pr list",
        )
        if found:
            return int(found[0]["number"])
        url = self.run(
            ["gh", "pr", "create", "--head", branch, "--title", title, "--body-file", "-"], body
        ).strip()
        return int(url.rstrip("/").rsplit("/", 1)[-1])

    def check_status(self, pr: int, name: str) -> str:
        # gh exits nonzero while checks fail or are pending; its JSON still says which.
        out = self.run(["gh", "pr", "checks", str(pr), "--json", "name,bucket"], None, False)
        for check in parse_json(out.strip() or "[]", "gh pr checks"):
            if check.get("name") == name:
                bucket = check.get("bucket", "")
                return {"pass": "success", "fail": "failure", "cancel": "failure"}.get(
                    bucket, "pending"
                )
        return "missing"

    def merge_pr(self, pr: int, head: str) -> None:
        self.run(["gh", "pr", "merge", str(pr), "--squash", "--match-head-commit", head])

    def pr_state(self, pr: int) -> str:
        data = parse_json(self.run(["gh", "pr", "view", str(pr), "--json", "state"]), "gh pr")
        return str(data.get("state", "OPEN"))


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
        base = since or "origin/HEAD"
        out = self.run(["git", "-C", worktree, "diff", "--name-only", f"{base}...HEAD"])
        return [line for line in out.splitlines() if line.strip()]

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
        try:
            return (Path(worktree) / path).read_text(encoding="utf-8")
        except OSError:
            return None

    def fetch_main(self) -> str:
        self.run(["git", "fetch", "--quiet", "--no-tags", "origin"])
        return self.run(["git", "rev-parse", "origin/HEAD"]).strip()

    def _slot_path(self, slot: str) -> str:
        common = self.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"])
        return str(Path(common.strip()) / "factory" / "slots" / slot)

    def prepare_slot(self, slot: str, branch: str, head: str) -> str:
        path = self._slot_path(slot)
        if branch != "main":
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

    def merge_main(self, path: str, main: str) -> MergeOutcome:
        identity = ["-c", "user.name=botcore-factory", "-c", "user.email=factory@localhost"]
        # A conflict exits nonzero; the unmerged paths say so, and the merge is aborted.
        self.run(["git", "-C", path, *identity, "merge", "--no-edit", "--quiet", main], None, False)
        conflicts = self.run(["git", "-C", path, "diff", "--name-only", "--diff-filter=U"])
        files = tuple(line for line in conflicts.splitlines() if line.strip())
        if files:
            self.run(["git", "-C", path, "merge", "--abort"])
            return MergeOutcome(False, conflicts=files)
        return MergeOutcome(True, head=self.head(path))

    def tree(self, path: str) -> str:
        return self.run(["git", "-C", path, "rev-parse", "HEAD^{tree}"]).strip()

    def push_branch(self, path: str, branch: str) -> str:
        head = self.head(path)
        self.run(["git", "-C", path, "push", "--quiet", "origin", f"HEAD:refs/heads/{branch}"])
        return head


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
