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
import json
from collections.abc import Awaitable, Callable, Iterator, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Literal, Optional, Protocol

from afd.core.commands import CommandContext
from afd.core.errors import ErrorCodes
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


@dataclass(frozen=True)
class ApprovalAnswer:
    """The human's answer to an earlier approval elicitation for one binding."""

    kind: Literal["accept", "decline", "missing"]
    accepted: Optional[AcceptedApproval] = None


@dataclass(frozen=True)
class ApprovalAnswers:
    """Every approval answer a request carries: those accepted, and the bindings declined."""

    accepted: tuple[AcceptedApproval, ...] = ()
    declined: tuple[str, ...] = ()


MISSING = ApprovalAnswer("missing")


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

_RELAY: ContextVar[Optional[ApprovalRelay]] = ContextVar("afd_approval_relay", default=None)
_UP_FRONT: ContextVar[Optional["UpFrontApproval"]] = ContextVar("afd_up_front_approval", default=None)


@contextmanager
def bind_approval_relay(
    relay: Optional[ApprovalRelay], up_front: Optional["UpFrontApproval"] = None
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


def current_approval_relay() -> Optional[ApprovalRelay]:
    return _RELAY.get()


def current_up_front_approval() -> Optional["UpFrontApproval"]:
    return _UP_FRONT.get()


def shown_input(text: str) -> str:
    """``text``, cut to 1000 UTF-16 code units (as TypeScript counts them) with an ellipsis."""
    units = 0
    for at, char in enumerate(text):
        units += 2 if ord(char) > 0xFFFF else 1
        if units > _MAX_SHOWN_INPUT:
            return text[:at] + "…"
    return text


def relay_message(summary: str, command: str, input: str, note: Optional[str] = None) -> str:
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

    def may_require_approval(self, command: str) -> bool:
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

    async def spend(self, nonce: str, expires_at: float, now: float) -> bool:
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
    error: Optional[CommandError] = None


@dataclass(frozen=True)
class _GatedStep:
    index: int
    command: str
    input: str
    """The canonical JSON of its validated input."""
    summary: str
    bindings: list[str]


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
    ) -> None:
        self.relay = relay
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
        self.refusal: Optional[CommandError] = None
        """Set when nothing may run (a gated step whose input is not known up front, a
        decline, or a pending question): the router answers with it instead of the run."""
        self._steps: Optional[list[UpFrontStep]] = None
        # One plan per approval middleware, shared by the call's steps (concurrent ones too).
        self._plans: dict[int, asyncio.Future[_Plan]] = {}
        self._tags: dict[int, list[str]] = {}

    def steps(self) -> list[UpFrontStep]:
        if self._steps is None:
            self._steps = (
                _pipeline_steps(self._request, self._can_run, self._validate)
                if self.tool == "afd-pipe"
                else _batch_steps(self._request, self._validate)
            )
        return self._steps

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
        next_fn: Callable[[], Awaitable[CommandResult[Any]]],
    ) -> CommandResult[Any]:
        """Run one step through the up-front gate: nothing runs until the plan is to run, and
        then a gated step runs only on an unused approval of its own binding."""
        plan = self._plans.get(id(deps))
        if plan is None:
            plan = self._plans[id(deps)] = asyncio.ensure_future(self._decide(deps, context))
        decided = await plan
        if decided.kind == "refuse":
            assert decided.error is not None
            if self.refusal is None:
                self.refusal = decided.error
            return failure(decided.error)
        if not await deps.requires_approval(command, input, context):
            return await _released(next_fn)
        bindings = deps.bindings(
            self._call_tags(deps), command, deps.binding_input(input), deps.actor_binding(context)
        )
        # No await between finding and taking it, so concurrent steps cannot take the same one.
        # Its expiry was checked when the call started, as a single command's is.
        approval = next(
            (item for item in decided.approved if not item.used and item.binding in bindings), None
        )
        if approval is not None:
            approval.used = True
            return await _released(next_fn)
        return failure(_unplanned_error(self.tool, command))

    async def _decide(self, deps: UpFrontDeps, context: CommandContext) -> _Plan:
        steps = self.steps()
        late = next(
            (step for step in steps if step.dynamic and deps.may_require_approval(step.command)),
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
            if not await deps.requires_approval(step.command, step.input, context):
                continue
            input = deps.binding_input(step.input)
            gated.append(
                _GatedStep(
                    index=step.index,
                    command=step.command,
                    input=input,
                    summary=deps.summarize(step.command, step.input, context),
                    bindings=deps.bindings(scope, step.command, input, actor),
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
        for step in gated:
            found = next(
                (
                    at
                    for at in range(len(pool) - 1, -1, -1)
                    if pool[at].binding in step.bindings and deps.genuine(pool[at], step.bindings, now)
                ),
                None,
            )
            if found is None:
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
        questions = tuple(deps.question(step.bindings, now) for step in gated)
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


def _validated(validate: StepValidator, index: int, command: str, input: Any) -> UpFrontStep:
    try:
        valid, data = validate(command, input)
    except Exception:
        # The step fails validation when it runs too.
        return UpFrontStep(index, command, dynamic=False)
    return UpFrontStep(index, command, dynamic=False, valid=valid, input=data if valid else None)


def _batch_steps(request: Any, validate: StepValidator) -> list[UpFrontStep]:
    """The steps of an ``afd-batch``: every item's input is known up front."""
    items = request.get("commands") if isinstance(request, dict) else None
    if not isinstance(items, list):
        return []
    return [
        _validated(validate, index, item["command"], item.get("input", {}))
        for index, item in enumerate(items)
        if isinstance(item, dict) and isinstance(item.get("command"), str)
    ]


def _pipeline_steps(request: Any, can_run: CanRun, validate: StepValidator) -> list[UpFrontStep]:
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
        steps.append(_validated(validate, index, command, resolved))
    return steps


def _what(tool: str) -> str:
    return "batch" if tool == "afd-batch" else "pipeline"


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
    tool: str, conditional: bool, steps: Sequence[_GatedStep], note: Optional[str]
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
