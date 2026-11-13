"""Plugin-declared policies, the catalog a model reads, and refusals that name the fix."""

import asyncio
import json
from typing import Annotated, Any, Literal
from unittest.mock import patch

import pytest
from afd import success
from click.testing import CliRunner
from pydantic import BaseModel, Field

from botcore import (
    CommandHost,
    CommandPolicy,
    ExecutionContext,
    build_host,
    create_host_cli,
    create_host_mcp_server,
)
from botcore.host_inputs import closest_parameter, describe_inputs, parameter_docs
from botcore.plugin import PluginRegistry


def content(result):
    blocks = (
        result.content
        if hasattr(result, "content")
        else (result[0] if isinstance(result, tuple) else result)
    )
    return json.loads(blocks[0].text)


def lint_effects(args):
    return ("subprocess", "source-write") if args.get("fix") else ("subprocess",)


LINT = CommandPolicy(lint_effects, paths=("path",), possible_effects=("subprocess", "source-write"))


class Plugin:
    host_context_safe = True

    def __init__(self, commands, policies=None):
        self.commands, self.policies = commands, policies or {}

    def register(self, registry):
        registry.add_commands(self.commands)
        registry.add_policies(self.policies)


def plugin_host(tmp_path, plugins, *, policies=None):
    with patch("botcore.plugin.discover_plugins", return_value=plugins):
        return build_host(
            "factory",
            ExecutionContext(tmp_path, profile="trusted-local"),
            plugins=tuple(plugins),
            policies=policies,
            core_commands=(),
        )


calls = []


async def lane_lint(path: str | None = None, fix: bool = False):
    """Lint a lane."""
    calls.append(fix)
    return success({"fixed": fix})


async def lane_status():
    """Read the lane."""
    return success({})


# ── Plugin-declared policies ────────────────────────────────────────────


def test_registry_records_policies_and_rejects_duplicates_and_non_policies():
    registry = PluginRegistry()
    registry.add_policy("lane_status", CommandPolicy())
    registry.add_policies({"lane_lint": LINT})
    assert registry.policies == {"lane_status": CommandPolicy(), "lane_lint": LINT}
    with pytest.raises(ValueError, match="Duplicate policy"):
        registry.add_policy("lane_status", CommandPolicy())
    with pytest.raises(TypeError, match="must be a CommandPolicy"):
        registry.add_policy("lane_other", {"effects": ("inspect",)})


async def test_plugin_policies_admit_commands_without_host_policies(tmp_path):
    host = plugin_host(
        tmp_path,
        {
            "factory": Plugin(
                [lane_status, lane_lint], {"lane_status": CommandPolicy(), "lane_lint": LINT}
            )
        },
    )
    rows = {row["name"]: row for row in host.catalog()}
    assert rows["lane_lint"]["effects"] == ["subprocess", "source-write"]
    assert rows["lane_lint"]["paths"] == ["path"]
    assert (await host.execute("lane_status")).success


def test_policy_for_a_command_the_plugin_does_not_register_is_refused(tmp_path):
    lone = Plugin([lane_status], {"lane_status": CommandPolicy(), "lane_lint": LINT})
    with pytest.raises(
        ValueError, match="factory declares policies for commands it does not register: lane_lint"
    ):
        plugin_host(tmp_path, {"factory": lone})
    # Another plugin's command is not this plugin's to declare either.
    owner, other = (
        Plugin([lane_lint]),
        Plugin([lane_status], {"lane_status": CommandPolicy(), "lane_lint": LINT}),
    )
    with pytest.raises(ValueError, match="other declares policies .*: lane_lint"):
        plugin_host(tmp_path, {"a-owner": owner, "other": other})


def test_command_without_any_policy_is_still_refused(tmp_path):
    with pytest.raises(ValueError, match="Declare command effects before admission: lane_lint"):
        plugin_host(
            tmp_path,
            {"factory": Plugin([lane_status, lane_lint], {"lane_status": CommandPolicy()})},
        )


async def test_host_policy_without_plugin_policy_keeps_working(tmp_path):
    host = plugin_host(
        tmp_path, {"factory": Plugin([lane_status])}, policies={"lane_status": CommandPolicy()}
    )
    assert (await host.execute("lane_status")).success


async def test_host_policy_narrows_plugin_effects_and_denies_the_rest(tmp_path):
    calls.clear()
    plugin = Plugin([lane_lint], {"lane_lint": LINT})
    host = plugin_host(
        tmp_path,
        {"factory": plugin},
        policies={"lane_lint": CommandPolicy(("subprocess",), paths=("path",))},
    )
    row = next(row for row in host.catalog() if row["name"] == "lane_lint")
    assert row["effects"] == ["subprocess"]
    assert row["effects_depend_on_arguments"] is True  # The plugin's per-call effects still apply.
    assert (await host.execute("lane_lint")).success
    denied = await host.execute("lane_lint", {"fix": True})
    assert denied.error.code == "EFFECT_DENIED"
    assert "source-write" in denied.error.message
    assert calls == [False]


async def test_host_policy_keeps_plugin_quality_and_may_confine_more_paths(tmp_path):
    plugin = Plugin([lane_lint], {"lane_lint": CommandPolicy(("subprocess",), quality="fixed")})
    host = plugin_host(
        tmp_path,
        {"factory": plugin},
        policies={"lane_lint": CommandPolicy(("subprocess",), paths=("path",))},
    )
    row = next(row for row in host.catalog() if row["name"] == "lane_lint")
    assert row["paths"] == ["path"] and row["quality"] == "fixed"
    escaped = await host.execute("lane_lint", {"path": "../outside"})
    assert escaped.error.code == "INVALID_TARGET_OR_INPUT"


@pytest.mark.parametrize(
    "plugin_policy,host_policy,problem",
    [
        (
            CommandPolicy(),
            CommandPolicy(("inspect", "service")),
            "adds effects the plugin does not declare: service",
        ),
        (
            LINT,
            CommandPolicy(("subprocess", "service"), paths=("path",)),
            "adds effects .*: service",
        ),
        (
            CommandPolicy(("subprocess", "artifact-write")),
            CommandPolicy(("subprocess",)),
            "leaves out effects the command always has: artifact-write",
        ),
        (LINT, CommandPolicy(("subprocess",)), "stops confining path arguments: path"),
    ],
)
def test_host_policy_that_would_widen_is_refused(tmp_path, plugin_policy, host_policy, problem):
    plugin = Plugin([lane_lint], {"lane_lint": plugin_policy})
    with pytest.raises(ValueError, match=f"Host policy for lane_lint {problem}"):
        plugin_host(tmp_path, {"factory": plugin}, policies={"lane_lint": host_policy})


# ── The catalog ─────────────────────────────────────────────────────────


async def representative(
    lane: str,
    timeout_ms: int = 5000,
    mode: Literal["fast", "full"] = "fast",
    note: str | None = None,
    tags: list[str] | None = None,
    labels: dict[str, Any] | None = None,
    limit: Annotated[int, Field(ge=1, description="Most rows to return")] = 20,
    *,
    path: str = ".",
):
    """Report a lane's state.

    This second paragraph is long prose a model does not need in the catalog,
    so the catalog leaves it out.

    Args:
        lane: The lane to read.
        timeout_ms (int): How long to wait,
            in milliseconds.
        limit: Overridden by the Annotated description.

    Returns:
        The lane state.
    """
    return success({"lane": lane})


def test_catalog_schema_covers_required_defaults_optional_literal_list_and_dict():
    description, schema = describe_inputs(representative)
    assert description == "Report a lane's state."
    assert schema["type"] == "object" and schema["additionalProperties"] is False
    assert schema["required"] == ["lane"]
    properties = schema["properties"]
    assert properties["lane"] == {"type": "string", "description": "The lane to read."}
    assert properties["timeout_ms"] == {
        "type": "integer",
        "description": "How long to wait, in milliseconds.",
        "default": 5000,
    }
    assert properties["mode"] == {"enum": ["fast", "full"], "type": "string", "default": "fast"}
    assert properties["note"] == {"anyOf": [{"type": "string"}, {"type": "null"}], "default": None}
    assert properties["tags"]["anyOf"][0] == {"items": {"type": "string"}, "type": "array"}
    assert properties["labels"]["anyOf"][0] == {"additionalProperties": True, "type": "object"}
    assert properties["limit"] == {
        "description": "Most rows to return",
        "minimum": 1,
        "type": "integer",
        "default": 20,
    }
    assert properties["path"] == {"type": "string", "default": "."}
    assert "second paragraph" not in json.dumps(schema)
    assert "Returns" not in json.dumps(schema)


def test_catalog_schema_tolerates_untyped_unresolvable_and_open_handlers():
    async def untyped(value, flag=False, when=object()):
        """Untyped."""

    async def unresolvable(value: "NotImportableHere", count: "int" = 1):  # noqa: F821
        """Unresolvable."""

    async def open_ended(lane: str, **options: Any):
        """Accept anything."""

    class Step(BaseModel):
        name: str

    async def with_models(steps: list[Step]):
        """Run steps."""

    assert describe_inputs(untyped)[1]["properties"] == {
        "value": {},
        "flag": {"default": False},
        "when": {},  # A default with no JSON form is left out.
    }
    schema = describe_inputs(unresolvable)[1]
    # One unresolvable hint leaves its neighbours resolved.
    assert schema["properties"] == {"value": {}, "count": {"type": "integer", "default": 1}}
    schema = describe_inputs(open_ended)[1]
    assert schema["additionalProperties"] is True and list(schema["properties"]) == ["lane"]
    schema = describe_inputs(with_models)[1]
    assert schema["properties"]["steps"] == {"items": {"$ref": "#/$defs/Step"}, "type": "array"}
    assert schema["$defs"]["Step"]["required"] == ["name"]


def test_parameter_docs_read_google_and_sphinx_and_bound_size():
    long = "word " * 80
    bounded = parameter_docs(f"Summary.\n\nArgs:\n    note: {long}")["note"]
    assert len(bounded) <= 200 and bounded.endswith("word...")
    assert parameter_docs(
        f"""Summary.

        Arguments:
            *names (list): Names to read.
            depth: How deep.

                Ignored after a blank line.
            note: {long}
        Raises:
            ValueError: never a parameter.
        """
    ) == {
        "names": "Names to read.",
        "depth": "How deep.",
        "note": bounded,
    }
    assert parameter_docs(
        "Summary.\n\n:param str lane: The lane.\n    Continued.\n:returns: x"
    ) == {"lane": "The lane. Continued."}
    assert parameter_docs(None) == {}


async def test_every_surface_carries_the_same_catalog(tmp_path):
    host = build_host("alfred", ExecutionContext(tmp_path))
    host.register("representative", representative, CommandPolicy(paths=("path",)))
    rows = host.catalog()
    row = next(row for row in rows if row["name"] == "representative")
    assert row["description"] == "Report a lane's state."
    assert row["paths"] == ["path"] and "path" in row["input_schema"]["properties"]
    assert row["effects"] == ["inspect"]
    started = content(await create_host_mcp_server(host).call_tool("alfred-start", {}))
    assert started["commands"] == rows
    cli = CliRunner().invoke(create_host_cli(host), ["catalog"])
    assert json.loads(cli.output) == rows
    spec = next(row for row in rows if row["name"] == "spec_create")
    assert spec["input_schema"]["required"] == ["path"]
    infos = {info.name: info.description for info in host.list_commands()}
    assert infos["representative"] == "Report a lane's state."


# ── Refusals ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "key,meant",
    [
        ("timeoutMs", "timeout_ms"),
        ("TimeoutMs", "timeout_ms"),
        ("timeout-ms", "timeout_ms"),
        ("TIMEOUT_MS", "timeout_ms"),
        ("timout_ms", "timeout_ms"),
        ("lanes", "lane"),
        ("zzz", None),
    ],
)
def test_closest_parameter_prefers_case_conventions_then_difflib(key, meant):
    assert closest_parameter(key, ["lane", "timeout_ms", "mode"]) == meant


async def test_wrong_and_missing_arguments_are_refused_alike_on_every_surface(tmp_path):
    invoked = []

    async def lane_wait(lane: str, timeout_ms: int = 5000):
        """Wait for a lane."""
        invoked.append(lane)
        return success({})

    host = CommandHost("factory", ExecutionContext(tmp_path))
    host.register("lane_wait", lane_wait, CommandPolicy())
    args = {"lane": "main", "timeoutMs": 10}
    direct = await host.direct_client().call("lane_wait", args)
    remote = content(
        await create_host_mcp_server(host).call_tool(
            "factory-call", {"command": "lane_wait", "arguments": args}
        )
    )
    cli = await asyncio.to_thread(
        CliRunner().invoke, create_host_cli(host), ["call", "lane_wait", json.dumps(args)]
    )
    assert cli.exit_code == 1
    for error in (
        direct.error.model_dump(exclude_none=True),
        remote["error"],
        json.loads(cli.output)["error"],
    ):
        assert error["code"] == "VALIDATION_ERROR"
        assert error["message"] == "lane_wait does not take timeoutMs"
        assert (
            error["suggestion"]
            == "Use timeout_ms instead of timeoutMs. Expected fields: lane, timeout_ms"
        )
        assert error["details"] == {
            "expectedFields": ["lane", "timeout_ms"],
            "unexpectedFields": ["timeoutMs"],
            "suggestedFields": {"timeoutMs": "timeout_ms"},
        }
    missing = await host.execute("lane_wait", {"Lane": "main"})
    assert missing.error.message == "lane_wait does not take Lane and requires lane"
    assert missing.error.suggestion.startswith("Use lane instead of Lane. ")
    assert missing.error.details["missingFields"] == ["lane"]
    unknown = await host.execute("lane_wait", {"zzz": 1})
    assert unknown.error.suggestion == "Remove zzz; pass lane. Expected fields: lane, timeout_ms"
    assert invoked == []
    assert (await host.execute("lane_wait", {"lane": "main", "timeout_ms": 1})).success
    assert invoked == ["main"]


async def test_refusal_precedes_effect_denial_and_open_handlers_take_any_key(tmp_path):
    async def writer(path: str):
        """Write a file."""
        return success({})

    async def open_ended(**options):
        """Take anything."""
        return success(options)

    host = CommandHost("factory", ExecutionContext(tmp_path))
    host.register("writer", writer, CommandPolicy(("source-write",), paths=("path",)))
    host.register("open_ended", open_ended, CommandPolicy())
    refused = await host.execute("writer", {"Path": "x.md"})
    assert refused.error.code == "VALIDATION_ERROR"
    assert refused.error.details["suggestedFields"] == {"Path": "path"}
    assert (await host.execute("writer", {"path": "x.md"})).error.code == "EFFECT_DENIED"
    assert (await host.execute("open_ended", {"anyKey": 1})).data == {"anyKey": 1}
    empty = CommandHost("factory", ExecutionContext(tmp_path))
    empty.register("lane_status", lane_status, CommandPolicy())
    result = await empty.execute("lane_status", {"lane": "main"})
    assert result.error.suggestion == "Remove lane. It takes no arguments"
