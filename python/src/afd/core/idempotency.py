"""Idempotency keys (``spec/idempotency.md``): what a command declares about repeats, the key a
caller sends, its form (K2) and the keys a batch or pipeline derives from it (K4).

These are the shared definitions. The engine decides a call's key with
:mod:`afd.core.idempotency_keys`, and the server's idempotency step is
:mod:`afd.server.idempotency_step`.
"""

from __future__ import annotations

import re
from typing import Literal, TypeGuard

from afd.core.errors import CommandError, ErrorCodes, create_error

AFD_IDEMPOTENCY_KEY_META_KEY = "dev.afd/idempotencyKey"
"""The ``_meta`` key a caller sends an idempotency key in (K1)."""

IdempotencySupport = Literal["natural", "keyed"]
"""What a command declares about repeating a call (D1 to D5): ``natural`` when a repeat leaves the
same state as one call, ``keyed`` when a repeat that carries the same key and input is safe."""

_KEY_FORM = re.compile(r"[A-Za-z0-9._~-]{1,200}", re.ASCII)


def is_idempotency_support(value: object) -> TypeGuard[IdempotencySupport]:
    """Whether ``value`` is one of the declared values, ``natural`` or ``keyed``."""
    return value in ("natural", "keyed")


def is_idempotency_key(value: object) -> TypeGuard[str]:
    """Whether ``value`` is a key a caller may send (K2): 1 to 200 characters, each one of
    ``A-Z a-z 0-9 . _ ~ -``. A derived key, which holds ``:``, is not."""
    return isinstance(value, str) and _KEY_FORM.fullmatch(value) is not None


def derive_idempotency_key(base: str, kind: Literal["batch", "pipeline"], index: int) -> str:
    """The key the item or step at 0-based ``index`` of a batch or pipeline runs under (K4):
    ``<base>:<index>`` for a batch item, ``<base>:step:<index>`` for a pipeline step."""
    return f"{base}:{index}" if kind == "batch" else f"{base}:step:{index}"


def invalid_idempotency_key_error() -> CommandError:
    """The ``VALIDATION_ERROR`` for a key that is not of K2's form."""
    return create_error(
        ErrorCodes.VALIDATION_ERROR,
        "The idempotency key is not valid",
        suggestion=(
            f'Send _meta["{AFD_IDEMPOTENCY_KEY_META_KEY}"] as a string of 1 to 200 characters, '
            "each one of A-Z a-z 0-9 . _ ~ -, or leave it out"
        ),
        retryable=False,
        details={"field": "idempotencyKey", "meta": AFD_IDEMPOTENCY_KEY_META_KEY},
    )
