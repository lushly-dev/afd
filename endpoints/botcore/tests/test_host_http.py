"""Serving hosts over HTTP: tokens, routes, refusals, uploads, the client and the bind guard."""

from __future__ import annotations

import json
import os
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
from tests.windows_acl import assert_private

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


async def keep_upload(route, actor, data: bytes, params: dict):
    return success({"route": route, "by": actor.id, "bytes": len(data), "params": params})


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
    if os.name == "nt":
        assert_private(tmp_path / "tokens.json")
    else:
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


def test_an_unknown_route_is_forbidden_and_names_no_route_without_a_token(served):
    client, _, tokens = served
    response = client.post("/owner/call", headers=auth(tokens["lane"]), json={"command": "x"})
    assert response.status_code == 403 and response.json()["error"]["code"] == "FORBIDDEN"
    anonymous = client.get("/nowhere/catalog")
    assert anonymous.status_code == 401
    assert "/lane" not in json.dumps(anonymous.json()) and "/cell" not in json.dumps(
        anonymous.json()
    )


def test_a_call_body_over_the_limit_is_refused_even_when_chunked(served):
    client, _, tokens = served

    def chunks():
        for _ in range(1100):
            yield b"x" * 1024

    response = client.post("/lane/call", headers=auth(tokens["lane"]), content=chunks())
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_on_behalf_of_is_capped(served):
    client, _, tokens = served
    response = client.post(
        "/lane/call",
        headers=auth(tokens["lane"]),
        json={"command": "who-am-i", "onBehalfOf": "c" * 1000},
    )
    assert len(response.json()["data"]["onBehalfOf"]) == 200


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
    response = client.post(
        "/cell/uploads?repo=example-org/example-repo",
        headers=auth(tokens["cell"]),
        content=b"x" * 100,
    )
    assert response.json()["data"] == {
        "route": "cell",
        "by": "cell-3",
        "bytes": 100,
        "params": {"repo": "example-org/example-repo"},
    }


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


def test_a_route_not_named_for_uploads_is_refused_without_reaching_the_handler(tmp_path):
    tokens = TokenStore(tmp_path / "t.json")
    hosts = {"lane": make_host(tmp_path, "gw-lane"), "cell": make_host(tmp_path, "gw-cell")}
    received: list[str] = []

    async def record(route, actor, data, params):
        received.append(route)
        return success({})

    app = create_host_http_app(hosts, tokens, uploads=record, upload_routes=frozenset({"cell"}))
    _, lane = tokens.issue("lane", "service", "lane")
    _, cell = tokens.issue("cell", "agent", "cell-3")
    client = TestClient(app)

    response = client.post("/lane/uploads", headers=auth(lane), content=b"x")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"
    assert client.post("/cell/uploads", headers=auth(cell), content=b"x").json()["success"]
    assert received == ["cell"]


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


def test_concurrent_operator_commands_lose_no_token(tmp_path):
    import subprocess
    import sys

    store = str(tmp_path / "tokens.json")
    runs = [
        subprocess.Popen(
            [
                sys.executable,
                "-m",
                "botcore",
                "host-token",
                "issue",
                "--store",
                store,
                "--route",
                "lane",
                "--kind",
                "service",
                "--actor",
                f"lane-{index}",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        for index in range(6)
    ]
    try:
        outputs = [run.communicate(timeout=60) for run in runs]
    finally:
        for run in runs:
            if run.poll() is None:
                run.kill()
                run.communicate(timeout=5)
    for run, (stdout, stderr) in zip(runs, outputs, strict=True):
        assert run.returncode == 0, (
            f"exit={run.returncode}\nstdout={stdout.decode(errors='replace')}"
            f"\nstderr={stderr.decode(errors='replace')}"
        )
    issued = [json.loads(stdout) for stdout, _ in outputs]
    stored = {record.id for record in TokenStore(tmp_path / "tokens.json").list()}
    assert stored == {record["id"] for record in issued}
    leftovers = [
        p.name for p in tmp_path.iterdir() if p.name not in ("tokens.json", "tokens.json.lock")
    ]
    assert leftovers == []


def test_a_created_store_directory_is_private(tmp_path):
    TokenStore(tmp_path / "private" / "tokens.json").issue("lane", "service", "lane")
    if os.name == "nt":
        assert_private(tmp_path / "private")
    else:
        assert stat.S_IMODE((tmp_path / "private").stat().st_mode) == 0o700


def test_one_upload_at_a_time_beyond_the_limit_is_rate_limited(tmp_path):
    import asyncio

    import uvicorn

    started, release = threading.Event(), threading.Event()

    async def slow_upload(route, actor, data, params):
        started.set()
        await asyncio.to_thread(release.wait, 10)
        return success({"bytes": len(data)})

    tokens = TokenStore(tmp_path / "tokens.json")
    app = create_host_http_app(
        {"cell": make_host(tmp_path, "gw-cell")},
        tokens,
        uploads=slow_upload,
        max_concurrent_uploads=1,
    )
    _, secret = tokens.issue("cell", "agent", "cell-3")
    port = free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.01)
    client = HostClient(f"http://127.0.0.1:{port}", "cell", secret)
    first: dict = {}
    worker = threading.Thread(target=lambda: first.update(client.upload(b"a")))
    worker.start()
    assert started.wait(10)
    second = client.upload(b"b")
    release.set()
    worker.join(10)
    server.should_exit = True
    thread.join(5)
    assert second["error"]["code"] == "RATE_LIMITED"
    assert first["success"] is True


class _Recorder:
    """Plain HTTP servers: one that redirects, one that records and one that stalls."""

    def __init__(self) -> None:
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

        self.seen: list[dict] = []
        recorder = self

        class Target(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                recorder.seen.append(dict(self.headers))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"success": true}')

            def log_message(self, *args):
                pass

        self.target = ThreadingHTTPServer(("127.0.0.1", 0), Target)
        target_url = f"http://127.0.0.1:{self.target.server_address[1]}"

        class Redirector(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                self.send_response(307)
                self.send_header("Location", target_url + self.path)
                self.end_headers()

            def log_message(self, *args):
                pass

        class Staller(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                time.sleep(1.5)

            def log_message(self, *args):
                pass

        self.redirector = ThreadingHTTPServer(("127.0.0.1", 0), Redirector)
        self.staller = ThreadingHTTPServer(("127.0.0.1", 0), Staller)
        for server in (self.target, self.redirector, self.staller):
            threading.Thread(target=server.serve_forever, daemon=True).start()

    def url(self, server) -> str:
        return f"http://127.0.0.1:{server.server_address[1]}"

    def close(self) -> None:
        for server in (self.target, self.redirector, self.staller):
            server.shutdown()


def test_the_client_never_follows_a_redirect_with_its_token():
    servers = _Recorder()
    try:
        result = HostClient(servers.url(servers.redirector), "lane", "bct_secret").call("x")
    finally:
        servers.close()
    assert result["error"]["code"] == "HOST_UNAVAILABLE"
    assert servers.seen == []


def test_a_timeout_reports_an_unknown_outcome_and_a_refused_connection_a_known_one():
    servers = _Recorder()
    try:
        stalled = HostClient(servers.url(servers.staller), "lane", "bct_x", timeout=0.3).call("x")
    finally:
        servers.close()
    assert stalled["error"]["details"]["outcomeKnown"] is False
    assert "may or may not" in stalled["error"]["suggestion"]
    refused = HostClient(f"http://127.0.0.1:{free_port()}", "lane", "bct_x").call("x")
    assert refused["error"]["details"]["outcomeKnown"] is True
    assert "Nothing was sent" in refused["error"]["suggestion"]


def _serve(app):
    import uvicorn

    port = free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.01)
    return server, thread, port


def test_one_token_runs_one_upload_at_a_time(tmp_path):
    import asyncio

    started, release = threading.Event(), threading.Event()

    async def slow_upload(route, actor, data, params):
        started.set()
        await asyncio.to_thread(release.wait, 10)
        return success({"by": actor.id})

    tokens = TokenStore(tmp_path / "tokens.json")
    app = create_host_http_app(
        {"cell": make_host(tmp_path, "gw-cell")},
        tokens,
        uploads=slow_upload,
        max_concurrent_uploads=4,
    )
    _, first_token = tokens.issue("cell", "agent", "cell-3")
    _, other_token = tokens.issue("cell", "agent", "cell-4")
    server, thread, port = _serve(app)
    url = f"http://127.0.0.1:{port}"
    first: dict = {}
    worker = threading.Thread(
        target=lambda: first.update(HostClient(url, "cell", first_token).upload(b"a"))
    )
    worker.start()
    assert started.wait(10)
    again = HostClient(url, "cell", first_token).upload(b"b")
    release.set()
    other = HostClient(url, "cell", other_token).upload(b"c")
    worker.join(10)
    server.should_exit = True
    thread.join(5)
    assert again["error"]["code"] == "RATE_LIMITED"
    assert first["success"] and other["success"]


def test_an_upload_body_that_dribbles_in_is_refused_and_frees_its_slot(tmp_path):
    tokens = TokenStore(tmp_path / "tokens.json")
    app = create_host_http_app(
        {"cell": make_host(tmp_path, "gw-cell")},
        tokens,
        uploads=keep_upload,
        max_concurrent_uploads=1,
        upload_read_seconds=0.3,
    )
    _, secret = tokens.issue("cell", "agent", "cell-3")
    server, thread, port = _serve(app)
    with socket.create_connection(("127.0.0.1", port)) as slow:
        slow.sendall(
            f"POST /cell/uploads HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {secret}\r\n"
            "Content-Length: 1000\r\n\r\nabc".encode()
        )
        slow.settimeout(5)
        answer = ""
        while "}" not in answer:  # The headers can arrive before the body.
            chunk = slow.recv(65536).decode()
            if not chunk:
                break
            answer += chunk
    after = HostClient(f"http://127.0.0.1:{port}", "cell", secret).upload(b"ok")
    server.should_exit = True
    thread.join(5)
    assert " 408 " in answer.splitlines()[0] and "TIMEOUT" in answer
    assert after["success"] is True
