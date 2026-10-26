"""Confirmation enforcement for commands with ``confirm_prompt``.

``spec/command-metadata.md``, "Confirmations". The server option ``confirmations`` turns it on:
``"off"`` (the default), ``"enforce"`` or ``"require-human"``. A call that reaches a command with
``confirm_prompt`` then runs only with a confirmation:

- an accepted MCP elicitation: an ``input_required`` result on MCP 2026-07-28, or a server-sent
  elicitation on a stateful 2025 connection; or
- under ``"enforce"``, an acknowledgement: a ``confirm`` argument or
  ``_meta["dev.afd/confirm"]``.

Otherwise the call fails with ``CONFIRMATION_REQUIRED`` or ``CONFIRMATION_DECLINED`` before any
handler runs. In-process calls (``server.execute``, DirectClient) are never gated.

The SDK request that is being served describes what it can carry with a
:class:`ConfirmationChannel`, bound to a context variable for the duration of the call.
"""

from __future__ import annotations

import base64
import hashlib
import json
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from afd.core.commands import CommandDefinition
from afd.core.errors import ErrorCodes
from afd.core.result import CommandError

ConfirmationMode = Literal["off", "enforce", "require-human"]
CONFIRMATION_MODES: tuple[str, ...] = ("off", "enforce", "require-human")

AFD_CONFIRM_META_KEY = "dev.afd/confirm"
"""``_meta`` key a client sets to ``True`` to acknowledge every gated command in a call."""

CONFIRM_INPUT_KEY = "confirm"
"""The ``inputRequests`` key of the confirmation elicitation."""

CONFIRM_REQUESTED_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "confirm": {"type": "boolean", "title": "Confirm", "description": "Run the command"},
    },
    "required": ["confirm"],
}
"""The elicitation form: one required boolean."""

Response = Literal["accept", "decline", "missing"]


class ConfirmationChannel(Protocol):
    """What the request being routed can carry, as seen by the server that received it."""

    can_elicit: bool
    """The request can carry (and the server can deliver) a form elicitation."""
    acknowledged: bool
    """``_meta["dev.afd/confirm"]`` is ``True``."""

    async def response(self, binding: str) -> Response:
        """The answer to an earlier elicitation, if this request is its retry for ``binding``."""

    async def ask(self, message: str, binding: str) -> Any:
        """Ask ``message``: ``"accept"`` or ``"decline"`` when answered now (a 2025 session),
        or the ``input_required`` result to return (MCP 2026-07-28)."""


_CHANNEL: ContextVar[ConfirmationChannel | None] = ContextVar("afd_confirmation_channel", default=None)


@contextmanager
def bind_confirmation_channel(channel: ConfirmationChannel | None) -> Iterator[None]:
    """Bind ``channel`` for the calls routed inside the block."""
    token = _CHANNEL.set(channel)
    try:
        yield
    finally:
        _CHANNEL.reset(token)


def current_confirmation_channel() -> ConfirmationChannel | None:
    return _CHANNEL.get()


@dataclass(frozen=True)
class ConfirmationStep:
    command: str
    input: Any


@dataclass(frozen=True)
class ConfirmationOutcome:
    """What the gate decided: ``proceed``, an ``error``, or an ``input-required`` ``result``."""

    kind: Literal["proceed", "error", "input-required"]
    error: CommandError | None = None
    result: Any = None


PROCEED = ConfirmationOutcome("proceed")


def confirmation_binding(steps: Sequence[ConfirmationStep]) -> str:
    """A digest of the gated commands and their input, independent of key order."""
    canonical = json.dumps(
        [[step.command, {} if step.input is None else step.input] for step in steps],
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )
    digest = hashlib.sha256(canonical.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def declares_confirm_input(command: CommandDefinition) -> bool:
    """Whether a command's own input schema declares a ``confirm`` property."""
    schema = command.input_schema
    if isinstance(schema, dict):
        properties = schema.get("properties")
        if isinstance(properties, dict):
            return "confirm" in properties
    return any(parameter.name == "confirm" for parameter in command.parameters)


def accepts_confirm(command: CommandDefinition, mode: str) -> bool:
    """Whether the command's tool advertises the ``confirm`` acknowledgement (``enforce`` only)."""
    return mode == "enforce" and bool(command.confirm_prompt) and not declares_confirm_input(command)


CONFIRM_PROPERTY: dict[str, Any] = {
    "type": "boolean",
    "description": (
        "Set to true to confirm this command, once the user intends it. "
        "The server asks for confirmation when it is missing."
    ),
}


def _names(steps: Sequence[ConfirmationStep]) -> list[str]:
    return list(dict.fromkeys(step.command for step in steps))


class ConfirmationGate:
    """Decides whether calls to the remotely callable ``commands`` may run."""

    def __init__(self, mode: str, commands: Sequence[CommandDefinition]) -> None:
        if mode not in CONFIRMATION_MODES:
            raise ValueError("confirmations must be 'off', 'enforce' or 'require-human'")
        self.mode: str = mode
        self._prompts = {
            command.name: command.confirm_prompt
            for command in commands
            if command.confirm_prompt
        }

    def gated(self, steps: Sequence[ConfirmationStep]) -> list[ConfirmationStep]:
        if self.mode == "off":
            return []
        return [step for step in steps if step.command in self._prompts]

    def _message(self, steps: Sequence[ConfirmationStep]) -> str:
        if len(steps) == 1:
            return self._prompts[steps[0].command]
        lines = ["This request runs commands that need confirmation:"]
        lines += [f"- {step.command}: {self._prompts[step.command]}" for step in steps]
        return "\n".join(lines)

    def _declined(self, names: list[str]) -> ConfirmationOutcome:
        quoted = ", ".join(f"'{name}'" for name in names)
        return ConfirmationOutcome(
            "error",
            CommandError(
                code=ErrorCodes.CONFIRMATION_DECLINED,
                message=f"The user did not confirm {quoted}",
                suggestion=(
                    "Do not run this again without asking the user first; "
                    "the user chose not to proceed."
                ),
                retryable=False,
                details={"commands": names},
            ),
        )

    async def check(
        self,
        steps: Sequence[ConfirmationStep],
        acknowledged: bool | set[str] | None,
        how_to_acknowledge: str,
    ) -> ConfirmationOutcome:
        """Decide one call.

        Args:
            steps: Every command the call would run.
            acknowledged: The call's ``confirm`` argument: ``True`` for every gated
                command, or the confirmed command names.
            how_to_acknowledge: Recovery text for this surface.
        """
        gated = self.gated(steps)
        if not gated:
            return PROCEED
        names = _names(gated)
        binding = confirmation_binding(gated)
        channel = current_confirmation_channel()

        response = await channel.response(binding) if channel else "missing"
        if response == "accept":
            return PROCEED
        if response == "decline":
            return self._declined(names)

        if self.mode == "enforce":
            covered = (
                (channel is not None and channel.acknowledged)
                or acknowledged is True
                or (isinstance(acknowledged, set) and all(name in acknowledged for name in names))
            )
            if covered:
                return PROCEED

        if channel is not None and channel.can_elicit:
            answer = await channel.ask(self._message(gated), binding)
            if answer == "accept":
                return PROCEED
            if answer == "decline":
                return self._declined(names)
            return ConfirmationOutcome("input-required", result=answer)

        first = gated[0]
        message = (
            f"'{first.command}' needs confirmation: {self._prompts[first.command]}"
            if len(names) == 1
            else f"{', '.join(repr(name) for name in names)} need confirmation"
        )
        suggestion = (
            f"Make sure the user intends this, then {how_to_acknowledge}."
            if self.mode == "enforce"
            else "This server accepts only a confirmation from the user: "
            "use an MCP client that supports elicitation."
        )
        return ConfirmationOutcome(
            "error",
            CommandError(
                code=ErrorCodes.CONFIRMATION_REQUIRED,
                message=message,
                suggestion=suggestion,
                retryable=False,
                details={"commands": names},
            ),
        )


def without_confirm(args: Any) -> Any:
    """The arguments without a top-level ``confirm``."""
    if isinstance(args, dict) and "confirm" in args:
        return {key: value for key, value in args.items() if key != "confirm"}
    return args


def named_acknowledgement(value: Any) -> set[str] | None:
    """The ``confirm: [names]`` acknowledgement of ``afd-batch`` and ``afd-pipe``."""
    if isinstance(value, list):
        return {item for item in value if isinstance(item, str)}
    return None


__all__ = [
    "AFD_CONFIRM_META_KEY",
    "CONFIRMATION_MODES",
    "CONFIRM_INPUT_KEY",
    "CONFIRM_PROPERTY",
    "CONFIRM_REQUESTED_SCHEMA",
    "ConfirmationChannel",
    "ConfirmationGate",
    "ConfirmationMode",
    "ConfirmationOutcome",
    "ConfirmationStep",
    "accepts_confirm",
    "bind_confirmation_channel",
    "confirmation_binding",
    "current_confirmation_channel",
    "declares_confirm_input",
    "named_acknowledgement",
    "without_confirm",
]
