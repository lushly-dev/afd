"""Tests for the AFD adapter registry module."""

from __future__ import annotations

from typing import Any

import pytest

from afd.testing.adapters import (
    AdapterCliConfig,
    AdapterContext,
    AdapterRegistryOptions,
    AppAdapter,
    AppliedCommand,
    ApplyFixtureResult,
    CommandsConfig,
    ErrorsConfig,
    FixtureConfig,
    FixtureValidationResult,
    JobsConfig,
    create_adapter_registry,
    create_generic_adapter,
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


# ==============================================================================
# Generic adapter: creation with defaults and custom options
# ==============================================================================


class TestCreateGenericAdapter:
    """Tests for create_generic_adapter factory function."""

    def test_default_values(self):
        """Should create a generic adapter with sensible defaults."""
        adapter = create_generic_adapter()
        assert adapter.name == "generic"
        assert adapter.version == "1.0.0"
        assert adapter.cli.command == "generic"
        assert adapter.cli.input_format == "json-arg"
        assert adapter.cli.output_format == "json"
        assert adapter.cli.default_args is None
        assert adapter.commands.list() == []
        assert adapter.errors.list() == []
        assert adapter.jobs.list() == []

    def test_custom_name_and_version(self):
        """Should accept custom name and version."""
        adapter = create_generic_adapter("my-app", "2.3.0")
        assert adapter.name == "my-app"
        assert adapter.version == "2.3.0"

    def test_custom_cli_command(self):
        """Should use cli_command when provided."""
        adapter = create_generic_adapter("app", cli_command="/usr/bin/app")
        assert adapter.cli.command == "/usr/bin/app"

    def test_cli_command_defaults_to_name(self):
        """CLI command should default to the adapter name."""
        adapter = create_generic_adapter("my-tool")
        assert adapter.cli.command == "my-tool"

    def test_custom_default_args(self):
        """Should pass default_args to cli config."""
        adapter = create_generic_adapter(default_args=["--verbose", "--json"])
        assert adapter.cli.default_args == ["--verbose", "--json"]

    def test_custom_input_output_format(self):
        """Should accept custom input/output formats."""
        adapter = create_generic_adapter(
            input_format="flags",
            output_format="text",
        )
        assert adapter.cli.input_format == "flags"
        assert adapter.cli.output_format == "text"

    def test_custom_commands_list(self):
        """Should expose the provided command names."""
        adapter = create_generic_adapter(commands=["todo-create", "todo-list"])
        assert adapter.commands.list() == ["todo-create", "todo-list"]

    def test_custom_errors_list(self):
        """Should expose the provided error codes."""
        adapter = create_generic_adapter(errors=["NOT_FOUND", "UNAUTHORIZED"])
        assert adapter.errors.list() == ["NOT_FOUND", "UNAUTHORIZED"]

    def test_custom_jobs_list(self):
        """Should expose the provided job names."""
        adapter = create_generic_adapter(jobs=["manage-todos", "view-reports"])
        assert adapter.jobs.list() == ["manage-todos", "view-reports"]

    def test_commands_get_description(self):
        """Should return a description string for commands."""
        adapter = create_generic_adapter(commands=["do-thing"])
        desc = adapter.commands.get_description("do-thing")
        assert "do-thing" in desc

    def test_errors_get_description(self):
        """Should return a description string for error codes."""
        adapter = create_generic_adapter(errors=["TIMEOUT"])
        desc = adapter.errors.get_description("TIMEOUT")
        assert "TIMEOUT" in desc

    def test_errors_is_retryable(self):
        """Should identify retryable error codes."""
        adapter = create_generic_adapter()
        assert adapter.errors.is_retryable("TIMEOUT") is True
        assert adapter.errors.is_retryable("NETWORK_ERROR") is True
        assert adapter.errors.is_retryable("RATE_LIMITED") is True
        assert adapter.errors.is_retryable("NOT_FOUND") is False
        assert adapter.errors.is_retryable("INVALID_INPUT") is False

    def test_jobs_get_description(self):
        """Should return a description string for jobs."""
        adapter = create_generic_adapter(jobs=["deploy"])
        desc = adapter.jobs.get_description("deploy")
        assert "deploy" in desc

    def test_fixture_config_has_validate(self):
        """Generic adapter should have a validate function on fixture config."""
        adapter = create_generic_adapter()
        assert adapter.fixture.validate is not None

    def test_fixture_config_has_apply_and_reset(self):
        """Generic adapter should have apply and reset functions."""
        adapter = create_generic_adapter()
        assert adapter.fixture.apply is not None
        assert adapter.fixture.reset is not None


# ==============================================================================
# Generic fixture applicator
# ==============================================================================


class TestGenericFixtureApplicator:
    """Tests for _generic_fixture_applicator via the apply method."""

    @pytest.mark.asyncio
    async def test_apply_with_handler_and_data(self):
        """Should call handler for each data item and return applied commands."""
        adapter = create_generic_adapter()

        async def handler(command: str, input_data: dict[str, Any]) -> dict[str, Any]:
            return {"ok": True, "command": command}

        context = AdapterContext(cli="test", handler=handler)
        fixture = {
            "app": "generic",
            "data": [
                {"command": "todo-create", "input": {"title": "Buy milk"}},
                {"command": "todo-create", "input": {"title": "Walk dog"}},
            ],
        }
        result = await adapter.fixture.apply(fixture, context)
        assert len(result.applied_commands) == 2
        assert result.applied_commands[0].command == "todo-create"
        assert result.applied_commands[0].input == {"title": "Buy milk"}
        assert result.applied_commands[0].result == {"ok": True, "command": "todo-create"}
        assert result.applied_commands[1].input == {"title": "Walk dog"}
        assert result.warnings is None or len(result.warnings) == 0

    @pytest.mark.asyncio
    async def test_apply_with_setup_array(self):
        """Should process setup array items like data array."""
        adapter = create_generic_adapter()

        async def handler(command: str, input_data: dict[str, Any]) -> dict[str, Any]:
            return {"done": True}

        context = AdapterContext(cli="test", handler=handler)
        fixture = {
            "app": "generic",
            "setup": [
                {"command": "db-seed"},
                {"command": "cache-warm"},
            ],
        }
        result = await adapter.fixture.apply(fixture, context)
        assert len(result.applied_commands) == 2
        assert result.applied_commands[0].command == "db-seed"
        assert result.applied_commands[1].command == "cache-warm"

    @pytest.mark.asyncio
    async def test_apply_with_both_data_and_setup(self):
        """Should process data array first, then setup array."""
        adapter = create_generic_adapter()
        call_order: list[str] = []

        async def handler(command: str, input_data: dict[str, Any]) -> None:
            call_order.append(command)

        context = AdapterContext(cli="test", handler=handler)
        fixture = {
            "app": "generic",
            "data": [{"command": "data-cmd"}],
            "setup": [{"command": "setup-cmd"}],
        }
        result = await adapter.fixture.apply(fixture, context)
        assert len(result.applied_commands) == 2
        assert call_order == ["data-cmd", "setup-cmd"]

    @pytest.mark.asyncio
    async def test_apply_without_handler(self):
        """Should warn when no handler is provided and not apply anything."""
        adapter = create_generic_adapter()
        context = AdapterContext(cli="test", handler=None)
        fixture = {
            "app": "generic",
            "data": [{"command": "todo-create"}],
        }
        result = await adapter.fixture.apply(fixture, context)
        assert len(result.applied_commands) == 0
        assert result.warnings is not None
        assert any("handler" in w.lower() for w in result.warnings)

    @pytest.mark.asyncio
    async def test_apply_with_non_dict_fixture(self):
        """Should warn when fixture is not a dict."""
        adapter = create_generic_adapter()

        async def handler(command: str, input_data: dict[str, Any]) -> None:
            pass

        context = AdapterContext(cli="test", handler=handler)
        result = await adapter.fixture.apply("not a dict", context)
        assert len(result.applied_commands) == 0
        assert result.warnings is not None
        assert any("format" in w.lower() for w in result.warnings)

    @pytest.mark.asyncio
    async def test_apply_skips_invalid_data_items(self):
        """Should skip items that don't have a 'command' string field."""
        adapter = create_generic_adapter()

        async def handler(command: str, input_data: dict[str, Any]) -> dict[str, Any]:
            return {"ok": True}

        context = AdapterContext(cli="test", handler=handler)
        fixture = {
            "app": "generic",
            "data": [
                {"command": "valid-cmd"},
                {"not_a_command": "bad"},
                "just a string",
                {"command": 123},
                {"command": "also-valid"},
            ],
        }
        result = await adapter.fixture.apply(fixture, context)
        assert len(result.applied_commands) == 2
        assert result.applied_commands[0].command == "valid-cmd"
        assert result.applied_commands[1].command == "also-valid"

    @pytest.mark.asyncio
    async def test_apply_handles_handler_exception(self):
        """Should catch handler exceptions and record a warning."""
        adapter = create_generic_adapter()

        async def broken_handler(command: str, input_data: dict[str, Any]) -> None:
            raise RuntimeError("handler exploded")

        context = AdapterContext(cli="test", handler=broken_handler)
        fixture = {
            "app": "generic",
            "data": [{"command": "boom"}],
        }
        result = await adapter.fixture.apply(fixture, context)
        assert len(result.applied_commands) == 0
        assert result.warnings is not None
        assert any("boom" in w for w in result.warnings)
        assert any("handler exploded" in w for w in result.warnings)

    @pytest.mark.asyncio
    async def test_apply_with_empty_data(self):
        """Should handle empty data array gracefully."""
        adapter = create_generic_adapter()

        async def handler(command: str, input_data: dict[str, Any]) -> None:
            pass

        context = AdapterContext(cli="test", handler=handler)
        fixture = {"app": "generic", "data": []}
        result = await adapter.fixture.apply(fixture, context)
        assert len(result.applied_commands) == 0

    @pytest.mark.asyncio
    async def test_apply_data_item_without_input_uses_empty_dict(self):
        """Should default input to empty dict when not provided in data item."""
        adapter = create_generic_adapter()
        received_inputs: list[dict[str, Any]] = []

        async def handler(command: str, input_data: dict[str, Any]) -> None:
            received_inputs.append(input_data)

        context = AdapterContext(cli="test", handler=handler)
        fixture = {
            "app": "generic",
            "data": [{"command": "no-input-cmd"}],
        }
        await adapter.fixture.apply(fixture, context)
        assert received_inputs == [{}]

    @pytest.mark.asyncio
    async def test_reset_does_nothing(self):
        """Generic adapter reset should be a no-op."""
        adapter = create_generic_adapter()
        context = AdapterContext(cli="test")
        # Should not raise
        await adapter.fixture.reset(context)


# ==============================================================================
# Generic fixture validator
# ==============================================================================


class TestGenericFixtureValidator:
    """Tests for _generic_fixture_validator via the validate method."""

    @pytest.mark.asyncio
    async def test_valid_fixture(self):
        """Should validate a well-formed fixture."""
        adapter = create_generic_adapter()
        fixture = {
            "app": "generic",
            "data": [
                {"command": "todo-create", "input": {"title": "Test"}},
            ],
        }
        result = await adapter.fixture.validate(fixture)
        assert result.valid is True
        assert result.errors is None

    @pytest.mark.asyncio
    async def test_valid_fixture_with_setup(self):
        """Should validate a fixture with setup array."""
        adapter = create_generic_adapter()
        fixture = {
            "app": "generic",
            "setup": [{"command": "init"}],
        }
        result = await adapter.fixture.validate(fixture)
        assert result.valid is True

    @pytest.mark.asyncio
    async def test_invalid_non_dict(self):
        """Should fail if fixture is not a dict."""
        adapter = create_generic_adapter()
        result = await adapter.fixture.validate("not a dict")
        assert result.valid is False
        assert result.errors is not None
        assert any("object" in e.lower() for e in result.errors)

    @pytest.mark.asyncio
    async def test_missing_app_field(self):
        """Should report error when app field is missing."""
        adapter = create_generic_adapter()
        fixture = {"data": [{"command": "test"}]}
        result = await adapter.fixture.validate(fixture)
        assert result.valid is False
        assert result.errors is not None
        assert any("app" in e.lower() for e in result.errors)

    @pytest.mark.asyncio
    async def test_non_string_app_field(self):
        """Should report error when app is not a string."""
        adapter = create_generic_adapter()
        fixture = {"app": 123, "data": [{"command": "test"}]}
        result = await adapter.fixture.validate(fixture)
        assert result.valid is False
        assert any("app" in e.lower() for e in result.errors)

    @pytest.mark.asyncio
    async def test_data_not_array(self):
        """Should report error when data is not an array."""
        adapter = create_generic_adapter()
        fixture = {"app": "test", "data": "not-an-array"}
        result = await adapter.fixture.validate(fixture)
        assert result.valid is False
        assert any("data" in e.lower() and "array" in e.lower() for e in result.errors)

    @pytest.mark.asyncio
    async def test_setup_not_array(self):
        """Should report error when setup is not an array."""
        adapter = create_generic_adapter()
        fixture = {"app": "test", "setup": {"not": "an array"}}
        result = await adapter.fixture.validate(fixture)
        assert result.valid is False
        assert any("setup" in e.lower() and "array" in e.lower() for e in result.errors)

    @pytest.mark.asyncio
    async def test_data_item_missing_command(self):
        """Should report error when data item lacks command field."""
        adapter = create_generic_adapter()
        fixture = {
            "app": "test",
            "data": [
                {"command": "valid"},
                {"input": {"no": "command"}},
            ],
        }
        result = await adapter.fixture.validate(fixture)
        assert result.valid is False
        assert any("data[1]" in e for e in result.errors)

    @pytest.mark.asyncio
    async def test_setup_item_missing_command(self):
        """Should report error when setup item lacks command field."""
        adapter = create_generic_adapter()
        fixture = {
            "app": "test",
            "setup": [
                {"not_command": True},
            ],
        }
        result = await adapter.fixture.validate(fixture)
        assert result.valid is False
        assert any("setup[0]" in e for e in result.errors)

    @pytest.mark.asyncio
    async def test_multiple_errors(self):
        """Should report all errors found."""
        adapter = create_generic_adapter()
        fixture = {
            "data": "not-array",
            "setup": [{"no_command": True}],
        }
        result = await adapter.fixture.validate(fixture)
        assert result.valid is False
        # Should have at least: missing app, data not array, setup[0] missing command
        assert len(result.errors) >= 3

    @pytest.mark.asyncio
    async def test_valid_fixture_no_data_or_setup(self):
        """Should pass when fixture has app but no data/setup (they are optional)."""
        adapter = create_generic_adapter()
        fixture = {"app": "minimal"}
        result = await adapter.fixture.validate(fixture)
        assert result.valid is True
        assert result.errors is None
