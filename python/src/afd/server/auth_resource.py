"""The protected resource: its URI, the audience rule, the RFC 9728 metadata and the
challenges that point to it (``spec/authorization.md``, M3.1, M5 and M7)."""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

PROTECTED_RESOURCE_WELL_KNOWN = "/.well-known/oauth-protected-resource"
"""The well-known suffix of protected-resource metadata (RFC 9728 3.1)."""

# A scope token (RFC 6749 3.3): one or more of %x21 / %x23-5B / %x5D-7E.
_SCOPE_TOKEN = re.compile(r"\A[\x21\x23-\x5B\x5D-\x7E]+\Z", re.ASCII)
_VISIBLE_ASCII = re.compile(r"\A[\x21-\x7E]+\Z", re.ASCII)
_FORBIDDEN = re.compile(r'[?#"\\<>`{}|^]', re.ASCII)
_SCHEME = re.compile(r"\A[A-Za-z][A-Za-z0-9+.-]*\Z", re.ASCII)
_DIGITS = re.compile(r"\A[0-9]*\Z", re.ASCII)


def is_scope_token(scope: Any) -> bool:
    """Whether ``scope`` is one OAuth scope token (RFC 6749 3.3)."""
    return isinstance(scope, str) and _SCOPE_TOKEN.match(scope) is not None


@dataclass(frozen=True)
class _UrlParts:
    scheme: str
    host: str
    port: str | None
    path: str
    origin: str


def _split_url(url: str) -> _UrlParts | None:
    """``url`` split for comparison, or ``None`` when it is not ``scheme://host[:port][path]``
    in visible ASCII with no user information, query or fragment. Nothing is normalized."""
    if _VISIBLE_ASCII.match(url) is None or _FORBIDDEN.search(url) is not None:
        return None
    separator = url.find("://")
    if separator < 0:
        return None
    scheme = url[:separator]
    if _SCHEME.match(scheme) is None:
        return None
    rest = url[separator + 3 :]
    slash = rest.find("/")
    authority = rest if slash < 0 else rest[:slash]
    path = "" if slash < 0 else rest[slash:]
    if authority == "" or "@" in authority:
        return None
    if authority.startswith("["):
        close = authority.find("]")
        if close < 0:
            return None
        host = authority[: close + 1]
        after = authority[close + 1 :]
        if after == "":
            port: str | None = None
        else:
            if not after.startswith(":"):
                return None
            port = after[1:]
    else:
        colon = authority.rfind(":")
        if colon < 0:
            host = authority
            port = None
        else:
            host = authority[:colon]
            port = authority[colon + 1 :]
    if (
        host == ""
        or (":" in host and not host.startswith("["))
        or (port is not None and _DIGITS.match(port) is None)
    ):
        return None
    return _UrlParts(
        scheme=scheme,
        host=host,
        port=port,
        path=path,
        origin=url[: separator + 3 + len(authority)],
    )


def _same_resource(resource: str, candidate: str) -> bool:
    """Whether ``candidate`` names ``resource`` (``spec/authorization.md``, M3.1)."""
    expected = _split_url(resource)
    actual = _split_url(candidate)
    if expected is None or actual is None:
        return False
    return (
        expected.scheme.lower() == actual.scheme.lower()
        and expected.host.lower() == actual.host.lower()
        and expected.port == actual.port
        and expected.path == actual.path
    )


def audience_accepts(aud: Any, resource: str) -> bool:
    """Whether an ``aud`` claim accepts ``resource`` (``spec/authorization.md``, M3.1).

    ``aud`` must be a string, or a list/tuple of exactly one string, naming ``resource``.
    A token with several audiences is refused even when one matches.
    """
    if isinstance(aud, str):
        return _same_resource(resource, aud)
    if isinstance(aud, (list, tuple)) and len(aud) == 1 and isinstance(aud[0], str):
        return _same_resource(resource, aud[0])
    return False


def assert_https_url(what: str, url: Any) -> str:
    """Raise ``ValueError`` unless ``url`` is an absolute ``https`` URL in visible ASCII
    with no user information, query or fragment."""
    parts = _split_url(url) if isinstance(url, str) else None
    if parts is None or parts.scheme.lower() != "https":
        raise ValueError(
            f"[AFD] {what} {json.dumps(url) if isinstance(url, (str, int, float, bool)) or url is None else repr(url)} "
            "is not an absolute https URL without user information, query or fragment"
        )
    return url


def _joined_tokens(scopes: Sequence[str]) -> str:
    """The scope tokens of ``scopes``, joined by single spaces; anything else is left out."""
    return " ".join(scope for scope in scopes if is_scope_token(scope))


@dataclass(frozen=True)
class ProtectedResource:
    """RFC 9728 protected-resource metadata, the URLs it is served at and the challenges
    that point to it (``spec/authorization.md``, M5 and M7)."""

    resource: str
    authorization_servers: tuple[str, ...]
    metadata_urls: tuple[str, ...]
    metadata_paths: tuple[str, ...]
    scopes_supported: tuple[str, ...]
    resource_name: str | None
    require_bound_tokens: bool

    def document(self) -> dict[str, Any]:
        """The metadata document. Nothing else is published."""
        doc: dict[str, Any] = {
            "resource": self.resource,
            "authorization_servers": list(self.authorization_servers),
        }
        if self.scopes_supported:
            doc["scopes_supported"] = list(self.scopes_supported)
        doc["bearer_methods_supported"] = ["header"]
        if self.resource_name is not None:
            doc["resource_name"] = self.resource_name
        doc["tls_client_certificate_bound_access_tokens"] = self.require_bound_tokens
        return doc

    def unauthorized_challenge(self, token_sent: bool) -> str:
        """The 401's ``WWW-Authenticate`` value; ``error="invalid_token"`` when a token was sent."""
        challenge = f'Bearer resource_metadata="{self.metadata_urls[0]}"'
        if self.scopes_supported:
            challenge += f', scope="{" ".join(self.scopes_supported)}"'
        if token_sent:
            challenge += ', error="invalid_token"'
        return challenge

    def unauthorized_body(self) -> dict[str, str]:
        """The 401's JSON body."""
        return {
            "error": "UNAUTHORIZED",
            "suggestion": (
                f"Obtain a token for {self.resource} from an authorization server "
                f"named in {self.metadata_urls[0]}."
            ),
        }

    def forbidden_challenge(self, missing: Sequence[str]) -> str:
        """The 403's ``WWW-Authenticate`` value for the ``missing`` scopes, in order."""
        joined = _joined_tokens(missing)
        if joined:
            return (
                f'Bearer error="insufficient_scope", scope="{joined}", '
                f'resource_metadata="{self.metadata_urls[0]}"'
            )
        return f'Bearer error="insufficient_scope", resource_metadata="{self.metadata_urls[0]}"'

    def forbidden_body(
        self, missing: Sequence[str], scope_source: str | None = None
    ) -> dict[str, str]:
        """The 403's JSON body for the ``missing`` scopes."""
        joined = _joined_tokens(missing)
        source = scope_source if scope_source is not None else f"a token for {self.resource}"
        if joined:
            suggestion = f"Obtain {source} that also grants {joined}, then retry."
        else:
            suggestion = f"Obtain {source} that grants the scopes this call needs, then retry."
        return {
            "error": "INSUFFICIENT_SCOPE",
            "suggestion": suggestion,
        }


def create_protected_resource(
    resource: str,
    authorization_servers: Sequence[str],
    *,
    scopes_supported: Sequence[str] = (),
    resource_name: str | None = None,
    require_bound_tokens: bool = False,
) -> ProtectedResource:
    """Build and validate RFC 9728 protected-resource metadata for ``resource``.

    Raises:
        ValueError: When ``resource`` or an authorization server is not an absolute ``https``
            URL without user information, query or fragment; no authorization server is named
            or one is named twice; a published scope is not a scope token or is repeated; or
            ``resource_name`` is not a string when provided.
    """
    assert_https_url("resource", resource)
    if isinstance(authorization_servers, (str, bytes)) or not isinstance(
        authorization_servers, Sequence
    ):
        raise ValueError("[AFD] authorization_servers must be a sequence of https URLs")
    servers: list[str] = []
    for server in authorization_servers:
        assert_https_url("authorization server", server)
        if server in servers:
            raise ValueError(f"[AFD] authorization server {json.dumps(server)} is named twice")
        servers.append(server)
    if not servers:
        raise ValueError("[AFD] protected-resource metadata needs at least one authorization server")

    if isinstance(scopes_supported, (str, bytes)) or not isinstance(scopes_supported, Sequence):
        raise ValueError("[AFD] scopes_supported must be a sequence of scope tokens")
    scopes: list[str] = []
    for scope in scopes_supported:
        if not is_scope_token(scope):
            raise ValueError(f"[AFD] scope {scope!r} is not an OAuth scope token")
        if scope in scopes:
            raise ValueError(f"[AFD] scope {json.dumps(scope)} is published twice")
        scopes.append(scope)

    if resource_name is not None and not isinstance(resource_name, str):
        raise ValueError("[AFD] resource_name must be a string")
    if not isinstance(require_bound_tokens, bool):
        raise ValueError("[AFD] require_bound_tokens must be a bool")

    parts = _split_url(resource)
    assert parts is not None
    bare = f"{parts.origin}{PROTECTED_RESOURCE_WELL_KNOWN}"
    only_origin = parts.path in ("", "/")
    metadata_urls = (bare,) if only_origin else (f"{bare}{parts.path}", bare)
    metadata_paths = (
        (PROTECTED_RESOURCE_WELL_KNOWN,)
        if only_origin
        else (f"{PROTECTED_RESOURCE_WELL_KNOWN}{parts.path}", PROTECTED_RESOURCE_WELL_KNOWN)
    )
    return ProtectedResource(
        resource=resource,
        authorization_servers=tuple(servers),
        metadata_urls=metadata_urls,
        metadata_paths=metadata_paths,
        scopes_supported=tuple(scopes),
        resource_name=resource_name,
        require_bound_tokens=require_bound_tokens,
    )


__all__ = [
    "PROTECTED_RESOURCE_WELL_KNOWN",
    "ProtectedResource",
    "assert_https_url",
    "audience_accepts",
    "create_protected_resource",
    "is_scope_token",
]
