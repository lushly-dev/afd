"""Single-command dispatch-order vectors (spec/dispatch.md, spec/vectors/dispatch.json).

Drives ``create_server`` through every registry and MCP case in ``spec/vectors/dispatch.json``
and validates every returned ``CommandResult`` against ``spec/schema/result.json``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Any

import jsonschema
import pytest
import referencing
from pydantic import StringConstraints
from referencing.jsonschema import DRAFT202012

from afd import Actor, ExposeOptions, success
from afd.core.commands import CommandContext
from afd.core.wire import to_wire
from afd.server import (
    ContextConfig,
    ContextField,
    create_approval_middleware,
    create_server,
)

ROOT = Path(__file__).resolve().parents[2]
VECTORS = json.loads((ROOT / "spec" / "vectors" / "dispatch.json").read_text(encoding="utf-8"))
GAPS = VECTORS["gaps"].get("python", {})


def _result_validator():
    schema_dir = ROOT / "spec" / "schema"
    registry = referencing.Registry()
    result_schema = None
    for name in ("error.json", "result.json"):
        schema = json.loads((schema_dir / name).read_text(encoding="utf-8"))
        if name == "result.json":
            result_schema = schema
        registry = registry.with_resource(
            schema["$id"],
            referencing.Resource.from_contents(schema, default_specification=DRAFT202012),
        )
    return jsonschema.Draft202012Validator(result_schema, registry=registry)


def _pydantic_schema_for(schema: dict[str, Any]) -> Any:
    if schema.get("type") == "string":
        min_length = schema.get("minLength")
        if min_length is not None:
            return Annotated[str, StringConstraints(min_length=min_length)]
        return str
    return Any


def _build_server(case: dict[str, Any], hooks: list[str]):
    middleware = []
    if case.get("middleware") == "throw":

        async def throwing_mw(name: str, input: Any, context: Any, next_fn: Any):
            hooks.append("mw1:before")
            raise RuntimeError("sensitive middleware crash at /srv/secret")

        middleware = [throwing_mw]
    else:

        async def mw1(name: str, input: Any, context: Any, next_fn: Any):
            hooks.append("mw1:before")
            res = await next_fn()
            hooks.append("mw1:after")
            return res

        async def mw2(name: str, input: Any, context: Any, next_fn: Any):
            hooks.append("mw2:before")
            res = await next_fn()
            hooks.append("mw2:after")
            return res

        if case.get("withApprovalMiddleware"):
            approval = create_approval_middleware(secret="dispatch-vector-test-secret-key-32b")
            middleware = [mw1, approval, mw2]
        else:
            middleware = [mw1, mw2]

    context_fields = (
        [
            ContextField(
                name=field["name"],
                meta=field["meta"],
                schema=_pydantic_schema_for(field["schema"]),
                required=field.get("required", False),
            )
            for field in VECTORS["setup"]["contextFields"]
        ]
        if case.get("withContextFields")
        else None
    )

    server = create_server(
        "dispatch-vectors",
        contexts=[ContextConfig(name=name) for name in VECTORS["setup"]["contexts"]],
        context_fields=context_fields,
        middleware=middleware,
        confirmations="enforce" if case["surface"] == "mcp" else "off",
        dev_mode=case.get("devMode", False),
    )

    for cmd in VECTORS["setup"]["commands"]:
        behavior = cmd["behavior"]

        def make_handler(cmd_behavior: str):
            async def handler(input: Any, context: Any = None):
                hooks.append("handler")
                if cmd_behavior == "throw":
                    raise RuntimeError("sensitive handler crash at /srv/secret")
                return success(input)

            return handler

        expose = ExposeOptions(**cmd["expose"])
        server.command(
            name=cmd["name"],
            description=cmd["description"],
            version=cmd["version"],
            expose=expose,
            contexts=cmd.get("contexts"),
            confirm_prompt=cmd.get("confirmPrompt"),
            approval=cmd.get("approval"),
            input_schema=cmd["input"],
        )(make_handler(behavior))

    return server


def test_python_gaps_are_documented():
    assert "hooks" in GAPS


@pytest.mark.asyncio
@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda case: case["id"])
async def test_dispatch_vector(case: dict[str, Any]):
    gap = case.get("gap")
    if gap and gap in GAPS:
        pytest.skip(f"dispatch {gap}: documented Python gap, {GAPS[gap]}")

    hooks: list[str] = []
    server = _build_server(case, hooks)
    call = case["call"]

    if case["surface"] == "mcp":
        args: dict[str, Any] = {"command": call["command"], "input": call["input"]}
        if "confirm" in call:
            args["confirm"] = call["confirm"]
        result = await server.call_tool("afd-call", args)
    else:
        extra: dict[str, Any] = {}
        if "interface" in call:
            extra["interface"] = call["interface"]
        if "contextFields" in call:
            extra.update(call["contextFields"])
        if "activeContext" in call:
            server._context_state.enter(call["activeContext"])
        actor = Actor(kind=call["actorKind"]) if "actorKind" in call else None
        ctx = CommandContext(trace_id=call.get("traceId"), actor=actor, extra=extra)
        result = await server.execute(call["command"], call["input"], ctx)

    wire = to_wire(result)
    _result_validator().validate(wire)

    expected = case["expect"]
    assert result.success is expected["success"]
    if "code" in expected:
        assert result.error is not None
        assert result.error.code == expected["code"]
    if "retryable" in expected:
        assert result.error is not None
        assert result.error.retryable is expected["retryable"]
    if "message" in expected:
        assert result.error is not None
        assert result.error.message == expected["message"]
    if "data" in expected:
        assert result.data == expected["data"]
    assert hooks == expected["hooks"]

    if "stamped" in expected:
        meta = wire.get("metadata", {})
        for field in expected["stamped"]:
            assert field in meta, f"missing stamped metadata.{field}"
        if "traceId" in call:
            assert meta["traceId"] == call["traceId"]
        if "actorKind" in call:
            assert meta["actorKind"] == call["actorKind"]
        cmd = next(c for c in VECTORS["setup"]["commands"] if c["name"] == call["command"])
        assert meta["commandVersion"] == cmd["version"]
