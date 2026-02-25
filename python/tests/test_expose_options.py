"""Tests for ExposeOptions on CommandDefinition and decorators."""

import pytest

from afd.core.commands import (
    CommandContext,
    CommandDefinition,
    DEFAULT_EXPOSE,
    ExposeOptions,
    create_command_registry,
)
from afd.core.result import success
from afd.server import create_server, define_command
from afd.server.decorators import get_command_metadata, command_to_definition


# ═══════════════════════════════════════════════════════════════════════════════
# ExposeOptions DEFAULTS
# ═══════════════════════════════════════════════════════════════════════════════


class TestExposeOptionsDefaults:
    """Tests for ExposeOptions default values."""

    def test_default_expose_palette_on(self):
        assert DEFAULT_EXPOSE.palette is True

    def test_default_expose_agent_on(self):
        assert DEFAULT_EXPOSE.agent is True

    def test_default_expose_mcp_off(self):
        assert DEFAULT_EXPOSE.mcp is False

    def test_default_expose_cli_off(self):
        assert DEFAULT_EXPOSE.cli is False

    def test_default_expose_is_frozen(self):
        """Frozen dataclass prevents mutation."""
        with pytest.raises(AttributeError):
            DEFAULT_EXPOSE.mcp = True

    def test_custom_expose_options(self):
        expose = ExposeOptions(palette=False, mcp=True, agent=False, cli=True)
        assert expose.palette is False
        assert expose.mcp is True
        assert expose.agent is False
        assert expose.cli is True

    def test_custom_expose_is_frozen(self):
        expose = ExposeOptions(mcp=True)
        with pytest.raises(AttributeError):
            expose.mcp = False


# ═══════════════════════════════════════════════════════════════════════════════
# ExposeOptions ON CommandDefinition
# ═══════════════════════════════════════════════════════════════════════════════


class TestExposeOnCommandDefinition:
    """Tests for expose field on CommandDefinition."""

    async def _handler(self, input, context=None):
        return success({"ok": True})

    def test_definition_without_expose_defaults_to_none(self):
        cmd = CommandDefinition(
            name="test-cmd",
            description="Test",
            handler=self._handler,
        )
        assert cmd.expose is None

    def test_definition_with_expose(self):
        expose = ExposeOptions(mcp=True, cli=True)
        cmd = CommandDefinition(
            name="test-cmd",
            description="Test",
            handler=self._handler,
            expose=expose,
        )
        assert cmd.expose.mcp is True
        assert cmd.expose.cli is True
        assert cmd.expose.palette is True  # default
        assert cmd.expose.agent is True  # default


# ═══════════════════════════════════════════════════════════════════════════════
# ExposeOptions ON @define_command DECORATOR
# ═══════════════════════════════════════════════════════════════════════════════


class TestExposeOnDecorator:
    """Tests for expose parameter on @define_command."""

    def test_decorator_without_expose(self):
        @define_command(name="no-expose", description="No expose")
        async def cmd(input):
            return success({})

        metadata = get_command_metadata(cmd)
        assert metadata.expose is None

    def test_decorator_with_expose(self):
        @define_command(
            name="with-expose",
            description="With expose",
            expose=ExposeOptions(mcp=True, cli=True),
        )
        async def cmd(input):
            return success({})

        metadata = get_command_metadata(cmd)
        assert metadata.expose is not None
        assert metadata.expose.mcp is True
        assert metadata.expose.cli is True

    def test_expose_propagates_to_definition(self):
        @define_command(
            name="propagated-expose",
            description="Test",
            expose=ExposeOptions(mcp=True, agent=False),
        )
        async def cmd(input):
            return success({})

        definition = command_to_definition(cmd)
        assert definition is not None
        assert definition.expose is not None
        assert definition.expose.mcp is True
        assert definition.expose.agent is False


# ═══════════════════════════════════════════════════════════════════════════════
# ExposeOptions ON MCPServer.command()
# ═══════════════════════════════════════════════════════════════════════════════


class TestExposeOnServer:
    """Tests for expose parameter on server.command()."""

    def test_server_command_without_expose(self):
        server = create_server("test-app")

        @server.command(name="no-expose", description="No expose")
        async def cmd(input):
            return success({})

        commands = server.list_commands()
        assert len(commands) == 1
        assert commands[0].expose is None

    def test_server_command_with_expose(self):
        server = create_server("test-app")

        @server.command(
            name="with-expose",
            description="With expose",
            expose=ExposeOptions(mcp=True),
        )
        async def cmd(input):
            return success({})

        commands = server.list_commands()
        assert len(commands) == 1
        assert commands[0].expose is not None
        assert commands[0].expose.mcp is True


# ═══════════════════════════════════════════════════════════════════════════════
# REGISTRY EXPOSURE ENFORCEMENT
# ═══════════════════════════════════════════════════════════════════════════════


class TestRegistryExposureCheck:
    """Tests for exposure enforcement in registry.execute()."""

    @pytest.mark.asyncio
    async def test_command_accessible_when_no_interface_in_context(self):
        """Commands are accessible when no interface is specified."""
        registry = create_command_registry()

        async def handler(input, context=None):
            return success({"ok": True})

        cmd = CommandDefinition(
            name="test-cmd",
            description="Test",
            handler=handler,
            expose=ExposeOptions(mcp=False),
        )
        registry.register(cmd)

        result = await registry.execute("test-cmd", {})
        assert result.success is True

    @pytest.mark.asyncio
    async def test_command_blocked_when_not_exposed(self):
        """Commands return COMMAND_NOT_EXPOSED when interface is blocked."""
        registry = create_command_registry()

        async def handler(input, context=None):
            return success({"ok": True})

        cmd = CommandDefinition(
            name="internal-cmd",
            description="Internal only",
            handler=handler,
            expose=ExposeOptions(mcp=False, cli=False),
        )
        registry.register(cmd)

        ctx = CommandContext(extra={"interface": "mcp"})
        result = await registry.execute("internal-cmd", {}, ctx)
        assert result.success is False
        assert result.error.code == "COMMAND_NOT_EXPOSED"
        assert result.error.suggestion is not None

    @pytest.mark.asyncio
    async def test_command_allowed_when_exposed(self):
        """Commands execute normally when interface is allowed."""
        registry = create_command_registry()

        async def handler(input, context=None):
            return success({"ok": True})

        cmd = CommandDefinition(
            name="mcp-cmd",
            description="MCP command",
            handler=handler,
            expose=ExposeOptions(mcp=True),
        )
        registry.register(cmd)

        ctx = CommandContext(extra={"interface": "mcp"})
        result = await registry.execute("mcp-cmd", {}, ctx)
        assert result.success is True

    @pytest.mark.asyncio
    async def test_default_expose_blocks_mcp(self):
        """Commands with no explicit expose use DEFAULT_EXPOSE (mcp=False)."""
        registry = create_command_registry()

        async def handler(input, context=None):
            return success({"ok": True})

        cmd = CommandDefinition(
            name="default-cmd",
            description="Default expose",
            handler=handler,
            # No expose set — uses DEFAULT_EXPOSE
        )
        registry.register(cmd)

        ctx = CommandContext(extra={"interface": "mcp"})
        result = await registry.execute("default-cmd", {}, ctx)
        assert result.success is False
        assert result.error.code == "COMMAND_NOT_EXPOSED"

    @pytest.mark.asyncio
    async def test_default_expose_allows_palette(self):
        """DEFAULT_EXPOSE allows palette access."""
        registry = create_command_registry()

        async def handler(input, context=None):
            return success({"ok": True})

        cmd = CommandDefinition(
            name="palette-cmd",
            description="Palette command",
            handler=handler,
        )
        registry.register(cmd)

        ctx = CommandContext(extra={"interface": "palette"})
        result = await registry.execute("palette-cmd", {}, ctx)
        assert result.success is True

    @pytest.mark.asyncio
    async def test_default_expose_allows_agent(self):
        """DEFAULT_EXPOSE allows agent access."""
        registry = create_command_registry()

        async def handler(input, context=None):
            return success({"ok": True})

        cmd = CommandDefinition(
            name="agent-cmd",
            description="Agent command",
            handler=handler,
        )
        registry.register(cmd)

        ctx = CommandContext(extra={"interface": "agent"})
        result = await registry.execute("agent-cmd", {}, ctx)
        assert result.success is True

    @pytest.mark.asyncio
    async def test_invalid_interface_rejected(self):
        """Unknown interface names are rejected before getattr."""
        registry = create_command_registry()

        async def handler(input, context=None):
            return success({"ok": True})

        cmd = CommandDefinition(
            name="test-cmd",
            description="Test",
            handler=handler,
        )
        registry.register(cmd)

        ctx = CommandContext(extra={"interface": "__class__"})
        result = await registry.execute("test-cmd", {}, ctx)
        assert result.success is False
        assert result.error.code == "INVALID_INTERFACE"
        assert "Valid interfaces" in result.error.suggestion


# ═══════════════════════════════════════════════════════════════════════════════
# PACKAGE EXPORTS
# ═══════════════════════════════════════════════════════════════════════════════


class TestExposeExports:
    """Tests that ExposeOptions is accessible from the package root."""

    def test_import_from_afd(self):
        from afd import ExposeOptions, DEFAULT_EXPOSE
        assert DEFAULT_EXPOSE.palette is True
        assert DEFAULT_EXPOSE.mcp is False

    def test_import_from_afd_core(self):
        from afd.core import ExposeOptions, DEFAULT_EXPOSE
        assert DEFAULT_EXPOSE.agent is True
