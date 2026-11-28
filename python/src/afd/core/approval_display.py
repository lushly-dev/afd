"""The approval display rules (``spec/approvals.md``, "Approval display"): what a person must
be able to read in full before approving an action.

An approver, or any surface that shows a person a held call, shows the call's validated input
only when :func:`approval_display` accepts it, and otherwise shows none of it and offers no
approval: a person cannot approve what they cannot see, and truncating is not showing.

Mirrors ``packages/core/src/approval-display.ts`` and ``packages/rust/src/approval_display.rs``:
sizes are measured in UTF-16 code units, keys are visited in canonical UTF-16 code-unit order,
and checks run in a fixed order so every language gives the same answer
(``spec/vectors/approver-client.json``, ``display``).
"""

from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass
from typing import Any, Literal

from afd.core._canonical_json import _utf16_key, canonical_json

__all__ = [
    "APPROVAL_DISPLAY_LIMITS",
    "ApprovalDisplay",
    "ApprovalDisplayLimits",
    "ApprovalDisplayRefusal",
    "approval_display",
    "hides_characters",
    "is_hidden_code_point",
]


@dataclass(frozen=True)
class ApprovalDisplayLimits:
    """The limits of :func:`approval_display`. Lengths count UTF-16 code units."""

    max_serialized_length: int = 8_000
    """The input's canonical JSON."""
    max_string_length: int = 2_000
    """One string value."""
    max_key_length: int = 200
    """One object key."""
    max_depth: int = 6
    """Nesting: the input is at depth 0, its members and items at 1."""
    max_values: int = 400
    """Values visited, the input itself included."""


APPROVAL_DISPLAY_LIMITS = ApprovalDisplayLimits()
"""The limits the approval display rules apply."""

ApprovalDisplayRefusal = Literal[
    "not-json",
    "too-long",
    "too-many-values",
    "too-deep",
    "string-too-long",
    "key-too-long",
    "hidden-characters",
]
"""Why :func:`approval_display` refused an input, in the order the checks run."""


@dataclass(frozen=True)
class ApprovalDisplay:
    """The verdict of :func:`approval_display`: the input as plain JSON to show, or why not."""

    ok: bool
    value: Any = None
    refusal: ApprovalDisplayRefusal | None = None


_STACKED_MARK_LIMIT = 6
_MISSING = object()


def is_hidden_code_point(code: int) -> bool:
    """Whether one code point makes what a person reads differ from what runs, or draws nothing:
    controls other than tab and line feed, the soft hyphen, bidirectional marks, embeddings,
    overrides and isolates, zero-width characters, line and paragraph separators, invisible
    operators, blank look-alikes, variation selectors other than U+FE0E and U+FE0F, the byte order
    mark, interlinear annotations, format controls, tags and reserved ignorables, and surrogates.
    """
    if isinstance(code, bool) or not isinstance(code, int) or code < 0:
        return False
    return (
        (code < 0x20 and code not in (0x09, 0x0A))
        or (0x7F <= code <= 0x9F)
        or code
        in (
            0x00AD,
            0x034F,
            0x061C,
            0x115F,
            0x1160,
            0x17B4,
            0x17B5,
            0x2028,
            0x2029,
            0x2800,
            0x3164,
            0xFEFF,
            0xFFA0,
        )
        or (0x180B <= code <= 0x180F)
        or (0x200B <= code <= 0x200F)
        or (0x202A <= code <= 0x202E)
        or (0x2060 <= code <= 0x206F)
        or (0xD800 <= code <= 0xDFFF)
        or (0xFE00 <= code <= 0xFE0D)
        or (0xFFF0 <= code <= 0xFFFB)
        or (0x1BCA0 <= code <= 0x1BCA3)
        or (0x1D173 <= code <= 0x1D17A)
        or (0xE0000 <= code <= 0xE0FFF)
    )


def hides_characters(text: str) -> bool:
    """Whether ``text`` holds a hidden code point (:func:`is_hidden_code_point`) or a run of six
    or more combining marks (Unicode general category ``M``).
    """
    marks = 0
    for ch in text:
        if is_hidden_code_point(ord(ch)):
            return True
        if unicodedata.category(ch).startswith("M"):
            marks += 1
            if marks >= _STACKED_MARK_LIMIT:
                return True
        else:
            marks = 0
    return False


def _utf16_len(text: str) -> int:
    return len(text.encode("utf-16-le", "surrogatepass")) // 2


def approval_display(input: Any = _MISSING) -> ApprovalDisplay:
    """Whether a person can be shown ``input`` in full before approving it, and if so the input as
    plain JSON, as parsed from its canonical JSON.

    The checks, in order: the input is plain JSON (approval tokens' canonical JSON accepts it);
    its canonical JSON is at most 8000 UTF-16 code units; then, depth first through keys in
    canonical UTF-16 code-unit order, each value is at most the 400th visited and at depth 6 or
    less, each string at most 2000 code units and each key at most 200, and none hides characters.
    The first failure is the refusal. An omitted input is ``{}``; ``None`` is ``None`` (``null``).
    """
    raw = {} if input is _MISSING else input
    try:
        text = canonical_json(raw)
        if _utf16_len(text) > APPROVAL_DISPLAY_LIMITS.max_serialized_length:
            return ApprovalDisplay(ok=False, refusal="too-long")
        value = json.loads(text)
    except (TypeError, ValueError, RecursionError):
        return ApprovalDisplay(ok=False, refusal="not-json")
    visited = 0
    # Iterative DFS matching TypeScript and Rust: an object's key is checked just before its value.
    pending: list[tuple[Literal["value", "key"], Any, int]] = [("value", value, 0)]
    while pending:
        kind, item, depth = pending.pop()
        if kind == "key":
            if _utf16_len(item) > APPROVAL_DISPLAY_LIMITS.max_key_length:
                return ApprovalDisplay(ok=False, refusal="key-too-long")
            if hides_characters(item):
                return ApprovalDisplay(ok=False, refusal="hidden-characters")
            continue

        visited += 1
        if visited > APPROVAL_DISPLAY_LIMITS.max_values:
            return ApprovalDisplay(ok=False, refusal="too-many-values")
        if depth > APPROVAL_DISPLAY_LIMITS.max_depth:
            return ApprovalDisplay(ok=False, refusal="too-deep")
        if isinstance(item, str):
            if _utf16_len(item) > APPROVAL_DISPLAY_LIMITS.max_string_length:
                return ApprovalDisplay(ok=False, refusal="string-too-long")
            if hides_characters(item):
                return ApprovalDisplay(ok=False, refusal="hidden-characters")
        elif isinstance(item, list):
            for element in reversed(item):
                pending.append(("value", element, depth + 1))
        elif isinstance(item, dict):
            keys = sorted(item.keys(), key=_utf16_key)
            for key in reversed(keys):
                pending.append(("value", item[key], depth + 1))
                pending.append(("key", key, depth))
    return ApprovalDisplay(ok=True, value=value)
