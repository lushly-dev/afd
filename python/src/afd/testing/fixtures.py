"""
Pytest fixtures for testing AFD commands.

This module provides fixtures that make it easy to test commands
in isolation with proper setup and teardown.

Example:
    >>> def test_create_user(isolated_registry, mock_server):
    ...     @mock_server.command("user-create")
    ...     async def create_user(input):
    ...         return success({"id": 1, "name": input["name"]})
    ...
    ...     result = await mock_server.execute("user-create", {"name": "Alice"})
    ...     assert_success(result)
"""

import inspect
import logging
from collections.abc import AsyncGenerator, Callable, Generator, Sequence
from contextlib import contextmanager
from typing import Any, TypeVar

import pytest

from afd.core import (
    DEFAULT_MAX_BATCH_PARALLELISM,
    DEFAULT_MAX_BATCH_SIZE,
    Actor,
    BatchResult,
    CallGrant,
    Clock,
    CommandContext,
    CommandDefinition,
    CommandMiddleware,
    CommandRegistry,
    CommandResult,
    ContextDefaults,
    ExecutorOptions,
    ExposeOptions,
    RandomSource,
    StreamChunk,
    StreamExecutorOptions,
    StreamOptions,
    create_command_registry,
    execute_batch,
    execute_stream,
    system_clock,
    system_random,
)
from afd.core.command_execution import resolve_batch_limit
from afd.core.commands import declared_secret
from afd.core.dispatch_id import ENGINE_ENTRY, owned_entry
from afd.core.single_executor import CommandExecutionConfig, execute_command
from afd.transports import MockTransport

_testing_logger = logging.getLogger("afd.testing")

T = TypeVar("T")


@pytest.fixture
def command_context() -> CommandContext:
    """Create a basic command context for testing.

    This fixture provides a minimal command context suitable for
    testing commands that don't need special context values.

    Example:
        >>> def test_my_command(command_context):
        ...     result = await my_command(input, context=command_context)
        ...     assert result.success

    Returns:
        A CommandContext with default values, the actor ``Actor(kind="test")``
        and the real clock and random source.
    """
    return CommandContext(
        trace_id="test-trace-001",
        timeout=5000,
        extra={"environment": "test"},
        actor=Actor(kind="test"),
        clock=system_clock,
        random=system_random,
    )


@pytest.fixture
def mock_server():
    """Create a mock server for testing commands.

    This fixture provides a mock server that can register and
    execute commands without actual network communication.

    Example:
        >>> def test_my_command(mock_server):
        ...     @mock_server.command("ping")
        ...     async def ping(input):
        ...         return success("pong")
        ...
        ...     result = await mock_server.execute("ping", {})
        ...     assert result.data == "pong"

    Returns:
        A MockServer instance.
    """
    return MockServer()


@pytest.fixture
def isolated_registry():
    """Create an isolated command registry for testing.

    This fixture creates a fresh registry that won't interfere
    with other tests or the global registry.

    Example:
        >>> def test_registry(isolated_registry):
        ...     isolated_registry.register(my_command_definition)
        ...     assert isolated_registry.has("my-command")

    Returns:
        A fresh CommandRegistry instance.
    """
    return create_command_registry()


def _context_passing_mode(func: Callable[..., Any]) -> str:
    """How a mock command handler accepts a ``CommandContext`` argument.

    - ``"keyword"``: keyword-only ``context`` parameter (``def h(inp, *, context)``)
    - ``"positional"``: second positional parameter named ``context``, required
      without a default (``def h(inp, ctx)``), or annotated ``CommandContext``
    - ``"none"``: single-argument handlers (including ``def h(context)``) and
      handlers whose extra positional parameters are optional non-context defaults
    """
    try:
        sig = inspect.signature(func)
    except (TypeError, ValueError):
        return "none"
    params = list(sig.parameters.values())
    if any(
        param.kind is inspect.Parameter.KEYWORD_ONLY and param.name == "context" for param in params
    ):
        return "keyword"
    positional = [
        param
        for param in params
        if param.kind
        in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
    ]
    if len(positional) >= 2:
        second = positional[1]
        if second.name == "context" or second.default is inspect.Parameter.empty:
            return "positional"
        if second.annotation is not inspect.Parameter.empty and "CommandContext" in str(
            second.annotation
        ):
            return "positional"
    return "none"


class MockServer:
    """Mock server for testing commands, backed by the shared core executor.

    Registers handlers into an in-memory definition table and executes single
    commands, batches and streams through the shared core executors so
    exposure, allow, cancellation, deadlines, middleware and error redaction
    match production registries.

    Example:
        >>> server = MockServer()
        >>>
        >>> @server.command("user-create")
        >>> async def create_user(input):
        ...     return success({"id": 1, "name": input["name"]})
        >>>
        >>> result = await server.execute("user-create", {"name": "Alice"})
        >>> assert result.success
    """

    def __init__(
        self,
        *,
        dev_mode: bool = False,
        middleware: Sequence[CommandMiddleware] | None = None,
        clock: Clock | None = None,
        random: RandomSource | None = None,
        call_grant: CallGrant | None = None,
        max_batch_size: int = DEFAULT_MAX_BATCH_SIZE,
        max_batch_parallelism: int = DEFAULT_MAX_BATCH_PARALLELISM,
    ):
        """Initialize the mock server."""
        self._commands: dict[str, Callable[..., Any]] = {}
        self._definitions: dict[str, CommandDefinition] = {}
        self._transport = MockTransport()
        self._dev_mode = dev_mode
        self._middleware: list[CommandMiddleware] = list(middleware or [])
        self._context_defaults = ContextDefaults(
            clock=clock,
            random=random,
            actor=Actor(kind="test"),
        )
        self._call_grant = call_grant
        self._max_batch_size = resolve_batch_limit(
            max_batch_size, DEFAULT_MAX_BATCH_SIZE, "max_batch_size"
        )
        self._max_batch_parallelism = resolve_batch_limit(
            max_batch_parallelism, DEFAULT_MAX_BATCH_PARALLELISM, "max_batch_parallelism"
        )

    def command(
        self,
        name: str,
        *,
        description: str | None = None,
        expose: ExposeOptions | None = None,
        input_schema: dict[str, Any] | None = None,
        contexts: list[str] | None = None,
        secret: bool = False,
    ):
        """Decorator to register a command handler.

        Args:
            name: Command name (e.g., "user-create").
            description: Optional description for the mock command.
            expose: Optional exposure options (defaults to MCP + agent + palette).
            input_schema: Optional JSON Schema validated before middleware/handler.
            contexts: Optional context names that scope this command.
            secret: Whether the command takes or returns a secret (also read from a
                ``define_command`` decoration): a journal records it only with ``redact``.

        Returns:
            Decorator function.

        Example:
            >>> @server.command("ping")
            >>> async def ping(input):
            ...     return success("pong")
        """

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            from afd.core.commands import is_mcp_exposed

            declared = declared_secret(name, func, secret)
            self._commands[name] = func
            ctx_mode = _context_passing_mode(func)

            async def adapted(
                data: Any, context: CommandContext | None = None
            ) -> CommandResult[Any]:
                payload = {} if data is None else data
                # A define_command function runs through its engine entry: this is the engine's
                # call, so the handler reads the dispatch id the middleware read.
                engine_entry = owned_entry(func, ENGINE_ENTRY)
                if engine_entry is not None:
                    result = await engine_entry(payload, context)
                elif ctx_mode == "keyword":
                    result = await func(payload, context=context)
                elif ctx_mode == "positional":
                    result = await func(payload, context)
                else:
                    result = await func(payload)
                if isinstance(result, dict):
                    return CommandResult(**result)
                return result

            definition = CommandDefinition(
                name=name,
                description=description or func.__doc__ or f"Mock: {name}",
                handler=adapted,
                expose=expose if expose is not None else ExposeOptions(mcp=True),
                input_schema=input_schema,
                contexts=list(contexts or []),
                secret=declared,
            )
            self._definitions[name] = definition

            # Register with the mock MCP transport only when exposed to MCP.
            if is_mcp_exposed(definition):

                async def wrapper(args: Any) -> CommandResult[Any]:
                    return await self.execute(
                        name, args, CommandContext(extra={"interface": "mcp"})
                    )

                self._transport.register_tool(name, wrapper, description=f"Mock: {name}")

            return func

        return decorator

    async def execute(
        self,
        name: str,
        input: dict[str, Any] | None = None,
        context: CommandContext | None = None,
        *,
        output_budget: Any = None,
    ) -> CommandResult[Any]:
        """Execute a registered command through the shared core executor."""
        config = CommandExecutionConfig(
            lookup=self._definitions.get,
            list_commands=lambda: list(self._definitions.values()),
            middleware=self._middleware,
            dev_mode=self._dev_mode,
            call_grant=self._call_grant,
            context_defaults=self._context_defaults,
            logger=_testing_logger,
            suggest_tools=False,
            stamp_metadata=False,
        )
        return await execute_command(
            name,
            input,
            context,
            config=config,
            output_budget=output_budget,
        )

    async def execute_batch(
        self,
        request: Any,
        context: CommandContext | None = None,
    ) -> BatchResult[Any]:
        """Execute a batch of commands through this mock server's ``execute``."""
        return await execute_batch(
            request,
            self.execute,
            context,
            ExecutorOptions(
                dev_mode=self._dev_mode,
                max_batch_size=self._max_batch_size,
                max_batch_parallelism=self._max_batch_parallelism,
            ),
        )

    def execute_stream(
        self,
        name: str,
        input: dict[str, Any] | None = None,
        options: StreamOptions | None = None,
        context: CommandContext | None = None,
    ) -> AsyncGenerator[StreamChunk, None]:
        """Execute a command through this mock server's ``execute`` and stream its result."""
        timeout = options.timeout if options is not None else None
        return execute_stream(
            name,
            input,
            self.execute,
            context,
            StreamExecutorOptions(dev_mode=self._dev_mode, timeout=timeout),
        )

    @property
    def transport(self) -> MockTransport:
        """Get the underlying mock transport for advanced testing.

        Returns:
            The MockTransport instance.
        """
        return self._transport

    def has(self, name: str) -> bool:
        """Check if a command is registered.

        Args:
            name: Command name.

        Returns:
            True if command exists.
        """
        return name in self._commands

    def list_commands(self) -> list[str]:
        """List all registered commands.

        Returns:
            List of command names.
        """
        return list(self._commands.keys())


@contextmanager
def temporary_command(
    registry: CommandRegistry,
    name: str,
    handler: Callable,
) -> Generator[None, None, None]:
    """Temporarily register a command for testing.

    This context manager registers a command and automatically
    cleans it up after the test.

    Args:
        registry: Registry to register in.
        name: Command name.
        handler: Command handler function.

    Yields:
        Nothing.

    Example:
        >>> with temporary_command(registry, "test-cmd", handler):
        ...     result = await registry.execute("test-cmd", {})
        ...     assert result.success
    """
    from afd.core import CommandDefinition

    # Create a minimal definition
    definition = CommandDefinition(
        name=name,
        description=f"Temporary test command: {name}",
        handler=handler,
        parameters=[],
    )

    # Register
    registry.register(definition)

    try:
        yield
    finally:
        # Clean up - note: CommandRegistry doesn't have unregister,
        # but in a real implementation you'd want this
        pass
