"""The pre-execution approval policy a command declares (#420, parity with #272).

``create_approval_middleware`` (``afd.server``) enforces it; this module only
holds the types and the reporting rule (``spec/command-metadata.md``,
"Approvals").
"""

from typing import TYPE_CHECKING, Any, Awaitable, Callable, Literal, Optional, Union

if TYPE_CHECKING:
    from afd.core.commands import CommandContext

__all__ = ["ApprovalDecision", "ApprovalPolicy", "approval_mode"]

ApprovalDecision = Literal["not-required", "required"]
"""Whether one call needs a human's approval before its handler runs."""

ApprovalPolicy = Union[
    ApprovalDecision,
    Callable[[Any, "CommandContext"], Union[ApprovalDecision, Awaitable[ApprovalDecision]]],
]
"""A command's approval policy: a fixed decision, or a function (sync or async) of the
validated input and the call context, for example "agents need approval, humans do not".
Unset means ``"not-required"``. Enforced only where ``create_approval_middleware`` runs."""


def approval_mode(
    policy: Optional[ApprovalPolicy],
) -> Optional[Literal["not-required", "required", "conditional"]]:
    """How a policy is reported in ``_meta.approval``, ``afd-detail`` and ``afd-docs``.

    A function cannot be serialized, so it is reported as ``"conditional"``.
    ``None`` when no policy (or an unknown value) is declared.
    """
    if callable(policy):
        return "conditional"
    if policy == "required" or policy == "not-required":
        return policy
    return None
