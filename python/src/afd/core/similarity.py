"""String similarity for "did you mean" suggestions on unknown command names.

Port of ``packages/core/src/similarity.ts``. Lengths and edit distances are
counted in UTF-16 code units, the way JavaScript counts string length, so the
TypeScript, Python and Rust engines cap, score and truncate a name the same
way. A character outside the Basic Multilingual Plane, such as an emoji, is
one Python character but two UTF-16 code units.
"""

from __future__ import annotations

import sys
from collections.abc import Iterable, Sequence

# Longest requested name (in UTF-16 code units) that find_similar_tools will
# fuzzy-match. Longer names get no suggestions: Levenshtein costs
# O(requested × candidate) per command, and the requested name is untrusted.
# Also the default length for truncate_name.
MAX_SIMILARITY_INPUT_LENGTH = 128

# Minimum similarity for a name to be suggested.
_MIN_SUGGESTION_SIMILARITY = 0.4

# Native byte order, so a memoryview cast to "H" reads each code unit as-is.
# "surrogatepass" keeps a lone surrogate (valid in both Python and JavaScript
# strings) as the one code unit JavaScript sees instead of raising.
_UTF16 = "utf-16-le" if sys.byteorder == "little" else "utf-16-be"


def _utf16_units(text: str) -> list[int]:
    """``text`` as the UTF-16 code units a JavaScript string holds."""
    return memoryview(text.encode(_UTF16, "surrogatepass")).cast("H").tolist()


def _levenshtein_distance(a: Sequence[int], b: Sequence[int]) -> int:
    """Levenshtein distance computed with two rolling rows, so memory is
    O(min(a, b)) instead of a full O(a × b) matrix."""
    # Keep the shorter sequence on the inner loop so the rows stay small.
    outer, inner = (a, b) if len(a) >= len(b) else (b, a)
    previous = list(range(len(inner) + 1))
    for i, outer_unit in enumerate(outer, start=1):
        current = [i]
        for j, inner_unit in enumerate(inner, start=1):
            current.append(
                min(
                    previous[j] + 1,  # deletion
                    current[j - 1] + 1,  # insertion
                    previous[j - 1] + (outer_unit != inner_unit),  # substitution
                )
            )
        previous = current
    return previous[-1]


def _lowercase_similarity(a: Sequence[int], b: Sequence[int]) -> float:
    """Similarity of two already-lowercased code unit sequences."""
    if a == b:
        return 1.0
    return 1 - _levenshtein_distance(a, b) / max(len(a), len(b))


def calculate_similarity(a: str, b: str) -> float:
    """Similarity of two strings from their Levenshtein distance.

    Returns a value between 0 (completely different) and 1 (identical).
    Case is ignored.
    """
    return _lowercase_similarity(_utf16_units(a.lower()), _utf16_units(b.lower()))


def find_similar_tools(
    requested_tool: str,
    available_tools: Iterable[str],
    max_suggestions: int = 3,
) -> list[str]:
    """Find similar tool/command names for suggestions.

    Returns names with similarity >= 0.4, most similar first. Returns no
    suggestions when ``requested_tool`` is longer than
    :data:`MAX_SIMILARITY_INPUT_LENGTH` UTF-16 code units.
    """
    # A character is one or two units, so check the cheap character count
    # first and never encode a huge name.
    if (
        len(requested_tool) > MAX_SIMILARITY_INPUT_LENGTH
        or len(_utf16_units(requested_tool)) > MAX_SIMILARITY_INPUT_LENGTH
    ):
        return []

    requested = _utf16_units(requested_tool.lower())
    matches: list[tuple[str, float]] = []
    for tool in available_tools:
        candidate = _utf16_units(tool.lower())
        # Length pre-filter. similarity = 1 - distance / max_len, and
        # distance >= |len(requested) - len(candidate)| because each insertion
        # or deletion changes the length by one and a substitution does not.
        # So no candidate can score above 1 - length_diff / max_len. When that
        # bound is under the threshold, skip the O(requested × candidate)
        # distance. The bound uses the same floating-point expression as the
        # score, so it never drops a candidate the full computation would keep.
        max_len = max(len(requested), len(candidate))
        length_diff = abs(len(requested) - len(candidate))
        if max_len > 0 and 1 - length_diff / max_len < _MIN_SUGGESTION_SIMILARITY:
            continue

        similarity = _lowercase_similarity(requested, candidate)
        if similarity >= _MIN_SUGGESTION_SIMILARITY:
            matches.append((tool, similarity))

    # sorted() is stable with reverse=True, so ties keep their input order,
    # as Array.prototype.sort does.
    matches.sort(key=lambda match: match[1], reverse=True)
    return [tool for tool, _ in matches[:max_suggestions]]


def truncate_name(name: str, max_length: int = MAX_SIMILARITY_INPUT_LENGTH) -> str:
    """Shorten an untrusted name before echoing it in an error message.

    Names longer than ``max_length`` UTF-16 code units are cut to
    ``max_length`` code units plus ``…``, one fewer when the cut would split a
    surrogate pair.
    """
    # max_length + 1 characters hold at least max_length + 1 units, which is
    # enough to tell whether to cut and where, so never encode a huge name.
    encoded = name[: max_length + 1].encode(_UTF16, "surrogatepass")
    if len(encoded) <= 2 * max_length:
        return name
    units = memoryview(encoded).cast("H")
    end = max_length
    # Do not leave half of a surrogate pair at the cut.
    if end > 0 and 0xD800 <= units[end - 1] <= 0xDBFF:
        end -= 1
    return f"{encoded[: 2 * end].decode(_UTF16, 'surrogatepass')}…"
