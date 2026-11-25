"""Reading GitHub for `gate-outcome-collect`: the Actions API, and the GraphQL API for the
pull requests and issues the `main` source reads.

Every request goes through `call`, which runs `gh api`, so a test replaces that one function
with recorded answers. `GitHub` counts each request against the collection's own limit and
asks for the account's allowance before the first and every `CHECK_EVERY` after it: the hourly
allowance belongs to the account, and every machine and session draws on it. A GraphQL request
is held to the account's GraphQL allowance the same way.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from urllib.parse import urlencode

from botcore.commands.disk.steps import command, doing

TIMEOUT = 60.0
CHECK_EVERY = 100  # requests between two looks at the account's allowance
_STATUS = re.compile(r"\(HTTP (\d{3})\)")
_RATE = re.compile(r"rate limit", re.IGNORECASE)


class ServiceUnavailable(Exception):
    """GitHub could not be asked: `gh` is missing or not signed in, or nothing answered."""


class SourceUnreadable(Exception):
    """GitHub answered, and not with something this collection can use."""


class LogUnreadable(SourceUnreadable):
    """GitHub answered for a job's log, and not with the log."""


class NotFound(Exception):
    """GitHub no longer has what was asked for: a run that was deleted."""


class Stop(Exception):
    """The collection reached one of its limits: `requests` or `allowance`."""

    def __init__(self, why: str) -> None:
        super().__init__(why)
        self.why = why


@dataclass
class Answer:
    status: int  # the HTTP status; 200 when `gh` succeeded
    body: object  # the parsed JSON, or None when the body was not JSON
    message: str = ""  # what `gh` said when it failed
    text: str = ""  # the body as text: a job's log is not JSON


def call(endpoint: str, query: str | None = None) -> Answer:
    """One `gh api` request: a GET of `endpoint`, or with `query`, a GraphQL query (`endpoint`
    is then `graphql`). Raises ServiceUnavailable when `gh` cannot run or no HTTP answer came
    back (not installed, not signed in, no network, no answer in time). A GraphQL answer that
    holds `data` or `errors` is an answer, though `gh` fails for its errors (a number that
    names nothing, a query GitHub cannot parse)."""
    env = {**os.environ, "GH_PROMPT_DISABLED": "1", "GH_NO_UPDATE_NOTIFIER": "1"}
    args = ["gh", "api", "-H", "Accept: application/vnd.github+json", endpoint]
    if query is not None:
        args = ["gh", "api", "graphql", "--input", "-"]
    try:
        with command("asking GitHub", endpoint.partition("?")[0], TIMEOUT):
            done = subprocess.run(  # noqa: S603 - a fixed program and an endpoint we built
                args,
                capture_output=True,
                input=None if query is None else json.dumps({"query": query}).encode(),
                stdin=subprocess.DEVNULL if query is None else None,
                timeout=TIMEOUT,
                env=env,
                check=False,
            )
    except FileNotFoundError as exc:
        raise ServiceUnavailable("gh is not installed or not on PATH") from exc
    except subprocess.TimeoutExpired as exc:
        raise ServiceUnavailable(f"gh api {endpoint} did not answer in {TIMEOUT:.0f}s") from exc
    stdout = done.stdout.decode("utf-8", errors="replace")
    stderr = done.stderr.decode("utf-8", errors="replace").strip()
    try:
        body: object = json.loads(stdout) if stdout.strip() else None
    except ValueError:
        body = None
    found = _STATUS.search(stderr)
    answered = isinstance(body, dict) and ("data" in body or "errors" in body)
    if done.returncode == 0 or (query is not None and answered and found is None):
        return Answer(200, body, message=stderr if done.returncode else "", text=stdout)
    if found is None:  # no HTTP answer: not signed in, no network
        raise ServiceUnavailable(stderr.splitlines()[-1] if stderr else "gh api failed")
    return Answer(int(found.group(1)), body, stderr)


@dataclass
class GitHub:
    """One collection's reader of one repository, held to `limit` requests."""

    repo: str  # owner/name
    limit: int
    used: int = 0
    allowance: dict | None = None  # the account's core allowance as last seen
    checked_at: int | None = None  # requests made when the allowance was last asked for
    graphql_allowance: dict | None = None  # the account's GraphQL allowance as last seen
    graphql_checked_at: int | None = None

    def _request(self, endpoint: str, query: str | None = None) -> Answer:
        if self.used >= self.limit:
            raise Stop("requests")
        doing("reading GitHub's API for", self.repo)
        self.used += 1
        return call(endpoint) if query is None else call(endpoint, query)

    def check_allowance(self, resource: str = "core") -> None:
        """Raise Stop('allowance') when the account has half its hourly allowance or less of
        `resource` (`core`, or `graphql`)."""
        answer = self._request("rate_limit")
        if answer.status >= 500:  # noqa: PLR2004 - GitHub's own failure
            raise ServiceUnavailable(f"GitHub answered {answer.status} for rate_limit")
        resources = _mapping(_mapping(answer.body).get("resources"))
        core = _mapping(resources.get("core"))
        remaining, limit = core.get("remaining"), core.get("limit")
        if answer.status != 200 or type(remaining) is not int or type(limit) is not int:
            raise SourceUnreadable(f"rate_limit answered {answer.status}: {answer.message}")
        self.allowance = {"remaining": remaining, "limit": limit}
        graphql = _mapping(resources.get("graphql"))
        if type(graphql.get("remaining")) is int and type(graphql.get("limit")) is int:
            self.graphql_allowance = {"remaining": graphql["remaining"], "limit": graphql["limit"]}
        held = self.allowance if resource == "core" else self.graphql_allowance
        if held is not None and held["remaining"] <= held["limit"] / 2:
            raise Stop("allowance")

    def _allowance_due(self, resource: str = "core") -> None:
        at = self.checked_at if resource == "core" else self.graphql_checked_at
        if at is None or self.used - at >= CHECK_EVERY:
            if resource == "core":
                self.checked_at = self.used
            else:
                self.graphql_checked_at = self.used
            self.check_allowance(resource)

    def graphql(self, query: str) -> dict:
        """The `data` of a GraphQL query: one request, counted like any other. A field that
        names nothing is null in it. Raises Stop when a limit is reached, SourceUnreadable
        for an answer without `data` or with an error other than `NOT_FOUND`, and
        ServiceUnavailable when GitHub fails twice running."""
        self._allowance_due("graphql")
        answer = self._request("graphql", query)
        if answer.status >= 500:  # noqa: PLR2004 - GitHub's own failure: once more
            answer = self._request("graphql", query)
            if answer.status >= 500:  # noqa: PLR2004
                raise ServiceUnavailable(f"GitHub answered {answer.status} for graphql")
        if answer.status in (403, 429) and _RATE.search(answer.message):  # noqa: PLR2004
            raise Stop("allowance")
        body = _mapping(answer.body)
        errors = body.get("errors")
        kinds = {
            str(e.get("type") or "unknown") for e in errors if isinstance(e, dict)
        } if isinstance(errors, list) else set()  # fmt: skip
        if "RATE_LIMITED" in kinds:
            raise Stop("allowance")
        if kinds - {"NOT_FOUND"}:  # a number that names nothing is answered null; not these
            raise SourceUnreadable(
                f"GitHub's GraphQL answer has errors: {', '.join(sorted(kinds))}"
            )
        data = body.get("data")
        if answer.status != 200 or not isinstance(data, dict):  # noqa: PLR2004
            raise SourceUnreadable(
                f"GitHub answered {answer.status} for graphql: {answer.message or 'no data'}"
            )
        return data

    def log(self, job: int) -> str:
        """A job's log as text: one request, counted like any other. The caller keeps nothing
        of it but what it parses. Raises NotFound when GitHub no longer has it (logs expire),
        and as `get` does otherwise."""
        self._allowance_due()
        endpoint = f"repos/{self.repo}/actions/jobs/{job}/logs"
        answer = self._request(endpoint)
        if answer.status >= 500:  # noqa: PLR2004 - GitHub's own failure: once more
            answer = self._request(endpoint)
            if answer.status >= 500:  # noqa: PLR2004
                raise ServiceUnavailable(f"GitHub answered {answer.status} for {endpoint}")
        if answer.status in (404, 410):  # noqa: PLR2004
            raise NotFound(endpoint)
        if answer.status in (403, 429) and _RATE.search(answer.message):  # noqa: PLR2004
            raise Stop("allowance")
        if answer.status != 200:  # noqa: PLR2004
            raise LogUnreadable(f"GitHub answered {answer.status} for {endpoint}")
        return answer.text

    def get(self, path: str, **params: object) -> dict:
        """GET `repos/<repo>/<path>` with `params`. Raises NotFound for a 404, Stop when a
        limit is reached, SourceUnreadable for an answer that cannot be used, and
        ServiceUnavailable when GitHub fails twice running."""
        self._allowance_due()
        query = urlencode({key: value for key, value in params.items() if value is not None})
        endpoint = f"repos/{self.repo}/{path}" + (f"?{query}" if query else "")
        answer = self._request(endpoint)
        if answer.status >= 500:  # noqa: PLR2004 - GitHub's own failure: once more
            answer = self._request(endpoint)
            if answer.status >= 500:  # noqa: PLR2004
                raise ServiceUnavailable(f"GitHub answered {answer.status} for {endpoint}")
        if answer.status == 404:  # noqa: PLR2004
            raise NotFound(endpoint)
        if answer.status in (403, 429) and _RATE.search(answer.message):  # noqa: PLR2004
            raise Stop("allowance")
        if answer.status != 200 or not isinstance(answer.body, dict):  # noqa: PLR2004
            raise SourceUnreadable(
                f"GitHub answered {answer.status} for {endpoint}: {answer.message or 'no JSON'}"
            )
        return answer.body


def _mapping(value: object) -> dict:
    return value if isinstance(value, dict) else {}
