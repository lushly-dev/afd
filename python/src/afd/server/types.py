"""Shared server-side configuration types."""

from typing import Callable, Literal, Optional

from afd.core.commands import CommandDefinition
from afd.server.bootstrap.afd_context import ContextConfig

ToolStrategy = Literal["individual", "grouped", "lazy"]
GroupByFn = Callable[[CommandDefinition], Optional[str]]

# ContextConfig is re-exported: the server factory and bootstrap import it from here.
__all__ = ["ContextConfig", "GroupByFn", "ToolStrategy"]
