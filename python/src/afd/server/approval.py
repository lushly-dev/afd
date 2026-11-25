"""Pre-execution approval gate (#420, parity with TypeScript's #272).

``create_approval_middleware`` holds a call whose command's ``approval`` policy
requires a human's sign-off and returns ``APPROVAL_REQUIRED`` before the handler
runs. The result carries an approval token; once a human approves, the surface
retries the same call with that token in ``context.approval``
(``spec/command-metadata.md``, "Approvals").

Token format: ``afdap1.<payload>.<mac>``, both parts base64url without padding.
The payload is JSON, byte for byte as TypeScript writes it, so a token issued by
one server verifies on another that shares the secret:

- ``c``: the command name;
- ``i``: HMAC-SHA256 of the canonical JSON of the validated input;
- ``a``: HMAC-SHA256 of the canonical JSON of the actor's ``kind``, ``id`` and
  ``onBehalfOf`` (``null`` when the call has no actor);
- ``iat``, ``exp``: issue and expiry times in epoch milliseconds;
- ``n``: a 128-bit random nonce.

The MAC is HMAC-SHA256 over ``afdap1.<payload>`` with the application's secret.
The input and actor are keyed digests rather than plain hashes, so a token
reveals neither a low-entropy input (such as a record ID) nor the actor ID.
Every comparison is constant-time.

With ``relay="mcp-elicitation"`` (#1312, TypeScript's #418), an MCP call that can carry a
form elicitation is not answered with a token: the server asks the human, and the call runs
once the sealed ``requestState`` and the human's answer check out (``afd.server.approval_relay``).
"""

import base64
import hashlib
import hmac
import inspect
import json
import math
import secrets
from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import (
    Any,
    Literal,
    Protocol,
    runtime_checkable,
)

from pydantic import BaseModel, PlainSerializer, SecretBytes, SecretStr, WrapSerializer

from afd.core.actor import Actor
from afd.core.approval import ApprovalPolicy
from afd.core.clock import Clock, system_clock
from afd.core.commands import CommandContext, CommandDefinition, CommandMiddleware, NextFn
from afd.core.errors import ErrorCodes
from afd.core.journal import _js_number, _js_string
from afd.core.result import CommandError, CommandResult, failure
from afd.server.approval_admission import admit_approval, gates, live_command, mark_listed_gate
from afd.server.approval_relay import (
    AcceptedApproval,
    ApprovalQuestion,
    StepsHold,
    current_approval_relay,
    current_up_front_approval,
    input_changed_error,
    not_canonical_error,
    relay_message,
)
from afd.server.instance_state import ApprovalProcessState, mark_approval_process_state
from afd.server.relay_evidence import relay_evidence_of

__all__ = [
    "ApprovalCommand",
    "ApprovalNonceStore",
    "ApprovalRejection",
    "ApprovalRelayMode",
    "ApprovalRequest",
    "ApprovalSecret",
    "create_approval_middleware",
]

_TOKEN_PREFIX = "afdap1"
_MIN_SECRET_BYTES = 32
_DEFAULT_TTL_MS = 5 * 60_000
_MAX_TTL_MS = 24 * 60 * 60_000
# Longer evidence is rejected unread, so a caller cannot make the server hash megabytes.
_MAX_TOKEN_LENGTH = 1024
# JavaScript numbers are doubles: past this, an integer could share a digest with its neighbour.
_MAX_SAFE_INTEGER = 2**53 - 1

ApprovalSecret = str | bytes | bytearray | memoryview
"""An HMAC key: a string (UTF-8) or raw bytes, at least 32 bytes long."""

ApprovalRelayMode = Literal["none", "mcp-elicitation"]
"""How a held MCP call reaches the human: ``"none"`` returns ``APPROVAL_REQUIRED``;
``"mcp-elicitation"`` asks the human behind the client with a form elicitation."""

ApprovalRejection = Literal[
    "malformed",
    "invalid-signature",
    "expired",
    "command-mismatch",
    "input-mismatch",
    "actor-mismatch",
    "credentials-mismatch",
    "already-used",
]
"""Why a supplied approval token or relay evidence was not accepted."""


@runtime_checkable
class ApprovalCommand(Protocol):
    """What the middleware reads from a command: its name, approval policy and confirmation
    prompt. A :class:`~afd.core.commands.CommandDefinition` is one."""

    name: str
    approval: ApprovalPolicy | None
    confirm_prompt: str | None


class ApprovalNonceStore(Protocol):
    """Records which single-use tokens have been spent.

    The default keeps them in memory, which holds only within one process: give
    servers that run several instances a shared store.
    """

    def consume(self, nonce: str, expires_at: float) -> bool | Awaitable[bool]:
        """Mark ``nonce`` as used until ``expires_at`` (epoch milliseconds; it can be
        forgotten after). Return ``False`` when it was already used. Must be atomic: of
        two concurrent calls with the same nonce, exactly one returns ``True``."""
        ...


@dataclass(frozen=True)
class ApprovalRequest:
    """A call held for approval, as passed to ``on_approval_required``.

    Attributes:
        command: The command name.
        input: The validated input the token is bound to.
        actor: A copy of the call's actor, if any.
        approval_token: The fresh token.
        expires_at: ISO 8601 expiry of ``approval_token``.
        summary: The text shown to the human who approves.
        rejected: Set when the call carried a token that was rejected.
    """

    command: str
    input: Any
    actor: Actor | None
    approval_token: str
    expires_at: str
    summary: str
    rejected: ApprovalRejection | None = None


@dataclass(frozen=True)
class _Accepted:
    nonce: str
    expires_at: float


from afd.core.direct_approval import _exchange  # noqa: E402


def create_approval_middleware(
    *,
    secret: ApprovalSecret | Sequence[ApprovalSecret],
    commands: Iterable[Any] | None = None,
    ttl_ms: float = _DEFAULT_TTL_MS,
    replay: Literal["single-use", "within-ttl"] = "single-use",
    nonce_store: ApprovalNonceStore | None = None,
    summarize: Callable[[str, Any, CommandContext], str | None] | None = None,
    include_token: bool | None = None,
    on_approval_required: Callable[[ApprovalRequest], None | Awaitable[None]] | None = None,
    clock: Clock | None = None,
    relay: ApprovalRelayMode = "none",
) -> CommandMiddleware:
    """A middleware that runs a command whose ``approval`` policy requires approval only
    when ``context.approval`` holds a valid token for this command, input and actor.
    Otherwise it returns ``APPROVAL_REQUIRED`` with a fresh token, and the handler does
    not run.

    Under ``create_server`` and ``create_direct_registry`` it decides from each command's own
    policy. Without it, those engines refuse a command whose policy is not ``"not-required"``
    with ``APPROVAL_UNAVAILABLE``, so a declared policy always holds (#1886).

    Install it after any middleware that sets or refines ``context.actor`` (such as
    auth), since tokens are bound to the actor, and after any retry middleware or
    middleware that changes the input: one approval runs one handler, on the approved
    input. Middleware that moves ``next_fn`` to a thread should use ``asyncio.to_thread``
    or ``contextvars.copy_context().run``; otherwise a call on a context object that
    overlapping calls share is refused. A call that needs approval on an input with no
    canonical form gets ``APPROVAL_UNAVAILABLE`` (``reason: "input-not-canonical"``)
    without asking anyone, and so does one whose input changes while it decides (in a policy
    function), with ``reason: "admission-mismatch"``. Install one approval middleware per
    engine: one admits only a call a policy of its own may gate, so a second one that does not
    gate a command leaves the first one's admission to decide, but two that both gate a
    command's own policy each ask for it. ``context.approval`` must only ever be
    set by trusted surface code once a human approved, never from tool arguments:
    whoever holds a token can use it.

    Args:
        secret: The HMAC key, or several during a key rotation: the first signs, any
            of them verifies. Required, with no default; each key must be at least 32
            bytes. Keep it out of source.
        commands: Optional. :class:`CommandDefinition` objects or functions decorated with
            ``define_command``. The middleware decides from the policy and ``confirm_prompt``
            of the command each call runs (under ``create_server`` and
            ``create_direct_registry``), and also from the policy this list gives that
            command: a call is held when either holds it, so a gate declared only here still
            holds. Outside those engines, where no engine names the command, only this list
            decides, and a command missing from it is not held. Each policy given is validated.
        ttl_ms: How long a token stays valid, in milliseconds. Default: 300000
            (5 minutes); at most 24 hours.
        replay: ``"single-use"`` (default): a token runs the command once; a second
            call with it is held again with ``reason: "already-used"``.
            ``"within-ttl"``: a token runs the same command, input and actor as often as
            it is presented until it expires.
        nonce_store: Where single-use nonces are recorded. Default: in memory, for this
            middleware instance only. Share one store between every instance that uses
            the same secret, or a token works once on each.
        summarize: The text shown to the human who approves, from the call. Default
            (also for an empty string): the command's ``confirm_prompt``, else
            ``Run <command>``.
        include_token: Whether the ``APPROVAL_REQUIRED`` result carries
            ``details.approvalToken``. When ``None`` (the default), follows
            ``spec/command-metadata.md``, "Approvals", rule 6: omitted on MCP calls
            (``context.extra["interface"] == "mcp"``) and included elsewhere. Set ``True``
            to opt in on MCP calls, or ``False`` to omit it everywhere and deliver it
            through ``on_approval_required``. A ``DirectClient`` private exchange never
            includes the token regardless of this setting.
        on_approval_required: Called (sync or async) for every held call that is answered
            with a token, before the result is returned, for example to notify a human. Not
            called for a call whose approval is asked over MCP (``relay``): no token exists.
        clock: Source of time for issuing and expiring tokens and for forgetting spent
            nonces. Default: ``system_clock``. ``context.clock`` is never used: a caller
            can set it, and this is security time.
        relay: ``"mcp-elicitation"`` asks the human behind an MCP client (#1312): a call to
            one command whose request can carry a form elicitation (on MCP 2026-07-28, or a
            2025 connection with a back channel) is answered with an elicitation instead of
            a token, and runs once the human approves. ``afd-batch`` and ``afd-pipe`` are
            approved up front, as a whole, before any step runs. A call that cannot be asked
            falls back to ``APPROVAL_REQUIRED``. It trusts the client application to show the
            question to a person (``spec/command-metadata.md``, "Asking the human over MCP").
            Default ``"none"``.

    Raises:
        TypeError: When no secret is given, a secret is not a string or bytes, or a
            command declares an approval policy that is not valid.
        ValueError: When a secret is shorter than 32 bytes, or ``ttl_ms`` is not a
            positive number of milliseconds of at most 24 hours.

    Example:
        >>> server = create_server(
        ...     "todo",
        ...     middleware=[create_approval_middleware(secret=os.environ["AFD_APPROVAL_SECRET"])],
        ... )
        >>> for command in [todo_delete, todo_list]:  # decorated with define_command
        ...     server.register(command)
    """
    keys = _to_keys(secret)
    if (
        isinstance(ttl_ms, bool)
        or not isinstance(ttl_ms, (int, float))
        or not math.isfinite(ttl_ms)
        or ttl_ms <= 0
        or ttl_ms > _MAX_TTL_MS
    ):
        raise ValueError(
            "Approval ttl_ms must be a positive number of milliseconds, at most 24 hours"
        )
    if replay not in ("single-use", "within-ttl"):
        raise ValueError("Approval replay must be 'single-use' or 'within-ttl'")
    if relay not in ("none", "mcp-elicitation"):
        raise ValueError("Approval relay must be 'none' or 'mcp-elicitation'")
    if include_token is not None and not isinstance(include_token, bool):
        raise TypeError("Approval include_token must be a bool or None")
    relays = relay == "mcp-elicitation"
    security_clock = clock or system_clock
    single_use = replay == "single-use"
    memory_store = None if nonce_store is not None else _MemoryNonceStore()

    gated: dict[str, Any] = {}
    for command in commands or ():
        definition = _as_command(command)
        policy = getattr(definition, "approval", None)
        if (
            policy is not None
            and policy not in ("required", "not-required")
            and not callable(policy)
        ):
            raise TypeError(
                f"Command '{definition.name}' has an invalid approval policy: "
                "use 'required', 'not-required' or a function"
            )
        gated[definition.name] = definition

    def command_for(command_name: str, context: CommandContext) -> Any:
        """The command ``command_name`` names for this call: the one the engine runs (its own
        policy and prompt), else, for another step of an up-front batch or pipeline, the server's
        definition, else, outside the engine, the ``commands`` entry."""
        live = live_command(context)
        if live is not None and live.name == command_name:
            return live
        up_front = current_up_front_approval()
        found = up_front.command(command_name) if up_front is not None else None
        return found if found is not None else gated.get(command_name)

    def policies_for(command_name: str, context: CommandContext) -> list[Any]:
        """The policies that decide ``command_name`` for this call: the command's own (see
        ``command_for``) and, when it differs, the one the ``commands`` option lists for it."""
        own = getattr(command_for(command_name, context), "approval", None)
        listed = getattr(gated.get(command_name), "approval", None)
        return [own] if listed is None or listed is own else [own, listed]

    async def holds(command_name: str, input: Any, context: CommandContext) -> bool:
        """Whether this call needs approval: its own policy or its listed one holds it."""
        for policy in policies_for(command_name, context):
            if await _requires_approval(policy, input, context):
                return True
        return False

    def verify(
        evidence: Any, command_name: str, input_binding: str, actor_binding: str, now: float
    ) -> _Accepted | ApprovalRejection:
        if not isinstance(evidence, str) or len(evidence) > _MAX_TOKEN_LENGTH:
            return "malformed"
        parts = evidence.split(".")
        if len(parts) != 3 or parts[0] != _TOKEN_PREFIX:
            return "malformed"
        _, encoded_payload, encoded_mac = parts
        signing_input = f"{_TOKEN_PREFIX}.{encoded_payload}"
        # Compare the encoded MACs, so that a token has exactly one valid spelling. The key
        # that signed the token also keyed its digests.
        mac = _utf8(encoded_mac)
        key = next(
            (
                candidate
                for candidate in keys
                if hmac.compare_digest(mac, _b64url(_hmac(candidate, signing_input)).encode())
            ),
            None,
        )
        if key is None:
            return "invalid-signature"

        payload = _parse_payload(encoded_payload)
        if payload is None:
            return "malformed"
        if now >= payload["exp"]:
            return "expired"
        if not hmac.compare_digest(_utf8(payload["c"]), _utf8(command_name)):
            return "command-mismatch"
        # The digests are compared encoded: stricter than decoding them first, and the same
        # for every token a server issues (it always writes canonical base64url).
        if not hmac.compare_digest(
            _utf8(payload["i"]), _b64url(_digest(key, "input", input_binding)).encode()
        ):
            return "input-mismatch"
        if not hmac.compare_digest(
            _utf8(payload["a"]), _b64url(_digest(key, "actor", actor_binding)).encode()
        ):
            return "actor-mismatch"
        return _Accepted(nonce=payload["n"], expires_at=payload["exp"])

    def sign(
        command_name: str, input_binding: str, actor_binding: str, now: float
    ) -> tuple[str, float]:
        key = keys[0]
        issued_at = math.floor(now)
        expires_at = issued_at + ttl_ms
        # Key order and number spelling as TypeScript's JSON.stringify writes them.
        payload = (
            f'{{"c":{_js_string(command_name)}'
            f',"i":"{_b64url(_digest(key, "input", input_binding))}"'
            f',"a":"{_b64url(_digest(key, "actor", actor_binding))}"'
            f',"iat":{_js_number(issued_at)}'
            f',"exp":{_js_number(expires_at)}'
            f',"n":"{_b64url(secrets.token_bytes(16))}"}}'
        )
        signing_input = f"{_TOKEN_PREFIX}.{_b64url(payload.encode('utf-8'))}"
        return f"{signing_input}.{_b64url(_hmac(key, signing_input))}", expires_at

    async def spend_nonce(nonce: str, expires_at: float, now: float) -> bool:
        """Spend a nonce unconditionally (used by single-use tokens and relay evidence)."""
        if memory_store is not None:
            return memory_store.consume(nonce, expires_at, now)
        if nonce_store is None:
            raise RuntimeError("single-use approval requires a nonce store")
        outcome = nonce_store.consume(nonce, expires_at)
        if inspect.isawaitable(outcome):
            outcome = await outcome
        # Only an explicit True from the store counts as fresh.
        return outcome is True

    async def spend(nonce: str, expires_at: float, now: float) -> bool:
        """Spend a single-use nonce; ``True`` when it was fresh (or reuse is allowed)."""
        if not single_use:
            return True
        return await spend_nonce(nonce, expires_at, now)

    def summary_of(command_name: str, input: Any, context: CommandContext) -> str:
        return (
            (summarize(command_name, input, context) if summarize is not None else None)
            or getattr(command_for(command_name, context), "confirm_prompt", None)
            or getattr(gated.get(command_name), "confirm_prompt", None)
            or f"Run {command_name}"
        )

    def relay_bindings(command_name: str, input_binding: str, actor_binding: str) -> list[str]:
        """The binding of a relayed approval, one per key: a keyed digest of the command, input
        and actor."""
        data = "relay\0" + _canonical_json([command_name, input_binding, actor_binding])
        return [_b64url(_hmac(key, data)) for key in keys]

    def hold_mac(key: bytes, binding: str, nonce: str, expires_at: int) -> str:
        """The MAC of a relayed approval's nonce and expiry, so the elicitation state cannot set
        them."""
        return _b64url(_hmac(key, "relay-hold\0" + _canonical_json([binding, nonce, expires_at])))

    def genuine(answer: AcceptedApproval, bindings: Sequence[str], now: float) -> bool:
        """Whether an accepted relayed approval was issued by this middleware and is unexpired."""
        if answer.binding not in bindings:
            return False
        key = keys[list(bindings).index(answer.binding)]
        try:
            expected = hold_mac(key, answer.binding, answer.nonce, answer.expires_at)
        except TypeError:
            return False
        if not hmac.compare_digest(_utf8(answer.mac), expected.encode()):
            return False
        return now < answer.expires_at <= now + ttl_ms

    def question(bindings: Sequence[str], now: float) -> ApprovalQuestion:
        binding = bindings[0]
        nonce = _b64url(secrets.token_bytes(16))
        expires_at = math.floor(now + ttl_ms)
        return ApprovalQuestion(
            binding=binding,
            bindings=tuple(bindings),
            nonce=nonce,
            expires_at=expires_at,
            mac=hold_mac(keys[0], binding, nonce, expires_at),
        )

    # This approval step, as the admission records name it.
    self_step = object()

    up_front_deps = _UpFrontDeps(
        now=security_clock.now,
        requires=holds,
        may_require=lambda name, context: any(gates(p) for p in policies_for(name, context)),
        keys=keys,
        genuine=genuine,
        spend=spend,
        question=question,
        summarize=summary_of,
    )

    async def approval_middleware(
        command_name: str, input: Any, context: CommandContext, outer_next: NextFn
    ) -> CommandResult[Any]:
        # Whether a policy here may gate this call: the command's own, or the one the `commands`
        # option lists for it.
        listed_gate = gates(getattr(gated.get(command_name), "approval", None))
        # The command the engine runs, which a middleware before this one may have called it under
        # another name: its listed gate holds at dispatch either way, and a renamed call is refused.
        live = live_command(context)
        if live is not None and gates(getattr(gated.get(live.name), "approval", None)):
            mark_listed_gate(context)
        may_gate = any(gates(policy) for policy in policies_for(command_name, context))
        # The canonical input this call is decided on, taken before anything here awaits, for a
        # command any of whose policies may hold it.
        decided = _canonical_or_none(input) if may_gate else None

        def changed() -> bool:
            """Whether the input no longer has the canonical form decided on, after an await."""
            return _canonical_or_none(input) != decided

        # Every way this middleware lets a call it may gate through admits this command on the
        # input it decided on, which the engine checks, and takes, before it dispatches a command
        # that declares an approval policy or one a listed policy gates. A call no policy here
        # gates is not admitted: an admission from another approval step stands alone, and a
        # retry placed after that step is still refused.
        async def next_fn(verified: Any = _UNVERIFIED) -> CommandResult[Any]:
            if not may_gate:
                return await outer_next()
            approved = verified is not _UNVERIFIED
            admit_approval(
                self_step,
                context,
                command_name,
                verified if approved else decided,
                input,
                _canonical_or_none,
                required=approved or listed_gate,
            )
            return await outer_next()

        # Claimed only by the command the tool call routes to, once, gated or not, so a command
        # that runs inside another (or after it) cannot turn the tool call into an elicitation.
        bound = current_approval_relay() if relays else None
        relay_here = bound if bound is not None and bound.claim(command_name) else None
        # A step of an afd-batch or afd-pipe that can ask: the whole call is approved up front.
        up_front = current_up_front_approval() if relays else None
        if up_front is not None:
            return await up_front.run(up_front_deps, command_name, input, context, next_fn)
        # The policy of the command this call runs, and the one the `commands` option lists.
        if not await holds(command_name, input, context):
            return await next_fn()
        # No token, relayed approval or question can bind an input with no canonical form.
        if decided is None:
            return failure(not_canonical_error(command_name))
        # A policy function that changed the input would show the person one input and bind another.
        if changed():
            return failure(input_changed_error(command_name))
        summary = summary_of(command_name, input, context)

        now = security_clock.now()
        input_binding = decided
        actor = getattr(context, "actor", None)
        actor_binding = _actor_json(actor)

        rejected: ApprovalRejection | None = None
        exchange = _exchange(context)
        relay_ev = relay_evidence_of(context)
        if relay_ev is not None:
            # Relay evidence rule 2: when present, consider it and nothing else.
            # Rule 3 order: command -> input -> actor -> credentials, then spend once for 24h.
            from afd.server.principal import (
                IncompleteCredentials,
                credentials_binding,
                sdk_credentials,
            )

            digest = _b64url(hashlib.sha256(_utf8(input_binding)).digest())
            try:
                ctx_creds = getattr(context, "credentials", None)
                if ctx_creds is None and relay_ev.use_sdk_credentials:
                    ctx_creds = sdk_credentials()
                creds_binding: str | None = credentials_binding(ctx_creds)
            except IncompleteCredentials:
                creds_binding = None
            if not hmac.compare_digest(_utf8(relay_ev.command), _utf8(command_name)):
                rejected = "command-mismatch"
            elif not hmac.compare_digest(_utf8(relay_ev.input_digest), _utf8(digest)):
                rejected = "input-mismatch"
            elif not hmac.compare_digest(_utf8(relay_ev.actor), _utf8(actor_binding)):
                rejected = "actor-mismatch"
            elif creds_binding is None or not hmac.compare_digest(
                _utf8(relay_ev.credentials_binding), _utf8(creds_binding)
            ):
                rejected = "credentials-mismatch"
            elif (
                isinstance(relay_ev.decision_id, str)
                and len(relay_ev.decision_id) > 0
                and await spend_nonce(f"relay:{relay_ev.decision_id}", now + _MAX_TTL_MS, now)
            ):
                return await next_fn(input_binding)
            else:
                rejected = "already-used"
        else:
            evidence = (
                exchange.take() if exchange is not None else getattr(context, "approval", None)
            )
            if evidence is not None:
                verdict = verify(evidence, command_name, input_binding, actor_binding, now)
                if isinstance(verdict, _Accepted):
                    if await spend(verdict.nonce, verdict.expires_at, now):
                        return await next_fn(input_binding)
                    rejected = "already-used"
                else:
                    rejected = verdict

        host_verified = (
            getattr(command_for(command_name, context), "confirmation_mode", None)
            == "host-verified"
        )
        if relay_ev is None and not host_verified and relay_here is not None:
            bindings = relay_bindings(command_name, input_binding, actor_binding)
            answer = await relay_here.answer(bindings)
            if answer.kind == "decline":
                return failure(
                    CommandError(
                        code=ErrorCodes.APPROVAL_REQUIRED,
                        message=f"The user did not approve {command_name}",
                        suggestion=(
                            "Do not run this again without asking the user first; the user "
                            "chose not to approve it."
                        ),
                        retryable=False,
                        details={"summary": summary, "reason": "declined"},
                    )
                )
            if (
                answer.accepted is not None
                and genuine(answer.accepted, bindings, now)
                and await spend(answer.accepted.nonce, answer.accepted.expires_at, now)
            ):
                return await next_fn(input_binding)
            # An expired, spent or invalid approval is asked again, saying why.
            asked = question(bindings, now)
            relay_here.hold(
                StepsHold(
                    questions=(asked,),
                    message=relay_message(
                        summary,
                        command_name,
                        input_binding,
                        "The earlier approval expired or was already used; approve again to run it."
                        if answer.kind == "accept"
                        else None,
                    ),
                )
            )
            # The lane answers with the elicitation instead; this result is never sent.
            return failure(
                CommandError(
                    code=ErrorCodes.APPROVAL_REQUIRED,
                    message=f"{command_name} needs approval before it runs",
                    suggestion=f'Wait for the user to approve "{summary}" in the client.',
                    retryable=False,
                    details={"expiresAt": _iso_timestamp(asked.expires_at), "summary": summary},
                )
            )

        approval_token, expires_ms = sign(command_name, input_binding, actor_binding, now)
        expires_at = _iso_timestamp(expires_ms)
        # Checked again after the awaits since the first check (spending a token awaits a store),
        # before anyone is told of the call or a direct token is held.
        if changed():
            return failure(input_changed_error(command_name))

        if on_approval_required is not None:
            notified = on_approval_required(
                ApprovalRequest(
                    command=command_name,
                    input=input,
                    actor=Actor(
                        kind=actor.kind,
                        id=actor.id,
                        label=actor.label,
                        on_behalf_of=actor.on_behalf_of,
                    )
                    if isinstance(actor, Actor)
                    else None,
                    approval_token=approval_token,
                    expires_at=expires_at,
                    summary=summary,
                    rejected=rejected,
                )
            )
            if inspect.isawaitable(notified):
                await notified

        if exchange is not None:
            exchange.hold(
                approval_token=approval_token,
                expires_at=expires_at,
                summary=summary,
                reason=rejected,
            )
        on_mcp = (context.extra or {}).get("interface") == "mcp"
        # Rule 6: omit details.approvalToken on MCP by default unless the server opted in.
        public_token = exchange is None and (not on_mcp if include_token is None else include_token)
        why = (
            (
                f"The relay approval was not accepted ({rejected}). "
                if relay_ev is not None
                else f"The approval token was not accepted ({rejected}). "
            )
            if rejected
            else ""
        )
        # Addressed to whoever relays the decision: the token is the approval, so the gated
        # caller must not resubmit it on its own, and tool arguments cannot carry it.
        if public_token:
            retry = (
                "once they approve, the application retries the same call with the same input "
                "and details.approvalToken as its approval evidence (tool arguments cannot carry "
                f"it). The token expires at {expires_at}{' and works once' if single_use else ''}."
            )
        elif bound is not None and relay_ev is None and not host_verified:
            retry = (
                "the client could not be asked from inside afd-batch, afd-pipe or another "
                f"command. Call {command_name} on its own so the client can ask the user."
            )
        elif relays and on_mcp and relay_ev is None and not host_verified:
            retry = (
                f"the client could not be asked here. Call {command_name} from an MCP client "
                "that supports form elicitation, or the application records the approval and "
                "retries."
            )
        else:
            retry = "the application retries the same call once it has recorded the approval."
        details: dict[str, Any] = {}
        if public_token:
            details["approvalToken"] = approval_token
        details["expiresAt"] = expires_at
        details["summary"] = summary
        if rejected:
            details["reason"] = rejected
        return failure(
            CommandError(
                code=ErrorCodes.APPROVAL_REQUIRED,
                message=f"{command_name} needs approval before it runs",
                suggestion=f'{why}Ask the user to approve "{summary}"; {retry}',
                retryable=False,
                details=details,
            )
        )

    mark_approval_process_state(
        approval_middleware,
        ApprovalProcessState(
            relay=relays,
            per_process_nonces=single_use and nonce_store is None,
        ),
    )
    return approval_middleware


@dataclass(frozen=True)
class _UpFrontDeps:
    """What the up-front gate of an ``afd-batch`` or ``afd-pipe`` needs from one approval
    middleware (``afd.server.approval_relay.UpFrontDeps``)."""

    now: Callable[[], float]
    requires: Callable[[str, Any, CommandContext], Awaitable[bool]]
    may_require: Callable[[str, CommandContext], bool]
    keys: Sequence[bytes]
    genuine: Callable[[AcceptedApproval, Sequence[str], float], bool]
    spend: Callable[[str, float, float], Awaitable[bool]]
    question: Callable[[Sequence[str], float], ApprovalQuestion]
    summarize: Callable[[str, Any, CommandContext], str]

    async def requires_approval(self, command: str, input: Any, context: CommandContext) -> bool:
        return await self.requires(command, input, context)

    def may_require_approval(self, command: str, context: CommandContext) -> bool:
        return self.may_require(command, context)

    def binding_input(self, input: Any) -> str:
        # Raises for an input with no canonical form: such a step cannot be approved.
        return _canonical_json(_plain_input(input))

    def actor_binding(self, context: CommandContext) -> str:
        return _actor_json(getattr(context, "actor", None))

    def bindings(self, tags: Sequence[str], command: str, input: str, actor: str) -> list[str]:
        """One per key, the signing key's first: a keyed digest of the call (its tag under that
        key), the command, its input and the actor."""
        return [
            _b64url(_hmac(key, "relay-step\0" + _canonical_json([tags[at], command, input, actor])))
            for at, key in enumerate(self.keys)
        ]

    def call_tags(self, call: str) -> list[str]:
        return [_b64url(_hmac(key, f"relay-call\0{call}")) for key in self.keys]


async def _requires_approval(policy: Any, input: Any, context: CommandContext) -> bool:
    if policy is None or policy == "not-required":
        return False
    # Fail closed: "required" or anything that is not a function holds the call.
    if not callable(policy):
        return True
    decision = policy(input, context)
    if inspect.isawaitable(decision):
        decision = await decision
    # Fail closed: anything but an explicit "not-required" holds the call.
    return bool(decision != "not-required")


def _as_command(command: Any) -> Any:
    """A command definition from a definition or a ``define_command``-decorated function."""
    if isinstance(command, CommandDefinition):
        return command
    if hasattr(command, "__afd_command__"):
        from afd.server.decorators import command_to_definition

        definition = command_to_definition(command)
        if definition is not None:
            return definition
    if isinstance(getattr(command, "name", None), str):
        return command
    raise TypeError(
        "Approval commands must be CommandDefinition objects or define_command-decorated functions"
    )


def _plain_input(value: Any) -> Any:
    """The validated input as plain JSON values. A Pydantic model is dumped in JSON mode
    with its aliases, keeping explicit ``None`` values (as the command journal does).

    A dump can lose information, so a model that could make two inputs share a digest
    fails the call instead (rule 3): a secret field (dumped as asterisks), an excluded
    field, a custom serializer, a non-finite float (dumped as ``null``) or a set (dumped
    in hash order).

    Raises:
        TypeError: For a model whose dump is not a faithful binding.
    """
    if isinstance(value, BaseModel):
        _check_bindable(value)
        return value.model_dump(mode="json", by_alias=True)
    return value


_UNVERIFIED = object()
"""Passed to nothing: a call the approval middleware let through without approval."""


def _canonical_or_none(value: Any) -> str | None:
    """The canonical JSON of a validated input, or ``None`` when it has none (an approval
    admission then compares the input by identity)."""
    try:
        return _canonical_json(_plain_input(value))
    except (TypeError, ValueError, RecursionError):
        return None


def _check_bindable(value: Any) -> None:
    if isinstance(value, BaseModel):
        model = type(value)
        decorators = model.__pydantic_decorators__
        if decorators.field_serializers or decorators.model_serializers:
            raise TypeError(
                f"Cannot bind an approval to {model.__name__}: it has a custom serializer"
            )
        seen_output_keys: set[str] = set()
        for name, info in model.model_fields.items():
            if info.exclude or getattr(info, "exclude_if", None) is not None:
                raise TypeError(
                    f"Cannot bind an approval to {model.__name__}: field '{name}' is excluded "
                    "from its dump"
                )
            if any(isinstance(item, (PlainSerializer, WrapSerializer)) for item in info.metadata):
                raise TypeError(
                    f"Cannot bind an approval to {model.__name__}: field '{name}' has a "
                    "custom serializer"
                )
            out_key = (
                info.serialization_alias
                if isinstance(info.serialization_alias, str)
                else (info.alias if isinstance(info.alias, str) else name)
            )
            if out_key in seen_output_keys:
                raise TypeError(
                    f"Cannot bind an approval to {model.__name__}: serialization key '{out_key}' "
                    "collides with another field"
                )
            seen_output_keys.add(out_key)
            _check_bindable(getattr(value, name))
        for extra_key, item in (value.__pydantic_extra__ or {}).items():
            if extra_key in seen_output_keys:
                raise TypeError(
                    f"Cannot bind an approval to {model.__name__}: extra field '{extra_key}' "
                    "collides with a model field"
                )
            seen_output_keys.add(extra_key)
            _check_bindable(item)
    elif isinstance(value, (SecretStr, SecretBytes)):
        raise TypeError("Cannot bind an approval to a secret field")
    elif isinstance(value, (set, frozenset)):
        raise TypeError("Cannot bind an approval to a set: its dump order is not stable")
    elif isinstance(value, float) and not math.isfinite(value):
        raise TypeError("Cannot bind an approval to a non-finite number")
    elif isinstance(value, dict):
        for item in value.values():
            _check_bindable(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _check_bindable(item)


def _canonical_json(value: Any) -> str:
    """Stable JSON for binding a token to an input: object keys sorted at every depth (in
    UTF-16 code-unit order, as JavaScript sorts them), otherwise as ``JSON.stringify``
    writes it.

    It fails closed rather than collide: only dicts with string keys, lists, tuples,
    strings, finite numbers (integers only when a JavaScript number holds them exactly),
    booleans and ``None`` are accepted. Anything else, or a cycle, raises, so a call whose validated
    input holds one cannot be approved.

    Raises:
        TypeError: For a value it cannot encode without ambiguity.
    """
    ancestors: set[int] = set()

    def encode(item: Any) -> str:
        if item is None:
            return "null"
        if item is True:
            return "true"
        if item is False:
            return "false"
        if isinstance(item, str):
            return _js_string(item)
        if isinstance(item, int):
            # Past 2**53 JavaScript holds a double: bind the integers a double represents
            # exactly, as TypeScript would, and refuse the rest (neighbours would collide).
            if abs(item) > _MAX_SAFE_INTEGER and (abs(item) >= 2**1024 or int(float(item)) != item):
                raise TypeError(
                    "Cannot bind an approval to an integer a JavaScript number cannot hold exactly"
                )
            return _js_number(item)
        if isinstance(item, float):
            if not math.isfinite(item):
                raise TypeError("Cannot bind an approval to a non-finite number")
            return _js_number(item)
        if isinstance(item, (dict, list, tuple)):
            marker = id(item)
            if marker in ancestors:
                raise TypeError("Cannot bind an approval to a cyclic input")
            ancestors.add(marker)
            try:
                if isinstance(item, dict):
                    if not all(isinstance(key, str) for key in item):
                        raise TypeError("Cannot bind an approval to an object with non-string keys")
                    members = sorted(item.items(), key=lambda member: _utf16_key(member[0]))
                    return (
                        "{"
                        + ",".join(f"{_js_string(key)}:{encode(member)}" for key, member in members)
                        + "}"
                    )
                return "[" + ",".join(encode(member) for member in item) + "]"
            finally:
                ancestors.discard(marker)
        raise TypeError(f"Cannot bind an approval to a {type(item).__name__}: use plain JSON input")

    return encode(value)


def _utf16_key(key: str) -> bytes:
    return key.encode("utf-16-be", "surrogatepass")


def _actor_json(actor: Any) -> str:
    """The actor fields a token is bound to. ``label`` is display text, so it is left out;
    an unset field is left out, as TypeScript drops ``undefined`` members."""
    if actor is None:
        return "null"
    fields = {
        "kind": getattr(actor, "kind", None),
        "id": getattr(actor, "id", None),
        "onBehalfOf": getattr(actor, "on_behalf_of", None),
    }
    return _canonical_json({name: value for name, value in fields.items() if value is not None})


def _to_keys(secret: Any) -> list[bytes]:
    candidates = list(secret) if isinstance(secret, (list, tuple)) else [secret]
    if not candidates:
        raise TypeError("Approval secret is required")
    keys: list[bytes] = []
    for candidate in candidates:
        if isinstance(candidate, str):
            key = candidate.encode("utf-8")
        elif isinstance(candidate, (bytes, bytearray, memoryview)):
            key = bytes(candidate)
        else:
            raise TypeError("Approval secret is required: pass a string or bytes")
        if len(key) < _MIN_SECRET_BYTES:
            raise ValueError(f"Approval secret must be at least {_MIN_SECRET_BYTES} bytes")
        keys.append(key)
    return keys


def _utf8(text: str) -> bytes:
    # Lone surrogates as JavaScript's Buffer.from writes them (U+FFFD), never an exception.
    return text.encode("utf-16", "surrogatepass").decode("utf-16", "replace").encode("utf-8")


def _hmac(key: bytes, data: str) -> bytes:
    return hmac.new(key, _utf8(data), hashlib.sha256).digest()


def _digest(key: bytes, purpose: Literal["input", "actor"], value: str) -> bytes:
    """A keyed digest; ``purpose`` keeps an input digest from ever matching an actor digest."""
    return _hmac(key, f"{purpose}\0{value}")


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _reject_constant(name: str) -> Any:
    raise ValueError(f"Not JSON: {name}")


def _parse_payload(encoded: str) -> dict[str, Any] | None:
    try:
        raw = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        value = json.loads(raw.decode("utf-8"), parse_constant=_reject_constant)
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(value, dict):
        return None
    strings = all(isinstance(value.get(name), str) for name in ("c", "i", "a", "n"))
    times = all(
        isinstance(value.get(name), (int, float))
        and not isinstance(value.get(name), bool)
        and math.isfinite(value[name])
        for name in ("iat", "exp")
    )
    return value if strings and times else None


def _iso_timestamp(ms: float) -> str:
    """Epoch milliseconds as JavaScript's ``Date.toISOString()`` writes them."""
    moment = datetime(1970, 1, 1, tzinfo=UTC) + timedelta(milliseconds=math.trunc(ms))
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


class _MemoryNonceStore:
    """In-memory single-use nonces, forgotten once their token has expired."""

    def __init__(self) -> None:
        self._used: dict[str, float] = {}

    def consume(self, nonce: str, expires_at: float, now: float) -> bool:
        for spent, until in list(self._used.items()):
            if until <= now:
                del self._used[spent]
        if nonce in self._used:
            return False
        self._used[nonce] = expires_at
        return True
