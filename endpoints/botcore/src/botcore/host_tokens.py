"""Bearer tokens for a host served over HTTP: one per caller, bound to one route.

The store is a JSON file only the operator account reads. It keeps each token's SHA-256, never
the token, with the route it opens and the actor it names. Tokens are issued, listed and
revoked from the operator's own shell (``botcore host-token``), never over a route. The file is
re-read when it changes, so a revocation takes effect on the next call without a restart.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

PREFIX = "bct_"
ACTOR_KINDS = ("human", "agent", "service")


def _digest(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(frozen=True)
class TokenRecord:
    id: str
    route: str
    kind: str
    actor: str
    label: str | None
    issued_at: str
    revoked_at: str | None = None

    @property
    def active(self) -> bool:
        return self.revoked_at is None

    def public(self) -> dict:
        """What ``list`` shows: everything but the digest, which the record never holds."""
        return {
            "id": self.id,
            "route": self.route,
            "kind": self.kind,
            "actor": self.actor,
            "label": self.label,
            "issuedAt": self.issued_at,
            "revokedAt": self.revoked_at,
        }


class TokenStore:
    """Tokens in ``path``: issue, verify, list and revoke."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._lock = threading.Lock()
        self._loaded: tuple[float, dict[str, TokenRecord]] | None = None

    # ── file ──────────────────────────────────────────────────────────────

    def _read(self) -> dict[str, dict]:
        if not self.path.exists():
            return {}
        data = json.loads(self.path.read_text(encoding="utf-8"))
        return data.get("tokens", {})

    def _write(self, tokens: dict[str, dict]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        # Created readable by the owner only, then moved into place.
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump({"version": 1, "tokens": tokens}, handle, indent=2, sort_keys=True)
        os.replace(temporary, self.path)
        self._loaded = None

    def _by_digest(self) -> dict[str, TokenRecord]:
        stamp = self.path.stat().st_mtime_ns if self.path.exists() else -1.0
        if self._loaded is None or self._loaded[0] != stamp:
            records = {}
            for digest, row in self._read().items():
                records[digest] = TokenRecord(
                    id=row["id"],
                    route=row["route"],
                    kind=row["kind"],
                    actor=row["actor"],
                    label=row.get("label"),
                    issued_at=row["issuedAt"],
                    revoked_at=row.get("revokedAt"),
                )
            self._loaded = (stamp, records)
        return self._loaded[1]

    # ── operations ────────────────────────────────────────────────────────

    def issue(
        self, route: str, kind: str, actor: str, label: str | None = None
    ) -> tuple[TokenRecord, str]:
        """A new token for ``route`` naming ``kind``/``actor``; returns it once, with its
        record. Only its digest is stored."""
        if kind not in ACTOR_KINDS:
            raise ValueError(f"kind must be one of {', '.join(ACTOR_KINDS)}, not {kind!r}")
        if not route or not actor:
            raise ValueError("A token needs a route and an actor id")
        secret = PREFIX + secrets.token_urlsafe(32)
        record = TokenRecord(
            id=secrets.token_hex(4),
            route=route,
            kind=kind,
            actor=actor,
            label=label,
            issued_at=_now(),
        )
        with self._lock:
            tokens = self._read()
            tokens[_digest(secret)] = record.public()
            self._write(tokens)
        return record, secret

    def verify(self, secret: str | None) -> TokenRecord | None:
        """The active record ``secret`` names, or None."""
        if not secret or not secret.startswith(PREFIX):
            return None
        with self._lock:
            record = self._by_digest().get(_digest(secret))
        return record if record is not None and record.active else None

    def list(self) -> list[TokenRecord]:
        with self._lock:
            return sorted(self._by_digest().values(), key=lambda r: (r.route, r.issued_at))

    def revoke(self, token_id: str) -> TokenRecord | None:
        """Revoke the token with ``token_id``; None when there is none. Revoking twice keeps
        the first time."""
        with self._lock:
            tokens = self._read()
            for row in tokens.values():
                if row["id"] == token_id:
                    row.setdefault("revokedAt", None)
                    row["revokedAt"] = row["revokedAt"] or _now()
                    self._write(tokens)
                    return TokenRecord(
                        id=row["id"],
                        route=row["route"],
                        kind=row["kind"],
                        actor=row["actor"],
                        label=row.get("label"),
                        issued_at=row["issuedAt"],
                        revoked_at=row["revokedAt"],
                    )
        return None


__all__ = ["ACTOR_KINDS", "PREFIX", "TokenRecord", "TokenStore"]
