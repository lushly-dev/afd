"""The factory's command lines: ``factory`` (foreman and owner) and ``factory-cell`` (cells).

Each is botcore's host CLI over the real world, for the repository checkout it is run in::

    factory call lane-status
    factory-cell call lane-enqueue '{"worktree": "."}'

``catalog`` lists the host's commands with their inputs; ``call`` prints one CommandResult as JSON
and exits 1 on a refusal. The checkout is ``BOTCORE_FACTORY_TARGET`` or the git checkout around the
working directory. The lane's state is keyed by repository in the user's data directory, so a
cell's worktree and the primary checkout on one machine see the same lane. There is no client
time limit: ``lane-enqueue`` runs the cheap checks and ``lane-wait`` may wait as long as it is told.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from botcore.context import ExecutionContext
from botcore.host_surfaces import create_host_cli

from botcore_factory.hosts import build_factory_host

TARGET_ENV = "BOTCORE_FACTORY_TARGET"


def checkout(cwd: Path | None = None) -> Path:
    """The repository the host serves: ``BOTCORE_FACTORY_TARGET``, else the enclosing checkout."""
    named = os.environ.get(TARGET_ENV)
    if named:
        return Path(named).resolve()
    here = (cwd or Path.cwd()).resolve()
    try:
        top = subprocess.run(  # noqa: S603 - fixed argument list, no shell
            ["git", "rev-parse", "--show-toplevel"],  # noqa: S607
            cwd=here,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return here
    return Path(top).resolve() if top else here


def _main(name: str) -> None:
    host = build_factory_host(name, ExecutionContext(checkout(), profile="trusted-local"))
    create_host_cli(host)(prog_name=name)


def factory_cli() -> None:
    """``factory``: every command, for the foreman and the owner."""
    _main("factory")


def cell_cli() -> None:
    """``factory-cell``: what a cell may call (lane-status, issue-check, lane-enqueue)."""
    _main("factory-cell")
