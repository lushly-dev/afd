"""The proposal's jobs, run through AFD's TypeScript scenario runner.

``scenarios/run.mjs`` runs each job with ``@lushly-dev/afd-testing``'s ScenarioExecutor, which
calls the factory host through the harness CLI, with this interpreter. It needs Node and the
built runner (``pnpm install --frozen-lockfile && pnpm -F "@lushly-dev/afd-testing..." build``);
without them this test fails rather than skips, since the jobs are the plugin's contract.

Add a job to ``JOBS`` when the commands it calls land. Every step must pass: where a scenario
and the proposal disagree, settle it in the scenario or the proposal, not here.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import REPO_ROOT, SCENARIOS

RUNNER = Path(__file__).resolve().parents[1] / "scenarios" / "run.mjs"

JOBS = ["14-triage-the-backlog"]


def run_jobs(names: list[str]) -> dict:
    node = shutil.which("node")
    assert node, "Node is required to run the jobs through AFD's TypeScript scenario runner"
    files = [str(SCENARIOS / f"{name}.scenario.yaml") for name in names]
    done = subprocess.run(  # noqa: S603 - an argument list, no shell
        [node, str(RUNNER), *files],
        cwd=REPO_ROOT,
        env={**os.environ, "FACTORY_PYTHON": sys.executable},
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=600,
        check=False,
    )
    assert done.returncode in (0, 1), done.stderr or done.stdout
    return {Path(s["file"]).name.split(".")[0]: s for s in json.loads(done.stdout)["scenarios"]}


@pytest.fixture(scope="module")
def results() -> dict:
    return run_jobs(JOBS)


@pytest.mark.parametrize("job", JOBS)
def test_job(results, job):
    scenario = results[job]
    assert not scenario.get("error"), scenario["error"]
    problems = [
        (
            step["index"],
            step["command"],
            step.get("error"),
            [f["description"] for f in step["failed"]],
        )
        for step in scenario["steps"]
        if step["outcome"] != "pass"
    ]
    assert not problems, problems
    assert scenario["outcome"] == "pass"
