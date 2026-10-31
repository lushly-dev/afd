"""Internal per-call approval exchange. This is a trusted host seam, not a sandbox."""

from dataclasses import dataclass
from typing import Any, Optional


@dataclass(frozen=True)
class DirectApprovalRequest:
    """Token-free decision metadata passed only to the configured host hook."""

    command: str
    input: Any
    summary: str
    expires_at: str
    reason: Optional[str] = None


class _DirectApprovalExchange:
    def __init__(self) -> None:
        self._active = True
        self._hold: Optional[dict[str, Any]] = None
        self._evidence: Optional[str] = None

    def pending(self) -> Optional[dict[str, Any]]:
        if self._hold is None:
            return None
        return {key: value for key, value in self._hold.items() if key != "approval_token"}

    def approve(self) -> bool:
        if self._active and self._hold is not None:
            self._evidence = self._hold["approval_token"]
            self._hold = None
            return True
        return False

    def take(self) -> Optional[str]:
        evidence, self._evidence = self._evidence, None
        return evidence if self._active else None

    def hold(self, **hold: Any) -> None:
        if self._active:
            self._hold = hold

    def dispose(self) -> None:
        self._active = False
        self._hold = None
        self._evidence = None


def _exchange(context: Any) -> Optional[_DirectApprovalExchange]:
    value = getattr(context, "_direct_approval", None)
    # A disposed marker still suppresses public tokens after a late timeout.
    return value if isinstance(value, _DirectApprovalExchange) else None


def _public_context(context: Any) -> Any:
    from afd.core.commands import CommandContext

    return CommandContext(**{
        key: getattr(context, key, None) for key in
        ("trace_id", "timeout", "actor", "clock", "random")
    }, extra=dict(getattr(context, "extra", {})))


def _public_result(result: Any, command: str) -> Any:
    from afd.core.result import coerce_command_result

    result = coerce_command_result(result, command)
    if (not result.success and result.error is not None
            and result.error.code == "APPROVAL_REQUIRED" and result.error.details
            and "approvalToken" in result.error.details):
        details = {k: v for k, v in result.error.details.items() if k != "approvalToken"}
        return result.model_copy(update={"error": result.error.model_copy(update={"details": details})})
    return result
