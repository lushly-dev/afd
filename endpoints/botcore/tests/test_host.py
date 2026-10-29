"""Behavior fixtures for the isolated host boundary, on registry AFD 0.9.0."""

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from afd import success
from click.testing import CliRunner

from botcore import (
    CommandHost,
    CommandPolicy,
    ExecutionContext,
    QualityVerdict,
    aggregate_quality,
    build_host,
    create_host_cli,
    create_host_mcp_server,
)
from botcore.context import current_context
from botcore.host import interpret_quality
from botcore.plugin import PluginRegistry, discover_plugins


def content(result):
    blocks = (
        result.content
        if hasattr(result, "content")
        else (result[0] if isinstance(result, tuple) else result)
    )
    return json.loads(blocks[0].text)


@pytest.mark.parametrize(
    "field,value,status",
    [
        ("passed", False, "failed"),
        ("passed", True, "passed"),
        ("total_gaps", 2, "failed"),
        ("issue_count", 1, "failed"),
        ("issue_count", 0, "passed"),
        ("passed", None, "error"),
        ("verdict", "unavailable", "unavailable"),
        ("verdict", "skipped", "skipped"),
        ("passed", "yes", "error"),
        ("passed", 0, "error"),
        ("issue_count", False, "error"),
    ],
)
def test_quality_success_is_separate(field, value, status):
    result = success({field: value})
    verdict = interpret_quality(result, field, "/fixture")
    assert result.success is True
    assert verdict.status == status
    assert verdict.target == "/fixture"
    assert verdict.evidence["field"] == field


@pytest.mark.parametrize(
    "statuses,expected",
    [
        ([], "error"),
        (["passed"], "passed"),
        (["passed", "failed"], "failed"),
        (["passed", "skipped"], "skipped"),
        (["unavailable"], "unavailable"),
        (["error"], "error"),
    ],
)
def test_required_quality_plan(statuses, expected):
    assert (
        aggregate_quality([QualityVerdict(status, "/fixture", {}) for status in statuses])
        == expected
    )


def test_host_owns_identity_and_duplicate_registration():
    reg = PluginRegistry(cli_name="alfred", mcp_name="alfred")
    reg.set_cli_name("plugin")
    reg.set_mcp_name("plugin")
    assert reg.cli_name == reg.mcp_name == "alfred"

    async def check():
        return success({})

    reg.add_commands([check])
    with pytest.raises(ValueError, match="Duplicate command"):
        reg.add_commands([check])
    reg.add_docs("topic", "first")
    with pytest.raises(ValueError, match="Duplicate documentation"):
        reg.add_docs("topic", "second")


def test_explicit_plugins_are_sorted_and_fail_closed():
    calls = []

    def entry(name):
        return SimpleNamespace(name=name, load=lambda: calls.append(name) or object())

    eps = SimpleNamespace(select=lambda **kw: [entry("z"), entry("a")])
    with patch("botcore.plugin.importlib.metadata.entry_points", return_value=eps):
        assert list(discover_plugins(("z", "a"))) == ["a", "z"]
        assert calls == ["a", "z"]
        calls.clear()
        assert discover_plugins(()) == {}
        assert calls == []
        with pytest.raises(ValueError, match="unavailable"):
            discover_plugins(("missing",))
    eps = SimpleNamespace(select=lambda **kw: [entry("a"), entry("a")])
    with patch("botcore.plugin.importlib.metadata.entry_points", return_value=eps):
        with pytest.raises(ValueError, match="Duplicate"):
            discover_plugins(("a",))


async def test_two_worktrees_do_not_mutate_cwd_or_context(tmp_path):
    original = Path.cwd()
    roots = [tmp_path / "one", tmp_path / "two"]
    for root in roots:
        root.mkdir()
        (root / "package.json").write_text('{"name":"ordinary-app"}')
    hosts = [build_host("alfred", ExecutionContext(root)) for root in roots]

    async def probe(host):
        async def identify():
            before = current_context()
            await asyncio.sleep(0)
            assert current_context() is before
            return success({"target": str(before.target)})

        host.register("identify", identify, CommandPolicy())
        result = await host.direct_client().call("identify")
        info = await host.execute("info_workspace")
        return result.data["target"], info.data["workspace_root"]

    results = await asyncio.gather(*(probe(host) for host in hosts))
    assert results == [(str(root.resolve()), str(root.resolve())) for root in roots]
    assert current_context() is None
    assert Path.cwd() == original


async def test_rejection_has_no_effect_across_routes(tmp_path):
    host = build_host("alfred", ExecutionContext(tmp_path))
    path = tmp_path / "result.md"
    args = {"path": str(path)}
    direct = await host.direct_client().call("spec_create", args)
    mcp = create_host_mcp_server(host)
    remote = content(
        await mcp.call_tool(
            "alfred-call",
            {
                "command": "spec_create",
                "arguments": args,
            },
        )
    )
    cli = await asyncio.to_thread(
        CliRunner().invoke, create_host_cli(host), ["call", "spec_create", json.dumps(args)]
    )
    assert direct.error.code == remote["error"]["code"] == "EFFECT_DENIED"
    assert json.loads(cli.output)["error"]["code"] == "EFFECT_DENIED"
    assert cli.exit_code == 1
    assert not path.exists()
    with pytest.raises(ValueError, match="trusted-local"):
        create_host_mcp_server(host, raw_python=True)
    assert "alfred-run" not in [tool.name for tool in await mcp.list_tools()]


@pytest.mark.parametrize(
    "field,value,status",
    [
        ("passed", False, "failed"),
        ("total_gaps", 1, "failed"),
        ("issue_count", 3, "failed"),
        ("verdict", "skipped", "skipped"),
        ("verdict", "unavailable", "unavailable"),
        ("verdict", "error", "error"),
    ],
)
async def test_false_lint_verdict_equivalent_in_every_surface(tmp_path, field, value, status):
    host = CommandHost("alfred", ExecutionContext(tmp_path))

    async def lint():
        return success({field: value, "issues": ["broken fixture"]})

    host.register("lint", lint, CommandPolicy(quality=field))
    direct = await host.direct_client().call("lint")
    remote = content(
        await create_host_mcp_server(host).call_tool("alfred-call", {"command": "lint"})
    )
    cli = await asyncio.to_thread(CliRunner().invoke, create_host_cli(host), ["call", "lint"])
    assert direct.success is remote["success"] is True
    assert direct.metadata.quality["status"] == remote["metadata"]["quality"]["status"] == status
    assert json.loads(cli.output)["metadata"]["quality"]["status"] == status
    assert cli.exit_code == 1


async def test_target_escape_rejected_before_writer(tmp_path):
    target = tmp_path / "area"
    target.mkdir()
    outside = tmp_path / "outside.md"
    host = build_host("alfred", ExecutionContext(tmp_path, target, "trusted-local"))
    for value in ("../outside.md", str(outside)):
        result = await host.execute("spec_create", {"path": value})
        assert result.error.code == "INVALID_TARGET_OR_INPUT"
    (target / "escape").symlink_to(tmp_path, target_is_directory=True)
    result = await host.execute("spec_create", {"path": "escape/outside.md"})
    assert result.error.code == "INVALID_TARGET_OR_INPUT"
    assert not outside.exists()
    with pytest.raises(ValueError):
        ExecutionContext(target, tmp_path)


async def test_native_checks_are_profiled_without_afd_policy(tmp_path):
    (tmp_path / "pyproject.toml").write_text('[project]\nname="plain"\nversion="0.1.0"')
    host = build_host("alfred", ExecutionContext(tmp_path, profile="trusted-local"))
    lint_metadata = next(entry for entry in host.catalog() if entry["name"] == "dev_lint")
    assert set(lint_metadata["effects"]) == {"subprocess", "source-write"}
    assert lint_metadata["effects_depend_on_arguments"] is True
    with patch(
        "botcore.commands.dev.core.run_python_module", return_value={"success": True}
    ) as run:
        result = await host.execute("dev_lint", {"language": "python"})
        assert result.success and result.metadata.quality["status"] == "passed"
        assert run.call_args.kwargs["cwd"] == tmp_path.resolve()
    denied = build_host("alfred", ExecutionContext(tmp_path))
    with patch("botcore.commands.dev.core.run_python_module") as run:
        result = await denied.execute("dev_lint")
        assert result.error.code == "EFFECT_DENIED"
        run.assert_not_called()


async def test_npm_protocol_safe_denial_all_four_operations(tmp_path):
    (tmp_path / "package.json").write_text('{"name":"ordinary-app"}')
    changes = tmp_path / ".changeset"
    changes.mkdir()
    intent = changes / "pending.md"
    intent.write_text('---\n"@app/core": patch\n---\n\nIntent\n')
    changelog = tmp_path / "CHANGELOG.md"
    changelog.write_text("# Changelog\n")
    before = {path: path.read_bytes() for path in (intent, changelog)}
    host = build_host("alfred", ExecutionContext(tmp_path, profile="trusted-local"))
    for name, args in [
        ("changeset_create", {"change_type": "fixed", "description": "test"}),
        ("changeset_status", {}),
        ("changeset_consume", {}),
        ("changeset_delete", {"path": ".changeset/pending.md"}),
    ]:
        result = await host.execute(name, args)
        assert result.error.code == "RELEASE_PROTOCOL_REQUIRED"
    assert {path: path.read_bytes() for path in before} == before
    assert list(changes.iterdir()) == [intent]


def test_unsafe_plugin_configure_is_never_called(tmp_path):
    from unittest.mock import Mock

    plugin = Mock(host_context_safe=False)
    with patch("botcore.plugin.discover_plugins", return_value={"unsafe": plugin}):
        with pytest.raises(ValueError, match="per-host adapter"):
            build_host("alfred", ExecutionContext(tmp_path), plugins=("unsafe",))
    plugin.configure.assert_not_called()


async def test_legacy_and_managed_mcp_exposure_transition(tmp_path):
    from botcore.server import create_mcp_server

    with patch("botcore.server.discover_plugins", return_value={}):
        legacy = create_mcp_server("compat")
    managed = create_host_mcp_server(build_host("alfred", ExecutionContext(tmp_path)))
    assert {tool.name for tool in await legacy.list_tools()} == {
        "compat-start",
        "compat-docs",
        "compat-run",
    }
    assert {tool.name for tool in await managed.list_tools()} == {
        "alfred-start",
        "alfred-docs",
        "alfred-call",
    }
    assert content(await legacy.call_tool("compat-run", {"code": "return 42"})) == 42


async def test_trusted_raw_commands_still_dispatch_and_accept_positional_args(tmp_path):
    host = build_host("alfred", ExecutionContext(tmp_path, profile="trusted-local"))
    server = create_host_mcp_server(host, raw_python=True)
    result = content(
        await server.call_tool(
            "alfred-run",
            {
                "code": "return await spec_create('permitted.md')",
            },
        )
    )
    assert result["success"]
    assert (tmp_path / "permitted.md").exists()
    rejected = content(
        await server.call_tool(
            "alfred-run",
            {
                "code": "return await spec_create('../forbidden.md')",
            },
        )
    )
    assert rejected["error"]["code"] == "INVALID_TARGET_OR_INPUT"
    assert not (tmp_path.parent / "forbidden.md").exists()


async def test_foreign_category_header_and_delete_escape_have_no_effect(tmp_path):
    host = build_host("alfred", ExecutionContext(tmp_path, profile="trusted-local"))
    changes = tmp_path / ".changeset"
    changes.mkdir()
    foreign = changes / "mixed.md"
    foreign.write_text('---\ntype: fixed\n"@app/core": patch\n---\nMixed intent\n')
    before = foreign.read_bytes()
    result = await host.execute("changeset_consume")
    assert result.error.code == "FOREIGN_RELEASE_FRAGMENT"
    assert foreign.read_bytes() == before
    foreign.unlink()
    outside = tmp_path / "notes.md"
    outside.write_text("---\ntype: fixed\n---\nKeep this\n")
    result = await host.execute("changeset_delete", {"path": "notes.md"})
    assert result.error.code == "FOREIGN_RELEASE_FRAGMENT"
    assert outside.exists()


@pytest.mark.parametrize(
    "code,status",
    [
        ("BROKEN_LINKS", "failed"),
        ("TOOL_UNAVAILABLE", "unavailable"),
        ("TOOL_EXECUTION_ERROR", "error"),
        ("TOOL_TIMEOUT", "error"),
    ],
)
async def test_quality_failure_codes_keep_their_meaning_across_surfaces(tmp_path, code, status):
    from afd import error

    host = CommandHost("alfred", ExecutionContext(tmp_path))

    async def check():
        return error(code, "fixture", suggestion="Repair the fixture")

    host.register("check", check, CommandPolicy(quality="execution"))
    direct = await host.direct_client().call("check")
    remote = content(
        await create_host_mcp_server(host).call_tool("alfred-call", {"command": "check"})
    )
    cli = await asyncio.to_thread(CliRunner().invoke, create_host_cli(host), ["call", "check"])
    assert direct.metadata.quality["status"] == status
    assert remote["metadata"]["quality"]["status"] == status
    assert json.loads(cli.output)["metadata"]["quality"]["status"] == status
    assert cli.exit_code == 1


async def test_trusted_raw_kebab_command_identifier_alias_and_collision(tmp_path):
    host = CommandHost("alfred", ExecutionContext(tmp_path, profile="trusted-local"))

    async def inspect_target():
        return success({"checked": True})

    host.register("demo-check", inspect_target, CommandPolicy())
    server = create_host_mcp_server(host, raw_python=True)
    result = content(await server.call_tool("alfred-run", {"code": "return await demo_check()"}))
    assert result["success"] and result["data"]["checked"]
    calls = []

    async def deny(command, args, context, next_fn):
        from afd import error

        calls.append(command)
        return error("EFFECT_DENIED", "fixture", suggestion="Use authorized scope")

    host.middleware.append(deny)
    denied = content(await server.call_tool("alfred-run", {"code": "return await demo_check()"}))
    assert denied["error"]["code"] == "EFFECT_DENIED"
    assert calls == ["demo-check"]
    host.register("demo_check", inspect_target, CommandPolicy())
    with pytest.raises(ValueError, match="Ambiguous trusted-local Python alias"):
        create_host_mcp_server(host, raw_python=True)


async def test_real_broken_docs_links_are_failed_checks_across_surfaces(tmp_path):
    from botcore.commands.docs import docs_lint

    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "guide.md").write_text("# Guide\n\n[Broken](missing.md)\n")
    host = CommandHost("alfred", ExecutionContext(tmp_path))
    host.register("docs_lint", docs_lint, CommandPolicy(paths=("path",), quality="execution"))
    direct = await host.direct_client().call("docs_lint")
    remote = content(
        await create_host_mcp_server(host).call_tool(
            "alfred-call",
            {
                "command": "docs_lint",
            },
        )
    )
    cli = await asyncio.to_thread(CliRunner().invoke, create_host_cli(host), ["call", "docs_lint"])
    assert direct.error.code == remote["error"]["code"] == "BROKEN_LINKS"
    assert direct.error.details["issues"]
    assert direct.metadata.quality["status"] == remote["metadata"]["quality"]["status"] == "failed"
    assert json.loads(cli.output)["metadata"]["quality"]["status"] == "failed"
    assert cli.exit_code == 1


async def test_real_missing_python_tool_is_unavailable_in_native_wrapper(tmp_path):
    host = build_host("alfred", ExecutionContext(tmp_path, profile="trusted-local"))
    with patch("botcore.utils.runner.importlib.util.find_spec", return_value=None):
        result = await host.execute("dev_lint", {"language": "python"})
    assert result.error.code == "TOOL_UNAVAILABLE"
    assert result.metadata.quality["status"] == "unavailable"
