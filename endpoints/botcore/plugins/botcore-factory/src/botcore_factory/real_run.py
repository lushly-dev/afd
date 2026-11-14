"""Starting processes: the only place the plugin does, always with an argument list.

On Windows the program is started by its resolved path (``shutil.which``), so ``gh`` is found
without a shell.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from collections.abc import Callable, Sequence

from botcore_factory.world import Completed, WorldError

Run = Callable[..., str]


def resolve_program(program: str) -> str:
    """The program's full path, so Windows starts ``gh.exe`` without a shell."""
    found = shutil.which(program)
    if not found:
        raise WorldError(f"{program} is not on PATH")
    return found


def run_process(
    args: Sequence[str],
    *,
    cwd: str | None = None,
    stdin: str | None = None,
    timeout: float | None = 60,
) -> Completed:
    """Run an argument list and capture its output. Never a shell."""
    argv = [resolve_program(args[0]), *args[1:]]
    try:
        done = subprocess.run(  # noqa: S603 - an argument list, resolved program, no shell
            argv,
            cwd=cwd,
            input=stdin,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise WorldError(f"{args[0]} could not run: {exc}") from exc
    return Completed(tuple(args), done.returncode, done.stdout, done.stderr)


def make_runner(cwd: str) -> Run:
    """A ``run(args, stdin=None, check=True)`` returning stdout, raising WorldError on a nonzero
    exit unless ``check`` is false."""

    def run(args: Sequence[str], stdin: str | None = None, check: bool = True) -> str:
        done = run_process(args, cwd=cwd, stdin=stdin)
        if check and done.returncode != 0:
            detail = (done.stderr or done.stdout).strip().splitlines()
            raise WorldError(
                f"{' '.join(args[:3])} failed: {detail[0] if detail else done.returncode}"
            )
        return done.stdout

    return run


def parse_json(text: str, what: str):
    try:
        return json.loads(text)
    except ValueError as exc:
        raise WorldError(f"{what} returned something that is not JSON") from exc
