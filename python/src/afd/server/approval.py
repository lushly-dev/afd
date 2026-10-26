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
"""

import base64
import hashlib
import hmac
import inspect
import json
import math
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import (
    Any,
    Awaitable,
    Callable,
    Iterable,
    Literal,
    Optional,
    Protocol,
    Sequence,
    Union,
    runtime_checkable,
)

from pydantic import BaseModel

from afd.core.actor import Actor
from afd.core.approval import ApprovalPolicy
from afd.core.clock import Clock, system_clock
from afd.core.commands import CommandContext, CommandDefinition, CommandMiddleware, NextFn
from afd.core.errors import ErrorCodes
from afd.core.journal import _js_number, _js_string
from afd.core.result import CommandError, CommandResult, failure

__all__ = [
    "ApprovalCommand",
    "ApprovalNonceStore",
    "ApprovalRejection",
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
# JavaScript numbers are doubles: a larger integer could share a digest with its neighbour.
_MAX_SAFE_INTEGER = 2**53 - 1

ApprovalSecret = Union[str, bytes, bytearray, memoryview]
"""An HMAC key: a string (UTF-8) or raw bytes, at least 32 bytes long."""

ApprovalRejection = Literal[
    "malformed",
    "invalid-signature",
    "expired",
    "command-mismatch",
    "input-mismatch",
    "actor-mismatch",
    "already-used",
]
"""Why a supplied approval token was not accepted."""


@runtime_checkable
class ApprovalCommand(Protocol):
    """What the middleware reads from a command: its name, approval policy and confirmation
    prompt. A :class:`~afd.core.commands.CommandDefinition` is one."""

    name: str
    approval: Optional[ApprovalPolicy]
    confirm_prompt: Optional[str]


class ApprovalNonceStore(Protocol):
    """Records which single-use tokens have been spent.

    The default keeps them in memory, which holds only within one process: give
    servers that run several instances a shared store.
    """

    def consume(self, nonce: str, expires_at: float) -> Union[bool, Awaitable[bool]]:
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
    actor: Optional[Actor]
    approval_token: str
    expires_at: str
    summary: str
    rejected: Optional[ApprovalRejection] = None


@dataclass(frozen=True)
class _Accepted:
    nonce: str
    expires_at: float


def create_approval_middleware(
    *,
    secret: Union[ApprovalSecret, Sequence[ApprovalSecret]],
    commands: Iterable[Any],
    ttl_ms: float = _DEFAULT_TTL_MS,
    replay: Literal["single-use", "within-ttl"] = "single-use",
    nonce_store: Optional[ApprovalNonceStore] = None,
    summarize: Optional[Callable[[str, Any, CommandContext], Optional[str]]] = None,
    include_token: bool = True,
    on_approval_required: Optional[
        Callable[[ApprovalRequest], Union[None, Awaitable[None]]]
    ] = None,
    clock: Optional[Clock] = None,
) -> CommandMiddleware:
    """A middleware that runs a command whose ``approval`` policy requires approval only
    when ``context.approval`` holds a valid token for this command, input and actor.
    Otherwise it returns ``APPROVAL_REQUIRED`` with a fresh token, and the handler does
    not run.

    Install it after any middleware that sets or refines ``context.actor`` (such as
    auth), since tokens are bound to the actor. ``context.approval`` must only ever be
    set by trusted surface code once a human approved, never from tool arguments:
    whoever holds a token can use it.

    Args:
        secret: The HMAC key, or several during a key rotation: the first signs, any
            of them verifies. Required, with no default; each key must be at least 32
            bytes. Keep it out of source.
        commands: The commands to gate: :class:`CommandDefinition` objects or functions
            decorated with ``define_command``. A command that is not in this list is
            never held, whatever its ``approval`` policy says.
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
            ``details.approvalToken``. Default ``True``, which is safe only while the
            gated caller cannot set ``context.approval`` itself (true of MCP tool calls,
            whose arguments never reach the context). Set ``False`` when the caller must
            not hold the token, and deliver it through ``on_approval_required``.
        on_approval_required: Called (sync or async) for every held call, before the
            result is returned, for example to notify a human.
        clock: Source of time for issuing and expiring tokens and for forgetting spent
            nonces. Default: ``system_clock``. ``context.clock`` is never used: a caller
            can set it, and this is security time.

    Raises:
        TypeError: When no secret is given, a secret is not a string or bytes, or a
            command declares an approval policy that is not valid.
        ValueError: When a secret is shorter than 32 bytes, or ``ttl_ms`` is not a
            positive number of milliseconds of at most 24 hours.

    Example:
        >>> commands = [todo_delete, todo_list]  # decorated with define_command
        >>> server = create_server(
        ...     "todo",
        ...     middleware=[
        ...         create_approval_middleware(
        ...             secret=os.environ["AFD_APPROVAL_SECRET"], commands=commands
        ...         )
        ...     ],
        ... )
        >>> for command in commands:
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
        raise ValueError("Approval ttl_ms must be a positive number of milliseconds, at most 24 hours")
    if replay not in ("single-use", "within-ttl"):
        raise ValueError("Approval replay must be 'single-use' or 'within-ttl'")
    security_clock = clock or system_clock
    single_use = replay == "single-use"
    memory_store = None if nonce_store is not None else _MemoryNonceStore()

    gated: dict[str, Any] = {}
    for command in commands:
        definition = _as_command(command)
        policy = getattr(definition, "approval", None)
        if policy is not None and policy not in ("required", "not-required") and not callable(policy):
            raise TypeError(
                f"Command '{definition.name}' has an invalid approval policy: "
                "use 'required', 'not-required' or a function"
            )
        gated[definition.name] = definition

    def verify(
        evidence: Any, command_name: str, input_binding: str, actor_binding: str, now: float
    ) -> Union[_Accepted, ApprovalRejection]:
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
        if not hmac.compare_digest(
            _utf8(payload["i"]), _b64url(_digest(key, "input", input_binding)).encode()
        ):
            return "input-mismatch"
        if not hmac.compare_digest(
            _utf8(payload["a"]), _b64url(_digest(key, "actor", actor_binding)).encode()
        ):
            return "actor-mismatch"
        return _Accepted(nonce=payload["n"], expires_at=payload["exp"])

    def sign(command_name: str, input_binding: str, actor_binding: str, now: float) -> tuple[str, float]:
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

    async def approval_middleware(
        command_name: str, input: Any, context: CommandContext, next_fn: NextFn
    ) -> CommandResult[Any]:
        command = gated.get(command_name)
        if not await _requires_approval(command, input, context):
            return await next_fn()

        now = security_clock.now()
        input_binding = _canonical_json(_plain_input(input))
        actor = getattr(context, "actor", None)
        actor_binding = _actor_json(actor)

        rejected: Optional[ApprovalRejection] = None
        evidence = getattr(context, "approval", None)
        if evidence is not None:
            verdict = verify(evidence, command_name, input_binding, actor_binding, now)
            if isinstance(verdict, _Accepted):
                if not single_use:
                    return await next_fn()
                if memory_store is not None:
                    fresh = memory_store.consume(verdict.nonce, verdict.expires_at, now)
                else:
                    assert nonce_store is not None
                    outcome = nonce_store.consume(verdict.nonce, verdict.expires_at)
                    if inspect.isawaitable(outcome):
                        outcome = await outcome
                    # Only an explicit True from the store counts as fresh.
                    fresh = outcome is True
                if fresh:
                    return await next_fn()
                rejected = "already-used"
            else:
                rejected = verdict

        approval_token, expires_ms = sign(command_name, input_binding, actor_binding, now)
        expires_at = _iso_timestamp(expires_ms)
        summary = (
            (summarize(command_name, input, context) if summarize is not None else None)
            or getattr(command, "confirm_prompt", None)
            or f"Run {command_name}"
        )

        if on_approval_required is not None:
            notified = on_approval_required(
                ApprovalRequest(
                    command=command_name,
                    input=input,
                    actor=Actor(
                        kind=actor.kind, id=actor.id, label=actor.label, on_behalf_of=actor.on_behalf_of
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

        why = f"The approval token was not accepted ({rejected}). " if rejected else ""
        # Addressed to whoever relays the decision: the token is the approval, so the gated
        # caller must not resubmit it on its own, and tool arguments cannot carry it.
        retry = (
            "once they approve, the application retries the same call with the same input and "
            "details.approvalToken as its approval evidence (tool arguments cannot carry it). "
            f"The token expires at {expires_at}{' and works once' if single_use else ''}."
            if include_token
            else "the application retries the same call once it has recorded the approval."
        )
        details: dict[str, Any] = {}
        if include_token:
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

    return approval_middleware


async def _requires_approval(command: Any, input: Any, context: CommandContext) -> bool:
    policy = getattr(command, "approval", None)
    if policy is None or policy == "not-required":
        return False
    if policy == "required":
        return True
    decision = policy(input, context)
    if inspect.isawaitable(decision):
        decision = await decision
    # Fail closed: anything but an explicit "not-required" holds the call.
    return decision != "not-required"


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
    with its aliases, keeping explicit ``None`` values (as the command journal does)."""
    if isinstance(value, BaseModel):
        # JSON mode writes inf and NaN as null: refuse them rather than collide with None.
        _reject_non_finite(value.model_dump(by_alias=True))
        return value.model_dump(mode="json", by_alias=True)
    return value


def _reject_non_finite(value: Any) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise TypeError("Cannot bind an approval to a non-finite number")
    if isinstance(value, dict):
        value = value.values()
    if isinstance(value, (list, tuple, set, frozenset, type({}.values()))):
        for item in value:
            _reject_non_finite(item)


def _canonical_json(value: Any) -> str:
    """Stable JSON for binding a token to an input: object keys sorted at every depth (in
    UTF-16 code-unit order, as JavaScript sorts them), otherwise as ``JSON.stringify``
    writes it.

    It fails closed rather than collide: only dicts with string keys, lists, tuples,
    strings, finite numbers (integers within JavaScript's safe range), booleans and
    ``None`` are accepted. Anything else, or a cycle, raises, so a call whose validated
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
            if abs(item) > _MAX_SAFE_INTEGER:
                raise TypeError("Cannot bind an approval to an integer outside JavaScript's safe range")
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
                    return "{" + ",".join(f"{_js_string(key)}:{encode(member)}" for key, member in members) + "}"
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


def _parse_payload(encoded: str) -> Optional[dict[str, Any]]:
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
    moment = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(milliseconds=math.trunc(ms))
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
