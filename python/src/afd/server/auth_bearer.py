"""The one bearer token of a request (``spec/authorization.md``, M2)."""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal, Union

if TYPE_CHECKING:
    from afd.server.auth_rules import AuthRuleCode

# ``Bearer 1*SP b64token`` (RFC 6750 2.1), the scheme in any ASCII case, around which an HTTP
# parser may have left spaces or tabs. One anchored match whose parts cannot overlap (no space
# or tab inside a b64token), so it runs in time linear in the value. Uses ``\Z`` so a trailing
# newline is never accepted.
_BEARER = re.compile(
    r"\A[ \t]*bearer +([A-Za-z0-9\-._~+/]+=*)[ \t]*\Z", re.IGNORECASE | re.ASCII
)
_PERCENT_HEX = re.compile(r"%([0-9A-Fa-f]{2})", re.ASCII)


def _parse_bearer(value: str) -> str | None:
    """The token of a ``Bearer`` value, or ``None`` when the value breaks M2's grammar."""
    match = _BEARER.match(value)
    return match.group(1) if match is not None else None


def _form_decode(encoded: str) -> str:
    """Percent- and ``+``-decoding of one form name, bytewise. Malformed escapes stay as written."""
    replaced = encoded.replace("+", " ")
    return _PERCENT_HEX.sub(lambda match: chr(int(match.group(1), 16)), replaced)


def names_access_token(encoded: str) -> bool:
    """Whether an ``application/x-www-form-urlencoded`` string has a parameter named ``access_token``."""
    return any(_form_decode(pair.split("=", 1)[0]) == "access_token" for pair in encoded.split("&"))


@dataclass(frozen=True)
class BearerToken:
    """The one bearer token extracted from a request (M2)."""

    token: str

    @property
    def ok(self) -> Literal[True]:
        return True

    def __repr__(self) -> str:
        return "BearerToken(token='[redacted]')"

    __str__ = __repr__


@dataclass(frozen=True)
class BearerRefusal:
    """The M2 rule a request broke when extracting its bearer token."""

    refused: AuthRuleCode

    @property
    def ok(self) -> Literal[False]:
        return False


BearerResult = Union[BearerToken, BearerRefusal]


def extract_bearer(
    authorization: Sequence[str],
    query: str | None = None,
    form_body: str | None = None,
) -> BearerResult:
    """The one bearer token of a request (``spec/authorization.md``, M2), or the rule it breaks.

    Args:
        authorization: Every ``Authorization`` header value, in order (``[]`` for none).
        query: The request's query string without its ``?``, or ``None``.
        form_body: The body of a request whose ``Content-Type`` is
            ``application/x-www-form-urlencoded``, or ``None``.

    Returns:
        :class:`BearerToken` or :class:`BearerRefusal` with ``token-location`` (a token in the
        query or a form body, or a second header; checked first), ``no-token``, or
        ``token-malformed`` (not ``Bearer <b64token>``).
    """
    if (
        (query is not None and names_access_token(query))
        or (form_body is not None and names_access_token(form_body))
        or len(authorization) > 1
    ):
        return BearerRefusal(refused="token-location")
    if not authorization:
        return BearerRefusal(refused="no-token")
    token = _parse_bearer(authorization[0])
    return BearerRefusal(refused="token-malformed") if token is None else BearerToken(token=token)


__all__ = [
    "BearerRefusal",
    "BearerResult",
    "BearerToken",
    "extract_bearer",
    "names_access_token",
]
