"""Integration tests — JTBD scenario runner for the virtual team stack.

Fast tests (mock LLM):
    pytest tests/integration/test_scenarios.py -v

Live tests (real Copilot CLI):
    pytest tests/integration/test_scenarios.py -v -m live
"""

from __future__ import annotations

from typing import Any

import pytest
import yaml
from botcore_agents.orchestrator import AgentOrchestrator

from .conftest import SCENARIOS_DIR, build_command_handler

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def load_scenario(name: str) -> dict[str, Any]:
    """Load a scenario YAML by filename (without extension)."""
    path = SCENARIOS_DIR / f"{name}.yaml"
    assert path.exists(), f"Scenario not found: {path}"
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _match(actual: Any, expected: Any) -> bool:
    """Recursively match an actual value against an expected value.

    Supports assertion matchers:
      - ``{exists: true}`` — value is not None
      - ``{contains: "x"}`` — substring check
      - ``{length: N}`` — len(value) == N
      - ``{includes: "x"}`` — item in list
      - ``{gte: N}`` / ``{lte: N}`` — numeric comparison
    Plain values are compared with ``==``.
    Dicts are matched recursively.
    """
    if isinstance(expected, dict):
        # Assertion matchers
        if "exists" in expected:
            return (actual is not None) == expected["exists"]
        if "contains" in expected:
            return isinstance(actual, str) and expected["contains"] in actual
        if "length" in expected:
            return hasattr(actual, "__len__") and len(actual) == expected["length"]
        if "includes" in expected:
            return isinstance(actual, list) and expected["includes"] in actual
        if "gte" in expected:
            return isinstance(actual, (int, float)) and actual >= expected["gte"]
        if "lte" in expected:
            return isinstance(actual, (int, float)) and actual <= expected["lte"]

        # Recursive dict matching
        if not isinstance(actual, dict):
            return False
        for key, exp_val in expected.items():
            if key not in actual:
                return False
            if not _match(actual[key], exp_val):
                return False
        return True

    return actual == expected


async def run_scenario(
    scenario: dict[str, Any],
    handler,
) -> list[dict[str, Any]]:
    """Execute scenario steps sequentially, resolving step references.

    Returns list of step results for assertion.
    """
    step_outputs: list[dict[str, Any]] = []

    for i, step in enumerate(scenario["steps"]):
        command = step["command"]
        raw_input = step.get("input", {})

        # Resolve ${{ steps[N].data.xxx }} references
        resolved_input = _resolve_refs(raw_input, step_outputs)

        # Execute
        result = await handler(command, resolved_input)
        step_outputs.append(result)

        # Validate expectations
        expect = step.get("expect", {})
        desc = step.get("description", f"step {i}")

        if "success" in expect:
            assert result["success"] == expect["success"], (
                f"Step {i} ({desc}): expected success={expect['success']}, "
                f"got success={result['success']}. Result: {result}"
            )

        if "data" in expect and result["success"]:
            assert _match(result["data"], expect["data"]), (
                f"Step {i} ({desc}): data mismatch.\n"
                f"  Expected: {expect['data']}\n"
                f"  Actual:   {result['data']}"
            )

        if "error" in expect and not result["success"]:
            assert _match(result.get("error", {}), expect["error"]), (
                f"Step {i} ({desc}): error mismatch.\n"
                f"  Expected: {expect['error']}\n"
                f"  Actual:   {result.get('error')}"
            )

    return step_outputs


def _resolve_refs(data: Any, step_outputs: list[dict[str, Any]]) -> Any:
    """Resolve ``${{ steps[N].data.xxx }}`` references in input data."""
    if isinstance(data, str) and "${{" in data:
        return _resolve_single_ref(data, step_outputs)
    if isinstance(data, dict):
        return {k: _resolve_refs(v, step_outputs) for k, v in data.items()}
    if isinstance(data, list):
        return [_resolve_refs(item, step_outputs) for item in data]
    return data


def _resolve_single_ref(ref: str, step_outputs: list[dict[str, Any]]) -> Any:
    """Resolve a single ``${{ steps[N].data.path }}`` reference."""
    import re

    m = re.search(r"\$\{\{\s*steps\[(\d+)\]\.(\S+?)\s*\}\}", ref)
    if not m:
        return ref

    step_idx = int(m.group(1))
    path = m.group(2)

    if step_idx >= len(step_outputs):
        raise ValueError(f"Step reference {ref} — step {step_idx} not yet executed")

    value = step_outputs[step_idx]
    for part in path.split("."):
        if isinstance(value, dict):
            value = value[part]
        elif isinstance(value, list):
            value = value[int(part)]
        else:
            raise ValueError(f"Cannot resolve {path!r} at {part!r} in {value!r}")
    return value


# ===========================================================================
# Mock LLM scenarios (fast, CI-safe)
# ===========================================================================


class TestAgentLifecycleMock:
    """Agent lifecycle with mocked LLM — no Copilot CLI needed."""

    @pytest.mark.asyncio
    async def test_agent_lifecycle(self, orchestrator: AgentOrchestrator, mock_llm):
        scenario = load_scenario("agent-lifecycle")
        handler = build_command_handler(orchestrator)
        await run_scenario(scenario, handler)

    @pytest.mark.asyncio
    async def test_task_execution(self, orchestrator: AgentOrchestrator, mock_llm):
        scenario = load_scenario("task-execution")
        handler = build_command_handler(orchestrator)
        await run_scenario(scenario, handler)


class TestMemoryScenarios:
    """Memory CRUD scenarios — no LLM required."""

    @pytest.mark.asyncio
    async def test_agent_memory(self, orchestrator: AgentOrchestrator):
        scenario = load_scenario("agent-memory")
        handler = build_command_handler(orchestrator)
        await run_scenario(scenario, handler)

    @pytest.mark.asyncio
    async def test_team_shared_memory(self, orchestrator: AgentOrchestrator):
        scenario = load_scenario("team-shared-memory")
        handler = build_command_handler(orchestrator)
        await run_scenario(scenario, handler)


# ===========================================================================
# Live LLM scenarios (real Copilot CLI — requires auth)
# ===========================================================================


@pytest.mark.live
class TestLiveAgentWorkflow:
    """Integration tests using real Copilot CLI + LLM."""

    @pytest.mark.asyncio
    async def test_agent_live_task(
        self,
        orchestrator: AgentOrchestrator,
        setup_llm,
    ):
        """Start agent, assign a task to real LLM, verify completion."""
        scenario = load_scenario("agent-live-task")
        handler = build_command_handler(orchestrator)
        results = await run_scenario(scenario, handler)

        # Extra assertions on the live LLM response
        task_result = results[2]  # task_assign step
        assert task_result["success"]
        assert "TASK_COMPLETE" in task_result["data"]["result"]

    @pytest.mark.asyncio
    async def test_multi_agent_isolation(
        self,
        orchestrator: AgentOrchestrator,
        setup_llm,
    ):
        """Two agents with separate sessions don't share context."""
        handler = build_command_handler(orchestrator)

        # Create and start both agents
        r1 = await handler("agent_create", {"name": "researcher"})
        assert r1["success"]
        r2 = await handler("agent_create", {"name": "coder"})
        assert r2["success"]

        r3 = await handler("agent_start", {"name": "researcher"})
        assert r3["success"]
        r4 = await handler("agent_start", {"name": "coder"})
        assert r4["success"]

        # Different session IDs = isolation
        assert r3["data"]["session_id"] != r4["data"]["session_id"]

        # Assign distinct tasks
        t1 = await handler("task_assign", {
            "description": "Reply with exactly: RESEARCHER_OK",
            "agent": "researcher",
        })
        assert t1["success"]
        assert "RESEARCHER_OK" in t1["data"]["result"]

        t2 = await handler("task_assign", {
            "description": "Reply with exactly: CODER_OK",
            "agent": "coder",
        })
        assert t2["success"]
        assert "CODER_OK" in t2["data"]["result"]

        # Clean up
        await handler("agent_stop", {"name": "researcher"})
        await handler("agent_stop", {"name": "coder"})

    @pytest.mark.asyncio
    async def test_agent_with_memory_round_trip(
        self,
        orchestrator: AgentOrchestrator,
        setup_llm,
    ):
        """Full round-trip: memory set → agent start → task → check status."""
        handler = build_command_handler(orchestrator)

        # Store some knowledge
        r = await handler("memory_set", {
            "key": "project/stack",
            "value": "Python 3.11, botcore, AFD, pytest",
            "scope": "team",
            "scope_id": "alpha-team",
        })
        assert r["success"]

        # Retrieve it
        r = await handler("memory_get", {
            "key": "project/stack",
            "scope": "team",
            "scope_id": "alpha-team",
        })
        assert r["success"]
        assert "botcore" in r["data"]["value"]

        # Start agent and run a task
        await handler("agent_create", {"name": "researcher"})
        await handler("agent_start", {"name": "researcher"})

        t = await handler("task_assign", {
            "description": "Reply with exactly: MEMORY_TEST_PASS",
            "agent": "researcher",
        })
        assert t["success"]
        assert "MEMORY_TEST_PASS" in t["data"]["result"]

        # Verify agent health
        s = await handler("agent_status", {"name": "researcher"})
        assert s["success"]
        assert s["data"]["tasks_completed"] == 1

        await handler("agent_stop", {"name": "researcher"})
