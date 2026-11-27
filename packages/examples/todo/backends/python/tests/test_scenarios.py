"""The TypeScript backend's jobs (``backends/typescript/scenarios``) run against this backend
in-process with ``afd.testing``'s scenario runner, through the server's own middleware
(approvals and the change history), with a fixed clock and seeded random, on every store kind.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from afd import fixed_clock, seeded_random
from afd.core.commands import CommandContext
from afd.testing import InProcessExecutor, InProcessExecutorConfig, parse_scenario_file

from todo_backend import create_app
from todo_backend.store import EXAMPLE_ROOT

SCENARIOS = EXAMPLE_ROOT / "backends" / "typescript" / "scenarios"

ACTIVE_CONTEXT = {"review-with-reading-commands": "todo-reading"}
"""Jobs that run inside a context, entered first as an MCP client would."""

NOT_HERE = {
    "07-replay-a-session.scenario.yaml": (
        "Job 7 is replaying a journal, which this backend does not record (the TypeScript "
        "backend's TODO_JOURNAL)"
    ),
}

NOT_YET = {
    "10-know-before-repeating.scenario.yaml": (
        "Job 10 (know-before-repeating, job 4 of the idempotency keys proposal) reads each "
        "command's idempotency in afd-help, which Python's afd does not report yet "
        "(https://github.com/lushly-dev/afd/issues/2676)"
    ),
}
"""Jobs expected to fail here until Python implements what they check; strict, so each fails
once it passes and the entry must go."""


def scenario_files() -> list[Path]:
    return sorted(SCENARIOS.glob("*.scenario.yaml"))


def test_has_the_jobs():
    assert len(scenario_files()) >= 8


@pytest.mark.parametrize("path", scenario_files(), ids=lambda path: path.name)
async def test_job(path: Path, store, request: pytest.FixtureRequest):
    if path.name in NOT_HERE:
        pytest.skip(NOT_HERE[path.name])
    if path.name in NOT_YET:
        request.applymarker(pytest.mark.xfail(strict=True, reason=NOT_YET[path.name]))
    parsed = parse_scenario_file(str(path))
    assert parsed.success, getattr(parsed, "error", None)

    server = create_app(store, {"APPROVALS": "agents"})
    context = ACTIVE_CONTEXT.get(parsed.scenario.job)
    if context:
        entered = await server.execute("afd-context-enter", {"context": context})
        assert entered.success

    async def handler(command, input, context=None):
        return await server.execute(command, input or {}, context)

    executor = InProcessExecutor(
        InProcessExecutorConfig(
            handler=handler,
            context=CommandContext(
                clock=fixed_clock("2026-11-15T09:00:00Z"), random=seeded_random(path.name)
            ),
        )
    )
    result = await executor.execute(parsed.scenario)

    failures = [
        (step.step_id, step.error.message if step.error else None)
        for step in result.step_results
        if step.outcome != "pass"
    ]
    assert failures == []
    assert result.outcome == "pass"
