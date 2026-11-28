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
import copy
import inspect
import json
import logging
import math
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, Protocol, TypeVar, cast

from pydantic_core import to_jsonable_python

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
    JournalContextFields,
    JournalEntry,
    JournalRecord,
    JournalSink,
    JournalTape,
    canonical_json,
    create_context_digest,
    journal_actor,
)
from afd.core.output_budget import (
    MAX_OUTPUT_BUDGET_BYTES,
    ask_value,
    normalize_ask_option,
)
from afd.core.result import CommandResult, coerce_command_result, execution_failure
from afd.core.running_command import running_command_secret
from afd.core.wire import to_wire
from afd.server.context_fields import JOURNALED_CONTEXT_FIELDS

__all__ = [
    "MAX_JOURNAL_CONTEXT_BYTES",
    "JournalRedactInfo",
    "JournalReplayTarget",
    "ReplayDifference",
    "ReplayEntryReport",
    "ReplayReport",
    "ReplayStatus",
    "create_journal_middleware",
    "journal_context_fields",
    "replay_journal",
]

logger = logging.getLogger("afd.server.journal")

DEFAULT_MAX_TAPE_READS = 1000

MAX_JOURNAL_CONTEXT_BYTES = 4096
"""Most bytes of UTF-8 canonical JSON a journaled context field value may take (``spec/journal.md``)."""


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


def _untaped_random(random: RandomSource) -> RandomSource:
    """The random source under any recording wrappers."""
    while isinstance(random, _RecordingRandom):
        random = random.inner
    return random


class _RecordingClock:
    """Passes readings through and writes them to the tape."""

    def __init__(self, inner: Clock, keep: Callable[[list[float], float], None], tape: JournalTape):
        self.inner = inner
        self._keep = keep
        self.tape = tape

    def now(self) -> float:
        value = self.inner.now()
        self._keep(self.tape.clock, value)
        return value


class _RecordingRandom:
    """Passes values through and writes them to the tape."""

    def __init__(
        self, inner: RandomSource, keep: Callable[[list[float], float], None], tape: JournalTape
    ):
        self.inner = inner
        self._keep = keep
        self.tape = tape
        self.seed = getattr(inner, "seed", None)

    def next(self) -> float:
        value = self.inner.next()
        self._keep(self.tape.random, value)
        return value


@dataclass(frozen=True)
class JournalRedactInfo:
    """What ``redact`` is told about a call besides its record.

    Attributes:
        secret: ``True`` when the command declares ``secret``, ``False`` when it does
            not, and ``None`` when the recorder runs outside the execution engine (a
            ``DirectClient``'s own middleware, a direct call, another host's chain) and
            cannot read the declaration. Remove the secret, or return ``None``, whenever
            it is not ``False``.
    """

    secret: bool | None


_T = TypeVar("_T")


def _tapes(source: Any) -> list[JournalTape]:
    """The tape of every recording layer wrapped around ``source``, outermost reader first."""
    tapes = []
    while isinstance(source, (_RecordingClock, _RecordingRandom)):
        tapes.append(source.tape)
        source = source.inner
    return tapes


async def _off_tape(context: Any, next_fn: Callable[[], Awaitable[_T]]) -> _T:
    """Run ``next_fn`` off every tape.

    A call the journal leaves unrecorded because it may carry a secret reads the clock and
    random source a recording parent wrapped, which would put the values that built the secret
    on the parent's tape. The tape of every recording layer around it is marked ``truncated``
    instead, so their replays say they cannot restore every value.
    """
    clock = getattr(context, "clock", None)
    random = getattr(context, "random", None)
    tapes = [*_tapes(clock), *_tapes(random)]
    if not tapes:
        return await next_fn()
    for tape in tapes:
        tape.truncated = True
    if clock is not None:
        context.clock = _untaped(clock)
    if random is not None:
        context.random = _untaped_random(random)
    try:
        return await next_fn()
    finally:
        context.clock = clock
        context.random = random


async def run_off_tape(context: Any, next_fn: Callable[[], Awaitable[_T]]) -> _T:
    """Run ``next_fn``, a call to a command that declares ``secret``, off every recording tape.

    ``create_journal_middleware`` does this itself for a secret call it handles. An engine of its
    own whose chain may hold no recorder (Botcore's ``CommandHost``, called from inside a call an
    outer journal records) runs a secret call through this, so the clock and random values it
    reads on ``context`` reach no parent's tape; every recording layer's tape around it is
    marked ``truncated`` (``spec/journal.md``). Running a call off tape twice is harmless.
    """
    return await _off_tape(context, next_fn)


_InfoMode = Literal["positional", "keyword"] | None


def _apply_redact(
    redactor: Callable[..., Any],
    takes_info: _InfoMode,
    record: JournalRecord,
    secret: bool | None,
) -> JournalRecord | None:
    """Give ``record`` to ``redactor``, with a :class:`JournalRedactInfo` when it takes one."""
    if takes_info == "positional":
        redacted = redactor(record, JournalRedactInfo(secret=secret))
    elif takes_info == "keyword":
        redacted = redactor(record, info=JournalRedactInfo(secret=secret))
    else:
        redacted = redactor(record)
    return cast("JournalRecord | None", redacted)


def _takes_info(redact: Callable[..., Any]) -> _InfoMode:
    """How ``redact`` takes the :class:`JournalRedactInfo`, or ``None`` when it does not.

    ``"positional"`` when its second positional parameter has no default; ``"keyword"`` when it
    has a parameter named ``info`` (with a default, or keyword-only). Anything else, a
    ``*args`` or a defaulted second parameter included, is a one-argument redactor, as every
    redactor was before ``secret``, and is called with the record alone.
    """
    try:
        parameters = list(inspect.signature(redact).parameters.values())
    except (TypeError, ValueError):
        return None
    positional = [
        parameter
        for parameter in parameters
        if parameter.kind
        in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
    ]
    if len(positional) >= 2 and positional[1].default is inspect.Parameter.empty:
        return "positional"
    for parameter in parameters[1:]:
        if parameter.name == "info" and parameter.kind in (
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
            inspect.Parameter.KEYWORD_ONLY,
        ):
            return "keyword"
    return None


def _iso_timestamp(ms: float) -> str:
    """Epoch milliseconds as JavaScript's ``Date.toISOString()`` writes them."""
    whole = math.trunc(ms)
    moment = datetime(1970, 1, 1, tzinfo=UTC) + timedelta(milliseconds=whole)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _to_json(value: Any) -> Any:
    """``value`` as wire JSON (camelCase models, unset fields omitted)."""
    return to_wire(value)


def _input_json(value: Any) -> Any:
    """The validated input as JSON. Unlike :func:`_to_json` it keeps explicit ``None``
    values: an input field set to ``null`` must replay as ``null``, not as its default."""
    return to_jsonable_python(value, by_alias=True, serialize_unknown=True)


def _trace_id(context: Any) -> str | None:
    trace_id = getattr(context, "trace_id", None)
    return trace_id if isinstance(trace_id, str) else None


def journal_context_fields(context: Any, names: Sequence[str]) -> JournalContextFields:
    """The values of the context fields ``names`` (those declared ``journal=True``) that
    ``context`` has in ``extra``, as an entry keeps them.

    Each value is kept as JSON with its object keys sorted. A value over
    :data:`MAX_JOURNAL_CONTEXT_BYTES` of canonical JSON is left out and its name
    listed in ``context_omitted``. A value of ``None`` counts as no value. Both
    members are ``None`` when empty.
    """
    extra = getattr(context, "extra", None)
    values = extra if isinstance(extra, dict) else {}
    kept: dict[str, Any] = {}
    omitted: list[str] = []
    for name in sorted(set(names)):
        value = values.get(name)
        if value is None:
            continue
        text = canonical_json(_input_json(value))
        # canonical_json escapes lone surrogates, so the text always encodes.
        if len(text.encode("utf-8")) > MAX_JOURNAL_CONTEXT_BYTES:
            omitted.append(name)
        else:
            kept[name] = json.loads(text)
    return JournalContextFields(context=kept or None, context_omitted=omitted or None)


def _default_filter(command_name: str) -> bool:
    """Commands not recorded by default: the auth commands take passwords and return sessions."""
    return not command_name.startswith("auth-")


def create_journal_middleware(
    sink: JournalSink,
    *,
    record_failures: bool = False,
    filter: Callable[[str], bool] | None = None,
    redact: (
        Callable[[JournalRecord], JournalRecord | None]
        | Callable[[JournalRecord, JournalRedactInfo], JournalRecord | None]
        | None
    ) = None,
    max_tape_reads: int = DEFAULT_MAX_TAPE_READS,
    on_error: Callable[[Exception], None] | None = None,
) -> CommandMiddleware:
    """Create a middleware that appends a journal entry to ``sink`` for each command call.

    Each entry holds the command, its validated input, the actor, the trace
    ID, a context digest (a hash plus the interface; no other context value),
    the values of the declared context fields marked ``journal=True``
    (``spec/context-fields.md``; a value over
    :data:`MAX_JOURNAL_CONTEXT_BYTES` is named in ``context_omitted``
    instead), the result and the duration. It also holds the tape: every value
    the handler read from ``context.clock`` and ``context.random``, which
    :func:`replay_journal` feeds back. Place this middleware last in the list,
    so the tape holds only what the handler (and the server's own timing)
    read, and so the actor it records is the one earlier middleware settled
    on.

    Appends are awaited, so entries are in call order for sequential calls. A
    sink error goes to ``on_error`` (or the ``afd.server.journal`` logger) and
    never changes the command result. Commands named ``auth-*`` are not
    recorded unless ``filter`` allows them, and a command that declares
    ``secret`` is not recorded without ``redact``. During
    :func:`replay_journal` this middleware records nothing; it restarts the
    replay tape at its position.

    Args:
        sink: Where entries go.
        record_failures: Also record calls that fail after validation: a
            failure result, and a handler that raises (recorded as the
            ``COMMAND_EXECUTION_ERROR`` result returned outside ``dev_mode``,
            without the exception message). Default: only successes.
        filter: Record only the commands this returns ``True`` for. Default:
            every command except those named ``auth-*``. A custom filter
            replaces the default, so exclude ``auth-*`` in it too unless you
            redact them. A command that declares ``secret`` is never recorded
            without ``redact``, whatever this returns.
        redact: Last look at each record before it is stored: return it
            (changed or not), or ``None`` to skip it. Giving it also lets calls
            to commands that declare ``secret`` be recorded (when ``filter``
            allows them), so it must remove their secrets. A redactor whose
            second positional parameter has no default gets a
            :class:`JournalRedactInfo` as that argument, and one with a
            parameter named ``info`` gets it as ``info=``; its ``secret`` says
            which calls those are (``None`` outside the execution engine, where it cannot be
            read, and where no call is recorded without ``redact``); any other
            redactor gets the record alone. Use it to drop secrets
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
    # Read once: whether there is a redactor decides which calls may be recorded, and the same
    # one is the one applied.
    redactor = redact
    redact_takes_info = _takes_info(redactor) if redactor is not None else None

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
        # A command declaring `secret` is recorded only when a `redact` can remove the secret: a
        # filter alone never admits it (`spec/journal.md`). Outside the engine the declaration
        # cannot be read, so no call is recorded without `redact`.
        secret = running_command_secret(context, next_fn)
        if secret is not False and redactor is None:
            return await _off_tape(context, next_fn)
        if secret is True:
            # A secret call recorded or skipped by `filter` reads off its parent's tape too: its
            # own recording, if any, keeps its reads on its own entry, for `redact` to drop.
            return await _off_tape(
                context, lambda: record_call(command_name, input, context, next_fn, secret)
            )
        return await record_call(command_name, input, context, next_fn, secret)

    async def record_call(
        command_name: str,
        input: Any,
        context: CommandContext,
        next_fn: NextFn,
        secret: bool | None,
    ) -> CommandResult[Any]:
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
        raw_budget = getattr(context, "output_budget", None)
        effective_budget = (
            raw_budget
            if isinstance(raw_budget, int)
            and not isinstance(raw_budget, bool)
            and 1 <= raw_budget <= MAX_OUTPUT_BUDGET_BYTES
            else None
        )
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
                journaled = journal_context_fields(
                    context, getattr(context, JOURNALED_CONTEXT_FIELDS, None) or ()
                )
                key = getattr(context, "idempotency_key", None)
                draft = JournalRecord(
                    timestamp=_iso_timestamp(start),
                    trace_id=_trace_id(context),
                    # The call's key, a derived one as derived (spec/idempotency.md, I9).
                    idempotency_key=key if isinstance(key, str) else None,
                    command=command_name,
                    input=_input_json(input),
                    actor=journal_actor(getattr(context, "actor", None)),
                    context_digest=create_context_digest(
                        context, journaled, output_budget=effective_budget
                    ),
                    context=journaled.context,
                    context_omitted=journaled.context_omitted,
                    output_budget=effective_budget,
                    result=_to_json(recorded),
                    duration_ms=duration_ms,
                    tape=tape if has_tape else None,
                )
                record = (
                    draft
                    if redactor is None
                    else _apply_redact(redactor, redact_takes_info, draft, secret)
                )
                if record is not None:
                    await sink.append(record)
            except Exception as exc:
                report(exc)

        if thrown is not None:
            raise thrown
        return result  # type: ignore[no-any-return]

    # Marks the recorder, so an engine that calls the host of a command this one records can tell
    # that a secret call is already kept off its parents' tapes (`run_off_tape`).
    middleware.__afd_journal__ = True  # type: ignore[attr-defined]
    return middleware


# ═══════════════════════════════════════════════════════════════════════════════
# REPLAY
# ═══════════════════════════════════════════════════════════════════════════════


class JournalReplayTarget(Protocol):
    """Anything that executes commands by name: ``create_server()``, the core registry, ``SimpleRegistry``.

    A target may also have ``context_fields``, the context fields it declares
    (``MCPServer.context_fields``). When it does, a recorded field it no longer
    declares is dropped with a note; when it does not, every recorded field is
    restored.
    """

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
        self._index = 0
        self._last = start
        self._overran = False
        self._ended = False
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
        self._index = 0
        self._overran = False
        self._ended = False
        self._fallback = seeded_random(seed)
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
        notes.append(
            f"clock: the replay read {clock.used()} of {len(tape.clock)} recorded readings"
        )
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
    entry: JournalEntry,
    clock: Clock,
    random: RandomSource,
    restored: dict[str, Any],
    extra: dict[str, Any] | None,
) -> CommandContext:
    context = CommandContext(
        trace_id=entry.trace_id,
        actor=journal_actor(entry.actor),
        clock=clock,
        random=random,
    )
    if entry.context_digest.interface is not None:
        context.extra["interface"] = entry.context_digest.interface
    if entry.output_budget is not None:
        context._output_budget_ask = ask_value(entry.output_budget)
    if entry.idempotency_key is not None and "idempotency_key" not in (extra or {}):
        # Restored through the engine's own replay path, so K2 does not refuse a derived key.
        context.idempotency_key = entry.idempotency_key
        context._idempotency_key_engine = entry.idempotency_key
    # Copies, so a target that does not validate them cannot change the journal's objects.
    context.extra.update(copy.deepcopy(restored))
    for name, value in (extra or {}).items():
        if name in (
            "trace_id",
            "timeout",
            "actor",
            "clock",
            "random",
            "approval",
            "idempotency_key",
        ):
            setattr(context, name, value)
        elif name == "output_budget":
            context._output_budget_ask = normalize_ask_option(value)
        elif name == "extra":
            context.extra.update(value)
        else:
            context.extra[name] = value
    return context


def _target_checks_app_calls(registry: Any) -> bool:
    """Return True only when ``registry.execute`` is the unoverridden grant-checking implementation."""
    from afd.core.commands import _CommandRegistryImpl
    from afd.server.factory import MCPServer

    inst_dict = getattr(registry, "__dict__", {})
    if isinstance(registry, MCPServer):
        return (
            type(registry).execute is MCPServer.execute
            and type(registry)._execute_command is MCPServer._execute_command
            and type(registry)._prepare_command is MCPServer._prepare_command
            and "execute" not in inst_dict
            and "_execute_command" not in inst_dict
            and "_prepare_command" not in inst_dict
        )
    if isinstance(registry, _CommandRegistryImpl):
        return type(registry).execute is _CommandRegistryImpl.execute and "execute" not in inst_dict
    return False


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

    Each call gets the entry's trace ID, actor, interface and journaled
    context field values (in ``context.extra``, validated by the registry as
    on any call), and a clock and random source that return the values
    recorded on its tape. When ``registry`` has ``context_fields``, a recorded
    field it no longer declares is left out with a note, as is each field the
    entry names in ``context_omitted``. An entry without a tape gets a clock
    fixed at its ``timestamp`` and a random source seeded with
    ``f"{seed}:{seq}"``. The registry should be fresh (or reset to the state
    the recording started from): replay re-runs mutations. Give it the same
    middleware as the recording server: a journal middleware in it lines the
    tape up with the handler and records nothing during replay. Without one, a
    handler that calls another journaled server would let that server's
    journal claim the tape mid-call (the replay marker is a context variable,
    so it reaches calls that build a context of their own).

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
    fields = getattr(registry, "context_fields", None)
    declared = None if fields is None else {item.name for item in fields}
    target_checks_app_calls = _target_checks_app_calls(registry)

    for index, entry in enumerate(ordered):
        # Snapshot before calling a user context factory, which receives the mutable entry.
        recorded_apps = (
            entry.context_digest is not None and entry.context_digest.interface == "apps"
        )
        tape = entry.tape
        field_notes: list[str] = []
        restored: dict[str, Any] = {}
        for name, value in (entry.context or {}).items():
            if declared is not None and name not in declared:
                field_notes.append(
                    f"context field '{name}' is no longer declared; replayed without it"
                )
            else:
                restored[name] = value
        for name in entry.context_omitted or []:
            field_notes.append(
                f"context field '{name}' was too large to journal; replayed without it"
            )
        random = _TapeRandom(tape.random if tape else [], f"{seed}:{entry.seq}")
        clock: _TapeClock | None = None

        outcome: ReplayEntryReport
        try:
            # Inside the try: a bad timestamp or a raising context factory fails this entry only.
            clock = _TapeClock(tape.clock, _to_epoch_ms(entry.timestamp)) if tape else None
            extra = context(entry) if callable(context) else context
            call_context = _replay_context(
                entry, clock or fixed_clock(entry.timestamp), random, restored, extra
            )

            def rewind(clock: _TapeClock | None = clock, random: _TapeRandom = random) -> None:
                if clock is not None:
                    clock.rewind()
                random.rewind()

            def end(clock: _TapeClock | None = clock, random: _TapeRandom = random) -> None:
                if clock is not None:
                    clock.end()
                random.end()

            # An app's call (spec/command-metadata.md, "App-to-app calls") replays only on a
            # target whose unoverridden execute checks call grants (CommandRegistry or MCPServer);
            # any other target (or an overriding subclass) ignores or cannot check grants.
            # Keyed on the recorded interface snapshot too, so the `context` option cannot replay
            # it as another interface.
            is_app_call = recorded_apps or (call_context.extra.get("interface") == "apps")
            if is_app_call:
                if not target_checks_app_calls:
                    raise ValueError(
                        "the entry is an app's call (interface 'apps'), which this replay target "
                        "cannot check against a grant; not replayed"
                    )
                call_context.extra["interface"] = "apps"

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

        notes = field_notes + _tape_notes(entry, clock, random)
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
