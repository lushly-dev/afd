"""The meta-tools' ``meta`` argument (``spec/context-fields.md``, "Clients that cannot set
``_meta``"; ``spec/command-metadata.md``, "Decisions on the tool surface (#466)").

Mirrors ``packages/server/src/meta-argument.test.ts``: the helper, then real MCP clients in
process (both eras) and over Streamable HTTP.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel

from afd import ExposeOptions, success
from afd.core.commands import CommandContext
from afd.server import create_server
from afd.server.meta_argument import (
    META_ARGUMENT_DESCRIPTION,
    lift_meta_argument,
    meta_argument_keys,
)
from afd.server.tools import (
    BatchToolSchema,
    CallToolSchema,
    DetailToolSchema,
    DiscoverToolSchema,
    PipeToolSchema,
)
from afd.server.types import ContextConfig
from tests.fixtures.context_fields_server import FIELDS, build_server

pytest.importorskip("mcp.client.streamable_http")

from mcp import Client  # noqa: E402

from tests.test_mcp_protocol_live import protocol_server  # noqa: E402

MODERN = "2026-07-28"
KEYS = meta_argument_keys(FIELDS)
SCOPE = {"project": "p-1"}
SPEC_META_TOOLS = Path(__file__).resolve().parents[2] / "spec" / "meta-tools.json"


def payload(result: Any) -> dict[str, Any]:
    return json.loads(result.content[0].text)


# ═══════════════════════════════════════════════════════════════════════════════
# HELPER
# ═══════════════════════════════════════════════════════════════════════════════


def test_keys_are_the_context_key_and_the_declared_fields():
    assert meta_argument_keys(FIELDS) == {"dev.afd/context", "dev.example/scope", "dev.example/locale"}
    assert meta_argument_keys(None) == {"dev.afd/context"}


def test_other_tools_and_calls_without_meta_are_unchanged():
    arguments = {"meta": {"dev.example/scope": SCOPE}}
    for name in ("scope-echo", "afd-help", "afd-context-enter"):
        lifted = lift_meta_argument(name, arguments, None, KEYS)
        assert lifted.error is None
        assert lifted.arguments is arguments
        assert lifted.meta is None
    plain = {"command": "scope-echo"}
    lifted = lift_meta_argument("afd-call", plain, {"a.b/c": 1}, KEYS)
    assert lifted.arguments is plain and lifted.meta == {"a.b/c": 1}
    absent = lift_meta_argument("afd-call", {"command": "x", "meta": None}, None, KEYS)
    assert absent.error is None
    assert absent.arguments == {"command": "x"} and absent.meta is None


def test_allowed_keys_merge_and_unknown_keys_are_dropped():
    lifted = lift_meta_argument(
        "afd-batch",
        {
            "commands": [],
            "meta": {
                "dev.example/scope": SCOPE,
                "dev.afd/context": "alpha",
                "dev.example/other": "dropped",
                "dev.example/locale": None,
            },
        },
        {"io.modelcontextprotocol/progressToken": 1},
        KEYS,
    )
    assert lifted.error is None
    assert lifted.arguments == {"commands": []}
    assert lifted.meta == {
        "io.modelcontextprotocol/progressToken": 1,
        "dev.example/scope": SCOPE,
        "dev.afd/context": "alpha",
    }


def test_an_agreeing_duplicate_is_accepted():
    lifted = lift_meta_argument(
        "afd-call",
        {"command": "x", "meta": {"dev.example/scope": {"project": "p-1", "n": [1, {"a": 2}]}}},
        {"dev.example/scope": {"n": [1, {"a": 2}], "project": "p-1"}},
        KEYS,
    )
    assert lifted.error is None
    assert lifted.meta == {"dev.example/scope": {"project": "p-1", "n": [1, {"a": 2}]}}
    # A null in _meta is no value, so the argument fills it.
    filled = lift_meta_argument(
        "afd-call", {"meta": {"dev.example/locale": "en"}}, {"dev.example/locale": None}, KEYS
    )
    assert filled.error is None and filled.meta == {"dev.example/locale": "en"}


@pytest.mark.parametrize(
    ("sent", "argument"),
    [
        ({"project": "p-1"}, {"project": "p-2"}),
        ({"project": "p-1"}, {"project": "p-1", "extra": None}),
        ([1, 2], [2, 1]),
        (True, 1),
        ("1", 1),
    ],
)
def test_a_disagreement_fails(sent, argument):
    lifted = lift_meta_argument(
        "afd-pipe",
        {"steps": [], "meta": {"dev.example/scope": argument}},
        {"dev.example/scope": sent},
        KEYS,
    )
    assert lifted.error is not None
    assert lifted.error.code == "VALIDATION_ERROR"
    assert lifted.error.message == (
        '_meta["dev.example/scope"] and the meta argument of afd-pipe disagree'
    )
    assert lifted.error.details == {"meta": "dev.example/scope"}
    assert lifted.error.suggestion


@pytest.mark.parametrize("argument", ["alpha", ["dev.afd/context"], 3, True])
def test_a_meta_argument_that_is_not_an_object_fails(argument):
    lifted = lift_meta_argument("afd-discover", {"meta": argument}, None, KEYS)
    assert lifted.error is not None
    assert lifted.error.code == "VALIDATION_ERROR"
    assert lifted.error.message == "The meta argument of afd-discover must be an object"
    assert lifted.error.details == {"argument": "meta"}
    assert "dev.afd/context" in lifted.error.suggestion


def test_every_meta_tool_advertises_meta_as_the_spec_does():
    spec = {tool["name"]: tool for tool in json.loads(SPEC_META_TOOLS.read_text())}
    for schema in (CallToolSchema, BatchToolSchema, PipeToolSchema, DiscoverToolSchema, DetailToolSchema):
        prop = schema["inputSchema"]["properties"]["meta"]
        assert prop == {"type": "object", "description": META_ARGUMENT_DESCRIPTION}
        assert prop == spec[schema["name"]]["inputSchema"]["properties"]["meta"]
        assert "meta" not in schema["inputSchema"].get("required", [])


# ═══════════════════════════════════════════════════════════════════════════════
# OVER MCP
# ═══════════════════════════════════════════════════════════════════════════════

DELIVERED = {
    "scope": SCOPE,
    "locale": "en-GB",
    "undeclared": None,
    "keys": ["active_context", "interface", "locale", "remote", "scope"],
}
ARGUMENT = {
    "dev.example/scope": SCOPE,
    "dev.example/locale": "en-GB",
    "dev.example/other": "dropped",
}


@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_declared_fields_reach_every_item_and_step_through_meta(mode):
    async with Client(build_server("lazy")._create_mcp_server(), mode=mode) as client:
        called = await client.call_tool("afd-call", {"command": "scope-echo", "meta": ARGUMENT})
        assert payload(called)["data"] == DELIVERED

        batch = await client.call_tool(
            "afd-batch",
            {"commands": [{"command": "scope-echo"}, {"command": "scope-peek"}], "meta": ARGUMENT},
        )
        assert [item["result"]["data"] for item in payload(batch)["results"]] == [
            DELIVERED,
            DELIVERED,
        ]

        piped = await client.call_tool(
            "afd-pipe",
            {
                "steps": [{"command": "scope-echo", "as": "first"}, {"command": "scope-peek"}],
                "meta": ARGUMENT,
            },
        )
        assert [step["data"] for step in payload(piped)["steps"]] == [DELIVERED, DELIVERED]

        # Split between _meta and the argument, agreeing on the one they share.
        split = await client.call_tool(
            "afd-call",
            {"command": "scope-echo", "meta": {"dev.example/scope": SCOPE}},
            meta={"dev.example/scope": SCOPE, "dev.example/locale": "en-GB"},
        )
        assert payload(split)["data"] == DELIVERED


@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_an_invalid_field_through_meta_fails_with_the_field_error(mode):
    async with Client(build_server("lazy")._create_mcp_server(), mode=mode) as client:
        invalid = await client.call_tool(
            "afd-call", {"command": "scope-echo", "meta": {"dev.example/scope": {"project": 7}}}
        )
        assert invalid.is_error is True
        error = payload(invalid)["error"]
        assert error["code"] == "VALIDATION_ERROR"
        assert error["message"] == "Context field 'scope' is not valid"
        assert error["details"]["field"] == "scope"
        assert error["details"]["meta"] == "dev.example/scope"


@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_a_disagreement_or_a_non_object_is_a_tool_error(mode):
    async with Client(build_server("lazy")._create_mcp_server(), mode=mode) as client:
        disagree = await client.call_tool(
            "afd-call",
            {"command": "scope-echo", "meta": {"dev.example/locale": "fr"}},
            meta={"dev.example/locale": "en-GB"},
        )
        assert disagree.is_error is True
        error = payload(disagree)["error"]
        assert error["code"] == "VALIDATION_ERROR"
        assert error["message"] == (
            '_meta["dev.example/locale"] and the meta argument of afd-call disagree'
        )
        assert error["details"] == {"meta": "dev.example/locale"}

        not_object = await client.call_tool("afd-batch", {"commands": [], "meta": "x"})
        assert not_object.is_error is True
        error = payload(not_object)["error"]
        assert error["code"] == "VALIDATION_ERROR"
        assert error["message"] == "The meta argument of afd-batch must be an object"
        assert error["details"] == {"argument": "meta"}


class MetaInput(BaseModel):
    meta: dict[str, Any] | None = None


def context_server(strategy: str = "lazy"):
    server = create_server(
        "meta-argument-fixture",
        tool_strategy=strategy,  # type: ignore[arg-type]
        contexts=[ContextConfig(name="alpha"), ContextConfig(name="beta")],
        context_fields=FIELDS,
    )

    @server.command(
        name="alpha-run",
        description="Run alpha",
        contexts=["alpha"],
        expose=ExposeOptions(mcp=True),
    )
    async def alpha_run(input: Any, context: CommandContext):
        return success({"context": (context.extra or {}).get("active_context")})

    @server.command(
        name="beta-run",
        description="Run beta",
        contexts=["beta"],
        expose=ExposeOptions(mcp=True),
    )
    async def beta_run(input: Any, context: CommandContext):
        return success({"context": "beta"})

    @server.command(
        name="meta-echo",
        description="Return its own meta input",
        input_schema=MetaInput,
        expose=ExposeOptions(mcp=True),
    )
    async def meta_echo(input: MetaInput, context: CommandContext):
        return success({"meta": input.meta, "scope": (context.extra or {}).get("scope")})

    return server


def discovered(result: Any) -> set[str]:
    return {command["name"] for command in payload(result)["data"]["commands"]}


async def test_the_context_through_meta_scopes_afd_call_and_afd_discover():
    async with Client(context_server()._create_mcp_server(), mode="auto") as client:
        assert client.protocol_version == MODERN
        allowed = await client.call_tool(
            "afd-call", {"command": "alpha-run", "meta": {"dev.afd/context": "alpha"}}
        )
        assert payload(allowed)["success"] is True
        assert payload(allowed)["data"]["context"] == "alpha"

        denied = await client.call_tool(
            "afd-call", {"command": "beta-run", "meta": {"dev.afd/context": "alpha"}}
        )
        assert payload(denied)["success"] is False
        assert payload(denied)["error"]["code"] == "COMMAND_NOT_IN_CONTEXT"

        everything = discovered(await client.call_tool("afd-discover", {}))
        assert {"alpha-run", "beta-run"} <= everything
        alpha = discovered(
            await client.call_tool("afd-discover", {"meta": {"dev.afd/context": "alpha"}})
        )
        assert "alpha-run" in alpha and "beta-run" not in alpha


async def test_the_legacy_era_ignores_the_context_through_meta_as_it_ignores_meta():
    async with Client(context_server()._create_mcp_server(), mode="legacy") as client:
        via_argument = await client.call_tool(
            "afd-call", {"command": "beta-run", "meta": {"dev.afd/context": "alpha"}}
        )
        via_meta = await client.call_tool(
            "afd-call", {"command": "beta-run"}, meta={"dev.afd/context": "alpha"}
        )
        assert payload(via_argument)["success"] is payload(via_meta)["success"] is True


async def test_a_command_keeps_its_own_meta_input():
    server = context_server("individual")
    async with Client(server._create_mcp_server(), mode="auto") as client:
        echoed = await client.call_tool("meta-echo", {"meta": {"dev.example/scope": SCOPE}})
        assert payload(echoed)["data"] == {"meta": {"dev.example/scope": SCOPE}, "scope": None}


async def test_streamable_http_lifts_the_meta_argument():
    async with (
        protocol_server(
            "lazy", "streamable-http", stateless=True, fixture="context_fields_server.py"
        ) as url,
        Client(url, mode="auto") as client,
    ):
        assert client.protocol_version == MODERN
        called = await client.call_tool("afd-call", {"command": "scope-echo", "meta": ARGUMENT})
        assert payload(called)["data"] == DELIVERED
        disagree = await client.call_tool(
            "afd-call",
            {"command": "scope-echo", "meta": {"dev.example/locale": "fr"}},
            meta={"dev.example/locale": "en-GB"},
        )
        assert payload(disagree)["error"]["code"] == "VALIDATION_ERROR"


async def test_stateful_legacy_http_lifts_the_meta_argument():
    async with (
        protocol_server("lazy", "streamable-http", fixture="context_fields_server.py") as url,
        Client(url, mode="legacy") as client,
    ):
        called = await client.call_tool(
            "afd-batch", {"commands": [{"command": "scope-echo"}], "meta": ARGUMENT}
        )
        assert payload(called)["results"][0]["result"]["data"] == DELIVERED
