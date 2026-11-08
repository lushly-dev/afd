"""A call's principal binding (``spec/authorization.md``, M8).

Who is calling, as one canonical JSON text: the actor's ``kind``, ``id`` and ``onBehalfOf``
(never ``label``) and the credentials' ``issuer``, ``subject`` and ``clientId``. Confirmation
``requestState`` binds it (#532), so an answer one caller gave never counts for another, even a
different client of the same person.

The text names the caller: bind it (as HMAC or AEAD input), never log or send it.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from afd.core.actor import Actor
from afd.server.approval import _canonical_json


@dataclass(frozen=True)
class PrincipalCredentials:
    """The identity of a call's verified credentials (``spec/authorization.md``, M4).

    A principal binding holds these three and nothing else of the credentials (never scopes,
    times or the resource). Each must be a non-empty string: a binding that could not tell two
    callers apart is never made. Python does not verify tokens itself: the server takes them from
    the MCP SDK's verified access token (:func:`sdk_credentials`).
    """

    issuer: str
    subject: str
    client_id: str

    def __post_init__(self) -> None:
        for name in ("issuer", "subject", "client_id"):
            value = getattr(self, name)
            if not isinstance(value, str) or not value:
                raise IncompleteCredentials()


class IncompleteCredentials(TypeError):
    """Credentials without a non-empty issuer, subject and client id: no principal binding is
    made of them, so no confirmation state is minted or accepted for the call. The message
    names no one."""

    def __init__(self) -> None:
        super().__init__("credentials lack an issuer, subject or client id")


def _identity(credentials: PrincipalCredentials | Mapping[str, Any] | None) -> dict[str, Any] | None:
    if credentials is None:
        return None
    if isinstance(credentials, Mapping):
        credentials = PrincipalCredentials(
            issuer=credentials.get("issuer"),
            subject=credentials.get("subject"),
            client_id=credentials.get("clientId"),
        )
    if not isinstance(credentials, PrincipalCredentials):
        raise IncompleteCredentials()
    return {
        "issuer": credentials.issuer,
        "subject": credentials.subject,
        "clientId": credentials.client_id,
    }


def _actor_identity(actor: Actor | None) -> dict[str, Any] | None:
    if actor is None:
        return None
    if not isinstance(actor, Actor):
        raise TypeError("actor must be an Actor")
    fields = {"kind": actor.kind, "id": actor.id, "onBehalfOf": actor.on_behalf_of}
    # An unset field is left out, as TypeScript drops `undefined` members.
    return {name: value for name, value in fields.items() if value is not None}


def principal_binding(
    actor: Actor | None,
    credentials: PrincipalCredentials | Mapping[str, Any] | None = None,
) -> str:
    """A call's principal binding: the canonical JSON of ``{"actor": ..., "credentials": ...}``.

    ``credentials`` is a :class:`PrincipalCredentials`, or a mapping with ``issuer``,
    ``subject`` and ``clientId`` (other members are ignored). Two calls share a binding only
    when their actor and their token's issuer, subject and client are the same.

    Raises:
        TypeError: For an actor that is not an :class:`Actor`.
        IncompleteCredentials: For credentials without a non-empty string ``issuer``,
            ``subject`` and ``clientId`` (a ``TypeError``).
    """
    return _canonical_json({"actor": _actor_identity(actor), "credentials": _identity(credentials)})


def credentials_binding(credentials: PrincipalCredentials | Mapping[str, Any] | None = None) -> str:
    """The credentials' part of a principal binding alone (relay evidence's
    ``credentialsBinding``): the canonical JSON of ``{issuer, subject, clientId}``, or ``null``.
    """
    return _canonical_json(_identity(credentials))


def sdk_credentials() -> PrincipalCredentials | None:
    """The identity of the access token the MCP SDK verified for the request being served, or
    ``None`` on a transport without one (stdio, or a server without SDK authorization).

    Raises:
        IncompleteCredentials: A token is present but its issuer (``iss``), subject or client
            id is missing or empty, so the call cannot be bound.
    """
    try:
        from mcp.server.auth.middleware.auth_context import get_access_token
    except ImportError:  # pragma: no cover - optional dependency
        return None
    token = get_access_token()
    if token is None:
        return None
    issuer = (token.claims or {}).get("iss")
    if not isinstance(issuer, str):
        raise IncompleteCredentials()
    return PrincipalCredentials(issuer=issuer, subject=token.subject, client_id=token.client_id)


__all__ = [
    "IncompleteCredentials",
    "PrincipalCredentials",
    "credentials_binding",
    "principal_binding",
    "sdk_credentials",
]
