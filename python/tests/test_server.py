"""Tests for the server module."""

import pytest
from pydantic import BaseModel

from afd import success, error
from afd.server import create_server, define_command, MCPServer
from afd.server.decorators import (
    CommandMetadata,
    get_command_metadata,
    has_command_metadata,
    command_to_definition,
)


# Test schemas
class GreetInput(BaseModel):
    name: str
    greeting: str = "Hello"


class GreetOutput(BaseModel):
    message: str


class CreateItemInput(BaseModel):
    name: str
    value: int = 0


class CreateItemOutput(BaseModel):
    id: str
    name: str
    value: int


# ============================================================================
# define_command decorator tests
# ============================================================================


class TestDefineCommand:
    """Tests for @define_command decorator."""

    def test_basic_decorator(self):
        @define_command(name="test-cmd", description="Test command")
        async def test_cmd(input):
            return success({"result": "ok"})

        assert has_command_metadata(test_cmd)
        metadata = get_command_metadata(test_cmd)
        assert metadata.name == "test-cmd"
        assert metadata.description == "Test command"

    def test_decorator_with_schemas(self):
        @define_command(
            name="greet",
            description="Greet someone",
            input_schema=GreetInput,
            output_schema=GreetOutput,
        )
        async def greet(input: GreetInput):
            return success(GreetOutput(message=f"{input.greeting}, {input.name}!"))

        metadata = get_command_metadata(greet)
        assert metadata.input_schema == GreetInput
        assert metadata.output_schema == GreetOutput

    def test_decorator_with_tags(self):
        @define_command(
            name="tagged-cmd",
            description="Tagged command",
            tags=["category:test", "priority:high"],
        )
        async def tagged_cmd(input):
            return success({})

        metadata = get_command_metadata(tagged_cmd)
        assert metadata.tags == ["category:test", "priority:high"]

    def test_decorator_with_mutation(self):
        @define_command(
            name="mutating-cmd",
            description="Mutating command",
            mutation=True,
        )
        async def mutating_cmd(input):
            return success({})

        metadata = get_command_metadata(mutating_cmd)
        assert metadata.mutation is True

    def test_decorator_with_examples(self):
        @define_command(
            name="example-cmd",
            description="With examples",
            examples=[
                {"name": "John"},
                {"name": "Jane", "greeting": "Hi"},
            ],
        )
        async def example_cmd(input):
            return success({})

        metadata = get_command_metadata(example_cmd)
        assert len(metadata.examples) == 2
        assert metadata.examples[0] == {"name": "John"}

    @pytest.mark.asyncio
    async def test_decorated_function_validates_input(self):
        @define_command(
            name="validated",
            description="Validates input",
            input_schema=GreetInput,
        )
        async def validated(input: GreetInput):
            return success({"name": input.name})

        # Should work with dict
        result = await validated({"name": "Test"})
        assert result.success is True

    @pytest.mark.asyncio
    async def test_decorated_function_with_pydantic_input(self):
        @define_command(
            name="pydantic",
            description="Pydantic input",
            input_schema=GreetInput,
        )
        async def pydantic_cmd(input: GreetInput):
            return success({"name": input.name, "greeting": input.greeting})

        result = await pydantic_cmd(GreetInput(name="Test"))
        assert result.success is True
        assert result.data["greeting"] == "Hello"  # default value


class TestHasCommandMetadata:
    """Tests for has_command_metadata."""

    def test_returns_true_for_decorated(self):
        @define_command(name="test", description="Test")
        async def decorated(input):
            return success({})

        assert has_command_metadata(decorated) is True

    def test_returns_false_for_undecorated(self):
        async def undecorated(input):
            return success({})

        assert has_command_metadata(undecorated) is False


class TestCommandToDefinition:
    """Tests for command_to_definition."""

    def test_converts_decorated_function(self):
        @define_command(
            name="convert-test",
            description="Test conversion",
            input_schema=GreetInput,
            tags=["test"],
            mutation=True,
        )
        async def convert_test(input: GreetInput):
            return success({})

        definition = command_to_definition(convert_test)

        assert definition is not None
        assert definition.name == "convert-test"
        assert definition.description == "Test conversion"
        assert definition.tags == ["test"]
        assert definition.mutation is True

    def test_extracts_parameters_from_schema(self):
        @define_command(
            name="params-test",
            description="Parameter extraction",
            input_schema=CreateItemInput,
        )
        async def params_test(input: CreateItemInput):
            return success({})

        definition = command_to_definition(params_test)

        assert definition is not None
        assert len(definition.parameters) == 2

        # Check name parameter
        name_param = next(p for p in definition.parameters if p.name == "name")
        assert name_param.type == "string"
        assert name_param.required is True

        # Check value parameter
        value_param = next(p for p in definition.parameters if p.name == "value")
        assert value_param.type == "number"  # integer -> number
        assert value_param.required is False

    def test_returns_none_for_undecorated(self):
        async def undecorated(input):
            return success({})

        assert command_to_definition(undecorated) is None


# ============================================================================
# MCPServer tests
# ============================================================================


class TestMCPServer:
    """Tests for MCPServer class."""

    def test_create_server(self):
        server = create_server("test-app", version="1.0.0")
        assert server.name == "test-app"
        assert server.version == "1.0.0"

    def test_create_server_with_description(self):
        server = create_server(
            "test-app",
            version="2.0.0",
            description="Test server",
        )
        assert server.config.description == "Test server"

    def test_command_decorator(self):
        server = create_server("test-app")

        @server.command(name="ping", description="Ping command")
        async def ping(input):
            return success({"status": "pong"})

        commands = server.list_commands()
        assert len(commands) == 1
        assert commands[0].name == "ping"

    def test_multiple_commands(self):
        server = create_server("test-app")

        @server.command(name="cmd1", description="Command 1")
        async def cmd1(input):
            return success({})

        @server.command(name="cmd2", description="Command 2")
        async def cmd2(input):
            return success({})

        commands = server.list_commands()
        assert len(commands) == 2

    def test_command_with_schema(self):
        server = create_server("test-app")

        @server.command(
            name="greet",
            description="Greet",
            input_schema=GreetInput,
            output_schema=GreetOutput,
        )
        async def greet(input: GreetInput):
            return success(GreetOutput(message=f"Hello, {input.name}!"))

        commands = server.list_commands()
        assert len(commands) == 1
        # Parameters should be extracted from schema
        assert len(commands[0].parameters) == 2

    @pytest.mark.asyncio
    async def test_execute_command(self):
        server = create_server("test-app")

        @server.command(name="echo", description="Echo input")
        async def echo(input):
            return success({"echo": input.get("message", "")})

        result = await server.execute("echo", {"message": "hello"})
        assert result.success is True
        assert result.data["echo"] == "hello"

    @pytest.mark.asyncio
    async def test_execute_nonexistent(self):
        server = create_server("test-app")
        result = await server.execute("nonexistent", {})
        assert result.success is False
        assert result.error.code == "COMMAND_NOT_FOUND"

    def test_register_external_command(self):
        server = create_server("test-app")

        @define_command(name="external", description="External command")
        async def external_cmd(input):
            return success({})

        server.register(external_cmd)

        commands = server.list_commands()
        assert len(commands) == 1
        assert commands[0].name == "external"

    def test_register_undecorated_raises(self):
        server = create_server("test-app")

        async def undecorated(input):
            return success({})

        with pytest.raises(ValueError, match="not decorated"):
            server.register(undecorated)


class TestServerIntegration:
    """Integration tests for the server."""

    @pytest.mark.asyncio
    async def test_full_workflow(self):
        """Test a complete server workflow."""
        server = create_server("item-service", version="1.0.0")
        items = {}

        @server.command(
            name="item-create",
            description="Create an item",
            input_schema=CreateItemInput,
            output_schema=CreateItemOutput,
            mutation=True,
        )
        async def create_item(input: CreateItemInput):
            item_id = f"item_{len(items) + 1}"
            item = CreateItemOutput(id=item_id, name=input.name, value=input.value)
            items[item_id] = item
            return success(item.model_dump(), reasoning="Item created successfully")

        @server.command(
            name="item-list",
            description="List all items",
        )
        async def list_items(input):
            return success(
                {"items": [item.model_dump() for item in items.values()]},
                reasoning=f"Found {len(items)} items",
            )

        # Create items
        result1 = await server.execute("item-create", {"name": "Widget", "value": 100})
        assert result1.success is True
        assert result1.data["name"] == "Widget"

        result2 = await server.execute("item-create", {"name": "Gadget", "value": 200})
        assert result2.success is True

        # List items
        result3 = await server.execute("item-list", {})
        assert result3.success is True
        assert len(result3.data["items"]) == 2
        assert result3.reasoning == "Found 2 items"
