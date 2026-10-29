"""Botcore plugin contract and discovery."""

from __future__ import annotations

import importlib.metadata
import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel

logger = logging.getLogger(__name__)


@runtime_checkable
class BotCorePlugin(Protocol):
    """Protocol that all botcore plugins must implement."""

    def register(self, registry: PluginRegistry) -> None:
        """Register commands, skills, and other extensions."""
        ...

    def config_schema(self) -> type[BaseModel] | None:
        """Return Pydantic model for [tool.botcore.plugins.<name>] validation.

        Return None if plugin needs no config.
        """
        ...


class PluginRegistry:
    """Collects registrations from plugins during startup."""

    def __init__(self, *, cli_name: str | None = None, mcp_name: str | None = None) -> None:
        self._host_cli_name = cli_name
        self._host_mcp_name = mcp_name
        self._commands: list[Callable[..., Any]] = []
        self._skills_dirs: list[Path] = []
        self._cli_name: str | None = None
        self._mcp_name: str | None = None
        self._config_defaults: dict[str, Any] = {}
        self._docs: dict[str, str] = {}
        self._middleware: list[Callable[..., Any]] = []

    def add_commands(self, commands: list[Callable[..., Any]]) -> None:
        """Register command functions."""
        names = {command.__name__ for command in self._commands}
        for command in commands:
            if command.__name__ in names:
                raise ValueError(f"Duplicate command: {command.__name__}")
            names.add(command.__name__)
        self._commands.extend(commands)

    def add_skills_dir(self, path: Path) -> None:
        """Register a skill directory."""
        self._skills_dirs.append(path)

    def set_cli_name(self, name: str) -> None:
        """Set CLI branding name."""
        if self._host_cli_name is not None:
            return  # Host identity wins over legacy plugin branding requests.
        if self._cli_name is not None and self._cli_name != name:
            raise ValueError("Conflicting plugin CLI identities; set a host identity")
        self._cli_name = name

    def set_mcp_name(self, name: str) -> None:
        """Set MCP server identity."""
        if self._host_mcp_name is not None:
            return
        if self._mcp_name is not None and self._mcp_name != name:
            raise ValueError("Conflicting plugin MCP identities; set a host identity")
        self._mcp_name = name

    def add_docs(self, topic: str, content: str) -> None:
        """Register documentation for a topic (shown via {name}-docs tool)."""
        if topic in self._docs:
            raise ValueError(f"Duplicate documentation topic: {topic}")
        self._docs[topic] = content

    def add_middleware(self, middleware: Callable[..., Any]) -> None:
        """Register a middleware callable for command pre/post-processing.

        Middleware signature: (name, args, context, next_fn) -> CommandResult.
        Applied around every command execution via MiddlewareRegistry.
        """
        self._middleware.append(middleware)

    def config_defaults(self) -> dict[str, Any]:
        """Return plugin config defaults."""
        return dict(self._config_defaults)

    @property
    def commands(self) -> list[Callable[..., Any]]:
        return list(self._commands)

    @property
    def skills_dirs(self) -> list[Path]:
        return list(self._skills_dirs)

    @property
    def cli_name(self) -> str | None:
        return self._host_cli_name or self._cli_name

    @property
    def mcp_name(self) -> str | None:
        return self._host_mcp_name or self._mcp_name

    @property
    def docs(self) -> dict[str, str]:
        return dict(self._docs)

    @property
    def middleware(self) -> list[Callable[..., Any]]:
        return list(self._middleware)


def discover_plugins(allowlist: tuple[str, ...] | None = None) -> dict[str, BotCorePlugin]:
    """Discover installed plugins via the botcore.plugins entry point group.

    Returns:
        Dict mapping plugin name to loaded plugin instance.
    """
    plugins: dict[str, BotCorePlugin] = {}

    eps = importlib.metadata.entry_points()
    if hasattr(eps, "select"):
        botcore_eps = eps.select(group="botcore.plugins")
    else:
        botcore_eps = eps.get("botcore.plugins", [])

    selected = [ep for ep in botcore_eps if allowlist is None or ep.name in allowlist]
    names = [ep.name for ep in selected]
    if len(names) != len(set(names)):
        raise ValueError("Duplicate botcore.plugins entry-point names")
    if allowlist is not None and set(allowlist) - set(names):
        raise ValueError(f"Requested plugins unavailable: {sorted(set(allowlist) - set(names))}")
    for ep in sorted(selected, key=lambda ep: ep.name):
        try:
            plugin_cls = ep.load()
            # Support both class-based (instantiate) and instance-based plugins
            plugin = plugin_cls() if isinstance(plugin_cls, type) else plugin_cls
            plugins[ep.name] = plugin
        except Exception:
            if allowlist is not None:
                raise  # Explicit selection must fail closed, never silently omit a plugin.
            logger.warning("Failed to load plugin entry point '%s'", ep.name, exc_info=True)

    return plugins
