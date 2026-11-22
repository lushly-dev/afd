"""The gateway's port to GitHub, and the fake that the jobs and tests run against.

``GitHub`` is everything the gateway's commands need from GitHub, in GitHub's own shapes:
REST-style states (``open``/``closed`` plus ``merged``), ``mergeable`` as GitHub computes it
(``MERGEABLE``, ``CONFLICTING``, ``BLOCKED``, ``UNKNOWN``), check runs per head. The gateway
normalises them; the port does not. Every method may raise ``GitHubUnavailable``.

``FakeGitHub`` keeps one repository's state in a JSON file (a scenario fixture's GitHub part,
normalised by ``fake_world``), so each scenario step, a separate process, sees the last one's
writes. It is not a GitHub simulator: it models what the jobs exercise and no more.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Protocol


class GitHubUnavailable(Exception):
    """GitHub did not answer, or answered 5xx; the same call may be retried."""


class GitHubRefused(Exception):
    """GitHub refused the call (a 4xx other than a rate limit); repeating it will not help."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"{status}: {message}" if status else message)
        self.status = status
        self.message = message


class AlreadyMergeable(Exception):
    """GitHub refused auto-merge because the pull request can merge now ("clean status")."""


class HeadMoved(Exception):
    """GitHub refused a merge because the pull request's head is no longer the given sha."""

    def __init__(self, head: str) -> None:
        super().__init__(head)
        self.head = head


class MergeMethodNotAllowed(Exception):
    """GitHub refused a merge because the repository does not allow the method (405)."""

    def __init__(self, method: str) -> None:
        super().__init__(method)
        self.method = method


class GitHub(Protocol):
    def issue(self, repo: str, number: int) -> dict | None: ...
    def issues(self, repo: str) -> list[dict]: ...
    def pull(self, repo: str, number: int) -> dict | None: ...
    def pulls(self, repo: str) -> list[dict]: ...
    def repo_labels(self, repo: str) -> list[str]: ...
    def set_labels(self, repo: str, number: int, labels: list[str]) -> None: ...
    def comments(self, repo: str, number: int) -> list[dict]: ...
    def add_comment(self, repo: str, number: int, body: str) -> dict: ...
    def create_issue(self, repo: str, title: str, body: str, labels: list[str]) -> int: ...
    def ref(self, repo: str, ref: str) -> str | None: ...
    def has_commit(self, repo: str, sha: str) -> bool:
        """Whether ``sha`` is a head this repository has shown: a ref tip, a pull request's
        head or a commit with check runs. verification-record records only such heads."""
        ...

    def on_main(self, repo: str, sha: str) -> bool:
        """Whether ``sha`` is reachable from the default branch (the compare API's
        ``identical`` or ``behind``), so a push does not add it. A commit on another branch,
        a queue ref or a fork is not on main."""
        ...

    def update_ref(self, repo: str, ref: str, head: str, expected: str | None = None) -> None:
        """Point ``ref`` at ``head`` only if it is still at ``expected`` (None: absent);
        ``HeadMoved`` with its current head otherwise."""
        ...

    def create_pull(self, repo: str, branch: str, title: str, body: str) -> int:
        """Open a pull request; GitHub links the issues its body's closing lines name."""
        ...

    def update_pull(self, repo: str, number: int, *, title: str, body: str) -> None: ...
    def merge_pull(self, repo: str, number: int, head: str, method: str) -> str:
        """Merge at ``head`` by ``method`` (GitHub's sha guard); returns the merged-at time."""
        ...

    def enable_auto_merge(self, repo: str, number: int, head: str, method: str) -> None:
        """Auto-merge by ``method``, bound to ``head`` (GraphQL expectedHeadOid);
        ``AlreadyMergeable`` when there is nothing left to wait for."""
        ...

    def disable_auto_merge(self, repo: str, number: int) -> None: ...
    def enqueue_pull(self, repo: str, number: int, head: str) -> dict:
        """Add the pull request to its base's merge queue, bound to ``head`` (GraphQL
        enqueuePullRequest with expectedHeadOid), and return the entry GitHub made
        (``state``, ``position``); ``HeadMoved`` when the head is another, ``GitHubRefused``
        when GitHub made no entry. A pull request says whether its base has a queue
        (``mergeQueue.required``) and, once a queue let it go, when and why
        (``mergeQueue.removed {at, reason}``: ``failed_checks``, ``merged``, ...)."""
        ...

    def dequeue_pull(self, repo: str, number: int) -> None:
        """Take the pull request out of the merge queue (GraphQL dequeuePullRequest)."""
        ...

    def create_revert(self, repo: str, number: int, title: str, body: str) -> int:
        """A pull request reverting a merged one (GraphQL revertPullRequest)."""
        ...

    def check_runs(self, repo: str, head: str) -> list[dict]: ...
    def create_check_run(self, repo: str, head: str, run: dict) -> None: ...
    def variable(self, repo: str, name: str) -> str | None: ...
    def set_variable(self, repo: str, name: str, value: str) -> None: ...
    def issue_events(self, repo: str) -> list[dict]: ...
    def comment_feed(self, repo: str) -> list[dict]: ...
    def actions_status(self) -> dict | None: ...
    def rate_limit(self) -> dict: ...
    def now(self) -> str | None: ...


def marker(kind: str, payload: dict | str) -> str:
    """A hidden comment marker: ``<!-- kind {...} -->`` (or a bare value)."""
    value = payload if isinstance(payload, str) else json.dumps(payload, sort_keys=True)
    return f"<!-- {kind} {value} -->"


#: The fixture's GitHub part: everything a GitHub read could return, plus the clock.
GITHUB_KEYS = {
    "now",
    "labels",
    "issues",
    "branches",
    "refs",
    "mainHistory",
    "allowedMergeMethods",
    "pullRequests",
    "claimComments",
    "checkRuns",
    "variables",
    "issueEvents",
    "issueComments",
    "actionsStatus",
    "rateLimit",
    "githubUnavailable",
    "cache",
}


def fake_world(data: dict, repo: str) -> dict:
    """Normalise a fixture's GitHub part: branches become refs, claim comments become
    comments on their issues with the marker their author wrote. Idempotent."""
    world = copy.deepcopy({key: value for key, value in data.items() if key in GITHUB_KEYS})
    world["repo"] = repo
    refs = world.setdefault("refs", {})
    for branch, head in world.pop("branches", {}).items():
        refs[f"refs/heads/{branch}"] = head
    issues = {issue["number"]: issue for issue in world.setdefault("issues", [])}
    next_id = 80_000
    for issue in issues.values():
        issue.setdefault("comments", [])
        issue.setdefault("labels", [])
    for claim in world.pop("claimComments", []):
        issue = issues.get(claim["number"])
        if issue is None:
            raise ValueError(f"Claim comment on #{claim['number']}, which the fixture lacks")
        next_id += 1
        issue["comments"].append(
            {
                "id": next_id,
                "author": claim["author"],
                "at": claim["at"],
                "body": marker(claim["marker"], claim["claim"]),
            }
        )
    world.setdefault("pullRequests", [])
    world.setdefault("checkRuns", {})
    world.setdefault("variables", {})
    world["nextCommentId"] = max(next_id, 90_000)
    return world


def fake_head(seed: str) -> str:
    return hashlib.sha1(seed.encode("utf-8")).hexdigest()  # noqa: S324 - an id, not security


class FakeGitHub:
    """One repository's GitHub in a JSON file, written back after each change."""

    def __init__(self, path: Path, *, bot: str) -> None:
        self.path = path
        self.bot = bot
        self._data = json.loads(path.read_text(encoding="utf-8"))

    def refresh(self) -> None:
        """Read the file again, as a poll of GitHub would."""
        self._data = json.loads(self.path.read_text(encoding="utf-8"))

    # ── plumbing ──────────────────────────────────────────────────────────

    def _check(self, repo: str) -> dict:
        if self._data.get("githubUnavailable"):
            raise GitHubUnavailable("GitHub answered 503")
        if repo != self._data["repo"]:
            return {}
        return self._data

    @contextmanager
    def _write(self, repo: str) -> Iterator[dict]:
        data = self._check(repo)
        yield data
        self.path.write_text(json.dumps(self._data, indent=2), encoding="utf-8")

    def _issue(self, data: dict, number: int) -> dict | None:
        return next((i for i in data.get("issues", []) if i["number"] == number), None)

    def _pull(self, data: dict, number: int) -> dict | None:
        return next((p for p in data.get("pullRequests", []) if p["number"] == number), None)

    def _next_number(self, data: dict) -> int:
        numbers = [i["number"] for i in data.get("issues", [])]
        numbers += [p["number"] for p in data.get("pullRequests", [])]
        return max(numbers, default=0) + 1

    # ── reads ─────────────────────────────────────────────────────────────

    def now(self) -> str | None:
        return self._data.get("now")

    def issue(self, repo, number):
        return copy.deepcopy(self._issue(self._check(repo), number))

    def issues(self, repo):
        return copy.deepcopy(self._check(repo).get("issues", []))

    def pull(self, repo, number):
        return copy.deepcopy(self._pull(self._check(repo), number))

    def pulls(self, repo):
        return copy.deepcopy(self._check(repo).get("pullRequests", []))

    def repo_labels(self, repo):
        return list(self._check(repo).get("labels", []))

    def comments(self, repo, number):
        issue = self._issue(self._check(repo), number)
        return copy.deepcopy(issue.get("comments", [])) if issue else []

    def ref(self, repo, ref):
        return self._check(repo).get("refs", {}).get(ref)

    def has_commit(self, repo, sha):
        data = self._check(repo)
        heads = set(data.get("refs", {}).values()) | set(data.get("checkRuns", {}))
        heads |= {pull.get("head") for pull in data.get("pullRequests", [])}
        return sha in heads

    def on_main(self, repo, sha):
        data = self._check(repo)
        return sha == data.get("refs", {}).get("refs/heads/main") or sha in data.get(
            "mainHistory", []
        )

    def _merge_method(self, data: dict, method: str) -> None:
        allowed = data.get("allowedMergeMethods")
        if allowed is not None and method not in allowed:
            raise MergeMethodNotAllowed(method)

    def check_runs(self, repo, head):
        data = self._check(repo)
        runs = []
        for pull in data.get("pullRequests", []):
            if pull.get("head") == head:
                runs += copy.deepcopy(pull.get("checks", []))
        return runs + copy.deepcopy(data.get("checkRuns", {}).get(head, []))

    def variable(self, repo, name):
        return self._check(repo).get("variables", {}).get(name)

    def issue_events(self, repo):
        return copy.deepcopy(self._check(repo).get("issueEvents", []))

    def comment_feed(self, repo):
        return copy.deepcopy(self._check(repo).get("issueComments", []))

    def actions_status(self):
        return copy.deepcopy(self._data.get("actionsStatus"))

    def rate_limit(self):
        return copy.deepcopy(self._data.get("rateLimit") or {"remaining": 5000, "limit": 5000})

    # ── writes, all as the App's bot ──────────────────────────────────────

    def set_labels(self, repo, number, labels):
        with self._write(repo) as data:
            target = self._issue(data, number) or self._pull(data, number)
            target["labels"] = list(labels)

    def add_comment(self, repo, number, body):
        with self._write(repo) as data:
            data["nextCommentId"] = data.get("nextCommentId", 90_000) + 1
            comment = {
                "id": data["nextCommentId"],
                "author": self.bot,
                "at": data.get("now"),
                "body": body,
            }
            self._issue(data, number).setdefault("comments", []).append(comment)
            return copy.deepcopy(comment)

    def create_issue(self, repo, title, body, labels):
        with self._write(repo) as data:
            number = self._next_number(data)
            data["issues"].append(
                {
                    "number": number,
                    "state": "open",
                    "title": title,
                    "body": body,
                    "labels": list(labels),
                    "author": {"login": self.bot, "association": "NONE"},
                    "comments": [],
                }
            )
            return number

    def update_ref(self, repo, ref, head, expected=None):
        with self._write(repo) as data:
            refs = data.setdefault("refs", {})
            if refs.get(ref) != expected:
                raise HeadMoved(refs.get(ref) or "")
            refs[ref] = head

    def create_pull(self, repo, branch, title, body, **extra):
        with self._write(repo) as data:
            number = self._next_number(data)
            data["pullRequests"].append(
                {
                    "number": number,
                    "state": "open",
                    "branch": branch,
                    "head": data.get("refs", {}).get(f"refs/heads/{branch}")
                    or fake_head(f"{branch}:{number}"),
                    "title": title,
                    "body": body,
                    "author": self.bot,
                    "mergeable": "UNKNOWN",
                    "checks": [],
                    "autoMerge": False,
                    "closes": _closes(body),
                    **extra,
                }
            )
            return number

    def update_pull(self, repo, number, *, title, body):
        with self._write(repo) as data:
            self._pull(data, number).update(title=title, body=body, closes=_closes(body))

    def merge_pull(self, repo, number, head, method):
        with self._write(repo) as data:
            pull = self._pull(data, number)
            if pull["head"] != head:
                raise HeadMoved(pull["head"])  # GitHub answers 409 to a stale sha.
            self._merge_method(data, method)
            pull.update(
                state="merged", mergedAt=data.get("now"), autoMerge=False, mergeMethod=method
            )
            for issue_number in pull.get("closes", []):
                issue = self._issue(data, issue_number)
                if issue is not None:
                    issue["state"] = "closed"
            return pull["mergedAt"]

    def enable_auto_merge(self, repo, number, head, method):
        """Behind a merge queue (the pull request's ``mergeQueue.required``) GitHub takes a
        pull request that is clean and whose checks all passed into the queue at once; any
        other waits with auto-merge set, as without a queue."""
        with self._write(repo) as data:
            self._merge_method(data, method)
            pull = self._pull(data, number)
            pull.update(autoMerge=True, autoMergeHead=head, autoMergeMethod=method)
            queue = pull.get("mergeQueue") or {}
            green = pull.get("mergeable") == "MERGEABLE" and all(
                run.get("conclusion") == "success" for run in pull.get("checks", [])
            )
            if queue.get("required") and green:
                self._enqueue(pull, head)

    def disable_auto_merge(self, repo, number):
        """GitHub refuses to turn off auto-merge that is not set."""
        with self._write(repo) as data:
            pull = self._pull(data, number)
            if not pull.get("autoMerge"):
                raise GitHubRefused(200, "Can't disable auto-merge for this pull request")
            pull.update(autoMerge=False, autoMergeHead=None)

    def _enqueue(self, pull: dict, head: str) -> None:
        pull["mergeQueue"] = {
            **(pull.get("mergeQueue") or {}),
            "queued": True,
            "state": "QUEUED",
            "position": 1,
            "head": head,
        }

    def enqueue_pull(self, repo, number, head):
        with self._write(repo) as data:
            pull = self._pull(data, number)
            if pull["head"] != head:
                raise HeadMoved(pull["head"])
            if not (pull.get("mergeQueue") or {}).get("required"):
                raise GitHubRefused(200, "Merge queue is not enabled for the base branch")
            self._enqueue(pull, head)
            return {"state": "QUEUED", "position": 1}

    def dequeue_pull(self, repo, number):
        with self._write(repo) as data:
            pull = self._pull(data, number)
            pull["mergeQueue"] = {"required": bool((pull.get("mergeQueue") or {}).get("required"))}

    def create_revert(self, repo, number, title, body):
        original = self.pull(repo, number)
        branch = f"revert-{number}"
        head = fake_head(f"revert:{number}:{original['head']}")
        self.update_ref(repo, f"refs/heads/{branch}", head, self.ref(repo, f"refs/heads/{branch}"))
        return self.create_pull(repo, branch, title, body, revertOf=number)

    def create_check_run(self, repo, head, run):
        with self._write(repo) as data:
            data.setdefault("checkRuns", {}).setdefault(head, []).append(
                {**run, "app": self.bot, "status": "completed", "completedAt": data.get("now")}
            )

    def set_variable(self, repo, name, value):
        with self._write(repo) as data:
            data.setdefault("variables", {})[name] = value


def _closes(body: str) -> list[int]:
    return [int(n) for n in re.findall(r"(?im)^closes #(\d+)$", body or "")]


def comment_url(repo: str, number: int, comment_id: Any) -> str:
    return f"https://github.com/{repo}/issues/{number}#issuecomment-{comment_id}"
