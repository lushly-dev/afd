"""Tests for bootstrap commands."""

import pytest
from pydantic import BaseModel

from afd import success
from afd.core.commands import (
    CommandDefinition,
    CommandParameter,
    create_command_registry,
)
from afd.server.bootstrap import (
    get_bootstrap_commands,
    create_afd_help_command,
    create_afd_docs_command,
    create_afd_schema_command,
)
from afd.server.bootstrap.afd_help import AfdHelpInput, AfdHelpOutput
from afd.server.bootstrap.afd_docs import AfdDocsInput, AfdDocsOutput
from afd.server.bootstrap.afd_schema import AfdSchemaInput, AfdSchemaOutput


# Test helper to create sample commands
async def sample_handler(input, context=None):
    return success({"result": "ok"})


def create_sample_commands():
    """Create sample commands for testing."""
    return [
        CommandDefinition(
            name="todo-create",
            description="Create a new todo item",
            handler=sample_handler,
            category="todo",
            tags=["todo", "mutation", "write"],
            mutation=True,
            version="1.0.0",
            parameters=[
                CommandParameter(
                    name="title",
                    type="string",
                    description="Todo title",
                    required=True,
                ),
                CommandParameter(
                    name="priority",
                    type="number",
                    description="Priority level",
                    required=False,
                    default=1,
                ),
            ],
        ),
        CommandDefinition(
            name="todo-list",
            description="List all todo items",
            handler=sample_handler,
            category="todo",
            tags=["todo", "read", "safe"],
            mutation=False,
            version="1.0.0",
        ),
        CommandDefinition(
            name="user-get",
            description="Get user by ID",
            handler=sample_handler,
            category="user",
            tags=["user", "read", "safe"],
            mutation=False,
            version="1.0.0",
            parameters=[
                CommandParameter(
                    name="id",
                    type="string",
                    description="User ID",
                    required=True,
                ),
            ],
        ),
    ]


# ============================================================================
# afd-help command tests
# ============================================================================


class TestAfdHelp:
    """Tests for afd-help bootstrap command."""

    def test_create_afd_help_command(self):
        """Test creating the afd-help command."""
        commands = create_sample_commands()
        cmd = create_afd_help_command(lambda: commands)

        assert cmd.name == "afd-help"
        assert cmd.category == "bootstrap"
        assert "bootstrap" in cmd.tags
        assert cmd.mutation is False

    @pytest.mark.asyncio
    async def test_list_all_commands(self):
        """Test listing all commands without filter."""
        commands = create_sample_commands()
        cmd = create_afd_help_command(lambda: commands)

        result = await cmd.handler({}, None)

        assert result.success is True
        assert result.data.total == 3
        assert result.data.filtered is False
        assert len(result.data.commands) == 3

    @pytest.mark.asyncio
    async def test_filter_by_tag(self):
        """Test filtering commands by tag."""
        commands = create_sample_commands()
        cmd = create_afd_help_command(lambda: commands)

        result = await cmd.handler({"filter": "todo"}, None)

        assert result.success is True
        assert result.data.total == 2
        assert result.data.filtered is True
        assert all("todo" in c.name for c in result.data.commands)

    @pytest.mark.asyncio
    async def test_filter_by_category(self):
        """Test filtering commands by category."""
        commands = create_sample_commands()
        cmd = create_afd_help_command(lambda: commands)

        result = await cmd.handler({"filter": "user"}, None)

        assert result.success is True
        assert result.data.total == 1
        assert result.data.commands[0].name == "user-get"

    @pytest.mark.asyncio
    async def test_filter_by_name(self):
        """Test filtering commands by name."""
        commands = create_sample_commands()
        cmd = create_afd_help_command(lambda: commands)

        result = await cmd.handler({"filter": "create"}, None)

        assert result.success is True
        assert result.data.total == 1
        assert result.data.commands[0].name == "todo-create"

    @pytest.mark.asyncio
    async def test_brief_format(self):
        """Test brief output format."""
        commands = create_sample_commands()
        cmd = create_afd_help_command(lambda: commands)

        result = await cmd.handler({"format": "brief"}, None)

        assert result.success is True
        # Brief format should not include category, tags, mutation
        for c in result.data.commands:
            assert c.category is None
            assert c.tags is None
            assert c.mutation is None

    @pytest.mark.asyncio
    async def test_full_format(self):
        """Test full output format."""
        commands = create_sample_commands()
        cmd = create_afd_help_command(lambda: commands)

        result = await cmd.handler({"format": "full"}, None)

        assert result.success is True
        # Full format should include category, tags, mutation
        todo_create = next(c for c in result.data.commands if c.name == "todo-create")
        assert todo_create.category == "todo"
        assert "mutation" in todo_create.tags
        assert todo_create.mutation is True

    @pytest.mark.asyncio
    async def test_grouped_by_category(self):
        """Test commands are grouped by category."""
        commands = create_sample_commands()
        cmd = create_afd_help_command(lambda: commands)

        result = await cmd.handler({}, None)

        assert result.success is True
        assert "todo" in result.data.grouped_by_category
        assert "user" in result.data.grouped_by_category
        assert len(result.data.grouped_by_category["todo"]) == 2
        assert len(result.data.grouped_by_category["user"]) == 1

    @pytest.mark.asyncio
    async def test_pydantic_input(self):
        """Test with Pydantic model input."""
        commands = create_sample_commands()
        cmd = create_afd_help_command(lambda: commands)

        result = await cmd.handler(AfdHelpInput(filter="todo", format="full"), None)

        assert result.success is True
        assert result.data.filtered is True


# ============================================================================
# afd-docs command tests
# ============================================================================


class TestAfdDocs:
    """Tests for afd-docs bootstrap command."""

    def test_create_afd_docs_command(self):
        """Test creating the afd-docs command."""
        commands = create_sample_commands()
        cmd = create_afd_docs_command(lambda: commands)

        assert cmd.name == "afd-docs"
        assert cmd.category == "bootstrap"
        assert "bootstrap" in cmd.tags
        assert cmd.mutation is False

    @pytest.mark.asyncio
    async def test_generate_all_docs(self):
        """Test generating docs for all commands."""
        commands = create_sample_commands()
        cmd = create_afd_docs_command(lambda: commands)

        result = await cmd.handler({}, None)

        assert result.success is True
        assert result.data.command_count == 3
        assert "# Command Documentation" in result.data.markdown
        assert "## todo" in result.data.markdown
        assert "## user" in result.data.markdown

    @pytest.mark.asyncio
    async def test_generate_single_command_docs(self):
        """Test generating docs for a single command."""
        commands = create_sample_commands()
        cmd = create_afd_docs_command(lambda: commands)

        result = await cmd.handler({"command": "todo-create"}, None)

        assert result.success is True
        assert result.data.command_count == 1
        assert "todo-create" in result.data.markdown
        assert "todo-list" not in result.data.markdown

    @pytest.mark.asyncio
    async def test_command_not_found(self):
        """Test handling non-existent command."""
        commands = create_sample_commands()
        cmd = create_afd_docs_command(lambda: commands)

        result = await cmd.handler({"command": "nonexistent"}, None)

        assert result.success is True
        assert result.data.command_count == 0
        assert result.data.markdown == ""

    @pytest.mark.asyncio
    async def test_docs_include_tags(self):
        """Test that docs include tags."""
        commands = create_sample_commands()
        cmd = create_afd_docs_command(lambda: commands)

        result = await cmd.handler({"command": "todo-create"}, None)

        assert result.success is True
        assert "**Tags:**" in result.data.markdown
        assert "`mutation`" in result.data.markdown

    @pytest.mark.asyncio
    async def test_docs_include_parameters(self):
        """Test that docs include parameters."""
        commands = create_sample_commands()
        cmd = create_afd_docs_command(lambda: commands)

        result = await cmd.handler({"command": "todo-create"}, None)

        assert result.success is True
        assert "**Parameters:**" in result.data.markdown
        assert "| title |" in result.data.markdown
        assert "| priority |" in result.data.markdown

    @pytest.mark.asyncio
    async def test_docs_include_mutation_info(self):
        """Test that docs include mutation information."""
        commands = create_sample_commands()
        cmd = create_afd_docs_command(lambda: commands)

        result = await cmd.handler({"command": "todo-create"}, None)

        assert result.success is True
        assert "**Mutation:** Yes" in result.data.markdown

    @pytest.mark.asyncio
    async def test_pydantic_input(self):
        """Test with Pydantic model input."""
        commands = create_sample_commands()
        cmd = create_afd_docs_command(lambda: commands)

        result = await cmd.handler(AfdDocsInput(command="todo-list"), None)

        assert result.success is True
        assert result.data.command_count == 1


# ============================================================================
# afd-schema command tests
# ============================================================================


class TestAfdSchema:
    """Tests for afd-schema bootstrap command."""

    def test_create_afd_schema_command(self):
        """Test creating the afd-schema command."""
        commands = create_sample_commands()
        cmd = create_afd_schema_command(lambda: commands)

        assert cmd.name == "afd-schema"
        assert cmd.category == "bootstrap"
        assert "bootstrap" in cmd.tags
        assert cmd.mutation is False

    @pytest.mark.asyncio
    async def test_export_all_schemas(self):
        """Test exporting schemas for all commands."""
        commands = create_sample_commands()
        cmd = create_afd_schema_command(lambda: commands)

        result = await cmd.handler({}, None)

        assert result.success is True
        assert result.data.count == 3
        assert result.data.format == "json"
        assert len(result.data.schemas) == 3

    @pytest.mark.asyncio
    async def test_schema_contains_properties(self):
        """Test that schemas contain properties from parameters."""
        commands = create_sample_commands()
        cmd = create_afd_schema_command(lambda: commands)

        result = await cmd.handler({}, None)

        assert result.success is True
        todo_create = next(s for s in result.data.schemas if s.name == "todo-create")

        assert "properties" in todo_create.input_schema
        assert "title" in todo_create.input_schema["properties"]
        assert "priority" in todo_create.input_schema["properties"]

    @pytest.mark.asyncio
    async def test_schema_contains_required(self):
        """Test that schemas contain required fields."""
        commands = create_sample_commands()
        cmd = create_afd_schema_command(lambda: commands)

        result = await cmd.handler({}, None)

        assert result.success is True
        todo_create = next(s for s in result.data.schemas if s.name == "todo-create")

        assert "required" in todo_create.input_schema
        assert "title" in todo_create.input_schema["required"]
        assert "priority" not in todo_create.input_schema["required"]

    @pytest.mark.asyncio
    async def test_typescript_format(self):
        """Test TypeScript format output."""
        commands = create_sample_commands()
        cmd = create_afd_schema_command(lambda: commands)

        result = await cmd.handler({"format": "typescript"}, None)

        assert result.success is True
        assert result.data.format == "typescript"
        # TypeScript format is placeholder, still returns schemas
        assert result.data.count == 3

    @pytest.mark.asyncio
    async def test_custom_json_schema_function(self):
        """Test using custom get_json_schema function."""
        commands = create_sample_commands()

        def custom_schema(cmd):
            return {"type": "object", "custom": True, "command": cmd.name}

        cmd = create_afd_schema_command(lambda: commands, custom_schema)

        result = await cmd.handler({}, None)

        assert result.success is True
        for schema in result.data.schemas:
            assert schema.input_schema.get("custom") is True

    @pytest.mark.asyncio
    async def test_pydantic_input(self):
        """Test with Pydantic model input."""
        commands = create_sample_commands()
        cmd = create_afd_schema_command(lambda: commands)

        result = await cmd.handler(AfdSchemaInput(format="json"), None)

        assert result.success is True
        assert result.data.format == "json"


# ============================================================================
# get_bootstrap_commands tests
# ============================================================================


class TestGetBootstrapCommands:
    """Tests for get_bootstrap_commands function."""

    def test_returns_three_commands(self):
        """Test that all three bootstrap commands are returned."""
        commands = create_sample_commands()
        bootstrap = get_bootstrap_commands(lambda: commands)

        assert len(bootstrap) == 3
        names = [cmd.name for cmd in bootstrap]
        assert "afd-help" in names
        assert "afd-docs" in names
        assert "afd-schema" in names

    def test_all_commands_are_bootstrap_category(self):
        """Test that all commands have bootstrap category."""
        commands = create_sample_commands()
        bootstrap = get_bootstrap_commands(lambda: commands)

        for cmd in bootstrap:
            assert cmd.category == "bootstrap"
            assert "bootstrap" in cmd.tags

    def test_all_commands_are_readonly(self):
        """Test that all commands are read-only."""
        commands = create_sample_commands()
        bootstrap = get_bootstrap_commands(lambda: commands)

        for cmd in bootstrap:
            assert cmd.mutation is False

    def test_with_options(self):
        """Test passing options to get_bootstrap_commands."""
        commands = create_sample_commands()

        def custom_schema(cmd):
            return {"custom": True}

        bootstrap = get_bootstrap_commands(
            lambda: commands,
            options={"get_json_schema": custom_schema},
        )

        assert len(bootstrap) == 3

    @pytest.mark.asyncio
    async def test_bootstrap_commands_work_with_registry(self):
        """Test that bootstrap commands work with a command registry."""
        registry = create_command_registry()

        # Register sample commands
        for cmd in create_sample_commands():
            registry.register(cmd)

        # Get bootstrap commands that reference the registry
        bootstrap = get_bootstrap_commands(registry.list)

        # Register bootstrap commands
        for cmd in bootstrap:
            registry.register(cmd)

        # Execute afd-help
        result = await registry.execute("afd-help", {})
        assert result.success is True
        # Should include both sample commands and bootstrap commands
        assert result.data.total == 6  # 3 sample + 3 bootstrap

    @pytest.mark.asyncio
    async def test_bootstrap_help_shows_bootstrap_commands(self):
        """Test that afd-help can list bootstrap commands too."""
        commands = create_sample_commands()

        # Create a mutable list that includes bootstrap commands
        all_commands = list(commands)
        bootstrap = get_bootstrap_commands(lambda: all_commands)
        all_commands.extend(bootstrap)

        # Now execute help
        help_cmd = bootstrap[0]  # afd-help
        result = await help_cmd.handler({"filter": "bootstrap"}, None)

        assert result.success is True
        assert result.data.total == 3
        assert all(c.name.startswith("afd-") for c in result.data.commands)
