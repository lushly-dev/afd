"""Todo MCP server built with the afd Python package.

It serves the same thirteen ``todo-*`` commands as the TypeScript backend
(``backends/typescript/src/commands``), with the same metadata, inputs, limits, error codes,
result shapes and undo, the same change history and the same approval hold on ``todo-clear``,
so both pass ``spec/test-cases.json``. Its options mirror ``src/server-options.ts``.

Run it over stdio::

    uv run --project packages/examples/todo/backends/python todo-server
"""

from __future__ import annotations

import asyncio
import logging
import os
import secrets
import sys
from collections.abc import Callable, Mapping
from typing import Any, Literal

from afd import ExposeOptions, success
from afd.server import (
    CommandMiddleware,
    MCPServer,
    TaskOptions,
    create_approval_middleware,
    create_server,
    default_middleware,
    define_command,
)
from pydantic import BaseModel, Field

from todo_backend.batch_commands import batch_commands
from todo_backend.clear import clear_command, summarize_clear
from todo_backend.commands import single_commands
from todo_backend.contexts import TODO_CONTEXTS
from todo_backend.history import create_history_middleware, history_command
from todo_backend.store import Store, create_store

Env = Mapping[str, str]


def all_commands(store: Store, *, held: bool = True) -> list[Callable[..., Any]]:
    """Every todo command bound to ``store``, in the TypeScript backend's order. With
    ``held=False``, ``todo-clear`` declares no approval policy (see :func:`create_todo_commands`)."""
    single = single_commands(store)
    batch = batch_commands(store)
    by_name = {command.__afd_command__.name: command for command in [*single, *batch]}
    by_name["todo-clear"] = clear_command(store, held=held)
    by_name["todo-history"] = history_command(store)
    order = [
        "todo-create",
        "todo-list",
        "todo-get",
        "todo-update",
        "todo-toggle",
        "todo-delete",
        "todo-clear",
        "todo-stats",
        "todo-create-batch",
        "todo-delete-batch",
        "todo-toggle-batch",
        "todo-restore",
        "todo-history",
    ]
    return [by_name[name] for name in order]


def resolve_approvals(env: Env) -> Literal["agents", "off"]:
    """Whether calls are held for approval, from ``APPROVALS`` (default ``agents``): ``agents``
    holds ``todo-clear`` for any caller that is not a person; ``off`` holds nothing, because
    :func:`create_todo_commands` then serves ``todo-clear`` with no approval policy. The shared
    conformance suites run with ``off``, as they set ``CONFIRMATIONS``."""
    value = env.get("APPROVALS", "agents")
    if value in ("agents", "off"):
        return value  # type: ignore[return-value]
    raise ValueError(f'APPROVALS must be agents or off, not "{value}"')


class _SlowTaskInput(BaseModel):
    delay_ms: int = Field(alias="delayMs", ge=0, le=10_000)


def _parse_optional_positive_int(env: Env, name: str) -> int | None:
    raw = env.get(name)
    if raw is None or not raw.strip():
        return None
    try:
        value = int(raw.strip())
    except ValueError as exc:
        raise ValueError(f'{name} must be a positive integer, not "{raw}"') from exc
    if value < 1:
        raise ValueError(f'{name} must be a positive integer, not "{raw}"')
    return value


def resolve_task_options(env: Env) -> TaskOptions | None:
    max_run_ms = _parse_optional_positive_int(env, "TASK_MAX_RUN_MS")
    ttl_ms = _parse_optional_positive_int(env, "TASK_RETENTION_MS")
    poll_interval_ms = _parse_optional_positive_int(env, "TASK_POLL_INTERVAL_MS")
    check_interval_ms = _parse_optional_positive_int(env, "TASK_CHECK_INTERVAL_MS")
    if (
        max_run_ms is None
        and ttl_ms is None
        and poll_interval_ms is None
        and check_interval_ms is None
    ):
        return None
    kwargs: dict[str, int] = {}
    if max_run_ms is not None:
        kwargs["max_run_ms"] = max_run_ms
    if ttl_ms is not None:
        kwargs["ttl_ms"] = ttl_ms
    if poll_interval_ms is not None:
        kwargs["poll_interval_ms"] = poll_interval_ms
    if check_interval_ms is not None:
        kwargs["check_interval_ms"] = check_interval_ms
    return TaskOptions(**kwargs)


def create_todo_commands(store: Store, env: Env) -> list[Callable[..., Any]]:
    """The commands the server serves. With ``APPROVALS=off`` there is no approval middleware,
    and the engine refuses a command that declares an approval policy without one
    (``APPROVAL_UNAVAILABLE``), so ``todo-clear`` is served without its policy: it runs for every
    caller, and ``_meta.approval`` does not advertise a hold the server does not make."""
    commands = all_commands(store, held=resolve_approvals(env) == "agents")
    if env.get("PROTOCOL_CONFORMANCE") == "1":

        @define_command(
            name="todo-internal-ping",
            description="Private internal probe not exposed to MCP",
            expose=ExposeOptions(mcp=False, agent=True),
        )
        async def internal_ping(input: Any) -> Any:
            return success({"pong": True})

        commands = [*commands, internal_ping]
    if env.get("TASK_CONFORMANCE") == "1":

        @define_command(
            name="todo-slow-task",
            description="Sleep for delayMs to test task execution budgets and retention",
            input_schema=_SlowTaskInput,
            expose=ExposeOptions(mcp=True),
            task="optional",
        )
        async def slow_task(input: _SlowTaskInput) -> Any:
            await asyncio.sleep(input.delay_ms / 1000.0)
            return success({"delayedMs": input.delay_ms})

        @define_command(
            name="todo-unserializable-task",
            description="Return a result JSON cannot hold, so its task ends failed",
            expose=ExposeOptions(mcp=True),
            task="required",
        )
        async def unserializable_task(input: Any) -> Any:
            loop: dict[str, Any] = {}
            loop["self"] = loop
            return success(loop)

        commands = [*commands, slow_task, unserializable_task]
    return commands


def resolve_approval_secret(env: Env) -> str | bytes:
    """The key that signs approval tokens: ``TODO_APPROVAL_SECRET`` (at least 32 bytes) when set,
    so several processes, in either language, accept each other's tokens; else a random key for
    this process."""
    secret = env.get("TODO_APPROVAL_SECRET")
    if secret is None:
        return secrets.token_bytes(32)
    if len(secret.encode("utf-8")) < 32:
        raise ValueError("TODO_APPROVAL_SECRET must be at least 32 bytes")
    return secret


def create_todo_middleware(store: Store, env: Env) -> list[CommandMiddleware]:
    """The middleware, outermost first:

    1. ``default_middleware()``: a trace ID for each call, logging and timing.
    2. The approval hold, when ``APPROVALS`` is ``agents``, so a held call never runs. The
       summary a person sees reads the store directly; it is synchronous here.
    3. The change history, which records each change that did run.
    """
    debug = env.get("LOG_LEVEL") == "debug"
    middleware: list[CommandMiddleware] = default_middleware(
        logging_mw={"log_input": True, "log_result": True} if debug else None
    )
    if resolve_approvals(env) == "agents":
        middleware.append(
            create_approval_middleware(
                secret=resolve_approval_secret(env),
                # An MCP client that declares form elicitation asks its person; any other caller
                # gets APPROVAL_REQUIRED with a suggestion to ask the person.
                relay="mcp-elicitation",
                summarize=lambda command, input, context: (
                    summarize_clear(store, input) if command == "todo-clear" else None
                ),
            )
        )
    middleware.append(create_history_middleware(store))
    return middleware


def create_app(store: Store, env: Env | None = None) -> MCPServer:
    """Create the todo MCP server with its commands bound to ``store``, configured from ``env``
    (default: the process environment)."""
    env = os.environ if env is None else env
    commands = create_todo_commands(store, env)
    server = create_server(
        name="todo-app",
        version="1.0.0",
        description="A todo list manager demonstrating AFD patterns",
        middleware=create_todo_middleware(store, env),
        # off (default), enforce or require-human (spec/command-metadata.md, "Confirmations").
        confirmations=env.get("CONFIRMATIONS", "off"),
        # Registers afd-context-list, -enter and -exit (todo_backend/contexts.py).
        contexts=TODO_CONTEXTS,
        # Adds the afd-help, afd-docs and afd-schema bootstrap tools, as the TypeScript backend.
        bootstrap=True,
        task_options=resolve_task_options(env),
    )
    for command in commands:
        server.register(command)
    return server


def main() -> None:
    """Run the todo MCP server over stdio."""

    # stdout carries JSON-RPC over stdio, so logs must go to stderr.
    logging.basicConfig(stream=sys.stderr, level=logging.INFO)
    create_app(create_store()).run()


if __name__ == "__main__":
    main()
