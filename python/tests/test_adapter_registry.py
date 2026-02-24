"""Tests for the adapter registry module."""

import pytest

from afd.testing.adapters.generic import (
    GenericAdapterOptions,
    create_generic_adapter,
    generic_adapter,
)
from afd.testing.adapters.registry import (
    AdapterRegistry,
    AdapterRegistryOptions,
    create_adapter_registry,
    detect_adapter,
    get_adapter,
    get_global_registry,
    list_adapters,
    register_adapter,
    reset_global_registry,
    set_global_registry,
)
from afd.testing.adapters.types import (
    AdapterContext,
    AppAdapter,
    ApplyFixtureResult,
    CliConfig,
    CommandsConfig,
    ErrorsConfig,
    FixtureConfig,
    FixtureValidationResult,
    JobsConfig,
)


def _make_adapter(name: str) -> AppAdapter:
    """Create a minimal test adapter."""
    async def apply(fixture, ctx):
        return ApplyFixtureResult()

    async def reset(ctx):
        pass

    return AppAdapter(
        name=name,
        version='1.0.0',
        cli=CliConfig(command=name),
        fixture=FixtureConfig(apply=apply, reset=reset),
        commands=CommandsConfig(list_commands=lambda: []),
        errors=ErrorsConfig(list_errors=lambda: []),
        jobs=JobsConfig(list_jobs=lambda: []),
    )


class TestAdapterRegistry:
    def test_register_and_get(self):
        registry = AdapterRegistry()
        adapter = _make_adapter('test-app')
        registry.register(adapter)
        assert registry.get('test-app') is adapter

    def test_register_duplicate_raises(self):
        registry = AdapterRegistry()
        adapter = _make_adapter('test-app')
        registry.register(adapter)
        with pytest.raises(ValueError, match='already registered'):
            registry.register(adapter)

    def test_get_nonexistent(self):
        registry = AdapterRegistry()
        assert registry.get('nonexistent') is None

    def test_list(self):
        registry = AdapterRegistry()
        a = _make_adapter('app-a')
        b = _make_adapter('app-b')
        registry.register(a)
        registry.register(b)
        adapters = registry.list()
        assert len(adapters) == 2
        names = {ad.name for ad in adapters}
        assert names == {'app-a', 'app-b'}

    def test_has(self):
        registry = AdapterRegistry()
        adapter = _make_adapter('test-app')
        registry.register(adapter)
        assert registry.has('test-app') is True
        assert registry.has('other') is False

    def test_detect_from_fixture_app_field(self):
        registry = AdapterRegistry()
        adapter = _make_adapter('my-app')
        registry.register(adapter)
        detected = registry.detect({'app': 'my-app', 'data': []})
        assert detected is adapter

    def test_detect_unknown_fixture(self):
        registry = AdapterRegistry()
        assert registry.detect({'app': 'unknown'}) is None

    def test_detect_with_default(self):
        adapter = _make_adapter('fallback')
        options = AdapterRegistryOptions(
            adapters=[adapter],
            default_adapter='fallback',
        )
        registry = AdapterRegistry(options)
        detected = registry.detect({'something': 'else'})
        assert detected is adapter

    def test_initial_adapters(self):
        a = _make_adapter('app-a')
        b = _make_adapter('app-b')
        options = AdapterRegistryOptions(adapters=[a, b])
        registry = AdapterRegistry(options)
        assert registry.has('app-a')
        assert registry.has('app-b')


class TestGlobalRegistry:
    def setup_method(self):
        reset_global_registry()

    def teardown_method(self):
        reset_global_registry()

    def test_get_global_creates_default(self):
        registry = get_global_registry()
        assert isinstance(registry, AdapterRegistry)

    def test_set_and_get_global(self):
        custom = AdapterRegistry()
        set_global_registry(custom)
        assert get_global_registry() is custom

    def test_register_adapter_global(self):
        adapter = _make_adapter('global-app')
        register_adapter(adapter)
        assert get_adapter('global-app') is adapter

    def test_list_adapters_global(self):
        a = _make_adapter('app-a')
        b = _make_adapter('app-b')
        register_adapter(a)
        register_adapter(b)
        adapters = list_adapters()
        assert len(adapters) == 2

    def test_detect_adapter_global(self):
        adapter = _make_adapter('detected')
        register_adapter(adapter)
        found = detect_adapter({'app': 'detected'})
        assert found is adapter


class TestCreateAdapterRegistry:
    def test_factory(self):
        registry = create_adapter_registry()
        assert isinstance(registry, AdapterRegistry)

    def test_factory_with_options(self):
        adapter = _make_adapter('test')
        registry = create_adapter_registry(
            AdapterRegistryOptions(adapters=[adapter])
        )
        assert registry.has('test')


class TestGenericAdapter:
    def test_default_generic_adapter(self):
        assert generic_adapter.name == 'generic'
        assert generic_adapter.version == '0.1.0'

    def test_create_generic_adapter(self):
        adapter = create_generic_adapter('my-app', GenericAdapterOptions(
            version='2.0.0',
            cli_command='my-app-cli',
            commands=['cmd-a', 'cmd-b'],
        ))
        assert adapter.name == 'my-app'
        assert adapter.version == '2.0.0'
        assert adapter.cli.command == 'my-app-cli'
        assert adapter.commands.list_commands() == ['cmd-a', 'cmd-b']

    @pytest.mark.asyncio
    async def test_generic_apply_fixture(self):
        adapter = generic_adapter
        ctx = AdapterContext(cli='afd')
        fixture = {
            'setup': [{'command': 'test-setup', 'input': {'key': 'value'}}],
            'data': [{'command': 'test-data', 'input': {}}],
        }
        result = await adapter.fixture.apply(fixture, ctx)
        assert isinstance(result, ApplyFixtureResult)
        assert len(result.applied_commands) == 2
        assert result.applied_commands[0].command == 'test-setup'
        assert result.applied_commands[1].command == 'test-data'

    @pytest.mark.asyncio
    async def test_generic_apply_with_handler(self):
        async def handler(cmd, input):
            return {'success': True, 'data': {'cmd': cmd}}

        ctx = AdapterContext(cli='afd', handler=handler)
        fixture = {'data': [{'command': 'test-cmd', 'input': {'x': 1}}]}
        result = await generic_adapter.fixture.apply(fixture, ctx)
        assert len(result.applied_commands) == 1
        assert result.applied_commands[0].result is not None

    @pytest.mark.asyncio
    async def test_generic_validate_valid(self):
        fixture = {
            'setup': [{'command': 'a', 'input': {}}],
            'data': [{'command': 'b', 'input': {}}],
        }
        result = await generic_adapter.fixture.validate(fixture)
        assert isinstance(result, FixtureValidationResult)
        assert result.valid is True

    @pytest.mark.asyncio
    async def test_generic_validate_invalid(self):
        fixture = {'setup': 'not-a-list'}
        result = await generic_adapter.fixture.validate(fixture)
        assert result.valid is False
        assert len(result.errors) > 0

    @pytest.mark.asyncio
    async def test_generic_validate_missing_command(self):
        fixture = {'data': [{'input': {}}]}
        result = await generic_adapter.fixture.validate(fixture)
        assert result.valid is False

    @pytest.mark.asyncio
    async def test_generic_reset(self):
        ctx = AdapterContext(cli='afd')
        # Should not raise
        await generic_adapter.fixture.reset(ctx)
