"""What every command receives: the world, the lane's state, the adapter and the target.

A host binds one ``Factory`` when it is built. ``bind`` is the injection seam: a test or the
scenario harness builds a host inside ``bind(world=...)`` and every command of that host uses
that world; a host built without it uses the real world of its target checkout.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from contextvars import ContextVar
from dataclasses import dataclass, field
from pathlib import Path

from afd import CommandResult, error

from botcore_factory.adapter import FactoryConfig
from botcore_factory.labels import DefinitionsError, load_definitions
from botcore_factory.state import StateError, StateLocked, StateStore
from botcore_factory.world import World, WorldError

DEFAULT_LIMIT = 100
MAX_LIMIT = 500


@dataclass(frozen=True)
class Bindings:
    world: World | None = None
    state_base: Path | None = None


_NONE = Bindings()
_bindings: ContextVar[Bindings | None] = ContextVar("botcore_factory_bindings", default=None)


@contextlib.contextmanager
def bind(world: World | None = None, state_base: Path | None = None) -> Iterator[None]:
    """Build hosts inside this block to give their commands ``world`` and a state directory."""
    token = _bindings.set(Bindings(world, state_base))
    try:
        yield
    finally:
        _bindings.reset(token)


def current_bindings() -> Bindings:
    return _bindings.get() or _NONE


class Refusal(Exception):
    """A command's named refusal, raised from deep in its logic and returned as an error."""

    def __init__(self, code: str, message: str, suggestion: str, **details) -> None:
        super().__init__(message)
        self.code, self.message, self.suggestion, self.details = code, message, suggestion, details

    def result(self) -> CommandResult:
        return error(
            self.code, self.message, suggestion=self.suggestion, details=self.details or None
        )


@dataclass
class Factory:
    """One host's view of its repository."""

    world: World
    config: FactoryConfig
    target: Path
    state_base: Path | None = None
    _store: StateStore | None = field(default=None, repr=False)

    @property
    def store(self) -> StateStore:
        """The lane state of this repository (its name read once from GitHub)."""
        if self._store is None:
            try:
                repository = self.world.github.repository()
            except WorldError as exc:
                raise Refusal(
                    "READ_FAILED",
                    f"Could not read the repository's name from GitHub: {exc}",
                    "Check `gh auth status` and the checkout's origin, then retry",
                ) from exc
            self._store = StateStore.for_repository(
                repository, self.world.processes, self.world.clock, base=self.state_base
            )
        return self._store

    def definitions(self) -> list[dict]:
        if not self.config.labels:
            raise Refusal(
                "NOT_CONFIGURED",
                "The repository adapter does not say where the label definitions live",
                "Set labels under [plugins.factory] in botcore.toml (or "
                "[tool.botcore.plugins.factory] in pyproject.toml), e.g. .github/labels.json",
            )
        try:
            return load_definitions(self.target / self.config.labels)
        except DefinitionsError as exc:
            raise Refusal(
                "ADAPTER_INVALID",
                f"{self.config.labels}: {exc}",
                "Fix the label definitions file the adapter names, then retry",
            ) from exc


def guarded(run) -> CommandResult:
    """Run a command body, turning named refusals and outside failures into errors."""
    try:
        return run()
    except Refusal as refusal:
        return refusal.result()
    except WorldError as exc:
        return error(
            "READ_FAILED",
            str(exc),
            suggestion="Check `gh auth status`, the network and the checkout, then retry; "
            "a failed read is never reported as nothing to do",
        )
    except StateLocked as exc:
        return error(
            "STATE_LOCKED",
            str(exc),
            suggestion="Another factory command is writing the lane's state; retry in a moment",
        )
    except (StateError, OSError) as exc:
        return error(
            "STATE_UNAVAILABLE",
            str(exc),
            suggestion="Check the lane's data directory (BOTCORE_FACTORY_DATA_DIR overrides it)",
        )


def page(items: list, limit: int | None, cursor: str | None) -> tuple[list, int]:
    """One page of ``items`` and the offset after it."""
    start = parse_cursor(cursor)
    size = DEFAULT_LIMIT if limit is None else limit
    if size < 1 or size > MAX_LIMIT:
        raise Refusal(
            "VALIDATION_ERROR",
            f"limit must be between 1 and {MAX_LIMIT}; got {size}",
            f"Pass a limit from 1 to {MAX_LIMIT}, or leave it out for {DEFAULT_LIMIT}",
        )
    return items[start : start + size], start + size


def paginate(lists: dict[str, list], limit: int | None, cursor: str | None) -> dict:
    """Bound every list to one page; ``nextCursor`` continues them, ``total`` counts them."""
    out: dict = {}
    more = False
    end = 0
    for key, items in lists.items():
        out[key], end = page(items, limit, cursor)
        more = more or len(items) > end
    out["total"] = {key: len(items) for key, items in lists.items()}
    if more:
        out["nextCursor"] = str(end)
    return out


def parse_cursor(cursor: str | None) -> int:
    if cursor is None:
        return 0
    if not cursor.isdigit():
        raise Refusal(
            "VALIDATION_ERROR",
            f"Not a cursor this command returned: {cursor!r}",
            "Pass the nextCursor of the previous page, or leave cursor out for the first page",
        )
    return int(cursor)
