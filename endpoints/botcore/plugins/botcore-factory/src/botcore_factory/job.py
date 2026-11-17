"""A lane job: steps run in order in a slot, until one fails.

``python -m botcore_factory.job '<spec>'``, where the spec is JSON:
``{"steps": [{"label": "install", "args": [...], "timeout": 1800}, {"label": "validate", ...}]}``.
Each step is an argument list (never a shell string) whose output goes to this process's own
output, the job's log. A step's ``path`` (directories) goes before ``PATH`` for that step, so it
runs on the Node the checkout's ``.nvmrc`` names. A failed step ends the job with one last line
naming it::

    botcore-factory-job: {"failed": "install", "code": 1, "timedOut": false}

and the job exits with the step's code (124 when it timed out; its process tree is killed).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

from botcore_factory.real_run import resolve_program
from botcore_factory.real_system import kill_tree, new_group
from botcore_factory.world import WorldError

MARKER = "botcore-factory-job: "
TIMED_OUT = 124
NOT_FOUND = 127


def run_step(step: dict) -> tuple[int, bool]:
    """Run one step; its exit code and whether it timed out."""
    env = None
    if step.get("path"):
        env = dict(os.environ)
        env["PATH"] = os.pathsep.join([*step["path"], env.get("PATH", "")])
    try:
        program = resolve_program(step["args"][0], env["PATH"] if env else None)
    except WorldError as exc:
        print(str(exc), flush=True)
        return NOT_FOUND, False
    argv = [program, *step["args"][1:]]
    child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, env=env, **new_group())  # noqa: S603
    try:
        return child.wait(timeout=step.get("timeout")), False
    except subprocess.TimeoutExpired:
        kill_tree(child.pid)
        child.wait()
        return TIMED_OUT, True


def main(argv: list[str] | None = None) -> int:
    spec = json.loads((argv if argv is not None else sys.argv[1:])[0])
    for step in spec["steps"]:
        code, timed_out = run_step(step)
        if code != 0:
            failure = {"failed": step["label"], "code": code, "timedOut": timed_out}
            print(MARKER + json.dumps(failure), flush=True)
            return code
    return 0


def failure(tail: str) -> dict | None:
    """The failed step a job's log names, if any."""
    for line in reversed(tail.splitlines()):
        if line.startswith(MARKER):
            try:
                return json.loads(line[len(MARKER) :])
            except ValueError:
                return None
    return None


if __name__ == "__main__":
    raise SystemExit(main())
