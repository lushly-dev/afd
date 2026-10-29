"""Explicit per-invocation worktree context; never changes process cwd."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path


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
        if self.profile not in {"inspection", "trusted-local"}:
            raise ValueError("Unknown execution profile; use inspection or trusted-local")
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


def current_context() -> ExecutionContext | None:
    return _current.get()


@contextmanager
def use_context(context: ExecutionContext):
    token = _current.set(context)
    try:
        yield
    finally:
        _current.reset(token)
