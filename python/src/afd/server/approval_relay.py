"""The MCP approval relay (#1312; TypeScript's ``approval-relay.ts`` and ``approval-up-front.ts``).

How the approval middleware, built with ``relay="mcp-elicitation"``, asks the human behind an MCP
client through a form elicitation instead of returning a token to the agent
(``spec/command-metadata.md``, "Asking the human over MCP").

The MCP lane binds an :class:`ApprovalRelay` for each ``tools/call`` that can carry a form
elicitation, in a context variable (as the confirmation channel is), so neither tool arguments nor
``CommandContext`` can forge one. The tool router names the one command the call routes to; only
that command, and only once, can claim the relay. It reads the human's answer from the relay or
records a hold on it, and the lane then asks instead of returning the held result.

``afd-batch`` and ``afd-pipe`` replace the relay with one that never asks, because asking mid-run
would run the earlier steps again on the retry. Instead (#459), the router binds an
:class:`UpFrontApproval` for the whole call: before any step's handler runs, the approval
middleware works out every gated step's input and asks once for all of them, or refuses the call
when a gated pipeline step's input comes from an earlier step.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
from collections.abc import Awaitable, Callable, Iterator, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field, replace
from typing import Any, Literal, Protocol

from afd.core.commands import CommandContext
from afd.core.errors import ErrorCodes, Recovery
from afd.core.pipeline import PipelineContext, resolve_variables
from afd.core.pipeline_variables import parse_reference
from afd.core.result import CommandError, CommandResult, failure

APPROVAL_INPUT_KEY = "approval"
"""The ``inputRequests`` key of the approval elicitation."""

APPROVAL_REQUESTED_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "approve": {
            "type": "boolean",
            "title": "Approve",
            "description": "Allow this action to run",
        },
    },
    "required": ["approve"],
}
"""The approval elicitation form: one required boolean."""

MAX_UP_FRONT_APPROVALS = 20
"""The most gated steps one question lists; a person cannot weigh more at once."""

_MAX_SHOWN_INPUT = 1000
"""Longest input shown in an approval question, in UTF-16 code units as TypeScript counts them."""

# Deeper inputs are rejected by the pipeline before any step runs.
_MAX_DEPTH = 64


@dataclass(frozen=True)
class ApprovedStep:
    """The step of an ``afd-batch`` or ``afd-pipe`` an up-front approval was asked for, kept with
    the question in the sealed ``requestState`` (#1414). The attempt that brings the answer runs
    the step on this input instead of validating what was sent again, so a schema whose defaults
    differ from one validation to the next (a random id, the time) still runs exactly what the
    human approved."""

    index: int
    """The step's position in the request, 0-based."""
    input: str
    """The canonical JSON of the step's validated input, as the human was shown it."""
    call: str
    """A digest of the whole request as sent: the input serves that request and no other."""


@dataclass(frozen=True)
class ApprovalQuestion:
    """One approval asked of the human: a command, its validated input and the actor."""

    binding: str
    """Keyed digest of the command, its validated input and the actor, under the signing key."""
    bindings: tuple[str, ...]
    """The same digest under every verification key: earlier answers to any of them are dropped."""
    nonce: str
    """Random nonce, spent when the approved call runs."""
    expires_at: int
    """Expiry of the approval, epoch milliseconds on the middleware's clock."""
    mac: str
    """MAC of the binding, nonce and expiry under the approval secret."""
    step: ApprovedStep | None = None
    """For an up-front approval, the step asked about (left out when its input is too long to
    keep)."""


@dataclass(frozen=True)
class StepsHold:
    """A call held for the human's approval: one command's question, or one per gated step of an
    ``afd-batch`` or ``afd-pipe``, all answered by the same form."""

    questions: tuple[ApprovalQuestion, ...]
    message: str
    """The question shown to the human."""


@dataclass(frozen=True)
class AcceptedApproval:
    """An accepted approval as the request carries it: its binding, nonce, expiry and MAC."""

    binding: str
    nonce: str
    expires_at: int
    mac: str
    step: ApprovedStep | None = None
    """The step the approval was asked for, when the question kept it."""


@dataclass(frozen=True)
class ApprovalAnswer:
    """The human's answer to an earlier approval elicitation for one binding."""

    kind: Literal["accept", "decline", "missing"]
    accepted: AcceptedApproval | None = None


@dataclass(frozen=True)
class ApprovalAnswers:
    """Every approval answer a request carries: those accepted, and the bindings declined."""

    accepted: tuple[AcceptedApproval, ...] = ()
    declined: tuple[str, ...] = ()


MISSING = ApprovalAnswer("missing")

MAX_KEPT_INPUT = 32_768
"""The most characters (code points) of approved input one question keeps in the ``requestState``, over all
its steps. A step past it is validated again by the attempt that brings the answer, as every step
was before #1414."""


class ApprovalRelay(Protocol):
    """What one MCP ``tools/call`` offers the approval middleware."""

    def route(self, command: str) -> None:
        """Name the command this tool call routes to; only that command can claim the relay."""

    def claim(self, command: str) -> bool:
        """Take the relay for ``command``: only the routed command, and only once, so a command
        run by another command's handler (or a later step) cannot turn the call into an
        elicitation."""

    async def answer(self, bindings: Sequence[str]) -> ApprovalAnswer:
        """The answer this request carries for any of ``bindings`` (one per verification key).
        The latest answer wins."""

    def hold(self, hold: StepsHold) -> None:
        """Record that the call needs the human's approval; the lane asks once the call returns."""

    async def answers(self) -> ApprovalAnswers:
        """Every approval answer this request carries, for an up-front approval of several steps."""


class _NeverAsks:
    """The relay of the steps of ``afd-batch`` and ``afd-pipe``: it never asks for one step."""

    def route(self, command: str) -> None:
        pass

    def claim(self, command: str) -> bool:
        return False

    async def answer(self, bindings: Sequence[str]) -> ApprovalAnswer:
        return MISSING

    def hold(self, hold: StepsHold) -> None:
        pass

    async def answers(self) -> ApprovalAnswers:
        return ApprovalAnswers()


NEVER_ASKS: ApprovalRelay = _NeverAsks()

_RELAY: ContextVar[ApprovalRelay | None] = ContextVar("afd_approval_relay", default=None)
_UP_FRONT: ContextVar[UpFrontApproval | None] = ContextVar("afd_up_front_approval", default=None)


@contextmanager
def bind_approval_relay(
    relay: ApprovalRelay | None, up_front: UpFrontApproval | None = None
) -> Iterator[None]:
    """Bind ``relay`` (and, for the steps of an ``afd-batch`` or ``afd-pipe``, ``up_front``) for
    the calls routed inside the block."""
    relay_token = _RELAY.set(relay)
    up_front_token = _UP_FRONT.set(up_front)
    try:
        yield
    finally:
        _UP_FRONT.reset(up_front_token)
        _RELAY.reset(relay_token)


def current_approval_relay() -> ApprovalRelay | None:
    return _RELAY.get()


def current_up_front_approval() -> UpFrontApproval | None:
    return _UP_FRONT.get()


def shown_input(text: str) -> str:
    """``text``, cut to 1000 UTF-16 code units (as TypeScript counts them) with an ellipsis."""
    units = 0
    for at, char in enumerate(text):
        units += 2 if ord(char) > 0xFFFF else 1
        if units > _MAX_SHOWN_INPUT:
            return text[:at] + "…"
    return text


def relay_message(summary: str, command: str, input: str, note: str | None = None) -> str:
    """The question of a relayed approval: the summary, then what exactly would run."""
    lines = [note] if note else []
    lines += [summary, "", f"Command: {command}", f"Input: {shown_input(input)}"]
    return "\n".join(lines)


# ── Up-front approval of afd-batch and afd-pipe (#459) ─────────────────────────────────────


@dataclass(frozen=True)
class UpFrontStep:
    """One step of an ``afd-batch`` or ``afd-pipe``, as the up-front approval sees it."""

    index: int
    """The step's position in the request, 0-based as in its results."""
    command: str
    dynamic: bool
    """Whether the step's input comes from an earlier step (``$prev``, ``$first`` or ``$steps``),
    so it is not known until the pipeline runs."""
    valid: bool = False
    """Whether :attr:`input` holds the validated input."""
    input: Any = None
    sent: str | None = None
    """The input as sent (after ``$input`` references are resolved), as canonical JSON: how the
    server finds the step it is about to run. ``None`` unless :attr:`valid`."""
    kept: bool = False
    """Whether :attr:`input` is the one an earlier round of the same request kept with its
    question (#1414), rather than one validated afresh by this attempt."""


StepValidator = Callable[[str, Any], tuple[bool, Any]]
"""Validates one step's input as the call will: ``(valid, validated input)``. A command the
caller cannot run is not valid."""

CanRun = Callable[[str], bool]
"""Whether the caller can run a command: it exists, is exposed to them and is in context."""


class UpFrontDeps(Protocol):
    """What the up-front gate needs from the approval middleware: its keys, nonce store and
    policies."""

    def now(self) -> float: ...

    async def requires_approval(self, command: str, input: Any, context: CommandContext) -> bool:
        """Whether ``command``'s policy holds this input."""

    def may_require_approval(self, command: str, context: CommandContext) -> bool:
        """Whether ``command``'s policy could hold some input (``"required"`` or a function)."""

    def binding_input(self, input: Any) -> str:
        """The canonical JSON a validated input is bound by."""

    def actor_binding(self, context: CommandContext) -> str: ...

    def bindings(self, tags: Sequence[str], command: str, input: str, actor: str) -> list[str]:
        """The bindings of one step, one per key, the signing key's first."""

    def call_tags(self, call: str) -> list[str]:
        """The call's tag under each key: a keyed digest of the whole request as sent."""

    def genuine(self, answer: AcceptedApproval, bindings: Sequence[str], now: float) -> bool:
        """Whether an accepted approval's MAC verifies for ``bindings`` and it has not expired."""

    def spend(self, nonce: str, expires_at: float, now: float) -> Awaitable[bool]:
        """Spend a single-use nonce; ``True`` when it was fresh (or reuse is allowed)."""

    def question(self, bindings: Sequence[str], now: float) -> ApprovalQuestion:
        """A fresh question (nonce, expiry and MAC) for ``bindings``."""

    def summarize(self, command: str, input: Any, context: CommandContext) -> str: ...


@dataclass
class _Approved:
    binding: str
    used: bool = False


@dataclass(frozen=True)
class _Plan:
    kind: Literal["run", "refuse"]
    approved: list[_Approved] = field(default_factory=list)
    error: CommandError | None = None


@dataclass(frozen=True)
class _GatedStep:
    index: int
    command: str
    input: str
    """The canonical JSON of its validated input."""
    summary: str
    bindings: list[str]
    kept: bool = False
    """Whether its input is the one an earlier round kept with its question."""


class UpFrontApproval:
    """The up-front approval of one ``afd-batch`` or ``afd-pipe`` call that can carry a form
    elicitation. The approval middleware decides it once, before any step's handler runs: every
    step runs, each gated step on its own single-use approval, or none does."""

    def __init__(
        self,
        relay: ApprovalRelay,
        tool: Literal["afd-batch", "afd-pipe"],
        request: Any,
        can_run: CanRun,
        validate: StepValidator,
        lookup: Callable[[str], Any] | None = None,
    ) -> None:
        self.relay = relay
        self._lookup = lookup
        self.tool = tool
        self._request = request
        self._can_run = can_run
        self._validate = validate
        self.call = _request_json(tool, request)
        """The whole request as sent, as canonical JSON: every approval is bound to it."""
        steps = request.get("steps") if isinstance(request, dict) else None
        self.conditional = isinstance(steps, list) and any(
            isinstance(step, dict) and step.get("when") is not None for step in steps
        )
        self.refusal: CommandError | None = None
        """Set when nothing may run (a gated step whose input is not known up front, a
        decline, or a pending question): the router answers with it instead of the run."""
        self._steps: list[UpFrontStep] | None = None
        # Positions in ``_steps`` whose validated input the server already took.
        self._taken: set[int] = set()
        # One plan per approval middleware, shared by the call's steps (concurrent ones too).
        self._plans: dict[int, asyncio.Future[_Plan]] = {}
        self._tags: dict[int, list[str]] = {}

    def command(self, command: str) -> Any:
        """The server's definition of ``command`` (its approval policy and prompt), so the
        middleware decides every step from the command that step runs; ``None`` when unknown."""
        return self._lookup(command) if self._lookup is not None else None

    async def steps(self) -> list[UpFrontStep]:
        """The call's steps, worked out once. A step the human already approved in an earlier
        round of this request has the input approved then; any other is validated now."""
        if self._steps is None:
            approved = await self._approved_inputs()
            # Nothing awaits between the check and the assignment, so concurrent steps share one.
            if self._steps is None:
                self._steps = (
                    _pipeline_steps(self._request, self._can_run, self._validate, approved)
                    if self.tool == "afd-pipe"
                    else _batch_steps(self._request, self._validate, approved)
                )
        return self._steps

    async def _approved_inputs(self) -> dict[int, str]:
        """The inputs the human approved for this request's steps in an earlier round; the
        latest answer wins. None when the answers cannot be read: the middleware reports that."""
        try:
            answers = await self.relay.answers()
        except Exception:
            return {}
        call = _call_digest(self.call)
        return {
            answer.step.index: answer.step.input
            for answer in answers.accepted
            if answer.step is not None and answer.step.call == call
        }

    async def validated(self, command: str, input: Any) -> tuple[Any] | None:
        """The input validated up front for a step that runs ``command`` on ``input`` as sent,
        in a 1-tuple, handed out once per step so two steps sent alike take one each (#1414). The
        server runs the step on it instead of on a second validation's result: the input that
        runs is the one the human was shown. ``None`` for a step that is not known up front or
        did not validate; it runs on its own validation, as usual."""
        sent = _sent_key(input)
        if sent is None:
            return None
        try:
            steps = await self.steps()
        except Exception:
            # The step runs on its own validation, and the middleware reports what failed.
            return None
        # No await between finding a step and taking it, so concurrent steps take one each.
        for at, step in enumerate(steps):
            if (
                step.valid
                and step.command == command
                and step.sent == sent
                and at not in self._taken
            ):
                self._taken.add(at)
                return (step.input,)
        return None

    def _call_tags(self, deps: UpFrontDeps) -> list[str]:
        tags = self._tags.get(id(deps))
        if tags is None:
            tags = self._tags[id(deps)] = deps.call_tags(self.call)
        return tags

    async def run(
        self,
        deps: UpFrontDeps,
        command: str,
        input: Any,
        context: CommandContext,
        next_fn: Callable[..., Awaitable[CommandResult[Any]]],
    ) -> CommandResult[Any]:
        """Run one step through the up-front gate: nothing runs until the plan is to run, and
        then a gated step runs only on an unused approval of its own binding."""
        plan = self._plans.get(id(deps))
        if plan is None:
            plan = self._plans[id(deps)] = asyncio.ensure_future(self._decide(deps, context))
        # Shielded: a step cancelled while its siblings wait must not cancel their shared plan.
        decided = await asyncio.shield(plan)
        if decided.kind == "refuse":
            assert decided.error is not None
            if self.refusal is None:
                self.refusal = decided.error
            return failure(decided.error)
        if not await deps.requires_approval(command, input, context):
            return await _released(next_fn)
        try:
            verified = deps.binding_input(input)
        except _UNBINDABLE:
            return failure(not_canonical_error(command))
        bindings = deps.bindings(
            self._call_tags(deps), command, verified, deps.actor_binding(context)
        )
        # No await between finding and taking it, so concurrent steps cannot take the same one.
        # Its expiry was checked when the call started, as a single command's is.
        approval = next(
            (item for item in decided.approved if not item.used and item.binding in bindings), None
        )
        if approval is not None:
            approval.used = True
            # The step runs on the input its approval binds.
            return await _released(lambda: next_fn(verified))
        return failure(_unplanned_error(self.tool, command))

    async def _decide(self, deps: UpFrontDeps, context: CommandContext) -> _Plan:
        steps = await self.steps()
        late = next(
            (
                step
                for step in steps
                if step.dynamic and deps.may_require_approval(step.command, context)
            ),
            None,
        )
        if late is not None:
            return _Plan("refuse", error=_split_error(self.tool, late.index, late.command))
        scope = self._call_tags(deps)

        now = deps.now()
        actor = deps.actor_binding(context)
        gated: list[_GatedStep] = []
        for step in steps:
            if step.dynamic or not step.valid:
                continue
            # Before the policy runs, so a policy that changes the input is caught.
            before = (
                _binding_or_none(deps, step.input)
                if deps.may_require_approval(step.command, context)
                else None
            )
            if not await deps.requires_approval(step.command, step.input, context):
                continue
            try:
                input = deps.binding_input(step.input)
            except _UNBINDABLE:
                return _Plan("refuse", error=not_canonical_error(step.command))
            if input != before:
                return _Plan("refuse", error=input_changed_error(step.command))
            gated.append(
                _GatedStep(
                    index=step.index,
                    command=step.command,
                    input=input,
                    summary=deps.summarize(step.command, step.input, context),
                    bindings=deps.bindings(scope, step.command, input, actor),
                    kept=step.kept,
                )
            )
            if len(gated) > MAX_UP_FRONT_APPROVALS:
                return _Plan("refuse", error=_too_many_error(self.tool))
        if not gated:
            return _Plan("run")

        answers = await self.relay.answers()
        if any(binding in answers.declined for step in gated for binding in step.bindings):
            return _Plan("refuse", error=_declined_error(self.tool, gated))

        # Each gated step takes a distinct genuine acceptance of its own binding, so two
        # identical steps need two. The latest answer wins: later answers are read last.
        pool = list(answers.accepted)
        matched: list[AcceptedApproval] = []
        unmatched: int | None = None
        for at_step, gated_step in enumerate(gated):
            found = next(
                (
                    at
                    for at in range(len(pool) - 1, -1, -1)
                    if pool[at].binding in gated_step.bindings
                    and deps.genuine(pool[at], gated_step.bindings, now)
                ),
                None,
            )
            if found is None:
                unmatched = at_step
                break
            matched.append(pool.pop(found))
        if len(matched) == len(gated):
            # Spend every nonce before anything runs: a replay of this request runs nothing.
            fresh = True
            for answer in matched:
                if not await deps.spend(answer.nonce, answer.expires_at, now):
                    fresh = False
            if fresh:
                return _Plan("run", approved=[_Approved(answer.binding) for answer in matched])

        # Ask once for every gated step, saying why when earlier approvals did not hold.
        # Each question keeps its step's input, so the attempt that brings the answer runs it.
        call = _call_digest(self.call)
        room = MAX_KEPT_INPUT
        kept: list[ApprovalQuestion] = []
        keeps: list[bool] = []
        for gated_step in gated:
            question = deps.question(gated_step.bindings, now)
            room -= len(gated_step.input)
            keeps.append(room >= 0)
            if room >= 0:
                question = replace(
                    question, step=ApprovedStep(gated_step.index, gated_step.input, call)
                )
            kept.append(question)
        # A step that brought approvals but no kept input, whose input no longer has any of their
        # bindings (it validated to another input: a random default), and that cannot be kept
        # this time either, would be asked about again on every retry. Refuse it instead. An
        # approval of its own binding that merely expired is asked again, as before.
        if (
            unmatched is not None
            and answers.accepted
            and not any(answer.binding in gated[unmatched].bindings for answer in answers.accepted)
            and not gated[unmatched].kept
            and not keeps[unmatched]
        ):
            stuck = gated[unmatched]
            return _Plan("refuse", error=_not_kept_error(self.tool, stuck.index, stuck.command))
        questions = tuple(kept)
        self.relay.hold(
            StepsHold(
                questions=questions,
                message=_steps_message(
                    self.tool,
                    self.conditional,
                    gated,
                    "The earlier approval expired, was already used or no longer matches; "
                    "approve again to run it."
                    if answers.accepted
                    else None,
                ),
            )
        )
        return _Plan("refuse", error=_pending_error(self.tool, gated))


async def _released(next_fn: Callable[[], Awaitable[CommandResult[Any]]]) -> CommandResult[Any]:
    """Run a step's handler without the up-front approval, so a command it runs never takes a
    step's approval (it is held as any command inside another is)."""
    token = _UP_FRONT.set(None)
    try:
        return await next_fn()
    finally:
        _UP_FRONT.reset(token)


def _request_json(tool: str, request: Any) -> str:
    """The request an up-front approval is bound to, as canonical JSON (the wire sends JSON)."""
    from afd.server.approval import _canonical_json

    try:
        return _canonical_json([tool, request])
    except TypeError:
        return json.dumps([tool, request], sort_keys=True, separators=(",", ":"), default=repr)


def reads_step_data(value: Any, depth: int = 0) -> bool:
    """Whether ``value`` holds a reference to an earlier step's data (``$prev``, ``$first``,
    ``$steps``), by the grammar of ``spec/pipeline-variables.md``."""
    if isinstance(value, str):
        reference = parse_reference(value)
        return reference is not None and reference.root != "input"
    if isinstance(value, (dict, list)):
        # Deeper containers are rejected by the pipeline before any step runs.
        if depth >= _MAX_DEPTH:
            return True
        items = value.values() if isinstance(value, dict) else value
        return any(reads_step_data(item, depth + 1) for item in items)
    return False


def _call_digest(call: str) -> str:
    """A digest of the request as sent: an approved input serves the request it was validated
    for."""
    return base64.urlsafe_b64encode(hashlib.sha256(call.encode()).digest()).rstrip(b"=").decode()


def _sent_key(input: Any) -> str | None:
    """What a step's input was before validation, as canonical JSON (no input is ``{}``, as
    validation reads it). ``None`` for an input canonical JSON cannot spell, which matches no
    step."""
    from afd.server.approval import _canonical_json

    try:
        return _canonical_json({} if input is None else input)
    except (TypeError, ValueError, RecursionError):
        return None


def _restored(validate: StepValidator, command: str, approved: str) -> tuple[Any] | None:
    """The input approved earlier, as the schema reads it back, in a 1-tuple: the same value (so
    what runs is what was approved), as the type the handler takes. ``None`` when the schema does
    not read it back unchanged; the step is then validated as sent."""
    from afd.server.approval import _canonical_json, _plain_input

    try:
        valid, data = validate(command, json.loads(approved))
        if valid and _canonical_json(_plain_input(data)) == approved:
            return (data,)
    except Exception:
        pass
    return None


def _validated(
    validate: StepValidator, index: int, command: str, input: Any, approved: str | None = None
) -> UpFrontStep:
    kept = None if approved is None else _restored(validate, command, approved)
    if kept is not None:
        return UpFrontStep(
            index,
            command,
            dynamic=False,
            valid=True,
            input=kept[0],
            sent=_sent_key(input),
            kept=True,
        )
    try:
        valid, data = validate(command, input)
    except Exception:
        # The step fails validation when it runs too.
        return UpFrontStep(index, command, dynamic=False)
    if not valid:
        return UpFrontStep(index, command, dynamic=False)
    return UpFrontStep(index, command, dynamic=False, valid=True, input=data, sent=_sent_key(input))


def _batch_steps(
    request: Any, validate: StepValidator, approved: dict[int, str] | None = None
) -> list[UpFrontStep]:
    """The steps of an ``afd-batch``: every item's input is known up front."""
    items = request.get("commands") if isinstance(request, dict) else None
    if not isinstance(items, list):
        return []
    approved = approved or {}
    return [
        _validated(validate, index, item["command"], item.get("input", {}), approved.get(index))
        for index, item in enumerate(items)
        if isinstance(item, dict) and isinstance(item.get("command"), str)
    ]


def _pipeline_steps(
    request: Any,
    can_run: CanRun,
    validate: StepValidator,
    approved: dict[int, str] | None = None,
) -> list[UpFrontStep]:
    """The steps of an ``afd-pipe``: a step whose input reads an earlier step's data is not known
    up front; any other has its ``$input`` references resolved, as the pipeline will."""
    items = request.get("steps") if isinstance(request, dict) else None
    if not isinstance(items, list):
        return []
    pipeline_input = request.get("input")
    context = PipelineContext(
        pipeline_input=pipeline_input if isinstance(pipeline_input, dict) else None
    )
    steps: list[UpFrontStep] = []
    for index, item in enumerate(items):
        if not isinstance(item, dict) or not isinstance(item.get("command"), str):
            continue
        command = item["command"]
        raw = item.get("input")
        # A command the caller cannot run is not one: it fails as a missing name, telling nothing.
        if not can_run(command):
            steps.append(UpFrontStep(index, command, dynamic=False))
            continue
        if reads_step_data(raw):
            steps.append(UpFrontStep(index, command, dynamic=True))
            continue
        try:
            resolved = resolve_variables(raw, context) if raw else {}
        except Exception:
            steps.append(UpFrontStep(index, command, dynamic=False))
            continue
        steps.append(_validated(validate, index, command, resolved, (approved or {}).get(index)))
    return steps


def _what(tool: str) -> str:
    return "batch" if tool == "afd-batch" else "pipeline"


def not_canonical_error(command: str) -> CommandError:
    """A call that needs approval on an input with no canonical form: no approval can be bound to
    it, so nobody is asked and nothing runs."""
    return CommandError(
        code=ErrorCodes.APPROVAL_UNAVAILABLE,
        message=f"{command} needs a person's approval, and this input cannot be bound to one",
        suggestion=(
            "Do not retry with this input: it has no exact canonical form, so an approval cannot "
            "be bound to it. Send the input in a form canonical JSON accepts (for example, an "
            "integer a JavaScript number cannot hold exactly, such as 2^53 + 1, as a string)."
        ),
        retryable=False,
        # No recovery: the caller reshapes the input itself (spec/recovery.md, "Engine errors").
        details={"reason": "input-not-canonical"},
    )


def input_changed_error(command: str) -> CommandError:
    """A call whose input changed while the approval step was deciding on it (inside a policy
    function or a store it awaited), so what a person would be shown is not what a token would
    bind."""
    return CommandError(
        code=ErrorCodes.APPROVAL_UNAVAILABLE,
        message=f"{command}'s input changed while its approval was being decided",
        suggestion=(
            "Do not retry: this call is not the one the approval step decided on. The operator "
            "fixes the policy function or middleware that changes the input."
        ),
        retryable=False,
        details={"reason": "admission-mismatch"},
        recovery=Recovery(kind="external"),
    )


_UNBINDABLE = (TypeError, ValueError, RecursionError)
"""What canonical JSON raises for an input it cannot bind."""


def _binding_or_none(deps: UpFrontDeps, input: Any) -> str | None:
    """The canonical JSON ``input`` is bound by, or ``None`` when it has none."""
    try:
        return deps.binding_input(input)
    except _UNBINDABLE:
        return None


def _split_error(tool: str, index: int, command: str) -> CommandError:
    """A gated step whose input is not known until the pipeline runs: nothing ran."""
    what = _what(tool)
    return CommandError(
        code=ErrorCodes.APPROVAL_REQUIRED,
        message=(
            f"{command} (the step at index {index}) needs approval, and its input comes from an "
            f"earlier step, so the user cannot approve it before the {what} runs. Nothing ran."
        ),
        suggestion=(
            f"Split the {what} before the step at index {index}: run the steps before it with "
            f"{tool}, then call {command} on its own with the input they returned, so the client "
            "can ask the user."
        ),
        retryable=False,
        details={"reason": "input-not-known", "step": index, "command": command},
    )


def _not_kept_error(tool: str, index: int, command: str) -> CommandError:
    """A gated step whose input was too large to keep with its question, and whose input validated
    to something the earlier approval does not match on the retry: asking again would not end."""
    return CommandError(
        code=ErrorCodes.APPROVAL_REQUIRED,
        message=(
            f"{command} (the step at index {index}) was approved, but its input is too large to "
            f"keep between requests (over {MAX_KEPT_INPUT} characters with the steps before it), "
            "and it validated to a different input on the retry, so the approval does not match "
            "it. Nothing ran."
        ),
        suggestion=(
            f"Call {command} on its own so the client can ask the user to approve the input it "
            "runs on, or give the step every input the schema would default."
        ),
        retryable=False,
        details={"reason": "input-not-kept", "step": index, "command": command},
    )


def _declined_error(tool: str, gated: Sequence[_GatedStep]) -> CommandError:
    names = ", ".join(dict.fromkeys(step.command for step in gated))
    return CommandError(
        code=ErrorCodes.APPROVAL_REQUIRED,
        message=f"The user did not approve {names}; nothing in the {_what(tool)} ran",
        suggestion=(
            "Do not run this again without asking the user first; the user chose not to approve it."
        ),
        retryable=False,
        details={"reason": "declined", "summary": "; ".join(step.summary for step in gated)},
        recovery=Recovery(kind="stop"),
    )


def _too_many_error(tool: str) -> CommandError:
    what = _what(tool)
    return CommandError(
        code=ErrorCodes.APPROVAL_REQUIRED,
        message=(
            f"The {what} has more than {MAX_UP_FRONT_APPROVALS} steps that need approval, more "
            "than the user can be asked about at once. Nothing ran."
        ),
        suggestion=(
            f"Split it into calls of {tool} with at most {MAX_UP_FRONT_APPROVALS} steps that need "
            "approval each."
        ),
        retryable=False,
        details={"reason": "too-many-approvals", "limit": MAX_UP_FRONT_APPROVALS},
    )


def _pending_error(tool: str, gated: Sequence[_GatedStep]) -> CommandError:
    """The result while the human is asked; the lane answers with the elicitation instead."""
    summary = "; ".join(step.summary for step in gated)
    return CommandError(
        code=ErrorCodes.APPROVAL_REQUIRED,
        message=f"The {_what(tool)} needs approval before it runs",
        suggestion=f'Wait for the user to approve "{summary}" in the client.',
        retryable=False,
        details={"summary": summary},
        recovery=Recovery(kind="external"),
    )


def _unplanned_error(tool: str, command: str) -> CommandError:
    """A gated step the human was not asked about up front (its policy changed its mind)."""
    return CommandError(
        code=ErrorCodes.APPROVAL_REQUIRED,
        message=f"{command} needs approval before it runs",
        suggestion=(
            "Ask the user to approve it; the client could not be asked for this step of the "
            f"{_what(tool)}. Call {command} on its own so the client can ask the user."
        ),
        retryable=False,
        details={"summary": f"Run {command}"},
    )


def _steps_message(
    tool: str, conditional: bool, steps: Sequence[_GatedStep], note: str | None
) -> str:
    """The question of an up-front approval: what the call is, then each gated step's summary,
    command and canonical input, so the human sees exactly what would run."""
    what = _what(tool)
    count = "a step that needs" if len(steps) == 1 else f"{len(steps)} steps that need"
    lines = [note] if note else []
    lines.append(
        f"This {what} includes {count} your approval. Approving lets each run once, exactly as "
        f"shown; if you do not approve, nothing in the {what} runs."
    )
    if conditional:
        lines.append(
            "Some steps run only when their conditions hold, so one step may run while another "
            "is skipped."
        )
    for step in steps:
        lines += [
            "",
            f"Step {step.index + 1}: {step.summary}",
            f"Command: {step.command}",
            f"Input: {shown_input(step.input)}",
        ]
    return "\n".join(lines)


__all__ = [
    "APPROVAL_INPUT_KEY",
    "APPROVAL_REQUESTED_SCHEMA",
    "MAX_UP_FRONT_APPROVALS",
    "NEVER_ASKS",
    "AcceptedApproval",
    "ApprovalAnswer",
    "ApprovalAnswers",
    "ApprovalQuestion",
    "ApprovalRelay",
    "ApprovedStep",
    "StepsHold",
    "UpFrontApproval",
    "UpFrontDeps",
    "UpFrontStep",
    "bind_approval_relay",
    "current_approval_relay",
    "current_up_front_approval",
    "reads_step_data",
    "relay_message",
    "shown_input",
]
