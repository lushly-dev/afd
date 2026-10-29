"""Botcore command registry using AFD DirectClient."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from afd import (
    DirectClient,
    SimpleRegistry,
    create_direct_client,
)
from afd.server.middleware import CommandMiddleware, compose_middleware, default_middleware

# Global registry instance
registry = SimpleRegistry()

# Global client (lazy initialized)
_client: DirectClient | None = None

# Plugin middleware (set during startup)
_plugin_middleware: list[CommandMiddleware] = []


class MiddlewareRegistry:
    """DirectRegistry wrapper that applies middleware to every execute()."""

    def __init__(self, inner: SimpleRegistry) -> None:
        self._inner = inner
        self._middleware: list[CommandMiddleware] = []

    def add_middleware(self, mw: CommandMiddleware) -> None:
        self._middleware.append(mw)

    async def execute(self, name: str, args: Any = None, context: Any = None) -> Any:
        if not self._middleware:
            return await self._inner.execute(name, args, context)
        composed = compose_middleware(*self._middleware)

        async def next_fn():
            return await self._inner.execute(name, args, context)

        return await composed(name, args, context, next_fn)

    # Delegate all other DirectRegistry methods
    def has_command(self, name: str) -> bool:
        return self._inner.has_command(name)

    def list_commands(self) -> list:
        return self._inner.list_commands()

    def list_command_names(self) -> list[str]:
        return self._inner.list_command_names()

    def get_command(self, name: str) -> Any:
        return self._inner.get_command(name)

    def register(self, *a: Any, **kw: Any) -> Any:
        return self._inner.register(*a, **kw)

    def command(self, *a: Any, **kw: Any) -> Any:
        return self._inner.command(*a, **kw)


def set_plugin_middleware(middleware: list[CommandMiddleware]) -> None:
    """Set plugin-registered middleware (called during startup)."""
    global _plugin_middleware
    _plugin_middleware = middleware


def get_client(
    source: str | None = None,
    debug: bool = False,
    config: Any = None,
) -> DirectClient:
    """Get the global DirectClient for inter-module calls.

    The client is lazily initialized and reused across calls.
    Applies default AFD middleware (trace_id, logging, timing),
    optional telemetry middleware, and plugin-registered middleware.

    Args:
        source: Optional source identifier for tracing.
        debug: Enable debug logging.
        config: Optional BotCoreConfig for telemetry settings.

    Returns:
        DirectClient instance.
    """
    global _client
    if _client is None:
        mw_registry = MiddlewareRegistry(registry)
        for mw in default_middleware():
            mw_registry.add_middleware(mw)
        # Telemetry middleware (opt-in via config)
        if config and getattr(config, "telemetry_enabled", False):
            from afd.core.telemetry import ConsoleTelemetrySink
            from afd.server.middleware import create_telemetry_middleware

            sink = ConsoleTelemetrySink(
                format=getattr(config, "telemetry_format", "text"),
            )
            mw_registry.add_middleware(create_telemetry_middleware(sink))
        for mw in _plugin_middleware:
            mw_registry.add_middleware(mw)
        _client = create_direct_client(
            mw_registry,
            source=source or "botcore",
            debug=debug,
        )
    return _client


def reset_client() -> None:
    """Reset the global client (primarily for testing)."""
    global _client
    _client = None


async def batch_execute(
    client: DirectClient,
    commands: list[tuple[str, dict]],
    stop_on_error: bool = False,
) -> BatchResult:
    """Execute multiple commands as a batch.

    Args:
        client: DirectClient instance.
        commands: List of (command_name, args_dict) tuples.
        stop_on_error: Stop executing on first failure.

    Returns:
        BatchResult with individual results and summary.
    """
    import time
    from datetime import UTC, datetime

    from afd.core.batch import (
        BatchCommandResult,
        BatchTiming,
        create_batch_request,
        create_batch_result,
    )

    batch = create_batch_request([
        {"command": cmd, "input": args} for cmd, args in commands
    ])
    results: list[BatchCommandResult] = []
    started = datetime.now(UTC).isoformat()
    for i, cmd in enumerate(batch.commands):
        t0 = time.monotonic()
        result = await client.call(cmd.command, cmd.input)
        dur = (time.monotonic() - t0) * 1000
        results.append(BatchCommandResult(
            id=cmd.id, index=i, command=cmd.command,
            result=result, duration_ms=dur,
        ))
        if not result.success and stop_on_error:
            break
    completed = datetime.now(UTC).isoformat()
    total_ms = sum(r.duration_ms for r in results)
    avg_ms = total_ms / len(results) if results else 0
    timing = BatchTiming(
        total_ms=total_ms, average_ms=avg_ms,
        started_at=started, completed_at=completed,
    )
    return create_batch_result(results, timing)


if TYPE_CHECKING:
    from afd.core.batch import BatchResult


__all__ = [
    "MiddlewareRegistry",
    "batch_execute",
    "registry",
    "get_client",
    "reset_client",
    "set_plugin_middleware",
]
