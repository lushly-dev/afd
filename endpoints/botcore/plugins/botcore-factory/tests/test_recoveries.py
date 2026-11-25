"""Every factory refusal carries a structured recovery (``spec/recovery.md``) that is true.

The jobs in ``test_scenarios.py`` assert each refusal's recovery and follow the ones a program can
take. This adds what a scenario cannot see: every refusal in the plugin sets one, a ``call``
names a command the factory serves and its prose names the same command, and a planted wrong
recovery fails the job that follows it.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest
from afd import Recovery
from afd.testing.scenarios import InProcessExecutor, InProcessExecutorConfig, parse_scenario
from botcore.context import ExecutionContext

from botcore_factory import cells
from botcore_factory.hosts import build_factory_host

SOURCE = Path(__file__).resolve().parents[1] / "src" / "botcore_factory"


def _refusals() -> list[tuple[str, int, ast.Call, ast.AST | None]]:
    """Every refusal in the plugin: each ``Refusal(code, message, suggestion)`` and each
    ``error(code, message, suggestion=...)``, with its suggestion. The gateway is a separate
    surface, and the scenario harness reports on fixtures, not on the factory."""
    found = []
    for path in sorted(SOURCE.rglob("*.py")):
        if "gateway" in path.relative_to(SOURCE).parts or path.name == "harness.py":
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.Call):
                continue
            name = getattr(node.func, "id", None)
            if name == "Refusal":
                suggestion = node.args[2] if len(node.args) >= 3 else None
            elif name == "error":
                suggestion = next((k.value for k in node.keywords if k.arg == "suggestion"), None)
            else:
                continue
            found.append((path.name, node.lineno, node, suggestion))
    return found


def _texts(node: ast.AST | None) -> list[str]:
    """The literal text of each suggestion a node can produce: each branch of a conditional
    on its own, so a command named in one branch does not cover the other."""
    if node is None:
        return [""]
    if isinstance(node, ast.IfExp):
        return _texts(node.body) + _texts(node.orelse)
    if isinstance(node, ast.BinOp):
        return [a + b for a in _texts(node.left) for b in _texts(node.right)]
    if isinstance(node, ast.JoinedStr):
        texts = [""]
        for value in node.values:
            parts = _texts(value.value) if isinstance(value, ast.FormattedValue) else _texts(value)
            texts = [a + b for a in texts for b in parts]
        return texts
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return [node.value]
    return [""]


def test_texts_reads_each_branch_on_its_own():
    source = 'f"Use one of: {x}" if close else "dial-get lists them"'
    branches = ast.parse(source, mode="eval").body
    assert _texts(branches) == ["Use one of: ", "dial-get lists them"]


@pytest.fixture(scope="module")
def served(tmp_path_factory) -> set[str]:
    host = build_factory_host(
        "factory", ExecutionContext(tmp_path_factory.mktemp("target"), profile="trusted-local")
    )
    return {name.replace("_", "-") for name in host.list_command_names()}


def test_every_refusal_carries_a_recovery():
    missing = [
        f"{file}:{line}"
        for file, line, node, _ in _refusals()
        if not any(keyword.arg == "recovery" for keyword in node.keywords)
    ]
    assert not missing, f"Give these refusals a recovery: {missing}"


def test_a_call_recovery_names_a_served_command_and_its_suggestion_names_it(served):
    wrong = []
    for file, line, node, suggestion in _refusals():
        recovery = next(k.value for k in node.keywords if k.arg == "recovery")
        if not (isinstance(recovery, ast.Call) and getattr(recovery.func, "id", None) == "call"):
            continue
        command = recovery.args[0].value  # type: ignore[attr-defined]
        if command not in served:
            wrong.append(f"{file}:{line} calls {command}, which no factory host serves")
        if any(command not in text for text in _texts(suggestion)):
            wrong.append(f"{file}:{line} calls {command}, which a suggestion it gives omits")
    assert not wrong, wrong


def test_the_scan_sees_refusals_returned_as_errors():
    codes = {
        node.args[0].value  # type: ignore[attr-defined]
        for _, _, node, _ in _refusals()
        if getattr(node.func, "id", None) == "error"
    }
    assert {"READ_FAILED", "STATE_LOCKED", "STATE_UNAVAILABLE"} <= codes


async def test_a_wrong_recovery_fails_the_job_that_follows_it(make_run, monkeypatch):
    """Job 14's refusal of a held issue, followed to issue-check, run by the Python runner.
    Planted to lane-status, a command that exists but answers something else, it fails."""

    async def outcome(recovery: Recovery | None, yaml: str) -> list[tuple[str, str, str]]:
        parsed = parse_scenario(yaml)
        assert parsed.success, parsed
        if recovery is not None:
            original = cells.Refusal.__init__

            def planted(self, code, message, suggestion, *, recovery=None, **details):
                if code == "ALREADY_CLAIMED":
                    recovery = planted.recovery
                original(self, code, message, suggestion, recovery=recovery, **details)

            planted.recovery = recovery  # type: ignore[attr-defined]
            monkeypatch.setattr(cells.Refusal, "__init__", planted)
        run = make_run("backlog")
        host = run.host()

        async def handler(command: str, arguments: dict | None):
            return await host.execute(command, arguments or {})

        config = InProcessExecutorConfig(handler=handler)
        result = await InProcessExecutor(config).execute(parsed.scenario)
        monkeypatch.undo()
        return [(step.command, step.outcome, _why(step)) for step in result.step_results]

    wrong = Recovery(kind="call", command="lane-status")
    assert await outcome(None, JOB_14_REFUSAL) == [("cell-register", "pass", "")]
    assert await outcome(wrong, JOB_14_REFUSAL) == [
        ("cell-register", "fail", "error.recovery.command")
    ]
    # Following alone catches it, with no assertion on the recovery's fields.
    unasserted = JOB_14_REFUSAL.replace(
        "        recovery: { kind: call, command: issue-check }\n", ""
    )
    assert "recovery:" not in unasserted
    assert await outcome(None, unasserted) == [("cell-register", "pass", "")]
    [(command, verdict, why)] = await outcome(wrong, unasserted)
    assert (command, verdict) == ("cell-register", "fail")
    assert why.startswith("follow: lane-status: "), why


def _why(step) -> str:
    """Why a step failed: its first failed assertion's path, or its error's message."""
    failed = [assertion.path for assertion in step.assertions if not assertion.passed]
    if failed:
        return failed[0]
    return step.error.message if step.error else ""


#: Job 14's third step, from 14-triage-the-backlog.scenario.yaml, run alone against the backlog
#: fixture: there the job's earlier steps have taken 206, so its follow expects [201]. The Python
#: runner cannot run the job whole: its first step matches list items partially, as only
#: TypeScript does (#2428).
JOB_14_REFUSAL = """
name: Refuse a held issue and follow the recovery
description: Job 14's refusal of an issue another cell holds
job: triage-the-backlog
steps:
  - command: cell-register
    input: { branch: fix/other-attempt, issues: [205], route: sol/high }
    expect:
      success: false
      error:
        code: ALREADY_CLAIMED
        recovery: { kind: call, command: issue-check }
    follow: { expect: { success: true, data: { dispatchable: [206, 201] } } }
"""
