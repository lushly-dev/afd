"""Conformance and protocol tests for MCP resources & skills (``spec/mcp-resources.md``).

Loads ``spec/vectors/mcp-resources.json`` and runs every vector over Streamable HTTP (modern 2026-07-28
and legacy 2025-11-25) and over in-process MCP streams (stdio transport wire format, both eras).
"""

from __future__ import annotations

import base64
import json
from collections.abc import Sequence
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("mcp")

import anyio  # noqa: E402
import httpx  # noqa: E402
from mcp.shared.message import SessionMessage  # noqa: E402
from mcp_types import JSONRPCNotification, JSONRPCRequest  # noqa: E402

from afd import success  # noqa: E402
from afd.server import (  # noqa: E402
    MCP_APP_MIME_TYPE,
    McpAuthOptions,
    ResourceContents,
    ResourceEntry,
    Skill,
    SkillCatalog,
    TokenRefused,
    create_server,
    sha256_digest,
)

MODERN = "2026-07-28"
LEGACY = "2025-11-25"
SPEC_VECTORS = Path(__file__).resolve().parents[2] / "spec" / "vectors" / "mcp-resources.json"


def _load_vectors() -> dict[str, Any]:
    return json.loads(SPEC_VECTORS.read_text(encoding="utf-8"))


def _catalog_from_spec(skills_spec: list[dict[str, Any]], *, directory_read: bool = False) -> SkillCatalog:
    skills: list[Skill] = []
    for item in skills_spec:
        files: dict[str, str | bytes] = {}
        for f in item["files"]:
            if "text" in f:
                files[f["path"]] = f["text"]
            else:
                files[f["path"]] = base64.b64decode(f["base64"])
        skills.append(Skill(path=item["path"], files=files))
    return SkillCatalog(skills, directory_read=directory_read)


def _modern_meta(extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "io.modelcontextprotocol/protocolVersion": MODERN,
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": {"name": "resources-test", "version": "0"},
        **(extra or {}),
    }


@asynccontextmanager
async def _http_client(server: Any, *, stateless: bool = True):
    app = server.streamable_http_app(stateless_http=stateless, json_response=True)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://127.0.0.1:8000",
        ) as http,
    ):
        yield http


async def _modern_http(
    http: httpx.AsyncClient,
    method: str,
    params: dict[str, Any] | None = None,
    *,
    headers: dict[str, str] | None = None,
    include_mcp_name: bool = True,
    expected_status: int | None = 200,
) -> tuple[int, dict[str, Any]]:
    full_params = dict(params or {})
    full_params["_meta"] = _modern_meta(full_params.get("_meta"))
    req_headers: dict[str, str] = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": MODERN,
        "Mcp-Method": method,
    }
    if include_mcp_name and method == "resources/read" and isinstance(full_params.get("uri"), str):
        req_headers["Mcp-Name"] = full_params["uri"]
    if headers:
        req_headers.update(headers)
    resp = await http.post(
        "/mcp",
        headers=req_headers,
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": full_params},
    )
    if expected_status is not None:
        assert resp.status_code == expected_status, resp.text
    return resp.status_code, resp.json()


async def _legacy_http_session(http: httpx.AsyncClient) -> tuple[str, dict[str, Any]]:
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }
    init_resp = await http.post(
        "/mcp",
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": LEGACY,
                "capabilities": {},
                "clientInfo": {"name": "legacy-test", "version": "0"},
            },
        },
    )
    assert init_resp.status_code == 200, init_resp.text
    session_id = init_resp.headers["mcp-session-id"]
    sess_headers = {
        **headers,
        "Mcp-Session-Id": session_id,
        "MCP-Protocol-Version": LEGACY,
    }
    notif = await http.post(
        "/mcp",
        headers=sess_headers,
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
    )
    assert notif.status_code in (200, 202), notif.text
    return session_id, init_resp.json()["result"]


async def _legacy_http(
    http: httpx.AsyncClient,
    session_id: str,
    method: str,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"jsonrpc": "2.0", "id": 2, "method": method}
    if params is not None:
        body["params"] = params
    resp = await http.post(
        "/mcp",
        headers={
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
            "Mcp-Session-Id": session_id,
            "MCP-Protocol-Version": LEGACY,
        },
        json=body,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


@asynccontextmanager
async def _stream_session(server: Any):
    """Run the server's low-level MCP server over in-memory JSON-RPC streams (stdio wire)."""
    mcp_server = server._create_mcp_server()
    lowlevel = mcp_server._lowlevel_server
    c2s_send, c2s_recv = anyio.create_memory_object_stream[SessionMessage | Exception](32)
    s2c_send, s2c_recv = anyio.create_memory_object_stream[SessionMessage](32)

    async def send(
        method: str, params: dict[str, Any] | None = None, *, req_id: int = 1
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"jsonrpc": "2.0", "id": req_id, "method": method}
        if params is not None:
            payload["params"] = params
        msg = JSONRPCRequest.model_validate(payload)
        await c2s_send.send(SessionMessage(msg))
        reply = await s2c_recv.receive()
        return reply.message.model_dump(by_alias=True, exclude_none=True)

    async def notify(method: str, params: dict[str, Any] | None = None) -> None:
        payload: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        await c2s_send.send(SessionMessage(JSONRPCNotification.model_validate(payload)))

    async with anyio.create_task_group() as tg:
        tg.start_soon(
            lowlevel.run,
            c2s_recv,
            s2c_send,
            lowlevel.create_initialization_options(),
        )
        try:
            yield send, notify
        finally:
            await c2s_send.aclose()
            await s2c_recv.aclose()
            tg.cancel_scope.cancel()


# ── Spec vector tests (catalogFailures + full catalog over HTTP & stdio, both eras) ───


def test_spec_catalog_failure_vectors():
    vectors = _load_vectors()
    for case in vectors["catalogFailures"]:
        with pytest.raises(ValueError) as exc_info:
            _catalog_from_spec(case["skills"])
        assert case["entry"] in str(exc_info.value), (
            f"case {case['name']!r}: expected {case['entry']!r} in {str(exc_info.value)!r}"
        )


async def test_spec_catalog_vectors_modern_http():
    vectors = _load_vectors()
    cat_spec = vectors["catalog"]
    server = create_server("vec-modern", skills=_catalog_from_spec(cat_spec["skills"]))

    async with _http_client(server, stateless=True) as http:
        _, discover = await _modern_http(http, "server/discover")
        caps = discover["result"]["capabilities"]
        assert "resources" in caps
        assert caps["resources"].get("subscribe") is not True
        assert caps["resources"].get("listChanged") is not True
        assert "prompts" not in caps
        assert caps["extensions"]["io.modelcontextprotocol/skills"] == {}

        _, skills_list = await _modern_http(http, "skills/list", include_mcp_name=False)
        assert skills_list["result"]["skills"] == cat_spec["skillsList"]["skills"]
        assert skills_list["result"]["ttlMs"] == 300_000
        assert skills_list["result"]["cacheScope"] == "public"

        _, res_list = await _modern_http(http, "resources/list")
        assert res_list["result"]["resources"] == cat_spec["resourcesList"]["resources"]
        assert res_list["result"]["ttlMs"] == 300_000
        assert res_list["result"]["cacheScope"] == "public"

        for read_case in cat_spec["reads"]:
            _, res_read = await _modern_http(http, "resources/read", {"uri": read_case["uri"]})
            assert res_read["result"]["contents"] == read_case["contents"]
            assert res_read["result"]["ttlMs"] == 300_000
            assert res_read["result"]["cacheScope"] == "public"

        for get_case in cat_spec["skillsGet"]:
            _, got = await _modern_http(
                http, "skills/get", {"uri": get_case["uri"]}, include_mcp_name=False
            )
            assert got["result"]["skill"] == cat_spec["skillsList"]["skills"][get_case["skillsListIndex"]]
            assert got["result"]["ttlMs"] == 300_000
            assert got["result"]["cacheScope"] == "public"

        for err_case in cat_spec["errors"]:
            _, err_resp = await _modern_http(
                http,
                err_case["method"],
                {"uri": err_case["uri"]},
                expected_status=None,
            )
            assert err_resp["error"]["code"] == err_case["code"]
            if not err_case.get("dataOptional") or "data" in err_resp["error"]:
                assert err_resp["error"]["data"]["uri"] == err_case["uri"]


async def test_spec_catalog_vectors_legacy_http():
    vectors = _load_vectors()
    cat_spec = vectors["catalog"]
    server = create_server("vec-legacy", skills=_catalog_from_spec(cat_spec["skills"]))

    async with _http_client(server, stateless=False) as http:
        session_id, init_result = await _legacy_http_session(http)
        caps = init_result["capabilities"]
        assert "resources" in caps
        assert caps["resources"].get("subscribe") is not True
        assert caps["resources"].get("listChanged") is not True
        assert "prompts" not in caps
        assert caps["extensions"]["io.modelcontextprotocol/skills"] == {}

        # Omitted params (None) must succeed on legacy HTTP list calls.
        skills_list = await _legacy_http(http, session_id, "skills/list")
        assert skills_list["result"]["skills"] == cat_spec["skillsList"]["skills"]
        assert "ttlMs" not in skills_list["result"]

        res_list = await _legacy_http(http, session_id, "resources/list")
        assert res_list["result"]["resources"] == cat_spec["resourcesList"]["resources"]

        tmpl_list = await _legacy_http(http, session_id, "resources/templates/list")
        assert tmpl_list["result"]["resourceTemplates"] == []

        # Explicit null cursor must be refused with -32602 on legacy era too.
        for method in ("resources/list", "resources/templates/list", "skills/list"):
            null_cursor = await _legacy_http(http, session_id, method, {"cursor": None})
            assert null_cursor["error"]["code"] == -32602

        for read_case in cat_spec["reads"]:
            res_read = await _legacy_http(http, session_id, "resources/read", {"uri": read_case["uri"]})
            assert res_read["result"]["contents"] == read_case["contents"]

        for get_case in cat_spec["skillsGet"]:
            got = await _legacy_http(http, session_id, "skills/get", {"uri": get_case["uri"]})
            assert got["result"]["skill"] == cat_spec["skillsList"]["skills"][get_case["skillsListIndex"]]

        for err_case in cat_spec["errors"]:
            err_resp = await _legacy_http(http, session_id, err_case["method"], {"uri": err_case["uri"]})
            assert err_resp["error"]["code"] == err_case["code"]
            if not err_case.get("dataOptional"):
                assert err_resp["error"]["data"]["uri"] == err_case["uri"]


async def test_spec_catalog_vectors_stdio_both_eras():
    vectors = _load_vectors()
    cat_spec = vectors["catalog"]

    # Modern era over stdio streams (server/discover, no initialize).
    server_modern = create_server("vec-stdio-modern", skills=_catalog_from_spec(cat_spec["skills"]))
    async with _stream_session(server_modern) as (send, _notify):
        discover = await send("server/discover", {"_meta": _modern_meta()}, req_id=1)
        caps = discover["result"]["capabilities"]
        assert "resources" in caps and "prompts" not in caps
        assert caps["extensions"]["io.modelcontextprotocol/skills"] == {}

        sl = await send("skills/list", {"_meta": _modern_meta()}, req_id=2)
        assert sl["result"]["skills"] == cat_spec["skillsList"]["skills"]
        assert sl["result"]["ttlMs"] == 300_000
        assert sl["result"]["cacheScope"] == "public"

        rl = await send("resources/list", {"_meta": _modern_meta()}, req_id=3)
        assert rl["result"]["resources"] == cat_spec["resourcesList"]["resources"]
        assert rl["result"]["ttlMs"] == 300_000

        for idx, read_case in enumerate(cat_spec["reads"], start=10):
            rr = await send(
                "resources/read", {"uri": read_case["uri"], "_meta": _modern_meta()}, req_id=idx
            )
            assert rr["result"]["contents"] == read_case["contents"]
            assert rr["result"]["ttlMs"] == 300_000

        for idx, get_case in enumerate(cat_spec["skillsGet"], start=20):
            got = await send(
                "skills/get", {"uri": get_case["uri"], "_meta": _modern_meta()}, req_id=idx
            )
            assert got["result"]["skill"] == cat_spec["skillsList"]["skills"][get_case["skillsListIndex"]]
            assert got["result"]["ttlMs"] == 300_000

        for idx, err_case in enumerate(cat_spec["errors"], start=30):
            er = await send(
                err_case["method"], {"uri": err_case["uri"], "_meta": _modern_meta()}, req_id=idx
            )
            assert er["error"]["code"] == err_case["code"]
            if not err_case.get("dataOptional") or "data" in er["error"]:
                assert er["error"]["data"]["uri"] == err_case["uri"]

    # Legacy era over stdio streams (initialize + notifications/initialized).
    server_legacy = create_server("vec-stdio-legacy", skills=_catalog_from_spec(cat_spec["skills"]))
    async with _stream_session(server_legacy) as (send, notify):
        init = await send(
            "initialize",
            {
                "protocolVersion": LEGACY,
                "capabilities": {},
                "clientInfo": {"name": "stdio-legacy", "version": "0"},
            },
            req_id=1,
        )
        caps = init["result"]["capabilities"]
        assert "resources" in caps and "prompts" not in caps
        assert caps["extensions"]["io.modelcontextprotocol/skills"] == {}
        await notify("notifications/initialized")

        # Omitted params work on legacy stdio.
        sl = await send("skills/list", req_id=2)
        assert sl["result"]["skills"] == cat_spec["skillsList"]["skills"]

        rl = await send("resources/list", req_id=3)
        assert rl["result"]["resources"] == cat_spec["resourcesList"]["resources"]

        for idx, read_case in enumerate(cat_spec["reads"], start=10):
            rr = await send("resources/read", {"uri": read_case["uri"]}, req_id=idx)
            assert rr["result"]["contents"] == read_case["contents"]

        for idx, get_case in enumerate(cat_spec["skillsGet"], start=20):
            got = await send("skills/get", {"uri": get_case["uri"]}, req_id=idx)
            assert got["result"]["skill"] == cat_spec["skillsList"]["skills"][get_case["skillsListIndex"]]

        for idx, err_case in enumerate(cat_spec["errors"], start=30):
            er = await send(err_case["method"], {"uri": err_case["uri"]}, req_id=idx)
            assert er["error"]["code"] == err_case["code"]
            if not err_case.get("dataOptional") or "data" in er["error"]:
                assert er["error"]["data"]["uri"] == err_case["uri"]


# ── R1: default server omits resources & prompts on both eras ─────────────────────────


async def test_default_server_omits_resources_and_prompts_capabilities():
    server = create_server("plain-server")

    @server.command(name="demo-ping", description="Ping")
    async def ping(_input: Any) -> Any:
        return success({"pong": True})

    async with _http_client(server, stateless=True) as http:
        _, disc = await _modern_http(http, "server/discover")
        caps = disc["result"]["capabilities"]
        assert "resources" not in caps
        assert "prompts" not in caps
        assert "extensions" not in caps or "io.modelcontextprotocol/skills" not in (
            caps.get("extensions") or {}
        )
        # skills/list and skills/get return -32601 when no catalog is attached.
        _, sl = await _modern_http(http, "skills/list", expected_status=None)
        assert sl["error"]["code"] == -32601
        _, sg = await _modern_http(
            http, "skills/get", {"uri": "skill://x/SKILL.md"}, expected_status=None
        )
        assert sg["error"]["code"] == -32601

    async with _http_client(server, stateless=False) as http:
        _, init_res = await _legacy_http_session(http)
        caps = init_res["capabilities"]
        assert "resources" not in caps
        assert "prompts" not in caps


# ── R2–R6: provider entries, order, ui://, templates, subscribe, Mcp-Name, contexts ──


def test_r2_entry_validation_failures():
    with pytest.raises(ValueError, match="relative/path"):
        create_server("bad", resources=[ResourceEntry(uri="relative/path", name="bad")])
    with pytest.raises(ValueError, match="app://dup"):
        create_server(
            "bad",
            resources=[
                ResourceEntry(uri="app://dup", name="a"),
                ResourceEntry(uri="app://dup", name="b"),
            ],
        )
    with pytest.raises(ValueError, match="app://empty"):
        create_server("bad", resources=[ResourceEntry(uri="app://empty", name="")])
    with pytest.raises(ValueError, match="skill://"):
        create_server("bad", resources=[ResourceEntry(uri="skill://foo/SKILL.md", name="s")])
    with pytest.raises(ValueError, match="ui://"):
        create_server(
            "bad",
            resources=[ResourceEntry(uri="ui://view/app.html", name="view", mime_type="text/html")],
        )
    with pytest.raises(ValueError, match="ui"):
        create_server(
            "bad",
            resources=[
                ResourceEntry(
                    uri="app://x",
                    name="x",
                    meta={"ui": {"resourceUri": "ui://view/app.html"}},
                )
            ],
        )
    with pytest.raises(ValueError, match="size"):
        create_server(
            "bad",
            resources=[ResourceEntry(uri="app://x", name="x", size=99, content="hello")],
        )
    with pytest.raises(ValueError, match="app://%ZZ"):
        create_server("bad", resources=[ResourceEntry(uri="app://%ZZ", name="bad-pct")])
    with pytest.raises(ValueError, match="invalid MCP resource fields"):
        create_server("bad", resources=[ResourceEntry(uri="app://x", name="x", icons=[{}])])
    with pytest.raises(ValueError, match="invalid MCP resource fields"):
        create_server(
            "bad",
            resources=[ResourceEntry(uri="app://x", name="x", annotations={"priority": 2})],
        )


async def test_provider_and_skills_order_ui_meta_templates_cursors_and_contexts():
    class _DynamicProvider:
        def __init__(self) -> None:
            self.break_list = False
            self.bad_size = False

        def list(self) -> Sequence[ResourceEntry]:
            if self.break_list:
                return [ResourceEntry(uri="not-a-uri", name="broken")]
            return [
                ResourceEntry(
                    uri="ui://hello/view.html",
                    name="hello-view",
                    title="Hello View",
                    mime_type=MCP_APP_MIME_TYPE,
                    size=11,
                    meta={"com.example/tag": "v1"},
                ),
                ResourceEntry(
                    uri="app://inline/doc",
                    name="inline-doc",
                    mime_type="text/plain",
                    content="hello world",
                ),
            ]

        async def read(self, uri: str) -> ResourceContents | None:
            if uri == "ui://hello/view.html":
                body = "<h1>hi!</h1>" if self.bad_size else "<h1>hi</h1>"
                return ResourceContents(
                    content=body,
                    mime_type=MCP_APP_MIME_TYPE,
                    meta={"ui": {"prefersBorder": True, "csp": {"connectDomains": []}}},
                )
            return None

    provider = _DynamicProvider()
    catalog = SkillCatalog(
        [
            Skill(
                path="hello",
                files={
                    "SKILL.md": "---\nname: hello\ndescription: Greets.\n---\nHi.\n",
                    "refs/note.md": "Note\n",
                },
            )
        ],
        directory_read=True,
    )
    hook_calls = 0

    def _hook(_req: Any, ctx: Any) -> Any:
        nonlocal hook_calls
        hook_calls += 1
        return ctx

    server = create_server(
        "full-resources",
        resources=provider,
        skills=catalog,
        contexts=[{"name": "alpha"}],
        context_hook=_hook,
        tools_list_ttl_ms=12_345,
    )

    async with _http_client(server, stateless=True) as http:
        _, disc = await _modern_http(http, "server/discover")
        assert disc["result"]["capabilities"]["extensions"]["io.modelcontextprotocol/skills"] == {
            "directoryRead": True
        }

        # Provider entries come first, then skill files; dev.afd/context does not vary list or lower ttlMs.
        _, rl1 = await _modern_http(http, "resources/list")
        _, rl2 = await _modern_http(
            http, "resources/list", {"_meta": {"dev.afd/context": "alpha"}}
        )
        assert rl1["result"]["resources"] == rl2["result"]["resources"]
        assert rl1["result"]["ttlMs"] == 12_345
        assert rl2["result"]["ttlMs"] == 12_345
        assert [r["uri"] for r in rl1["result"]["resources"]] == [
            "ui://hello/view.html",
            "app://inline/doc",
            "skill://hello/SKILL.md",
            "skill://hello/refs/note.md",
        ]
        inline_entry = rl1["result"]["resources"][1]
        assert inline_entry["size"] == 11
        assert inline_entry["_meta"]["dev.afd/digest"] == sha256_digest(b"hello world")

        # ui:// read carries _meta.ui.
        _, ui_read = await _modern_http(http, "resources/read", {"uri": "ui://hello/view.html"})
        assert ui_read["result"]["contents"] == [
            {
                "uri": "ui://hello/view.html",
                "mimeType": MCP_APP_MIME_TYPE,
                "text": "<h1>hi</h1>",
                "_meta": {"ui": {"prefersBorder": True, "csp": {"connectDomains": []}}},
            }
        ]

        # Upfront content read works without provider.read.
        _, inline_read = await _modern_http(http, "resources/read", {"uri": "app://inline/doc"})
        assert inline_read["result"]["contents"][0]["text"] == "hello world"

        # Directory read returns direct children with cache hints and needs no Mcp-Name.
        _, dir_res = await _modern_http(
            http, "resources/directory/read", {"uri": "skill://hello"}, include_mcp_name=False
        )
        assert [c["uri"] for c in dir_res["result"]["resources"]] == [
            "skill://hello/SKILL.md",
            "skill://hello/refs",
        ]
        assert dir_res["result"]["resources"][0]["name"] == "hello"
        assert dir_res["result"]["ttlMs"] == 12_345
        assert dir_res["result"]["cacheScope"] == "public"

        # Unknown directory -> -32602.
        _, bad_dir = await _modern_http(
            http,
            "resources/directory/read",
            {"uri": "skill://hello/nope"},
            include_mcp_name=False,
            expected_status=None,
        )
        assert bad_dir["error"]["code"] == -32602

        # Templates list is empty with hints; cursor is refused with -32602.
        _, tmpl = await _modern_http(http, "resources/templates/list")
        assert tmpl["result"]["resourceTemplates"] == []
        assert tmpl["result"]["ttlMs"] == 12_345
        assert tmpl["result"]["cacheScope"] == "public"

        for method in ("resources/list", "resources/templates/list", "skills/list"):
            _, bad_cursor = await _modern_http(
                http, method, {"cursor": "abc"}, expected_status=None
            )
            assert bad_cursor["error"]["code"] == -32602
            _, null_cursor = await _modern_http(
                http, method, {"cursor": None}, expected_status=None
            )
            assert null_cursor["error"]["code"] == -32602

        # resources/subscribe -> -32601.
        _, sub = await _modern_http(
            http, "resources/subscribe", {"uri": "app://inline/doc"}, expected_status=None
        )
        assert sub["error"]["code"] == -32601

        # Missing Mcp-Name on modern HTTP resources/read -> HTTP 400 -32020.
        status, missing_hdr = await _modern_http(
            http,
            "resources/read",
            {"uri": "app://inline/doc"},
            include_mcp_name=False,
            expected_status=400,
        )
        assert status == 400
        assert missing_hdr["error"]["code"] == -32020

        # Mismatched Mcp-Name -> HTTP 400 -32020.
        status, bad_hdr = await _modern_http(
            http,
            "resources/read",
            {"uri": "app://inline/doc"},
            headers={"Mcp-Name": "app://other"},
            expected_status=400,
        )
        assert status == 400
        assert bad_hdr["error"]["code"] == -32020

        # Provider list breaking R2 at runtime -> -32603.
        provider.break_list = True
        _, broken = await _modern_http(http, "resources/list", expected_status=None)
        assert broken["error"]["code"] == -32603
        provider.break_list = False

        # Provider read returning wrong byte length for declared size -> -32603.
        provider.bad_size = True
        _, wrong_len = await _modern_http(
            http, "resources/read", {"uri": "ui://hello/view.html"}, expected_status=None
        )
        assert wrong_len["error"]["code"] == -32603
        provider.bad_size = False

        # context_hook never ran for any resource or skill request (R4).
        assert hook_calls == 0


async def test_directory_read_off_returns_method_not_found():
    catalog = SkillCatalog(
        [Skill(path="hello", files={"SKILL.md": "---\nname: hello\ndescription: Hi.\n---\n"})],
        directory_read=False,
    )
    server = create_server("no-dir", skills=catalog)
    async with _http_client(server, stateless=True) as http:
        _, resp = await _modern_http(
            http, "resources/directory/read", {"uri": "skill://hello"}, expected_status=None
        )
        assert resp["error"]["code"] == -32601


async def test_contexts_do_not_lower_resources_ttl_to_zero():
    server = create_server(
        "ctx-ttl",
        contexts=[{"name": "alpha"}],
        resources=[ResourceEntry(uri="app://doc", name="doc", content="hi")],
    )
    async with _http_client(server, stateless=True) as http:
        # tools/list ttlMs drops to 0 because grouped strategy varies by context...
        _, tl = await _modern_http(http, "tools/list")
        assert tl["result"]["ttlMs"] == 0
        # ...but resources/list keeps the default 300,000 (R3).
        _, rl = await _modern_http(http, "resources/list")
        assert rl["result"]["ttlMs"] == 300_000
        assert rl["result"]["cacheScope"] == "public"


async def test_provider_unlisted_binary_mapping_proxy_and_bad_content_type():
    from types import MappingProxyType

    class _Provider:
        def list(self) -> Sequence[ResourceEntry]:
            return [
                ResourceEntry(
                    uri="app://frozen",
                    name="frozen",
                    mime_type="text/plain",
                    meta=MappingProxyType({"com.example/k": "v"}),
                    content="ok",
                )
            ]

        def read(self, uri: str) -> ResourceContents | None:
            if uri == "app://unlisted/bin":
                return ResourceContents(
                    content=b"\xff\x00\xfe",
                    mime_type="application/octet-stream",
                    meta=MappingProxyType({"com.example/r": 1}),
                )
            if uri == "app://bad-type":
                return ResourceContents(content=1000)  # type: ignore[arg-type]
            return None

    server = create_server("edge-provider", resources=_Provider())
    async with _http_client(server, stateless=True) as http:
        _, rl = await _modern_http(http, "resources/list")
        assert rl["result"]["resources"][0]["_meta"]["com.example/k"] == "v"

        _, rr = await _modern_http(http, "resources/read", {"uri": "app://unlisted/bin"})
        assert rr["result"]["contents"] == [
            {
                "uri": "app://unlisted/bin",
                "mimeType": "application/octet-stream",
                "blob": "/wD+",
                "_meta": {"com.example/r": 1},
            }
        ]

        _, bad = await _modern_http(
            http, "resources/read", {"uri": "app://bad-type"}, expected_status=None
        )
        assert bad["error"]["code"] == -32603


async def test_auth_fails_closed_and_admits_verified_tokens_on_resources_and_skills():
    import time

    from afd.server import Credentials, TokenVerified

    refusals: list[str] = []
    now = int(time.time())

    class _Verifier:
        async def verify(self, token: str, _request: Any) -> Any:
            if token == "good-token":
                return TokenVerified(
                    credentials=Credentials(
                        issuer="https://auth.example.com",
                        subject="user-1",
                        client_id="client-1",
                        scopes=("read",),
                        resource="https://api.example.com/mcp",
                        issued_at=now - 60,
                        expires_at=now + 600,
                    )
                )
            return TokenRefused(rule="inactive")

    server = create_server(
        "authed-res",
        auth=McpAuthOptions(
            resource="https://api.example.com/mcp",
            authorization_servers=["https://auth.example.com"],
            verifier=_Verifier(),
            on_refusal=lambda r: refusals.append(r.rule),
        ),
        skills=SkillCatalog(
            [Skill(path="hello", files={"SKILL.md": "---\nname: hello\ndescription: Hi.\n---\n"})]
        ),
    )
    async with _http_client(server, stateless=True) as http:
        # Missing token -> 401.
        for method in ("resources/list", "skills/list"):
            status, _ = await _modern_http(http, method, expected_status=401)
            assert status == 401

        # Invalid token invokes verifier and fires on_refusal -> 401.
        status, _ = await _modern_http(
            http,
            "resources/list",
            headers={"Authorization": "Bearer bad-token"},
            expected_status=401,
        )
        assert status == 401
        assert "inactive" in refusals

        # Valid token succeeds across resources/* and skills/*.
        auth_hdr = {"Authorization": "Bearer good-token"}
        _, rl = await _modern_http(http, "resources/list", headers=auth_hdr)
        assert len(rl["result"]["resources"]) == 1
        _, sl = await _modern_http(http, "skills/list", headers=auth_hdr)
        assert len(sl["result"]["skills"]) == 1
        _, rr = await _modern_http(
            http, "resources/read", {"uri": "skill://hello/SKILL.md"}, headers=auth_hdr
        )
        assert "name: hello" in rr["result"]["contents"][0]["text"]
        _, sg = await _modern_http(
            http, "skills/get", {"uri": "skill://hello/SKILL.md"}, headers=auth_hdr
        )
        assert sg["result"]["skill"]["uri"] == "skill://hello/SKILL.md"

    # Unadmitted non-HTTP dispatch without trusted_transport() fails closed with UNAUTHORIZED (M1).
    async with _stream_session(server) as (send, _):
        for method, params in (
            ("resources/list", {"_meta": _modern_meta()}),
            ("skills/list", {"_meta": _modern_meta()}),
        ):
            resp = await send(method, params, req_id=1)
            assert resp["error"]["code"] == -32600
            assert resp["error"]["data"]["code"] == "UNAUTHORIZED"
