"""Internal per-call approval exchange. This is a trusted host seam, not a sandbox."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class DirectApprovalRequest:
    """Token-free decision metadata passed only to the configured host hook."""

    command: str
    input: Any
    summary: str
    expires_at: str
    approval_id: str = field(kw_only=True)
    """Keyword-only. The ``approval_id`` the call's approval summary will carry once the user approves
    (``spec/command-metadata.md``, "The approval summary", rule 5)."""
    reason: str | None = None


class _DirectApprovalExchange:
    def __init__(self) -> None:
        self._active = True
        self._hold: dict[str, Any] | None = None
        self._evidence: str | None = None

    def pending(self) -> dict[str, Any] | None:
        if self._hold is None:
            return None
        return {key: value for key, value in self._hold.items() if key != "approval_token"}

    def approve(self) -> bool:
        if self._active and self._hold is not None:
            self._evidence = self._hold["approval_token"]
            self._hold = None
            return True
        return False

    def take(self) -> str | None:
        evidence, self._evidence = self._evidence, None
        return evidence if self._active else None

    def hold(self, **hold: Any) -> None:
        if self._active:
            self._hold = hold

    def dispose(self) -> None:
        self._active = False
        self._hold = None
        self._evidence = None


def _exchange(context: Any) -> _DirectApprovalExchange | None:
    value = getattr(context, "_direct_approval", None)
    # A disposed marker still suppresses public tokens after a late timeout.
    return value if isinstance(value, _DirectApprovalExchange) else None


def _public_context(context: Any) -> Any:
    from afd.core.commands import CommandContext

    raw_extra = getattr(context, "extra", None)
    return CommandContext(
        trace_id=getattr(context, "trace_id", None),
        timeout=getattr(context, "timeout", None),
        actor=getattr(context, "actor", None),
        clock=getattr(context, "clock", None),
        random=getattr(context, "random", None),
        cancel=getattr(context, "cancel", None),
        signal=getattr(context, "signal", None),
        extra=dict(raw_extra) if isinstance(raw_extra, Mapping) else {},
        _direct_allow=getattr(context, "_direct_allow", None),
        _output_budget_ask=getattr(context, "_output_budget_ask", None),
        _skip_output_budget=bool(getattr(context, "_skip_output_budget", False)),
        _server_signal=getattr(context, "_server_signal", None),
        _server_signal_fields=tuple(getattr(context, "_server_signal_fields", ()) or ()),
        # The call's idempotency key and the engine's marks on it (spec/idempotency.md, K1 to K6).
        idempotency_key=getattr(context, "idempotency_key", None),
        _idempotency_key_engine=getattr(context, "_idempotency_key_engine", None),
        _idempotency_key_delivered=getattr(context, "_idempotency_key_delivered", None),
    )


def _public_result(result: Any, command: str) -> Any:
    from afd.core.result import coerce_command_result

    result = coerce_command_result(result, command)
    if (
        not result.success
        and result.error is not None
        and result.error.code == "APPROVAL_REQUIRED"
        and result.error.details
        and "approvalToken" in result.error.details
    ):
        details = {k: v for k, v in result.error.details.items() if k != "approvalToken"}
        return result.model_copy(
            update={"error": result.error.model_copy(update={"details": details})}
        )
    return result
