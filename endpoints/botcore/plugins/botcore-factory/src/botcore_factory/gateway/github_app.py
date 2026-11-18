"""The gateway's port to the real GitHub, as the factory's GitHub App.

``GitHubApp`` answers every ``GitHub`` method in the shapes ``FakeGitHub`` returns, so the
commands cannot tell them apart. It signs a JWT with the App's private key, exchanges it for an
installation token (an hour; refreshed five minutes early) and never hands that token to a
caller or puts it on a command line: git reads it from its environment.

- Reads that would cost a call per item (issues with their comments, pull requests with the
  issues they close) are one GraphQL query per page; the rest is REST.
- Pushes go from the gateway's bare mirror of the repository, where the caller's bundle put
  the objects, with ``git push --force-with-lease`` against the head the command read, so a
  ref that moved in between is refused by GitHub rather than overwritten (``HeadMoved``).
- A connection failure, a timeout, a 5xx or a secondary rate limit is ``GitHubUnavailable``
  (the call may be repeated); any other refusal is ``GitHubRefused`` with GitHub's message.

Lists are bounded: open issues and pull requests in full, plus the most recently updated
closed ones (``RECENT_CLOSED``), and the repository-wide feeds' latest ``FEED_SIZE`` items.
"""

from __future__ import annotations

import base64
import os
import re
import stat
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
import jwt

from botcore_factory.gateway import uploads
from botcore_factory.gateway.github import (
    AlreadyMergeable,
    GitHubRefused,
    GitHubUnavailable,
    HeadMoved,
    MergeMethodNotAllowed,
)
from botcore_factory.squash import squash_body

API = "https://api.github.com"
STATUS_API = "https://www.githubstatus.com/api/v2/incidents/unresolved.json"
#: Closed issues and pull requests read beside the open ones, most recently updated first.
RECENT_CLOSED = 100
#: Items read from the repository-wide event and comment feeds.
FEED_SIZE = 100
#: Seconds before an installation token's expiry at which a new one is made.
TOKEN_MARGIN = 300
#: Seconds the first fetch of a repository's main into an empty mirror may take.
FIRST_FETCH_SECONDS = 1800.0
_METHODS = {"merge": "MERGE", "squash": "SQUASH", "rebase": "REBASE"}
_REVERT_BRANCH = re.compile(r"^revert-(\d+)-")


def read_private_key(path: Path) -> str:
    """The App's private key, refused when anyone but its owner can read the file."""
    if os.name == "nt":
        return _read_private_key_windows(path)
    info = path.stat()
    if info.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise ValueError(f"{path} is readable by others; chmod 600 it, owned by the service user")
    if hasattr(os, "getuid") and info.st_uid != os.getuid():
        raise ValueError(f"{path} belongs to another user; chown it to the service user")
    return path.read_text(encoding="utf-8")


def _read_private_key_windows(path: Path) -> str:
    # Windows reports every writable file as mode 0o666, so judge the ACL instead, by
    # Botcore's token-store rule: owned by and granted only to this user, SYSTEM and
    # Administrators, and not a reparse point. An unreadable ACL is refused.
    from botcore._windows_security import open_private

    try:
        descriptor = open_private(path)
    except PermissionError as error:
        raise ValueError(
            f"{path} is not private to the service user ({error}); grant only the service "
            "user, SYSTEM and Administrators, and make the service user its owner"
        ) from None
    with os.fdopen(descriptor, encoding="utf-8") as key:
        return key.read()


class GitHubApp:
    """The GitHub port as one App installation."""

    def __init__(
        self,
        *,
        app_id: int,
        installation_id: int,
        private_key: str,
        bot: str,
        data_dir: Path,
        transport: httpx.BaseTransport | None = None,
        clock: Any = time.time,
        git_url: str = "https://github.com",
    ) -> None:
        self.app_id = app_id
        self.installation_id = installation_id
        self.bot = bot
        self.data_dir = data_dir
        self._key = private_key
        self._clock = clock
        self._git_url = git_url.rstrip("/")
        self._http = httpx.Client(
            base_url=API,
            transport=transport,
            timeout=httpx.Timeout(30.0, connect=10.0),
            headers={
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "factory-gateway",
            },
            follow_redirects=False,
        )
        self._token: tuple[str, float] | None = None
        self._token_lock = threading.Lock()

    # ── credentials ───────────────────────────────────────────────────────

    def _jwt(self) -> str:
        now = int(self._clock())
        claims = {"iat": now - 60, "exp": now + 540, "iss": str(self.app_id)}
        return jwt.encode(claims, self._key, algorithm="RS256")

    def token(self) -> str:
        """A current installation token, made when the last is within its margin of expiry."""
        with self._token_lock:
            if self._token is None or self._token[1] - TOKEN_MARGIN <= self._clock():
                response = self._send(
                    "POST",
                    f"/app/installations/{self.installation_id}/access_tokens",
                    auth=f"Bearer {self._jwt()}",
                )
                if response.status_code != 201:
                    # A bad key or clock (401), or the App uninstalled (404): the operator's.
                    raise GitHubRefused(
                        response.status_code,
                        f"the installation token was refused: {_message(response)}",
                    )
                try:
                    body = response.json()
                    self._token = (body["token"], _epoch(body["expires_at"]))
                except (ValueError, KeyError, TypeError):
                    raise GitHubUnavailable("the installation token answer was malformed") from None
            return self._token[0]

    def token_age(self) -> float | None:
        """Seconds the current token has left, for gateway-status; None before the first."""
        return None if self._token is None else self._token[1] - self._clock()

    # ── transport ─────────────────────────────────────────────────────────

    def _send(self, method: str, url: str, *, auth: str | None = None, **kwargs) -> httpx.Response:
        headers = {"Authorization": auth or f"Bearer {self.token()}"}
        try:
            response = self._http.request(method, url, headers=headers, **kwargs)
        except httpx.HTTPError as exc:
            raise GitHubUnavailable(f"{method} {_path(url)}: {type(exc).__name__}") from None
        if response.status_code >= 500 or _rate_limited(response):
            raise GitHubUnavailable(f"{method} {_path(url)} answered {response.status_code}")
        return response

    def _call(self, method: str, url: str, *, ok=(200, 201, 204), none=(), **kwargs):
        """The decoded body; None for a status in ``none``; GitHubRefused for any other."""
        response = self._send(method, url, **kwargs)
        if response.status_code in none:
            return None
        if response.status_code not in ok:
            raise GitHubRefused(response.status_code, _message(response))
        return response.json() if response.content else None

    def _pages(self, url: str, params: dict | None = None, limit: int | None = None):
        """Every item a paginated REST list returns, following its Link header."""
        items: list = []
        next_url: str | None = url
        query = {"per_page": 100, **(params or {})}
        while next_url and (limit is None or len(items) < limit):
            response = self._send("GET", next_url, params=query)
            if response.status_code != 200:
                raise GitHubRefused(response.status_code, _message(response))
            body = response.json()
            items += body if isinstance(body, list) else body.get("check_runs", [])
            next_url = response.links.get("next", {}).get("url")
            if next_url and not next_url.startswith(f"{API}/"):
                raise GitHubRefused(0, "a page link left the GitHub API")
            query = None  # The next link carries the query.
        return items if limit is None else items[:limit]

    def _graphql(self, query: str, **variables) -> dict:
        body = self._call("POST", "/graphql", json={"query": query, "variables": variables})
        errors = body.get("errors") or []
        if errors:
            kinds = {e.get("type") for e in errors}
            if "RATE_LIMITED" in kinds:
                raise GitHubUnavailable("GraphQL answered RATE_LIMITED")
            if body.get("data") is None or kinds != {"NOT_FOUND"}:
                raise GitHubRefused(200, "; ".join(e.get("message", "") for e in errors))
        return body.get("data") or {}

    def _graph_pages(self, query: str, path: tuple[str, ...], limit: int | None, **variables):
        nodes: list = []
        cursor = None
        while limit is None or len(nodes) < limit:
            data = self._graphql(query, cursor=cursor, **variables)
            connection = data
            for key in path:
                connection = (connection or {}).get(key)
            if connection is None:
                raise GitHubRefused(404, f"GitHub has no {'.'.join(path)} here")
            nodes += connection["nodes"]
            page = connection["pageInfo"]
            if not page["hasNextPage"]:
                break
            cursor = page["endCursor"]
        return nodes if limit is None else nodes[:limit]

    # ── reads ─────────────────────────────────────────────────────────────

    def now(self) -> str | None:
        return None  # The gateway's own clock.

    def issue(self, repo, number):
        data = self._graphql(_ISSUE_QUERY, **_owner_name(repo), number=number)
        node = (data.get("repository") or {}).get("issue")
        return None if node is None else self._issue_shape(repo, node)

    def issues(self, repo):
        found = {}
        for states, limit in ((["OPEN"], None), (["CLOSED"], RECENT_CLOSED)):
            nodes = self._graph_pages(
                _ISSUES_QUERY, ("repository", "issues"), limit, **_owner_name(repo), states=states
            )
            for node in nodes:
                found[node["number"]] = self._issue_shape(repo, node)
        return [found[number] for number in sorted(found)]

    def _issue_shape(self, repo: str, node: dict) -> dict:
        comments = node["comments"]
        rows = [_comment_shape(c) for c in comments["nodes"]]
        if comments["pageInfo"]["hasPreviousPage"]:
            rows = self.comments(repo, node["number"])  # Claims may sit in any comment.
        return {
            "number": node["number"],
            "state": node["state"].lower(),
            "title": node["title"],
            "body": node["body"],
            "labels": [label["name"] for label in node["labels"]["nodes"]],
            "assignees": [a["login"] for a in node["assignees"]["nodes"]],
            "author": {
                "login": _login(node.get("author")),
                "association": node["authorAssociation"],
            },
            "comments": rows,
        }

    def pull(self, repo, number):
        data = self._graphql(_PULL_QUERY, **_owner_name(repo), number=number)
        node = (data.get("repository") or {}).get("pullRequest")
        return None if node is None else _pull_shape(node, self.bot)

    def pulls(self, repo):
        found = {}
        for states, limit in ((["OPEN"], None), (["CLOSED", "MERGED"], RECENT_CLOSED)):
            nodes = self._graph_pages(
                _PULLS_QUERY,
                ("repository", "pullRequests"),
                limit,
                **_owner_name(repo),
                states=states,
            )
            for node in nodes:
                found[node["number"]] = _pull_shape(node, self.bot)
        return [found[number] for number in sorted(found)]

    def repo_labels(self, repo):
        return [label["name"] for label in self._pages(f"/repos/{repo}/labels")]

    def comments(self, repo, number):
        rows = self._pages(f"/repos/{repo}/issues/{number}/comments")
        return [_rest_comment(row) for row in rows]

    def ref(self, repo, ref):
        body = self._call("GET", f"/repos/{repo}/git/ref/{_short(ref)}", none=(404,))
        if not isinstance(body, dict) or not isinstance(body.get("object"), dict):
            return None  # A list is GitHub's prefix match: no ref by that exact name.
        return body["object"].get("sha")

    def has_commit(self, repo, sha):
        if not re.fullmatch(r"[0-9a-f]{40}", sha or ""):
            return False
        return self._call("GET", f"/repos/{repo}/commits/{sha}", none=(404, 422)) is not None

    def on_main(self, repo, sha):
        if not re.fullmatch(r"[0-9a-f]{40}", sha or ""):
            return False
        body = self._call(
            "GET",
            f"/repos/{repo}/compare/main...{sha}",
            params={"per_page": 1},
            none=(404,),
        )
        return body is not None and body.get("status") in {"identical", "behind"}

    def check_runs(self, repo, head):
        rows = self._pages(f"/repos/{repo}/commits/{head}/check-runs")
        runs = [_check_shape(row) for row in rows]
        return sorted(runs, key=lambda run: (run.get("queuedAt") or "", run["id"]))

    def variable(self, repo, name):
        body = self._call(
            "GET", f"/repos/{repo}/actions/variables/{quote(name, safe='')}", none=(404,)
        )
        return None if body is None else body["value"]

    def issue_events(self, repo):
        rows = self._pages(f"/repos/{repo}/issues/events", limit=FEED_SIZE)
        return [
            {
                "id": row["id"],
                "at": row["created_at"],
                "kind": row["event"],
                "target": _target(row.get("issue") or {}),
                "by": _login(row.get("actor")),
                "label": (row.get("label") or {}).get("name"),
            }
            for row in rows
        ]

    def comment_feed(self, repo):
        rows = self._pages(
            f"/repos/{repo}/issues/comments",
            {"sort": "updated", "direction": "desc"},
            limit=FEED_SIZE,
        )
        return [
            {
                **_rest_comment(row),
                "target": _comment_target(row),
                "by": _login(row.get("user")),
                "association": row.get("author_association"),
            }
            for row in rows
        ]

    def actions_status(self):
        """GitHub's own unresolved incident touching Actions, or None (also when unknown)."""
        try:
            response = httpx.get(STATUS_API, timeout=10.0, follow_redirects=False)
            incidents = response.json().get("incidents", []) if response.status_code == 200 else []
        except (httpx.HTTPError, ValueError):
            return None
        for incident in incidents:
            names = [c.get("name", "") for c in incident.get("components", [])]
            if any("Actions" in name for name in names) or "Actions" in incident.get("name", ""):
                return {"incident": incident.get("name"), "since": incident.get("created_at")}
        return None

    def rate_limit(self):
        core = self._call("GET", "/rate_limit")["resources"]["core"]
        reset = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(core["reset"]))
        return {"remaining": core["remaining"], "limit": core["limit"], "resetAt": reset}

    # ── writes, all as the App's bot ──────────────────────────────────────

    def set_labels(self, repo, number, labels):
        self._call("PUT", f"/repos/{repo}/issues/{number}/labels", json={"labels": list(labels)})

    def add_comment(self, repo, number, body):
        row = self._call("POST", f"/repos/{repo}/issues/{number}/comments", json={"body": body})
        return _rest_comment(row)

    def create_issue(self, repo, title, body, labels):
        row = self._call(
            "POST", f"/repos/{repo}/issues", json={"title": title, "body": body, "labels": labels}
        )
        return row["number"]

    def update_ref(self, repo, ref, head, expected=None):
        """Push ``head`` from the mirror to ``ref``, only if GitHub still has ``expected``
        there (None: only if the ref does not exist)."""
        mirror = uploads.mirror_path(self.data_dir, repo)
        lease = f"--force-with-lease={ref}:{expected or ''}"
        try:
            with uploads.mirror_lock(mirror):
                uploads.git(
                    mirror,
                    "push",
                    "--porcelain",
                    "--no-verify",
                    lease,
                    f"{self._git_url}/{repo}.git",
                    f"{head}:{ref}",
                    env=self._git_env(),
                )
        except uploads.GitError as exc:
            text = f"{exc}\n{exc.output}".strip()
            if re.search(
                r"stale info|fetch first|incorrect old value|failed to update ref|"
                r"cannot lock ref",
                text,
            ):
                raise HeadMoved(self.ref(repo, ref) or "") from None
            if re.search(r"unable to access|Could not resolve|timed out|ran out of time", text):
                raise GitHubUnavailable(f"git push: {_redact(text)}") from None
            raise GitHubRefused(0, f"git push: {_redact(text)}") from None

    def fetch_main(self, repo: str, deadline: float | None = None) -> None:
        """Bring the mirror's ``main`` to GitHub's, so a bundle's new commits are counted
        against the real main. Without ``deadline`` (at startup) a first fetch of the whole
        history gets ``FIRST_FETCH_SECONDS``; within an upload's deadline a mirror that has
        never fetched is refused as not ready rather than primed inside the request."""
        try:
            mirror = uploads.ensure_mirror(self.data_dir, repo)
            with uploads.mirror_lock(mirror):
                primed = bool(uploads.git(mirror, "for-each-ref", uploads.MAIN).strip())
                if not primed and deadline is not None:
                    raise GitHubUnavailable(
                        f"the gateway has not fetched {repo} yet; it does at startup"
                    )
                if not primed:
                    deadline = time.monotonic() + FIRST_FETCH_SECONDS
                uploads.git(
                    mirror,
                    "fetch",
                    "--quiet",
                    "--no-tags",
                    "--no-write-fetch-head",
                    f"{self._git_url}/{repo}.git",
                    f"+{uploads.MAIN}:{uploads.MAIN}",
                    deadline=deadline,
                    env=self._git_env(),
                )
        except uploads.GitError as exc:
            text = _redact(str(exc))
            pattern = r"not found|Authentication failed|returned error: 403|denied"
            if re.search(pattern, text, re.IGNORECASE):
                raise GitHubRefused(0, f"git fetch: {text}") from None
            raise GitHubUnavailable(f"git fetch: {text}") from None

    def _git_env(self) -> dict[str, str]:
        """The token as an extra header, through git's environment config, never argv."""
        basic = base64.b64encode(f"x-access-token:{self.token()}".encode()).decode()
        return {
            "GIT_CONFIG_COUNT": "2",
            "GIT_CONFIG_KEY_0": f"http.{self._git_url}/.extraheader",
            "GIT_CONFIG_VALUE_0": f"Authorization: Basic {basic}",
            "GIT_CONFIG_KEY_1": "http.followRedirects",
            "GIT_CONFIG_VALUE_1": "false",
        }

    def create_pull(self, repo, branch, title, body):
        row = self._call(
            "POST",
            f"/repos/{repo}/pulls",
            json={"head": branch, "base": "main", "title": title, "body": body},
        )
        return row["number"]

    def update_pull(self, repo, number, *, title, body):
        self._call("PATCH", f"/repos/{repo}/pulls/{number}", json={"title": title, "body": body})

    def _squash_body(self, repo: str, number: int, method: str) -> str | None:
        """A squash's body (``squash_body``); None for another method, which adds no trailers."""
        if method != "squash":
            return None
        return squash_body(self._pages(f"/repos/{repo}/pulls/{number}/commits"))

    def merge_pull(self, repo, number, head, method):
        sent = {"sha": head, "merge_method": method}
        body = self._squash_body(repo, number, method)
        if body is not None:
            sent["commit_message"] = body
        response = self._send("PUT", f"/repos/{repo}/pulls/{number}/merge", json=sent)
        if response.status_code == 409:
            current = self.pull(repo, number)
            raise HeadMoved((current or {}).get("head") or "")
        if response.status_code == 405 and "not allowed" in _message(response).lower():
            raise MergeMethodNotAllowed(method)
        if response.status_code != 200:
            raise GitHubRefused(response.status_code, _message(response))
        merged = self.pull(repo, number) or {}
        return merged.get("mergedAt") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    def enable_auto_merge(self, repo, number, head, method):
        node = self._node_id(repo, number)
        body = self._squash_body(repo, number, method)
        try:
            self._graphql(
                _ENABLE_AUTO_MERGE,
                id=node,
                method=_METHODS.get(method, method.upper()),
                head=head,
                **({} if body is None else {"body": body}),
            )
        except GitHubRefused as refused:
            text = refused.message.lower()
            if "not allowed" in text and "merge" in text:
                raise MergeMethodNotAllowed(method) from None
            if "clean status" in text:
                raise AlreadyMergeable() from None
            # Whatever GitHub's wording, the head moved only if the pull request says so.
            current = (self.pull(repo, number) or {}).get("head")
            if current and current != head:
                raise HeadMoved(current) from None
            raise

    def disable_auto_merge(self, repo, number):
        self._graphql(_DISABLE_AUTO_MERGE, id=self._node_id(repo, number))

    def create_revert(self, repo, number, title, body):
        data = self._graphql(_REVERT, id=self._node_id(repo, number), title=title, body=body)
        return data["revertPullRequest"]["revertPullRequest"]["number"]

    def _node_id(self, repo: str, number: int) -> str:
        return self._call("GET", f"/repos/{repo}/pulls/{number}")["node_id"]

    def create_check_run(self, repo, head, run):
        self._call(
            "POST",
            f"/repos/{repo}/check-runs",
            json={
                "name": run["name"],
                "head_sha": head,
                "status": "completed",
                "conclusion": run["conclusion"],
                "output": {"title": run["name"], "summary": run.get("summary") or run["name"]},
            },
        )

    def set_variable(self, repo, name, value):
        response = self._send(
            "PATCH",
            f"/repos/{repo}/actions/variables/{quote(name, safe='')}",
            json={"name": name, "value": value},
        )
        if response.status_code == 404:
            self._call(
                "POST", f"/repos/{repo}/actions/variables", json={"name": name, "value": value}
            )
        elif response.status_code != 204:
            raise GitHubRefused(response.status_code, _message(response))


# ── shapes ─────────────────────────────────────────────────────────────────


def _login(user: dict | None) -> str | None:
    """A login as REST spells it: GraphQL drops a bot's ``[bot]`` suffix, so add it back."""
    if not user:
        return None
    login = user.get("login")
    bot = user.get("__typename") == "Bot" or user.get("type") == "Bot"
    return f"{login}[bot]" if bot and login and not login.endswith("[bot]") else login


def _comment_shape(node: dict) -> dict:
    return {
        "id": node["databaseId"],
        "author": _login(node.get("author")),
        "at": node["createdAt"],
        "body": node["body"],
    }


def _rest_comment(row: dict) -> dict:
    return {
        "id": row["id"],
        "author": _login(row.get("user")),
        "at": row["created_at"],
        "body": row.get("body") or "",
    }


def _pull_shape(node: dict, bot: str) -> dict:
    mergeable = node.get("mergeable") or "UNKNOWN"
    if mergeable != "CONFLICTING" and node.get("mergeStateStatus") == "BLOCKED":
        mergeable = "BLOCKED"
    fork = bool(node.get("isCrossRepository"))
    author = _login(node.get("author"))
    shape = {
        "number": node["number"],
        "state": node["state"].lower(),
        # A fork's branch is not this repository's: ":" keeps it from matching any branch.
        "branch": f"fork:{node['headRefName']}" if fork else node["headRefName"],
        "head": node["headRefOid"],
        "title": node["title"],
        "body": node["body"],
        "author": author,
        "labels": [label["name"] for label in node["labels"]["nodes"]],
        "mergeable": mergeable,
        "mergedAt": node.get("mergedAt"),
        "autoMerge": node.get("autoMergeRequest") is not None,
        "closes": [issue["number"] for issue in node["closingIssuesReferences"]["nodes"]],
        "checks": [],
    }
    revert = _REVERT_BRANCH.match(node["headRefName"] or "")
    if revert and not fork and author == bot:  # Only the gateway's own reverts count.
        shape["revertOf"] = int(revert.group(1))
    return shape


def _check_shape(row: dict) -> dict:
    status = row["status"]
    return {
        "id": row["id"],
        "name": row["name"],
        "status": status,
        "conclusion": row.get("conclusion"),
        "app": _login({"login": (row.get("app") or {}).get("slug"), "type": "Bot"}),
        "queuedAt": row.get("started_at"),
        "completedAt": row.get("completed_at"),
        "runner": None if status == "queued" else "assigned",
    }


def _target(issue: dict) -> str:
    kind = "pr" if issue.get("pull_request") else "issue"
    return f"{kind}#{issue.get('number')}"


def _comment_target(row: dict) -> str:
    number = int(row["issue_url"].rsplit("/", 1)[1])
    kind = "pr" if "/pull/" in (row.get("html_url") or "") else "issue"
    return f"{kind}#{number}"


def _owner_name(repo: str) -> dict:
    owner, _, name = repo.partition("/")
    return {"owner": owner, "name": name}


def _short(ref: str) -> str:
    """A ref as a URL path: without ``refs/``, each segment percent-encoded, and refused if
    a segment could climb out of the repository's path."""
    segments = ref.removeprefix("refs/").split("/")
    if any(segment in {"", ".", ".."} for segment in segments):
        raise GitHubRefused(0, f"{ref!r} is not a ref the gateway reads")
    return "/".join(quote(segment, safe="") for segment in segments)


def _path(url: str) -> str:
    return url.split("?", 1)[0]


def _message(response: httpx.Response) -> str:
    try:
        return response.json().get("message") or f"HTTP {response.status_code}"
    except ValueError:
        return f"HTTP {response.status_code}"


def _rate_limited(response: httpx.Response) -> bool:
    """A primary or secondary rate limit: wait and repeat, as for an outage."""
    if response.status_code == 429:
        return True
    if response.status_code == 403:
        remaining = response.headers.get("x-ratelimit-remaining")
        return remaining == "0" or "rate limit" in _message(response).lower()
    return False


def _redact(text: str) -> str:
    return re.sub(r"(Authorization: Basic )\S+|ghs_[A-Za-z0-9]+", r"\1[redacted]", text)


def _epoch(stamp: str) -> float:
    return datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC).timestamp()


_COMMENTS = """comments(last: 100) {
      pageInfo { hasPreviousPage }
      nodes { databaseId createdAt body author { __typename login } }
    }"""
_ISSUE_FIELDS = f"""number state title body authorAssociation
    author {{ __typename login }}
    labels(first: 100) {{ nodes {{ name }} }}
    assignees(first: 20) {{ nodes {{ login }} }}
    {_COMMENTS}"""
_PULL_FIELDS = """number state title body headRefName headRefOid mergeable mergeStateStatus
    mergedAt author { __typename login } autoMergeRequest { enabledAt }
    isCrossRepository
    labels(first: 100) { nodes { name } }
    closingIssuesReferences(first: 20) { nodes { number } }"""

_ISSUE_QUERY = f"""query($owner: String!, $name: String!, $number: Int!) {{
  repository(owner: $owner, name: $name) {{ issue(number: $number) {{ {_ISSUE_FIELDS} }} }}
}}"""
_ISSUES_QUERY = f"""query($owner: String!, $name: String!, $states: [IssueState!],
                   $cursor: String) {{
  repository(owner: $owner, name: $name) {{
    issues(first: 50, after: $cursor, states: $states,
           orderBy: {{field: UPDATED_AT, direction: DESC}}) {{
      pageInfo {{ hasNextPage endCursor }}
      nodes {{ {_ISSUE_FIELDS} }}
    }}
  }}
}}"""
_PULL_QUERY = f"""query($owner: String!, $name: String!, $number: Int!) {{
  repository(owner: $owner, name: $name) {{ pullRequest(number: $number) {{ {_PULL_FIELDS} }} }}
}}"""
_PULLS_QUERY = f"""query($owner: String!, $name: String!, $states: [PullRequestState!],
                  $cursor: String) {{
  repository(owner: $owner, name: $name) {{
    pullRequests(first: 50, after: $cursor, states: $states,
                 orderBy: {{field: UPDATED_AT, direction: DESC}}) {{
      pageInfo {{ hasNextPage endCursor }}
      nodes {{ {_PULL_FIELDS} }}
    }}
  }}
}}"""
_ENABLE_AUTO_MERGE = """mutation($id: ID!, $method: PullRequestMergeMethod!, $head: GitObjectID!,
                 $body: String) {
  enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: $method,
                                     expectedHeadOid: $head, commitBody: $body}) {
    clientMutationId
  }
}"""
_DISABLE_AUTO_MERGE = """mutation($id: ID!) {
  disablePullRequestAutoMerge(input: {pullRequestId: $id}) { clientMutationId }
}"""
_REVERT = """mutation($id: ID!, $title: String!, $body: String!) {
  revertPullRequest(input: {pullRequestId: $id, title: $title, body: $body}) {
    revertPullRequest { number }
  }
}"""
