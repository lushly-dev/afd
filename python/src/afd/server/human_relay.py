"""Host-verified confirmation (``spec/command-metadata.md``, "Host-verified confirmation" and
"Relay evidence"): the :class:`HumanRelay` a host installs with ``create_server(human_relay=...)``,
:func:`input_digest`, and the gate that enforces it on every MCP surface regardless of
``confirmations``.
"""

from __future__ import annotations

import base64
import copy
import hashlib
import inspect
import ipaddress
import json
import logging
import re
from collections.abc import Awaitable, Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, runtime_checkable
from urllib.parse import urlsplit

from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

from afd.core.actor import Actor
from afd.core.clock import Clock, system_clock
from afd.core.commands import CommandContext, CommandDefinition
from afd.core.errors import CommandError, ErrorCodes, Recovery
from afd.core.schema_validation import DEFAULT_MAX_VALIDATION_ISSUES, SchemaValidationError
from afd.server.approval import _actor_json, _b64url, _canonical_json, _plain_input, _utf8
from afd.server.auth_rules import Credentials
from afd.server.auth_view import scope_view_of
from afd.server.confirmations import ConfirmationStep
from afd.server.context_fields import (
    _RESERVED_NAMES,
    JOURNALED_CONTEXT_FIELDS,
    ContextField,
    apply_context_fields,
)
from afd.server.decorators import get_command_metadata, validate_command_input
from afd.server.principal import (
    IncompleteCredentials,
    PrincipalCredentials,
    credentials_binding,
    principal_binding,
    sdk_credentials,
)
from afd.server.relay_evidence import (
    RelayEvidence,
    attach_relay_context_validated,
    attach_relay_dispatch_admission,
    attach_relay_evidence,
    attach_relay_validated_input,
)
from afd.server.session_context import is_modern_protocol
from afd.server.validation import _input_validation_failure

logger = logging.getLogger("afd.server")

RELAY_INPUT_KEY = "relay"
"""The ``inputRequests`` key of the URL-mode elicitation a :class:`HumanRelay` prompt becomes."""

_MAX_PENDING_INPUTS = 4096
_MAX_PENDING_INPUT_CHARS = 32_768
_PENDING_INPUT_TTL_MS = 24 * 60 * 60_000

_HOST_LABEL_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\Z")
_PORT_RE = re.compile(r"^[0-9]{1,5}\Z")
_DECISION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}\Z")
_IPV6_ALLOWED = frozenset("0123456789abcdefABCDEF:.")


def is_decision_id(value: Any) -> bool:
    """Whether ``value`` is a valid relay decision id: 1 to 128 ASCII letters, digits, ``_`` and
    ``-`` (``spec/command-metadata.md``, "Host-verified confirmation")."""
    return isinstance(value, str) and _DECISION_ID_RE.match(value) is not None


def _is_valid_port(port: str) -> bool:
    if _PORT_RE.match(port) is None:
        return False
    num = int(port)
    return 1 <= num <= 65_535


_RESERVED_APPROVED_KEYS = _RESERVED_NAMES | frozenset(
    {
        "cancel",
        "report_progress",
        "reportProgress",
        "_direct_allow",
        "_scope_view",
        "_server_signal",
        "_server_signal_fields",
        JOURNALED_CONTEXT_FIELDS,
    }
)


def input_digest(value: Any) -> str:
    """Compute the relay input digest (``spec/command-metadata.md``, "Host-verified confirmation",
    step 2): unpadded base64url SHA-256 of the canonical JSON (``spec/command-metadata.md``,
    "Approvals", rule 3) of ``value``. ``spec/authorization.json`` (``inputDigests``) pins it.

    Raises:
        TypeError: When ``value`` has no exact canonical JSON form.
    """
    canonical = _canonical_json(_plain_input(value))
    return _b64url(hashlib.sha256(_utf8(canonical)).digest())


def _canonical_or_none(value: Any) -> str | None:
    try:
        return _canonical_json(_plain_input(value))
    except (TypeError, ValueError, RecursionError):
        return None


def _sha256_b64url(text: str) -> str:
    return (
        base64.urlsafe_b64encode(hashlib.sha256(_utf8(text)).digest()).rstrip(b"=").decode("ascii")
    )


def _url_elicitation_id(url: str) -> str:
    """Deterministic elicitation ID for a relay URL: unpadded base64url SHA-256 of ``url``."""
    return (
        base64.urlsafe_b64encode(hashlib.sha256(url.encode("utf-8")).digest())
        .rstrip(b"=")
        .decode("ascii")
    )


def allows_url_elicitation(capabilities: Any) -> bool:
    """Whether declared client capabilities include URL-mode elicitation (``elicitation.url``).

    ``elicitation: {}`` (form only) and ``elicitation: {"form": {}}`` return ``False``.
    """
    if capabilities is None:
        return False
    if isinstance(capabilities, Mapping):
        elicitation = capabilities.get("elicitation")
        if not isinstance(elicitation, Mapping):
            return False
        url_cap = elicitation.get("url")
        return isinstance(url_cap, Mapping)
    elicitation = getattr(capabilities, "elicitation", None)
    if elicitation is None:
        return False
    if isinstance(elicitation, Mapping):
        return isinstance(elicitation.get("url"), Mapping)
    url_cap = getattr(elicitation, "url", None)
    return url_cap is not None and url_cap is not False


def is_relay_url(url: Any) -> bool:
    """Whether ``url`` is an absolute ``https`` URL with a valid host (DNS labels of ASCII
    letters, digits and ``-``, or a bracketed IPv6 address), an optional port from 1 to 65535, no
    user information, and no whitespace, control character, or unpaired surrogate."""
    if not isinstance(url, str) or len(url) <= 8:
        return False
    if not url[:8].lower().startswith("https://"):
        return False
    try:
        url.encode("utf-8")
    except UnicodeEncodeError:
        return False
    for ch in url:
        code = ord(ch)
        if code <= 0x20 or (0x7F <= code <= 0x9F) or ch.isspace():
            return False
    if "\\" in url:
        return False
    rest = url[8:]
    cut = len(rest)
    for sep in ("/", "?", "#"):
        idx = rest.find(sep)
        if idx != -1 and idx < cut:
            cut = idx
    authority = rest[:cut]
    if not authority or "@" in authority:
        return False
    if authority.startswith("["):
        bracket_end = authority.find("]")
        if bracket_end == -1:
            return False
        addr = authority[1:bracket_end]
        after = authority[bracket_end + 1 :]
        if after and not (after.startswith(":") and _is_valid_port(after[1:])):
            return False
        if not addr or ":" not in addr or not all(ch in _IPV6_ALLOWED for ch in addr):
            return False
        try:
            ipaddress.IPv6Address(addr)
        except ValueError:
            return False
    else:
        if "[" in authority or "]" in authority:
            return False
        if ":" in authority:
            host, port = authority.split(":", 1)
            if not _is_valid_port(port):
                return False
        else:
            host = authority
        if not host or len(host) > 253:
            return False
        labels = host.split(".")
        if not all(_HOST_LABEL_RE.match(label) is not None for label in labels):
            return False
    try:
        parsed = urlsplit(url)
        _ = parsed.port
    except ValueError:
        return False
    return (
        parsed.scheme.lower() == "https"
        and bool(parsed.hostname)
        and parsed.username is None
        and parsed.password is None
    )


def _capabilities_to_dict(capabilities: Any) -> dict[str, Any] | None:
    if capabilities is None:
        return None
    if isinstance(capabilities, BaseModel):
        return capabilities.model_dump(by_alias=True, exclude_none=True)
    if isinstance(capabilities, Mapping):
        return copy.deepcopy(dict(capabilities))
    return None


@dataclass(frozen=True)
class RelayPrompt:
    """What the person is asked to open, and the state that names the pending decision.

    Attributes:
        url: An absolute ``https`` URL holding no identity and not pre-authenticated.
        message: The elicitation's message: ids, never content.
        state: The ``requestState``: integrity-protected by the relay (expires within 24 hours).
    """

    url: str
    message: str
    state: str


@dataclass(frozen=True)
class RelayApproved:
    """The person approved the pending decision."""

    decision_id: str
    kind: Literal["approved"] = "approved"


@dataclass(frozen=True)
class RelayDeclined:
    """The person declined the pending decision."""

    kind: Literal["declined"] = "declined"


@dataclass(frozen=True)
class RelayPending:
    """The pending decision has not been answered yet; ask again with ``prompt``."""

    prompt: RelayPrompt
    kind: Literal["pending"] = "pending"


@dataclass(frozen=True)
class RelayInvalid:
    """The supplied ``state`` did not verify, expired, or named another command, input or principal."""

    kind: Literal["invalid"] = "invalid"


@dataclass(frozen=True)
class RelayPendingDecision:
    """A pending decision's address, for a client without URL-mode elicitation.

    Attributes:
        decision: The decision's id: 1 to 128 ASCII letters, digits, ``_`` and ``-``.
        url: The decision's page: an absolute ``https`` URL with no identity.
        list: The page listing the person's pending decisions, the same kind of URL.
    """

    decision: str
    url: str
    list: str
    kind: Literal["pending"] = "pending"


RelayBeginResult = RelayPrompt | CommandError
"""Result of :meth:`HumanRelay.begin`: a prompt to send, or a refusal error."""

RelayOutcome = RelayApproved | RelayDeclined | RelayPending | RelayInvalid
"""What :meth:`HumanRelay.resume` found for the pending decision."""

PendingListOutcome = RelayApproved | RelayDeclined | RelayPendingDecision | CommandError
"""What ``HumanRelay.pending_list`` found for a call from a client without URL-mode elicitation."""


@dataclass(frozen=True)
class RelayCall:
    """One call a :class:`HumanRelay` is asked about."""

    command: str
    """The command's name."""
    input_digest: str
    """:func:`input_digest` of the validated input (defaults applied): what the person decides on."""
    actor: Actor | None
    """The actor the command runs with (after ``context_hook`` and verified credentials)."""
    credentials: Credentials | PrincipalCredentials | None
    """The call's verified credentials, on an authorized server (or SDK token)."""
    client_capabilities: dict[str, Any] | None
    """The client capabilities declared on the request."""
    input: Any
    """The validated input that :attr:`input_digest` names, so the host can show it to the person."""
    context: CommandContext
    """The context the command would run with: after ``context_hook`` and declared context fields,
    with verified credentials and actor. Relay evidence is never on it."""
    _principal_binding: str = field(repr=False, compare=False)

    def principal_binding(self) -> str:
        """The call's principal binding (``spec/authorization.md``, M8), which the relay's state
        must bind."""
        return self._principal_binding

    def supports_url_elicitation(self) -> bool:
        """Whether the client declared URL-mode elicitation, without which the server never sends
        the relay's prompt."""
        return allows_url_elicitation(self.client_capabilities)


@runtime_checkable
class HumanRelay(Protocol):
    """The host's way to prove that a person decided a call to a host-verified command
    (``spec/command-metadata.md``, "Host-verified confirmation").

    A relay guarantees:

    - Its ``state`` is integrity-protected, expires within 24 hours, and binds the decision, the
      command, ``input_digest`` and ``call.principal_binding()`` (M8). ``resume`` returns
      :class:`RelayInvalid` for a state that does not verify, has expired, or names another
      command, input or principal.
    - :class:`RelayApproved` is returned at most once per decision, atomically, with a
      ``decision_id`` of 1 to 128 ASCII letters, digits, ``_`` and ``-``, and only for a decision
      the person made after ``begin``.
    - Its ``url`` (and ``list`` in ``pending_list``) is an absolute ``https`` URL with a valid
      ASCII DNS host or bracketed IPv6 address, optional port 1–65535, holding no identity and not
      pre-authenticated.

    A relay may also define two optional methods (sync or async):

    - ``approved_context(decision_id, call)`` returning a mapping of host-owned context fields
      merged into ``context.extra`` before middleware and the handler run (replacing any
      request-supplied field of the same name, never reserved AFD keys).
    - ``pending_list(call)`` returning :data:`PendingListOutcome` or ``None`` for a call from a
      client without URL-mode elicitation (``spec/command-metadata.md``, "The pending list").
      ``None`` (the default when omitted) keeps the default refusal; :class:`RelayPendingDecision`
      fails with a retryable ``CONFIRMATION_REQUIRED`` naming the decision, its page and the list,
      and :class:`RelayApproved` runs the command with relay evidence and ``approved_context``.
    """

    def begin(self, call: RelayCall) -> RelayBeginResult | Awaitable[RelayBeginResult]:
        """Start a decision for ``call``, or refuse it with a :class:`~afd.CommandError`."""
        ...

    def resume(self, state: str, call: RelayCall) -> RelayOutcome | Awaitable[RelayOutcome]:
        """Check what became of the decision ``state`` names for ``call``."""
        ...


# ── Per-request channel & wire box (internal) ───────────────────────────────────────────


@dataclass
class RelayWireBox:
    """Internal carrier bridging ``pre_boundary`` (outside the SDK's ``RequestStateBoundary``)
    and :class:`HumanRelayGate` so relay ``requestState`` passes verbatim and ``elicitationId``
    survives the SDK's 2026-07-28 wire sieve."""

    inbound_state: str | None = None
    outbound_state: str | None = None
    outbound_elicitation_id: str | None = None
    outbound_url: str | None = None


_RELAY_WIRE: ContextVar[RelayWireBox | None] = ContextVar("afd_human_relay_wire", default=None)


@contextmanager
def bind_relay_wire(box: RelayWireBox | None) -> Iterator[None]:
    token = _RELAY_WIRE.set(box)
    try:
        yield
    finally:
        _RELAY_WIRE.reset(token)


def current_relay_wire() -> RelayWireBox | None:
    return _RELAY_WIRE.get()


@dataclass(frozen=True)
class HumanRelayChannel:
    """What an MCP request carries for host-verified confirmation."""

    modern: bool
    client_capabilities: dict[str, Any] | None = None
    request_state: str | None = None
    relay_action: Literal["accept", "decline", "cancel"] | None = None

    @classmethod
    def from_sdk(cls, ctx: Any, request: Any) -> HumanRelayChannel:
        modern = is_modern_protocol(getattr(ctx, "protocol_version", None))
        caps = _capabilities_to_dict(getattr(ctx, "client_capabilities", None))
        if caps is None and request is not None:
            meta = getattr(request, "meta", None)
            if isinstance(meta, Mapping):
                caps = _capabilities_to_dict(meta.get("io.modelcontextprotocol/clientCapabilities"))
        wire = _RELAY_WIRE.get()
        if wire is not None:
            raw_state = wire.inbound_state
        else:
            candidate = getattr(ctx, "request_state", None)
            raw_state = candidate if isinstance(candidate, str) else None
        responses = getattr(ctx, "input_responses", None)
        relay_action: Literal["accept", "decline", "cancel"] | None = None
        if isinstance(responses, Mapping) and RELAY_INPUT_KEY in responses:
            entry = responses[RELAY_INPUT_KEY]
            raw_action = (
                entry.get("action")
                if isinstance(entry, Mapping)
                else getattr(entry, "action", None)
            )
            if raw_action in ("accept", "decline", "cancel"):
                relay_action = raw_action
        return cls(
            modern=modern,
            client_capabilities=caps,
            request_state=raw_state,
            relay_action=relay_action,
        )


_RELAY_CHANNEL: ContextVar[HumanRelayChannel | None] = ContextVar(
    "afd_human_relay_channel", default=None
)


@contextmanager
def bind_human_relay_channel(channel: HumanRelayChannel | None) -> Iterator[None]:
    token = _RELAY_CHANNEL.set(channel)
    try:
        yield
    finally:
        _RELAY_CHANNEL.reset(token)


def current_human_relay_channel() -> HumanRelayChannel | None:
    return _RELAY_CHANNEL.get()


# ── Field-presence preservation for restored Pydantic inputs ────────────────────────────


def _extract_fields_set(value: Any) -> Any:
    """Capture ``model_fields_set`` recursively so restoring a pending Pydantic input preserves
    ``model_dump(exclude_unset=True)`` semantics."""
    if isinstance(value, BaseModel):
        return {
            name: _extract_fields_set(getattr(value, name))
            for name in value.model_fields_set
            if hasattr(value, name)
        }
    if isinstance(value, dict):
        return {k: _extract_fields_set(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_extract_fields_set(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_extract_fields_set(item) for item in value)
    return None


def _apply_fields_set(value: Any, tree: Any) -> None:
    if isinstance(value, BaseModel) and isinstance(tree, dict):
        value.model_fields_set.clear()
        for name, sub in tree.items():
            if hasattr(value, name):
                value.model_fields_set.add(name)
                _apply_fields_set(getattr(value, name), sub)
    elif isinstance(value, dict) and isinstance(tree, dict):
        for k, sub in tree.items():
            if k in value:
                _apply_fields_set(value[k], sub)
    elif isinstance(value, (list, tuple)) and isinstance(tree, (list, tuple)):
        for item, sub in zip(value, tree, strict=False):
            _apply_fields_set(item, sub)


# ── Errors & gate ───────────────────────────────────────────────────────────────────────


def _quoted(names: Sequence[str]) -> str:
    return ", ".join(f"'{name}'" for name in names)


def _required_error(names: Sequence[str], suggestion: str) -> CommandError:
    return CommandError(
        code=ErrorCodes.CONFIRMATION_REQUIRED,
        message=(
            f"'{names[0]}' needs a person's confirmation through the host"
            if len(names) == 1
            else f"{_quoted(names)} need a person's confirmation through the host"
        ),
        suggestion=suggestion,
        retryable=False,
        details={"commands": list(names)},
        # A person confirms through the host (spec/recovery.md, "Engine errors").
        recovery=Recovery(kind="external"),
    )


def _declined_error(names: Sequence[str]) -> CommandError:
    return CommandError(
        code=ErrorCodes.CONFIRMATION_DECLINED,
        message=f"The user did not confirm {_quoted(names)}",
        suggestion=(
            "Do not run this again without asking the user first; the user chose not to proceed."
        ),
        retryable=False,
        details={"commands": list(names)},
        recovery=Recovery(kind="stop"),
    )


def host_verified_unrelayable(names: Sequence[str], has_relay: bool) -> CommandError:
    """Refusal for a host-verified command the server cannot relay: no relay is installed, or
    the call is a batch/pipeline step or a 2025-era request."""
    suggestion = (
        f"This server cannot confirm {_quoted(names)} over MCP: only the host can, and it has "
        "no way to ask the person here. Do not retry; ask the user to run it through the "
        "application."
        if not has_relay
        else f"Call {_quoted(names)} on its own (its own tool, a grouped tool or afd-call) "
        "from an MCP 2026-07-28 client, so the host can ask the person."
    )
    return _required_error(names, suggestion)


def _pending_refusal(name: str, pending: RelayPendingDecision) -> HumanRelayOutcome:
    if (
        not is_decision_id(pending.decision)
        or not is_relay_url(pending.url)
        or not is_relay_url(pending.list)
    ):
        raise _relay_internal_error()
    suggestion = (
        f"Ask the person to open their pending decisions at {pending.list} "
        f"(or this one at {pending.url}), check that it is decision {pending.decision} "
        f"for '{name}', and decide there; then send this same call again."
    )
    return HumanRelayOutcome(
        "error",
        error=CommandError(
            code=ErrorCodes.CONFIRMATION_REQUIRED,
            message=f"'{name}' needs a person's confirmation through the host",
            suggestion=suggestion,
            retryable=True,
            details={
                "commands": [name],
                "reason": "pending-list",
                "decision": pending.decision,
                "url": pending.url,
                "list": pending.list,
            },
            recovery=Recovery(kind="external"),
        ),
    )


def _relay_internal_error() -> Exception:
    try:
        from mcp import MCPError
        from mcp_types import INTERNAL_ERROR
    except ImportError:  # pragma: no cover - optional dependency
        return RuntimeError("Internal error")
    return MCPError(code=INTERNAL_ERROR, message="Internal error")


def _filter_approved_extra(extra: Any) -> dict[str, Any]:
    if extra is None:
        return {}
    if not isinstance(extra, Mapping):
        raise _relay_internal_error()
    filtered: dict[str, Any] = {}
    for key, value in extra.items():
        if not isinstance(key, str):
            raise _relay_internal_error()
        if key in _RESERVED_APPROVED_KEYS or key.startswith("_afd_"):
            continue
        filtered[key] = value
    return filtered


def _validated_input_for_resolver(data: Any) -> Any:
    if isinstance(data, BaseModel):
        out: dict[str, Any] = {}
        for field_name, field_info in type(data).model_fields.items():
            key = field_name
            if isinstance(field_info.validation_alias, str):
                key = field_info.validation_alias
            elif field_info.validation_alias is None and isinstance(field_info.alias, str):
                key = field_info.alias
            out[key] = _validated_input_for_resolver(getattr(data, field_name))
        extras = data.__pydantic_extra__
        if extras:
            for extra_key, extra_val in extras.items():
                out[extra_key] = _validated_input_for_resolver(extra_val)
        return out
    if isinstance(data, list):
        return [_validated_input_for_resolver(item) for item in data]
    if isinstance(data, tuple):
        return tuple(_validated_input_for_resolver(item) for item in data)
    if isinstance(data, dict):
        return {k: _validated_input_for_resolver(v) for k, v in data.items()}
    return data


@dataclass
class _PendingInput:
    command: str
    raw_digest: str
    principal: str
    canonical: str
    fields_set: Any
    expires_at: float


@dataclass(frozen=True)
class HumanRelayOutcome:
    """What :class:`HumanRelayGate` decided for a single host-verified command call."""

    kind: Literal["proceed", "error", "input-required"]
    context: CommandContext | None = None
    error: CommandError | None = None
    result: Any = None


class HumanRelayGate:
    """Enforces host-verified confirmation on every MCP surface regardless of ``confirmations``."""

    def __init__(
        self,
        relay: HumanRelay | None,
        commands: Sequence[CommandDefinition],
        *,
        actor: Actor,
        dev_mode: bool = False,
        context_fields: Sequence[ContextField] = (),
        clock: Clock | None = None,
        max_validation_issues: int = DEFAULT_MAX_VALIDATION_ISSUES,
        has_auth_layer: bool = False,
        lookup_command: Callable[[str], CommandDefinition | None] | None = None,
    ) -> None:
        self._relay = relay
        self._commands_by_name = {command.name: command for command in commands}
        self._lookup_command = lookup_command
        self._default_actor = actor
        self._dev_mode = dev_mode
        self._context_fields = tuple(context_fields)
        self._clock = clock or system_clock
        self._max_validation_issues = max_validation_issues
        self._has_auth_layer = has_auth_layer
        # Keeps the initial validated input across begin -> resume (and across pending-list
        # retries, which carry no requestState) when a Pydantic model computes a dynamic default
        # (e.g. default_factory), without altering the relay's state on the wire. Raw inputs are
        # stored only as a fixed-size SHA-256 digest; restored models keep their original
        # model_fields_set and are re-validated through the schema (#1414 semantics).
        self._pending_inputs: dict[str, _PendingInput] = {}
        self._pending_list_inputs: dict[str, _PendingInput] = {}

    def _command_for(self, name: str) -> CommandDefinition | None:
        if self._lookup_command is not None:
            return self._lookup_command(name)
        return self._commands_by_name.get(name)

    @staticmethod
    def _pending_list_key(command: str, raw_digest: str, principal: str) -> str:
        return _sha256_b64url(json.dumps([command, raw_digest, principal], separators=(",", ":")))

    @staticmethod
    def _prune_pending_map(store: dict[str, _PendingInput], now: float) -> None:
        expired = [key for key, entry in store.items() if entry.expires_at <= now]
        for key in expired:
            del store[key]
        while len(store) >= _MAX_PENDING_INPUTS:
            oldest = next(iter(store))
            del store[oldest]

    def _remember_in_store(
        self,
        store: dict[str, _PendingInput],
        key: str,
        command: str,
        raw_digest: str | None,
        principal: str,
        canonical: str,
        fields_set: Any,
    ) -> None:
        if raw_digest is None or len(canonical) > _MAX_PENDING_INPUT_CHARS:
            return
        now = self._clock.now()
        self._prune_pending_map(store, now)
        store[key] = _PendingInput(
            command=command,
            raw_digest=raw_digest,
            principal=principal,
            canonical=canonical,
            fields_set=fields_set,
            expires_at=now + _PENDING_INPUT_TTL_MS,
        )

    def _remember_pending(
        self,
        state: str,
        command: str,
        raw_digest: str | None,
        principal: str,
        canonical: str,
        fields_set: Any,
    ) -> None:
        self._remember_in_store(
            self._pending_inputs,
            _sha256_b64url(state),
            command,
            raw_digest,
            principal,
            canonical,
            fields_set,
        )

    def _remember_pending_list(
        self,
        command: str,
        raw_digest: str | None,
        principal: str,
        canonical: str,
        fields_set: Any,
    ) -> None:
        if raw_digest is None:
            return
        self._remember_in_store(
            self._pending_list_inputs,
            self._pending_list_key(command, raw_digest, principal),
            command,
            raw_digest,
            principal,
            canonical,
            fields_set,
        )

    def _read_from_store(
        self,
        store: dict[str, _PendingInput],
        key: str,
        command: CommandDefinition,
        input_schema: Any,
        raw_digest: str | None,
        principal: str,
    ) -> tuple[Any] | None:
        if raw_digest is None:
            return None
        entry = store.get(key)
        if entry is None:
            return None
        if entry.expires_at <= self._clock.now():
            del store[key]
            return None
        if (
            entry.command != command.name
            or entry.raw_digest != raw_digest
            or entry.principal != principal
        ):
            return None
        try:
            parsed = json.loads(entry.canonical)
            rechecked = validate_command_input(
                input_schema, parsed, max_issues=self._max_validation_issues
            )
            if _canonical_or_none(rechecked) == entry.canonical:
                if entry.fields_set is not None:
                    _apply_fields_set(rechecked, entry.fields_set)
                return (rechecked,)
        except Exception:
            pass
        return None

    def _read_pending(
        self,
        state: str,
        command: CommandDefinition,
        input_schema: Any,
        raw_digest: str | None,
        principal: str,
    ) -> tuple[Any] | None:
        return self._read_from_store(
            self._pending_inputs,
            _sha256_b64url(state),
            command,
            input_schema,
            raw_digest,
            principal,
        )

    def _read_pending_list(
        self,
        command: CommandDefinition,
        input_schema: Any,
        raw_digest: str | None,
        principal: str,
    ) -> tuple[Any] | None:
        if raw_digest is None:
            return None
        return self._read_from_store(
            self._pending_list_inputs,
            self._pending_list_key(command.name, raw_digest, principal),
            command,
            input_schema,
            raw_digest,
            principal,
        )

    def _forget_pending_if_matching(
        self,
        state: str | None,
        command: str,
        raw_digest: str | None,
        principal: str,
    ) -> None:
        if not state or raw_digest is None:
            return
        key = _sha256_b64url(state)
        entry = self._pending_inputs.get(key)
        if (
            entry is not None
            and entry.command == command
            and entry.raw_digest == raw_digest
            and entry.principal == principal
        ):
            del self._pending_inputs[key]

    def _forget_pending_list(
        self,
        command: str,
        raw_digest: str | None,
        principal: str,
    ) -> None:
        if raw_digest is None:
            return
        self._pending_list_inputs.pop(self._pending_list_key(command, raw_digest, principal), None)

    def _present(
        self,
        command_name: str,
        capabilities: dict[str, Any] | None,
        prompt: Any,
        raw_digest: str | None,
        principal: str,
        validated_canonical: str,
        fields_set: Any,
    ) -> HumanRelayOutcome:
        if not allows_url_elicitation(capabilities):
            return HumanRelayOutcome(
                "error",
                error=_required_error(
                    [command_name],
                    "Use an MCP client that supports URL-mode elicitation: only a person, "
                    f"through the link the host sends, can confirm '{command_name}'.",
                ),
            )
        if (
            not isinstance(prompt, RelayPrompt)
            or not is_relay_url(prompt.url)
            or not isinstance(prompt.message, str)
            or not isinstance(prompt.state, str)
            or len(prompt.state) == 0
        ):
            raise _relay_internal_error()
        self._remember_pending(
            prompt.state, command_name, raw_digest, principal, validated_canonical, fields_set
        )
        elicitation_id = _url_elicitation_id(prompt.url)
        from mcp_types import ElicitRequest, ElicitRequestURLParams, InputRequiredResult

        wire = _RELAY_WIRE.get()
        if wire is not None:
            wire.outbound_state = prompt.state
            wire.outbound_elicitation_id = elicitation_id
            wire.outbound_url = prompt.url
            req_state: str | None = None
        else:
            req_state = prompt.state
        return HumanRelayOutcome(
            "input-required",
            result=InputRequiredResult(
                input_requests={
                    RELAY_INPUT_KEY: ElicitRequest(
                        params=ElicitRequestURLParams(
                            mode="url",
                            message=prompt.message,
                            url=prompt.url,
                            elicitation_id=elicitation_id,
                        )
                    )
                },
                request_state=req_state,
            ),
        )

    def refuse_steps(self, steps: Sequence[ConfirmationStep]) -> CommandError | None:
        """Refuse any ``afd-batch`` or ``afd-pipe`` containing a host-verified command, reading
        live command definitions so post-registration mutations cannot bypass enforcement."""
        names: list[str] = []
        for step in steps:
            cmd = self._command_for(step.command)
            if (
                cmd is not None
                and getattr(cmd, "confirmation_mode", None) == "host-verified"
                and step.command not in names
            ):
                names.append(step.command)
        return (
            host_verified_unrelayable(names, has_relay=self._relay is not None) if names else None
        )

    async def check(
        self,
        command: CommandDefinition,
        raw_input: Any,
        call_context: CommandContext,
    ) -> HumanRelayOutcome:
        """Run the host-verified confirmation protocol for one single-command MCP call."""
        name = command.name
        if self._relay is None:
            return HumanRelayOutcome(
                "error", error=host_verified_unrelayable([name], has_relay=False)
            )
        channel = current_human_relay_channel()
        if channel is None or not channel.modern:
            return HumanRelayOutcome(
                "error", error=host_verified_unrelayable([name], has_relay=True)
            )

        # M8: credentials that cannot be bound never reach the relay, on first call or retry.
        actor = call_context.actor if call_context.actor is not None else self._default_actor
        use_sdk_creds = not self._has_auth_layer and call_context.credentials is None
        try:
            credentials = sdk_credentials() if use_sdk_creds else call_context.credentials
            creds_binding = credentials_binding(credentials)
            bound_principal = principal_binding(actor, credentials)
        except (IncompleteCredentials, TypeError):
            logger.warning("refusing host-verified call '%s': incomplete credentials", name)
            raise _relay_internal_error() from None

        # Step 2: validate first, as the execution engine will, so the person decides on exactly
        # what will run. On an accept retry for the same raw input, command and principal — or a
        # pending-list retry (which carries no requestState) — reuse the initial validated input
        # if it still validates to the same canonical JSON.
        is_stop_answer = channel.request_state is not None and channel.relay_action in (
            "decline",
            "cancel",
        )
        metadata = get_command_metadata(command.handler)
        input_schema = metadata.input_schema if metadata is not None else command.input_schema
        normalized_raw = {} if (input_schema is not None and raw_input is None) else raw_input
        raw_canonical = _canonical_or_none(normalized_raw)
        raw_digest = _sha256_b64url(raw_canonical) if raw_canonical is not None else None
        if channel.relay_action == "accept" and channel.request_state:
            pending_validated = self._read_pending(
                channel.request_state, command, input_schema, raw_digest, bound_principal
            )
        elif (
            not is_stop_answer
            and not allows_url_elicitation(channel.client_capabilities)
            and getattr(self._relay, "pending_list", None) is not None
        ):
            pending_validated = self._read_pending_list(
                command, input_schema, raw_digest, bound_principal
            )
        else:
            pending_validated = None
        if pending_validated is not None:
            validated_data = pending_validated[0]
        else:
            try:
                validated_data = validate_command_input(
                    input_schema, raw_input, max_issues=self._max_validation_issues
                )
            except (PydanticValidationError, SchemaValidationError) as exc:
                if input_schema is None:
                    raise
                failed = _input_validation_failure(
                    input_schema,
                    {} if raw_input is None else raw_input,
                    exc,
                    max_issues=self._max_validation_issues,
                )
                return HumanRelayOutcome("error", error=failed.error)
            except Exception as exc:
                logger.error("Input validation for '%s' raised", name, exc_info=exc)
                return HumanRelayOutcome(
                    "error",
                    error=CommandError(
                        code=ErrorCodes.VALIDATION_ERROR,
                        message="Input validation failed",
                        suggestion=(
                            f"Input validation threw: {exc}"
                            if self._dev_mode
                            else f"Check the input against the input schema of '{name}' "
                            "(afd-detail returns it) and retry"
                        ),
                    ),
                )

        # M6: re-check scopes on the validated input before asking anyone.
        view = scope_view_of(call_context)
        if view is not None:
            exec_input = (
                _validated_input_for_resolver(validated_data) if view.has_resolver else None
            )
            exec_decision = view.decide_execution(name, exec_input)
            if exec_decision != "proceed":
                return HumanRelayOutcome(
                    "error", error=view.insufficient_scope(exec_decision.forbidden)
                )

        try:
            validated_canonical = _canonical_json(_plain_input(validated_data))
            digest = _b64url(hashlib.sha256(_utf8(validated_canonical)).digest())
        except (TypeError, ValueError, RecursionError) as exc:
            return HumanRelayOutcome(
                "error",
                error=CommandError(
                    code=ErrorCodes.VALIDATION_ERROR,
                    message=str(exc) or "Input has no canonical JSON form",
                    suggestion="Pass plain JSON input: integers within +-2^53",
                    retryable=False,
                ),
            )
        fields_set = (
            _extract_fields_set(validated_data) if isinstance(validated_data, BaseModel) else None
        )

        # Validate declared context fields before asking a person, so call.context matches what
        # the command runs with and invalid _meta context fields fail fast.
        relay_context = CommandContext(
            trace_id=call_context.trace_id,
            timeout=call_context.timeout,
            extra=dict(call_context.extra),
            actor=copy.copy(actor),
            clock=call_context.clock,
            random=call_context.random,
            approval=call_context.approval,
            report_progress=call_context.report_progress,
            cancel=call_context.cancel,
            signal=call_context.signal,
            credentials=credentials,
            output_budget=call_context.output_budget,
            _output_budget_ask=call_context._output_budget_ask,
            _scope_view=call_context._scope_view,
        )
        if self._context_fields:
            invalid_field = apply_context_fields(
                self._context_fields, relay_context, name, dev_mode=self._dev_mode
            )
            if invalid_field is not None:
                return HumanRelayOutcome("error", error=invalid_field.error)

        capabilities = (
            copy.deepcopy(channel.client_capabilities)
            if channel.client_capabilities is not None
            else None
        )
        call = RelayCall(
            command=name,
            input_digest=digest,
            actor=copy.copy(actor),
            credentials=credentials,
            client_capabilities=capabilities,
            input=validated_data,
            context=relay_context,
            _principal_binding=bound_principal,
        )

        async def _approve(decision_id: Any) -> HumanRelayOutcome:
            if not is_decision_id(decision_id):
                raise _relay_internal_error()
            approved_extra: dict[str, Any] = {}
            approved_ctx_fn = getattr(self._relay, "approved_context", None)
            if approved_ctx_fn is not None:
                if not callable(approved_ctx_fn):
                    raise _relay_internal_error()
                try:
                    raw_extra = approved_ctx_fn(decision_id, call)
                    resolved_extra = (
                        await raw_extra if inspect.isawaitable(raw_extra) else raw_extra
                    )
                except Exception:
                    logger.exception("HumanRelay.approved_context raised for '%s'", name)
                    raise _relay_internal_error() from None
                approved_extra = _filter_approved_extra(resolved_extra)
            evidence = RelayEvidence(
                command=name,
                input_digest=digest,
                actor=_actor_json(actor),
                credentials_binding=creds_binding,
                decision_id=decision_id,
                use_sdk_credentials=use_sdk_creds,
            )
            # Carry the already-validated context fields from relay_context (so dynamic
            # defaults on context models never drift between relay and handler), then
            # overlay approved_context and validate only declared fields it replaced.
            exec_context = CommandContext(
                trace_id=call_context.trace_id,
                timeout=call_context.timeout,
                extra={**relay_context.extra, **approved_extra},
                actor=copy.copy(actor),
                clock=call_context.clock,
                random=call_context.random,
                approval=call_context.approval,
                report_progress=call_context.report_progress,
                cancel=call_context.cancel,
                signal=call_context.signal,
                credentials=call_context.credentials,
                output_budget=call_context.output_budget,
                _output_budget_ask=call_context._output_budget_ask,
                _scope_view=call_context._scope_view,
            )
            if self._context_fields:
                replaced = [f for f in self._context_fields if f.name in approved_extra]
                if replaced:
                    invalid_replaced = apply_context_fields(
                        replaced, exec_context, name, dev_mode=self._dev_mode
                    )
                    if invalid_replaced is not None:
                        return HumanRelayOutcome("error", error=invalid_replaced.error)
                journaled = getattr(relay_context, JOURNALED_CONTEXT_FIELDS, None)
                if journaled is not None:
                    setattr(exec_context, JOURNALED_CONTEXT_FIELDS, journaled)
                attach_relay_context_validated(exec_context)
            attach_relay_evidence(exec_context, evidence)
            attach_relay_validated_input(exec_context, name, validated_data)
            attach_relay_dispatch_admission(
                exec_context, name, validated_canonical, _canonical_or_none
            )
            return HumanRelayOutcome("proceed", context=exec_context)

        # Ending the elicitation is an answer only to stop: nothing is asked of the relay,
        # whatever the client declared.
        if is_stop_answer:
            self._forget_pending_if_matching(
                channel.request_state, name, raw_digest, bound_principal
            )
            self._forget_pending_list(name, raw_digest, bound_principal)
            return HumanRelayOutcome("error", error=_declined_error([name]))

        # A client that cannot open a URL elicitation is never sent one: the relay's pending
        # list, if it keeps one, is its only way (spec/command-metadata.md, "The pending list").
        if not call.supports_url_elicitation():
            pending_list_fn = getattr(self._relay, "pending_list", None)
            if pending_list_fn is not None:
                if not callable(pending_list_fn):
                    raise _relay_internal_error()
                try:
                    raw_found = pending_list_fn(call)
                    found = await raw_found if inspect.isawaitable(raw_found) else raw_found
                except Exception:
                    logger.exception("HumanRelay.pending_list raised for '%s'", name)
                    raise _relay_internal_error() from None
                if found is None:
                    self._forget_pending_list(name, raw_digest, bound_principal)
                else:
                    if isinstance(found, RelayApproved):
                        approved_outcome = await _approve(found.decision_id)
                        self._forget_pending_if_matching(
                            channel.request_state, name, raw_digest, bound_principal
                        )
                        self._forget_pending_list(name, raw_digest, bound_principal)
                        return approved_outcome
                    if isinstance(found, RelayDeclined):
                        self._forget_pending_if_matching(
                            channel.request_state, name, raw_digest, bound_principal
                        )
                        self._forget_pending_list(name, raw_digest, bound_principal)
                        return HumanRelayOutcome("error", error=_declined_error([name]))
                    if isinstance(found, RelayPendingDecision):
                        pending_outcome = _pending_refusal(name, found)
                        self._remember_pending_list(
                            name, raw_digest, bound_principal, validated_canonical, fields_set
                        )
                        return pending_outcome
                    if isinstance(found, CommandError):
                        if not isinstance(found.code, str) or not isinstance(found.message, str):
                            raise _relay_internal_error()
                        return HumanRelayOutcome("error", error=found)
                    raise _relay_internal_error()

        # Step 4: retry carrying inputResponses.relay (accept) and requestState.
        if channel.relay_action == "accept" and channel.request_state:
            try:
                raw_outcome = self._relay.resume(channel.request_state, call)
                outcome = await raw_outcome if inspect.isawaitable(raw_outcome) else raw_outcome
            except Exception:
                logger.exception("HumanRelay.resume raised for '%s'", name)
                raise _relay_internal_error() from None
            if isinstance(outcome, RelayApproved):
                self._forget_pending_if_matching(
                    channel.request_state, name, raw_digest, bound_principal
                )
                return await _approve(outcome.decision_id)
            if isinstance(outcome, RelayDeclined):
                self._forget_pending_if_matching(
                    channel.request_state, name, raw_digest, bound_principal
                )
                return HumanRelayOutcome("error", error=_declined_error([name]))
            if isinstance(outcome, RelayPending):
                if (
                    isinstance(outcome.prompt, RelayPrompt)
                    and outcome.prompt.state != channel.request_state
                ):
                    self._forget_pending_if_matching(
                        channel.request_state, name, raw_digest, bound_principal
                    )
                return self._present(
                    name,
                    capabilities,
                    outcome.prompt,
                    raw_digest,
                    bound_principal,
                    validated_canonical,
                    fields_set,
                )
            if isinstance(outcome, RelayInvalid):
                if pending_validated is not None:
                    self._forget_pending_if_matching(
                        channel.request_state, name, raw_digest, bound_principal
                    )
                # Fall through to Step 3 (begin again).
            else:
                raise _relay_internal_error()

        # Step 3: begin.
        try:
            raw_begun = self._relay.begin(call)
            begun = await raw_begun if inspect.isawaitable(raw_begun) else raw_begun
        except Exception:
            logger.exception("HumanRelay.begin raised for '%s'", name)
            raise _relay_internal_error() from None
        if isinstance(begun, CommandError):
            if not isinstance(begun.code, str) or not isinstance(begun.message, str):
                raise _relay_internal_error()
            return HumanRelayOutcome("error", error=begun)
        if isinstance(begun, RelayPrompt):
            return self._present(
                name,
                capabilities,
                begun,
                raw_digest,
                bound_principal,
                validated_canonical,
                fields_set,
            )
        raise _relay_internal_error()


__all__ = [
    "HumanRelay",
    "PendingListOutcome",
    "RELAY_INPUT_KEY",
    "RelayApproved",
    "RelayBeginResult",
    "RelayCall",
    "RelayDeclined",
    "RelayInvalid",
    "RelayOutcome",
    "RelayPending",
    "RelayPendingDecision",
    "RelayPrompt",
    "allows_url_elicitation",
    "input_digest",
    "is_decision_id",
    "is_relay_url",
]
