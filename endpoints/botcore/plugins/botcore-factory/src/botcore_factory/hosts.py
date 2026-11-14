"""The two hosts the factory plugin builds.

botcore's host gates by profile, not by caller, so callers are separated by host: cells get
``factory-cell``, the foreman and the owner get ``factory``.
"""

from __future__ import annotations

from pathlib import Path

from botcore.context import ExecutionContext
from botcore.host import CommandHost, build_host

from botcore_factory.runtime import bind
from botcore_factory.world import World

#: What a cell may call. The lane-handoff commands join as they land.
CELL_COMMANDS = ("issue_check", "lane_enqueue", "lane_status")
HOSTS = ("factory", "factory-cell")


def build_factory_host(
    name: str,
    context: ExecutionContext,
    *,
    world: World | None = None,
    state_base: Path | None = None,
) -> CommandHost:
    """Build ``factory`` (every command) or ``factory-cell`` (a cell's commands).

    ``world`` replaces the real world (GitHub, git, clock, machine, plans, processes) and
    ``state_base`` the lane's data directory, for tests and the scenario harness.
    """
    if name not in HOSTS:
        raise ValueError(f"Unknown factory host {name!r}; use one of: {', '.join(HOSTS)}")
    with bind(world, state_base):
        full = build_host(name, context, plugins=("factory",), core_commands=())
    if name == "factory":
        return full
    cell = CommandHost(name, context)
    for command in CELL_COMMANDS:
        cell.register(command, full._commands[command], full._policies[command])
    cell.docs, cell.middleware = full.docs, full.middleware
    return cell
