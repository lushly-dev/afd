"""Shared server-side configuration types."""

from __future__ import annotations

import asyncio
import math
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, runtime_checkable

from afd.core.commands import CommandDefinition

DEFAULT_COMMAND_TIMEOUT_MS = 30_000
"""Normative server-level default per-command deadline in milliseconds (``spec/execution-controls.md``)."""


def _resolve_default_timeout_ms(value: int | float | None) -> int | float | None:
    """Validate and normalize ``default_timeout_ms`` (``None`` or ``0`` disables)."""
    if value is None or (
        isinstance(value, (int, float)) and not isinstance(value, bool) and value == 0
    ):
        return None
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value < 0
    ):
        raise ValueError("default_timeout_ms must be a positive finite number, 0, or None")
    return value


def _consume_task_exception(task: asyncio.Task[Any]) -> None:
    if not task.cancelled():
        task.exception()


@runtime_checkable
class MCPTransport(Protocol):
    """Protocol for MCP transport implementations."""

    async def start(self) -> None: ...

    async def stop(self) -> None: ...


@dataclass(frozen=True)
class ContextConfig:
    """Configuration for a named tool context."""

    name: str
    description: str | None = None
    triggers: list[str] = field(default_factory=list)
    priority: int | None = None


ToolStrategy = Literal["individual", "grouped", "lazy", "hybrid"]
GroupByFn = Callable[[CommandDefinition], str | None]

__all__ = [
    "ContextConfig",
    "DEFAULT_COMMAND_TIMEOUT_MS",
    "GroupByFn",
    "MCPTransport",
    "ToolStrategy",
]
