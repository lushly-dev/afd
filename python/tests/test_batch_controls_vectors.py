"""The language-neutral vectors in spec/vectors/batch-controls.json.

spec/vectors/generate-batch-controls.mjs generated the expected values from the
TypeScript executors on a virtual clock. Python has no fake clock for asyncio,
so the cases run in real time, through the server's ``afd-batch`` and
``afd-pipe`` tools (Python has no standalone batch executor). A failure means
Python and TypeScript disagree on these inputs. TypeScript, Rust and C++ load
the same file (see spec/vectors/README.md).
"""

import asyncio
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from afd import ExposeOptions
from afd.core.commands import CommandContext
from afd.core.result import CommandResult, error, success
from afd.core.wire import to_wire
from afd.server import MCPServer, create_server

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "spec" / "vectors" / "batch-controls.json").read_text(
        encoding="utf-8"
    )
)


@dataclass
class _Record:
    """Handler calls in start order, and the most handlers running at once."""

    calls: list[dict[str, Any]] = field(default_factory=list)
    # Batch indexes of the commands whose handlers were called.
    ran: list[int] = field(default_factory=list)
    active: int = 0
    peak: int = 0


def _register(server: MCPServer, name: str, spec: dict[str, Any], record: _Record) -> None:
    """Register a command that runs the case's declarative handler ``spec``."""

    @server.command(name=name, description=f"Vector handler {name}", expose=ExposeOptions(mcp=True))
    async def handler(input: Any, context: CommandContext) -> CommandResult[Any]:
        record.calls.append({"command": name, "input": input})
        # A batch command's trace ID is <batch trace>-<index>.
        suffix = (context.trace_id or "").rsplit("-", 1)[-1]
        if suffix.isdigit():
            record.ran.append(int(suffix))
        record.active += 1
        record.peak = max(record.peak, record.active)
        try:
            if spec.get("untilCancelled"):
                await asyncio.Event().wait()  # until the deadline cancels it
            elif spec.get("delayMs"):
                await asyncio.sleep(spec["delayMs"] / 1000)
            fail = spec.get("fail")
            return error(fail["code"], fail["message"]) if fail else success(input)
        finally:
            record.active -= 1


def _server(handlers: dict[str, dict[str, Any]]) -> tuple[MCPServer, _Record]:
    server = create_server("batch-controls-vectors")
    record = _Record()
    for name, spec in handlers.items():
        _register(server, name, spec, record)
    return server, record


def _project_error(actual: dict[str, Any] | None, expected: Any) -> Any:
    """``code`` and ``message``, and ``retryable`` only when the vector gives it."""
    if actual is None:
        return None
    projected = {"code": actual.get("code"), "message": actual.get("message")}
    if isinstance(expected, dict) and "retryable" in expected and "retryable" in actual:
        projected["retryable"] = actual["retryable"]
    return projected


def _expected_errors(expected: dict[str, Any]) -> list[Any]:
    return [entry.get("error") for entry in expected.get("results", [])]


def _project_batch(wire: dict[str, Any], ran: list[int], expected: dict[str, Any]) -> dict[str, Any]:
    if not wire.get("success"):
        projected: dict[str, Any] = {
            "success": False,
            "error": _project_error(wire.get("error"), expected.get("error")),
        }
        if "results" in wire:
            projected["results"] = wire["results"]
        return projected
    expected_errors = _expected_errors(expected)
    results = []
    for position, entry in enumerate(wire["results"]):
        result = entry["result"]
        projected = {
            "id": entry["id"],
            "index": entry["index"],
            "command": entry["command"],
            "success": result["success"],
        }
        if result["success"]:
            if "data" in result:
                projected["data"] = result["data"]
        else:
            expected_error = expected_errors[position] if position < len(expected_errors) else None
            projected["error"] = _project_error(result.get("error"), expected_error)
        if entry["index"] not in ran:
            projected["durationMs"] = entry["durationMs"]
        results.append(projected)
    return {"success": True, "summary": wire["summary"], "results": results}


def _project_pipeline(wire: dict[str, Any], expected: dict[str, Any]) -> dict[str, Any]:
    expected_steps = expected.get("steps", [])
    steps = []
    for position, step in enumerate(wire["steps"]):
        projected: dict[str, Any] = {"index": step["index"], "command": step["command"]}
        if "alias" in step:
            projected["alias"] = step["alias"]
        projected["status"] = step["status"]
        if "data" in step:
            projected["data"] = step["data"]
        if "error" in step:
            expected_step = expected_steps[position] if position < len(expected_steps) else {}
            projected["error"] = _project_error(step["error"], expected_step.get("error"))
        steps.append(projected)
    projected_pipeline: dict[str, Any] = {}
    if "data" in wire:
        projected_pipeline["data"] = wire["data"]
    projected_pipeline["completedSteps"] = wire["metadata"]["completedSteps"]
    projected_pipeline["totalSteps"] = wire["metadata"]["totalSteps"]
    projected_pipeline["steps"] = steps
    return projected_pipeline


def _normalized(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _normalized(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_normalized(item) for item in value]
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def _json(value: Any) -> str:
    """Canonical JSON, compared as TypeScript compares values: 0 equals 0.0, but
    True is not 1 (as it is to ==). Indented, so pytest shows a readable diff."""
    return json.dumps(_normalized(value), sort_keys=True, indent=1)


def test_vectors_have_the_expected_number_of_cases():
    assert len(VECTORS["batch"]) >= 20
    assert len(VECTORS["pipeline"]) >= 20


@pytest.mark.parametrize("vector", VECTORS["batch"], ids=[v["name"] for v in VECTORS["batch"]])
async def test_batch(vector: dict[str, Any]):
    server, record = _server(vector["handlers"])
    expected = dict(vector["expected"])
    calls = expected.pop("calls")
    peak_concurrency = expected.pop("peakConcurrency", None)

    result = await server.call_tool("afd-batch", vector["request"])

    assert _json(record.calls) == _json(calls)
    if peak_concurrency is not None:
        assert record.peak == peak_concurrency
    assert _json(_project_batch(to_wire(result), record.ran, expected)) == _json(expected)


@pytest.mark.parametrize(
    "vector", VECTORS["pipeline"], ids=[v["name"] for v in VECTORS["pipeline"]]
)
async def test_pipeline(vector: dict[str, Any]):
    server, record = _server(vector["handlers"])
    expected = dict(vector["expected"])
    calls = expected.pop("calls")

    result = await server.call_tool("afd-pipe", vector["request"])

    assert _json(record.calls) == _json(calls)
    assert _json(_project_pipeline(to_wire(result), expected)) == _json(expected)
