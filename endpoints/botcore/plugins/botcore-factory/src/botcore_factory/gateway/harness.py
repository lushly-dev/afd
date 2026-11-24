"""The gateway's scenario harness: AFD's CLI contract over one route and a fake GitHub.

AFD's TypeScript scenario runner calls ``<cli> call <command> [<json>] --format json`` and
reads one CommandResult::

    python -m botcore_factory.gateway.harness call issue-claim '{...}' --format json

``GATEWAY_HARNESS_DIR`` names one scenario run's directory (``github.json``, ``config.json``
and ``state/``); ``GATEWAY_ROUTE`` the route (default ``owner``). The caller is the route's
test actor (``ROUTE_ACTORS``), since a scenario cannot hold a token.

``call fixture-apply {"fixture": {...}}`` starts a run from a fixture merged over its base.
Never point this at a real gateway's data: it is for fixtures.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from afd import Actor, CommandResult, error, success
from afd.core.commands import CommandContext
from botcore.context import ExecutionContext
from botcore.host import CommandHost

from botcore_factory.gateway.config import GatewayConfig
from botcore_factory.gateway.github import GITHUB_KEYS, FakeGitHub, fake_world
from botcore_factory.gateway.hosts import build_gateway_host
from botcore_factory.gateway.state import STATE_KEYS, GatewayState

RUN_DIR_ENV = "GATEWAY_HARNESS_DIR"
ROUTE_ENV = "GATEWAY_ROUTE"
APPLY = "fixture-apply"
IGNORED_KEYS = {"$comment"}
#: Who each route's calls are made as in a scenario, as a token would name them.
ROUTE_ACTORS = {
    "cell": Actor(kind="agent", id="cell-3"),
    "session": Actor(kind="agent", id="session@workstation"),
    "foreman": Actor(kind="agent", id="foreman"),
    "lane": Actor(kind="service", id="lane@workstation"),
    "owner": Actor(kind="human", id="owner"),
    "heartbeat": Actor(kind="service", id="lane-heartbeat@workstation"),
}
_CONFIG_KEYS = set(GatewayConfig.model_fields) | {
    field.alias for field in GatewayConfig.model_fields.values() if field.alias
}


def apply_fixture(run_dir: Path, arguments: dict[str, Any]) -> CommandResult[Any]:
    fixture = arguments.get("fixture")
    if not isinstance(fixture, dict):
        return error(
            "VALIDATION_ERROR",
            'fixture-apply takes {"fixture": {...}}, a fixture merged over its base',
            suggestion="Pass the merged fixture object as `fixture`",
        )
    unknown = set(fixture) - GITHUB_KEYS - STATE_KEYS - _CONFIG_KEYS - IGNORED_KEYS
    if unknown:
        return error(
            "VALIDATION_ERROR",
            f"Fixture keys the gateway harness does not know: {', '.join(sorted(unknown))}",
            suggestion="Add the key to the harness's GitHub, state or config keys",
        )
    config = GatewayConfig(
        **{
            k: v
            for k, v in fixture.items()
            if k in _CONFIG_KEYS and not (k == "journal" and isinstance(v, list))
        }
    )
    shutil.rmtree(run_dir, ignore_errors=True)
    run_dir.mkdir(parents=True)
    world = fake_world(fixture, config.repositories[0])
    (run_dir / "github.json").write_text(json.dumps(world, indent=2), encoding="utf-8")
    (run_dir / "config.json").write_text(config.model_dump_json(by_alias=True), encoding="utf-8")
    GatewayState.seed(run_dir / "state", fixture)
    return success({"applied": sorted(fixture)}, reasoning=f"Applied a fixture to {run_dir}")


def host_for(run_dir: Path, route: str) -> CommandHost:
    config = GatewayConfig.model_validate_json((run_dir / "config.json").read_text("utf-8"))
    return build_gateway_host(
        route,
        ExecutionContext(run_dir / "state", profile="remote-caller"),
        github=FakeGitHub(run_dir / "github.json", bot=config.bot),
        config=config,
        state=GatewayState(run_dir / "state"),
        actor=ROUTE_ACTORS[route],
    )


def call(command: str, arguments: dict[str, Any], run_dir: Path, route: str) -> CommandResult[Any]:
    if command == APPLY:
        return apply_fixture(run_dir, arguments)
    if not (run_dir / "config.json").exists():
        return error(
            "NOT_FOUND",
            f"No fixture in {run_dir}",
            suggestion=f"Call {APPLY} with the scenario's fixture first",
        )
    host = host_for(run_dir, route)
    # The fixture's clock, so the journal and the gateway agree on the time.
    now = json.loads((run_dir / "github.json").read_text("utf-8")).get("now")
    clock = _FixedClock(now) if now else None
    context = CommandContext(actor=ROUTE_ACTORS[route], clock=clock)
    return asyncio.run(host.execute(command, arguments, context))


class _FixedClock:
    def __init__(self, at: str) -> None:
        moment = datetime.fromisoformat(at.replace("Z", "+00:00"))
        self._ms = moment.timestamp() * 1000

    def now(self) -> float:
        return self._ms


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m botcore_factory.gateway.harness")
    verbs = parser.add_subparsers(dest="verb", required=True)
    invoke = verbs.add_parser("call", help="Call a gateway command against the fake GitHub")
    invoke.add_argument("command")
    invoke.add_argument("arguments", nargs="?", default="{}")
    invoke.add_argument("--format", choices=["json"], default="json")
    options = parser.parse_args(argv)
    run_dir = os.environ.get(RUN_DIR_ENV)
    route = os.environ.get(ROUTE_ENV, "owner")
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
    elif route not in ROUTE_ACTORS:
        result = error(
            "NOT_CONFIGURED",
            f"{ROUTE_ENV} is {route!r}",
            suggestion=f"Use one of: {', '.join(ROUTE_ACTORS)}",
        )
    elif not isinstance(arguments, dict):
        result = error(
            "VALIDATION_ERROR",
            "Arguments must be a JSON object",
            suggestion="Pass the command's input as one JSON object",
        )
    else:
        result = call(options.command, arguments, Path(run_dir), route)
    sys.stdout.write(json.dumps(result.model_dump(mode="json", exclude_none=True)) + "\n")
    return 0 if result.success else 1


if __name__ == "__main__":
    raise SystemExit(main())
