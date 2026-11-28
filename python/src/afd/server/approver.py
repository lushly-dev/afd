"""Approval evidence from an approver client (``spec/approvals.md``, "Approval evidence from an
approver client"; Loam phase 5, step 0c).

A server names its approvers with the ``approver`` option of :func:`~afd.server.create_server`:
MCP clients it trusts to show a person a held action and to carry the person's decision back. For
an approver, a held result carries ``details.approvalToken`` and never becomes a form elicitation,
and a ``tools/call`` carrying ``_meta["dev.afd/approval"]`` has it set as the call's approval
evidence; the token binds the approver's principal binding (M8). From any other caller the key is
ignored. In tool arguments the key is refused from every caller.

Mirrors ``packages/server/src/approver.ts``. State is kept off-object in a weakref table so
``context_hook``, ``repr``, ``vars`` and serialization never observe or forge it.
"""

from __future__ import annotations

import copy
import logging
import threading
import weakref
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Literal

from afd.core.actor import Actor
from afd.core.commands import CommandContext
from afd.core.errors import CommandError, ErrorCodes
from afd.server.auth import credentials_actor
from afd.server.context_hook import HookOutcome, copy_extra
from afd.server.principal import (
    IncompleteCredentials,
    PrincipalCredentials,
    principal_binding,
    sdk_credentials,
)
from afd.server.session_context import is_modern_protocol

logger = logging.getLogger("afd.server")

__all__ = [
    "AFD_APPROVAL_META_KEY",
    "ApproverPredicate",
]

AFD_APPROVAL_META_KEY = "dev.afd/approval"
"""``_meta`` key an approver sets to the approval token of the call it retries."""

ApproverPredicate = Callable[[CommandContext], bool]
"""Whether the caller of one MCP ``tools/call`` is an approver, from its context once the server
has set the verified credentials and the host its actor. Only an explicit ``True`` makes one.
Read only what the server verified: ``context.credentials``, or an actor ``context_hook`` mapped
from them."""


@dataclass
class ApproverCall:
    """An approver's call, as bound to its context. Its tokens bind the principal binding of the
    context the approval middleware sees (``spec/authorization.md``, M8)."""

    evidence: Any = field(default=None, repr=False)

    def __repr__(self) -> str:
        return "ApproverCall([redacted])"


@dataclass(frozen=True)
class ApproverDecision:
    """What the carrier decided for one ``tools/call``."""

    kind: Literal["proceed", "refuse"]
    approver: ApproverCall | None = None
    error: CommandError | None = None


# Reentrant lock so CPython cyclic GC invoking weakref cleanup on the same thread never deadlocks.
_LOCK = threading.RLock()
_RECORDS: dict[int, tuple[weakref.ref[Any], ApproverCall]] = {}

_CURRENT_APPROVER_CALL: ContextVar[ApproverCall | None] = ContextVar(
    "afd_approver_call", default=None
)


def _put_locked(context: Any, call: ApproverCall) -> None:
    key = id(context)

    def _cleanup(dead_ref: weakref.ref[Any]) -> None:
        with _LOCK:
            current = _RECORDS.get(key)
            if current is not None and current[0] is dead_ref:
                _RECORDS.pop(key, None)

    _RECORDS[key] = (weakref.ref(context, _cleanup), call)


def _get_locked(context: Any) -> ApproverCall | None:
    entry = _RECORDS.get(id(context))
    if entry is None or entry[0]() is not context:
        return None
    return entry[1]


def _pop_locked(context: Any) -> None:
    key = id(context)
    entry = _RECORDS.get(key)
    if entry is not None and entry[0]() is context:
        _RECORDS.pop(key, None)


def bind_approver(context: CommandContext, call: ApproverCall) -> CommandContext:
    """Attach ``call`` off-object to ``context`` and return ``context``."""
    with _LOCK:
        _put_locked(context, call)
    return context


def approver_call_of(context: Any) -> ApproverCall | None:
    """The approver's call bound to ``context``, if its caller is an approver."""
    if context is None:
        return None
    with _LOCK:
        return _get_locked(context)


def inherit_approver_call(source: Any, target: Any) -> None:
    """Copy an approver call reference from ``source`` (router context) onto ``target``
    (the engine's per-call context). Both share the same :class:`ApproverCall` so
    :func:`take_approver_evidence` consumes the carried evidence once across the call."""
    if source is None or target is None or source is target:
        return
    with _LOCK:
        call = _get_locked(source)
        if call is not None:
            _put_locked(target, call)


def clear_approver_call(context: Any) -> None:
    """Drop the off-object approver call entry for ``context`` when a dispatch finishes."""
    if context is None:
        return
    with _LOCK:
        _pop_locked(context)


@contextmanager
def bind_approver_call(call: ApproverCall | None) -> Iterator[None]:
    """Bind ``call`` for the duration of one MCP ``tools/call``."""
    token = _CURRENT_APPROVER_CALL.set(call)
    try:
        yield
    finally:
        _CURRENT_APPROVER_CALL.reset(token)


def current_approver_call() -> ApproverCall | None:
    """The approver call bound for the MCP ``tools/call`` being served, or ``None``."""
    return _CURRENT_APPROVER_CALL.get()


def take_approver_evidence(call: ApproverCall) -> Any:
    """Take the carried evidence once: the first approval check of the call takes it, so a
    command the handler runs in process never sees it."""
    with _LOCK:
        evidence = call.evidence
        call.evidence = None
        return evidence


def approval_key_in_input(input: Any) -> CommandError | None:
    """The ``VALIDATION_ERROR`` for tool arguments that hold the key ``dev.afd/approval`` at any
    depth, or ``None``. Evidence is never input (rule 5), from any caller. The walk is iterative,
    so deep input cannot overflow the stack."""
    pending: list[Any] = [input]
    seen: set[int] = set()
    while pending:
        value = pending.pop()
        if isinstance(value, (str, bytes, bytearray)) or value is None:
            continue
        if isinstance(value, Mapping):
            marker = id(value)
            if marker in seen:
                continue
            seen.add(marker)
            if AFD_APPROVAL_META_KEY in value:
                return CommandError(
                    code=ErrorCodes.VALIDATION_ERROR,
                    message=f'Input may not hold the key "{AFD_APPROVAL_META_KEY}"',
                    suggestion=(
                        f'Remove "{AFD_APPROVAL_META_KEY}" from the input: approval evidence is '
                        "never input. Only a client the server names an approver sends it, in "
                        "_meta, on the retry a person approved."
                    ),
                    retryable=False,
                )
            for item in value.values():
                pending.append(item)
        elif isinstance(value, (list, tuple)):
            marker = id(value)
            if marker in seen:
                continue
            seen.add(marker)
            for item in value:
                pending.append(item)
    return None


def decide_approver(
    *,
    approver: ApproverPredicate | None,
    context: CommandContext,
    actor: Actor | None,
    credentials: PrincipalCredentials | Any | None,
    meta: Any,
    tool: str,
    modern: bool,
) -> ApproverDecision:
    """Decide the carrier of one ``tools/call`` (rules 1 to 3).

    A non-approver's key is ignored. An approver's key on ``afd-batch``, ``afd-pipe`` or a
    2025-era request refuses the call before anything runs.

    Raises:
        Exception: Whatever ``approver`` raises, and :class:`IncompleteCredentials` /
            :class:`TypeError` for an approver whose credentials cannot be bound (M8): the server
            answers both as an internal JSON-RPC error.
    """
    if approver is None or approver(context) is not True:
        return ApproverDecision(kind="proceed")
    # Credentials that cannot be bound make no approver: raises IncompleteCredentials (M8).
    principal_binding(actor, credentials)
    evidence = meta.get(AFD_APPROVAL_META_KEY) if isinstance(meta, Mapping) else None
    carried = evidence is not None
    if carried and (not modern or tool in ("afd-batch", "afd-pipe")):
        return ApproverDecision(
            kind="refuse",
            error=CommandError(
                code=ErrorCodes.APPROVAL_REQUIRED,
                message=(
                    f'_meta["{AFD_APPROVAL_META_KEY}"] is accepted only on a call to one command '
                    "from an MCP 2026-07-28 client"
                ),
                suggestion=(
                    "Retry the approved command on its own (its tool or afd-call) from an MCP "
                    "2026-07-28 client, with the same input and the token; nothing ran."
                ),
                retryable=False,
            ),
        )
    return ApproverDecision(
        kind="proceed",
        approver=ApproverCall(evidence=evidence) if carried else ApproverCall(),
    )


def resolve_request_principal(server: Any, outcome: HookOutcome | None) -> str:
    """The principal binding of the MCP request being served (M8)."""
    admitted = server._current_admitted_credentials()
    if outcome is not None and outcome.actor_at_start is not None:
        actor = outcome.actor_at_start
    elif admitted is not None:
        actor = credentials_actor(admitted)
    else:
        actor = server.config.actor or Actor(kind="agent")
    creds = admitted if server._auth_layer is not None else sdk_credentials()
    return principal_binding(actor, creds)


def resolve_mcp_approver(
    server: Any,
    tool_name: Any,
    outcome: HookOutcome | None,
    field_values: Mapping[str, Any],
    raw_meta: Any,
    context: Any,
    current_request: Any,
) -> ApproverDecision:
    """Build the post-hook context and evaluate ``approver`` for an MCP ``tools/call``."""
    approver = server.config.approver
    if approver is None:
        return ApproverDecision(kind="proceed")
    from mcp import MCPError
    from mcp_types import INTERNAL_ERROR

    tool_str = tool_name if isinstance(tool_name, str) else ""
    admitted = server._current_admitted_credentials()
    hook_ctx = outcome.context if outcome is not None else None
    if outcome is not None and outcome.actor_at_start is not None:
        actor = copy.copy(outcome.actor_at_start)
    elif admitted is not None:
        actor = credentials_actor(admitted)
    else:
        actor = copy.copy(server.config.actor or Actor(kind="agent"))
    sdk_incomplete = False
    if server._auth_layer is not None:
        creds: Any = admitted
    else:
        try:
            creds = sdk_credentials()
        except IncompleteCredentials:
            creds = None
            sdk_incomplete = True
    pred_extra: dict[str, Any] = {
        **field_values,
        **(copy_extra(hook_ctx.extra) if hook_ctx and hook_ctx.extra else {}),
        "interface": "mcp",
        "remote": True,
    }
    pred_ctx = CommandContext(
        trace_id=hook_ctx.trace_id if hook_ctx is not None else None,
        timeout=hook_ctx.timeout if hook_ctx is not None else None,
        extra=pred_extra,
        actor=copy.copy(actor),
        clock=hook_ctx.clock if hook_ctx is not None else server.config.clock,
        random=hook_ctx.random if hook_ctx is not None else server.config.random,
        credentials=creds,
    )
    protocol_version = getattr(context, "protocol_version", None) or getattr(
        current_request, "protocol_version", None
    )
    try:
        return decide_approver(
            approver=approver,
            context=pred_ctx,
            actor=actor,
            credentials=object() if sdk_incomplete else creds,
            meta=raw_meta,
            tool=tool_str,
            modern=is_modern_protocol(protocol_version),
        )
    except IncompleteCredentials:
        logger.warning("refusing approver call on tools/call: incomplete credentials")
        raise MCPError(code=INTERNAL_ERROR, message="Internal error") from None
    except Exception as exc:
        logger.error("approver predicate failed on tools/call", exc_info=exc)
        raise MCPError(code=INTERNAL_ERROR, message="Internal error") from None
