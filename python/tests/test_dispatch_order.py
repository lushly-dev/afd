"""Single-command dispatch order, matching ``packages/server/src/execution.ts``.

Lookup, exposure, active context and input validation run before the
middleware chain, so middleware only sees calls that reach a handler, with
validated input. An unknown command gets a "did you mean" suggestion.
"""

import pytest
from pydantic import BaseModel, model_validator

from afd import ExposeOptions, success
from afd.core.commands import CommandContext
from afd.server import create_server, define_command
from afd.server.middleware import create_rate_limit_middleware

DISCOVER_HINT = "Use afd-discover to list all commands."


class TodoInput(BaseModel):
    title: str
    count: int = 1


class OptionsInput(BaseModel):
    verbose: bool = False
    limit: int = 10


def _recording_middleware(calls: list):
    async def middleware(command_name, input, context, next_fn):
        calls.append((command_name, input))
        return await next_fn()

    return middleware


def _server(middleware=None, **kwargs):
    server = create_server("dispatch", middleware=middleware or [], **kwargs)

    @server.command(
        name="todo-create",
        description="Create a todo item",
        input_schema=TodoInput,
        expose=ExposeOptions(mcp=True),
    )
    async def todo_create(input: TodoInput):
        return success({"title": input.title, "count": input.count})

    @server.command(
        name="secret-rotate",
        description="Rotate the signing keys",
        expose=ExposeOptions(mcp=False, cli=True),
    )
    async def secret_rotate(input):
        return success({"rotated": True})

    return server


def _mcp_context() -> CommandContext:
    return CommandContext(extra={"interface": "mcp"})


class TestRejectedCallsSkipMiddleware:
    @pytest.mark.asyncio
    async def test_unknown_command(self):
        calls: list = []
        server = _server([_recording_middleware(calls)])

        result = await server.execute("todo-crate", {"title": "x"})

        assert result.error.code == "COMMAND_NOT_FOUND"
        assert calls == []

    @pytest.mark.asyncio
    async def test_invalid_input(self):
        calls: list = []
        server = _server([_recording_middleware(calls)])

        result = await server.execute("todo-create", {"count": "many"})

        assert result.error.code == "VALIDATION_ERROR"
        assert calls == []

    @pytest.mark.asyncio
    async def test_command_not_exposed_to_the_interface(self):
        calls: list = []
        server = _server([_recording_middleware(calls)])

        result = await server.execute("secret-rotate", {}, _mcp_context())

        assert result.error.code == "COMMAND_NOT_EXPOSED"
        assert calls == []

    @pytest.mark.asyncio
    async def test_command_outside_the_active_context(self):
        calls: list = []
        server = create_server(
            "dispatch",
            middleware=[_recording_middleware(calls)],
            contexts=[{"name": "editing"}, {"name": "reviewing"}],
        )

        @server.command(name="doc-edit", description="Edit a document", contexts=["editing"])
        async def doc_edit(input):
            return success({"ok": True})

        await server.call_tool("afd-context-enter", {"context": "reviewing"})
        calls.clear()

        result = await server.execute("doc-edit", {})

        assert result.error.code == "COMMAND_NOT_IN_CONTEXT"
        assert calls == []

    @pytest.mark.asyncio
    async def test_rejected_calls_do_not_spend_the_rate_limit(self):
        server = _server([create_rate_limit_middleware(1, 60_000)])

        for _ in range(3):
            await server.execute("todo-crate", {})
            await server.execute("todo-create", {})

        result = await server.execute("todo-create", {"title": "x"})

        assert result.success is True


class TestMiddlewareSeesValidatedInput:
    @pytest.mark.asyncio
    async def test_middleware_and_handler_get_the_same_validated_input(self):
        calls: list = []
        server = create_server("dispatch", middleware=[_recording_middleware(calls)])
        received = []

        @server.command(name="todo-create", description="Create", input_schema=TodoInput)
        async def todo_create(input: TodoInput):
            received.append(input)
            return success({})

        await server.execute("todo-create", {"title": "x"})

        [(_, seen)] = calls
        assert isinstance(seen, TodoInput)
        assert seen.count == 1  # the schema default is applied
        assert received == [seen] and received[0] is seen

    @pytest.mark.asyncio
    async def test_input_is_validated_once(self):
        validations = []

        class CountedInput(BaseModel):
            title: str

            @model_validator(mode="after")
            def count(self):
                validations.append(self.title)
                return self

        server = create_server("dispatch", middleware=[_recording_middleware([])])

        @server.command(name="todo-create", description="Create", input_schema=CountedInput)
        async def todo_create(input: CountedInput):
            return success({})

        result = await server.execute("todo-create", {"title": "x"})

        assert result.success is True
        assert validations == ["x"]

    @pytest.mark.asyncio
    async def test_middleware_sees_the_stamped_result(self):
        stamped = []

        async def middleware(command_name, input, context, next_fn):
            result = await next_fn()
            stamped.append(result.metadata.execution_time_ms)
            return result

        server = _server([middleware])

        await server.execute("todo-create", {"title": "x"})

        assert len(stamped) == 1 and stamped[0] is not None

    @pytest.mark.asyncio
    async def test_handler_exception_passes_out_through_middleware(self):
        raised = []

        async def middleware(command_name, input, context, next_fn):
            try:
                return await next_fn()
            except RuntimeError as exc:
                raised.append(exc)
                raise

        server = create_server("dispatch", middleware=[middleware])

        @server.command(name="todo-create", description="Create")
        async def todo_create(input):
            raise RuntimeError("handler bug")

        result = await server.execute("todo-create", {})

        assert len(raised) == 1
        assert result.error.code == "COMMAND_EXECUTION_ERROR"
        assert result.error.message == "An internal error occurred"


class TestValidatorExceptions:
    class ExplodingInput(BaseModel):
        title: str

        @model_validator(mode="after")
        def explode(self):
            raise TypeError("validator bug at /srv/app/models.py")

    @pytest.mark.asyncio
    async def test_raising_validator_is_a_validation_error_before_middleware(self):
        calls: list = []
        server = create_server("dispatch", middleware=[_recording_middleware(calls)])

        @server.command(name="todo-create", description="Create", input_schema=self.ExplodingInput)
        async def todo_create(input):
            return success({})

        result = await server.execute("todo-create", {"title": "x"})

        assert result.error.code == "VALIDATION_ERROR"
        assert "/srv/app" not in result.error.suggestion
        assert calls == []

    @pytest.mark.asyncio
    async def test_dev_mode_shows_the_validator_error(self):
        server = create_server("dispatch", dev_mode=True)

        @server.command(name="todo-create", description="Create", input_schema=self.ExplodingInput)
        async def todo_create(input):
            return success({})

        result = await server.execute("todo-create", {"title": "x"})

        assert result.error.code == "VALIDATION_ERROR"
        assert "validator bug" in result.error.suggestion


class TestDidYouMean:
    @pytest.mark.asyncio
    async def test_execute_suggests_a_close_match(self):
        server = _server()

        result = await server.execute("todo-crate", {})

        assert result.error.message == "Command 'todo-crate' not found"
        assert result.error.suggestion == f"Did you mean 'todo-create'? {DISCOVER_HINT}"

    @pytest.mark.asyncio
    async def test_no_close_match_points_to_discovery(self):
        server = _server()

        result = await server.execute("zzzzzzzz", {})

        assert result.error.suggestion == DISCOVER_HINT

    @pytest.mark.asyncio
    async def test_suggestions_omit_commands_hidden_from_the_interface(self):
        server = _server()

        in_process = await server.execute("secret-rotat", {})
        over_mcp = await server.execute("secret-rotat", {}, _mcp_context())

        assert in_process.error.suggestion.startswith("Did you mean 'secret-rotate'?")
        assert "secret-rotate" not in over_mcp.error.suggestion

    @pytest.mark.asyncio
    async def test_suggestions_omit_commands_outside_the_active_context(self):
        server = create_server("dispatch", contexts=[{"name": "editing"}, {"name": "reviewing"}])

        @server.command(name="doc-edit", description="Edit a document", contexts=["editing"])
        async def doc_edit(input):
            return success({})

        await server.call_tool("afd-context-enter", {"context": "reviewing"})

        result = await server.execute("doc-edt", {})

        assert result.error.code == "COMMAND_NOT_FOUND"
        assert "doc-edit" not in result.error.suggestion

    @pytest.mark.asyncio
    async def test_afd_call_suggests_a_close_match(self):
        server = _server()

        result = await server.call_tool("afd-call", {"command": "todo-crate"})

        assert result.error.code == "COMMAND_NOT_FOUND"
        assert result.error.suggestion == f"Did you mean 'todo-create'? {DISCOVER_HINT}"


class TestNoneInput:
    @pytest.mark.asyncio
    async def test_required_fields_fail_validation_instead_of_crashing(self):
        called = []

        @define_command(name="todo-create", description="Create", input_schema=TodoInput)
        async def todo_create(input: TodoInput):
            called.append(input)
            return success({"title": input.title})

        result = await todo_create(None)

        assert result.error.code == "VALIDATION_ERROR"
        assert result.error.details["missingFields"] == ["title"]
        assert called == []

    @pytest.mark.asyncio
    async def test_schema_defaults_apply(self):
        @define_command(name="report-run", description="Run", input_schema=OptionsInput)
        async def report_run(input: OptionsInput):
            return success(input.model_dump())

        result = await report_run(None)

        assert result.success is True
        assert result.data == {"verbose": False, "limit": 10}

    @pytest.mark.asyncio
    async def test_server_returns_validation_error(self):
        server = _server()

        result = await server.execute("todo-create", None)

        assert result.error.code == "VALIDATION_ERROR"
        assert result.error.details["missingFields"] == ["title"]

    @pytest.mark.asyncio
    async def test_command_without_a_schema_still_gets_none(self):
        received = []

        @define_command(name="ping-run", description="Ping")
        async def ping_run(input):
            received.append(input)
            return success({})

        await ping_run(None)

        assert received == [None]
