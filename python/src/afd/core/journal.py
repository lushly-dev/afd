"""The command journal: an ordered, append-only record of executed commands.

A journal records each command call (name, input, essential context and
result) so it can be audited, replayed to reproduce a session, or turned into
a regression test. ``afd.server`` records entries with
``create_journal_middleware()`` and replays them with ``replay_journal()``.
On disk, a journal is JSON Lines: one :class:`JournalEntry` per line (see
``spec/journal.md``).

Journals never store secrets from the command context: an entry keeps the
actor, the interface and the trace ID, plus a hash over those values and the
names (never the values) of the other context keys.

Mirrors ``packages/core/src/journal.ts`` and ``journal-file.ts``. Entries
written here and by TypeScript are the same JSON: keys are camelCase, unset
optional fields are omitted, and numbers and strings are written as
JavaScript's ``JSON.stringify`` writes them, so a parsed journal serializes
back to the same bytes.

Example:
    >>> sink = MemoryJournalSink()
    >>> server = create_server("todo", middleware=[create_journal_middleware(sink)])
    >>> # ...
    >>> entries = await sink.read()
"""

from __future__ import annotations

import asyncio
import dataclasses
import hashlib
import json
import math
import os
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from afd.core.actor import Actor, is_actor_kind

__all__ = [
    "FileJournalSink",
    "JournalContextDigest",
    "JournalEntry",
    "JournalRange",
    "JournalRecord",
    "JournalSink",
    "JournalTape",
    "MemoryJournalSink",
    "canonical_json",
    "create_context_digest",
    "is_journal_entry",
    "journal_actor",
    "parse_journal",
    "select_journal_range",
    "serialize_journal",
    "serialize_journal_entry",
]

_MAX_SAFE_INTEGER = 2**53 - 1


# ═══════════════════════════════════════════════════════════════════════════════
# TYPES
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class JournalTape:
    """The clock readings and random numbers a handler read, in order.

    Replay feeds them back so the handler sees the same time and the same
    random numbers.

    Attributes:
        clock: Each ``context.clock.now()`` reading, in epoch milliseconds.
        random: Each ``context.random.next()`` value.
        truncated: ``True`` when the handler read more values than the
            recorder keeps; replay cannot restore the rest.
    """

    clock: list[float] = field(default_factory=list)
    random: list[float] = field(default_factory=list)
    truncated: bool | None = None


@dataclass
class JournalContextDigest:
    """The parts of the command context a journal keeps besides the actor and trace ID.

    Attributes:
        hash: ``sha256:`` and the hex SHA-256 of the canonical JSON of the
            actor, the interface, the trace ID and the sorted names of the
            context's other keys. Names only, never their values.
        interface: The interface that invoked the command.
    """

    hash: str
    interface: str | None = None


@dataclass
class JournalRecord:
    """An entry before the sink assigns its ``seq``.

    Attributes:
        timestamp: When the command started, ISO 8601, from ``context.clock``.
        command: The command name.
        input: The validated input the handler received, as JSON.
        context_digest: The context hash and the allowlisted interface.
        result: The command result as wire JSON (camelCase), metadata included.
        duration_ms: Duration of the call through the rest of the middleware chain.
        trace_id: ``context.trace_id``, when the call had one.
        actor: Who called: ``kind``, and ``id``, ``label`` and ``on_behalf_of`` when set.
        tape: The clock and random values the handler read. ``None`` when it read none.
    """

    timestamp: str
    command: str
    input: Any
    context_digest: JournalContextDigest
    result: dict[str, Any]
    duration_ms: float
    trace_id: str | None = None
    actor: Actor | None = None
    tape: JournalTape | None = None


@dataclass
class JournalEntry(JournalRecord):
    """One executed command in a journal.

    The fields of :class:`JournalRecord`, plus ``seq``: the position in the
    journal, from 1, assigned by the sink. Increasing; gaps are allowed.
    """

    seq: int = 0

    @classmethod
    def from_record(cls, seq: int, record: JournalRecord) -> JournalEntry:
        """``record`` stored at ``seq``."""
        values = {item.name: getattr(record, item.name) for item in dataclasses.fields(JournalRecord)}
        return cls(seq=seq, **values)

    def to_dict(self) -> dict[str, Any]:
        """The entry as wire JSON, in the key order of ``spec/journal.md``."""
        data: dict[str, Any] = {"seq": self.seq, "timestamp": self.timestamp}
        if self.trace_id is not None:
            data["traceId"] = self.trace_id
        data["command"] = self.command
        data["input"] = self.input
        if self.actor is not None:
            data["actor"] = _actor_to_dict(self.actor)
        digest: dict[str, Any] = {"hash": self.context_digest.hash}
        if self.context_digest.interface is not None:
            digest["interface"] = self.context_digest.interface
        data["contextDigest"] = digest
        data["result"] = self.result
        data["durationMs"] = self.duration_ms
        if self.tape is not None:
            tape: dict[str, Any] = {"clock": self.tape.clock, "random": self.tape.random}
            if self.tape.truncated is not None:
                tape["truncated"] = self.tape.truncated
            data["tape"] = tape
        return data

    @classmethod
    def from_dict(cls, data: Any) -> JournalEntry:
        """Parse wire JSON.

        Raises:
            ValueError: when ``data`` is not a journal entry.
        """
        if not is_journal_entry(data):
            raise ValueError("Not a journal entry")
        digest = data["contextDigest"]
        tape = data.get("tape")
        return cls(
            seq=data["seq"],
            timestamp=data["timestamp"],
            trace_id=data.get("traceId"),
            command=data["command"],
            input=data["input"],
            actor=_actor_from_dict(data["actor"]) if "actor" in data else None,
            context_digest=JournalContextDigest(
                hash=digest["hash"], interface=digest.get("interface")
            ),
            result=data["result"],
            duration_ms=data["durationMs"],
            tape=(
                JournalTape(
                    clock=list(tape["clock"]),
                    random=list(tape["random"]),
                    truncated=tape.get("truncated"),
                )
                if tape is not None
                else None
            ),
        )


@dataclass
class JournalRange:
    """A range of entries to read, by ``seq``. Both bounds are inclusive.

    Attributes:
        from_seq: First ``seq`` to include. Default: the start of the journal.
        to_seq: Last ``seq`` to include. Default: the end of the journal.
    """

    from_seq: int | None = None
    to_seq: int | None = None


class JournalSink(Protocol):
    """Storage for a journal: append entries and read them back in order.

    The sink assigns ``seq``, so a journal reopened after a restart continues
    its numbering. Implementations: :class:`MemoryJournalSink` and
    :class:`FileJournalSink` (JSON Lines).
    """

    async def append(self, record: JournalRecord) -> JournalEntry:
        """Append ``record`` with the next ``seq`` and return the stored entry."""
        ...

    async def read(self, range: JournalRange | None = None) -> list[JournalEntry]:
        """Entries in ``range``, in ``seq`` order."""
        ...


def select_journal_range(
    entries: Iterable[JournalEntry], range: JournalRange | None = None
) -> list[JournalEntry]:
    """Entries of ``entries`` (in ``seq`` order) that fall in ``range``."""
    start = range.from_seq if range and range.from_seq is not None else -math.inf
    end = range.to_seq if range and range.to_seq is not None else math.inf
    return [entry for entry in entries if start <= entry.seq <= end]


class MemoryJournalSink:
    """A journal held in memory, for tests and short-lived sessions.

    Example:
        >>> sink = MemoryJournalSink()
        >>> server = create_server("todo", middleware=[create_journal_middleware(sink)])
        >>> # ...
        >>> entries = await sink.read()
    """

    def __init__(self, initial: Iterable[JournalEntry] = ()) -> None:
        """``initial``: entries to start from, e.g. a journal parsed with :func:`parse_journal`."""
        self._entries: list[JournalEntry] = sorted(initial, key=lambda entry: entry.seq)

    async def append(self, record: JournalRecord) -> JournalEntry:
        last = self._entries[-1].seq if self._entries else 0
        entry = JournalEntry.from_record(last + 1, record)
        self._entries.append(entry)
        return entry

    async def read(self, range: JournalRange | None = None) -> list[JournalEntry]:
        return select_journal_range(self._entries, range)


# ═══════════════════════════════════════════════════════════════════════════════
# CONTEXT DIGEST
# ═══════════════════════════════════════════════════════════════════════════════

# Context attributes a journal keeps the values of (the interface is in ``extra``).
_ALLOWLISTED_ATTRIBUTES = frozenset({"actor", "trace_id", "interface"})


def _actor_to_dict(actor: Actor) -> dict[str, Any]:
    data: dict[str, Any] = {"kind": actor.kind}
    if actor.id is not None:
        data["id"] = actor.id
    if actor.label is not None:
        data["label"] = actor.label
    if actor.on_behalf_of is not None:
        data["onBehalfOf"] = actor.on_behalf_of
    return data


def _is_actor_dict(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and is_actor_kind(value.get("kind"))
        and all(
            value.get(key) is None or isinstance(value.get(key), str)
            for key in ("id", "label", "onBehalfOf")
        )
    )


def _actor_from_dict(value: dict[str, Any]) -> Actor:
    return Actor(
        kind=value["kind"],
        id=value.get("id"),
        label=value.get("label"),
        on_behalf_of=value.get("onBehalfOf"),
    )


def journal_actor(actor: Any) -> Actor | None:
    """``actor`` with only the four :class:`Actor` fields, or ``None`` when it is not an actor.

    Accepts an :class:`Actor` (a subclass loses its extra attributes) or its
    wire form, a dict with ``kind`` and optional ``id``, ``label`` and ``onBehalfOf``.
    """
    if isinstance(actor, Actor):
        candidate = {
            "kind": actor.kind,
            "id": actor.id,
            "label": actor.label,
            "onBehalfOf": actor.on_behalf_of,
        }
    elif isinstance(actor, dict):
        candidate = actor
    else:
        return None
    if not _is_actor_dict(candidate):
        return None
    return _actor_from_dict(candidate)


def canonical_json(value: Any) -> str:
    """JSON with object keys sorted at every level and no whitespace, so equal values give equal text."""
    return _dumps(value, sort_keys=True)


def _context_values(context: Any) -> dict[str, Any]:
    """The context's attributes, with the entries of ``extra`` as attributes of their own."""
    if context is None:
        return {}
    if dataclasses.is_dataclass(context) and not isinstance(context, type):
        values = {item.name: getattr(context, item.name) for item in dataclasses.fields(context)}
    elif isinstance(context, dict):
        values = dict(context)
    else:
        values = {name: value for name, value in vars(context).items() if not name.startswith("_")}
    extra = values.pop("extra", None)
    if isinstance(extra, dict):
        for name, value in extra.items():
            values.setdefault(str(name), value)
    return values


def create_context_digest(context: Any) -> JournalContextDigest:
    """The :class:`JournalContextDigest` of ``context``.

    The hash covers the actor (its four fields), the interface
    (``context.extra["interface"]``), the trace ID and the sorted names of
    every other context attribute and ``extra`` key whose value is not
    ``None``. Values outside the allowlist are only checked for ``None``; they
    never enter the hash or the digest.
    """
    values = _context_values(context)
    actor = journal_actor(values.get("actor"))
    interface = values.get("interface")
    interface = interface if isinstance(interface, str) else None
    trace_id = values.get("trace_id")
    trace_id = trace_id if isinstance(trace_id, str) else None
    keys = sorted(
        name
        for name, value in values.items()
        if name not in _ALLOWLISTED_ATTRIBUTES and value is not None
    )
    text = canonical_json(
        {
            "actor": _actor_to_dict(actor) if actor is not None else None,
            "interface": interface,
            "keys": keys,
            "traceId": trace_id,
        }
    )
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return JournalContextDigest(hash=f"sha256:{digest}", interface=interface)


# ═══════════════════════════════════════════════════════════════════════════════
# JSON LINES
# ═══════════════════════════════════════════════════════════════════════════════


def _js_number(value: int | float) -> str:
    """``value`` as JavaScript's ``JSON.stringify`` writes it (``1`` for ``1.0``, ``1e+21``)."""
    if isinstance(value, int) and abs(value) < 10**21:
        return str(value)
    value = float(value)
    if not math.isfinite(value):
        return "null"
    if value == 0:
        return "0"
    sign = "-" if value < 0 else ""
    # repr() gives the shortest digits that round-trip, as JavaScript does; only the layout differs.
    mantissa, _, exponent = repr(abs(value)).partition("e")
    whole, _, fraction = mantissa.partition(".")
    digits = (whole + fraction).lstrip("0")
    point = len(whole) + int(exponent or 0) - (len(whole + fraction) - len(digits))
    digits = digits.rstrip("0") or "0"
    k = len(digits)
    if k <= point <= 21:
        return sign + digits + "0" * (point - k)
    if 0 < point <= 21:
        return sign + digits[:point] + "." + digits[point:]
    if -6 < point <= 0:
        return sign + "0." + "0" * -point + digits
    e = point - 1
    exp = f"e{'+' if e > 0 else '-'}{abs(e)}"
    return sign + (digits if k == 1 else digits[0] + "." + digits[1:]) + exp


def _dumps(value: Any, *, sort_keys: bool = False) -> str:
    """JSON text as JavaScript's ``JSON.stringify`` writes it: compact, non-ASCII kept."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return _js_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, dict):
        items = sorted(value.items()) if sort_keys else value.items()
        return (
            "{"
            + ",".join(
                f"{json.dumps(str(key), ensure_ascii=False)}:{_dumps(item, sort_keys=sort_keys)}"
                for key, item in items
            )
            + "}"
        )
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_dumps(item, sort_keys=sort_keys) for item in value) + "]"
    raise TypeError(f"Not JSON: {type(value).__name__}")


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _is_number_list(value: Any) -> bool:
    return isinstance(value, list) and all(_is_number(item) for item in value)


def _is_tape(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and _is_number_list(value.get("clock"))
        and _is_number_list(value.get("random"))
        and ("truncated" not in value or isinstance(value["truncated"], bool))
    )


def is_journal_entry(value: Any) -> bool:
    """Whether ``value`` (wire JSON, or a :class:`JournalEntry`) has the shape of a journal entry."""
    if isinstance(value, JournalEntry):
        value = value.to_dict()
    if not isinstance(value, dict):
        return False
    seq = value.get("seq")
    digest = value.get("contextDigest")
    result = value.get("result")
    return (
        isinstance(seq, int)
        and not isinstance(seq, bool)
        and 1 <= seq <= _MAX_SAFE_INTEGER
        and isinstance(value.get("timestamp"), str)
        and ("traceId" not in value or isinstance(value["traceId"], str))
        and isinstance(value.get("command"), str)
        and "input" in value
        and ("actor" not in value or _is_actor_dict(value["actor"]))
        and isinstance(digest, dict)
        and isinstance(digest.get("hash"), str)
        and ("interface" not in digest or isinstance(digest["interface"], str))
        and isinstance(result, dict)
        and isinstance(result.get("success"), bool)
        and _is_number(value.get("durationMs"))
        and ("tape" not in value or _is_tape(value["tape"]))
    )


def serialize_journal_entry(entry: JournalEntry) -> str:
    """One JSON Lines line for ``entry``, without the trailing newline."""
    # Newlines inside strings are escaped, so the line holds the whole entry.
    return _dumps(entry.to_dict())


def serialize_journal(entries: Iterable[JournalEntry]) -> str:
    """A JSON Lines journal for ``entries``: one line each, every line ending in ``\\n``."""
    return "".join(f"{serialize_journal_entry(entry)}\n" for entry in entries)


def _reject_constant(name: str) -> Any:
    raise ValueError(f"{name} is not JSON")


def parse_journal(text: str) -> list[JournalEntry]:
    """The entries of a JSON Lines journal, in file order.

    Blank lines are skipped; ``\\r\\n`` line endings are accepted.

    Raises:
        ValueError: naming the line, when a line is not JSON or not a journal entry.
    """
    entries: list[JournalEntry] = []
    for index, raw in enumerate(text.split("\n")):
        line = raw[:-1] if raw.endswith("\r") else raw
        if line.strip() == "":
            continue
        try:
            value = json.loads(line, parse_constant=_reject_constant)
        except ValueError as exc:
            raise ValueError(f"Journal line {index + 1} is not valid JSON: {exc}") from None
        if not is_journal_entry(value):
            raise ValueError(f"Journal line {index + 1} is not a journal entry")
        entries.append(JournalEntry.from_dict(value))
    return entries


# ═══════════════════════════════════════════════════════════════════════════════
# FILE SINK
# ═══════════════════════════════════════════════════════════════════════════════


class FileJournalSink:
    """A :class:`JournalSink` that appends one JSON line per entry to ``path``.

    The file and its directory are created on the first append. An existing
    file is continued: the next ``seq`` follows its last entry. Appends from
    one sink are written in order; do not point two sinks (or two processes)
    at the same file.

    A last line without a newline is a write that did not finish (a crash
    mid-append). Reads skip it when it is not a complete entry, and the first
    append removes it before writing; a complete entry that only lacks its
    newline is kept and the newline is added. The first append reads the
    whole existing file once, to find the last ``seq``.

    Example:
        >>> sink = FileJournalSink("./journal.jsonl")
        >>> server = create_server("todo", middleware=[create_journal_middleware(sink)])
    """

    def __init__(self, path: str | os.PathLike[str]) -> None:
        self.path = Path(path)
        self._last_seq: int | None = None
        self._lock = asyncio.Lock()

    async def append(self, record: JournalRecord) -> JournalEntry:
        async with self._lock:
            prefix = ""
            if self._last_seq is None:
                entries, unterminated, torn_at = self._read_file()
                self._last_seq = entries[-1].seq if entries else 0
                if torn_at is not None:
                    os.truncate(self.path, torn_at)
                elif unterminated:
                    prefix = "\n"
                self.path.parent.mkdir(parents=True, exist_ok=True)
            entry = JournalEntry.from_record(self._last_seq + 1, record)
            with open(self.path, "a", encoding="utf-8", newline="") as file:
                file.write(f"{prefix}{serialize_journal_entry(entry)}\n")
            self._last_seq = entry.seq
            return entry

    async def read(self, range: JournalRange | None = None) -> list[JournalEntry]:
        # Wait for pending appends so a read sees every entry appended before it.
        async with self._lock:
            return select_journal_range(self._read_file()[0], range)

    def _read_file(self) -> tuple[list[JournalEntry], bool, int | None]:
        """The entries in ``seq`` order; whether the file does not end in a newline;
        and, when that last line is also not a complete entry, its byte offset."""
        try:
            data = self.path.read_bytes()
        except FileNotFoundError:
            return [], False, None
        cut = data.rfind(b"\n") + 1
        tail = data[cut:].decode("utf-8", errors="replace")
        entries = parse_journal(data[:cut].decode("utf-8"))
        torn_at: int | None = None
        if tail.strip() != "":
            try:
                entries.extend(parse_journal(tail))
            except ValueError:
                torn_at = cut
        entries.sort(key=lambda entry: entry.seq)
        return entries, tail != "", torn_at
