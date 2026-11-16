"""Todo MCP server built with the afd Python package.

It serves the same thirteen ``todo-*`` commands as the TypeScript backend
(``backends/typescript/src/commands``), with the same metadata, inputs, limits, error codes,
result shapes and undo, the same change history and the same approval hold on ``todo-clear``,
so both pass ``spec/test-cases.json``. Its options mirror ``src/server-options.ts``.

Run it over stdio::

    uv run --project packages/examples/todo/backends/python todo-server
"""

from __future__ import annotations

import logging
import os
import secrets
import sys
from collections.abc import Callable, Mapping
from typing import Any, Literal

from afd.server import (
    CommandMiddleware,
    MCPServer,
    create_approval_middleware,
    create_server,
    default_middleware,
)

from todo_backend.batch_commands import batch_commands
from todo_backend.clear import clear_command, summarize_clear
from todo_backend.commands import single_commands
from todo_backend.contexts import TODO_CONTEXTS
from todo_backend.history import create_history_middleware, history_command
from todo_backend.store import Store, create_store

Env = Mapping[str, str]


def all_commands(store: Store) -> list[Callable[..., Any]]:
    """Every todo command bound to ``store``, in the TypeScript backend's order."""
    single = single_commands(store)
    batch = batch_commands(store)
    by_name = {command.__afd_command__.name: command for command in [*single, *batch]}
    by_name["todo-clear"] = clear_command(store)
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
    holds ``todo-clear`` for any caller that is not a person; ``off`` holds nothing. The shared
    conformance suites run with ``off``, as they set ``CONFIRMATIONS``."""
    value = env.get("APPROVALS", "agents")
    if value in ("agents", "off"):
        return value  # type: ignore[return-value]
    raise ValueError(f'APPROVALS must be agents or off, not "{value}"')


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


def create_todo_middleware(
    store: Store, commands: list[Callable[..., Any]], env: Env
) -> list[CommandMiddleware]:
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
                commands=commands,
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
    commands = all_commands(store)
    server = create_server(
        name="todo-app",
        version="1.0.0",
        description="A todo list manager demonstrating AFD patterns",
        middleware=create_todo_middleware(store, commands, env),
        # off (default), enforce or require-human (spec/command-metadata.md, "Confirmations").
        confirmations=env.get("CONFIRMATIONS", "off"),
        # Registers afd-context-list, -enter and -exit (todo_backend/contexts.py).
        contexts=TODO_CONTEXTS,
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
