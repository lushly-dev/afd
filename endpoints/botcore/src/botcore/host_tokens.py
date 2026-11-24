"""Bearer tokens for a host served over HTTP: one per caller, bound to one route.

The store is a JSON file only the operator account reads. It keeps each token's SHA-256, never
the token, with the route it opens and the actor it names. Tokens are issued, listed and
revoked from the operator's own shell (``botcore host-token``), never over a route. The file is
re-read when it changes, so a revocation takes effect on the next call without a restart.

Every change takes an exclusive OS lock on ``<store>.lock``, writes a fresh temporary file,
syncs it and renames it into place, so a reader sees the old file or the new one, never a partial
one. Windows readers share that lock to keep open files apart from replacement; native ACLs
allow only the operator account, SYSTEM and Administrators.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import sys
import tempfile
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager, nullcontext
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

if sys.platform == "win32":
    from ._windows_security import ensure_directory, open_private, pinned_directory

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

    def public(self) -> dict[str, Any]:
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
        self.path = Path(os.path.abspath(path)) if sys.platform == "win32" else Path(path)
        self._lock = threading.Lock()
        self._loaded: tuple[tuple[int, ...], dict[str, TokenRecord]] | None = None

    # ── file ──────────────────────────────────────────────────────────────

    def _read(self) -> dict[str, dict[str, Any]]:
        if sys.platform == "win32":
            try:
                descriptor = open_private(self.path)
            except FileNotFoundError:
                return {}
            with os.fdopen(descriptor, encoding="utf-8") as handle:
                raw: dict[str, Any] = json.load(handle)
                tokens = raw.get("tokens", {})
                return tokens if isinstance(tokens, dict) else {}
        if not self.path.exists():
            return {}
        data: dict[str, Any] = json.loads(self.path.read_text(encoding="utf-8"))
        tokens = data.get("tokens", {})
        return tokens if isinstance(tokens, dict) else {}

    def _directory(self) -> Path:
        directory = self.path.parent
        if sys.platform == "win32":
            ensure_directory(directory)
        elif not directory.exists():
            directory.mkdir(parents=True, mode=0o700)
        return directory

    @contextmanager
    def _exclusive(self) -> Iterator[None]:
        """This process's lock, and an OS lock on ``<store>.lock`` across processes."""
        with self._lock:
            if sys.platform == "win32":
                guard: Any = pinned_directory(self.path.parent)
            else:
                guard = nullcontext(self._directory())
            with guard as directory:
                lock = directory / f"{self.path.name}.lock"
                if sys.platform == "win32":
                    descriptor = open_private(lock, create=True, lock=True)
                else:
                    descriptor = os.open(
                        lock, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600
                    )
                try:
                    if sys.platform == "win32":
                        import msvcrt

                        # LK_LOCK retries once a second, which would stall an HTTP
                        # handler for a second on any contention. Poll instead, with
                        # the same ten-second limit, and fail closed past it.
                        deadline = time.monotonic() + 10
                        while True:
                            try:
                                msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
                                break
                            except OSError:
                                if time.monotonic() >= deadline:
                                    raise
                                time.sleep(0.01)
                    else:
                        import fcntl

                        fcntl.flock(descriptor, fcntl.LOCK_EX)
                    yield
                finally:
                    os.close(descriptor)  # Closing releases the OS lock.

    @contextmanager
    def _reading(self) -> Iterator[None]:
        # Windows' CRT readers can prevent replacement. The shared store lock also
        # prevents a reader from observing another process between read and write.
        with self._exclusive() if sys.platform == "win32" else self._lock:
            yield

    def _write(self, tokens: dict[str, dict[str, Any]]) -> None:
        """Replace the store atomically; call inside ``_exclusive``."""
        directory = self._directory()
        if sys.platform == "win32":
            temporary = directory / f".{self.path.name}.{secrets.token_hex(16)}"
            descriptor = open_private(temporary, create=True)
        else:
            # mkstemp creates a new file (O_EXCL), readable by the owner only.
            descriptor, temp_path = tempfile.mkstemp(prefix=f".{self.path.name}.", dir=directory)
            temporary = Path(temp_path)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump({"version": 1, "tokens": tokens}, handle, indent=2, sort_keys=True)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
        self._loaded = None

    def _stamp(self) -> tuple[int, ...]:
        try:
            if sys.platform == "win32":
                descriptor = open_private(self.path)
                try:
                    info = os.fstat(descriptor)
                finally:
                    os.close(descriptor)
            else:
                info = self.path.stat()
        except FileNotFoundError:
            return ()
        return (info.st_ino, info.st_mtime_ns, info.st_size)

    def _by_digest(self) -> dict[str, TokenRecord]:
        stamp = self._stamp()
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
        with self._exclusive():
            tokens = self._read()
            tokens[_digest(secret)] = record.public()
            self._write(tokens)
        return record, secret

    def verify(self, secret: str | None) -> TokenRecord | None:
        """The active record ``secret`` names, or None."""
        if not secret or not secret.startswith(PREFIX):
            return None
        with self._reading():
            record = self._by_digest().get(_digest(secret))
        return record if record is not None and record.active else None

    def list(self) -> list[TokenRecord]:
        with self._reading():
            return sorted(self._by_digest().values(), key=lambda r: (r.route, r.issued_at))

    def revoke(self, token_id: str) -> TokenRecord | None:
        """Revoke the token with ``token_id``; None when there is none. Revoking twice keeps
        the first time."""
        with self._exclusive():
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
