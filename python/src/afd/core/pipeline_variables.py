"""Pipeline variable references, as specified in ``spec/pipeline-variables.md``.

A step input value is a reference only when the whole string is one of:

- ``$prev`` / ``$prev.<path>``: data of the previous successful step;
- ``$first`` / ``$first.<path>``: data of the first step;
- ``$steps[N]`` / ``$steps[N].<path>``: data of step ``N`` (0-based);
- ``$steps.<alias>`` / ``$steps.<alias>.<path>``: data of the step named ``<alias>``;
- ``$input`` / ``$input.<path>``: the pipeline request's ``input``.

A key is any run of characters other than ``.``, ``[``, ``]`` and whitespace,
optionally followed by one ``[N]`` index. Any other string that starts with
``$`` (``$9.99``, ``$HOME``, ``$prevx``, ``$steps[0][1]``) is a literal, a
string starting with ``$$`` is a literal with one ``$`` removed (at any
length), and would-be references longer than :data:`MAX_REFERENCE_LENGTH`
characters are literals.

Resolution only follows JSON data: step data is first converted to its JSON
representation (pydantic models and dataclasses included), a key segment only
matches an own key of a JSON object, a segment starting with ``__`` never
matches, and an index must be in bounds. Attributes are never read.

A reference that cannot be resolved is *absent* (:data:`ABSENT`): the property
is omitted from an object, and becomes ``None`` in a list.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable, Optional, Tuple

from afd.core.wire import to_wire

MAX_INPUT_DEPTH = 64
"""Maximum nesting depth of a step input or the request input (the outermost
object or array is level 1)."""

MAX_REFERENCE_LENGTH = 1024
"""Strings longer than this are never resolved as references."""


class _Absent:
    """Sentinel for an unresolved reference."""

    _instance: Optional["_Absent"] = None

    def __new__(cls) -> "_Absent":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        return "ABSENT"

    def __bool__(self) -> bool:
        return False


ABSENT: Any = _Absent()
"""The value of a reference that cannot be resolved."""

# A key is any non-empty run of characters other than '.', '[', ']' and whitespace.
_KEY = r"[^.\[\]\s]+"
_SEGMENT_RE = re.compile(rf"({_KEY})(?:\[([0-9]+)\])?")
_REFERENCE_RE = re.compile(
    rf"\$(?:(?P<root>prev|first|input)|steps\[(?P<index>[0-9]+)\]|steps\.(?P<alias>{_KEY}))"
    r"(?:\.(?P<path>.+))?",
    re.DOTALL,
)

PathSegment = Tuple[str, Optional[int]]
"""A path segment: a key, optionally followed by an array index (``items[2]``)."""


@dataclass(frozen=True)
class VariableReference:
    """A parsed variable reference.

    Attributes:
        root: ``"prev"``, ``"first"``, ``"input"`` or ``"steps"``.
        index: Step index for ``$steps[N]``.
        alias: Step alias for ``$steps.<alias>``.
        path: Path segments after the root.
    """

    root: str
    index: Optional[int] = None
    alias: Optional[str] = None
    path: Tuple[PathSegment, ...] = ()


def parse_path(path: str) -> Optional[Tuple[PathSegment, ...]]:
    """Parse a dotted path into segments, or return None if it is malformed."""
    segments = []
    for part in path.split("."):
        match = _SEGMENT_RE.fullmatch(part)
        if match is None:
            return None
        index = match.group(2)
        segments.append((match.group(1), int(index) if index is not None else None))
    return tuple(segments)


def parse_reference(value: str) -> Optional[VariableReference]:
    """Parse a reference string.

    Returns:
        The reference, or None when the string is a literal (it does not match
        a reference form, starts with ``$$`` or is too long).
    """
    if len(value) > MAX_REFERENCE_LENGTH:
        return None
    match = _REFERENCE_RE.fullmatch(value)
    if match is None:
        return None

    path: Tuple[PathSegment, ...] = ()
    if match.group("path") is not None:
        parsed = parse_path(match.group("path"))
        if parsed is None:
            return None
        path = parsed

    if match.group("root") is not None:
        return VariableReference(root=match.group("root"), path=path)
    if match.group("index") is not None:
        return VariableReference(root="steps", index=int(match.group("index")), path=path)
    return VariableReference(root="steps", alias=match.group("alias"), path=path)


def json_view(value: Any) -> Any:
    """Return the JSON representation that resolution traverses.

    Returns :data:`ABSENT` for data that cannot be represented (for example,
    nesting too deep to serialize).
    """
    try:
        return to_wire(value)
    except ValueError:
        return ABSENT


def _index(current: Any, index: int) -> Any:
    if isinstance(current, list) and index < len(current):
        return current[index]
    return ABSENT


def follow_path(view: Any, path: Tuple[PathSegment, ...]) -> Any:
    """Follow path segments through JSON data (dicts, lists and scalars only).

    Returns:
        The value at the path, or :data:`ABSENT`.
    """
    current = view
    for key, index in path:
        if key.startswith("__"):
            return ABSENT
        if isinstance(current, dict):
            if key not in current:
                return ABSENT
            current = current[key]
        elif isinstance(current, list) and key.isascii() and key.isdigit():
            current = _index(current, int(key))
        else:
            return ABSENT
        if current is ABSENT:
            return ABSENT
        if index is not None:
            current = _index(current, index)
            if current is ABSENT:
                return ABSENT
    return current


def get_nested_value(obj: Any, path: str) -> Any:
    """Get a nested value from data using a dotted path.

    The data is viewed as JSON first (pydantic models and dataclasses by their
    serialized form), so attributes are never read and a segment starting with
    ``__`` never resolves.

    Returns:
        The value, or None when the path cannot be resolved.

    Example:
        >>> get_nested_value({"user": {"tags": ["a", "b"]}}, "user.tags[1]")
        'b'
        >>> get_nested_value({"user": {}}, "user.__class__") is None
        True
    """
    if obj is None:
        return None
    segments = parse_path(path)
    if segments is None:
        return None
    value = follow_path(json_view(obj), segments)
    return None if value is ABSENT else value


def unescape_literal(value: str) -> str:
    """Remove the escape from a ``$$``-prefixed literal."""
    return value[1:] if value.startswith("$$") else value


RootLookup = Callable[[VariableReference], Any]
"""Returns the JSON view of a reference's root data, or :data:`ABSENT`."""


def resolve_string(value: str, lookup: RootLookup) -> Any:
    """Resolve one string: a reference, an escaped literal, or a literal.

    Returns:
        The resolved value, the literal string, or :data:`ABSENT`.
    """
    if not value.startswith("$"):
        return value
    if value.startswith("$$"):
        return value[1:]
    reference = parse_reference(value)
    if reference is None:
        return value
    root = lookup(reference)
    if root is ABSENT:
        return ABSENT
    return follow_path(root, reference.path)


def resolve_input(value: Any, lookup: RootLookup) -> Any:
    """Resolve references anywhere in a step input.

    Unresolved references are omitted from objects and become ``None`` in lists.
    A top-level unresolved reference returns :data:`ABSENT`.
    """
    if isinstance(value, str):
        return resolve_string(value, lookup)
    if isinstance(value, dict):
        resolved = {}
        for key, item in value.items():
            item_value = resolve_input(item, lookup)
            if item_value is not ABSENT:
                resolved[key] = item_value
        return resolved
    if isinstance(value, (list, tuple)):
        items = []
        for item in value:
            item_value = resolve_input(item, lookup)
            items.append(None if item_value is ABSENT else item_value)
        return items
    return value


def exceeds_depth(value: Any, limit: int = MAX_INPUT_DEPTH) -> bool:
    """Return True if containers nest deeper than ``limit`` levels.

    The outermost container is level 1. Recursion stops one level past the
    limit, so hostile input cannot exhaust the stack.
    """

    def walk(item: Any, depth: int) -> bool:
        if isinstance(item, dict):
            children: Any = item.values()
        elif isinstance(item, (list, tuple)):
            children = item
        else:
            return False
        if depth > limit:
            return True
        return any(walk(child, depth + 1) for child in children)

    return walk(value, 1)


def is_number(value: Any) -> bool:
    """Return True for JSON numbers (booleans excluded)."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def json_equals(left: Any, right: Any) -> bool:
    """Compare JSON values the way JavaScript's ``===`` compares scalars.

    Booleans never equal numbers, and containers compare by value.
    """
    if isinstance(left, bool) or isinstance(right, bool):
        return isinstance(left, bool) and isinstance(right, bool) and left == right
    if is_number(left) or is_number(right):
        return is_number(left) and is_number(right) and left == right
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(
            json_equals(left[key], right[key]) for key in left
        )
    if isinstance(left, (list, tuple)) and isinstance(right, (list, tuple)):
        return len(left) == len(right) and all(
            json_equals(a, b) for a, b in zip(left, right, strict=True)
        )
    return type(left) is type(right) and left == right
