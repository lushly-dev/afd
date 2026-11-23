"""Who a memory call is made as, and the scope rules that key on it.

A call reaches memory one of two ways:

- **Through a Botcore host** (``botcore.host.CommandHost.execute``, behind its CLI, MCP and
  HTTP surfaces and the LLM tool bridge). The host's per-call context carries the actor the
  surface verified, and that actor is the caller: :func:`principal_id` turns its kind and id
  into the caller's agent-scope id. A host call whose actor has no id names no one, so it is
  refused (``MEMORY_PRINCIPAL_UNKNOWN``) instead of falling back to a shared identity: a host
  may serve several callers.
- **Directly, in the caller's own process** (the ``botcore`` CLI, the legacy stdio MCP
  server's ``run`` tool, an embedding script). This is one local user, so the caller is the
  name an embedder sets in :data:`current_agent`, else :data:`DEFAULT_PRINCIPAL`.
"""

from __future__ import annotations

import hashlib
import re
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Literal

from .models import MAX_SCOPE_ID_LENGTH

# The caller's name for a direct, in-process call: a trusted embedder sets it before invoking
# a command. A host call ignores it; there the host's verified actor is the caller.
current_agent: ContextVar[str] = ContextVar("current_agent", default="")

#: The caller of a direct, local call that names no one: the single local user.
DEFAULT_PRINCIPAL = "default"

_KIND = re.compile(r"[a-z]+")
#: Ids kept readable: lowercase only, so no two principals differ only by case and share a
#: file on a case-insensitive disk.
_READABLE_ID = re.compile(r"[a-z0-9][a-z0-9_-]*")
#: A managed host call on a Botcore too old to say who is calling (no ``current_call``).
_UNNAMED_MANAGED_CALL = object()


@dataclass
class AccessDenied:
    """Access denial details — converted to an error() call by commands."""

    code: str
    message: str
    suggestion: str


def principal_id(actor: Any) -> str | None:
    """The agent-scope id of a host caller, or ``None`` when the actor names no one.

    An id made only of lowercase letters, digits, ``_`` and ``-`` is kept readable as
    ``<kind>_<id>`` (an agent ``researcher`` is ``agent_researcher``). Any other id (``Alex``,
    ``lane@random``, an email address, a long subject) becomes ``<kind>-<digest>``, the first
    32 hex digits of its SHA-256. Every principal is therefore lowercase, valid as a scope id
    and distinct per id, even on a case-insensitive disk where ``Alex`` and ``alex`` would
    otherwise name one file. Kinds are lowercase words, so the two forms never meet, and the
    same id under two kinds (a human and an agent both called ``alex``) stays two principals.
    """
    kind = getattr(actor, "kind", None)
    ident = getattr(actor, "id", None)
    if not isinstance(kind, str) or not _KIND.fullmatch(kind):
        return None
    if not isinstance(ident, str) or not ident:
        return None
    readable = f"{kind}_{ident}"
    if _READABLE_ID.fullmatch(ident) and len(readable) <= MAX_SCOPE_ID_LENGTH:
        return readable
    return f"{kind}-{hashlib.sha256(ident.encode('utf-8')).hexdigest()[:32]}"


def _host_call() -> Any:
    """The Botcore host call in progress, or ``None`` for a direct call."""
    try:
        from botcore.context import current_call
    except ImportError:
        # A Botcore without per-call contexts cannot name the caller. A managed host call
        # there still sets an execution context: refuse it rather than treat it as local.
        try:
            from botcore.context import current_context
        except ImportError:
            return None
        return _UNNAMED_MANAGED_CALL if current_context() is not None else None
    return current_call()


def resolve_caller() -> str | AccessDenied:
    """The caller's principal for this call, or the refusal when a host call names no one."""
    call = _host_call()
    if call is None:
        return current_agent.get() or DEFAULT_PRINCIPAL
    if call is _UNNAMED_MANAGED_CALL:
        return AccessDenied(
            code="MEMORY_PRINCIPAL_UNKNOWN",
            message="This Botcore's hosts do not say who is calling, so memory has no caller",
            suggestion="Install lushly-botcore 0.8.0 or later, whose hosts name each caller",
        )
    actor = getattr(call, "actor", None)
    principal = principal_id(actor)
    if principal is None:
        kind = getattr(actor, "kind", None)
        named = f"a {kind} with no id" if kind else "no one"
        return AccessDenied(
            code="MEMORY_PRINCIPAL_UNKNOWN",
            message=(
                f"This memory call came through a host whose caller is {named}, so there is "
                "no principal to read or write memory as"
            ),
            suggestion=(
                "Call through a surface that verifies who you are (a host token names you), "
                "or give the host an actor with an id: CommandHost(..., actor=Actor(kind=..., "
                "id=...))"
            ),
        )
    return principal


def check_scope_access(
    caller_agent: str,
    scope: str,
    scope_id: str,
    operation: Literal["read", "write"],
) -> AccessDenied | None:
    """Return AccessDenied if access is denied, None if OK.

    Rules (Phase 1):
    - scope="agent": scope_id must match caller_agent (read + write)
    - scope="team": all agents can read and write (full ACL deferred to Phase 2)
    - scope="task": all agents can read and write (task binding deferred to Phase 2)
    """
    if scope == "agent" and scope_id != caller_agent:
        return AccessDenied(
            code="MEMORY_ACCESS_DENIED",
            message=(
                f"Agent '{caller_agent}' cannot {operation} agent-scoped memory for '{scope_id}'"
            ),
            suggestion=(
                f"Leave scope_id out (or pass '{caller_agent}') to use your own agent memory, "
                "or use team/task scope"
            ),
        )

    # team and task scopes: open access in Phase 1
    return None


def resolve_scope_id(scope: str, scope_id: str | None, caller: str | None = None) -> str:
    """Default scope_id to the caller when scope is 'agent'.

    ``caller`` is the principal :func:`resolve_caller` returned; without it, the direct-call
    caller (:data:`current_agent`, else :data:`DEFAULT_PRINCIPAL`).
    """
    if scope_id:
        return scope_id
    if scope == "agent":
        return caller or current_agent.get() or DEFAULT_PRINCIPAL
    return DEFAULT_PRINCIPAL
