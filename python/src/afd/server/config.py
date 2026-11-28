"""Server configuration, default discovery instructions, and shared app-call refusal helper."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from afd.core.actor import Actor
from afd.core.batch import (
    DEFAULT_MAX_BATCH_PARALLELISM,
    DEFAULT_MAX_BATCH_SIZE,
    create_failed_batch_result,
)
from afd.core.clock import Clock, RandomSource
from afd.core.commands import CallGrant, CommandContext, call_not_granted
from afd.core.pipeline import create_pipeline_failure
from afd.core.result import failure
from afd.server.approver import ApproverPredicate
from afd.server.auth import McpAuthOptions
from afd.server.bootstrap.afd_context import AFD_CONTEXT_META_KEY
from afd.server.context_fields import ContextField
from afd.server.context_hook import ContextHook
from afd.server.human_relay import HumanRelay
from afd.server.idempotency_step import IdempotencyOptions
from afd.server.instance_state import ServerInstances
from afd.server.middleware import CommandMiddleware
from afd.server.resources import ResourcesOption
from afd.server.skills import SkillCatalog
from afd.server.tasks import TaskOptions, TaskStore
from afd.server.types import ContextConfig, GroupByFn, ToolStrategy
from afd.server.validation import DEFAULT_MAX_VALIDATION_ISSUES

DEFAULT_COMMAND_TIMEOUT_MS = 30_000
"""Normative server-level default per-command deadline in milliseconds (``spec/execution-controls.md``)."""

DEFAULT_TOOLS_LIST_TTL_MS = 300_000
"""Default ``ttlMs`` of MCP 2026-07-28 ``tools/list`` and ``server/discover`` results."""


def _resolve_default_timeout_ms(value: int | float | None) -> int | float | None:
    """Validate and normalize ``default_timeout_ms`` (``None`` or ``0`` disables)."""
    if value is None or (
        isinstance(value, (int, float)) and not isinstance(value, bool) and value == 0
    ):
        return None
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value < 0
    ):
        raise ValueError("default_timeout_ms must be a positive finite number, 0, or None")
    return value


def refuse_apps_tool_call(tool_name: str, caller_context: CommandContext | None) -> Any | None:
    """Return the fixed ``CALL_NOT_GRANTED`` envelope when ``caller_context`` targets ``apps``."""
    if (
        caller_context is None
        or not caller_context.extra
        or caller_context.extra.get("interface") != "apps"
    ):
        return None
    refusal = call_not_granted()
    if tool_name == "afd-batch":
        return create_failed_batch_result(refusal)
    if tool_name == "afd-pipe":
        return create_pipeline_failure(refusal)
    return failure(refusal)


@runtime_checkable
class MCPTransport(Protocol):
    """Protocol for MCP transport implementations."""

    async def start(self) -> None: ...

    async def stop(self) -> None: ...


@dataclass
class ServerConfig:
    """Configuration for an AFD server."""

    name: str
    version: str = "1.0.0"
    description: str | None = None
    transport: str | None = "fastmcp"
    middleware: list[CommandMiddleware] = field(default_factory=list)
    tool_strategy: ToolStrategy = "grouped"
    contexts: list[ContextConfig] = field(default_factory=list)
    group_by: GroupByFn | None = None
    dev_mode: bool = False
    default_timeout_ms: int | float | None = DEFAULT_COMMAND_TIMEOUT_MS
    """Server-level default per-command deadline in milliseconds (``0`` or ``None`` disables)."""
    max_batch_size: int = DEFAULT_MAX_BATCH_SIZE
    max_batch_parallelism: int = DEFAULT_MAX_BATCH_PARALLELISM
    max_validation_issues: int = DEFAULT_MAX_VALIDATION_ISSUES
    """Maximum validation issues reported per ``VALIDATION_ERROR`` (default 100)."""
    instructions: str | None = None
    tools_list_ttl_ms: int | None = None
    clock: Clock | None = None
    random: RandomSource | None = None
    actor: Actor | None = None
    context_hook: ContextHook | None = None
    """Per-request hook (``afd.server.context_hook``) invoked once per MCP ``tools/call`` before
    the request-state boundary, confirmation gate and command lookup."""
    confirmations: str = "off"
    confirmation_key: bytes | bytearray | memoryview | str | None = None
    first_class_tools: list[str] | None = None
    """``tool_strategy="hybrid"`` only: the commands listed as tools after the meta-tools, in
    order (1 to 8 names). Checked against the registered commands before the first request."""
    advertise_output_schema: bool = True
    """Advertise the CommandResult envelope as a command tool's top-level ``outputSchema``
    (``spec/command-metadata.md``, "Structured results"). ``_meta.outputSchema`` stays either way."""
    context_fields: list[ContextField] = field(default_factory=list)
    """Request values the host declares (``spec/context-fields.md``), checked at construction.
    MCP ``tools/call`` reads them from ``params._meta``; ``server/discover`` and ``afd-help``
    list them."""
    bootstrap: bool = False
    """Register ``afd-help``, ``afd-docs`` and ``afd-schema``, as TypeScript's ``bootstrap: true``
    does (parity decision D5). Off by default; the context tools do not depend on it."""
    task_store: TaskStore | None = None
    """Pluggable :class:`~afd.server.tasks.TaskStore` for MCP Tasks (default: bounded in-memory)."""
    task_options: TaskOptions | None = None
    """MCP Tasks runtime options (TTL, polling interval, concurrency and caller identification)."""
    auth: McpAuthOptions | None = None
    """OAuth 2.1 protected-resource authorization on HTTP (``spec/authorization.md``, M1–M7)."""
    resources: ResourcesOption | None = None
    """Opt-in MCP resource provider or static entries (``spec/mcp-resources.md``, R1–R6)."""
    skills: SkillCatalog | None = None
    """Opt-in Agent Skills catalog served through ``io.modelcontextprotocol/skills`` (S1–S6)."""
    call_grant: CallGrant | None = None
    """Host grant predicate ``(command_name, context) -> bool`` for app-to-app calls
    (``context.extra["interface"] == "apps"``; ``spec/command-metadata.md``, "App-to-app calls").
    When omitted, every ``apps`` call is refused with ``CALL_NOT_GRANTED``."""
    instances: ServerInstances | None = None
    """How many processes serve this server's URL: ``"single"`` or ``"multiple"``.

    Appended after existing fields so positional ``ServerConfig(...)`` callers stay compatible.
    With ``"multiple"``, server creation raises ``ValueError`` when confirmations or
    ``relay="mcp-elicitation"`` lacks a shared ``confirmation_key``, or when a single-use
    approval middleware lacks a shared ``nonce_store``. When omitted, serving over HTTP logs
    one warning per process to stderr if a per-process default is in use; ``"single"``
    silences that warning. Stdio logs nothing."""
    human_relay: HumanRelay | None = None
    """Host-verified confirmation relay (``spec/command-metadata.md``, "Host-verified confirmation")."""
    approver: ApproverPredicate | None = None
    """Which MCP callers are approvers (``spec/approvals.md``, "Approval evidence from an
    approver client"): clients the server trusts to show a person a held call and carry their
    decision back in ``_meta["dev.afd/approval"]``. Only an explicit ``True`` makes one."""
    idempotency: IdempotencyOptions | None = None
    """The engine's idempotency step (``spec/idempotency.md``, S1 to S13): answers a repeat of a
    call to an ``idempotency="keyed"`` command that carries the same key from its store."""


def default_instructions(
    name: str, tool_strategy: str, contexts: list[ContextConfig], bootstrap: bool = False
) -> str:
    """The ``server/discover`` instructions: how an agent should use this server's tools."""
    lines = [
        f"{name} is an AFD server. Every tool returns a CommandResult as JSON text: "
        "{ success, data, error: { code, message, suggestion, recovery } }; follow "
        "error.suggestion to recover. When error.recovery is present, it is the same step in a "
        "form a program can follow."
    ]
    if tool_strategy == "lazy":
        lines.append(
            "Call afd-discover to find commands, afd-detail for a command schema, and "
            "afd-call to run one."
        )
    elif tool_strategy == "grouped":
        lines.append(
            "Each tool groups related commands: pass { action, params }. afd-detail returns "
            "a command schema; afd-call runs any command by name."
        )
    elif tool_strategy == "hybrid":
        lines.append(
            "The command tools listed are the common ones. Call afd-discover to find others, "
            "afd-detail for a schema, and afd-call to run one."
        )
    else:
        lines.append("Each command is its own tool; afd-call also runs any command by name.")
    lines.append("Use afd-batch for several independent commands and afd-pipe to chain them.")
    if bootstrap:
        lines.append("afd-help, afd-docs and afd-schema describe this server.")
    if contexts:
        lines.append(
            "Commands are scoped by context (afd-context-list lists them). Send "
            f'_meta["{AFD_CONTEXT_META_KEY}"] with a context name on tools/list and '
            "tools/call to work in that context."
        )
    return " ".join(lines)
