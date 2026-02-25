"""Tests for the AFD adapter registry — registry functionality."""

from __future__ import annotations

from typing import Any

import pytest

from afd.testing.adapters import (
    AdapterCliConfig,
    AdapterContext,
    AdapterRegistryOptions,
    AppAdapter,
    ApplyFixtureResult,
    CommandsConfig,
    ErrorsConfig,
    FixtureConfig,
    FixtureValidationResult,
    JobsConfig,
    create_adapter_registry,
    detect_adapter,
    get_adapter,
    get_global_registry,
    list_adapters,
    register_adapter,
    reset_global_registry,
    set_global_registry,
)


# ==============================================================================
# Helpers
# ==============================================================================


def _make_adapter(name: str = "test-app", version: str = "1.0.0") -> AppAdapter:
    """Create a minimal AppAdapter for testing."""

    async def _noop_apply(_fixture: Any, _ctx: AdapterContext) -> ApplyFixtureResult:
        return ApplyFixtureResult()

    async def _noop_reset(_ctx: AdapterContext) -> None:
        pass

    return AppAdapter(
        name=name,
        version=version,
        cli=AdapterCliConfig(command=name),
        fixture=FixtureConfig(apply=_noop_apply, reset=_noop_reset),
        commands=CommandsConfig(list=lambda: []),
        errors=ErrorsConfig(list=lambda: []),
        jobs=JobsConfig(list=lambda: []),
    )


def _make_adapter_with_validate(
    name: str,
    validate_fn: Any = None,
) -> AppAdapter:
    """Create an adapter that has a validate function on its fixture config."""

    async def _noop_apply(_fixture: Any, _ctx: AdapterContext) -> ApplyFixtureResult:
        return ApplyFixtureResult()

    async def _noop_reset(_ctx: AdapterContext) -> None:
        pass

    return AppAdapter(
        name=name,
        version="1.0.0",
        cli=AdapterCliConfig(command=name),
        fixture=FixtureConfig(
            apply=_noop_apply,
            reset=_noop_reset,
            validate=validate_fn,
        ),
        commands=CommandsConfig(list=lambda: []),
        errors=ErrorsConfig(list=lambda: []),
        jobs=JobsConfig(list=lambda: []),
    )


@pytest.fixture(autouse=True)
def _reset_global():
    """Reset the global adapter registry after every test."""
    yield
    reset_global_registry()


# ==============================================================================
# Registry: create, register, get, list, has
# ==============================================================================


class TestAdapterRegistry:
    """Tests for create_adapter_registry and _AdapterRegistryImpl."""

    def test_create_empty_registry(self):
        """Should create an empty registry with no options."""
        registry = create_adapter_registry()
        assert registry.list() == []

    def test_create_registry_with_initial_adapters(self):
        """Should pre-register adapters from options."""
        a1 = _make_adapter("app-a")
        a2 = _make_adapter("app-b")
        registry = create_adapter_registry(
            AdapterRegistryOptions(adapters=[a1, a2])
        )
        assert len(registry.list()) == 2
        assert registry.has("app-a")
        assert registry.has("app-b")

    def test_register_adapter(self):
        """Should register a new adapter."""
        registry = create_adapter_registry()
        adapter = _make_adapter("my-app")
        registry.register(adapter)
        assert registry.has("my-app")

    def test_get_registered_adapter(self):
        """Should return the adapter by name."""
        registry = create_adapter_registry()
        adapter = _make_adapter("my-app")
        registry.register(adapter)
        result = registry.get("my-app")
        assert result is adapter

    def test_get_missing_adapter_returns_none(self):
        """Should return None for an unregistered name."""
        registry = create_adapter_registry()
        assert registry.get("nonexistent") is None

    def test_list_returns_all_adapters(self):
        """Should list all registered adapters."""
        registry = create_adapter_registry()
        registry.register(_make_adapter("a"))
        registry.register(_make_adapter("b"))
        registry.register(_make_adapter("c"))
        names = [a.name for a in registry.list()]
        assert sorted(names) == ["a", "b", "c"]

    def test_has_returns_true_for_registered(self):
        """Should return True when adapter is registered."""
        registry = create_adapter_registry()
        registry.register(_make_adapter("x"))
        assert registry.has("x") is True

    def test_has_returns_false_for_unregistered(self):
        """Should return False when adapter is not registered."""
        registry = create_adapter_registry()
        assert registry.has("nope") is False

    def test_duplicate_registration_raises_error(self):
        """Should raise ValueError when registering the same name twice."""
        registry = create_adapter_registry()
        registry.register(_make_adapter("dup"))
        with pytest.raises(ValueError, match="already registered"):
            registry.register(_make_adapter("dup"))

    def test_duplicate_via_options_and_register_raises_error(self):
        """Should raise ValueError when registering a name already in options."""
        adapter = _make_adapter("pre")
        registry = create_adapter_registry(
            AdapterRegistryOptions(adapters=[adapter])
        )
        with pytest.raises(ValueError, match="already registered"):
            registry.register(_make_adapter("pre"))


# ==============================================================================
# Registry detect
# ==============================================================================


class TestAdapterRegistryDetect:
    """Tests for the detect method on the adapter registry."""

    def test_detect_by_app_field(self):
        """Should detect an adapter by the fixture 'app' field."""
        adapter = _make_adapter("todo")
        registry = create_adapter_registry(
            AdapterRegistryOptions(adapters=[adapter])
        )
        result = registry.detect({"app": "todo", "data": []})
        assert result is adapter

    def test_detect_returns_none_for_unknown_app(self):
        """Should return None when 'app' field doesn't match any adapter."""
        registry = create_adapter_registry()
        registry.register(_make_adapter("known"))
        result = registry.detect({"app": "unknown"})
        assert result is None

    def test_detect_falls_back_to_default_adapter(self):
        """Should fall back to default_adapter when no match is found."""
        fallback = _make_adapter("fallback")
        registry = create_adapter_registry(
            AdapterRegistryOptions(
                adapters=[fallback],
                default_adapter="fallback",
            )
        )
        result = registry.detect({"something": "else"})
        assert result is fallback

    def test_detect_returns_none_when_no_default_and_no_match(self):
        """Should return None when nothing matches and no default is set."""
        registry = create_adapter_registry()
        registry.register(_make_adapter("only-one"))
        result = registry.detect({"random": "fixture"})
        assert result is None

    def test_detect_with_non_dict_fixture(self):
        """Should return None for non-dict fixture when no default."""
        registry = create_adapter_registry()
        registry.register(_make_adapter("something"))
        assert registry.detect("not a dict") is None
        assert registry.detect(42) is None
        assert registry.detect(None) is None

    def test_detect_prefers_app_field_over_default(self):
        """Should prefer app field match over default adapter."""
        specific = _make_adapter("specific")
        fallback = _make_adapter("fallback")
        registry = create_adapter_registry(
            AdapterRegistryOptions(
                adapters=[specific, fallback],
                default_adapter="fallback",
            )
        )
        result = registry.detect({"app": "specific"})
        assert result is specific

    def test_detect_with_validate_on_adapter_skips_it(self):
        """Adapter with validate function should not be matched via _can_adapter_handle_fixture."""
        # _can_adapter_handle_fixture returns False if adapter.fixture.validate is set.
        # This means the adapter won't match through the secondary detection path.
        async def _dummy_validate(_fixture: Any) -> FixtureValidationResult:
            return FixtureValidationResult(valid=True)

        adapter = _make_adapter_with_validate("validated", validate_fn=_dummy_validate)
        registry = create_adapter_registry(
            AdapterRegistryOptions(adapters=[adapter])
        )
        # Fixture has app matching adapter name but detection first checks _is_fixture_with_app
        # which returns the adapter directly since it matches by name.
        result = registry.detect({"app": "validated"})
        assert result is adapter

        # But if the app field doesn't match, the secondary path won't pick it up
        # because validate is set.
        result = registry.detect({"app": "other-name"})
        assert result is None

    def test_detect_secondary_path_without_validate(self):
        """Adapter without validate can be detected via _can_adapter_handle_fixture."""
        # _can_adapter_handle_fixture checks if fixture has app field matching adapter.name
        # and adapter.fixture.validate is None.
        adapter = _make_adapter("secondary")
        registry = create_adapter_registry(
            AdapterRegistryOptions(adapters=[adapter])
        )
        # The primary path checks fixture["app"], finds "secondary", returns adapter.
        result = registry.detect({"app": "secondary"})
        assert result is adapter


# ==============================================================================
# Global registry: get/set/reset, convenience functions
# ==============================================================================


class TestGlobalRegistry:
    """Tests for global registry management functions."""

    def test_get_global_registry_creates_new_if_none(self):
        """Should auto-create a registry if none exists."""
        reset_global_registry()
        registry = get_global_registry()
        assert registry is not None
        assert registry.list() == []

    def test_get_global_registry_returns_same_instance(self):
        """Should return the same instance on repeated calls."""
        reset_global_registry()
        r1 = get_global_registry()
        r2 = get_global_registry()
        assert r1 is r2

    def test_set_global_registry(self):
        """Should replace the global registry."""
        custom = create_adapter_registry()
        custom.register(_make_adapter("custom-app"))
        set_global_registry(custom)
        assert get_global_registry() is custom
        assert get_global_registry().has("custom-app")

    def test_reset_global_registry(self):
        """Should clear the global registry so a new one is created."""
        adapter = _make_adapter("temp")
        register_adapter(adapter)
        assert get_global_registry().has("temp")

        reset_global_registry()
        assert not get_global_registry().has("temp")


class TestConvenienceFunctions:
    """Tests for register_adapter, get_adapter, list_adapters, detect_adapter."""

    def test_register_adapter(self):
        """Should register into the global registry."""
        adapter = _make_adapter("conv-app")
        register_adapter(adapter)
        assert get_global_registry().has("conv-app")

    def test_get_adapter(self):
        """Should retrieve from the global registry."""
        adapter = _make_adapter("lookup")
        register_adapter(adapter)
        result = get_adapter("lookup")
        assert result is adapter

    def test_get_adapter_missing(self):
        """Should return None for unregistered adapter."""
        assert get_adapter("missing") is None

    def test_list_adapters(self):
        """Should list all adapters in the global registry."""
        register_adapter(_make_adapter("a1"))
        register_adapter(_make_adapter("a2"))
        names = [a.name for a in list_adapters()]
        assert "a1" in names
        assert "a2" in names

    def test_detect_adapter(self):
        """Should detect from the global registry."""
        register_adapter(_make_adapter("detect-me"))
        result = detect_adapter({"app": "detect-me"})
        assert result is not None
        assert result.name == "detect-me"

    def test_detect_adapter_no_match(self):
        """Should return None when no match in global registry."""
        assert detect_adapter({"app": "ghost"}) is None
