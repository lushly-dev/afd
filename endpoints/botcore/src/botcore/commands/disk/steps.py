"""A step of the scheduled job: work in a thread of its own, which the job can stop waiting for.

A read of a folder can wait for ever: for a drive that went away, or for the owner's answer
to a question the operating system put on the screen. macOS asks before a scheduled program
reads an external volume or the files a cloud drive's app manages, and holds the read until
someone answers. Nothing in Python ends such a read, so the job never makes one itself. It
runs each step in a thread and waits as long as it can afford; a thread that only waits holds
nothing the job needs, and goes with the process.

A step says what it is doing as it goes (`doing`). That is how the job tells a step that is
working from one that waits, and how it can say what a step was waiting for.
"""

from __future__ import annotations

import os
import sys
import threading
import time
import traceback
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

# thread -> (what it is doing, to which path, when it said so, how long that may take)
_NOW: dict[int, tuple[str, str, float, float]] = {}

# Everything said, for a test that checks the disk work says what it does; None otherwise
SAID: list[tuple[str, str]] | None = None

# The folders in a home folder that macOS asks about before a program reads them
PROTECTED_HOME = ("Desktop", "Documents", "Downloads")
CLOUD_HOME = ("Library/CloudStorage", "Library/Mobile Documents")


def doing(what: str, path: object = "", allow: float = 0.0) -> None:
    """Say what this thread is about to do, for whoever waits for it. Costs one dictionary
    write, so a walk can say it for every folder. `allow` is how long it may take without
    another word; `command` gives one to a command that has a timeout."""
    _NOW[threading.get_ident()] = (what, str(path), time.monotonic(), max(0.0, allow))
    if SAID is not None:
        SAID.append((what, str(path)))


@contextmanager
def command(what: str, path: object = "", allow: float = 0.0) -> Iterator[None]:
    """A command with a timeout of its own: it may take `allow` seconds without a word, and
    that allowance ends when it comes back. Without this a read that waits just after a
    command would pass for the command, for as long as the command was allowed."""
    doing(what, path, allow)
    try:
        yield
    finally:
        doing(f"working after {what}", path)


class Step:
    """Work started in a daemon thread. Whatever it returns or raises is kept in `outcome`."""

    def __init__(self, name: str, work: Callable[[], Any]) -> None:
        self.name = name
        self.outcome: dict[str, Any] = {}
        self._work = work
        self._thread = threading.Thread(target=self._run, name=name, daemon=True)
        self._thread.start()

    def _run(self) -> None:
        doing("starting")
        try:
            self.outcome["result"] = self._work()
        except BaseException as exc:  # noqa: BLE001 - the job must end whatever a step raises
            self.outcome["raised"] = exc
        finally:
            _NOW.pop(threading.get_ident(), None)

    @property
    def done(self) -> bool:
        return not self._thread.is_alive()

    def wait(self, seconds: float) -> bool:
        """Wait up to `seconds` for the step. Whether it is done."""
        self._thread.join(max(0.0, seconds))
        return self.done

    def now(self) -> tuple[str, str, float] | None:
        """What it is doing, to which path, and for how many seconds. None once it is done."""
        said = _NOW.get(self._thread.ident or 0)
        if said is None or self.done:
            return None
        what, path, at, _allow = said
        return what, path, time.monotonic() - at

    def quiet(self) -> float:
        """Seconds it has said nothing beyond what its last word allowed; 0 while it is
        within that, and once it is done."""
        said = _NOW.get(self._thread.ident or 0)
        if said is None or self.done:
            return 0.0
        _what, _path, at, allow = said
        return max(0.0, time.monotonic() - at - allow)

    def where(self) -> str:
        """The thread's stack as text, for the job's log."""
        frame = sys._current_frames().get(self._thread.ident or 0)  # noqa: SLF001
        return "".join(traceback.format_stack(frame)) if frame is not None else ""


def describe(said: tuple[str, str, float] | None) -> str:
    """`reading /Volumes/Dev/worktrees/a for 12 minutes`, from what a step last said."""
    if said is None:
        return "starting"
    what, path, seconds = said
    span = f"{seconds / 60:.0f} minutes" if seconds >= 90 else f"{seconds:.0f} seconds"
    return " ".join(part for part in (what, path, "for", span) if part)


def consent_hint(path: str, platform: str | None = None) -> str | None:
    """What to do when a read of `path` does not come back and macOS may be holding it for
    the owner's consent. None for a path macOS does not ask about, and on other systems."""
    if (platform or sys.platform) != "darwin" or not path:
        return None
    home = os.path.abspath(Path.home())
    full = os.path.abspath(path)

    def under(folder: str) -> bool:
        return full == folder or full.startswith(folder.rstrip("/") + "/")

    if under("/Volumes"):
        place = "an external or network volume"
    elif any(under(os.path.join(home, name)) for name in CLOUD_HOME):
        place = "files that a cloud drive's app manages"
    elif any(under(os.path.join(home, name)) for name in PROTECTED_HOME):
        place = "this folder"
    else:
        return None
    program = os.path.realpath(sys.executable)
    return (
        f"macOS asks at the screen before a scheduled program reads {place}: allow "
        f"{program} there (the question stays up while a run waits), or give it Full Disk "
        "Access under System Settings, Privacy & Security"
    )
