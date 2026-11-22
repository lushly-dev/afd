"""A step of the scheduled job: work in a thread of its own, which the job can stop waiting for.

A read of a folder can wait for ever: for a drive that went away, or for the owner's answer
to a question the operating system put on the screen. macOS asks before a scheduled program
reads an external volume or the files a cloud drive's app manages, and holds the read until
someone answers. Nothing in Python ends such a read, so the job never makes one itself. It
runs each step in a thread and waits for it while it works; a thread that only waits holds
nothing the job needs, and goes with the process.

A step says what it is doing as it goes (`doing`). That is how the job tells a step that is
working from one that waits, and how it can say what a step was waiting for. It is also where
a step the job has left stops: at its next word it is told so (`Left`), and starts nothing
more. A read the system still holds cannot be told anything; it is told when it comes back.
"""

from __future__ import annotations

import os
import sys
import threading
import time
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from pathlib import Path
from types import FrameType, TracebackType
from typing import Any, TypeVar

T = TypeVar("T")

# thread -> (what it is doing, to which path, when it said so, how long that may take)
_NOW: dict[int, tuple[str, str, float, float]] = {}
# the threads of steps the job has left: each stops at its next word
_LEFT: set[int] = set()

# Everything said, for a test that checks the disk work says what it does; None otherwise
SAID: list[tuple[str, str]] | None = None

# The program macOS names when it asks: found once, while everything still answers
PROGRAM = os.path.realpath(sys.executable)
# The folders in a home folder that macOS asks about before a program reads them
PROTECTED_HOME = ("Desktop", "Documents", "Downloads")
CLOUD_HOME = ("Library/CloudStorage", "Library/Mobile Documents")


class Left(BaseException):
    """Raised in a step the job has left, at the step's next word. Not an Exception: no
    handler in the work mistakes it for a failure of the thing it was about to do."""


def doing(what: str, path: object = "", allow: float = 0.0) -> None:
    """Say what this thread is about to do, for whoever waits for it. Costs one dictionary
    write, so a walk can say it for every folder and file. `allow` is how long it may take
    without another word; `command` gives one to a command that has a timeout.

    In a step the job has left, this raises `Left` instead: the thing is not begun."""
    ident = threading.get_ident()
    if ident in _LEFT:
        raise Left(what)
    _NOW[ident] = (what, str(path), time.monotonic(), max(0.0, allow))
    if SAID is not None:
        SAID.append((what, str(path)))


def each(what: str, path: object, entries: Iterable[T]) -> Iterator[T]:
    """`entries` as they arrive, with a word for each: listing a folder of very many is
    work, and a listing that waits says nothing."""
    for entry in entries:
        doing(what, path)
        yield entry


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
        # a thread is given a number another had: what that one said last is not this step's
        self._since = time.monotonic()
        self._thread = threading.Thread(target=self._run, name=name, daemon=True)
        self._thread.start()

    def _said(self) -> tuple[str, str, float, float] | None:
        said = _NOW.get(self._thread.ident or 0)
        if said is None or self.done or said[2] < self._since:
            return None
        return said

    def _run(self) -> None:
        doing("starting")
        try:
            self.outcome["result"] = self._work()
        except BaseException as exc:  # noqa: BLE001 - the job must end whatever a step raises
            self.outcome["raised"] = exc
        finally:
            _NOW.pop(threading.get_ident(), None)
            _LEFT.discard(threading.get_ident())

    @property
    def done(self) -> bool:
        return not self._thread.is_alive()

    def leave(self) -> None:
        """Stop counting on the step, for good: at its next word it stops, having begun
        nothing more. One that the system holds in a read stays there until it is let go."""
        ident = self._thread.ident
        if ident is not None:
            _LEFT.add(ident)
            if self.done:  # it has ended: the number may already be another thread's
                _LEFT.discard(ident)

    def wait(self, seconds: float) -> bool:
        """Wait up to `seconds` for the step. Whether it is done."""
        self._thread.join(max(0.0, seconds))
        return self.done

    def seen(self) -> tuple[str, str, float, float] | None:
        """From one look: what it is doing, to which path, for how many seconds, and how
        many of those are beyond what its last word allowed. None once it is done."""
        said = self._said()
        if said is None:
            return None
        what, path, at, allow = said
        lasted = time.monotonic() - at
        return what, path, lasted, max(0.0, lasted - allow)

    def now(self) -> tuple[str, str, float] | None:
        """What it is doing, to which path, and for how many seconds. None once it is done."""
        seen = self.seen()
        return seen[:3] if seen else None

    def quiet(self) -> float:
        """Seconds it has said nothing beyond what its last word allowed; 0 while it is
        within that, and once it is done."""
        seen = self.seen()
        return seen[3] if seen else 0.0

    def where(self) -> str:
        """The thread's stack as text, for the job's log."""
        return frames_text(sys._current_frames().get(self._thread.ident or 0))  # noqa: SLF001


def _line(filename: str, number: int, name: str) -> str:
    return f'  File "{filename}", line {number}, in {name}\n'


def frames_text(frame: FrameType | None) -> str:
    """A stack, outermost first, without the source lines: reading those opens files, and
    this is written when something has stopped answering."""
    lines = []
    while frame is not None:
        lines.append(_line(frame.f_code.co_filename, frame.f_lineno, frame.f_code.co_name))
        frame = frame.f_back
    return "".join(reversed(lines))


def raised_text(raised: BaseException) -> str:
    """What a step raised, as a traceback without the source lines."""
    lines = ["Traceback (most recent call last):\n"]
    trace: TracebackType | None = raised.__traceback__
    while trace is not None:
        code = trace.tb_frame.f_code
        lines.append(_line(code.co_filename, trace.tb_lineno, code.co_name))
        trace = trace.tb_next
    return "".join(lines) + f"{type(raised).__name__}: {raised}\n"


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

    program = PROGRAM
    if under("/Volumes"):
        place = "an external or network volume"
    elif any(under(os.path.join(home, name)) for name in CLOUD_HOME):
        place = "files that a cloud drive's app manages"
    elif any(under(os.path.join(home, name)) for name in PROTECTED_HOME):
        place = "this folder"
    else:
        # the path may lead to one of those places by a link: following it would be a read
        return (
            f"If macOS is asking at the screen whether {program} may read it, allow it "
            "there"
        )
    return (
        f"macOS asks at the screen before a scheduled program reads {place}: allow "
        f"{program} when it asks. Full Disk Access under System Settings, Privacy & "
        "Security does it too, for every program that Python runs"
    )
