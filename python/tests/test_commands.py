"""Tests for afd.core.commands module."""

import pytest

from afd.core.commands import (
    CommandContext,
    CommandDefinition,
    CommandParameter,
    command_to_mcp_tool,
    create_command_registry,
)
from afd.core.result import CommandResult, success


class TestCommandParameter:
    """Tests for CommandParameter type."""

    def test_basic_parameter(self):
        param = CommandParameter(
            name="title",
            type="string",
            description="The document title",
        )
        assert param.name == "title"
        assert param.type == "string"
        assert param.description == "The document title"
        assert param.required is False

    def test_required_parameter(self):
        param = CommandParameter(
            name="id",
            type="string",
            description="Document ID",
            required=True,
        )
        assert param.required is True

    def test_parameter_with_default(self):
        param = CommandParameter(
            name="limit",
            type="number",
            description="Max results",
            default=10,
        )
        assert param.default == 10

    def test_parameter_with_enum(self):
        param = CommandParameter(
            name="status",
            type="string",
            description="Status filter",
            enum=["draft", "published", "archived"],
        )
        assert param.enum == ["draft", "published", "archived"]


class TestCommandContext:
    """Tests for CommandContext type."""

    def test_basic_context(self):
        ctx = CommandContext()
        assert ctx.trace_id is None
        assert ctx.timeout is None
        assert ctx.extra == {}

    def test_full_context(self):
        ctx = CommandContext(
            trace_id="trace-123",
            timeout=5000,
            extra={"user_id": "user-456"},
        )
        assert ctx.trace_id == "trace-123"
        assert ctx.timeout == 5000
        assert ctx.extra == {"user_id": "user-456"}


class TestCommandDefinition:
    """Tests for CommandDefinition type."""

    async def _dummy_handler(self, input, context=None):
        return success({"ok": True})

    def test_basic_definition(self):
        cmd = CommandDefinition(
            name="test-command",
            description="A test command",
            handler=self._dummy_handler,
        )
        assert cmd.name == "test-command"
        assert cmd.description == "A test command"
        assert cmd.mutation is False

    def test_full_definition(self):
        cmd = CommandDefinition(
            name="document-create",
            description="Creates a new document",
            handler=self._dummy_handler,
            category="documents",
            parameters=[
                CommandParameter(
                    name="title",
                    type="string",
                    description="Document title",
                    required=True,
                ),
                CommandParameter(
                    name="content",
                    type="string",
                    description="Document content",
                ),
            ],
            returns_description="The created document",
            errors=["VALIDATION_ERROR", "CONFLICT"],
            version="1.0.0",
            tags=["documents", "create"],
            mutation=True,
            execution_time="fast",
        )
        assert cmd.category == "documents"
        assert len(cmd.parameters) == 2
        assert cmd.mutation is True
        assert cmd.execution_time == "fast"


class TestCommandRegistry:
    """Tests for CommandRegistry and create_command_registry()."""

    async def _handler_one(self, input, context=None):
        return success({"name": "one"})

    async def _handler_two(self, input, context=None):
        return success({"name": "two"})

    def test_create_registry(self):
        registry = create_command_registry()
        assert registry is not None

    def test_register_command(self):
        registry = create_command_registry()
        cmd = CommandDefinition(
            name="test-command",
            description="Test",
            handler=self._handler_one,
        )
        registry.register(cmd)
        assert registry.has("test-command") is True

    def test_get_command(self):
        registry = create_command_registry()
        cmd = CommandDefinition(
            name="test-get",
            description="Test get",
            handler=self._handler_one,
        )
        registry.register(cmd)
        retrieved = registry.get("test-get")
        assert retrieved is not None
        assert retrieved.name == "test-get"

    def test_get_nonexistent_returns_none(self):
        registry = create_command_registry()
        assert registry.get("nonexistent") is None

    def test_has_command(self):
        registry = create_command_registry()
        cmd = CommandDefinition(
            name="test-has",
            description="Test has",
            handler=self._handler_one,
        )
        registry.register(cmd)
        assert registry.has("test-has") is True
        assert registry.has("nonexistent") is False

    def test_list_commands(self):
        registry = create_command_registry()
        cmd1 = CommandDefinition(name="a-cmd", description="A", handler=self._handler_one)
        cmd2 = CommandDefinition(name="b-cmd", description="B", handler=self._handler_two)
        registry.register(cmd1)
        registry.register(cmd2)

        commands = registry.list()
        assert len(commands) == 2
        names = [c.name for c in commands]
        assert "a-cmd" in names
        assert "b-cmd" in names

    def test_list_by_category(self):
        registry = create_command_registry()
        cmd1 = CommandDefinition(
            name="docs-create",
            description="Create doc",
            handler=self._handler_one,
            category="documents",
        )
        cmd2 = CommandDefinition(
            name="docs-delete",
            description="Delete doc",
            handler=self._handler_two,
            category="documents",
        )
        cmd3 = CommandDefinition(
            name="users-list",
            description="List users",
            handler=self._handler_one,
            category="users",
        )
        registry.register(cmd1)
        registry.register(cmd2)
        registry.register(cmd3)

        docs = registry.list_by_category("documents")
        assert len(docs) == 2

        users = registry.list_by_category("users")
        assert len(users) == 1

    def test_register_duplicate_raises(self):
        registry = create_command_registry()
        cmd = CommandDefinition(
            name="duplicate",
            description="Test",
            handler=self._handler_one,
        )
        registry.register(cmd)

        with pytest.raises(ValueError, match="already registered"):
            registry.register(cmd)

    @pytest.mark.asyncio
    async def test_execute_command(self):
        registry = create_command_registry()

        async def handler(input, context=None):
            return success({"title": input.get("title", "untitled")})

        cmd = CommandDefinition(
            name="exec-test",
            description="Test execution",
            handler=handler,
        )
        registry.register(cmd)

        result = await registry.execute("exec-test", {"title": "My Doc"})
        assert result.success is True
        assert result.data == {"title": "My Doc"}

    @pytest.mark.asyncio
    async def test_execute_nonexistent_returns_error(self):
        registry = create_command_registry()
        result = await registry.execute("nonexistent", {})
        assert result.success is False
        assert result.error.code == "COMMAND_NOT_FOUND"

    @pytest.mark.asyncio
    async def test_execute_with_exception_returns_error(self):
        registry = create_command_registry()

        async def failing_handler(input, context=None):
            raise ValueError("Something went wrong")

        cmd = CommandDefinition(
            name="failing",
            description="Fails",
            handler=failing_handler,
        )
        registry.register(cmd)

        result = await registry.execute("failing", {})
        assert result.success is False
        assert result.error.code == "COMMAND_EXECUTION_ERROR"


class TestCommandToMcpTool:
    """Tests for command_to_mcp_tool() function."""

    async def _handler(self, input, context=None):
        return success({})

    def test_basic_conversion(self):
        cmd = CommandDefinition(
            name="test-tool",
            description="A test tool",
            handler=self._handler,
        )
        tool = command_to_mcp_tool(cmd)
        assert tool["name"] == "test-tool"
        assert tool["description"] == "A test tool"
        assert tool["inputSchema"]["type"] == "object"
        assert tool["inputSchema"]["properties"] == {}
        assert tool["inputSchema"]["required"] == []

    def test_conversion_with_parameters(self):
        cmd = CommandDefinition(
            name="with-params",
            description="Has params",
            handler=self._handler,
            parameters=[
                CommandParameter(
                    name="title",
                    type="string",
                    description="The title",
                    required=True,
                ),
                CommandParameter(
                    name="count",
                    type="number",
                    description="Item count",
                    default=10,
                ),
                CommandParameter(
                    name="status",
                    type="string",
                    description="Status filter",
                    enum=["active", "inactive"],
                ),
            ],
        )
        tool = command_to_mcp_tool(cmd)

        props = tool["inputSchema"]["properties"]
        assert "title" in props
        assert props["title"]["type"] == "string"
        assert props["title"]["description"] == "The title"

        assert props["count"]["default"] == 10
        assert props["status"]["enum"] == ["active", "inactive"]

        assert tool["inputSchema"]["required"] == ["title"]
