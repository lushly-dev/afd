"""Scope-based access control for memory operations."""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from typing import Literal

# Module-level context variable for the current caller agent name.
# Set by the runtime before command invocation.
current_agent: ContextVar[str] = ContextVar("current_agent", default="")


@dataclass
class AccessDenied:
    """Access denial details — converted to an error() call by commands."""

    code: str
    message: str
    suggestion: str


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
                f"Agent '{caller_agent}' cannot {operation} agent-scoped memory"
                f" for '{scope_id}'"
            ),
            suggestion="Use your own agent name as scope_id, or use team/task scope",
        )

    # team and task scopes: open access in Phase 1
    return None


def resolve_scope_id(scope: str, scope_id: str | None) -> str:
    """Default scope_id to the current agent name when scope is 'agent'."""
    if scope_id:
        return scope_id
    if scope == "agent":
        agent = current_agent.get()
        return agent if agent else "default"
    return "default"
