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
    def issue(self, repo: str, number: int) -> dict[str, Any] | None:
        """One issue; only this read carries ``closedBy``, the numbers of the repository's pull
        requests, open or closed, that close it (GitHub's closing references), and ``type``
        (the type's name or None), ``parent`` (the parent's number in this repository,
        ``owner/name#number`` in another, or None) and ``subIssues`` (how many it has)."""
        ...

    def issues(self, repo: str) -> list[dict[str, Any]]: ...
    def pull(self, repo: str, number: int) -> dict[str, Any] | None: ...
    def pulls(self, repo: str) -> list[dict[str, Any]]: ...
    def repo_labels(self, repo: str) -> list[str]: ...
    def set_labels(self, repo: str, number: int, labels: list[str]) -> None: ...
    def comments(self, repo: str, number: int) -> list[dict[str, Any]]: ...
    def add_comment(self, repo: str, number: int, body: str) -> dict[str, Any]: ...
    def create_issue(
        self, repo: str, title: str, body: str, labels: list[str], type: str | None = None
    ) -> int:
        """File an issue, with the issue type named ``type`` when one is given."""
        ...

    def issue_types(self, repo: str) -> list[str]:
        """The names of the issue types the repository's organization offers it."""
        ...

    def set_issue_type(self, repo: str, number: int, type: str | None) -> None:
        """Set the issue's type by name, or clear it with None."""
        ...

    def add_sub_issue(self, repo: str, parent: int, child: int) -> None:
        """Make ``child`` a sub-issue of ``parent``, replacing any parent it has."""
        ...

    def remove_sub_issue(self, repo: str, parent: int, child: int) -> None:
        """Detach ``child`` from ``parent``."""
        ...

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
    def enqueue_pull(self, repo: str, number: int, head: str) -> dict[str, Any]:
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

    def check_runs(self, repo: str, head: str) -> list[dict[str, Any]]: ...
    def create_check_run(self, repo: str, head: str, run: dict[str, Any]) -> None: ...
    def variable(self, repo: str, name: str) -> str | None: ...
    def set_variable(self, repo: str, name: str, value: str) -> None: ...
    def issue_events(self, repo: str) -> list[dict[str, Any]]: ...
    def comment_feed(self, repo: str) -> list[dict[str, Any]]: ...
    def actions_status(self) -> dict[str, Any] | None: ...
    def rate_limit(self) -> dict[str, Any]: ...
    def ages(self) -> dict[str, int | None]:
        """Credential ages in seconds for gateway-status: ``appKey`` (seconds since the key file
        was modified) and ``token`` (seconds left on the current installation token)."""
        ...

    def now(self) -> str | None: ...


def marker(kind: str, payload: dict[str, Any] | str) -> str:
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
    "ages",
    "issueTypes",
    "githubUnavailable",
}


def fake_world(data: dict[str, Any], repo: str) -> dict[str, Any]:
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

    def _check(self, repo: str) -> dict[str, Any]:
        if self._data.get("githubUnavailable"):
            raise GitHubUnavailable("GitHub answered 503")
        if repo != self._data["repo"]:
            return {}
        data: dict[str, Any] = self._data
        return data

    @contextmanager
    def _write(self, repo: str) -> Iterator[dict[str, Any]]:
        data = self._check(repo)
        yield data
        self.path.write_text(json.dumps(self._data, indent=2), encoding="utf-8")

    def _issue(self, data: dict[str, Any], number: int) -> dict[str, Any] | None:
        return next((i for i in data.get("issues", []) if i["number"] == number), None)

    def _pull(self, data: dict[str, Any], number: int) -> dict[str, Any] | None:
        return next((p for p in data.get("pullRequests", []) if p["number"] == number), None)

    def _next_number(self, data: dict[str, Any]) -> int:
        numbers = [i["number"] for i in data.get("issues", [])]
        numbers += [p["number"] for p in data.get("pullRequests", [])]
        return max(numbers, default=0) + 1

    # ── reads ─────────────────────────────────────────────────────────────

    def now(self) -> str | None:
        val = self._data.get("now")
        return str(val) if val is not None else None

    def issue(self, repo: str, number: int) -> dict[str, Any] | None:
        data = self._check(repo)
        issue = copy.deepcopy(self._issue(data, number))
        if issue is not None:
            pulls = data.get("pullRequests", [])
            issue["closedBy"] = sorted(p["number"] for p in pulls if number in p.get("closes", []))
            issue.setdefault("type", None)
            issue.setdefault("parent", None)
            issue["subIssues"] = sum(
                1 for other in data.get("issues", []) if other.get("parent") == number
            )
        return issue

    def issues(self, repo: str) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = copy.deepcopy(self._check(repo).get("issues", []))
        return items

    def pull(self, repo: str, number: int) -> dict[str, Any] | None:
        return copy.deepcopy(self._pull(self._check(repo), number))

    def pulls(self, repo: str) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = copy.deepcopy(self._check(repo).get("pullRequests", []))
        return items

    def repo_labels(self, repo: str) -> list[str]:
        return list(self._check(repo).get("labels", []))

    def comments(self, repo: str, number: int) -> list[dict[str, Any]]:
        issue = self._issue(self._check(repo), number)
        items: list[dict[str, Any]] = copy.deepcopy(issue.get("comments", [])) if issue else []
        return items

    def ref(self, repo: str, ref: str) -> str | None:
        val = self._check(repo).get("refs", {}).get(ref)
        return str(val) if val is not None else None

    def has_commit(self, repo: str, sha: str) -> bool:
        data = self._check(repo)
        heads = set(data.get("refs", {}).values()) | set(data.get("checkRuns", {}))
        heads |= {pull.get("head") for pull in data.get("pullRequests", [])}
        return sha in heads

    def on_main(self, repo: str, sha: str) -> bool:
        data = self._check(repo)
        return sha == data.get("refs", {}).get("refs/heads/main") or sha in data.get(
            "mainHistory", []
        )

    def _merge_method(self, data: dict[str, Any], method: str) -> None:
        allowed = data.get("allowedMergeMethods")
        if allowed is not None and method not in allowed:
            raise MergeMethodNotAllowed(method)

    def check_runs(self, repo: str, head: str) -> list[dict[str, Any]]:
        data = self._check(repo)
        runs: list[dict[str, Any]] = []
        for pull in data.get("pullRequests", []):
            if pull.get("head") == head:
                runs += copy.deepcopy(pull.get("checks", []))
        extra: list[dict[str, Any]] = copy.deepcopy(data.get("checkRuns", {}).get(head, []))
        return runs + extra

    def variable(self, repo: str, name: str) -> str | None:
        val = self._check(repo).get("variables", {}).get(name)
        return str(val) if val is not None else None

    def issue_events(self, repo: str) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = copy.deepcopy(self._check(repo).get("issueEvents", []))
        return items

    def comment_feed(self, repo: str) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = copy.deepcopy(self._check(repo).get("issueComments", []))
        return items

    def actions_status(self) -> dict[str, Any] | None:
        val: dict[str, Any] | None = copy.deepcopy(self._data.get("actionsStatus"))
        return val

    def rate_limit(self) -> dict[str, Any]:
        val: dict[str, Any] = copy.deepcopy(
            self._data.get("rateLimit")
            or {
                "remaining": 5000,
                "limit": 5000,
                "graphql": {"remaining": 5000, "limit": 5000},
            }
        )
        return val

    def ages(self) -> dict[str, Any]:
        val: dict[str, Any] = copy.deepcopy(self._data.get("ages") or {"appKey": 0, "token": 3600})
        return val

    # ── writes, all as the App's bot ──────────────────────────────────────

    def _require_issue(self, data: dict[str, Any], number: int) -> dict[str, Any]:
        issue = self._issue(data, number)
        if issue is None:
            raise KeyError(f"unknown issue #{number}")
        return issue

    def _require_pull(self, data: dict[str, Any], number: int) -> dict[str, Any]:
        pull = self._pull(data, number)
        if pull is None:
            raise KeyError(f"unknown pull request #{number}")
        return pull

    def set_labels(self, repo: str, number: int, labels: list[str]) -> None:
        with self._write(repo) as data:
            target = self._issue(data, number) or self._pull(data, number)
            if target is None:
                raise KeyError(f"unknown issue or pull request #{number}")
            target["labels"] = list(labels)

    def add_comment(self, repo: str, number: int, body: str) -> dict[str, Any]:
        with self._write(repo) as data:
            data["nextCommentId"] = data.get("nextCommentId", 90_000) + 1
            comment = {
                "id": data["nextCommentId"],
                "author": self.bot,
                "at": data.get("now"),
                "body": body,
            }
            issue = self._require_issue(data, number)
            issue.setdefault("comments", []).append(comment)
            return copy.deepcopy(comment)

    def create_issue(
        self, repo: str, title: str, body: str, labels: list[str], type: str | None = None
    ) -> int:
        with self._write(repo) as data:
            self._type_offered(data, type)
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
                    "type": type,
                    "parent": None,
                }
            )
            return number

    def issue_types(self, repo: str) -> list[str]:
        return list(self._check(repo).get("issueTypes", []))

    @staticmethod
    def _type_offered(data: dict[str, Any], type: str | None) -> None:
        if type is not None and type not in data.get("issueTypes", []):
            raise GitHubRefused(422, f"Issue type {type} does not exist")

    def set_issue_type(self, repo: str, number: int, type: str | None) -> None:
        with self._write(repo) as data:
            self._type_offered(data, type)
            self._require_issue(data, number)["type"] = type

    def add_sub_issue(self, repo: str, parent: int, child: int) -> None:
        """As GitHub does: an issue cannot be its own parent or its ancestor's; 100 at most."""
        with self._write(repo) as data:
            issue = self._require_issue(data, child)
            self._require_issue(data, parent)
            above: int | None = parent
            while above is not None:
                if above == child:
                    raise GitHubRefused(422, "An issue cannot be a sub-issue of itself")
                above = (self._issue(data, above) or {}).get("parent")
            siblings = [i for i in data["issues"] if i.get("parent") == parent]
            if len(siblings) >= 100:
                raise GitHubRefused(422, "Parent cannot have more than 100 sub-issues")
            issue["parent"] = parent

    def remove_sub_issue(self, repo: str, parent: int, child: int) -> None:
        with self._write(repo) as data:
            issue = self._require_issue(data, child)
            if issue.get("parent") != parent:
                raise GitHubRefused(404, f"#{child} is not a sub-issue of #{parent}")
            issue["parent"] = None

    def update_ref(self, repo: str, ref: str, head: str, expected: str | None = None) -> None:
        with self._write(repo) as data:
            refs = data.setdefault("refs", {})
            if refs.get(ref) != expected:
                raise HeadMoved(refs.get(ref) or "")
            refs[ref] = head

    def create_pull(self, repo: str, branch: str, title: str, body: str, **extra: Any) -> int:
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

    def update_pull(self, repo: str, number: int, *, title: str, body: str) -> None:
        with self._write(repo) as data:
            pull = self._require_pull(data, number)
            pull.update(title=title, body=body, closes=_closes(body))

    def merge_pull(self, repo: str, number: int, head: str, method: str) -> str:
        with self._write(repo) as data:
            pull = self._require_pull(data, number)
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
            merged_at = pull["mergedAt"]
            return str(merged_at) if merged_at is not None else ""

    def enable_auto_merge(self, repo: str, number: int, head: str, method: str) -> None:
        """Behind a merge queue (the pull request's ``mergeQueue.required``) GitHub takes a
        pull request that is clean and whose checks all passed into the queue at once; any
        other waits with auto-merge set, as without a queue."""
        with self._write(repo) as data:
            self._merge_method(data, method)
            pull = self._require_pull(data, number)
            pull.update(autoMerge=True, autoMergeHead=head, autoMergeMethod=method)
            queue = pull.get("mergeQueue") or {}
            green = pull.get("mergeable") == "MERGEABLE" and all(
                run.get("conclusion") == "success" for run in pull.get("checks", [])
            )
            if queue.get("required") and green:
                self._enqueue(pull, head)

    def disable_auto_merge(self, repo: str, number: int) -> None:
        """GitHub refuses to turn off auto-merge that is not set."""
        with self._write(repo) as data:
            pull = self._require_pull(data, number)
            if not pull.get("autoMerge"):
                raise GitHubRefused(200, "Can't disable auto-merge for this pull request")
            pull.update(autoMerge=False, autoMergeHead=None)

    def _enqueue(self, pull: dict[str, Any], head: str) -> None:
        pull["mergeQueue"] = {
            **(pull.get("mergeQueue") or {}),
            "queued": True,
            "state": "QUEUED",
            "position": 1,
            "head": head,
        }

    def enqueue_pull(self, repo: str, number: int, head: str) -> dict[str, Any]:
        with self._write(repo) as data:
            pull = self._require_pull(data, number)
            if pull["head"] != head:
                raise HeadMoved(pull["head"])
            if not (pull.get("mergeQueue") or {}).get("required"):
                raise GitHubRefused(200, "Merge queue is not enabled for the base branch")
            self._enqueue(pull, head)
            return {"state": "QUEUED", "position": 1}

    def dequeue_pull(self, repo: str, number: int) -> None:
        with self._write(repo) as data:
            pull = self._require_pull(data, number)
            pull["mergeQueue"] = {"required": bool((pull.get("mergeQueue") or {}).get("required"))}

    def create_revert(self, repo: str, number: int, title: str, body: str) -> int:
        original = self.pull(repo, number)
        if original is None:
            raise KeyError(f"unknown pull request #{number}")
        branch = f"revert-{number}"
        head = fake_head(f"revert:{number}:{original['head']}")
        self.update_ref(repo, f"refs/heads/{branch}", head, self.ref(repo, f"refs/heads/{branch}"))
        return self.create_pull(repo, branch, title, body, revertOf=number)

    def create_check_run(self, repo: str, head: str, run: dict[str, Any]) -> None:
        with self._write(repo) as data:
            data.setdefault("checkRuns", {}).setdefault(head, []).append(
                {**run, "app": self.bot, "status": "completed", "completedAt": data.get("now")}
            )

    def set_variable(self, repo: str, name: str, value: str) -> None:
        with self._write(repo) as data:
            data.setdefault("variables", {})[name] = value


def _closes(body: str) -> list[int]:
    return [int(n) for n in re.findall(r"(?im)^closes #(\d+)$", body or "")]


def comment_url(repo: str, number: int, comment_id: Any) -> str:
    return f"https://github.com/{repo}/issues/{number}#issuecomment-{comment_id}"
