"""The factory's command lines: ``factory`` (foreman and owner) and ``factory-cell`` (cells).

Each is botcore's host CLI over the real world, for the repository checkout it is run in::

    factory call lane-status
    factory-cell call lane-enqueue '{"worktree": "."}'

``catalog`` lists the host's commands with their inputs; ``call`` prints one CommandResult as JSON
and exits 1 on a refusal. ``call <command> --args-file <path>`` reads the JSON from a file instead,
for shells that strip quotes (Windows PowerShell 5.1). A relative ``worktree`` argument is made
absolute against the working directory before the call, so the lane, which runs elsewhere, can
find it later. The checkout is ``BOTCORE_FACTORY_TARGET`` or the git checkout around the
working directory. The lane's state is keyed by repository in the user's data directory, so a
cell's worktree and the primary checkout on one machine see the same lane. There is no client
time limit: ``lane-enqueue`` runs the cheap checks and ``lane-wait`` may wait as long as it is told.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from collections.abc import Sequence
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


def prepare(argv: Sequence[str], cwd: Path | None = None) -> list[str]:
    """``call``'s arguments as the host CLI takes them: ``--args-file`` read, ``worktree`` absolute.

    Anything this cannot read is passed on unchanged, so the host CLI reports it.
    """
    argv = list(argv)
    if len(argv) < 2 or argv[0] != "call":
        return argv
    rest = argv[2:]
    if rest[:1] == ["--args-file"] and len(rest) == 2:
        try:
            text = Path(rest[1]).read_text(encoding="utf-8-sig")
        except (OSError, UnicodeDecodeError) as exc:
            raise SystemExit(
                f"{argv[1]}: cannot read --args-file {rest[1]} as UTF-8: {exc}. "
                "In PowerShell, write it with Set-Content -Encoding utf8"
            ) from exc
    elif len(rest) <= 1:
        text = rest[0] if rest else "{}"
    else:
        return argv
    try:
        arguments = json.loads(text)
    except ValueError:
        return [*argv[:2], text]
    worktree = arguments.get("worktree") if isinstance(arguments, dict) else None
    if isinstance(worktree, str) and worktree and not Path(worktree).is_absolute():
        arguments["worktree"] = str(((cwd or Path.cwd()) / worktree).resolve())
    return [*argv[:2], json.dumps(arguments)]


def _main(name: str, argv: Sequence[str] | None = None) -> None:
    host = build_factory_host(name, ExecutionContext(checkout(), profile="trusted-local"))
    args = prepare(list(sys.argv[1:] if argv is None else argv))
    create_host_cli(host)(args=args, prog_name=name)


def factory_cli() -> None:
    """``factory``: every command, for the foreman and the owner."""
    _main("factory")


def cell_cli() -> None:
    """``factory-cell``: what a cell may call (lane-status, issue-check, lane-enqueue)."""
    _main("factory-cell")
