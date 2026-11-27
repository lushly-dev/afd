"""The App adapter against a mock GitHub: credentials, shapes, refusals and pushes."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import httpx
import jwt
import pytest
from click.testing import CliRunner
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from botcore_factory.gateway.cli import admin_cli
from botcore_factory.gateway.github import (
    AlreadyMergeable,
    GitHubRefused,
    GitHubUnavailable,
    HeadMoved,
    MergeMethodNotAllowed,
)
from botcore_factory.gateway.github_app import GitHubApp, read_private_key
from botcore_factory.gateway.uploads import ensure_mirror, mirror_path

REPO = "example-org/example-repo"
BOT = "example-factory[bot]"
OWNER = "owner@example.com"
#: A branch's commits as GitHub lists them: its own, then a base merge by the factory.
COMMITS = [
    {
        "parents": [{"sha": "p1"}],
        "commit": {
            "message": "fix: a\n\nWhy.\n\nCo-authored-by: X <x@example.com>\nAssisted-by: Codex"
        },
    },
    {"parents": [{"sha": "p2"}, {"sha": "p3"}], "commit": {"message": "Merge origin/main"}},
]
SQUASH_BODY = "fix: a\n\nWhy.\n\nAssisted-by: Codex"


@pytest.fixture(scope="module")
def key_pair():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    return pem, private.public_key()


class Clock:
    def __init__(self) -> None:
        self.at = 1_900_000_000.0

    def __call__(self) -> float:
        return self.at


class MockGitHub:
    """Routes requests to handlers; records each request."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.routes: dict[tuple[str, str], object] = {}
        self.graphql: list = []
        self.tokens = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path.endswith("/access_tokens"):
            self.tokens += 1
            return httpx.Response(
                201, json={"token": f"ghs_token{self.tokens}", "expires_at": "2030-03-17T18:33:20Z"}
            )
        if path == "/graphql":
            answer = self.graphql.pop(0)
            if isinstance(answer, httpx.Response):
                return answer
            return httpx.Response(200, json=answer)
        handler = self.routes.get((request.method, path))
        if handler is None:
            return httpx.Response(404, json={"message": "Not Found"})
        if callable(handler):
            return handler(request)
        return handler


@pytest.fixture
def github(key_pair, tmp_path):
    mock = MockGitHub()
    clock = Clock()
    app = GitHubApp(
        app_id=5,
        installation_id=7,
        private_key=key_pair[0],
        bot=BOT,
        data_dir=tmp_path / "data",
        transport=httpx.MockTransport(mock),
        clock=clock,
    )
    return app, mock, clock


def test_the_installation_token_is_made_from_a_signed_jwt_and_reused(github, key_pair):
    app, mock, clock = github
    mock.routes[("GET", f"/repos/{REPO}/actions/variables/X")] = httpx.Response(
        200, json={"name": "X", "value": "1"}
    )
    assert app.variable(REPO, "X") == "1"
    assert app.variable(REPO, "X") == "1"
    exchange, first, second = mock.requests
    claims = jwt.decode(
        exchange.headers["Authorization"].removeprefix("Bearer "),
        key_pair[1],
        algorithms=["RS256"],
        options={"verify_exp": False, "verify_iat": False},  # Signed at the test's clock.
    )
    assert claims["iss"] == "5" and claims["exp"] - claims["iat"] <= 600
    assert exchange.url.path == "/app/installations/7/access_tokens"
    assert first.headers["Authorization"] == second.headers["Authorization"] == "Bearer ghs_token1"
    clock.at = 1_900_000_000 + 3600 * 24 * 365 * 10  # Past the token's expiry.
    app.variable(REPO, "X")
    assert mock.tokens == 2


def _issue(number, *, author="owner", typename="User", comments=(), state="OPEN", more=False):
    return {
        "number": number,
        "state": state,
        "title": f"Issue {number}",
        "body": "Body",
        "authorAssociation": "OWNER",
        "author": {"__typename": typename, "login": author},
        "labels": {"nodes": [{"name": "status:planned"}]},
        "assignees": {"nodes": []},
        "comments": {"pageInfo": {"hasPreviousPage": more}, "nodes": list(comments)},
    }


def _page(kind, nodes, next_page=False):
    return {
        "data": {
            "repository": {
                kind: {
                    "pageInfo": {"hasNextPage": next_page, "endCursor": "c1"},
                    "nodes": nodes,
                }
            }
        }
    }


def test_issues_carry_their_comments_and_a_bot_s_login_as_rest_spells_it(github):
    app, mock, _ = github
    comment = {
        "databaseId": 11,
        "createdAt": "2030-02-03T08:10:00Z",
        "body": "<!-- botcore-factory:claim {} -->",
        "author": {"__typename": "Bot", "login": "example-factory"},
    }
    mock.graphql += [
        _page("issues", [_issue(102, comments=[comment])], next_page=True),
        _page("issues", [_issue(101)]),
        _page("issues", [_issue(90, state="CLOSED")]),
    ]
    issues = app.issues(REPO)
    assert [i["number"] for i in issues] == [90, 101, 102]
    assert issues[0]["state"] == "closed"
    assert issues[2]["comments"] == [
        {"id": 11, "author": BOT, "at": "2030-02-03T08:10:00Z", "body": comment["body"]}
    ]
    assert issues[1]["author"] == {"login": "owner", "association": "OWNER"}
    second_page = json.loads(mock.requests[2].content)
    assert second_page["variables"]["cursor"] == "c1"


def test_an_issue_with_more_comments_than_one_page_reads_them_all(github):
    app, mock, _ = github
    mock.graphql.append({"data": {"repository": {"issue": _issue(5, more=True)}}})
    rows = [
        {"id": n, "user": {"login": "o", "type": "User"}, "created_at": "t", "body": "b"}
        for n in range(3)
    ]
    mock.routes[("GET", f"/repos/{REPO}/issues/5/comments")] = httpx.Response(200, json=rows)
    assert [c["id"] for c in app.issue(REPO, 5)["comments"]] == [0, 1, 2]


def test_one_issue_names_the_pull_requests_that_close_it_in_its_own_repository(github):
    app, mock, _ = github
    node = _issue(5) | {
        "closedByPullRequestsReferences": {
            "nodes": [
                {"number": 9, "repository": {"nameWithOwner": REPO}},
                {"number": 3, "repository": {"nameWithOwner": REPO.upper()}},
                {"number": 7, "repository": {"nameWithOwner": "someone/fork"}},
            ]
        }
    }
    mock.graphql.append({"data": {"repository": {"issue": node}}})
    assert app.issue(REPO, 5)["closedBy"] == [3, 9]
    query = json.loads(mock.requests[-1].content)["query"]
    assert "closedByPullRequestsReferences" in query and "includeClosedPrs: true" in query


def test_a_scan_does_not_ask_who_closes_each_issue(github):
    app, mock, _ = github
    mock.graphql += [_page("issues", [_issue(1)]), _page("issues", [])]
    app.issues(REPO)
    for request in mock.requests:
        if request.url.path == "/graphql":
            assert "closedByPullRequestsReferences" not in json.loads(request.content)["query"]


def test_one_issue_carries_its_type_parent_and_sub_issues(github):
    app, mock, _ = github
    node = _issue(5) | {
        "issueType": {"name": "Task"},
        "parent": {"number": 2, "repository": {"nameWithOwner": REPO.upper()}},
        "subIssuesSummary": {"total": 3},
    }
    mock.graphql += [
        {"data": {"repository": {"issue": node}}},
        {"data": {"repository": {"issue": _issue(6) | {"issueType": None, "parent": None}}}},
        {
            "data": {
                "repository": {
                    "issue": _issue(7)
                    | {"parent": {"number": 4, "repository": {"nameWithOwner": "acme/other"}}}
                }
            }
        },
    ]
    one = app.issue(REPO, 5)
    assert (one["type"], one["parent"], one["subIssues"]) == ("Task", 2, 3)
    query = json.loads(mock.requests[-1].content)["query"]
    assert "issueType { name }" in query and "subIssuesSummary { total }" in query
    assert (app.issue(REPO, 6)["type"], app.issue(REPO, 6 + 1)["parent"]) == (None, "acme/other#4")


def test_a_scan_does_not_ask_for_types_or_parents(github):
    app, mock, _ = github
    mock.graphql += [_page("issues", [_issue(1)]), _page("issues", [])]
    app.issues(REPO)
    for request in mock.requests:
        if request.url.path == "/graphql":
            query = json.loads(request.content)["query"]
            assert "issueType" not in query and "parent {" not in query


def test_issue_types_are_the_repository_s_by_name(github):
    app, mock, _ = github
    types = {
        "nodes": [
            {"name": "Bug", "isEnabled": True},
            {"name": "Epic", "isEnabled": True},
            {"name": "Story", "isEnabled": False},  # Disabled: GitHub refuses it.
            None,
        ]
    }
    mock.graphql.append({"data": {"repository": {"issueTypes": types}}})
    assert app.issue_types(REPO) == ["Bug", "Epic"]
    assert (
        "issueTypes(first: 100) { nodes { name isEnabled } }"
        in json.loads(mock.requests[-1].content)["query"]
    )


def test_a_type_is_written_by_name_and_cleared_with_null(github):
    app, mock, _ = github
    mock.routes[("POST", f"/repos/{REPO}/issues")] = httpx.Response(201, json={"number": 8})
    mock.routes[("PATCH", f"/repos/{REPO}/issues/8")] = httpx.Response(200, json={})
    assert app.create_issue(REPO, "T", "B", ["x"], "Epic") == 8
    assert json.loads(mock.requests[-1].content) == {
        "title": "T",
        "body": "B",
        "labels": ["x"],
        "type": "Epic",
    }
    app.create_issue(REPO, "T", "B", [])
    assert "type" not in json.loads(mock.requests[-1].content)
    app.set_issue_type(REPO, 8, None)
    assert json.loads(mock.requests[-1].content) == {"type": None}


def test_sub_issues_are_attached_and_detached_by_the_child_s_id(github):
    app, mock, _ = github
    mock.routes[("GET", f"/repos/{REPO}/issues/9")] = httpx.Response(
        200, json={"id": 900009, "number": 9}
    )
    mock.routes[("POST", f"/repos/{REPO}/issues/2/sub_issues")] = httpx.Response(201, json={})
    mock.routes[("DELETE", f"/repos/{REPO}/issues/2/sub_issue")] = httpx.Response(200, json={})
    app.add_sub_issue(REPO, 2, 9)
    assert json.loads(mock.requests[-1].content) == {"sub_issue_id": 900009, "replace_parent": True}
    app.remove_sub_issue(REPO, 2, 9)
    removed = mock.requests[-1]
    assert removed.method == "DELETE" and json.loads(removed.content) == {"sub_issue_id": 900009}
    mock.routes[("POST", f"/repos/{REPO}/issues/2/sub_issues")] = httpx.Response(
        422, json={"message": "Parent cannot have more than 100 sub-issues"}
    )
    with pytest.raises(GitHubRefused, match="100 sub-issues"):
        app.add_sub_issue(REPO, 2, 9)


def test_a_number_that_is_not_an_issue_is_none(github):
    app, mock, _ = github
    mock.graphql.append(
        {"data": {"repository": {"issue": None}}, "errors": [{"type": "NOT_FOUND", "message": "x"}]}
    )
    assert app.issue(REPO, 41) is None


def _pull(number, **fields):
    return {
        "number": number,
        "state": "OPEN",
        "title": "T",
        "body": "B",
        "headRefName": "fix/x",
        "headRefOid": "a" * 40,
        "mergeable": "MERGEABLE",
        "mergeStateStatus": "CLEAN",
        "mergedAt": None,
        "author": {"__typename": "Bot", "login": "example-factory"},
        "autoMergeRequest": None,
        "isCrossRepository": False,
        "labels": {"nodes": [{"name": "p1"}]},
        "closingIssuesReferences": {"nodes": [{"number": 101}]},
        **fields,
    }


def test_pull_requests_take_the_fake_s_shape(github):
    app, mock, _ = github
    mock.graphql += [
        _page("pullRequests", [_pull(46, mergeStateStatus="BLOCKED", autoMergeRequest={})]),
        _page(
            "pullRequests",
            [_pull(45, state="MERGED", mergedAt="2030-02-03T09:50:00Z", headRefName="revert-41-x")],
        ),
    ]
    merged, blocked = app.pulls(REPO)
    assert blocked["mergeable"] == "BLOCKED" and blocked["autoMerge"] is True
    assert blocked["author"] == BOT and blocked["closes"] == [101] and blocked["branch"] == "fix/x"
    assert merged["state"] == "merged" and merged["revertOf"] == 41
    assert blocked["labels"] == ["p1"]


def test_a_fork_s_branch_matches_no_branch_and_reverts_only_the_bot_s(github):
    app, mock, _ = github
    owner = {"__typename": "User", "login": "someone"}
    mock.graphql += [
        _page(
            "pullRequests",
            [
                _pull(50, isCrossRepository=True, headRefName="revert-41-x"),
                _pull(51, headRefName="revert-42-x", author=owner),
            ],
        ),
        _page("pullRequests", []),
    ]
    fork, human = app.pulls(REPO)
    assert fork["branch"] == "fork:revert-41-x" and "revertOf" not in fork
    assert "revertOf" not in human


def test_a_refused_installation_token_is_the_operator_s_to_fix(github):
    app, mock, _ = github

    def refuse(request):
        return httpx.Response(401, json={"message": "A JSON web token could not be decoded"})

    original = mock.__call__
    mock.routes[("GET", f"/repos/{REPO}/labels")] = httpx.Response(200, json=[])
    app._http._transport = httpx.MockTransport(
        lambda request: (
            refuse(request) if request.url.path.endswith("/access_tokens") else original(request)
        )
    )
    with pytest.raises(GitHubRefused) as refused:
        app.repo_labels(REPO)
    assert refused.value.status == 401 and "token" in refused.value.message


@pytest.mark.parametrize("ref", ["refs/heads/a/../../x", "refs/heads//x", "refs/heads/."])
def test_a_ref_that_would_climb_out_of_the_repository_is_never_requested(github, ref):
    app, mock, _ = github
    with pytest.raises(GitHubRefused):
        app.ref(REPO, ref)
    assert not [r for r in mock.requests if "/git/ref/" in r.url.path]


def test_a_ref_is_requested_percent_encoded(github):
    app, mock, _ = github
    app.ref(REPO, "refs/heads/fix/a+b")
    assert mock.requests[-1].url.raw_path.endswith(b"/git/ref/heads/fix/a%2Bb")


def test_auto_merge_refusals_say_what_github_meant(github):
    app, mock, _ = github
    mock.routes[("GET", f"/repos/{REPO}/pulls/46")] = httpx.Response(200, json={"node_id": "PR_1"})
    mock.graphql.append(
        {"data": None, "errors": [{"message": "Pull request Pull request is in clean status"}]}
    )
    with pytest.raises(AlreadyMergeable):
        app.enable_auto_merge(REPO, 46, "a" * 40, "merge")
    refusal = {"data": None, "errors": [{"message": "Expected head oid did not match"}]}
    mock.graphql += [refusal, {"data": {"repository": {"pullRequest": _pull(46)}}}]
    with pytest.raises(GitHubRefused):  # The head is still "a" * 40: not a move.
        app.enable_auto_merge(REPO, 46, "a" * 40, "merge")
    mock.graphql += [
        refusal,
        {"data": {"repository": {"pullRequest": _pull(46, headRefOid="b" * 40)}}},
    ]
    with pytest.raises(HeadMoved) as moved:
        app.enable_auto_merge(REPO, 46, "a" * 40, "merge")
    assert moved.value.head == "b" * 40


def test_an_upload_does_not_wait_for_a_mirror_s_first_fetch(remote):
    app, _, _, _ = remote
    import time as clock

    with pytest.raises(GitHubUnavailable, match="startup"):
        app.fetch_main(REPO, clock.monotonic() + 300)


def test_a_stale_head_a_disallowed_method_and_a_clean_merge(github):
    app, mock, _ = github
    url = ("PUT", f"/repos/{REPO}/pulls/46/merge")
    mock.routes[url] = httpx.Response(409, json={"message": "Head branch was modified"})
    mock.graphql.append({"data": {"repository": {"pullRequest": _pull(46, headRefOid="b" * 40)}}})
    with pytest.raises(HeadMoved) as moved:
        app.merge_pull(REPO, 46, "a" * 40, "merge")
    assert moved.value.head == "b" * 40
    mock.routes[url] = httpx.Response(405, json={"message": "Merge commits are not allowed"})
    with pytest.raises(MergeMethodNotAllowed):
        app.merge_pull(REPO, 46, "a" * 40, "merge")
    mock.routes[url] = httpx.Response(405, json={"message": "Pull Request is not mergeable"})
    with pytest.raises(GitHubRefused):
        app.merge_pull(REPO, 46, "a" * 40, "merge")
    mock.routes[url] = lambda request: httpx.Response(200, json={"merged": True})
    mock.routes[("GET", f"/repos/{REPO}/pulls/46/commits")] = httpx.Response(200, json=COMMITS)
    mock.graphql.append(
        {"data": {"repository": {"pullRequest": _pull(46, mergedAt="2030-02-03T10:00:00Z")}}}
    )
    assert app.merge_pull(REPO, 46, "a" * 40, "squash") == "2030-02-03T10:00:00Z"
    assert json.loads(mock.requests[-2].content) == {
        "sha": "a" * 40,
        "merge_method": "squash",
        "commit_message": SQUASH_BODY,
    }


def test_auto_merge_is_bound_to_the_head_and_method(github):
    app, mock, _ = github
    mock.routes[("GET", f"/repos/{REPO}/pulls/46")] = httpx.Response(200, json={"node_id": "PR_1"})
    mock.routes[("GET", f"/repos/{REPO}/pulls/46/commits")] = httpx.Response(200, json=COMMITS)
    mock.graphql.append({"data": {"enablePullRequestAutoMerge": {"clientMutationId": None}}})
    app.enable_auto_merge(REPO, 46, "a" * 40, "squash")
    sent = json.loads(mock.requests[-1].content)["variables"]
    assert sent == {"id": "PR_1", "method": "SQUASH", "head": "a" * 40, "body": SQUASH_BODY}
    mock.graphql.append({"data": {"enablePullRequestAutoMerge": {"clientMutationId": None}}})
    app.enable_auto_merge(REPO, 46, "a" * 40, "merge")
    sent = json.loads(mock.requests[-1].content)["variables"]
    assert sent == {"id": "PR_1", "method": "MERGE", "head": "a" * 40}
    mock.graphql.append(
        {"data": None, "errors": [{"message": "Merge method squash merging is not allowed"}]}
    )
    with pytest.raises(MergeMethodNotAllowed):
        app.enable_auto_merge(REPO, 46, "a" * 40, "squash")


@pytest.mark.parametrize(
    "response,sent",
    [
        (httpx.Response(502, json={"message": "Bad gateway"}), True),
        (httpx.Response(429, json={"message": "Too many"}), False),
        (
            httpx.Response(
                403,
                json={"message": "API rate limit exceeded"},
                headers={"x-ratelimit-remaining": "0"},
            ),
            False,
        ),
        (httpx.Response(403, json={"message": "You have exceeded a secondary rate limit"}), False),
    ],
)
def test_outages_and_rate_limits_may_be_retried(github, response, sent):
    """A rate limit is GitHub refusing the call unread (sent False); a 5xx may follow a write."""
    app, mock, _ = github
    mock.routes[("GET", f"/repos/{REPO}/labels")] = response
    with pytest.raises(GitHubUnavailable) as outage:
        app.repo_labels(REPO)
    assert outage.value.sent is sent


@pytest.mark.parametrize(
    "error,sent",
    [(httpx.ConnectError, False), (httpx.ConnectTimeout, False), (httpx.ReadTimeout, True)],
)
def test_a_connection_that_never_opened_sent_nothing(github, error, sent):
    app, mock, _ = github

    def fail(request):
        raise error("no answer", request=request)

    mock.routes[("POST", f"/repos/{REPO}/issues")] = fail
    with pytest.raises(GitHubUnavailable) as outage:
        app.create_issue(REPO, "T", "B", [])
    assert outage.value.sent is sent


def test_a_dropped_connection_may_be_retried_and_a_refusal_may_not(github):
    app, mock, _ = github

    def drop(request):
        raise httpx.ConnectError("refused", request=request)

    mock.routes[("GET", f"/repos/{REPO}/labels")] = drop
    with pytest.raises(GitHubUnavailable):
        app.repo_labels(REPO)
    mock.routes[("PUT", f"/repos/{REPO}/issues/5/labels")] = httpx.Response(
        403, json={"message": "Resource not accessible by integration"}
    )
    with pytest.raises(GitHubRefused) as refused:
        app.set_labels(REPO, 5, ["x"])
    assert refused.value.status == 403 and "integration" in refused.value.message


def test_check_runs_oldest_first_named_by_their_app(github):
    app, mock, _ = github
    runs = [
        {
            "id": 2,
            "name": "ci-ok",
            "status": "completed",
            "conclusion": "success",
            "started_at": "2030-02-03T09:40:00Z",
            "app": {"slug": "github-actions"},
        },
        {
            "id": 1,
            "name": "factory/verification",
            "status": "queued",
            "conclusion": None,
            "started_at": "2030-02-03T09:30:00Z",
            "app": {"slug": "example-factory"},
        },
    ]
    path = f"/repos/{REPO}/commits/{'a' * 40}/check-runs"
    mock.routes[("GET", path)] = httpx.Response(200, json={"total_count": 2, "check_runs": runs})
    first, second = app.check_runs(REPO, "a" * 40)
    assert first["app"] == BOT and first["runner"] is None and first["queuedAt"]
    assert second["name"] == "ci-ok" and second["app"] == "github-actions[bot]"


def test_the_comment_feed_tells_pull_requests_from_issues(github):
    app, mock, _ = github
    row = {
        "id": 9,
        "user": {"login": "owner", "type": "User"},
        "created_at": "2030-02-03T09:55:00Z",
        "body": "Looks good",
        "author_association": "OWNER",
        "issue_url": f"https://api.github.com/repos/{REPO}/issues/46",
        "html_url": f"https://github.com/{REPO}/pull/46#issuecomment-9",
    }
    mock.routes[("GET", f"/repos/{REPO}/issues/comments")] = httpx.Response(200, json=[row])
    (comment,) = app.comment_feed(REPO)
    assert comment["target"] == "pr#46" and comment["by"] == "owner"
    assert comment["association"] == "OWNER"


def test_a_missing_variable_is_created_and_a_present_one_updated(github):
    app, mock, _ = github
    mock.routes[("POST", f"/repos/{REPO}/actions/variables")] = httpx.Response(201)
    app.set_variable(REPO, "FACTORY_LANE_HOST", "random")
    methods = [(r.method, r.url.path) for r in mock.requests[1:]]
    assert methods == [
        ("PATCH", f"/repos/{REPO}/actions/variables/FACTORY_LANE_HOST"),
        ("POST", f"/repos/{REPO}/actions/variables"),
    ]
    path = f"/repos/{REPO}/actions/variables/FACTORY_LANE_HOST"
    mock.routes[("PATCH", path)] = httpx.Response(204)
    app.set_variable(REPO, "FACTORY_LANE_HOST", "random")
    assert (mock.requests[-1].method, mock.requests[-1].url.path) == ("PATCH", path)


def test_a_ref_github_lacks_is_none(github):
    app, mock, _ = github
    assert app.ref(REPO, "refs/heads/nope") is None
    mock.routes[("GET", f"/repos/{REPO}/git/ref/heads/main")] = httpx.Response(
        200, json={"object": {"sha": "c" * 40}}
    )
    assert app.ref(REPO, "refs/heads/main") == "c" * 40


# ── pushes, against a local bare remote ─────────────────────────────────────


def git(directory: Path, *arguments: str) -> str:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "Owner",
        "GIT_AUTHOR_EMAIL": OWNER,
        "GIT_COMMITTER_NAME": "Owner",
        "GIT_COMMITTER_EMAIL": OWNER,
        "GIT_CONFIG_NOSYSTEM": "1",
        "HOME": str(directory),
    }
    return subprocess.run(
        ["git", *arguments], cwd=directory, env=env, check=True, capture_output=True, text=True
    ).stdout.strip()


@pytest.fixture
def remote(github, tmp_path):
    """A bare remote at <remotes>/<repo>.git with main at one commit, and the App pointed at it."""
    app, mock, _ = github
    remotes = tmp_path / "remotes"
    bare = remotes / f"{REPO}.git"
    bare.mkdir(parents=True)
    git(bare, "init", "--bare", "--quiet", "--initial-branch=main")
    work = tmp_path / "work"
    work.mkdir()
    git(work, "init", "--quiet", "--initial-branch=main")
    (work / "a.txt").write_text("a")
    git(work, "add", ".")
    git(work, "commit", "--quiet", "-m", "a")
    git(work, "push", "--quiet", str(bare), "main")
    app._git_url = remotes.as_uri()
    return app, mock, bare, work


def _commit_into_mirror(app: GitHubApp, work: Path, name: str) -> str:
    (work / name).write_text(name)
    git(work, "add", ".")
    git(work, "commit", "--quiet", "-m", name)
    head = git(work, "rev-parse", "HEAD")
    mirror = ensure_mirror(app.data_dir, REPO)
    git(work, "push", "--quiet", str(mirror), f"HEAD:refs/uploads/u/{name}")
    return head


def test_a_push_lands_only_where_the_ref_still_is_what_was_read(remote):
    app, mock, bare, work = remote
    head = _commit_into_mirror(app, work, "b.txt")
    app.update_ref(REPO, "refs/heads/fix/x", head, None)
    assert git(bare, "rev-parse", "refs/heads/fix/x") == head
    newer = _commit_into_mirror(app, work, "c.txt")
    mock.routes[("GET", f"/repos/{REPO}/git/ref/heads/fix/x")] = httpx.Response(
        200, json={"object": {"sha": head}}
    )
    with pytest.raises(HeadMoved) as moved:
        app.update_ref(REPO, "refs/heads/fix/x", newer, None)  # Read as absent; it exists.
    assert moved.value.head == head
    app.update_ref(REPO, "refs/heads/fix/x", newer, head)
    assert git(bare, "rev-parse", "refs/heads/fix/x") == newer


def test_a_push_github_rejects_atomically_is_head_moved(remote, monkeypatch):
    app, mock, _, work = remote
    head = _commit_into_mirror(app, work, "g.txt")
    from botcore_factory.gateway import uploads

    def rejected(*arguments, **kwargs):
        raise uploads.GitError(
            "error: failed to push some refs",
            f"!\t{head}:refs/heads/fix/x\t[remote rejected] (incorrect old value provided)",
        )

    monkeypatch.setattr(uploads, "git", rejected)
    mock.routes[("GET", f"/repos/{REPO}/git/ref/heads/fix/x")] = httpx.Response(
        200, json={"object": {"sha": "e" * 40}}
    )
    with pytest.raises(HeadMoved) as moved:
        app.update_ref(REPO, "refs/heads/fix/x", head, None)
    assert moved.value.head == "e" * 40


def test_the_token_reaches_git_by_environment_never_argv(remote, monkeypatch):
    app, _, _, work = remote
    head = _commit_into_mirror(app, work, "d.txt")
    seen = []
    real = subprocess.Popen

    def spy(arguments, *rest, **kwargs):
        seen.append((list(arguments), kwargs.get("env") or {}))
        return real(arguments, *rest, **kwargs)

    monkeypatch.setattr(subprocess, "Popen", spy)
    app.update_ref(REPO, "refs/queue/fix-x", head, None)
    arguments, env = seen[-1]
    assert not any("ghs_" in argument for argument in arguments)
    assert env["GIT_CONFIG_VALUE_0"].startswith("Authorization: Basic ")


def test_the_mirror_s_main_follows_github(remote):
    app, _, bare, work = remote
    (work / "e.txt").write_text("e")
    git(work, "add", ".")
    git(work, "commit", "--quiet", "-m", "e")
    git(work, "push", "--quiet", str(bare), "main")
    app.fetch_main(REPO)
    mirror = mirror_path(app.data_dir, REPO)
    assert git(mirror, "rev-parse", "refs/heads/main") == git(work, "rev-parse", "HEAD")


def test_an_unreachable_remote_is_an_outage(github, tmp_path):
    app, _, _ = github
    app._git_url = (tmp_path / "missing").as_uri()
    with pytest.raises((GitHubUnavailable, GitHubRefused)):
        app.fetch_main(REPO)


# ── the key and serve ───────────────────────────────────────────────────────


# What a shared key's refusal names: the mode on POSIX, the extra grant on Windows.
REFUSED = "grants another principal" if os.name == "nt" else "chmod 600"


def share(key: Path, *, shared: bool) -> None:
    """Make the key readable by others, or private to this user, natively on each platform."""
    if os.name != "nt":
        key.chmod(0o644 if shared else 0o600)
        return
    # Windows judges the ACL, not the mode bits: Everyone (S-1-1-0) may read, or only this
    # user, SYSTEM and Administrators may.
    grants = ["/grant", "*S-1-1-0:R"] if shared else ["/remove:g", "*S-1-1-0"]
    subprocess.run(["icacls", str(key), "/inheritance:r", *grants], check=True, capture_output=True)
    if not shared:
        user = (
            subprocess.run(
                ["whoami", "/user", "/fo", "csv", "/nh"], check=True, capture_output=True, text=True
            )
            .stdout.strip()
            .split(",")[-1]
            .strip('"')
        )
        grants = [f"*{sid}:F" for sid in (user, "S-1-5-18", "S-1-5-32-544")]
        subprocess.run(["icacls", str(key), "/grant:r", *grants], check=True, capture_output=True)


def test_a_key_others_can_read_is_refused(tmp_path, key_pair):
    key = tmp_path / "app.pem"
    key.write_text(key_pair[0])
    share(key, shared=False)
    share(key, shared=True)
    with pytest.raises(ValueError, match=REFUSED):
        read_private_key(key)
    share(key, shared=False)
    assert read_private_key(key).startswith("-----BEGIN")


def test_serve_needs_the_app_in_the_config_and_one_github(tmp_path, key_pair):
    config = tmp_path / "gateway.json"
    base_config = {"bot": BOT, "owner": "o", "ownerEmails": [OWNER], "repositories": [REPO]}
    config.write_text(json.dumps(base_config))
    key = tmp_path / "app.pem"
    key.write_text(key_pair[0])
    share(key, shared=False)
    fake = tmp_path / "github.json"
    fake.write_text(json.dumps({"repo": REPO}))
    runner = CliRunner()
    base = ["serve", "--data", str(tmp_path / "d"), "--config", str(config), "--address", "x"]
    no_app = runner.invoke(admin_cli, [*base, "--app-key", str(key)])
    assert no_app.exit_code == 2 and "githubApp" in no_app.output
    both = runner.invoke(admin_cli, [*base, "--app-key", str(key), "--fake-github", str(fake)])
    assert both.exit_code == 2 and "not both" in both.output
    config.write_text(json.dumps({**base_config, "githubApp": {"appId": 5, "installationId": 7}}))
    share(key, shared=True)
    shared = runner.invoke(admin_cli, [*base, "--app-key", str(key)])
    assert shared.exit_code == 2 and REFUSED in shared.output


def test_a_pull_request_says_whether_its_base_has_a_merge_queue(github):
    app, mock, _ = github
    entry = {"state": "AWAITING_CHECKS", "position": 2}
    mock.graphql += [
        {"data": {"repository": {"pullRequest": _pull(46)}}},
        {"data": {"repository": {"pullRequest": _pull(46, isMergeQueueEnabled=True)}}},
        {
            "data": {
                "repository": {
                    "pullRequest": _pull(
                        46, isMergeQueueEnabled=True, isInMergeQueue=True, mergeQueueEntry=entry
                    )
                }
            }
        },
    ]
    assert "mergeQueue" not in app.pull(REPO, 46)
    assert app.pull(REPO, 46)["mergeQueue"] == {"required": True, "queued": False}
    assert app.pull(REPO, 46)["mergeQueue"] == {
        "required": True,
        "queued": True,
        "state": "AWAITING_CHECKS",
        "position": 2,
    }
    query = json.loads(mock.requests[-1].content)["query"]
    assert "isMergeQueueEnabled isInMergeQueue mergeQueueEntry { state position }" in query
    assert "REMOVED_FROM_MERGE_QUEUE_EVENT" in query
    gone = {"nodes": [{"createdAt": "2030-02-03T10:01:00Z", "reason": "failed_checks"}]}
    mock.graphql.append(
        {
            "data": {
                "repository": {
                    "pullRequest": _pull(46, isMergeQueueEnabled=True, timelineItems=gone)
                }
            }
        }
    )
    assert app.pull(REPO, 46)["mergeQueue"] == {
        "required": True,
        "queued": False,
        "removed": {"at": "2030-02-03T10:01:00Z", "reason": "failed_checks"},
    }


def test_a_pull_request_is_enqueued_and_dequeued_bound_to_its_head(github):
    app, mock, _ = github
    mock.routes[("GET", f"/repos/{REPO}/pulls/46")] = httpx.Response(200, json={"node_id": "PR_1"})
    entry = {"state": "QUEUED", "position": 1}
    mock.graphql.append({"data": {"enqueuePullRequest": {"mergeQueueEntry": entry}}})
    assert app.enqueue_pull(REPO, 46, "a" * 40) == entry
    sent = json.loads(mock.requests[-1].content)
    assert sent["variables"] == {"id": "PR_1", "head": "a" * 40}
    assert (
        "enqueuePullRequest(input: {pullRequestId: $id, expectedHeadOid: $head})" in (sent["query"])
    )
    # An answer with no entry is a refusal, whatever kind GraphQL files its error under.
    missing = {"data": {"enqueuePullRequest": None}, "errors": [{"type": "NOT_FOUND"}]}
    mock.graphql += [missing, {"data": {"repository": {"pullRequest": _pull(46)}}}]
    with pytest.raises(GitHubRefused, match="no merge queue entry"):
        app.enqueue_pull(REPO, 46, "a" * 40)
    refusal = {"data": None, "errors": [{"message": "Head sha did not match"}]}
    mock.graphql += [refusal, {"data": {"repository": {"pullRequest": _pull(46)}}}]
    with pytest.raises(GitHubRefused):  # The head is still "a" * 40: not a move.
        app.enqueue_pull(REPO, 46, "a" * 40)
    mock.graphql += [
        refusal,
        {"data": {"repository": {"pullRequest": _pull(46, headRefOid="b" * 40)}}},
    ]
    with pytest.raises(HeadMoved) as moved:
        app.enqueue_pull(REPO, 46, "a" * 40)
    assert moved.value.head == "b" * 40
    mock.graphql.append({"data": {"dequeuePullRequest": {"clientMutationId": None}}})
    app.dequeue_pull(REPO, 46)
    sent = json.loads(mock.requests[-1].content)
    assert sent["variables"] == {"id": "PR_1"}
    assert "dequeuePullRequest(input: {id: $id})" in sent["query"]
    mock.graphql.append({"data": {"dequeuePullRequest": None}, "errors": [{"type": "NOT_FOUND"}]})
    with pytest.raises(GitHubRefused, match="did not take #46 out"):
        app.dequeue_pull(REPO, 46)


def test_rate_limit_reads_rest_and_graphql_from_one_call(github):
    app, mock, _ = github
    mock.routes[("GET", "/rate_limit")] = httpx.Response(
        200,
        json={
            "resources": {
                "core": {"limit": 5000, "remaining": 4910, "reset": 1_900_003_600},
                "graphql": {"limit": 5000, "remaining": 4725, "reset": 1_900_004_200},
            }
        },
    )
    limit = app.rate_limit()
    assert limit == {
        "remaining": 4910,
        "limit": 5000,
        "resetAt": "2030-03-17T18:46:40Z",
        "graphql": {
            "remaining": 4725,
            "limit": 5000,
            "resetAt": "2030-03-17T18:56:40Z",
        },
    }
    assert [r.url.path for r in mock.requests if r.url.path == "/rate_limit"] == ["/rate_limit"]
    # A response without resources.graphql, or with a null/partial/bool one, degrades cleanly.
    for extra in (
        {},
        {"graphql": None},
        {"graphql": {"remaining": 4700, "limit": 5000, "reset": None}},
        {"graphql": {"limit": 5000}},
        {"graphql": {"remaining": True, "limit": 5000, "reset": 1_900_004_200}},
    ):
        resources = {"core": {"limit": 5000, "remaining": 4900, "reset": 1_900_003_600}, **extra}
        mock.routes[("GET", "/rate_limit")] = httpx.Response(200, json={"resources": resources})
        rest_only = app.rate_limit()
        assert rest_only == {"remaining": 4900, "limit": 5000, "resetAt": "2030-03-17T18:46:40Z"}
        assert "graphql" not in rest_only
    # A missing or malformed core resource raises GitHubUnavailable instead of KeyError.
    for malformed in ({}, {"resources": {}}, {"resources": {"core": {"remaining": True}}}):
        mock.routes[("GET", "/rate_limit")] = httpx.Response(200, json=malformed)
        with pytest.raises(GitHubUnavailable, match="malformed"):
            app.rate_limit()


def test_ages_reports_key_mtime_and_token_remaining_through_gateway_status(key_pair, tmp_path):
    from botcore_factory.gateway.config import GatewayConfig
    from botcore_factory.gateway.service import Gateway
    from botcore_factory.gateway.state import GatewayState

    mock = MockGitHub()
    clock = Clock()
    # Without key_mtime, appKey is None; before any call, token is None.
    bare = GitHubApp(
        app_id=5,
        installation_id=7,
        private_key=key_pair[0],
        bot=BOT,
        data_dir=tmp_path / "bare",
        transport=httpx.MockTransport(mock),
        clock=clock,
    )
    assert bare.ages() == {"appKey": None, "token": None}

    # Future mtime (clock skew) clamps to 0.
    skewed = GitHubApp(
        app_id=5,
        installation_id=7,
        private_key=key_pair[0],
        bot=BOT,
        data_dir=tmp_path / "skewed",
        transport=httpx.MockTransport(mock),
        clock=clock,
        key_mtime=clock.at + 30.0,
    )
    assert skewed.ages()["appKey"] == 0

    app = GitHubApp(
        app_id=5,
        installation_id=7,
        private_key=key_pair[0],
        bot=BOT,
        data_dir=tmp_path / "data",
        transport=httpx.MockTransport(mock),
        clock=clock,
        key_mtime=clock.at - 7200.5,
    )
    assert app.ages() == {"appKey": 7200, "token": None}

    mock.routes[("GET", "/rate_limit")] = httpx.Response(
        200,
        json={
            "resources": {
                "core": {"limit": 5000, "remaining": 4990, "reset": 1_900_003_600},
                "graphql": {"limit": 5000, "remaining": 4880, "reset": 1_900_004_200},
            }
        },
    )
    config = GatewayConfig(bot=BOT, owner="o", ownerEmails=[OWNER], repositories=[REPO])
    gateway = Gateway(app, config, GatewayState(tmp_path / "state"), "owner")
    result = gateway.status("gateway-owner", ["pr-merge"])
    assert result.success
    # MockGitHub's token expires at 2030-03-17T18:33:20Z = epoch 1_900_002_800 (2800s after clock).
    assert result.data["ages"] == {"appKey": 7200, "token": 2800}
    assert "readOnlyToken" not in result.data["ages"]
    assert result.data["rateLimit"] == {
        "remaining": 4990,
        "resetAt": "2030-03-17T18:46:40Z",
        "graphql": {"remaining": 4880, "resetAt": "2030-03-17T18:56:40Z"},
    }

    # Past token expiry without a refresh, token clamps at 0 while appKey grows.
    clock.at += 3000.0
    assert app.ages() == {"appKey": 10200, "token": 0}


def test_cli_github_wires_key_file_mtime_into_github_app(tmp_path, key_pair, monkeypatch):
    from botcore_factory.gateway.cli import _github
    from botcore_factory.gateway.config import GatewayConfig
    from botcore_factory.gateway.github_app import read_private_key_with_mtime

    key = tmp_path / "app.pem"
    key.write_text(key_pair[0], encoding="utf-8")
    share(key, shared=False)
    installed_at = 1_700_000_000.0
    os.utime(key, (installed_at, installed_at))
    config = GatewayConfig(
        bot=BOT,
        owner="o",
        ownerEmails=[OWNER],
        repositories=[REPO],
        githubApp={"appId": 5, "installationId": 7},
    )
    # Never re-stat the path separately after reading: permissions, content and mtime come from
    # the same open descriptor.
    monkeypatch.setattr(
        Path,
        "stat",
        lambda self, *args, **kwargs: (_ for _ in ()).throw(AssertionError("used Path.stat")),
    )
    app = _github(config, tmp_path / "data", None, key)
    assert isinstance(app, GitHubApp)
    assert app._key_mtime == pytest.approx(installed_at, abs=2.0)
    assert app.ages()["appKey"] is not None and app.ages()["appKey"] > 0

    if os.name != "nt":
        # Replacing the file at the path after opening must not mix the old key with the new mtime.
        replacement = tmp_path / "replacement.pem"
        replacement.write_text("REPLACEMENT-KEY", encoding="utf-8")
        share(replacement, shared=False)
        newer_at = 1_800_000_000.0
        os.utime(replacement, (newer_at, newer_at))
        real_fdopen = os.fdopen
        replaced = False

        def replace_before_read(fd, *args, **kwargs):
            nonlocal replaced
            if not replaced:
                replaced = True
                os.replace(replacement, key)
            return real_fdopen(fd, *args, **kwargs)

        monkeypatch.setattr(os, "fdopen", replace_before_read)
        loaded_key, loaded_mtime = read_private_key_with_mtime(key)
        assert loaded_key == key_pair[0]
        assert loaded_mtime == pytest.approx(installed_at, abs=2.0)
