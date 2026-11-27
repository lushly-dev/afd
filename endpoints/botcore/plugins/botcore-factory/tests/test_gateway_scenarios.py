"""The Factory Gateway's jobs, run through AFD's TypeScript scenario runner.

Each job runs against one route, named in its file's header ("Runs against the lane
endpoint"), over a fake GitHub built from its fixture. ``scenarios/run.mjs`` runs them with
the gateway's harness; it needs Node and the built runner, as the factory's jobs do.

Job 13's third step names the lane as its consumer; a scenario file runs against one route, so
it runs on the foreman's, which serves gateway-wait too. Which token reaches which route is the
unit tests' (test_gateway_routes.py).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import REPO_ROOT

GATEWAY = REPO_ROOT / "docs/features/active/factory-gateway/scenarios"
RUNNER = Path(__file__).resolve().parents[1] / "scenarios" / "run.mjs"

#: Each job and the route it runs against.
ROUTES = {
    "01-claim-once": "foreman",
    "02-free-a-silent-claim": "lane",
    "03-keep-cells-off-github-writes": "cell",
    "04-push-and-open-once": "lane",
    "05-merge-only-the-validated-head": "lane",
    "06-know-whether-it-merged": "cell",
    "07-trace-a-write-to-its-agent": "owner",
    "08-see-writes-outside-the-door": "owner",
    "09-never-file-or-say-it-twice": "lane",
    "10-restart-without-losing-a-claim": "foreman",
    "11-read-issue-text-as-content": "session",
    "12-show-the-review-as-a-check": "owner",
    "13-wake-on-what-happened": "foreman",
    "14-an-outage-is-a-stall": "lane",
    "15-hand-over-through-the-gateway": "cell",
    "16-see-a-stopped-lane": "lane",
    "17-file-an-epic-and-its-parts": "foreman",
}


def test_every_job_has_a_route():
    files = {path.name.split(".")[0] for path in GATEWAY.glob("*.scenario.yaml")}
    assert files == set(ROUTES)


@pytest.fixture(scope="module")
def results() -> dict:
    node = shutil.which("node")
    assert node, "Node is required to run the jobs through AFD's TypeScript scenario runner"
    files = [str(GATEWAY / f"{name}.scenario.yaml") for name in ROUTES]
    env = {
        **os.environ,
        "FACTORY_PYTHON": sys.executable,
        "FACTORY_HARNESS": "botcore_factory.gateway.harness",
        "FACTORY_SCENARIO_ENV": json.dumps(
            {f"{name}.scenario.yaml": {"GATEWAY_ROUTE": route} for name, route in ROUTES.items()}
        ),
    }
    done = subprocess.run(  # noqa: S603 - an argument list, no shell
        [node, str(RUNNER), *files],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=900,
        check=False,
    )
    assert done.returncode in (0, 1), done.stderr or done.stdout
    return {Path(s["file"]).name.split(".")[0]: s for s in json.loads(done.stdout)["scenarios"]}


@pytest.mark.parametrize("job", list(ROUTES))
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
