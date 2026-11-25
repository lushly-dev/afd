"""Which calls an approval step admitted (internal; mirrors ``packages/server/src/approval-admission.ts``).

The server engine records each dispatch's command (its name, declared approval policy and
confirmation prompt) before any middleware runs. The approval middleware decides from that record
and, when it lets through a call one of its own policies may gate, records what it decided on: the
command name and the canonical JSON of the input it decided on, or, for a call whose policy let it
through on an input with no canonical form, that very input object. A call no policy of its own
gates is not admitted, so an admission from another approval step stands alone. Each approval
step's admission is kept. The engine dispatches a command whose declared policy is neither unset
nor ``"not-required"``, or one an approval step admitted under a gating policy given only in its
``commands`` list, only when every admission matches the command and validated input it is about
to run. It takes them all as it dispatches, so one admission runs one handler (#1886,
spec/command-metadata.md, "Approvals").

Every dispatch has its own record, which nothing else can reach. The middleware finds it by the
identity of the context object the engine passes down the chain: first among the dispatches under
way in its task (a ``ContextVar`` value that each dispatch extends for its own length and restores
when it ends), so two overlapping calls never see each other's record even when they were given
the same context object; else, for a middleware that moved the rest of the chain to a thread
without copying the context variables, among every dispatch under way on that object, when there
is exactly one. The engine holds its own record and needs no lookup. No field of a context, and
nothing a caller passes, can set a record. This is not a boundary against code running in the same
process.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

Canonicalize = Callable[[Any], str | None]
"""The canonical JSON of a value, or ``None`` when it has none."""


@dataclass(frozen=True)
class AdmissionCommand:
    """The command a call runs, as its admission record keeps it."""

    name: str
    approval: Any = None
    confirm_prompt: str | None = None
    confirmation_mode: str | None = None


@dataclass(frozen=True)
class _Admitted:
    step: object
    """The approval step (one middleware instance) that admitted it."""
    name: str
    canonical: str | None
    """The canonical JSON of the input the approval step decided on; ``None`` when it has none, and
    then the dispatch must run that same input object."""
    input: Any
    canonicalize: Canonicalize


class Admission:
    """One dispatch's record. Only the engine and the approval middleware touch it."""

    __slots__ = ("context", "command", "admitted", "steps", "taken", "required")

    def __init__(self, context: Any, command: AdmissionCommand) -> None:
        self.context = context
        self.command = command
        self.admitted: list[_Admitted] = []
        """What each approval step admitted since the last dispatch. Two approval middlewares on
        one engine each admit, and the dispatch must match them all, so a later one never replaces
        or weakens an earlier one's binding."""
        self.steps: list[object] = []
        """Every approval step that ever admitted this call. A dispatch needs a fresh admission
        from each, so a retry that reruns only the steps after one of them is refused."""
        self.taken = False
        """Set once a dispatch took an admission, so a second dispatch reads as a mismatch."""
        self.required = False
        """Set when an approval step admitted this call under a gating policy given only in its
        ``commands`` list (or after an approval), so the dispatch checks the admission whatever
        the command declares. Never cleared: a later dispatch on the same record is checked
        too."""


_RECORDS: ContextVar[tuple[Admission, ...]] = ContextVar("afd_approval_admissions", default=())
# Every dispatch under way, by the identity of its context object, for a lookup from a thread that
# did not copy the context variables. Guarded by _LOCK: the middleware may run in another thread.
_LIVE: dict[int, list[Admission]] = {}
_LOCK = threading.Lock()


def _record(context: Any) -> Admission | None:
    """The record of the dispatch that runs on ``context``: the innermost of this task's, else the
    only one under way on that object anywhere."""
    for found in reversed(_RECORDS.get()):
        if found.context is context:
            return found
    with _LOCK:
        live = [found for found in _LIVE.get(id(context), ()) if found.context is context]
    return live[0] if len(live) == 1 else None


def gates(policy: Any) -> bool:
    """Whether a declared policy needs an approval step: anything but unset or ``"not-required"``."""
    return policy is not None and policy != "not-required"


@contextmanager
def admission_for(context: Any, command: Any) -> Iterator[Admission]:
    """Give this dispatch of ``command`` on ``context`` its own record, not yet admitted, for the
    length of the ``with`` block; only this dispatch's record is removed when it ends."""
    record = Admission(
        context,
        AdmissionCommand(
            name=command.name,
            approval=getattr(command, "approval", None),
            confirm_prompt=getattr(command, "confirm_prompt", None),
            confirmation_mode=getattr(command, "confirmation_mode", None),
        ),
    )
    key = id(context)
    with _LOCK:
        _LIVE.setdefault(key, []).append(record)
    token = _RECORDS.set((*_RECORDS.get(), record))
    try:
        yield record
    finally:
        _RECORDS.reset(token)
        with _LOCK:
            live = _LIVE.get(key, [])
            live[:] = [found for found in live if found is not record]
            if not live:
                _LIVE.pop(key, None)


def admit_approval(
    step: object,
    context: Any,
    command_name: str,
    canonical: str | None,
    input: Any,
    canonicalize: Canonicalize,
    *,
    required: bool,
) -> None:
    """Record that the approval step ``step`` (one middleware instance) admitted the call of ``context`` to run ``command_name`` on
    the input whose canonical JSON is ``canonical`` (the one it verified), or on ``input`` itself
    when that is ``None``. ``required`` says the step required approval for this call. A no-op
    outside the engine."""
    found = _record(context)
    if found is None:
        return
    if required:
        found.required = True
    if not any(known is step for known in found.steps):
        found.steps.append(step)
    found.admitted.append(
        _Admitted(
            step=step,
            name=command_name,
            canonical=canonical,
            input=input,
            canonicalize=canonicalize,
        )
    )


def mark_listed_gate(context: Any) -> None:
    """Record that the policy an approval step's ``commands`` list gives the command the call of
    ``context`` runs gates it, whatever name the step was called with, so a call renamed on its
    way to the step is still checked at dispatch. A no-op outside the engine."""
    found = _record(context)
    if found is not None:
        found.required = True


def admission_required(record: Admission, policy: Any) -> bool:
    """Whether this dispatch needs an admission: the command declares a gating ``policy``, or the
    approval step required approval for this call."""
    return gates(policy) or record.required


def take_admission(record: Admission, command_name: str, input: Any) -> str:
    """Take this dispatch's admissions: ``"admitted"`` when every approval step that ever admitted
    it admitted it again since the last dispatch, each on ``command_name`` and an input with the
    same canonical JSON as ``input`` (the same object, still with none, for an input with none; a
    change inside it is not seen), ``"missing"`` with none, ``"mismatch"`` otherwise. Taken
    whatever the answer and never restored, so a second dispatch needs a second admission from
    each."""
    admitted = record.admitted
    if not admitted:
        return "mismatch" if record.taken else "missing"
    record.admitted = []
    record.taken = True
    if any(not any(fresh.step is step for fresh in admitted) for step in record.steps):
        return "mismatch"

    def same(step: _Admitted) -> bool:
        if step.name != command_name:
            return False
        canonical = step.canonicalize(input)
        if step.canonical is None:
            return step.input is input and canonical is None
        return canonical == step.canonical

    return "admitted" if all(same(step) for step in admitted) else "mismatch"


def live_command(context: Any) -> AdmissionCommand | None:
    """The command the call of ``context`` runs, as recorded by the engine; ``None`` outside it."""
    found = _record(context)
    return found.command if found is not None else None
