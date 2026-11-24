"""The pre-execution approval policy a command declares (#420, parity with #272).

``create_approval_middleware`` (``afd.server``) decides it per call. Without an
approval step that admitted the call, ``create_server`` and
``create_direct_registry`` refuse a command whose policy is not
``"not-required"`` with ``APPROVAL_UNAVAILABLE`` (#1886); core's
``create_command_registry`` runs no middleware and has no such check. This module
only holds the types and the reporting rule (``spec/command-metadata.md``,
"Approvals").
"""

from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from afd.core.commands import CommandContext

__all__ = ["ApprovalDecision", "ApprovalPolicy", "approval_mode"]

ApprovalDecision = Literal["not-required", "required"]
"""Whether one call needs a human's approval before its handler runs."""

ApprovalPolicy = (
    ApprovalDecision
    | Callable[[Any, "CommandContext"], ApprovalDecision | Awaitable[ApprovalDecision]]
)
"""A command's approval policy: a fixed decision, or a function (sync or async) of the
validated input and the call context, for example "agents need approval, humans do not".
Unset means ``"not-required"``. ``create_approval_middleware`` decides it; ``create_server`` and
``create_direct_registry`` refuse any other declared policy with ``APPROVAL_UNAVAILABLE`` when no
approval step admitted the call. Core's ``create_command_registry`` does not check it."""


def approval_mode(
    policy: ApprovalPolicy | None,
) -> Literal["not-required", "required", "conditional"] | None:
    """How a policy is reported in ``_meta.approval``, ``afd-detail`` and ``afd-docs``.

    A function cannot be serialized, so it is reported as ``"conditional"``.
    ``None`` when no policy (or an unknown value) is declared.
    """
    if callable(policy):
        return "conditional"
    if policy == "required" or policy == "not-required":
        return policy
    return None
