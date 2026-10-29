"""botcore-memory — Agent memory plugin for botcore."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from botcore.plugin import PluginRegistry
    from pydantic import BaseModel

    from .models import MemoryConfig


class MemoryPlugin:
    """Persistent memory for agents across tasks and sessions."""

    def configure(self, config: MemoryConfig) -> None:
        """Inject validated plugin config into command runtime."""
        from .commands import configure

        configure(config)

    def register(self, registry: PluginRegistry) -> None:
        """Register memory commands and documentation."""
        from .commands import MEMORY_COMMANDS, MEMORY_DOCS

        registry.add_commands(MEMORY_COMMANDS)
        registry.set_mcp_name("memory")
        registry.add_docs("memory", MEMORY_DOCS)

    def config_schema(self) -> type[BaseModel] | None:
        """Return the MemoryConfig Pydantic model for validation."""
        from .models import MemoryConfig

        return MemoryConfig
