"""Journal middleware and replay.

:func:`create_journal_middleware` records each accepted command call to a
:class:`~afd.core.journal.JournalSink`. Server middleware runs after lookup,
exposure and input validation, so a call rejected there never reaches it and
is never recorded. :func:`replay_journal` plays a journal back against a
registry and reports, per entry, whether the result is the same.

Mirrors ``packages/server/src/journal.ts`` and ``journal-replay.ts``; the
format is ``spec/journal.md``.
"""

from __future__ import annotations

import contextlib
import contextvars
import logging
import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Protocol

from afd.core.clock import (
    Clock,
    RandomSource,
    _to_epoch_ms,
    fixed_clock,
    seeded_random,
    system_clock,
    system_random,
)
from afd.core.commands import CommandContext, CommandMiddleware, NextFn
from afd.core.journal import (
    JournalEntry,
    JournalRecord,
    JournalSink,
    JournalTape,
    create_context_digest,
    journal_actor,
)
from afd.core.result import CommandResult, coerce_command_result, execution_failure
from afd.core.wire import to_wire

__all__ = [
    "JournalReplayTarget",
    "ReplayDifference",
    "ReplayEntryReport",
    "ReplayReport",
    "ReplayStatus",
    "create_journal_middleware",
    "replay_journal",
]

logger = logging.getLogger("afd.server.journal")

DEFAULT_MAX_TAPE_READS = 1000


# ═══════════════════════════════════════════════════════════════════════════════
# REPLAY MARKER
# ═══════════════════════════════════════════════════════════════════════════════


class _ReplayMarker(Protocol):
    def rewind(self) -> None:
        """Restart the replay clock and random source from the first recorded value."""
        ...

    def end(self) -> None:
        """The handler is done: readings after this (by outer middleware) are not tape overruns."""
        ...


class _SpentMarker:
    """A marker that does nothing: what nested calls and inner journal middleware see."""

    def rewind(self) -> None:
        pass

    def end(self) -> None:
        pass


_SPENT_REPLAY = _SpentMarker()

# Set by replay_journal() around each replayed call. The first journal middleware
# that finds it rewinds the replay tape at its own position, so readings by
# middleware outside it do not shift what the handler gets, and spends it so nested
# calls and inner journals do not rewind again. No journal middleware records
# during replay. (TypeScript keeps it under a symbol on the context; a context
# variable also reaches nested calls that build a context of their own.)
_JOURNAL_REPLAY: contextvars.ContextVar[_ReplayMarker | None] = contextvars.ContextVar(
    "afd_journal_replay", default=None
)


# ═══════════════════════════════════════════════════════════════════════════════
# RECORDING
# ═══════════════════════════════════════════════════════════════════════════════


def _untaped(clock: Clock) -> Clock:
    """The clock under any recording wrappers, so a journal's own timing lands on no tape."""
    while isinstance(clock, _RecordingClock):
        clock = clock.inner
    return clock


class _RecordingClock:
    """Passes readings through and writes them to the tape."""

    def __init__(self, inner: Clock, keep: Callable[[list[float], float], None], tape: JournalTape):
        self.inner = inner
        self._keep = keep
        self._tape = tape

    def now(self) -> float:
        value = self.inner.now()
        self._keep(self._tape.clock, value)
        return value


class _RecordingRandom:
    """Passes values through and writes them to the tape."""

    def __init__(
        self, inner: RandomSource, keep: Callable[[list[float], float], None], tape: JournalTape
    ):
        self._inner = inner
        self._keep = keep
        self._tape = tape
        self.seed = getattr(inner, "seed", None)

    def next(self) -> float:
        value = self._inner.next()
        self._keep(self._tape.random, value)
        return value


def _iso_timestamp(ms: float) -> str:
    """Epoch milliseconds as JavaScript's ``Date.toISOString()`` writes them."""
    whole = math.trunc(ms)
    moment = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(milliseconds=whole)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _to_json(value: Any) -> Any:
    """``value`` as wire JSON (camelCase models, unset fields omitted)."""
    return to_wire(value)


def _trace_id(context: Any) -> str | None:
    trace_id = getattr(context, "trace_id", None)
    return trace_id if isinstance(trace_id, str) else None


def _default_filter(command_name: str) -> bool:
    """Commands not recorded by default: the auth commands take passwords and return sessions."""
    return not command_name.startswith("auth-")


def create_journal_middleware(
    sink: JournalSink,
    *,
    record_failures: bool = False,
    filter: Callable[[str], bool] | None = None,
    redact: Callable[[JournalRecord], JournalRecord | None] | None = None,
    max_tape_reads: int = DEFAULT_MAX_TAPE_READS,
    on_error: Callable[[Exception], None] | None = None,
) -> CommandMiddleware:
    """Create a middleware that appends a journal entry to ``sink`` for each command call.

    Each entry holds the command, its validated input, the actor, the trace
    ID, a context digest (a hash plus the interface; no other context value),
    the result and the duration. It also holds the tape: every value the
    handler read from ``context.clock`` and ``context.random``, which
    :func:`replay_journal` feeds back. Place this middleware last in the list,
    so the tape holds only what the handler (and the server's own timing)
    read, and so the actor it records is the one earlier middleware settled on.

    Appends are awaited, so entries are in call order for sequential calls. A
    sink error goes to ``on_error`` (or the ``afd.server.journal`` logger) and
    never changes the command result. During :func:`replay_journal` this
    middleware records nothing; it restarts the replay tape at its position.

    Args:
        sink: Where entries go.
        record_failures: Also record calls that fail after validation: a
            failure result, and a handler that raises (recorded as the
            ``COMMAND_EXECUTION_ERROR`` result returned outside ``dev_mode``,
            without the exception message). Default: only successes.
        filter: Record only the commands this returns ``True`` for. Default:
            every command except those named ``auth-*``. A custom filter
            replaces the default, so exclude ``auth-*`` in it too unless you
            redact them.
        redact: Last look at each record before it is stored: return it
            (changed or not), or ``None`` to skip it. Use it to drop secrets
            from inputs or results. When a secret is derived from
            ``context.random``, drop ``record.tape`` too: the recorded random
            values would rebuild it.
        max_tape_reads: Most clock readings and most random values kept per
            call, each. Past it the tape is marked ``truncated``.
        on_error: Called when building or appending an entry fails.

    Example:
        >>> journal = MemoryJournalSink()
        >>> server = create_server("todo", middleware=[create_journal_middleware(journal)])
    """
    accept = filter or _default_filter

    def report(exc: Exception) -> None:
        if on_error is None:
            logger.error("Journal entry not recorded", exc_info=exc)
            return
        # A failing on_error has nowhere left to report.
        with contextlib.suppress(Exception):
            on_error(exc)

    async def middleware(
        command_name: str, input: Any, context: CommandContext, next_fn: NextFn
    ) -> CommandResult[Any]:
        replay = _JOURNAL_REPLAY.get()
        if replay is not None:
            replay.rewind()
            token = _JOURNAL_REPLAY.set(_SPENT_REPLAY)
            try:
                return await next_fn()
            finally:
                _JOURNAL_REPLAY.reset(token)
                replay.end()
        if not accept(command_name):
            return await next_fn()

        clock: Clock = getattr(context, "clock", None) or system_clock
        random: RandomSource = getattr(context, "random", None) or system_random
        tape = JournalTape()

        def keep(values: list[float], value: float) -> None:
            if len(values) < max_tape_reads:
                values.append(value)
            else:
                tape.truncated = True

        # The same context object reaches the handler, so swapping its sources records what it reads.
        context.clock = _RecordingClock(clock, keep, tape)
        context.random = _RecordingRandom(random, keep, tape)

        # This journal's own timing reads the clock under any outer journal's recorder.
        timing = _untaped(clock)
        start = timing.now()
        result: Any = None
        thrown: BaseException | None = None
        try:
            result = await next_fn()
        except Exception as exc:
            thrown = exc
        finally:
            context.clock = clock
            context.random = random
        duration_ms = max(0, timing.now() - start)

        # What the server returns for a raise outside dev_mode, never the exception message.
        recorded = (
            execution_failure(thrown, False)
            if thrown is not None
            else coerce_command_result(result, command_name)
        )
        if recorded.success or record_failures:
            try:
                has_tape = bool(tape.clock or tape.random or tape.truncated)
                record: JournalRecord | None = JournalRecord(
                    timestamp=_iso_timestamp(start),
                    trace_id=_trace_id(context),
                    command=command_name,
                    input=_to_json(input),
                    actor=journal_actor(getattr(context, "actor", None)),
                    context_digest=create_context_digest(context),
                    result=_to_json(recorded),
                    duration_ms=duration_ms,
                    tape=tape if has_tape else None,
                )
                if redact is not None:
                    record = redact(record)  # type: ignore[arg-type]
                if record is not None:
                    await sink.append(record)
            except Exception as exc:
                report(exc)

        if thrown is not None:
            raise thrown
        return result

    return middleware


# ═══════════════════════════════════════════════════════════════════════════════
# REPLAY
# ═══════════════════════════════════════════════════════════════════════════════


class JournalReplayTarget(Protocol):
    """Anything that executes commands by name: ``create_server()``, the core registry, ``SimpleRegistry``."""

    async def execute(self, name: str, input: Any, context: Any = None) -> Any: ...


ReplayStatus = Literal["same", "different", "error"]
"""How a replayed entry compares with the recording."""


@dataclass
class ReplayDifference:
    """One difference between the recorded and the replayed result.

    Attributes:
        path: Where, e.g. ``data.title`` or ``data.items[2]``. Empty for the whole result.
        kind: ``changed``: both have a value. ``added``: only the replay has
            one. ``removed``: only the recording.
        recorded: The recorded value. ``None`` for ``added``.
        replayed: The replayed value. ``None`` for ``removed``.
    """

    path: str
    kind: Literal["changed", "added", "removed"]
    recorded: Any = None
    replayed: Any = None


@dataclass
class ReplayEntryReport:
    """The outcome of replaying one entry.

    Attributes:
        seq: The entry's ``seq``.
        command: The command name.
        status: ``same``, ``different`` or ``error``.
        recorded: The result in the journal (wire JSON).
        replayed: The result of the replay. ``None`` when ``status`` is ``error``.
        differences: Present when ``status`` is ``different``.
        error: Why the replay raised. Present when ``status`` is ``error``.
        notes: What replay could not restore, e.g. a tape that ran out.
    """

    seq: int
    command: str
    status: ReplayStatus
    recorded: dict[str, Any]
    replayed: Any = None
    differences: list[ReplayDifference] | None = None
    error: str | None = None
    notes: list[str] | None = None


@dataclass
class ReplayReport:
    """The outcome of :func:`replay_journal`.

    Attributes:
        entries: One report per replayed entry, in ``seq`` order.
        same: Entries replayed to the same result.
        different: Entries replayed to a different result.
        errors: Entries whose replay raised.
        diverged: Whether any entry was not ``same``.
        skipped: Entries not replayed because ``stop_on_divergence`` stopped the run.
    """

    entries: list[ReplayEntryReport] = field(default_factory=list)
    same: int = 0
    different: int = 0
    errors: int = 0
    diverged: bool = False
    skipped: int = 0


DEFAULT_REPLAY_IGNORE = ("metadata.executionTimeMs",)
DEFAULT_MAX_DIFFERENCES = 100


class _TapeClock:
    """Replays the recorded clock readings, then holds the last one."""

    def __init__(self, readings: Sequence[float], start: float) -> None:
        self._readings = readings
        self._start = start
        self.rewind()

    def now(self) -> float:
        if self._ended:
            return self._last
        if self._index < len(self._readings):
            self._last = self._readings[self._index]
            self._index += 1
        else:
            self._overran = True
        return self._last

    def rewind(self) -> None:
        self._index = 0
        self._last = self._start
        self._overran = False
        self._ended = False

    def end(self) -> None:
        self._ended = True

    def used(self) -> int:
        return self._index

    def overran(self) -> bool:
        return self._overran


class _TapeRandom:
    """Replays the recorded random values, then continues with a source seeded with ``seed``."""

    def __init__(self, values: Sequence[float], seed: str) -> None:
        self._values = values
        self.seed = seed
        self.rewind()

    def next(self) -> float:
        if self._ended:
            return self._fallback.next()
        if self._index < len(self._values):
            value = self._values[self._index]
            self._index += 1
            return value
        self._overran = True
        return self._fallback.next()

    def rewind(self) -> None:
        self._index = 0
        self._overran = False
        self._ended = False
        self._fallback = seeded_random(self.seed)

    def end(self) -> None:
        self._ended = True

    def used(self) -> int:
        return self._index

    def overran(self) -> bool:
        return self._overran


def _tape_notes(entry: JournalEntry, clock: _TapeClock | None, random: _TapeRandom) -> list[str]:
    """What replay could not restore for ``entry``, from how its tape was read."""
    tape = entry.tape
    if tape is None:
        return []
    notes: list[str] = []
    if tape.truncated:
        notes.append("the recorded tape was truncated; values past it are not restored")
    if clock is not None and clock.overran():
        notes.append(
            f"clock: the tape holds {len(tape.clock)} readings and the replay read more; "
            "later readings repeat the last one"
        )
    elif clock is not None and clock.used() < len(tape.clock):
        notes.append(f"clock: the replay read {clock.used()} of {len(tape.clock)} recorded readings")
    if random.overran():
        notes.append(
            f"random: the tape holds {len(tape.random)} values and the replay read more; "
            f"later values come from seed '{random.seed}'"
        )
    elif random.used() < len(tape.random):
        notes.append(
            f"random: the replay read {random.used()} of {len(tape.random)} recorded values"
        )
    return notes


def _json_kind(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    return type(value).__name__


def _child_path(path: str, key: str) -> str:
    return key if path == "" else f"{path}.{key}"


def _diff_json(
    recorded: Any,
    replayed: Any,
    path: str,
    ignore: frozenset[str],
    out: list[ReplayDifference],
    limit: int,
) -> None:
    """Structural differences between two JSON values, skipping ``ignore`` paths."""
    if len(out) >= limit or path in ignore:
        return
    if isinstance(recorded, list) and isinstance(replayed, list):
        for index in range(max(len(recorded), len(replayed))):
            at = f"{path}[{index}]"
            if index >= len(replayed):
                if at not in ignore and len(out) < limit:
                    out.append(ReplayDifference(at, "removed", recorded=recorded[index]))
            elif index >= len(recorded):
                if at not in ignore and len(out) < limit:
                    out.append(ReplayDifference(at, "added", replayed=replayed[index]))
            else:
                _diff_json(recorded[index], replayed[index], at, ignore, out, limit)
        return
    if isinstance(recorded, dict) and isinstance(replayed, dict):
        for key in sorted(set(recorded) | set(replayed)):
            at = _child_path(path, key)
            if key not in replayed:
                if at not in ignore and len(out) < limit:
                    out.append(ReplayDifference(at, "removed", recorded=recorded[key]))
            elif key not in recorded:
                if at not in ignore and len(out) < limit:
                    out.append(ReplayDifference(at, "added", replayed=replayed[key]))
            else:
                _diff_json(recorded[key], replayed[key], at, ignore, out, limit)
        return
    # JSON equality: 1 and 1.0 are the same number, but True is not 1.
    if _json_kind(recorded) != _json_kind(replayed) or recorded != replayed:
        out.append(ReplayDifference(path, "changed", recorded=recorded, replayed=replayed))


ReplayContext = dict[str, Any] | Callable[[JournalEntry], dict[str, Any]]
"""Extra context for each replayed call: ``CommandContext`` fields, other names go to ``extra``."""


def _replay_context(
    entry: JournalEntry, clock: Clock, random: RandomSource, extra: dict[str, Any] | None
) -> CommandContext:
    context = CommandContext(
        trace_id=entry.trace_id,
        actor=journal_actor(entry.actor),
        clock=clock,
        random=random,
    )
    if entry.context_digest.interface is not None:
        context.extra["interface"] = entry.context_digest.interface
    for name, value in (extra or {}).items():
        if name in ("trace_id", "timeout", "actor", "clock", "random"):
            setattr(context, name, value)
        elif name == "extra":
            context.extra.update(value)
        else:
            context.extra[name] = value
    return context


async def replay_journal(
    registry: JournalReplayTarget,
    entries: Sequence[JournalEntry],
    *,
    context: ReplayContext | None = None,
    ignore: Sequence[str] | None = None,
    seed: str = "afd-replay",
    stop_on_divergence: bool = False,
    max_differences: int = DEFAULT_MAX_DIFFERENCES,
) -> ReplayReport:
    """Re-execute journal entries in ``seq`` order and compare each result with the recorded one.

    Each call gets the entry's trace ID, actor and interface, and a clock and
    random source that return the values recorded on its tape. An entry
    without a tape gets a clock fixed at its ``timestamp`` and a random source
    seeded with ``f"{seed}:{seq}"``. The registry should be fresh (or reset to
    the state the recording started from): replay re-runs mutations. Give it
    the same middleware as the recording server: a journal middleware in it
    lines the tape up with the handler and records nothing during replay.

    Args:
        registry: Anything with ``execute(name, input, context)``.
        entries: The journal, e.g. from :func:`afd.core.journal.parse_journal`.
        context: Extra context for each call (or a function of the entry), e.g.
            a fresh database. Its values win over the restored ones.
        ignore: Exact result paths left out of the comparison, with
            everything under them, such as ``metadata`` or
            ``data.items[0].updatedAt`` (no wildcards). Default:
            ``("metadata.executionTimeMs",)``.
        seed: Seed for random numbers an entry has no recorded values for;
            the entry's ``seq`` is appended.
        stop_on_divergence: Stop after the first entry that is not ``same``.
        max_differences: Most differences listed per entry.

    Example:
        >>> entries = parse_journal(Path("session.jsonl").read_text())
        >>> report = await replay_journal(create_server("todo", ...), entries)
        >>> if report.diverged:
        ...     print([entry for entry in report.entries if entry.status != "same"])
    """
    ignored = frozenset(DEFAULT_REPLAY_IGNORE if ignore is None else ignore)
    ordered = sorted(entries, key=lambda entry: entry.seq)
    report = ReplayReport()

    for index, entry in enumerate(ordered):
        tape = entry.tape
        random = _TapeRandom(tape.random if tape else [], f"{seed}:{entry.seq}")
        clock: _TapeClock | None = None

        outcome: ReplayEntryReport
        try:
            # Inside the try: a bad timestamp or a raising context factory fails this entry only.
            clock = _TapeClock(tape.clock, _to_epoch_ms(entry.timestamp)) if tape else None
            extra = context(entry) if callable(context) else context
            call_context = _replay_context(
                entry, clock or fixed_clock(entry.timestamp), random, extra
            )

            def rewind(clock: _TapeClock | None = clock, random: _TapeRandom = random) -> None:
                if clock is not None:
                    clock.rewind()
                random.rewind()

            def end(clock: _TapeClock | None = clock, random: _TapeRandom = random) -> None:
                if clock is not None:
                    clock.end()
                random.end()

            marker = _Marker(rewind, end)
            token = _JOURNAL_REPLAY.set(marker)
            try:
                replayed = await registry.execute(entry.command, entry.input, call_context)
            finally:
                _JOURNAL_REPLAY.reset(token)
            differences: list[ReplayDifference] = []
            _diff_json(entry.result, _to_json(replayed), "", ignored, differences, max_differences)
            outcome = ReplayEntryReport(
                seq=entry.seq,
                command=entry.command,
                status="different" if differences else "same",
                recorded=entry.result,
                replayed=replayed,
                differences=differences or None,
            )
        except Exception as exc:
            outcome = ReplayEntryReport(
                seq=entry.seq,
                command=entry.command,
                status="error",
                recorded=entry.result,
                error=str(exc) or type(exc).__name__,
            )

        notes = _tape_notes(entry, clock, random)
        if notes:
            outcome.notes = notes

        report.entries.append(outcome)
        if outcome.status == "same":
            report.same += 1
        elif outcome.status == "different":
            report.different += 1
        else:
            report.errors += 1

        if outcome.status != "same":
            report.diverged = True
            if stop_on_divergence:
                report.skipped = len(ordered) - index - 1
                break
    return report


@dataclass
class _Marker:
    """The replay marker for one entry: rewinds and ends its tape sources."""

    rewind: Callable[[], None]
    end: Callable[[], None]
