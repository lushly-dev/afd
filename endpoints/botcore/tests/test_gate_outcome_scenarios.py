"""The test effectiveness plan's jobs for the gate outcome commands, run through AFD's
TypeScript scenario runner.

`tests/scenarios/gate_outcome/run.mjs` runs each scenario file, where the plan keeps it, over a
prepared repository, recorded invented GitHub answers and a temporary record (the harness and
its worlds are beside it). It needs Node and the built runner (`pnpm -F
"@lushly-dev/afd-testing..." build`), as the factory plugin's jobs do.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
PLAN = ROOT / "docs/features/active/test-effectiveness/scenarios"
RUNNER = Path(__file__).resolve().parent / "scenarios" / "gate_outcome" / "run.mjs"
JOBS = ("01-see-what-ran-and-what-failed", "03-never-a-silent-zero")
#: Steps (by index) a later piece builds, with that piece. Each must fail until it is built,
#: and this test fails once one passes, so the entry is removed with the piece that builds it.
WAITING = {
    "03-never-a-silent-zero": {
        2: "#2483: gate-outcome-collect reads the main source",
        3: "#2483: the report's coverage of the main source that step 3 collects",
        5: "#2483: the report by area",
    },
}


@pytest.fixture(scope="module")
def results() -> dict:
    node = shutil.which("node")
    assert node, "Node is required to run the jobs through AFD's TypeScript scenario runner"
    files = [str(PLAN / f"{name}.scenario.yaml") for name in JOBS]
    done = subprocess.run(  # noqa: S603 - an argument list, no shell
        [node, str(RUNNER), *files],
        cwd=ROOT,
        env={**os.environ, "GATE_OUTCOME_PYTHON": sys.executable},
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=600,
        check=False,
    )
    assert done.returncode in (0, 1), done.stderr or done.stdout
    return {Path(s["file"]).name.split(".")[0]: s for s in json.loads(done.stdout)["scenarios"]}


def test_every_job_of_the_built_pieces_runs() -> None:
    names = {path.name.split(".")[0] for path in PLAN.glob("*.scenario.yaml")}
    assert set(JOBS) <= names


@pytest.mark.parametrize("job", JOBS)
def test_job(results: dict, job: str) -> None:
    scenario = results[job]
    assert not scenario.get("error"), scenario["error"]
    waiting = WAITING.get(job, {})
    problems = [
        (
            step["index"],
            step["command"],
            step.get("error"),
            [f["description"] for f in step["failed"]],
        )
        for step in scenario["steps"]
        if step["outcome"] != "pass" and step["index"] not in waiting
    ]
    assert not problems, problems
    built = [
        f"step {step['index']} passes: remove it from WAITING ({waiting[step['index']]})"
        for step in scenario["steps"]
        if step["outcome"] == "pass" and step["index"] in waiting
    ]
    assert not built, built
    assert len(scenario["steps"]) > max(waiting, default=-1)
