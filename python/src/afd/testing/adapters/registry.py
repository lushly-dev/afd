"""
Adapter registry implementation.

Manages registration and lookup of app adapters.

Port of packages/testing/src/adapters/registry.ts
"""

from __future__ import annotations

from typing import Any

from afd.testing.adapters.types import (
	AdapterRegistryOptions,
	AppAdapter,
)


class _AdapterRegistryImpl:
	"""Concrete adapter registry implementation."""

	def __init__(self, options: AdapterRegistryOptions | None = None) -> None:
		opts = options or AdapterRegistryOptions()
		self._adapters: dict[str, AppAdapter] = {}
		self._default_adapter = opts.default_adapter

		for adapter in opts.adapters or []:
			self._adapters[adapter.name] = adapter

	def register(self, adapter: AppAdapter) -> None:
		if adapter.name in self._adapters:
			raise ValueError(f"Adapter '{adapter.name}' is already registered")
		self._adapters[adapter.name] = adapter

	def get(self, name: str) -> AppAdapter | None:
		return self._adapters.get(name)

	def list(self) -> list[AppAdapter]:
		return list(self._adapters.values())

	def detect(self, fixture: Any) -> AppAdapter | None:
		if _is_fixture_with_app(fixture):
			adapter = self._adapters.get(fixture["app"])
			if adapter:
				return adapter

		for adapter in self._adapters.values():
			if _can_adapter_handle_fixture(adapter, fixture):
				return adapter

		if self._default_adapter:
			return self._adapters.get(self._default_adapter)

		return None

	def has(self, name: str) -> bool:
		return name in self._adapters


def _is_fixture_with_app(fixture: Any) -> bool:
	"""Check if fixture has an 'app' field."""
	return isinstance(fixture, dict) and isinstance(fixture.get("app"), str)


def _can_adapter_handle_fixture(adapter: AppAdapter, fixture: Any) -> bool:
	"""Check if an adapter can handle a fixture based on its schema."""
	if adapter.fixture.validate:
		return False

	if _is_fixture_with_app(fixture):
		return fixture["app"] == adapter.name

	return False


def create_adapter_registry(
	options: AdapterRegistryOptions | None = None,
) -> _AdapterRegistryImpl:
	"""Create an adapter registry."""
	return _AdapterRegistryImpl(options)


# ---------------------------------------------------------------------------
# Global registry
# ---------------------------------------------------------------------------

_global_registry: _AdapterRegistryImpl | None = None


def get_global_registry() -> _AdapterRegistryImpl:
	"""Get the global adapter registry. Creates one if it doesn't exist."""
	global _global_registry
	if _global_registry is None:
		_global_registry = create_adapter_registry()
	return _global_registry


def set_global_registry(registry: _AdapterRegistryImpl) -> None:
	"""Set the global adapter registry."""
	global _global_registry
	_global_registry = registry


def reset_global_registry() -> None:
	"""Reset the global adapter registry."""
	global _global_registry
	_global_registry = None


def register_adapter(adapter: AppAdapter) -> None:
	"""Register an adapter in the global registry."""
	get_global_registry().register(adapter)


def get_adapter(name: str) -> AppAdapter | None:
	"""Get an adapter from the global registry."""
	return get_global_registry().get(name)


def list_adapters() -> list[AppAdapter]:
	"""List all adapters in the global registry."""
	return get_global_registry().list()


def detect_adapter(fixture: Any) -> AppAdapter | None:
	"""Detect adapter for a fixture from the global registry."""
	return get_global_registry().detect(fixture)
