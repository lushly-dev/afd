"""The scenario harness: AFD's CLI contract over the ``factory`` host and a fixture world.

AFD's TypeScript scenario runner (``@lushly-dev/afd-testing``'s ``CliWrapper``) runs
``<cli> call <command> [<json>] --format json`` and reads one CommandResult as JSON::

    python -m botcore_factory.harness call issue-check '{}' --format json

``BOTCORE_FACTORY_HARNESS_DIR`` names one scenario run's directory: ``world.json`` is its
fixture world and ``state/`` its lane state. The target repository, whose adapter
(``[plugins.factory]``) the host reads, is ``BOTCORE_FACTORY_TARGET`` or the working directory.

``call fixture-apply {"fixture": {...}}`` starts a run from a fixture already merged over its
base: the world part becomes ``world.json`` and the lane-state part seeds the state. Every other
command is the factory host's, named in AFD's kebab-case (``issue-check``) or as the Python
function (``issue_check``). Never point this at a real repository's state: it is for fixtures.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
from pathlib import Path

from afd import CommandResult, error, success
from botcore.context import ExecutionContext

from botcore_factory.fixture_world import FixtureWorld, split_fixture
from botcore_factory.hosts import build_factory_host
from botcore_factory.state import LANE_DEFAULTS, StateStore

RUN_DIR_ENV = "BOTCORE_FACTORY_HARNESS_DIR"
TARGET_ENV = "BOTCORE_FACTORY_TARGET"
APPLY = "fixture-apply"


def _paths(run_dir: Path) -> tuple[Path, Path]:
    return run_dir / "world.json", run_dir / "state"


def apply_fixture(run_dir: Path, arguments: dict) -> CommandResult:
    """Write the run's world and seed its lane state from a merged fixture."""
    fixture = arguments.get("fixture")
    if not isinstance(fixture, dict):
        return error(
            "VALIDATION_ERROR",
            'fixture-apply takes {"fixture": {...}}, a fixture merged over its base',
            suggestion="Pass the merged fixture object as `fixture`",
        )
    try:
        world_part, state_part = split_fixture(fixture)
    except ValueError as exc:
        return error("VALIDATION_ERROR", str(exc), suggestion="Add the key to fixture_world")
    world_path, state_base = _paths(run_dir)
    shutil.rmtree(state_base, ignore_errors=True)
    world = FixtureWorld.create(world_path, world_part).world()
    store = StateStore.for_repository(
        world.github.repository(), world.processes, world.clock, base=state_base
    )
    with store.update(APPLY) as state:
        state.update(state_part)
        state["lane"] = {**LANE_DEFAULTS, **state_part.get("lane", {})}
    return success(
        {"world": sorted(world_part), "state": sorted(state_part)},
        reasoning=f"Applied a fixture to {run_dir}",
    )


def call(command: str, arguments: dict, run_dir: Path, target: Path) -> CommandResult:
    if command == APPLY:
        return apply_fixture(run_dir, arguments)
    world_path, state_base = _paths(run_dir)
    if not world_path.exists():
        return error(
            "NOT_FOUND",
            f"No fixture world in {run_dir}",
            suggestion=f"Call {APPLY} with the scenario's fixture first",
        )
    host = build_factory_host(
        "factory",
        ExecutionContext(target, profile="trusted-local"),
        world=FixtureWorld(world_path).world(),
        state_base=state_base,
    )
    return asyncio.run(host.execute(command.replace("-", "_"), arguments))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m botcore_factory.harness")
    verbs = parser.add_subparsers(dest="verb", required=True)
    invoke = verbs.add_parser("call", help="Call a factory command against the fixture world")
    invoke.add_argument("command")
    invoke.add_argument("arguments", nargs="?", default="{}")
    invoke.add_argument("--format", choices=["json"], default="json")
    options = parser.parse_args(argv)
    run_dir = os.environ.get(RUN_DIR_ENV)
    try:
        arguments = json.loads(options.arguments)
    except ValueError:
        arguments = None
    if not run_dir:
        result = error(
            "NOT_CONFIGURED",
            f"{RUN_DIR_ENV} is not set",
            suggestion="Set it to an empty directory for this scenario run",
        )
    elif not isinstance(arguments, dict):
        result = error(
            "VALIDATION_ERROR",
            "Arguments must be a JSON object",
            suggestion="Pass the command's input as one JSON object",
        )
    else:
        target = Path(os.environ.get(TARGET_ENV) or Path.cwd()).resolve()
        result = call(options.command, arguments, Path(run_dir), target)
    sys.stdout.write(json.dumps(result.model_dump(mode="json", exclude_none=True)) + "\n")
    return 0 if result.success else 1


if __name__ == "__main__":
    raise SystemExit(main())
