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
    times or the resource). Python does not verify tokens itself: the server takes them from the
    MCP SDK's verified access token, whose verifier may leave ``issuer`` or ``subject`` out;
    a component it leaves out is ``None`` (JSON ``null``), as the SDK's own principal does.
    """

    issuer: str | None
    subject: str | None
    client_id: str | None

    def __post_init__(self) -> None:
        for name in ("issuer", "subject", "client_id"):
            value = getattr(self, name)
            if value is not None and (not isinstance(value, str) or not value):
                raise TypeError(f"credentials {name} must be a non-empty string")


def _identity(credentials: PrincipalCredentials | Mapping[str, Any] | None) -> dict[str, Any] | None:
    if credentials is None:
        return None
    if isinstance(credentials, Mapping):
        if not all(
            isinstance(credentials.get(key), str) and credentials.get(key)
            for key in ("issuer", "subject", "clientId")
        ):
            # A binding that could not tell two callers apart must not be issued.
            raise TypeError("credentials must carry a non-empty issuer, subject and clientId")
        credentials = PrincipalCredentials(
            issuer=credentials["issuer"],
            subject=credentials["subject"],
            client_id=credentials["clientId"],
        )
    if not isinstance(credentials, PrincipalCredentials):
        raise TypeError("credentials must be PrincipalCredentials or a mapping")
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
        TypeError: For an actor that is not an :class:`Actor`, or credentials without a
            non-empty string ``issuer``, ``subject`` and ``clientId``.
    """
    return _canonical_json({"actor": _actor_identity(actor), "credentials": _identity(credentials)})


def credentials_binding(credentials: PrincipalCredentials | Mapping[str, Any] | None = None) -> str:
    """The credentials' part of a principal binding alone (relay evidence's
    ``credentialsBinding``): the canonical JSON of ``{issuer, subject, clientId}``, or ``null``.
    """
    return _canonical_json(_identity(credentials))


def sdk_credentials() -> PrincipalCredentials | None:
    """The identity of the access token the MCP SDK verified for the request being served, or
    ``None`` on a transport without one (stdio, or a server without SDK authorization)."""
    try:
        from mcp.server.auth.middleware.auth_context import get_access_token
    except ImportError:  # pragma: no cover - optional dependency
        return None
    token = get_access_token()
    if token is None:
        return None
    issuer = (token.claims or {}).get("iss")
    # An empty component counts as one the verifier left out.
    return PrincipalCredentials(
        issuer=str(issuer) or None if issuer is not None else None,
        subject=token.subject or None,
        client_id=token.client_id or None,
    )


__all__ = [
    "PrincipalCredentials",
    "credentials_binding",
    "principal_binding",
    "sdk_credentials",
]
