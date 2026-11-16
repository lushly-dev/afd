"""Explicit per-invocation worktree context; never changes process cwd."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path
from typing import Any

#: The effects each execution profile admits; ``None`` admits every declared effect.
#: ``inspection`` reads only. ``remote-caller`` is for callers a surface has authenticated
#: over the network (botcore's HTTP surface): it admits service calls and the host's own
#: history, never a subprocess, a source write or raw Python, so a remote caller gets none
#: of the local trust ``trusted-local`` implies. A host narrows it further per command.
PROFILE_EFFECTS: dict[str, frozenset[str] | None] = {
    "inspection": frozenset({"inspect"}),
    "remote-caller": frozenset({"inspect", "service", "history-write"}),
    "trusted-local": None,
}


@dataclass(frozen=True)
class ExecutionContext:
    """A target directory inside one worktree and an explicit execution profile.

    Restricted profiles are cooperative command policy, not a Python sandbox.
    """

    workspace: Path
    target: Path | None = None
    profile: str = "inspection"

    def __post_init__(self) -> None:
        root = self.workspace.resolve(strict=True)
        target = self.target or root
        target = (
            (root / target).resolve(strict=True)
            if not target.is_absolute()
            else target.resolve(strict=True)
        )
        if not root.is_dir() or not target.is_dir() or not target.is_relative_to(root):
            raise ValueError("Target must be an existing directory inside the worktree")
        if self.profile not in PROFILE_EFFECTS:
            raise ValueError(
                f"Unknown execution profile; use one of: {', '.join(sorted(PROFILE_EFFECTS))}"
            )
        object.__setattr__(self, "workspace", root)
        object.__setattr__(self, "target", target)

    def resolve_path(self, value: str) -> str:
        path = (self.target / value).resolve()
        if not path.is_relative_to(self.target):
            raise ValueError(f"Path is outside the selected target: {value}")
        return str(path)


_current: ContextVar[ExecutionContext | None] = ContextVar(
    "botcore_execution_context", default=None
)


_call: ContextVar[Any] = ContextVar("botcore_call_context", default=None)


def current_call() -> Any:
    """The AFD ``CommandContext`` of the host call in progress, or ``None`` outside one.

    A host builds one per call (``CommandHost.execute``), carrying the caller a surface
    verified as ``actor``, so a handler can read who is calling without taking it as input.
    """
    return _call.get()


@contextmanager
def use_call(context: Any):
    token = _call.set(context)
    try:
        yield
    finally:
        _call.reset(token)


def current_context() -> ExecutionContext | None:
    return _current.get()


@contextmanager
def use_context(context: ExecutionContext):
    token = _current.set(context)
    try:
        yield
    finally:
        _current.reset(token)
