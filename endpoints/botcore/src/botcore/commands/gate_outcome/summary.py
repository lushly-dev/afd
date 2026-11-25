"""The hook runner's closing summary in a job's log, and nothing else of the log.

Lefthook ends a run with one line for each command it ran, after the line that starts the
summary:

    summary: (done in 423.93 seconds)
    ✔️ boundaries (11.60 seconds)
    🥊 test (271.79 seconds)

GitHub writes each line of a job's log after a timestamp. The summaries are matched to the
job's group steps that ran, in order, and only a name the group has at the default branch's tip
is kept: what a planted or changed log says cannot reach the record any other way.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from botcore.commands.gate_outcome.record import COMMAND

_STAMP = re.compile(r"^\ufeff?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ")
_COLOUR = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
_START = re.compile(r"summary: \(done in \d+(?:\.\d+)? seconds\)")
_LINE = re.compile(r"(✔️?|🥊)\s+(\S(?:.*\S)?)\s+\((\d+(?:\.\d+)?) seconds\)|(🥊)\s+(\S(?:.*\S)?)")
_ENDS = {"✔": "passed", "✔️": "passed", "🥊": "failed"}


def summaries(log: str) -> list[list[tuple[str, str, float | None]]]:
    """Each summary in the log, in order: (command, `passed` or `failed`, seconds)."""
    found: list[list[tuple[str, str, float | None]]] = []
    current: list[tuple[str, str, float | None]] | None = None
    for raw in log.splitlines():
        line = _COLOUR.sub("", _STAMP.sub("", raw)).strip()
        if _START.fullmatch(line):
            current = []
            found.append(current)
            continue
        if current is None:
            continue
        match = _LINE.fullmatch(line)
        if match is None:
            current = None  # the summary ended
            continue
        if match.group(1):
            current.append((match.group(2), _ENDS[match.group(1)], float(match.group(3))))
        else:
            current.append((match.group(5), "failed", None))
    return [summary for summary in found if summary]  # a start with no line is no summary


@dataclass
class Read:
    """What one group step's summary gave."""

    status: str  # one of record.SUMMARY
    commands: list[list]  # [command, end, seconds], for the group's commands only
    dropped: int = 0  # lines naming a command the group does not have at the tip


def read_steps(log: str, steps: list[tuple[str, ...]]) -> list[Read]:
    """The summaries of a job's group steps that ran, in the order they ran, each step given as
    the commands its group has at the tip. A log whose summaries do not match the steps one for
    one is `mismatch` for each, and one with none is `no-summary`."""
    found = summaries(log)
    if not found:
        return [Read("no-summary", []) for _ in steps]
    if len(found) != len(steps):
        return [Read("mismatch", []) for _ in steps]
    reads = []
    for summary, commands in zip(found, steps, strict=True):
        allowed = {name for name in commands if COMMAND.fullmatch(name)}  # what a line can hold
        kept = [
            [name, end, None if seconds is None else round(seconds, 2)]
            for name, end, seconds in summary
            if name in allowed
        ]
        reads.append(Read("read", kept, len(summary) - len(kept)))
    return reads
