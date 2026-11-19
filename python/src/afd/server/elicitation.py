"""The elicitations of one MCP ``tools/call``: confirmations and relayed approvals.

One :class:`ElicitationRound` serves a call. It is the call's confirmation channel
(``afd.server.confirmations``) and, when the request can carry a form elicitation, the source of
its approval relay (``afd.server.approval_relay``).

On MCP 2026-07-28 a question is an ``input_required`` result. Its ``requestState`` carries the
questions asked (``p``) and those accepted in earlier rounds (``a``), so a call that needs a
confirmation and then an approval keeps the first answer while the second is asked. Each entry
holds its input key (``k``), its binding (``b``) and when its answer lapses (``t``: 10 minutes
after it was asked, however many later rounds carry it); an approval also carries its nonce
(``n``), expiry (``x``) and MAC (``m``), which only the approval middleware can verify. The SDK
seals the state (AES-256-GCM) and binds it to the request and to the call's principal binding
(``spec/authorization.md``, M8; #532), so a stale or altered state never reaches this module.

On a 2025 connection with a back channel (stdio, stateful HTTP) the server asks in band: a
confirmation as soon as it is needed, an approval once the call returns held, after which the
call runs again with the answer (:meth:`ElicitationRound.ask_in_band`).
"""

from __future__ import annotations

import json
import time
from collections.abc import Sequence
from typing import Any, Optional

from afd.server.approval_relay import (
    APPROVAL_INPUT_KEY,
    APPROVAL_REQUESTED_SCHEMA,
    AcceptedApproval,
    ApprovalAnswer,
    ApprovalAnswers,
    ApprovedStep,
    MISSING,
    StepsHold,
)
from afd.server.confirmations import (
    AFD_CONFIRM_META_KEY,
    CONFIRM_INPUT_KEY,
    CONFIRM_REQUESTED_SCHEMA,
)
from afd.server.session_context import is_modern_protocol

ANSWER_TTL_MS = 10 * 60_000
"""How long an answer counts after its question was asked."""

MAX_IN_BAND_ROUNDS = 4
"""Elicitation rounds one 2025 call may take in band: a confirmation, then an approval, and room
for an approval asked again."""

_FIELDS = {CONFIRM_INPUT_KEY: "confirm", APPROVAL_INPUT_KEY: "approve"}


def _now() -> int:
    return time.time_ns() // 1_000_000


def _entry(item: Any) -> Optional[dict[str, Any]]:
    """One question of a state, or ``None`` when it is not one."""
    if not isinstance(item, dict):
        return None
    if not isinstance(item.get("k"), str) or not isinstance(item.get("b"), str):
        return None
    if not _is_int(item.get("t")):
        return None
    if item["k"] == APPROVAL_INPUT_KEY and not (
        isinstance(item.get("n"), str) and _is_int(item.get("x")) and isinstance(item.get("m"), str)
    ):
        return None
    return item


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _accepts(response: Any, key: str) -> Optional[bool]:
    """``True`` for an accepted form whose field is ``true``, ``False`` for any other answer,
    ``None`` when there is no answer."""
    if response is None or not hasattr(response, "action"):
        return None
    content = getattr(response, "content", None)
    return (
        response.action == "accept"
        and isinstance(content, dict)
        and content.get(_FIELDS[key]) is True
    )


class ElicitationRound:
    """What one SDK ``tools/call`` can carry for confirmations and approvals."""

    def __init__(self, ctx: Any, stateless_http: bool, request: Any) -> None:
        self._ctx = ctx
        self.modern = is_modern_protocol(getattr(ctx, "protocol_version", None))
        capabilities = getattr(ctx, "client_capabilities", None)
        elicitation = getattr(capabilities, "elicitation", None) if capabilities else None
        form = elicitation is not None and (
            getattr(elicitation, "form", None) is not None or getattr(elicitation, "url", None) is None
        )
        self.can_elicit = form and (self.modern or not stateless_http)
        params = getattr(request, "params", None)
        meta = params.get("_meta") if isinstance(params, dict) else None
        self.acknowledged = isinstance(meta, dict) and meta.get(AFD_CONFIRM_META_KEY) is True

        # Questions accepted in earlier rounds, questions asked last round, and the answers.
        self._accepted: list[dict[str, Any]] = []
        self._pending: list[dict[str, Any]] = []
        self._responses: dict[str, Any] = {}
        if self.modern:
            self._read_state(getattr(ctx, "request_state", None))
            self._responses = dict(getattr(ctx, "input_responses", None) or {})

    def _read_state(self, state: Any) -> None:
        if not isinstance(state, str):
            return
        try:
            payload = json.loads(state)
        except ValueError:
            return
        if not isinstance(payload, dict):
            return
        now = _now()
        # An answer carried from an earlier round lapses with its own question, so re-minting
        # the state never extends it.
        for name, into in (("a", self._accepted), ("p", self._pending)):
            items = payload.get(name)
            if isinstance(items, list):
                into.extend(
                    entry for entry in map(_entry, items) if entry is not None and entry["t"] > now
                )

    def _answers(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """The questions accepted (earlier rounds' first, then this round's) and declined."""
        accepted = list(self._accepted)
        declined: list[dict[str, Any]] = []
        now = _now()
        for asked in self._pending:
            if asked["t"] <= now:
                continue
            answer = _accepts(self._responses.get(asked["k"]), asked["k"])
            if answer is None:
                continue
            (accepted if answer else declined).append(asked)
        return accepted, declined

    # ── Confirmations (afd.server.confirmations.ConfirmationChannel) ────────────────────────

    async def response(self, binding: str) -> str:
        accepted, declined = self._answers()

        def asks(item: dict[str, Any]) -> bool:
            return item["k"] == CONFIRM_INPUT_KEY and item["b"] == binding

        if any(map(asks, declined)):
            return "decline"
        return "accept" if any(map(asks, accepted)) else "missing"

    async def ask(self, message: str, binding: str) -> Any:
        question = {"k": CONFIRM_INPUT_KEY, "b": binding}
        if self.modern:
            return self.input_required([question], message, CONFIRM_REQUESTED_SCHEMA, [binding])
        result = await self._elicit(message, CONFIRM_REQUESTED_SCHEMA)
        if _accepts(result, CONFIRM_INPUT_KEY):
            # Kept for the call's later rounds, so an approval asked next does not ask again.
            self._accepted.append({**question, "t": _now() + ANSWER_TTL_MS})
            return "accept"
        return "decline"

    # ── Approvals ───────────────────────────────────────────────────────────────────────────

    def relay(self) -> RoundRelay:
        """A fresh approval relay for one attempt at the call."""
        return RoundRelay(self)

    def _approval_answers(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        accepted, declined = self._answers()
        return (
            [item for item in accepted if item["k"] == APPROVAL_INPUT_KEY],
            [item for item in declined if item["k"] == APPROVAL_INPUT_KEY],
        )

    def ask_approval(self, hold: StepsHold) -> Any:
        """The ``input_required`` result asking ``hold`` (MCP 2026-07-28)."""
        return self.input_required(
            _questions(hold),
            hold.message,
            APPROVAL_REQUESTED_SCHEMA,
            [binding for question in hold.questions for binding in question.bindings],
        )

    async def ask_in_band(self, hold: StepsHold) -> bool:
        """Ask ``hold`` with a server-sent elicitation (a 2025 connection) and keep the answer for
        the call's next attempt. ``False`` when the client gave no answer."""
        try:
            result = await self._elicit(hold.message, APPROVAL_REQUESTED_SCHEMA)
        except Exception:
            # Cancelled, or the client went away, timed out or answered with an error: nobody
            # declined, so do not say so.
            return False
        replaced = {binding for question in hold.questions for binding in question.bindings}
        self._drop(APPROVAL_INPUT_KEY, replaced)
        until = _now() + ANSWER_TTL_MS
        self._pending = [{**question, "t": until} for question in _questions(hold)]
        self._responses = {APPROVAL_INPUT_KEY: result}
        return True

    # ── Shared ──────────────────────────────────────────────────────────────────────────────

    def _drop(self, key: str, replaced: set[str]) -> None:
        """Forget earlier answers to the same questions (an expired or spent approval), so the
        new answer is the only one."""
        self._accepted = [
            item for item in self._accepted if item["k"] != key or item["b"] not in replaced
        ]

    def input_required(
        self,
        questions: Sequence[dict[str, Any]],
        message: str,
        requested_schema: dict[str, Any],
        replaces: Sequence[str],
    ) -> Any:
        """Ask ``questions`` with one form elicitation under their shared input key: one answer
        covers them all."""
        from mcp_types import ElicitRequest, ElicitRequestFormParams, InputRequiredResult

        key = questions[0]["k"]
        accepted, _ = self._answers()
        kept = [item for item in accepted if item["k"] != key or item["b"] not in replaces]
        until = _now() + ANSWER_TTL_MS
        state = {"p": [{**question, "t": until} for question in questions], "a": kept}
        return InputRequiredResult(
            input_requests={
                key: ElicitRequest(
                    params=ElicitRequestFormParams(message=message, requested_schema=requested_schema)
                )
            },
            request_state=json.dumps(state, separators=(",", ":")),
        )

    async def _elicit(self, message: str, schema: dict[str, Any]) -> Any:
        """A server-sent form elicitation (a 2025 connection)."""
        return await self._ctx.session.elicit_form(
            message, schema, related_request_id=self._ctx.request_id
        )


def _questions(hold: StepsHold) -> list[dict[str, Any]]:
    return [
        {
            "k": APPROVAL_INPUT_KEY,
            "b": question.binding,
            "n": question.nonce,
            "x": question.expires_at,
            "m": question.mac,
            # The step of a batch or pipeline asked about up front, and its validated input (#1414).
            **(
                {"s": question.step.index, "i": question.step.input, "c": question.step.call}
                if question.step is not None
                else {}
            ),
        }
        for question in hold.questions
    ]


def _accepted_approval(item: dict[str, Any]) -> AcceptedApproval:
    index, input, call = item.get("s"), item.get("i"), item.get("c")
    step = (
        ApprovedStep(index, input, call)
        if _is_int(index) and isinstance(input, str) and isinstance(call, str)
        else None
    )
    return AcceptedApproval(
        binding=item["b"], nonce=item["n"], expires_at=item["x"], mac=item["m"], step=step
    )


class RoundRelay:
    """The approval relay of one attempt at a call that can elicit, and the hold recorded on
    it: one command's, or every gated step's of an ``afd-batch`` or ``afd-pipe``."""

    def __init__(self, round: ElicitationRound) -> None:
        self._round = round
        self._routed: Optional[str] = None
        self._claimed = False
        self.held: Optional[StepsHold] = None

    def route(self, command: str) -> None:
        if self._routed is None:
            self._routed = command

    def claim(self, command: str) -> bool:
        if self._claimed or command != self._routed:
            return False
        self._claimed = True
        return True

    async def answer(self, bindings: Sequence[str]) -> ApprovalAnswer:
        accepted, declined = self._round._approval_answers()
        if any(item["b"] in bindings for item in declined):
            return ApprovalAnswer("decline")
        # The latest answer wins: this round's are read after those carried forward.
        matches = [item for item in accepted if item["b"] in bindings]
        if not matches:
            return MISSING
        return ApprovalAnswer("accept", _accepted_approval(matches[-1]))

    def hold(self, hold: StepsHold) -> None:
        if self.held is None and hold.questions:
            self.held = hold

    async def answers(self) -> ApprovalAnswers:
        accepted, declined = self._round._approval_answers()
        return ApprovalAnswers(
            accepted=tuple(_accepted_approval(item) for item in accepted),
            declined=tuple(item["b"] for item in declined),
        )


__all__ = ["ANSWER_TTL_MS", "MAX_IN_BAND_ROUNDS", "ElicitationRound", "RoundRelay"]
