"""Title order as JavaScript's ``a.localeCompare(b)`` gives it, so a list sorted by title comes
out the same from the TypeScript and Python backends.

``localeCompare`` with no locale uses ICU's root collation (CLDR), in three levels:

1. **Base letters**, ignoring accents and case. Whitespace sorts first, then punctuation and
   symbols in CLDR's order (not code-point order), then digits, then letters. A few letters
   expand (``ß`` = ``ss``, ``æ`` = ``ae``, ``œ`` = ``oe``) or are their own variant of a base
   letter (``ø``, ``ł``, ``đ``).
2. **Accents**, left to right: none first, then acute, grave, breve, circumflex and so on.
3. **Case**, left to right: lowercase first.

This module covers what to-do titles hold: Latin letters with their accents, digits,
whitespace and ASCII punctuation; other scripts sort after Latin by code point. It is not a full
implementation of the Unicode Collation Algorithm. ``tests/test_collation.py`` checks it against
orders taken from Node.js, and ``pnpm test:interop`` compares both backends' lists.
"""

from __future__ import annotations

import unicodedata

# CLDR root order of ASCII whitespace-free punctuation and symbols (from Node.js's localeCompare).
_PUNCTUATION = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$"

# Accent (combining mark) order at the second level, from Node.js's localeCompare.
_ACCENTS = [
    0x301,  # acute
    0x300,  # grave
    0x306,  # breve
    0x302,  # circumflex
    0x30C,  # caron
    0x30A,  # ring above
    0x308,  # diaeresis
    0x30B,  # double acute
    0x303,  # tilde
    0x307,  # dot above
    0x327,  # cedilla
    0x328,  # ogonek
    0x304,  # macron
    0x323,  # dot below
    0x331,  # macron below
]
_ACCENT_WEIGHT = {mark: (index + 1) * 10 for index, mark in enumerate(_ACCENTS)}
_EXPANDED = 3000
"""The second-level weight of a letter that expands (ß of ss): after every accent and variant."""

# Letters that sort as base letters, with a second-level weight on the first of them. A letter
# that is its own variant of a base letter sits between two accents: ø between dot above and
# cedilla, ł and đ between macron and dot below.
_EXPANSIONS = {
    "ß": ("ss", _EXPANDED),
    "æ": ("ae", _EXPANDED),
    "œ": ("oe", _EXPANDED),
    "ø": ("o", 105),
    "ł": ("l", 135),
    "đ": ("d", 135),
}


def _primary(char: str) -> tuple[int, int]:
    if char.isspace():
        return (0, ord(char))
    index = _PUNCTUATION.find(char)
    if index >= 0:
        return (1, index)
    if char.isdigit():
        return (3, unicodedata.digit(char, 0))
    if char.isalpha():
        return (4, ord(char)) if "a" <= char <= "z" else (5, ord(char))
    return (2, ord(char))


def _accent(mark: str) -> int:
    return _ACCENT_WEIGHT.get(ord(mark), 1000 + ord(mark))


def title_key(
    title: str,
) -> tuple[tuple[tuple[int, int], ...], tuple[tuple[int, ...], ...], tuple[int, ...]]:
    """The sort key that orders titles as ``localeCompare`` does: base letters, then accents,
    then case."""
    primary: list[tuple[int, int]] = []
    accents: list[list[int]] = []
    case: list[int] = []
    for char in unicodedata.normalize("NFD", title):
        if unicodedata.combining(char):
            if accents:
                accents[-1].append(_accent(char))
            continue
        lower = char.lower()
        upper = 1 if lower != char else 0
        bases, weight = _EXPANSIONS.get(lower, (lower, None))
        for index, base in enumerate(bases):
            primary.append(_primary(base))
            accents.append([weight] if weight is not None and index == 0 else [])
            case.append(upper)
    return (tuple(primary), tuple(tuple(marks) for marks in accents), tuple(case))
