"""The detached lane process ``lane-start`` starts: ``python -m botcore_factory.lane_main``.

It builds the ``factory`` host for the target checkout (its adapter, the real world) and runs
``lane_run`` until the lane is asked to stop. With ``--log`` (``lane-start`` passes
``lane.log`` in the lane's state directory) it appends its own output to that file, whatever
started it, and the lane records the file so a ``lane-stopped`` event names it; a scheduled task
can run this module directly with ``--log`` instead of redirecting its output elsewhere.

On Windows the lane ignores console control events: a step it runs, or the host, may send
Ctrl+C or Ctrl+Break to every process on its console, which killed the lane mid-merge
(lushly-dev/afd#2836). Ctrl+C is ignored by the lane and every process it starts; Ctrl+Break,
which nothing can make a child ignore, is answered by the lane's handler, and each one is
written to its output, to find the sender. A console that closes still ends the lane, once the
handler has noted it. The lane stops on ``lane-stop`` (and its steps by ``taskkill``), which
this does not affect.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import os
import sys
from pathlib import Path

from botcore.context import ExecutionContext

from botcore_factory.hosts import build_factory_host
from botcore_factory.lane_process import LANE_LOG_ENV

#: Console control events the lane's handler answers, by type: CTRL_BREAK_EVENT, and
#: CTRL_CLOSE_EVENT, which Windows ends the process after anyway (the note says it came).
#: CTRL_C_EVENT never reaches it: the lane and its children ignore Ctrl+C outright.
CONTROL_EVENTS = {0: "Ctrl+C", 1: "Ctrl+Break", 2: "close"}
_handler: object = None  # Kept alive: Windows calls it for as long as the lane runs.


def ignore_console_interrupt() -> bool:
    """On Windows, let no console control event end this process: Ctrl+C is ignored here and
    in every process it starts (they inherit that, the git and gh calls of a merge among them),
    and a handler answers Ctrl+Break and close, writing each to stderr. True when both were
    set."""
    global _handler
    if sys.platform != "win32":
        return False
    import ctypes
    from ctypes import wintypes

    def handled(event: int) -> bool:
        if event not in CONTROL_EVENTS:
            return False  # Logoff and shutdown go to the default handler.
        with contextlib.suppress(OSError):
            note = f"botcore-factory lane: ignored console control event {event}"
            os.write(2, f"{note} ({CONTROL_EVENTS[event]})\n".encode())
        return True

    kernel32 = ctypes.windll.kernel32
    _handler = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)(handled)
    return bool(kernel32.SetConsoleCtrlHandler(None, True)) and bool(
        kernel32.SetConsoleCtrlHandler(_handler, True)
    )


def log_to(path: Path) -> None:
    """Append this process's stdout and stderr, and its children's, to ``path``."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    for stream in (sys.stdout, sys.stderr):
        if stream is not None:  # None under pythonw or a launcher with no standard handles.
            with contextlib.suppress(OSError, ValueError):
                stream.flush()
    for target in (1, 2):
        if fd != target:  # A closed stdio fd is the one os.open reuses.
            os.dup2(fd, target)
    if fd not in (1, 2):
        os.close(fd)
    sys.stdout = open(1, "w", encoding="utf-8", buffering=1, closefd=False)  # noqa: SIM115
    sys.stderr = open(2, "w", encoding="utf-8", buffering=1, closefd=False)  # noqa: SIM115
    os.environ[LANE_LOG_ENV] = str(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m botcore_factory.lane_main")
    parser.add_argument("--target", required=True, help="The repository checkout")
    parser.add_argument("--log", help="Append the lane's output to this file and record it")
    options = parser.parse_args(argv)
    ignore_console_interrupt()
    if options.log:
        log_to(Path(options.log).resolve())
    else:
        os.environ.pop(LANE_LOG_ENV, None)
    host = build_factory_host(
        "factory", ExecutionContext(Path(options.target).resolve(), profile="trusted-local")
    )
    result = asyncio.run(host.execute("lane_run", {}))
    sys.stdout.write(json.dumps(result.model_dump(mode="json", exclude_none=True)) + "\n")
    return 0 if result.success else 1


if __name__ == "__main__":
    raise SystemExit(main())
