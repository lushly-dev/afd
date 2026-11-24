"""Scope decisions (``spec/authorization.md``, M6): the static rule, a host's
:class:`ScopeResolver`, request-level aggregation, and :class:`ScopeChallenge` for a host whose
callers authenticate by a scheme of its own. Pure: no request, server or transport.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol, runtime_checkable

from afd.server.auth_resource import is_scope_token
from afd.server.auth_rules import Credentials

logger = logging.getLogger("afd.server")


@dataclass(frozen=True)
class ScopeMissing:
    """A scope decision refusing a call because it lacks ``missing`` scopes, in order."""

    missing: tuple[str, ...]

    def __post_init__(self) -> None:
        if isinstance(self.missing, (str, bytes)) or not isinstance(self.missing, Sequence):
            raise TypeError("ScopeMissing.missing must be a sequence of scope strings")
        if not isinstance(self.missing, tuple):
            object.__setattr__(self, "missing", tuple(self.missing))


ScopeDecision = Literal["allowed", "defer"] | ScopeMissing
"""A scope decision for one call: ``"allowed"``, ``"defer"`` or :class:`ScopeMissing`."""


@dataclass(frozen=True)
class RequestForbidden:
    """A request-level refusal naming every missing scope across all steps, once, in step order."""

    forbidden: tuple[str, ...]

    def __post_init__(self) -> None:
        if isinstance(self.forbidden, (str, bytes)) or not isinstance(self.forbidden, Sequence):
            raise TypeError("RequestForbidden.forbidden must be a sequence of scope strings")
        if not isinstance(self.forbidden, tuple):
            object.__setattr__(self, "forbidden", tuple(self.forbidden))


RequestDecision = Literal["proceed"] | RequestForbidden
"""What a whole request gets from the decisions on its steps: ``"proceed"`` or
:class:`RequestForbidden`."""

ScopeWarning = Callable[[str], None]
"""A host-facing warning sink for a resolver's mistakes; never given the call's input."""


def _default_warning(message: str) -> None:
    logger.warning("[afd] %s", message)


@runtime_checkable
class ScopeResolver(Protocol):
    """A host's per-call scope rule (``spec/authorization.md``, M6, "A resolver").

    It decides every call instead of the static rule (a command's ``scopes``); the server's
    ``required_scopes`` still apply.

    ``resolve`` is asked twice for a call that runs a command: before dispatch, on the arguments
    as sent (not validated, no defaults, pipeline references unresolved), for the 403 and again
    after routing; and at execution, on the validated input, for every command the server runs
    with credentials. Decide on the values, not on whether they were sent, so both agree. For a
    meta-tool that names no command (``afd-discover``, ``afd-detail``, or ``afd-call``,
    ``afd-batch`` and ``afd-pipe`` without a command for every step), ``command`` is the tool's
    own name and ``input`` its arguments as sent, which may name any command, hidden ones
    included: decide such a tool without asking whether a command its input names exists. It is
    never asked about a name that does not exist for the caller (unknown, not exposed to MCP,
    or not ``known``).

    ``visible`` and optional ``known`` (default: ``visible``) must be pure functions of the
    command and the credentials. With ``filter_tools_by_scope=True``, listings show a command
    only when both hold, and a command ``known`` rejects does not exist for the caller on any
    route (M6, "Hidden commands").
    """

    def resolve(self, command: str, input: Any, credentials: Credentials) -> ScopeDecision: ...

    def visible(self, command: str, credentials: Credentials) -> bool: ...


def static_decision(
    required: Sequence[str],
    scopes: Sequence[str],
    held: Sequence[str],
) -> ScopeDecision:
    """The static rule (M6): a call needs ``required`` (the server's ``required_scopes``), then
    the command's ``scopes``, without repeats. ``"allowed"`` when ``held`` holds each one
    exactly (case-sensitive, no hierarchy), else :class:`ScopeMissing` with those not held, in
    that order. It never defers."""
    held_set = set(held)
    missing: list[str] = []
    seen: set[str] = set()
    for scope in (*required, *scopes):
        if scope not in held_set and scope not in seen:
            seen.add(scope)
            missing.append(scope)
    return "allowed" if not missing else ScopeMissing(tuple(missing))


def request_decision(
    decisions: Sequence[ScopeDecision],
    warn: ScopeWarning | None = None,
) -> RequestDecision:
    """The decision on a request whose steps were decided ``decisions`` (M6).

    Any :class:`ScopeMissing` (or ``{"missing": [...]}`` dict) refuses the request, even one
    that names no scope or a name that is not a scope token: such a name is the resolver's
    mistake, reported to ``warn`` without the call's input and left out of the list.
    """
    sink = warn if warn is not None else _default_warning
    refused = False
    missing: list[str] = []
    seen: set[str] = set()
    for raw in decisions:
        decision = checked_decision(raw)
        if decision == "allowed" or decision == "defer":
            continue
        refused = True
        named = decision.missing
        if len(named) == 0 or any(
            not isinstance(scope, str) or not is_scope_token(scope) for scope in named
        ):
            sink("a scope decision answered missing without valid scope names; the call is refused")
        for scope in named:
            if isinstance(scope, str) and is_scope_token(scope) and scope not in seen:
                seen.add(scope)
                missing.append(scope)
    return RequestForbidden(tuple(missing)) if refused else "proceed"


def merge_decisions(required: ScopeDecision, decision: ScopeDecision) -> ScopeDecision:
    """The required scopes' decision, then a call's own."""
    if isinstance(required, ScopeMissing):
        if not isinstance(decision, ScopeMissing):
            return required
        merged: list[Any] = list(required.missing)
        seen: set[str] = {scope for scope in merged if isinstance(scope, str)}
        for scope in decision.missing:
            if isinstance(scope, str):
                if scope not in seen:
                    seen.add(scope)
                    merged.append(scope)
            else:
                # Preserve non-string entries (even unhashable ones) so request_decision warns
                # and omits them without raising.
                merged.append(scope)
        return ScopeMissing(tuple(merged))
    return decision


def checked_decision(decision: Any) -> ScopeDecision:
    """Normalize a resolver's return value; anything unrecognized fails closed."""
    if decision == "allowed":
        return "allowed"
    if decision == "defer":
        return "defer"
    if isinstance(decision, ScopeMissing):
        return decision
    if isinstance(decision, Mapping) and "missing" in decision:
        raw_missing = decision["missing"]
        if isinstance(raw_missing, Sequence) and not isinstance(raw_missing, (str, bytes)):
            # Preserve raw items so non-string entries are rejected as invalid scope tokens
            # rather than coerced into strings that could pass is_scope_token (e.g. ints).
            return ScopeMissing(tuple(raw_missing))
    return ScopeMissing(())


def validate_scope_list(what: str, scopes: Any) -> tuple[str, ...]:
    """Validate ``scopes`` as a sequence of OAuth scope tokens, deduplicated in order."""
    if scopes is None:
        return ()
    if isinstance(scopes, (str, bytes)) or not isinstance(scopes, Sequence):
        raise ValueError(f"[AFD] {what} must be a sequence of scope tokens")
    kept: list[str] = []
    seen: set[str] = set()
    for scope in scopes:
        if not is_scope_token(scope):
            shown = (
                json.dumps(scope)
                if isinstance(scope, (str, int, float, bool)) or scope is None
                else repr(scope)
            )
            raise ValueError(f"[AFD] {what}: {shown} is not an OAuth scope token")
        if scope not in seen:
            seen.add(scope)
            kept.append(scope)
    return tuple(kept)


# An HTTP token (RFC 9110 5.6.2).
_HTTP_TOKEN = re.compile(r"\A[!#$%&'*+\-.^_`|~0-9A-Za-z]+\Z", re.ASCII)
# A parameter value that is always one quoted string without escapes.
_QUOTED_VALUE = re.compile(r"\A[ \x21\x23-\x5B\x5D-\x7E]*\Z", re.ASCII)


class ScopeChallenge:
    """The ``WWW-Authenticate`` challenge of a host's 403 when its callers authenticate by a
    scheme of its own rather than ``Bearer`` (``spec/authorization.md``, M6, "A host's own
    layer"): ``<scheme> <name>="<value>", ..., error="insufficient_scope", scope="<missing>"``,
    the host's parameters first in the order given, ``scope`` left out rather than sent empty,
    and nothing pointing to protected-resource metadata."""

    def __init__(self, scheme: str, params: Mapping[str, str] | None = None) -> None:
        if not isinstance(scheme, str) or _HTTP_TOKEN.match(scheme) is None:
            raise ValueError(f"[AFD] the challenge scheme {scheme!r} is not an HTTP token")
        if scheme.lower() == "bearer":
            raise ValueError(
                "[AFD] a Bearer 403 is M5's own challenge; a ScopeChallenge names another scheme"
            )
        if params is not None and not isinstance(params, Mapping):
            raise ValueError(
                "[AFD] challenge params must be a mapping of parameter names to strings"
            )
        seen: set[str] = set()
        kept: list[tuple[str, str]] = []
        for name, value in (params or {}).items():
            if not isinstance(name, str) or _HTTP_TOKEN.match(name) is None:
                raise ValueError(f"[AFD] the challenge parameter {name!r} is not an HTTP token")
            folded = name.lower()
            if folded in ("error", "scope"):
                raise ValueError(
                    f"[AFD] the challenge parameter {json.dumps(name)} is set by the scope decision"
                )
            if folded in seen:
                raise ValueError(
                    f"[AFD] the challenge parameter {json.dumps(name)} is named more than once"
                )
            if not isinstance(value, str) or _QUOTED_VALUE.match(value) is None:
                raise ValueError(
                    f"[AFD] the value of the challenge parameter {json.dumps(name)} must be "
                    "visible ASCII or spaces, without '\"' or '\\\\'"
                )
            seen.add(folded)
            kept.append((name, value))
        self._scheme = scheme
        self._params: tuple[tuple[str, str], ...] = tuple(kept)

    @property
    def scheme(self) -> str:
        return self._scheme

    @property
    def params(self) -> tuple[tuple[str, str], ...]:
        return self._params

    def header_value(self, missing: Sequence[str]) -> str:
        """The challenge's value for ``missing`` scopes, in order; only scope tokens are named."""
        parts = [f'{name}="{value}"' for name, value in self._params]
        parts.append('error="insufficient_scope"')
        scopes = " ".join(scope for scope in missing if is_scope_token(scope))
        if scopes:
            parts.append(f'scope="{scopes}"')
        return f"{self._scheme} {', '.join(parts)}"


__all__ = [
    "RequestDecision",
    "RequestForbidden",
    "ScopeChallenge",
    "ScopeDecision",
    "ScopeMissing",
    "ScopeResolver",
    "ScopeWarning",
    "checked_decision",
    "merge_decisions",
    "request_decision",
    "static_decision",
    "validate_scope_list",
]
