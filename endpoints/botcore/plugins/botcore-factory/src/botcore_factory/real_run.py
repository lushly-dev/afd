"""Starting processes: the only place the plugin does, always with an argument list.

On Windows the program is started by its resolved path (``shutil.which``), so ``gh`` is found
without a shell.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from botcore_factory.world import Completed, WorldError

Run = Callable[..., str]
DIAGNOSTIC_LIMIT = 4000  # Per stream; retain both the opening context and final refusal.


def diagnostics(output: str) -> str:
    output = output.strip()
    if len(output) <= DIAGNOSTIC_LIMIT:
        return output
    half = DIAGNOSTIC_LIMIT // 2
    return output[:half] + "\n... output omitted ...\n" + output[-half:]


def resolve_program(program: str, path: str | None = None) -> str:
    """The program's full path, so Windows starts ``gh.exe`` without a shell; ``path`` is the
    search path when it is not this process's ``PATH``."""
    found = shutil.which(program, path=path)
    if not found:
        raise WorldError(f"{program} is not on PATH")
    return found


def path_env(path: Sequence[str]) -> dict[str, str] | None:
    """This process's environment with ``path`` (directories) before its ``PATH``; None when
    ``path`` is empty, so the environment is inherited as it is."""
    if not path:
        return None
    env = dict(os.environ)
    env["PATH"] = os.pathsep.join([*path, env.get("PATH", "")])
    return env


def run_process(
    args: Sequence[str],
    *,
    cwd: str | None = None,
    stdin: str | None = None,
    timeout: float | None = 60,
    env: Mapping[str, str] | None = None,
) -> Completed:
    """Run an argument list and capture its output. Never a shell. With ``env``, the program is
    found on its ``PATH``, and it runs with that environment.

    ``stdin`` goes as UTF-8 bytes, so its line endings arrive as written: a text-mode pipe
    turns each ``\\n`` into ``\\r\\n`` on Windows, which would reach a commit message or a blob.
    Output is read with universal newlines, as text mode reads it."""
    argv = [resolve_program(args[0], env.get("PATH") if env else None), *args[1:]]
    try:
        done = subprocess.run(  # noqa: S603 - an argument list, resolved program, no shell
            argv,
            cwd=cwd,
            env=env,
            input=None if stdin is None else stdin.encode("utf-8"),
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise WorldError(f"{args[0]} could not run: {exc}") from exc
    return Completed(tuple(args), done.returncode, _text(done.stdout), _text(done.stderr))


def _text(output: bytes) -> str:
    return output.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n")


def make_runner(cwd: str) -> Run:
    """A ``run(args, stdin=None, check=True, env=None)`` returning stdout, raising WorldError on
    a nonzero exit unless ``check`` is false. ``env`` is laid over this process's environment
    for that one command."""

    def run(
        args: Sequence[str],
        stdin: str | None = None,
        check: bool = True,
        env: Mapping[str, str] | None = None,
    ) -> str:
        merged = None if env is None else {**os.environ, **env}
        done = run_process(args, cwd=cwd, stdin=stdin, env=merged)
        if check and done.returncode != 0:
            detail = "\n".join(filter(None, (diagnostics(done.stderr), diagnostics(done.stdout))))
            command = " ".join(args[:3])[:200]
            raise WorldError(f"{command} failed: {detail or done.returncode}")
        return done.stdout

    return run


def parse_json(text: str, what: str) -> Any:
    try:
        return json.loads(text)
    except ValueError as exc:
        raise WorldError(f"{what} returned something that is not JSON") from exc
