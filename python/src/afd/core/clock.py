"""Injectable time and randomness for command handlers.

Handlers that call ``time.time()`` or ``random.random()`` directly cannot be
tested deterministically or replayed. AFD surfaces put a ``clock`` and a
``random`` source on every ``CommandContext`` (real ones by default), and
tests, replays and simulations swap in :func:`fixed_clock` and
:func:`seeded_random`.

Mirrors ``packages/core/src/clock.ts``. :func:`seeded_random` gives the same
sequence as TypeScript's ``seededRandom`` for the same seed.

Example:
    >>> clock = fixed_clock("2026-01-01T00:00:00Z")
    >>> clock.now()
    1767225600000
    >>> clock.advance(1000)
    >>> clock.now()
    1767225601000
"""

from __future__ import annotations

import math
import random as _random
import time
from datetime import datetime, timedelta, timezone
from typing import Optional, Protocol, Union

__all__ = [
    "Clock",
    "ClockInstant",
    "ManualClock",
    "RandomSource",
    "fixed_clock",
    "seeded_random",
    "system_clock",
    "system_random",
]


class Clock(Protocol):
    """A source of the current time."""

    def now(self) -> float:
        """Milliseconds since the Unix epoch, like JavaScript's ``Date.now()``."""
        ...


class ManualClock(Clock, Protocol):
    """A clock that only moves when told to, from :func:`fixed_clock`."""

    def set(self, at: "ClockInstant") -> None:
        """Move the clock to ``at`` (epoch milliseconds, an ISO string or a ``datetime``)."""
        ...

    def advance(self, ms: float) -> None:
        """Move the clock forward by ``ms`` milliseconds (backward when negative)."""
        ...


class RandomSource(Protocol):
    """A source of random numbers.

    Seeded sources (from :func:`seeded_random`) also have a ``seed`` attribute,
    the seed they were created from, for journals and replay; unseeded ones
    have ``seed = None``.
    """

    def next(self) -> float:
        """A number in [0, 1), like ``random.random()``."""
        ...


ClockInstant = Union[int, float, str, datetime]
"""An instant accepted by :func:`fixed_clock`: epoch milliseconds, an ISO 8601 string or a ``datetime``."""


class _SystemClock:
    """The real clock: wall time in epoch milliseconds."""

    __slots__ = ()

    def now(self) -> float:
        return time.time_ns() / 1_000_000

    def __repr__(self) -> str:
        return "system_clock"


class _SystemRandom:
    """The real random source: ``random.random()``. Not seeded, so not reproducible."""

    __slots__ = ()
    seed: Optional[str] = None

    def next(self) -> float:
        return _random.random()

    def __repr__(self) -> str:
        return "system_random"


system_clock: Clock = _SystemClock()
"""The real clock: wall time in milliseconds since the epoch."""

system_random: RandomSource = _SystemRandom()
"""The real random source: ``random.random()``. Not seeded, so not reproducible."""


_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _to_epoch_ms(at: ClockInstant) -> float:
    if isinstance(at, bool):
        raise ValueError(f"Invalid clock instant: {at!r}")
    if isinstance(at, datetime):
        # A naive datetime is taken as UTC, so a test reads the same everywhere.
        moment = at if at.tzinfo is not None else at.replace(tzinfo=timezone.utc)
        return (moment - _EPOCH) // timedelta(milliseconds=1)
    if isinstance(at, str):
        text = at.strip()
        if text.endswith(("Z", "z")):
            text = text[:-1] + "+00:00"
        try:
            return _to_epoch_ms(datetime.fromisoformat(text))
        except ValueError:
            raise ValueError(f"Invalid clock instant: {at!r}") from None
    if isinstance(at, (int, float)) and math.isfinite(at):
        return at
    raise ValueError(f"Invalid clock instant: {at!r}")


class _FixedClock:
    """A clock stopped at an instant; it moves only through ``set`` and ``advance``."""

    __slots__ = ("_current",)

    def __init__(self, at: ClockInstant) -> None:
        self._current = _to_epoch_ms(at)

    def now(self) -> float:
        return self._current

    def set(self, at: ClockInstant) -> None:
        self._current = _to_epoch_ms(at)

    def advance(self, ms: float) -> None:
        if isinstance(ms, bool) or not isinstance(ms, (int, float)) or not math.isfinite(ms):
            raise ValueError(f"Invalid clock advance: {ms!r}")
        self._current += ms

    def __repr__(self) -> str:
        return f"fixed_clock({self._current!r})"


def fixed_clock(at: ClockInstant = 0) -> ManualClock:
    """A clock stopped at ``at``. It moves only through ``set()`` and ``advance()``.

    ``at`` is epoch milliseconds, an ISO 8601 string or a ``datetime`` (a
    naive ``datetime`` is taken as UTC). Strings and datetimes resolve to
    whole milliseconds, like a JavaScript ``Date``.

    Raises:
        ValueError: when ``at`` is not a valid instant.

    Example:
        >>> clock = fixed_clock("2026-01-01T00:00:00Z")
        >>> clock.now()
        1767225600000
    """
    return _FixedClock(at)


_MASK = 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    """The low 32 bits of ``a * b``, like JavaScript's ``Math.imul`` (unsigned)."""
    return (a * b) & _MASK


def _fnv1a(text: str) -> int:
    """FNV-1a (32-bit) over the UTF-8 bytes of ``text``."""
    hash_ = 0x811C9DC5
    for byte in text.encode("utf-8"):
        hash_ ^= byte
        hash_ = _imul(hash_, 0x01000193)
    return hash_


class _SeededRandom:
    """mulberry32 seeded with FNV-1a, bit-for-bit compatible with TypeScript."""

    __slots__ = ("seed", "_state")

    def __init__(self, seed: str) -> None:
        self.seed: Optional[str] = seed
        self._state = _fnv1a(seed)

    def next(self) -> float:
        self._state = (self._state + 0x6D2B79F5) & _MASK
        t = self._state
        t = _imul(t ^ (t >> 15), t | 1)
        t ^= (t + _imul(t ^ (t >> 7), t | 61)) & _MASK
        return ((t ^ (t >> 14)) & _MASK) / 4294967296

    def __repr__(self) -> str:
        return f"seeded_random({self.seed!r})"


def seeded_random(seed: str) -> RandomSource:
    """A reproducible random source: the same seed always gives the same sequence.

    The generator is mulberry32, seeded with the FNV-1a (32-bit) hash of the
    seed's UTF-8 bytes, so it matches TypeScript's ``seededRandom`` value for
    value. It is fast and well distributed, and not suitable for secrets: use
    :mod:`secrets` for tokens and keys.

    Example:
        >>> random = seeded_random("abc")
        >>> random.next()
        0.5166419988963753
    """
    if not isinstance(seed, str):
        raise TypeError(f"seed must be a string, got {type(seed).__name__}")
    return _SeededRandom(seed)
