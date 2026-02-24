"""
Adapter Registry.

Manages registration and lookup of app adapters.
Supports a global singleton registry for convenience.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from afd.testing.adapters.types import AppAdapter


@dataclass
class AdapterRegistryOptions:
    """Options for creating an adapter registry.

    Attributes:
        adapters: Adapters to register initially.
        default_adapter: Default adapter name when detection fails.
    """

    adapters: list[AppAdapter] = field(default_factory=list)
    default_adapter: str | None = None


class AdapterRegistry:
    """Registry for managing multiple app adapters.

    Example:
        >>> registry = AdapterRegistry()
        >>> registry.register(my_adapter)
        >>> adapter = registry.get("todo")
        >>> assert adapter is not None
    """

    def __init__(self, options: AdapterRegistryOptions | None = None) -> None:
        self._adapters: dict[str, AppAdapter] = {}
        self._default_adapter: str | None = None

        if options:
            self._default_adapter = options.default_adapter
            for adapter in options.adapters:
                self._adapters[adapter.name] = adapter

    def register(self, adapter: AppAdapter) -> None:
        """Register an adapter.

        Args:
            adapter: The adapter to register.

        Raises:
            ValueError: If an adapter with the same name is already registered.
        """
        if adapter.name in self._adapters:
            raise ValueError(f"Adapter '{adapter.name}' is already registered")
        self._adapters[adapter.name] = adapter

    def get(self, name: str) -> AppAdapter | None:
        """Get adapter by name.

        Args:
            name: Adapter name.

        Returns:
            The adapter, or None if not found.
        """
        return self._adapters.get(name)

    def list(self) -> list[AppAdapter]:
        """List all registered adapters.

        Returns:
            List of all registered adapters.
        """
        return list(self._adapters.values())

    def detect(self, fixture: Any) -> AppAdapter | None:
        """Detect adapter from fixture data.

        Checks the fixture's 'app' field first, then falls back to
        the default adapter.

        Args:
            fixture: Fixture data (dict-like).

        Returns:
            Detected adapter, or None.
        """
        if isinstance(fixture, dict) and isinstance(fixture.get('app'), str):
            adapter = self._adapters.get(fixture['app'])
            if adapter:
                return adapter

        if self._default_adapter:
            return self._adapters.get(self._default_adapter)

        return None

    def has(self, name: str) -> bool:
        """Check if an adapter is registered.

        Args:
            name: Adapter name.

        Returns:
            True if adapter exists.
        """
        return name in self._adapters


# ============================================================================
# Global Registry
# ============================================================================

_global_registry: AdapterRegistry | None = None


def get_global_registry() -> AdapterRegistry:
    """Get the global adapter registry.

    Creates one if it doesn't exist.

    Returns:
        The global AdapterRegistry.
    """
    global _global_registry
    if _global_registry is None:
        _global_registry = AdapterRegistry()
    return _global_registry


def set_global_registry(registry: AdapterRegistry) -> None:
    """Set the global adapter registry.

    Args:
        registry: The registry to set as global.
    """
    global _global_registry
    _global_registry = registry


def reset_global_registry() -> None:
    """Reset the global adapter registry."""
    global _global_registry
    _global_registry = None


# ============================================================================
# Convenience Functions
# ============================================================================


def create_adapter_registry(options: AdapterRegistryOptions | None = None) -> AdapterRegistry:
    """Create an adapter registry.

    Args:
        options: Registry options (initial adapters, default adapter).

    Returns:
        A new AdapterRegistry instance.
    """
    return AdapterRegistry(options)


def register_adapter(adapter: AppAdapter) -> None:
    """Register an adapter in the global registry.

    Args:
        adapter: The adapter to register.
    """
    get_global_registry().register(adapter)


def get_adapter(name: str) -> AppAdapter | None:
    """Get an adapter from the global registry.

    Args:
        name: Adapter name.

    Returns:
        The adapter, or None if not found.
    """
    return get_global_registry().get(name)


def list_adapters() -> list[AppAdapter]:
    """List all adapters in the global registry.

    Returns:
        List of all registered adapters.
    """
    return get_global_registry().list()


def detect_adapter(fixture: Any) -> AppAdapter | None:
    """Detect adapter for a fixture from the global registry.

    Args:
        fixture: Fixture data.

    Returns:
        Detected adapter, or None.
    """
    return get_global_registry().detect(fixture)
