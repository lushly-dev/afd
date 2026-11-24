"""The gateway as a server: its routes behind tokens, real bundle uploads and the CLIs."""

from __future__ import annotations

import json
import os
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from click.testing import CliRunner
from conftest import REPO_ROOT

pytest.importorskip("starlette")

from starlette.testclient import TestClient  # noqa: E402

from botcore_factory.gateway import GatewayConfig  # noqa: E402
from botcore_factory.gateway.cli import admin_cli  # noqa: E402
from botcore_factory.gateway.github import FakeGitHub, fake_world  # noqa: E402
from botcore_factory.gateway.harness import _CONFIG_KEYS as CONFIG_KEYS  # noqa: E402
from botcore_factory.gateway.server import build_gateway_app, token_store  # noqa: E402
from botcore_factory.gateway.state import read_journal  # noqa: E402
from botcore_factory.gateway.uploads import mirror_path  # noqa: E402

FIXTURES = REPO_ROOT / "docs/features/active/factory-gateway/scenarios/fixtures"
REPO = "example-org/example-repo"
OWNER = "owner@example.com"
AGENT = "noreply@anthropic.com"


class Clock:
    def __init__(self) -> None:
        self.at = datetime(2030, 2, 3, 10, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.at


@pytest.fixture
def gateway(tmp_path):
    fixture = json.loads((FIXTURES / "gateway.json").read_text(encoding="utf-8"))
    config = GatewayConfig(
        **{
            k: v
            for k, v in fixture.items()
            if k in CONFIG_KEYS and not (k == "journal" and isinstance(v, list))
        }
    )
    github_file = tmp_path / "github.json"
    github_file.write_text(json.dumps(fake_world(fixture, REPO)), encoding="utf-8")
    clock = Clock()
    data = tmp_path / "data"
    app = build_gateway_app(data, config, FakeGitHub(github_file, bot=config.bot), clock=clock)
    store = token_store(data)
    tokens = {
        route: store.issue(route, kind, actor)[1]
        for route, kind, actor in [
            ("cell", "agent", "cell-3"),
            ("session", "agent", "session@workstation"),
            ("lane", "service", "lane@random"),
            ("owner", "human", "owner"),
            ("heartbeat", "service", "lane-heartbeat@random"),
        ]
    }
    return TestClient(app), tokens, data, clock, github_file


def call(client, token, route, command, **arguments):
    response = client.post(
        f"/{route}/call",
        headers={"Authorization": f"Bearer {token}"},
        json={"command": command, "arguments": arguments},
    )
    return response.json()


def git(directory: Path, *arguments: str, email: str = OWNER) -> str:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "Someone",
        "GIT_AUTHOR_EMAIL": email,
        "GIT_COMMITTER_NAME": "Someone",
        "GIT_COMMITTER_EMAIL": email,
        "GIT_CONFIG_NOSYSTEM": "1",
        "HOME": str(directory),
    }
    return subprocess.run(
        ["git", *arguments], cwd=directory, env=env, check=True, capture_output=True, text=True
    ).stdout.strip()


def make_bundle(tmp_path: Path, emails: list[str]) -> tuple[bytes, str]:
    """A repository with one commit per email on branch fix/x, bundled whole."""
    work = tmp_path / "work"
    work.mkdir()
    git(work, "init", "--quiet", "--initial-branch=fix/x")
    for index, email in enumerate(emails):
        (work / f"f{index}.txt").write_text(str(index), encoding="utf-8")
        git(work, "add", ".", email=email)
        git(work, "commit", "--quiet", "-m", f"change {index}", email=email)
    head = git(work, "rev-parse", "HEAD")
    git(work, "bundle", "create", "--quiet", str(tmp_path / "head.bundle"), "fix/x")
    return (tmp_path / "head.bundle").read_bytes(), head


def upload(client, token, data: bytes, route="cell", repo=REPO):
    response = client.post(
        f"/{route}/uploads?repo={repo}",
        headers={"Authorization": f"Bearer {token}"},
        content=data,
    )
    return response.json()


# ── Routes and the journal ──────────────────────────────────────────────


def test_a_heartbeat_token_reports_the_lane_and_opens_nothing_else(gateway):
    """The token a lane's loop holds, and its queued branches' code can read: it reports the
    lane's health and cannot push, merge, claim or use another route."""
    client, tokens, *_ = gateway
    token = tokens["heartbeat"]
    beat = call(
        client,
        token,
        "heartbeat",
        "lane-heartbeat",
        repo=REPO,
        host="random",
        running=True,
        queued=0,
    )
    assert beat["success"] and beat["data"]["lane"]["running"] is True, beat
    status = call(client, token, "heartbeat", "gateway-status")
    assert status["data"]["writes"] == []
    assert status["data"]["lanes"][0]["host"] == "random"
    for command, arguments in [
        ("pr-merge", {"repo": REPO, "number": 44, "head": "a" * 40}),
        (
            "issue-claim",
            {"repo": REPO, "numbers": [103], "holder": {"branch": "b", "machine": "m"}},
        ),
        ("branch-push", {"repo": REPO, "ref": "refs/heads/x", "head": "a" * 40, "bundle": "x"}),
        (
            "verification-record",
            {"repo": REPO, "head": "a" * 40, "result": "passed", "summary": "s"},
        ),
        ("issue-get", {"repo": REPO, "number": 103}),
    ]:
        refused = call(client, token, "heartbeat", command, **arguments)
        assert refused["error"]["code"] == "COMMAND_NOT_FOUND", (command, refused)
    other = call(client, token, "lane", "gateway-status")
    assert other["error"]["code"] == "FORBIDDEN"
    elsewhere = call(
        client,
        token,
        "heartbeat",
        "lane-heartbeat",
        repo=REPO,
        host="spare",
        running=True,
        queued=0,
    )
    assert elsewhere["error"]["code"] == "HOST_NOT_TOKEN_S"  # Only the host it was issued for.
    catalog = client.get("/heartbeat/catalog", headers={"Authorization": f"Bearer {token}"})
    assert sorted(row["name"] for row in catalog.json()["commands"]) == [
        "gateway-status",
        "lane-heartbeat",
    ]


def test_a_route_that_cannot_push_takes_no_uploads(gateway, tmp_path):
    client, tokens, *_ = gateway
    data, _ = make_bundle(tmp_path, [OWNER])
    _, foreman = token_store(tmp_path / "data").issue("foreman", "agent", "foreman")
    for route, token in (("heartbeat", tokens["heartbeat"]), ("foreman", foreman)):
        refused = upload(client, token, data, route=route)
        assert refused["error"]["code"] == "NOT_FOUND", refused  # Refused before the handler.
    state_file = tmp_path / "data" / "state.json"
    state = json.loads(state_file.read_text("utf-8")) if state_file.exists() else {}
    assert state.get("uploads", {}) == {}  # Nothing was recorded or fetched.
    assert upload(client, tokens["cell"], data)["success"]


def test_the_upload_handler_refuses_a_route_that_cannot_push(gateway, tmp_path):
    """The gateway's own check, behind botcore's: it holds if a server forgets upload_routes."""
    from afd import Actor

    from botcore_factory.gateway.service import Gateway
    from botcore_factory.gateway.state import GatewayState
    from botcore_factory.gateway.uploads import BundleUploads

    _, _, data_dir, *_ = gateway
    state = GatewayState(data_dir)
    fixture = json.loads((FIXTURES / "gateway.json").read_text(encoding="utf-8"))
    config = GatewayConfig(
        **{
            k: v
            for k, v in fixture.items()
            if k in CONFIG_KEYS and not (k == "journal" and isinstance(v, list))
        }
    )
    gw = Gateway(FakeGitHub(tmp_path / "github.json", bot=config.bot), config, state, "heartbeat")
    data, _ = make_bundle(tmp_path, [OWNER])
    result = BundleUploads(gw, data_dir).receive(
        "heartbeat", Actor(kind="service", id="lane-heartbeat@random"), data, {"repo": REPO}
    )
    assert result.error and result.error.code == "FORBIDDEN" and result.error.suggestion


def test_every_route_answers_with_its_own_writes(gateway):
    client, tokens, *_ = gateway
    for route, token in tokens.items():
        status = call(client, token, route, "gateway-status")
        assert status["success"], status
        assert status["data"]["ages"] == {"appKey": 0, "token": 3600}
        assert "readOnlyToken" not in status["data"]["ages"]
        assert status["data"]["rateLimit"]["graphql"]["remaining"] == 5000
    cell = call(client, tokens["cell"], "cell", "pr-merge", repo=REPO, number=44, head="a" * 40)
    assert cell["error"]["code"] == "COMMAND_NOT_FOUND"


def test_a_write_is_journaled_as_the_token_s_actor(gateway):
    client, tokens, data, *_ = gateway
    holder = {"branch": "fix/parser", "machine": "workstation"}
    claimed = call(
        client,
        tokens["session"],
        "session",
        "issue-claim",
        repo=REPO,
        numbers=[101],
        holder=holder,
    )
    assert claimed["success"], claimed
    entries = read_journal(data / "journal")
    claim = next(entry for entry in entries if entry.command == "issue-claim")
    assert claim.actor.kind == "agent" and claim.actor.id == "session@workstation"


# ── Uploads read with git ───────────────────────────────────────────────


def test_an_owner_authored_branch_uploads_and_hands_off_to_the_lane(gateway, tmp_path):
    client, tokens, data, *_ = gateway
    bundle, head = make_bundle(tmp_path, [OWNER, OWNER])
    uploaded = upload(client, tokens["session"], bundle, route="session")
    assert uploaded["success"], uploaded
    assert uploaded["data"]["heads"] == [head] and uploaded["data"]["commits"] == 2
    pushed = call(
        client,
        tokens["session"],
        "session",
        "branch-push",
        repo=REPO,
        ref="refs/factory/queue/fix/x",
        head=head,
        bundle=uploaded["data"]["id"],
    )
    assert pushed["success"], pushed
    assert pushed["data"]["changed"] is True
    # The bundle is deleted once fetched; its objects are in the mirror.
    assert list((data / "uploads").iterdir()) == []


def test_a_commit_an_agent_authored_is_read_from_the_bundle_and_refused(gateway, tmp_path):
    client, tokens, *_ = gateway
    bundle, head = make_bundle(tmp_path, [OWNER, AGENT])
    uploaded = upload(client, tokens["cell"], bundle)
    pushed = call(
        client,
        tokens["cell"],
        "cell",
        "branch-push",
        repo=REPO,
        ref="refs/factory/queue/fix/x",
        head=head,
        bundle=uploaded["data"]["id"],
    )
    assert pushed["error"]["code"] == "COMMIT_AUTHOR_NOT_OWNER"
    assert AGENT in pushed["error"]["message"]


def test_commits_already_on_the_mirror_s_main_are_not_counted(gateway, tmp_path):
    client, tokens, data, *_ = gateway
    bundle, head = make_bundle(tmp_path, [AGENT, OWNER])
    first = upload(client, tokens["cell"], bundle)
    mirror = mirror_path(data, REPO)
    # As the App adapter will: main moves to include the agent's (merged) first commit.
    base = git(tmp_path / "work", "rev-parse", "HEAD~1")
    subprocess.run(
        ["git", "--git-dir", str(mirror), "update-ref", "refs/heads/main", base], check=True
    )
    second = upload(client, tokens["cell"], bundle)
    assert first["data"]["commits"] == 2 and second["data"]["commits"] == 1
    pushed = call(
        client,
        tokens["cell"],
        "cell",
        "branch-push",
        repo=REPO,
        ref="refs/factory/queue/fix/x",
        head=head,
        bundle=second["data"]["id"],
    )
    assert pushed["success"], pushed


def test_an_upload_must_name_a_served_repository(gateway, tmp_path):
    client, tokens, *_ = gateway
    bundle, _ = make_bundle(tmp_path, [OWNER])
    result = upload(client, tokens["cell"], bundle, repo="someone/else")
    assert result["error"]["code"] == "VALIDATION_ERROR"


def test_bytes_that_are_not_a_bundle_are_refused_and_not_kept(gateway):
    client, tokens, data, *_ = gateway
    result = upload(client, tokens["cell"], b"not a bundle")
    assert result["error"]["code"] == "BUNDLE_INVALID"
    assert list((data / "uploads").iterdir()) == []


def test_an_expired_upload_is_forgotten_and_its_bundle_deleted(gateway, tmp_path):
    client, tokens, data, clock, _ = gateway
    bundle, head = make_bundle(tmp_path, [OWNER])
    old = upload(client, tokens["cell"], bundle)
    clock.at += timedelta(hours=2)
    upload(client, tokens["cell"], bundle)
    pushed = call(
        client,
        tokens["cell"],
        "cell",
        "branch-push",
        repo=REPO,
        ref="refs/factory/queue/fix/x",
        head=head,
        bundle=old["data"]["id"],
    )
    assert pushed["error"]["code"] == "UPLOAD_NOT_FOUND"
    refs = subprocess.run(
        ["git", "--git-dir", str(mirror_path(data, REPO)), "for-each-ref", "refs/uploads/"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert old["data"]["id"] not in refs


def extend(tmp_path: Path, email: str = OWNER) -> tuple[bytes, str]:
    """One more commit on fix/x, bundled whole."""
    work = tmp_path / "work"
    index = len(list(work.glob("f*.txt")))
    (work / f"f{index}.txt").write_text(str(index), encoding="utf-8")
    git(work, "add", ".", email=email)
    git(work, "commit", "--quiet", "-m", f"change {index}", email=email)
    git(work, "bundle", "create", "--quiet", str(tmp_path / "head.bundle"), "fix/x")
    return (tmp_path / "head.bundle").read_bytes(), git(work, "rev-parse", "HEAD")


def lane_push(client, tokens, data: bytes, head: str, ref="refs/heads/fix/x"):
    uploaded = upload(client, tokens["lane"], data, route="lane")
    assert uploaded["success"], uploaded
    return call(
        client,
        tokens["lane"],
        "lane",
        "branch-push",
        repo=REPO,
        ref=ref,
        head=head,
        bundle=uploaded["data"]["id"],
    )


def test_a_branch_moves_forward_from_what_git_says_it_contains(gateway, tmp_path):
    client, tokens, *_ = gateway
    first, old = make_bundle(tmp_path, [OWNER])
    assert lane_push(client, tokens, first, old)["success"]
    second, new = extend(tmp_path)
    pushed = lane_push(client, tokens, second, new)
    assert pushed["success"] and pushed["data"]["changed"], pushed


def test_a_bundle_naming_the_current_tip_cannot_rewind_the_branch(gateway, tmp_path):
    client, tokens, *_ = gateway
    first, tip = make_bundle(tmp_path, [OWNER])
    assert lane_push(client, tokens, first, tip)["success"]
    # An unrelated history whose bundle also carries the branch's tip as a second head.
    other = tmp_path / "other"
    other.mkdir()
    git(other, "init", "--quiet", "--initial-branch=rewrite")
    (other / "g.txt").write_text("x", encoding="utf-8")
    git(other, "add", ".")
    git(other, "commit", "--quiet", "-m", "unrelated")
    unrelated = git(other, "rev-parse", "HEAD")
    git(other, "fetch", "--quiet", str(tmp_path / "work"), f"{tip}:refs/heads/tip")
    git(other, "bundle", "create", "--quiet", str(tmp_path / "both.bundle"), "rewrite", "tip")
    pushed = lane_push(client, tokens, (tmp_path / "both.bundle").read_bytes(), unrelated)
    assert pushed["error"]["code"] == "NOT_FAST_FORWARD"


def test_an_upload_is_pushed_only_by_the_caller_that_made_it(gateway, tmp_path):
    client, tokens, data, *_ = gateway
    store = token_store(data)
    _, other_cell = store.issue("cell", "agent", "cell-4")
    bundle, head = make_bundle(tmp_path, [OWNER])
    uploaded = upload(client, tokens["cell"], bundle)
    stolen = call(
        client,
        other_cell,
        "cell",
        "branch-push",
        repo=REPO,
        ref="refs/factory/queue/fix/x",
        head=head,
        bundle=uploaded["data"]["id"],
    )
    assert stolen["error"]["code"] == "UPLOAD_NOT_FOUND"
    owner = call(
        client,
        tokens["owner"],
        "owner",
        "branch-push",
        repo=REPO,
        ref="refs/factory/queue/fix/x",
        head=head,
        bundle=uploaded["data"]["id"],
    )
    assert owner["success"], owner


def test_a_caller_holds_a_bounded_number_of_live_uploads(gateway, tmp_path):
    from botcore_factory.gateway.uploads import MAX_LIVE_UPLOADS

    client, tokens, *_ = gateway
    bundle, _ = make_bundle(tmp_path, [OWNER])
    results = [upload(client, tokens["cell"], bundle) for _ in range(MAX_LIVE_UPLOADS + 1)]
    assert all(result["success"] for result in results[:-1])
    assert results[-1]["error"]["code"] == "RATE_LIMITED"
    assert upload(client, tokens["session"], bundle, route="session")["success"]


# ── The operator's CLI ──────────────────────────────────────────────────


def test_the_admin_cli_issues_a_token_the_server_accepts(gateway):
    client, _, data, *_ = gateway
    runner = CliRunner()
    issued = runner.invoke(
        admin_cli,
        [
            "token",
            "issue",
            "--data",
            str(data),
            "--route",
            "foreman",
            "--kind",
            "agent",
            "--actor",
            "foreman",
        ],
    )
    assert issued.exit_code == 0, issued.output
    secret = json.loads(issued.output)["token"]
    assert call(client, secret, "foreman", "gateway-status")["success"]
    record_id = json.loads(issued.output)["id"]
    assert (
        runner.invoke(admin_cli, ["token", "revoke", "--data", str(data), record_id]).exit_code == 0
    )
    assert (
        client.post(
            "/foreman/call", headers={"Authorization": f"Bearer {secret}"}, json={"command": "x"}
        ).status_code
        == 401
    )


def test_serve_refuses_without_a_github_and_beyond_the_tailnet(tmp_path):
    config = tmp_path / "gateway.json"
    config.write_text(
        json.dumps({"bot": "b[bot]", "owner": "o", "ownerEmails": [OWNER], "repositories": [REPO]})
    )
    runner = CliRunner()
    base = ["serve", "--data", str(tmp_path / "d"), "--config", str(config)]
    no_github = runner.invoke(admin_cli, [*base, "--address", "127.0.0.1"])
    assert no_github.exit_code == 2 and "githubApp" in no_github.output
    github = tmp_path / "github.json"
    github.write_text(json.dumps({"repo": REPO}))
    lan = runner.invoke(
        admin_cli, [*base, "--address", "192.168.1.5", "--fake-github", str(github)]
    )
    assert lan.exit_code == 2 and "tailnet" in lan.output


def test_an_expired_large_upload_leaves_no_pack_behind(gateway, tmp_path):
    client, tokens, data, clock, _ = gateway
    bundle, _ = make_bundle(tmp_path, [OWNER] * 120)  # Over git's unpack limit: kept as a pack.
    mirror = mirror_path(data, REPO)
    upload(client, tokens["cell"], bundle)

    def stored() -> int:
        return sum(p.stat().st_size for p in (mirror / "objects").rglob("*") if p.is_file())

    held = stored()
    clock.at += timedelta(hours=2)
    other = tmp_path / "other"
    other.mkdir()
    small, _ = make_bundle(other, [OWNER])  # An unrelated upload; any upload runs expiry first.
    assert upload(client, tokens["session"], small, route="session")["success"]
    assert stored() < held


def test_a_ref_that_moves_between_the_read_and_the_push_is_not_overwritten(
    gateway, tmp_path, monkeypatch
):
    client, tokens, _, _, github_file = gateway
    data, head = make_bundle(tmp_path, [OWNER])
    queue = "refs/factory/queue/fix-x"
    real_ref = FakeGitHub.ref

    def ref_then_someone_pushes(self, repo, ref):
        current = real_ref(self, repo, ref)
        if ref == queue:
            self._data["refs"][ref] = "f" * 40  # Another writer, after the gateway's read.
        return current

    monkeypatch.setattr(FakeGitHub, "ref", ref_then_someone_pushes)
    result = lane_push(client, tokens, data, head, ref=queue)
    assert result["error"]["code"] == "HEAD_MOVED", result
    assert result["error"]["details"]["head"] == "f" * 40
    world = json.loads(github_file.read_text(encoding="utf-8"))
    assert world["refs"].get(queue) != head


def test_a_heartbeat_token_must_name_its_host_exactly(gateway):
    client, _, data, *_ = gateway
    store = token_store(data)
    for actor in ("lane-heartbeat@xrandom", "random", "lane-heartbeat@random@x"):
        _, token = store.issue("heartbeat", "service", actor)
        refused = call(
            client,
            token,
            "heartbeat",
            "lane-heartbeat",
            repo=REPO,
            host="random",
            running=True,
            queued=0,
        )
        assert refused["error"]["code"] == "HOST_NOT_TOKEN_S", actor


def test_a_heartbeat_token_must_be_issued_for_a_host(tmp_path):
    runner = CliRunner()
    base = ["token", "issue", "--data", str(tmp_path), "--route", "heartbeat", "--kind", "service"]
    for actor in ("random", "lane-heartbeat@", "@random"):
        refused = runner.invoke(admin_cli, [*base, "--actor", actor])
        assert refused.exit_code != 0 and "lane-heartbeat@<host>" in refused.output, actor
    issued = runner.invoke(admin_cli, [*base, "--actor", "lane-heartbeat@random"])
    assert issued.exit_code == 0, issued.output
