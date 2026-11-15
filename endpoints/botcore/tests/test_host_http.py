"""Serving hosts over HTTP: tokens, routes, refusals, uploads, the client and the bind guard."""

from __future__ import annotations

import json
import socket
import stat
import threading
import time

import pytest
from afd import error, success
from click.testing import CliRunner

from botcore.context import ExecutionContext, current_call
from botcore.host import CommandHost, CommandPolicy
from botcore.host_client import HostClient, create_remote_cli
from botcore.host_tokens import TokenStore

pytest.importorskip("starlette")
pytest.importorskip("uvicorn")

from starlette.testclient import TestClient  # noqa: E402

from botcore.host_http import check_bind_address, create_host_http_app  # noqa: E402


async def who_am_i(note: str = "") -> object:
    """Say who called.

    Args:
        note: Echoed back.
    """
    actor = current_call().actor
    return success(
        {"kind": actor.kind, "id": actor.id, "onBehalfOf": actor.on_behalf_of, "note": note}
    )


async def refuse_always() -> object:
    """Always refuse."""
    return error("NOPE", "refused", suggestion="Do something else")


def make_host(tmp_path, name: str) -> CommandHost:
    host = CommandHost(name, ExecutionContext(tmp_path, profile="remote-caller"))
    host.register("who-am-i", who_am_i, CommandPolicy(("inspect",)))
    host.register("refuse-always", refuse_always, CommandPolicy(("inspect",)))
    host.docs = {"guide": "# Guide"}
    return host


async def keep_upload(route, actor, data: bytes):
    return success({"route": route, "by": actor.id, "bytes": len(data)})


@pytest.fixture
def served(tmp_path):
    tokens = TokenStore(tmp_path / "tokens.json")
    hosts = {"lane": make_host(tmp_path, "gateway-lane"), "cell": make_host(tmp_path, "gw-cell")}
    app = create_host_http_app(hosts, tokens, uploads=keep_upload, max_upload_bytes=1024)
    _, lane = tokens.issue("lane", "service", "lane@random", "The lane")
    _, cell = tokens.issue("cell", "agent", "cell-3")
    return TestClient(app), tokens, {"lane": lane, "cell": cell}


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Tokens ──────────────────────────────────────────────────────────────


def test_the_store_keeps_digests_only_and_is_private(tmp_path):
    store = TokenStore(tmp_path / "tokens.json")
    record, secret = store.issue("lane", "service", "lane@random")
    text = (tmp_path / "tokens.json").read_text()
    assert secret not in text and record.id in text
    assert stat.S_IMODE((tmp_path / "tokens.json").stat().st_mode) == 0o600
    assert store.verify(secret) == record
    assert store.verify("bct_wrong") is None and store.verify(None) is None


def test_a_revocation_by_another_process_takes_effect_on_the_next_call(tmp_path):
    server = TokenStore(tmp_path / "tokens.json")
    record, secret = server.issue("lane", "service", "lane@random")
    assert server.verify(secret) is not None
    time.sleep(0.01)  # A distinct modification time for the operator's write.
    assert TokenStore(tmp_path / "tokens.json").revoke(record.id).revoked_at
    assert server.verify(secret) is None
    assert TokenStore(tmp_path / "tokens.json").revoke("missing") is None


def test_a_token_needs_a_known_kind(tmp_path):
    with pytest.raises(ValueError, match="kind"):
        TokenStore(tmp_path / "t.json").issue("lane", "robot", "x")


# ── Routes ──────────────────────────────────────────────────────────────


def test_a_call_runs_as_the_token_s_actor(served):
    client, _, tokens = served
    response = client.post(
        "/lane/call",
        headers=auth(tokens["lane"]),
        json={"command": "who-am-i", "arguments": {"note": "hi"}, "onBehalfOf": "cell-3"},
    )
    assert response.status_code == 200
    assert response.json()["data"] == {
        "kind": "service",
        "id": "lane@random",
        "onBehalfOf": "cell-3",
        "note": "hi",
    }


@pytest.mark.parametrize(
    ("headers", "status", "code"),
    [({}, 401, "UNAUTHORIZED"), ({"Authorization": "Bearer bct_forged"}, 401, "UNAUTHORIZED")],
)
def test_a_call_without_a_valid_token_is_refused(served, headers, status, code):
    client, _, _ = served
    response = client.post("/lane/call", headers=headers, json={"command": "who-am-i"})
    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    assert response.json()["error"]["suggestion"]


def test_a_token_opens_only_its_own_route(served):
    client, _, tokens = served
    response = client.post("/lane/call", headers=auth(tokens["cell"]), json={"command": "x"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"
    assert "/cell" in response.json()["error"]["suggestion"]


def test_an_unknown_route_is_not_found(served):
    client, _, tokens = served
    response = client.post("/owner/call", headers=auth(tokens["lane"]), json={"command": "x"})
    assert response.status_code == 404 and response.json()["error"]["code"] == "NOT_FOUND"


def test_a_command_s_own_refusal_is_a_200_with_its_result(served):
    client, _, tokens = served
    response = client.post(
        "/lane/call", headers=auth(tokens["lane"]), json={"command": "refuse-always"}
    )
    assert response.status_code == 200 and response.json()["error"]["code"] == "NOPE"
    missing = client.post("/lane/call", headers=auth(tokens["lane"]), json={"command": "whoami"})
    assert missing.json()["error"]["code"] == "COMMAND_NOT_FOUND"


def test_a_body_without_a_command_is_a_validation_error(served):
    client, _, tokens = served
    response = client.post("/lane/call", headers=auth(tokens["lane"]), content=b"not json")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_the_catalog_and_docs_are_served_behind_the_token(served):
    client, _, tokens = served
    catalog = client.get("/lane/catalog", headers=auth(tokens["lane"])).json()
    assert catalog["name"] == "gateway-lane" and catalog["profile"] == "remote-caller"
    assert {c["name"] for c in catalog["commands"]} == {"who-am-i", "refuse-always"}
    assert client.get("/lane/catalog").status_code == 401
    guide = client.get("/lane/docs/guide", headers=auth(tokens["lane"])).json()
    assert guide == {"topic": "guide", "text": "# Guide"}
    assert client.get("/lane/docs/none", headers=auth(tokens["lane"])).status_code == 404


def test_an_upload_reaches_the_handler_with_the_caller(served):
    client, _, tokens = served
    response = client.post("/cell/uploads", headers=auth(tokens["cell"]), content=b"x" * 100)
    assert response.json()["data"] == {"route": "cell", "by": "cell-3", "bytes": 100}


def test_an_upload_over_the_limit_is_refused(served):
    client, _, tokens = served
    response = client.post("/cell/uploads", headers=auth(tokens["cell"]), content=b"x" * 2048)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_a_server_without_an_upload_handler_takes_no_uploads(tmp_path):
    tokens = TokenStore(tmp_path / "t.json")
    _, secret = tokens.issue("lane", "service", "lane")
    client = TestClient(create_host_http_app({"lane": make_host(tmp_path, "h")}, tokens))
    response = client.post("/lane/uploads", headers=auth(secret), content=b"x")
    assert response.status_code == 404


# ── Binding ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("address", ["127.0.0.1", "::1", "100.101.102.103", "fd7a:115c:a1e0::5"])
def test_loopback_and_tailnet_addresses_may_be_bound(address):
    check_bind_address(address)


@pytest.mark.parametrize("address", ["0.0.0.0", "::", "192.168.1.20", "8.8.8.8", "random"])
def test_wildcard_lan_public_and_names_are_refused(address):
    with pytest.raises(ValueError):
        check_bind_address(address)
    check_bind_address(address, allow_any=True)


# ── The client against a live server ────────────────────────────────────


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@pytest.fixture
def live(tmp_path):
    import uvicorn

    tokens = TokenStore(tmp_path / "tokens.json")
    app = create_host_http_app({"lane": make_host(tmp_path, "gateway-lane")}, tokens)
    _, secret = tokens.issue("lane", "service", "lane@random")
    port = free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(200):
        if server.started:
            break
        time.sleep(0.01)
    yield f"http://127.0.0.1:{port}", secret
    server.should_exit = True
    thread.join(timeout=5)


def test_the_client_calls_and_reads_the_catalog(live):
    url, secret = live
    client = HostClient(url, "lane", secret)
    assert client.call("who-am-i", {"note": "x"})["data"]["id"] == "lane@random"
    assert client.catalog()["name"] == "gateway-lane"
    refused = HostClient(url, "lane", "bct_wrong").call("who-am-i")
    assert refused["error"]["code"] == "UNAUTHORIZED"


def test_an_unreachable_server_is_its_own_error_never_an_exception():
    client = HostClient(
        f"http://127.0.0.1:{free_port()}", "lane", "bct_x", unavailable_code="GATEWAY_UNAVAILABLE"
    )
    result = client.call("who-am-i")
    assert result["success"] is False
    assert result["error"]["code"] == "GATEWAY_UNAVAILABLE"
    assert "retry" in result["error"]["suggestion"].lower()


def test_the_remote_cli_exits_by_outcome(live, monkeypatch):
    url, secret = live
    cli = create_remote_cli("gw", env_prefix="GW", unavailable_code="GATEWAY_UNAVAILABLE")
    runner = CliRunner()
    monkeypatch.setenv("GW_URL", url)
    monkeypatch.setenv("GW_ROUTE", "lane")
    monkeypatch.setenv("GW_TOKEN", secret)
    ok = runner.invoke(cli, ["call", "who-am-i", "--args", '{"note": "cli"}'])
    assert ok.exit_code == 0 and json.loads(ok.output)["data"]["note"] == "cli"
    refused = runner.invoke(cli, ["call", "refuse-always"])
    assert refused.exit_code == 1
    down = runner.invoke(cli, ["call", "who-am-i", "--url", f"http://127.0.0.1:{free_port()}"])
    assert down.exit_code == 2
    assert json.loads(down.output)["error"]["code"] == "GATEWAY_UNAVAILABLE"


def test_the_operator_cli_issues_lists_and_revokes(tmp_path):
    from botcore.cli import cli

    store = str(tmp_path / "tokens.json")
    runner = CliRunner()
    issued = runner.invoke(
        cli,
        [
            "host-token",
            "issue",
            "--store",
            store,
            "--route",
            "lane",
            "--kind",
            "service",
            "--actor",
            "lane@random",
        ],
    )
    assert issued.exit_code == 0, issued.output
    record = json.loads(issued.output)
    assert record["token"].startswith("bct_") and record["route"] == "lane"
    listed = json.loads(runner.invoke(cli, ["host-token", "list", "--store", store]).output)
    assert [row["id"] for row in listed] == [record["id"]] and "token" not in listed[0]
    revoked = runner.invoke(cli, ["host-token", "revoke", "--store", store, record["id"]])
    assert revoked.exit_code == 0 and json.loads(revoked.output)["revokedAt"]
    assert runner.invoke(cli, ["host-token", "revoke", "--store", store, "nope"]).exit_code == 1
