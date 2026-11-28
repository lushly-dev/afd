"""Canonical JSON for approval token bindings and the approval display rules.

Matches TypeScript's ``canonicalJson`` (``packages/core/src/canonical-json.ts``): object keys
sorted at every depth in UTF-16 code-unit order, otherwise as ``JSON.stringify`` writes it.
Lives in ``afd.core`` with no optional dependencies so :mod:`afd.core.approval_display` works
without ``afd[server]``.
"""

from __future__ import annotations

import math
from typing import Any

from afd.core.journal import _js_number, _js_string

# JavaScript numbers are doubles: past this, an integer could share a digest with its neighbour.
_MAX_SAFE_INTEGER = 2**53 - 1


def _utf16_key(key: str) -> bytes:
    return key.encode("utf-16-be", "surrogatepass")


def canonical_json(value: Any) -> str:
    """Stable JSON for binding a token or checking display rules: object keys sorted at every
    depth (in UTF-16 code-unit order, as JavaScript sorts them), otherwise as ``JSON.stringify``
    writes it.

    It fails closed rather than collide: only dicts with string keys, lists, tuples,
    strings, finite numbers (integers only when a JavaScript number holds them exactly),
    booleans and ``None`` are accepted. Anything else, or a cycle, raises.

    Raises:
        TypeError: For a value it cannot encode without ambiguity.
    """
    ancestors: set[int] = set()

    def encode(item: Any) -> str:
        if item is None:
            return "null"
        if item is True:
            return "true"
        if item is False:
            return "false"
        if isinstance(item, str):
            return _js_string(item)
        if isinstance(item, int):
            # Past 2**53 JavaScript holds a double: bind the integers a double represents
            # exactly, as TypeScript would, and refuse the rest (neighbours would collide).
            if abs(item) > _MAX_SAFE_INTEGER and (abs(item) >= 2**1024 or int(float(item)) != item):
                raise TypeError(
                    "Cannot bind an approval to an integer a JavaScript number cannot hold exactly"
                )
            return _js_number(item)
        if isinstance(item, float):
            if not math.isfinite(item):
                raise TypeError("Cannot bind an approval to a non-finite number")
            return _js_number(item)
        if isinstance(item, (dict, list, tuple)):
            marker = id(item)
            if marker in ancestors:
                raise TypeError("Cannot bind an approval to a cyclic input")
            ancestors.add(marker)
            try:
                if isinstance(item, dict):
                    if not all(isinstance(key, str) for key in item):
                        raise TypeError("Cannot bind an approval to an object with non-string keys")
                    members = sorted(item.items(), key=lambda member: _utf16_key(member[0]))
                    return (
                        "{"
                        + ",".join(f"{_js_string(key)}:{encode(member)}" for key, member in members)
                        + "}"
                    )
                return "[" + ",".join(encode(member) for member in item) + "]"
            finally:
                ancestors.discard(marker)
        raise TypeError(f"Cannot bind an approval to a {type(item).__name__}: use plain JSON input")

    return encode(value)
