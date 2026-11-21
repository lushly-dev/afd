"""Which calls an approval step admitted (internal; mirrors ``packages/server/src/approval-admission.ts``).

The server engine records each call's command (its name, declared approval policy and
confirmation prompt) before any middleware runs, under the call's own context object. The
approval middleware decides from that record and, when it lets the call through, records what it
decided on: the command name and the canonical JSON of the input. The engine dispatches a command
whose declared policy is neither unset nor ``"not-required"`` only when such an admission matches
the command and validated input it is about to run, and it takes the admission as it dispatches,
so one admission runs one handler (#1886, spec/command-metadata.md, "Approvals").

Every call gets a fresh context object (``with_context_defaults`` copies it), so a batch item, a
pipeline step or a command run from inside another command's handler has its own record and never
inherits an outer call's admission. The records live in this module, keyed by the context object's
identity for the length of the call: no field of a context, and nothing a caller passes, can set
one. This is not a boundary against code running in the same process.
"""

from __future__ import annotations

from contextlib import contextmanager
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
    """The canonical JSON of the input, or ``None`` when it has none (compared by identity)."""
    input: Any
    canonicalize: Canonicalize


@dataclass
class _Admission:
    context: Any
    command: AdmissionCommand
    admitted: Optional[_Admitted] = None
    taken: bool = False
    """Set once a dispatch took an admission, so a second dispatch reads as a mismatch."""


_RECORDS: dict[int, _Admission] = {}


def _record(context: Any) -> Optional[_Admission]:
    found = _RECORDS.get(id(context))
    # The identity check keeps a record from answering for another object that reuses the id.
    return found if found is not None and found.context is context else None


def gates(policy: Any) -> bool:
    """Whether a declared policy needs an approval step: anything but unset or ``"not-required"``."""
    return policy is not None and policy != "not-required"


@contextmanager
def admission_for(context: Any, command: Any) -> Iterator[None]:
    """Record, for the length of the call, the command the call of ``context`` runs, not yet
    admitted. A context that already has a record (the engine could not copy it) gets a fresh one,
    and the earlier one comes back when this call ends."""
    key = id(context)
    previous = _RECORDS.get(key)
    _RECORDS[key] = _Admission(
        context=context,
        command=AdmissionCommand(
            name=command.name,
            approval=getattr(command, "approval", None),
            confirm_prompt=getattr(command, "confirm_prompt", None),
        ),
    )
    try:
        yield
    finally:
        if previous is None:
            _RECORDS.pop(key, None)
        else:
            _RECORDS[key] = previous


def admit_approval(context: Any, command_name: str, input: Any, canonicalize: Canonicalize) -> None:
    """Record that an approval step admitted the call of ``context`` to run ``command_name`` on
    ``input``. The canonical form is computed only for a command that declares a gating policy.
    A no-op outside the engine."""
    found = _record(context)
    if found is None:
        return
    found.admitted = _Admitted(
        name=command_name,
        canonical=canonicalize(input) if gates(found.command.approval) else None,
        input=input,
        canonicalize=canonicalize,
    )


def take_admission(context: Any, command_name: str, input: Any) -> str:
    """Take the admission of the call of ``context``: ``"admitted"`` when it admitted
    ``command_name`` on ``input`` (the same name, and the same canonical input, or the same object
    when the input has no canonical form), ``"missing"`` with none, ``"mismatch"`` otherwise. Taken
    whatever the answer, so a second dispatch needs a second admission."""
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
    canonical = admitted.canonicalize(input)
    if admitted.canonical is None:
        same = admitted.input is input and canonical is None
    else:
        same = canonical == admitted.canonical
    return "admitted" if same else "mismatch"


def live_command(context: Any) -> Optional[AdmissionCommand]:
    """The command the call of ``context`` runs, as recorded by the engine; ``None`` outside it."""
    found = _record(context)
    return found.command if found is not None else None
