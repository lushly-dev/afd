"""Shared single-command execution engine.

Centralizes the AFD single-command dispatch pipeline (``spec/dispatch.md``):

1. App-to-app call grant check (``interface == 'apps'``)
2. Direct-client ``allow`` predicate check
3. Command lookup (with visibility filtering and did-you-mean suggestions)
4. Interface exposure check
5. Active context check
6. Input validation
7. Post-validation hooks (M6 scope re-check, context fields)
8. Output budget ask validation and effective budget resolution (B2-B4)
9. Pre-execution cancellation check
10. Middleware chain wrapping approval admission, handler invocation, B5 output
    budget check and optional execution metadata stamping
11. Deadline enforcement (``TIMEOUT`` with cooperative signal propagation) and
    exception redaction (``COMMAND_EXECUTION_ERROR`` outside ``dev_mode``)

``MCPServer``, ``CommandRegistry``, ``SimpleRegistry`` and ``MockServer`` all
execute single commands through this module so dispatch semantics never drift.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import math
from collections.abc import Awaitable, Callable, Mapping, Sequence
from contextlib import AbstractContextManager, nullcontext, suppress
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from afd.core.actor import ContextDefaults, actor_kind_of, with_context_defaults
from afd.core.clock import system_clock
from afd.core.direct_allow import _is_allowed, _not_allowed
from afd.core.errors import CommandError
from afd.core.output_budget import (
    apply_output_budget,
    check_output_budget,
    coerce_budgeted_result,
    normalize_ask_option,
)
from afd.core.result import CommandResult, ResultMetadata, error, execution_failure, failure
from afd.core.running_command import bind_continuation, open_running_command
from afd.core.similarity import find_similar_tools, truncate_name

if TYPE_CHECKING:
    from afd.core.commands import CallGrant, CommandContext, CommandDefinition, CommandMiddleware

_DEFAULT_LOGGER = logging.getLogger("afd.core")

_VALID_INTERFACES = frozenset({"palette", "mcp", "agent", "cli", "apps"})
_MAX_NOT_FOUND_MATCHES = 3
_MAX_TIMEOUT_MS = 2_147_483_647


def is_exposed_to(command: CommandDefinition, interface: Any) -> bool:
    """Whether ``command`` is exposed on ``interface``.

    An unknown interface exposes nothing and is never looked up as an attribute.
    """
    if not isinstance(interface, str) or interface not in _VALID_INTERFACES:
        return False
    from afd.core.commands import DEFAULT_EXPOSE

    expose = command.expose if command.expose is not None else DEFAULT_EXPOSE
    return bool(getattr(expose, interface, False))


def not_found_suggestion(
    command_name: str,
    command_names: Sequence[str],
    *,
    suggest_tools: bool = True,
) -> str:
    """Recovery guidance for an unknown command name.

    Names at most three close matches and points to ``afd-discover`` only when
    the host serves the MCP meta-tool surface (``spec/error-codes.md``, D4).
    """
    fallback = (
        "Use afd-discover to list all commands."
        if suggest_tools
        else "List available commands to see valid options"
    )
    matches = find_similar_tools(command_name, command_names, _MAX_NOT_FOUND_MATCHES)
    if not matches:
        return fallback
    best, *others = matches
    quoted_others = ", ".join(f"'{name}'" for name in others)
    also_close = f" Other close matches: {quoted_others}." if others else ""
    return f"Did you mean '{best}'?{also_close} {fallback}"


def with_execution_metadata(
    result: CommandResult[Any],
    *,
    execution_time_ms: float,
    command_version: str | None,
    trace_id: str | None,
    actor_kind: str | None = None,
) -> CommandResult[Any]:
    """Return a copy of ``result`` carrying execution metadata fields.

    The handler's own result object is never mutated.
    """
    updates: dict[str, Any] = {"execution_time_ms": round(execution_time_ms, 2)}
    if command_version:
        updates["command_version"] = command_version
    if trace_id:
        updates["trace_id"] = trace_id
    if actor_kind:
        updates["actor_kind"] = actor_kind
    metadata = (
        result.metadata.model_copy(update=updates)
        if result.metadata is not None
        else ResultMetadata(**updates)
    )
    return result.model_copy(update={"metadata": metadata})


def _consume_task_exception(task: asyncio.Task[Any]) -> None:
    """Retrieve late exceptions from cancelled tasks so asyncio does not warn."""
    if not task.cancelled():
        with suppress(Exception):
            task.exception()


def _is_context_cancelled(context: Any) -> bool:
    cancel = getattr(context, "cancel", None)
    signal = getattr(context, "signal", None)
    return bool(
        (cancel is not None and cancel.is_set()) or (signal is not None and signal.is_set())
    )


def _cancelled_before_start(name: str) -> CommandResult[Any]:
    return failure(
        CommandError(
            code="COMMAND_CANCELLED",
            message=f"Command '{truncate_name(name)}' was cancelled before it started",
            suggestion="Retry with a fresh signal if the command is still needed.",
            retryable=False,
        )
    )


def _cancelled_during_execution(name: str) -> CommandResult[Any]:
    return failure(
        CommandError(
            code="COMMAND_CANCELLED",
            message=f"Command '{truncate_name(name)}' was cancelled during execution",
            suggestion="Retry with a fresh signal if the command is still needed.",
            retryable=False,
        )
    )


def _resolve_timeout_ms(
    caller_timeout: Any,
    default_timeout_ms: int | float | None,
) -> int | float | None:
    if caller_timeout is None:
        return default_timeout_ms
    if (
        isinstance(caller_timeout, (int, float))
        and not isinstance(caller_timeout, bool)
        and (isinstance(caller_timeout, int) or math.isfinite(caller_timeout))
        and caller_timeout > 0
    ):
        return caller_timeout
    return None


def _default_active_context(context: CommandContext) -> str | None:
    extra = getattr(context, "extra", None)
    if not isinstance(extra, Mapping):
        return None
    active = extra.get("active_context")
    return active if isinstance(active, str) and active else None


def _default_validate_input(
    command: CommandDefinition,
    input: Any,
    context: CommandContext,
    *,
    dev_mode: bool,
    logger: logging.Logger,
) -> tuple[bool, Any]:
    decorated_validator = getattr(command.handler, "__afd_validate_input__", None)
    if decorated_validator is None and command.input_schema is None:
        return True, input
    from afd.core.schema_validation import (
        SchemaValidationError,
        schema_validation_failure,
        validate_schema,
    )

    try:
        if decorated_validator is not None:
            return decorated_validator(input)  # type: ignore[no-any-return]
        assert command.input_schema is not None
        validated = validate_schema(command.input_schema, {} if input is None else input)
    except SchemaValidationError as exc:
        return False, schema_validation_failure(exc)
    except Exception as exc:
        logger.error("Input validation for '%s' raised", command.name, exc_info=exc)
        return False, failure(
            CommandError(
                code="VALIDATION_ERROR",
                message="Input validation failed",
                suggestion=(
                    f"Input validation threw: {exc}"
                    if dev_mode
                    else "Check the input against the command's registered schema and retry"
                ),
            )
        )
    return True, validated


@dataclass(frozen=True)
class CommandExecutionConfig:
    """Host configuration for :func:`execute_command`."""

    lookup: Callable[[str], CommandDefinition | None]
    list_commands: Callable[[], Sequence[CommandDefinition]]
    middleware: Sequence[CommandMiddleware] = ()
    dev_mode: bool = False
    call_grant: CallGrant | None = None
    context_defaults: ContextDefaults | None = None
    default_timeout_ms: int | float | None = None
    logger: logging.Logger = field(default_factory=lambda: _DEFAULT_LOGGER)
    suggest_tools: bool = False
    stamp_metadata: bool = False
    # Optional host hooks (all None for bare core/direct registries).
    context_scope: Callable[[Any, Any], AbstractContextManager[None]] | None = None
    lookup_apps: Callable[[str], CommandDefinition | None] | None = None
    before_request: Callable[[], None] | None = None
    active_context_getter: Callable[[CommandContext], str | None] | None = None
    is_hidden: Callable[[CommandDefinition, CommandContext], bool] | None = None
    is_shown: Callable[[CommandDefinition, CommandContext], bool] | None = None
    not_found_builder: Callable[[str, list[str]], CommandResult[Any]] | None = None
    not_in_context_suggestion: str | None = None
    validate_input: (
        Callable[[CommandDefinition, Any, CommandContext], Awaitable[tuple[bool, Any]]] | None
    ) = None
    post_validate: (
        Callable[[CommandDefinition, Any, CommandContext], CommandResult[Any] | None] | None
    ) = None
    admission_scope: (
        Callable[[CommandContext, CommandDefinition], AbstractContextManager[Any]] | None
    ) = None
    check_admission: Callable[[Any, CommandDefinition, Any], CommandResult[Any] | None] | None = (
        None
    )
    invoke_handler: Callable[[CommandDefinition, Any, CommandContext], Awaitable[Any]] | None = None
    after_execute: Callable[[str, Any], None] | None = None


def _internal_error(
    logger: logging.Logger,
    command_name: str,
    exc: BaseException,
    dev_mode: bool,
) -> CommandResult[Any]:
    logger.error("Command '%s' raised an unhandled exception", command_name, exc_info=exc)
    return execution_failure(exc, dev_mode)


async def _run_chain_with_deadline(
    name: str,
    context: Any,
    next_fn: Callable[[], Awaitable[Any]],
    effective_timeout: int | float | None,
    *,
    dev_mode: bool,
    logger: logging.Logger,
) -> Any:
    if effective_timeout is None:
        try:
            return await next_fn()
        except Exception as exc:
            return _internal_error(logger, name, exc, dev_mode)

    caller_signal = getattr(context, "signal", None)
    caller_cancel = getattr(context, "cancel", None)
    prev_server_signal = getattr(context, "_server_signal", None)
    prev_server_fields = set(getattr(context, "_server_signal_fields", ()) or ())
    has_signal_attr = hasattr(context, "signal")
    has_cancel_attr = hasattr(context, "cancel")
    has_server_signal_attr = hasattr(context, "_server_signal")
    has_server_signal_fields_attr = hasattr(context, "_server_signal_fields")
    deadline_event = asyncio.Event()
    synthesized_fields: list[str] = []
    # Link deadline cancellation onto context.signal/cancel while recording
    # synthesized fields so journal digests remain unchanged for unset fields.
    if has_signal_attr:
        context.signal = deadline_event
        if caller_signal is None or (
            prev_server_signal is not None
            and caller_signal is prev_server_signal
            and "signal" in prev_server_fields
        ):
            synthesized_fields.append("signal")
    if has_cancel_attr:
        context.cancel = deadline_event
        if caller_cancel is None or (
            prev_server_signal is not None
            and caller_cancel is prev_server_signal
            and "cancel" in prev_server_fields
        ):
            synthesized_fields.append("cancel")
    if synthesized_fields and has_server_signal_attr:
        context._server_signal = deadline_event
        if has_server_signal_fields_attr:
            context._server_signal_fields = tuple(synthesized_fields)

    watcher: asyncio.Task[None] | None = None
    caller_events = [ev for ev in (caller_signal, caller_cancel) if ev is not None]
    if any(ev.is_set() for ev in caller_events):
        deadline_event.set()
    elif caller_events:

        async def _mirror_caller() -> None:
            waits = [asyncio.create_task(ev.wait()) for ev in caller_events]
            try:
                await asyncio.wait(waits, return_when=asyncio.FIRST_COMPLETED)
                deadline_event.set()
            finally:
                for wait_task in waits:
                    if not wait_task.done():
                        wait_task.cancel()

        watcher = asyncio.create_task(_mirror_caller())
        watcher.add_done_callback(_consume_task_exception)

    timeout_seconds = min(effective_timeout, _MAX_TIMEOUT_MS) / 1000.0

    async def _run_next() -> Any:
        return await next_fn()

    task: asyncio.Task[Any] = asyncio.create_task(_run_next())
    try:
        done, _ = await asyncio.wait({task}, timeout=timeout_seconds)
        if task in done:
            if task.cancelled():
                return _cancelled_during_execution(name)
            task_exc = task.exception()
            if task_exc is not None:
                if not isinstance(task_exc, Exception):
                    raise task_exc
                return _internal_error(logger, name, task_exc, dev_mode)
            return task.result()

        deadline_event.set()
        task.cancel()
        task.add_done_callback(_consume_task_exception)
        await asyncio.sleep(0)
        return failure(
            CommandError(
                code="TIMEOUT",
                message=f"Command '{truncate_name(name)}' timed out after {effective_timeout}ms",
                suggestion=(
                    "Retry with a larger timeout. The command was signalled to abort "
                    "but may have completed, so check its effect before retrying a mutation."
                ),
                retryable=True,
                details={"command": name, "timeoutMs": effective_timeout},
            )
        )
    except asyncio.CancelledError:
        deadline_event.set()
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        raise
    finally:
        if watcher is not None and not watcher.done():
            watcher.cancel()
        if not task.done():
            task.add_done_callback(_consume_task_exception)


async def execute_command(
    name: str,
    input: Any,
    context: Any = None,
    *,
    config: CommandExecutionConfig,
    output_budget: Any = None,
    skip_output_budget: bool = False,
) -> Any:
    """Execute one command through the shared AFD dispatch pipeline."""
    exec_context = with_context_defaults(context, config.context_defaults)
    scope = (
        config.context_scope(context, exec_context)
        if config.context_scope is not None
        else nullcontext()
    )
    with scope:
        return await _execute_command_inner(
            name,
            input,
            context,
            exec_context,
            config=config,
            output_budget=output_budget,
            skip_output_budget=skip_output_budget,
        )


async def _execute_command_inner(
    name: str,
    input: Any,
    context: Any,
    exec_context: Any,
    *,
    config: CommandExecutionConfig,
    output_budget: Any = None,
    skip_output_budget: bool = False,
) -> Any:
    from afd.core.commands import app_call_granted, call_not_granted

    if output_budget is not None:
        exec_context._output_budget_ask = normalize_ask_option(output_budget)
    skip_budget = skip_output_budget or bool(getattr(exec_context, "_skip_output_budget", False))
    # Consume the stream-only B7 marker before middleware or handlers see the
    # context so nested ordinary execute() calls still enforce their own B5 budget.
    if exec_context is not context and getattr(exec_context, "_skip_output_budget", False):
        with suppress(AttributeError, TypeError):
            exec_context._skip_output_budget = False

    raw_extra = getattr(exec_context, "extra", None)
    interface = raw_extra.get("interface") if isinstance(raw_extra, Mapping) else None
    active_context = (
        config.active_context_getter(exec_context)
        if config.active_context_getter is not None
        else _default_active_context(exec_context)
    )

    # 1. App-to-app calls: checked FIRST with one uniform refusal.
    if interface == "apps":
        apps_lookup = config.lookup_apps or config.lookup
        apps_cmd = apps_lookup(name)
        if (
            apps_cmd is not None
            and config.is_hidden is not None
            and config.is_hidden(apps_cmd, exec_context)
        ):
            apps_cmd = None
        if not app_call_granted(apps_cmd, name, exec_context, config.call_grant):
            return failure(call_not_granted())
        if config.before_request is not None:
            config.before_request()

    # 2. DirectClient allow predicate.
    if not _is_allowed(exec_context, name):
        return failure(_not_allowed(name))

    # 3. Lookup (with visibility filtering).
    command = config.lookup(name)
    if (
        command is not None
        and config.is_hidden is not None
        and config.is_hidden(command, exec_context)
    ):
        command = None

    if command is None:
        callable_names = [
            candidate.name
            for candidate in config.list_commands()
            if (
                not active_context or not candidate.contexts or active_context in candidate.contexts
            )
            and _is_allowed(exec_context, candidate.name)
            and (not interface or is_exposed_to(candidate, interface))
            and (config.is_shown is None or config.is_shown(candidate, exec_context))
        ]
        if config.not_found_builder is not None:
            return config.not_found_builder(name, callable_names)
        return error(
            "COMMAND_NOT_FOUND",
            f"Command '{truncate_name(name)}' not found",
            suggestion=not_found_suggestion(
                name, callable_names, suggest_tools=config.suggest_tools
            ),
        )

    # 4. Exposure check.
    if interface is not None and interface != "" and not is_exposed_to(command, interface):
        known = isinstance(interface, str) and interface in _VALID_INTERFACES
        return error(
            "COMMAND_NOT_EXPOSED",
            f"Command '{command.name}' is not exposed to {interface}",
            suggestion=(
                "Call it from an interface it is exposed to, or set "
                f"expose.{interface} to true in its definition"
                if known
                else "Use one of the interfaces " + ", ".join(sorted(_VALID_INTERFACES))
            ),
            retryable=False,
        )

    # 5. Active context check.
    if active_context and command.contexts and active_context not in command.contexts:
        if config.not_in_context_suggestion is not None:
            suggestion = config.not_in_context_suggestion
        else:
            contexts = ", ".join(f"'{c}'" for c in command.contexts)
            suggestion = (
                f"Switch to a context this command belongs to ({contexts}), "
                "or call it with no active context."
            )
        return error(
            "COMMAND_NOT_IN_CONTEXT",
            f"Command '{command.name}' is not available in context '{active_context}'",
            suggestion=suggestion,
        )

    # 6. Input validation.
    if config.validate_input is not None:
        valid, data_or_failure = await config.validate_input(command, input, exec_context)
    else:
        valid, data_or_failure = _default_validate_input(
            command,
            input,
            exec_context,
            dev_mode=config.dev_mode,
            logger=config.logger,
        )
    if not valid:
        return data_or_failure
    data = data_or_failure

    # 7. Post-validation hooks (M6 scope re-check, context fields).
    if config.post_validate is not None:
        post_failure = config.post_validate(command, data, exec_context)
        if post_failure is not None:
            return post_failure

    # 8. Output budget ask validation & effective budget resolution (B2-B4).
    effective_budget, invalid_budget = apply_output_budget(command, exec_context)
    if invalid_budget is not None:
        return invalid_budget
    if skip_budget:
        effective_budget = None

    # 9. Pre-execution cancellation check.
    caller_signal = getattr(exec_context, "signal", None)
    caller_cancel = getattr(exec_context, "cancel", None)

    def _is_aborted() -> bool:
        return (
            _is_context_cancelled(exec_context)
            or (caller_signal is not None and caller_signal.is_set())
            or (caller_cancel is not None and caller_cancel.is_set())
        )

    if _is_aborted():
        return _cancelled_before_start(name)

    # 10-11. Admission, middleware chain, handler, B5 budget, metadata stamp, deadline.
    effective_timeout = _resolve_timeout_ms(
        getattr(exec_context, "timeout", None), config.default_timeout_ms
    )
    scope = (
        config.admission_scope(exec_context, command)
        if config.admission_scope is not None
        else nullcontext(None)
    )
    # The declaration the journal reads: bound to each continuation built for this chain (so it
    # travels with the continuation, across a thread hop too, and a recorder given a `next` of
    # its own reads unknown), and closed when the dispatch ends.
    running = open_running_command(exec_context, command)
    with scope as admission_record:

        async def run_handler() -> Any:
            if _is_aborted():
                return _cancelled_before_start(name)
            if config.check_admission is not None:
                denied = config.check_admission(admission_record, command, data)
                if denied is not None:
                    return denied
            clock = getattr(exec_context, "clock", None) or system_clock
            start = clock.now()
            if config.invoke_handler is not None:
                result = await config.invoke_handler(command, data, exec_context)
            elif (
                config.validate_input is None
                and getattr(command.handler, "__afd_validate_input__", None) is not None
            ):
                validated_handler = getattr(
                    command.handler, "__afd_validated_handler__", command.handler
                )
                result = await validated_handler(data, exec_context)
            else:
                result = await command.handler(data, exec_context)
            if effective_budget is not None:
                normalized = coerce_budgeted_result(result)
                if normalized is not None:
                    result = check_output_budget(command, effective_budget, normalized)
            if config.stamp_metadata and isinstance(result, CommandResult):
                result = with_execution_metadata(
                    result,
                    execution_time_ms=max(0, clock.now() - start),
                    command_version=command.version,
                    trace_id=getattr(exec_context, "trace_id", None),
                    actor_kind=actor_kind_of(getattr(exec_context, "actor", None)),
                )
            return result

        def link(
            current_mw: Any, nxt: Callable[[], Awaitable[Any]]
        ) -> Callable[[], Awaitable[Any]]:
            async def call() -> Any:
                outcome = current_mw(name, data, exec_context, nxt)
                return await outcome if inspect.isawaitable(outcome) else outcome

            bind_continuation(call, running)
            return call

        bind_continuation(run_handler, running)
        next_fn: Callable[[], Awaitable[Any]] = run_handler
        for mw in reversed(config.middleware):
            next_fn = link(mw, next_fn)

        try:
            result = await _run_chain_with_deadline(
                name,
                exec_context,
                next_fn,
                effective_timeout,
                dev_mode=config.dev_mode,
                logger=config.logger,
            )
        finally:
            running.open = False

    if config.after_execute is not None:
        config.after_execute(name, result)
    return result
