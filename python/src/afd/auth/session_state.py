"""Session state comparison and expiry helpers.

Mirrors ``packages/auth/src/session-state.ts``.
"""

from __future__ import annotations

import math
import time
from datetime import UTC, datetime
from typing import Any

from afd.auth.types import AuthSessionState, Session, User

_EPOCH_UTC = datetime(1970, 1, 1, tzinfo=UTC)


def _to_epoch_ms(value: Any) -> float | None:
    """Convert a ``datetime`` (or ISO string / finite ms number) to epoch ms, or ``None`` if invalid."""
    if isinstance(value, datetime):
        is_aware = value.tzinfo is not None and value.tzinfo.utcoffset(value) is not None
        dt = value.astimezone(UTC) if is_aware else value.replace(tzinfo=UTC)
        ms = (dt - _EPOCH_UTC).total_seconds() * 1000.0
        return ms if math.isfinite(ms) else None
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return _to_epoch_ms(parsed)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            ms = float(value)
        except OverflowError:
            return None
        return ms if math.isfinite(ms) else None
    return None


def are_users_equal(left: User, right: User) -> bool:
    """Compare two :class:`User` values field by field."""
    return (
        left.id == right.id
        and left.email == right.email
        and left.name == right.name
        and left.image == right.image
    )


def _is_same_instant(left: Any, right: Any) -> bool:
    if left is None and right is None:
        return True
    if left is None or right is None:
        return False
    left_ms = _to_epoch_ms(left)
    right_ms = _to_epoch_ms(right)
    if left_ms is None or right_ms is None:
        return bool(left == right)
    return left_ms == right_ms


def are_session_states_equal(left: AuthSessionState, right: AuthSessionState) -> bool:
    """Compare two session states by value rather than object identity."""
    if left.status != right.status:
        return False
    if left.status != "authenticated" or right.status != "authenticated":
        return True
    return (
        left.session.id == right.session.id
        and _is_same_instant(left.session.expires_at, right.session.expires_at)
        and are_users_equal(left.user, right.user)
    )


def is_session_expired(session: Session, now_ms: float | None = None) -> bool:
    """Whether ``session`` has reached or passed its expiry.

    A session with ``expires_at is None`` does not expire here because its
    provider manages token lifetime. Any invalid or non-finite ``expires_at``
    or ``now_ms`` fails closed (returns ``True``).
    """
    if session.expires_at is None:
        return False
    expires_ms = _to_epoch_ms(session.expires_at)
    if expires_ms is None:
        return True
    if now_ms is None:
        now = time.time() * 1000.0
    elif isinstance(now_ms, bool) or not isinstance(now_ms, (int, float)):
        return True
    else:
        try:
            now = float(now_ms)
        except OverflowError:
            return True
    if not math.isfinite(now):
        return True
    return not (expires_ms > now)
