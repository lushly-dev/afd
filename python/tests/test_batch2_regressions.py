"""Regression tests for Batch 2 Python AFD P0/P1 fixes (#1709-#1715)."""

from __future__ import annotations

import json
import os
import sys
from unittest.mock import patch

import httpx
import pytest
from click.testing import CliRunner

from afd.cli.main import cli as afd_cli
from afd.connectors.package_manager import PackageManagerConnector
from afd.core import CommandDefinition, success
from afd.platform import create_exec_result
from afd.server.lazy_tools import execute_discover
from afd.testing.assertions import assert_has_sources
from afd.testing.cli_wrapper import CliConfig, CliWrapper
from afd.testing.commands.coverage import scenario_coverage_cmd
from afd.testing.commands.evaluate import scenario_evaluate
from afd.testing.commands.list import scenario_list
from afd.testing.commands.suggest import scenario_suggest
from afd.testing.mcp.server import JSON_RPC_ERRORS, McpTestingServer, create_mcp_testing_server
from afd.transports.base import TransportError
from afd.transports.http import HttpTransport

SCENARIO_YAML = """\
name: sample-scenario
description: Sample scenario
job: sample-job
tags: [smoke, flaky]
steps:
  - command: sample-cmd
    expect:
      success: true
"""


# ---------------------------------------------------------------------------
# #1709: Root-sandbox confinement in McpTestingServer and scenario commands
# ---------------------------------------------------------------------------


class TestScenarioRootSandbox:
    """#1709: scenario commands stay confined to root even when cwd != os.getcwd()."""

    async def _handler(self, command, input):
        return success({"ok": True})

    @pytest.mark.asyncio
    async def test_evaluate_uses_resolved_path_when_root_differs_from_getcwd(
        self, tmp_path, monkeypatch
    ):
        host_dir = tmp_path / "host"
        sandbox_dir = tmp_path / "sandbox"
        host_dir.mkdir()
        sandbox_dir.mkdir()
        # File exists ONLY in host_dir (os.getcwd()), NOT in sandbox_dir (root)
        (host_dir / "outside.scenario.yaml").write_text(SCENARIO_YAML, encoding="utf-8")
        # Valid file exists ONLY in sandbox_dir (root)
        (sandbox_dir / "inside.scenario.yaml").write_text(SCENARIO_YAML, encoding="utf-8")
        monkeypatch.chdir(host_dir)

        # Requesting "outside.scenario.yaml" must NOT read host_dir/outside.scenario.yaml
        outside_res = await scenario_evaluate(
            {"handler": self._handler, "scenarios": ["outside.scenario.yaml"]},
            root=sandbox_dir,
        )
        assert outside_res.success is False
        assert outside_res.error.code == "NOT_FOUND"

        # Requesting "inside.scenario.yaml" must resolve against root=sandbox_dir and succeed
        inside_res = await scenario_evaluate(
            {"handler": self._handler, "scenarios": ["inside.scenario.yaml"]},
            root=sandbox_dir,
        )
        assert inside_res.success is True
        assert inside_res.data["report"]["summary"]["passed_scenarios"] == 1

    def test_scenario_list_confines_directory_to_root(self, tmp_path, monkeypatch):
        outside = tmp_path / "outside"
        sandbox = tmp_path / "sandbox"
        outside.mkdir()
        sandbox.mkdir()
        (outside / "secret.scenario.yaml").write_text(SCENARIO_YAML, encoding="utf-8")
        (sandbox / "ok.scenario.yaml").write_text(SCENARIO_YAML, encoding="utf-8")
        monkeypatch.chdir(outside)

        escaped_abs = scenario_list({"directory": str(outside)}, root=sandbox)
        assert escaped_abs.success is False
        assert escaped_abs.error.code == "VALIDATION_ERROR"
        assert escaped_abs.error.details == {"field": "directory"}

        escaped_rel = scenario_list({"directory": "../outside"}, root=sandbox)
        assert escaped_rel.success is False
        assert escaped_rel.error.code == "VALIDATION_ERROR"

        inside = scenario_list({"directory": "."}, root=sandbox)
        assert inside.success is True
        assert inside.data["total"] == 1

    def test_scenario_coverage_confines_directory_to_root(self, tmp_path, monkeypatch):
        outside = tmp_path / "outside"
        sandbox = tmp_path / "sandbox"
        outside.mkdir()
        sandbox.mkdir()
        (outside / "secret.scenario.yaml").write_text(SCENARIO_YAML, encoding="utf-8")
        monkeypatch.chdir(outside)

        escaped = scenario_coverage_cmd(
            {"directory": str(outside), "known_commands": ["sample-cmd"]},
            root=sandbox,
        )
        assert escaped.success is False
        assert escaped.error.code == "VALIDATION_ERROR"
        assert escaped.error.details == {"field": "directory"}

    def test_scenario_suggest_confines_directory_to_root(self, tmp_path, monkeypatch):
        outside = tmp_path / "outside"
        sandbox = tmp_path / "sandbox"
        outside.mkdir()
        sandbox.mkdir()
        (outside / "secret.scenario.yaml").write_text(SCENARIO_YAML, encoding="utf-8")
        monkeypatch.chdir(outside)

        for ctx in ("uncovered", "failed"):
            escaped = scenario_suggest(
                {"context": ctx, "directory": "../outside", "known_commands": ["sample-cmd"]},
                root=sandbox,
            )
            assert escaped.success is False
            assert escaped.error.code == "VALIDATION_ERROR"
            assert escaped.error.details == {"field": "directory"}

    @pytest.mark.asyncio
    async def test_mcp_testing_server_passes_cwd_to_all_five_tools(self, tmp_path, monkeypatch):
        host_dir = tmp_path / "host"
        sandbox = tmp_path / "sandbox"
        host_dir.mkdir()
        sandbox.mkdir()
        (host_dir / "leak.scenario.yaml").write_text(SCENARIO_YAML, encoding="utf-8")
        monkeypatch.chdir(host_dir)

        server = create_mcp_testing_server(command_handler=self._handler, cwd=str(sandbox))

        calls = [
            ("scenario-list", {"directory": str(host_dir)}),
            ("scenario-coverage", {"directory": str(host_dir), "knownCommands": ["sample-cmd"]}),
            ("scenario-suggest", {"context": "failed", "directory": str(host_dir)}),
            ("scenario-create", {"name": "x", "job": "j", "directory": str(host_dir)}),
            ("scenario-evaluate", {"directory": str(host_dir)}),
        ]
        for tool_name, arguments in calls:
            result = await server.execute_tool(tool_name, arguments)
            assert result["success"] is False, f"{tool_name} escaped sandbox"
            assert result["error"]["code"] == "VALIDATION_ERROR", f"{tool_name} wrong error code"

        # Also verify relative leak in scenario-evaluate does not read host_dir/leak.scenario.yaml
        eval_rel = await server.execute_tool(
            "scenario-evaluate", {"scenarios": ["leak.scenario.yaml"]}
        )
        assert eval_rel["success"] is False
        assert eval_rel["error"]["code"] == "NOT_FOUND"

    @pytest.mark.skipif(sys.platform == "win32", reason="symlinks need privileges on Windows")
    def test_scenario_list_skips_symlink_escaping_root(self, tmp_path):
        outside = tmp_path / "outside"
        sandbox = tmp_path / "sandbox"
        outside.mkdir()
        sandbox.mkdir()
        secret = outside / "secret.scenario.yaml"
        secret.write_text(SCENARIO_YAML, encoding="utf-8")
        os.symlink(secret, sandbox / "linked.scenario.yaml")

        result = scenario_list({"directory": "."}, root=sandbox)
        assert result.success is True
        assert result.data["total"] == 0

    @pytest.mark.asyncio
    async def test_pathlike_directory_and_nul_byte_handling(self, tmp_path):
        sandbox = tmp_path / "sandbox"
        sub = sandbox / "nested"
        sub.mkdir(parents=True)
        (sub / "ok.scenario.yaml").write_text(SCENARIO_YAML, encoding="utf-8")

        # pathlib.Path directories inside root are accepted by all four commands
        assert scenario_list({"directory": sub}, root=sandbox).success is True
        assert (
            scenario_coverage_cmd(
                {"directory": sub, "known_commands": ["sample-cmd"]}, root=sandbox
            ).success
            is True
        )
        assert (
            scenario_suggest({"context": "failed", "directory": sub}, root=sandbox).success is True
        )
        assert (
            await scenario_evaluate({"handler": self._handler, "directory": sub}, root=sandbox)
        ).success is True

        # Embedded NUL byte returns VALIDATION_ERROR cleanly instead of raising ValueError
        nul_res = scenario_list({"directory": "bad\x00dir"}, root=sandbox)
        assert nul_res.success is False
        assert nul_res.error.code == "VALIDATION_ERROR"
        assert nul_res.error.details == {"field": "directory"}


# ---------------------------------------------------------------------------
# #1710: CliWrapper._build_args matches Python afd CLI
# ---------------------------------------------------------------------------


class TestCliWrapperArgs:
    """#1710: CliWrapper._build_args emits flags accepted by afd.cli.main.cli."""

    def test_build_args_format(self):
        wrapper = CliWrapper(CliConfig(server_url="http://localhost:3000/mcp"))
        args = wrapper._build_args("todo-create", {"title": "Buy milk"})
        assert args == [
            "--json",
            "call",
            "todo-create",
            '{"title": "Buy milk"}',
            "--server",
            "http://localhost:3000/mcp",
        ]

    def test_build_args_accepted_by_click_cli(self):
        from afd.transports.mock import MockTransport

        wrapper = CliWrapper(CliConfig(server_url="mock"))
        args = wrapper._build_args("todo-create", {"title": "Buy milk"})

        transport = MockTransport()
        captured: list[tuple[str, dict]] = []

        async def handler(tool_args):
            captured.append(("todo-create", tool_args))
            return {"success": True, "data": {"id": "1", "title": tool_args["title"]}}

        transport.register_tool("todo-create", handler)

        import importlib

        main_mod = importlib.import_module("afd.cli.main")
        runner = CliRunner()
        with patch.object(main_mod, "_get_transport", return_value=transport) as mock_get:
            result = runner.invoke(afd_cli, args)

        assert result.exit_code == 0, result.output
        mock_get.assert_called_once()
        assert mock_get.call_args.args == ("mock",)
        assert captured == [("todo-create", {"title": "Buy milk"})]
        ok, parsed = wrapper._parse_output(result.output, "", result.exit_code)
        assert ok is True
        assert parsed["data"] == {"id": "1", "title": "Buy milk"}


# ---------------------------------------------------------------------------
# #1711: McpTestingServer.handle_request handles non-object JSON-RPC messages
# ---------------------------------------------------------------------------


class TestMcpTestingServerInvalidRequests:
    """#1711: handle_request returns -32600 instead of crashing on invalid JSON-RPC values."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("payload", [[], None, 123, "ping", True])
    async def test_non_object_request_returns_invalid_request(self, payload):
        server = McpTestingServer()
        response = await server.handle_request(payload)  # type: ignore[arg-type]
        assert response["jsonrpc"] == "2.0"
        assert response["id"] is None
        assert response["error"]["code"] == JSON_RPC_ERRORS["INVALID_REQUEST"]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("method", [None, 123, [], {}])
    async def test_missing_or_non_string_method_returns_invalid_request(self, method):
        server = McpTestingServer()
        req = {"jsonrpc": "2.0", "id": 7}
        if method is not None:
            req["method"] = method
        response = await server.handle_request(req)
        assert response["jsonrpc"] == "2.0"
        assert response["id"] == 7
        assert response["error"]["code"] == JSON_RPC_ERRORS["INVALID_REQUEST"]


# ---------------------------------------------------------------------------
# #1712: _HttpBasedTransport._send_request handles error: null and bad 200 bodies
# ---------------------------------------------------------------------------


class TestHttpTransportResponseHandling:
    """#1712: _send_request tolerates error: null and wraps bad 200 bodies in TransportError."""

    def _connected_transport(self, response: httpx.Response, monkeypatch) -> HttpTransport:
        transport = HttpTransport("http://localhost:3100/message")
        transport._client = httpx.AsyncClient()

        async def mock_post(self_client, url, *, json=None, headers=None, timeout=None):
            return response

        monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)
        return transport

    @pytest.mark.asyncio
    async def test_error_null_returns_result(self, monkeypatch):
        resp = httpx.Response(
            200, json={"jsonrpc": "2.0", "id": 1, "result": {"ok": True}, "error": None}
        )
        t = self._connected_transport(resp, monkeypatch)
        result = await t._send_request("ping")
        assert result == {"ok": True}

    @pytest.mark.asyncio
    @pytest.mark.parametrize("err_val", ["boom", 42, ["bad"], ""])
    async def test_non_dict_error_raises_transport_error(self, monkeypatch, err_val):
        resp = httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "error": err_val})
        t = self._connected_transport(resp, monkeypatch)
        with pytest.raises(TransportError, match="JSON-RPC error"):
            await t._send_request("ping")

    @pytest.mark.asyncio
    async def test_non_json_200_body_raises_transport_error(self, monkeypatch):
        resp = httpx.Response(
            200, content=b"<html>proxy error</html>", headers={"content-type": "text/html"}
        )
        t = self._connected_transport(resp, monkeypatch)
        with pytest.raises(TransportError, match="Invalid JSON"):
            await t._send_request("ping")

    @pytest.mark.asyncio
    @pytest.mark.parametrize("body", [b"null", b"[]", b"123", b'"hello"'])
    async def test_non_object_json_200_body_raises_transport_error(self, monkeypatch, body):
        resp = httpx.Response(200, content=body, headers={"content-type": "application/json"})
        t = self._connected_transport(resp, monkeypatch)
        with pytest.raises(TransportError, match="expected JSON object"):
            await t._send_request("ping")

    @pytest.mark.asyncio
    @pytest.mark.parametrize("bad_result", ["ok", [], None, 123])
    async def test_malformed_initialize_result_raises_transport_error(
        self, monkeypatch, bad_result
    ):
        resp = httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": bad_result})
        t = self._connected_transport(resp, monkeypatch)
        with pytest.raises(TransportError, match="Invalid initialize result"):
            await t._initialize()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "bad_result",
        ["bad", [], None, {"tools": "not-a-list"}, {"tools": [123]}, {"tools": [{}]}],
    )
    async def test_malformed_list_tools_result_raises_transport_error(
        self, monkeypatch, bad_result
    ):
        resp = httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": bad_result})
        t = self._connected_transport(resp, monkeypatch)
        with pytest.raises(TransportError, match="Invalid tools/list result"):
            await t.list_tools()

    @pytest.mark.asyncio
    async def test_empty_tools_list_returns_empty_list(self, monkeypatch):
        resp = httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {"tools": []}})
        t = self._connected_transport(resp, monkeypatch)
        assert await t.list_tools() == []


# ---------------------------------------------------------------------------
# #1713: assert_has_sources works on dict-based results
# ---------------------------------------------------------------------------


class TestAssertHasSourcesDictResults:
    """#1713: assert_has_sources validates dict entries and preserves all Source fields."""

    def test_full_wire_dict_source(self):
        result = {
            "success": True,
            "data": {"answer": 42},
            "sources": [
                {
                    "type": "document",
                    "id": "doc-1",
                    "title": "Design Spec",
                    "url": "https://example.com/spec",
                    "location": "Section 4.2",
                    "accessedAt": "2026-01-01T00:00:00Z",
                    "relevance": 0.9,
                }
            ],
        }
        sources = assert_has_sources(result)
        assert len(sources) == 1
        s = sources[0]
        assert s.type == "document"
        assert s.id == "doc-1"
        assert s.title == "Design Spec"
        assert s.url == "https://example.com/spec"
        assert s.location == "Section 4.2"
        assert s.accessed_at == "2026-01-01T00:00:00Z"
        assert s.relevance == 0.9

    def test_minimal_dict_source_defaults_type(self):
        result = {
            "success": True,
            "data": {},
            "sources": [{"title": "Minimal Doc", "url": "https://example.com"}],
        }
        sources = assert_has_sources(result)
        assert len(sources) == 1
        assert sources[0].type == "unknown"
        assert sources[0].title == "Minimal Doc"
        assert sources[0].url == "https://example.com"

    def test_explicit_null_type_raises_validation_error(self):
        from pydantic import ValidationError

        result = {
            "success": True,
            "data": {},
            "sources": [{"type": None, "title": "Bad Source"}],
        }
        with pytest.raises(ValidationError):
            assert_has_sources(result)


# ---------------------------------------------------------------------------
# #1714: execute_discover validates input, limit, and offset
# ---------------------------------------------------------------------------


class TestExecuteDiscoverValidation:
    """#1714: execute_discover rejects malformed inputs cleanly and does not turn limit=0 into 50."""

    def _commands(self, count: int = 5) -> list[CommandDefinition]:
        async def noop(inp):
            return success({})

        return [
            CommandDefinition(name=f"item-cmd{i}", description=f"Cmd {i}", handler=noop)
            for i in range(count)
        ]

    @pytest.mark.parametrize("bad_input", [["not-a-dict"], "string", 123])
    def test_non_dict_input_returns_validation_error(self, bad_input):
        res = execute_discover(self._commands(), bad_input)  # type: ignore[arg-type]
        assert res.success is False
        assert res.error.code == "VALIDATION_ERROR"
        assert res.error.suggestion

    @pytest.mark.parametrize(
        "bad_val",
        [None, "abc", [1], {"a": 1}, True, False, float("inf"), float("-inf"), float("nan"), 1.5],
    )
    def test_malformed_limit_and_offset_return_validation_error(self, bad_val):
        for field in ("limit", "offset"):
            res = execute_discover(self._commands(), {field: bad_val})
            assert res.success is False, f"{field}={bad_val!r} should fail"
            assert res.error.code == "VALIDATION_ERROR"
            assert res.error.suggestion

    @pytest.mark.parametrize(
        "field",
        ["category", "tag", "tagMode", "tag_mode", "search", "includeMutation", "include_mutation"],
    )
    def test_explicit_null_filters_return_validation_error(self, field):
        res = execute_discover(self._commands(), {field: None})
        assert res.success is False, f"{field}=None should fail"
        assert res.error.code == "VALIDATION_ERROR"
        assert res.error.suggestion

    def test_limit_zero_does_not_fall_back_to_50(self):
        res = execute_discover(self._commands(5), {"limit": 0})
        assert res.success is True
        # Clamped to 1 (matching TS Math.min(Math.max(limit, 1), 200)), never 50
        assert res.data["returned"] == 1
        assert len(res.data["commands"]) == 1


# ---------------------------------------------------------------------------
# #1715: PackageManagerConnector.list_deps() handles pnpm JSON array output
# ---------------------------------------------------------------------------


class TestPackageManagerPnpmListDeps:
    """#1715: list_deps() handles pnpm JSON array output (single and multi-project)."""

    @pytest.mark.asyncio
    async def test_pnpm_single_project_array(self):
        pm = PackageManagerConnector("pnpm")
        pnpm_json = json.dumps(
            [
                {
                    "name": "my-app",
                    "version": "1.0.0",
                    "dependencies": {
                        "lodash": {"from": "lodash", "version": "4.17.21"},
                        "zod": {"from": "zod", "version": "3.23.0"},
                    },
                }
            ]
        )

        async def mock_exec(cmd, opts=None):
            return create_exec_result(pnpm_json, "", 0, 5.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=mock_exec):
            deps = await pm.list_deps()
        assert {(d.name, d.version) for d in deps} == {
            ("lodash", "4.17.21"),
            ("zod", "3.23.0"),
        }

    @pytest.mark.asyncio
    async def test_pnpm_multi_project_array_and_empty_entry(self):
        pm = PackageManagerConnector("pnpm")
        pnpm_json = json.dumps(
            [
                {
                    "name": "pkg-a",
                    "dependencies": {"a": {"version": "1.0.0"}, "shared": {"version": "2.0.0"}},
                },
                {"name": "pkg-empty"},
                {
                    "name": "pkg-b",
                    "dependencies": {"b": {"version": "3.0.0"}, "shared": {"version": "2.0.0"}},
                },
            ]
        )

        async def mock_exec(cmd, opts=None):
            return create_exec_result(pnpm_json, "", 0, 5.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=mock_exec):
            deps = await pm.list_deps()
        assert [(d.name, d.version) for d in deps] == [
            ("a", "1.0.0"),
            ("shared", "2.0.0"),
            ("b", "3.0.0"),
        ]
