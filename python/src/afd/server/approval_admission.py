"""Which calls an approval step admitted (internal; mirrors ``packages/server/src/approval-admission.ts``).

The server engine records each dispatch's command (its name, declared approval policy and
confirmation prompt) before any middleware runs. The approval middleware decides from that record
and, when it lets the call through, records what it decided on: the command name and the canonical
JSON of the input it verified. The engine dispatches a command whose declared policy is neither
unset nor ``"not-required"``, or whose call the middleware held under a policy given only in its
``commands`` list, only when such an admission matches the command and validated input it is
about to run. It takes the admission as it dispatches, so one admission runs one handler (#1886,
spec/command-metadata.md, "Approvals").

Every dispatch has its own record, which nothing else can reach: the records of the dispatches
under way in a task are a ``ContextVar`` value that each dispatch extends for its own length and
restores when it ends. Two overlapping calls run in separate tasks, so they never see each other's
record, even when they were given the same context object, and a call nested in a handler gets a
record of its own. A record is found by the identity of the context object the engine passes
through the middleware chain; no field of a context, and nothing a caller passes, can set one.
This is not a boundary against code running in the same process.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Callable, Iterator, Optional

Canonicalize = Callable[[Any], Optional[str]]
"""The canonical JSON of a value, or ``None`` when it has none."""


@dataclass(frozen=True)
class AdmissionCommand:
    """The command a call runs, as its admission record keeps it."""

    name: str
    approval: Any = None
    confirm_prompt: Optional[str] = None


@dataclass(frozen=True)
class _Admitted:
    name: str
    canonical: Optional[str]
    """The canonical JSON of the input the approval step decided on; ``None`` when it has none,
    which no gated dispatch accepts."""
    canonicalize: Canonicalize


class _Admission:
    __slots__ = ("context", "command", "admitted", "taken", "required")

    def __init__(self, context: Any, command: AdmissionCommand) -> None:
        self.context = context
        self.command = command
        self.admitted: Optional[_Admitted] = None
        self.taken = False
        """Set once a dispatch took an admission, so a second dispatch reads as a mismatch."""
        self.required = False
        """Set when the approval step required approval for this call (a policy given only in its
        ``commands`` list among them), so the dispatch checks the admission whatever the
        command declares."""


_RECORDS: ContextVar[tuple[_Admission, ...]] = ContextVar("afd_approval_admissions", default=())


def _record(context: Any) -> Optional[_Admission]:
    """The innermost record of this task's dispatches that runs on ``context``."""
    for found in reversed(_RECORDS.get()):
        if found.context is context:
            return found
    return None


def gates(policy: Any) -> bool:
    """Whether a declared policy needs an approval step: anything but unset or ``"not-required"``."""
    return policy is not None and policy != "not-required"


@contextmanager
def admission_for(context: Any, command: Any) -> Iterator[None]:
    """Give this dispatch of ``command`` on ``context`` its own record, not yet admitted, for the
    length of the ``with`` block; only this dispatch's record is removed when it ends."""
    record = _Admission(
        context,
        AdmissionCommand(
            name=command.name,
            approval=getattr(command, "approval", None),
            confirm_prompt=getattr(command, "confirm_prompt", None),
        ),
    )
    token = _RECORDS.set((*_RECORDS.get(), record))
    try:
        yield
    finally:
        _RECORDS.reset(token)


def admit_approval(
    context: Any,
    command_name: str,
    canonical: Optional[str],
    canonicalize: Canonicalize,
    *,
    required: bool,
) -> None:
    """Record that an approval step admitted the call of ``context`` to run ``command_name`` on
    the input whose canonical JSON is ``canonical`` (the one it verified). ``required`` says the
    step required approval for this call. A no-op outside the engine."""
    found = _record(context)
    if found is None:
        return
    if required:
        found.required = True
    found.admitted = _Admitted(name=command_name, canonical=canonical, canonicalize=canonicalize)


def admission_required(context: Any, policy: Any) -> bool:
    """Whether a dispatch on ``context`` needs an admission: the command declares a gating
    ``policy``, or the approval step required approval for this call."""
    if gates(policy):
        return True
    found = _record(context)
    return found is not None and found.required


def take_admission(context: Any, command_name: str, input: Any) -> str:
    """Take the admission of the call of ``context``: ``"admitted"`` when it admitted
    ``command_name`` on an input with the same canonical JSON as ``input``, ``"missing"`` with
    none, ``"not-canonical"`` when the input has no canonical form (no approval can be bound to
    it), ``"mismatch"`` otherwise (another command or a changed input). Taken whatever the answer,
    so a second dispatch needs a second admission."""
    found = _record(context)
    if found is None:
        return "missing"
    admitted = found.admitted
    if admitted is None:
        return "mismatch" if found.taken else "missing"
    found.admitted = None
    found.taken = True
    if admitted.name != command_name:
        return "mismatch"
    current = admitted.canonicalize(input)
    if current is None or admitted.canonical is None:
        return "not-canonical"
    return "admitted" if current == admitted.canonical else "mismatch"


def live_command(context: Any) -> Optional[AdmissionCommand]:
    """The command the call of ``context`` runs, as recorded by the engine; ``None`` outside it."""
    found = _record(context)
    return found.command if found is not None else None
