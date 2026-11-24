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
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from afd.core.wire import to_wire

MAX_INPUT_DEPTH = 64
"""Maximum nesting depth of a step input or the request input (the outermost
object or array is level 1)."""

MAX_REFERENCE_LENGTH = 1024
"""Strings longer than this are never resolved as references."""

MAX_RESOLVED_NODES = 100_000
"""Maximum values (template nodes and charged copies) in one resolved step input."""

MAX_RESOLVED_CHARS = 16 * 1024 * 1024
"""Maximum string and key characters (UTF-16 code units) in one resolved step input."""


class PipelineResolutionLimitError(ValueError):
    """A step input exceeded the nesting depth or the expansion budget.

    Attributes:
        limit: ``"depth"``, ``"nodes"`` or ``"chars"``.
    """

    def __init__(self, message: str, limit: str) -> None:
        super().__init__(message)
        self.limit = limit


class _Absent:
    """Sentinel for an unresolved reference."""

    _instance: _Absent | None = None

    def __new__(cls) -> _Absent:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        return "ABSENT"

    def __bool__(self) -> bool:
        return False


ABSENT: Any = _Absent()
"""The value of a reference that cannot be resolved."""

# JavaScript's `\s` (ECMAScript WhiteSpace and LineTerminator, 25 code points;
# `spec/pipeline-variables.md`, #1962). Enumerated explicitly because Python's Unicode `\s`
# treats U+001C–U+001F and U+0085 as whitespace and omits U+FEFF.
_JS_WHITESPACE = (
    "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680"
    "\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)
# A key or alias is any non-empty run of characters other than '.', '[', ']' and JS whitespace.
_KEY = rf"[^.\[\]{_JS_WHITESPACE}]+"
_SEGMENT_RE = re.compile(rf"({_KEY})(?:\[([0-9]+)\])?")
_REFERENCE_RE = re.compile(
    rf"\$(?:(?P<root>prev|first|input)|steps\[(?P<index>[0-9]+)\]|steps\.(?P<alias>{_KEY}))"
    r"(?:\.(?P<path>.+))?",
    re.DOTALL,
)

PathSegment = tuple[str, int | None]
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
    index: int | None = None
    alias: str | None = None
    path: tuple[PathSegment, ...] = ()


def parse_path(path: str) -> tuple[PathSegment, ...] | None:
    """Parse a dotted path into segments, or return None if it is malformed."""
    segments = []
    for part in path.split("."):
        match = _SEGMENT_RE.fullmatch(part)
        if match is None:
            return None
        index = match.group(2)
        segments.append((match.group(1), int(index) if index is not None else None))
    return tuple(segments)


def parse_reference(value: str) -> VariableReference | None:
    """Parse a reference string.

    Returns:
        The reference, or None when the string is a literal (it does not match
        a reference form, starts with ``$$`` or is too long).
    """
    if sum(2 if ord(char) > 0xFFFF else 1 for char in value) > MAX_REFERENCE_LENGTH:
        return None
    match = _REFERENCE_RE.fullmatch(value)
    if match is None:
        return None

    path: tuple[PathSegment, ...] = ()
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


class _Unviewable:
    """Sentinel for data that has no JSON view: a cycle, or a value that cannot be converted."""

    _instance: _Unviewable | None = None

    def __new__(cls) -> _Unviewable:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        return "UNVIEWABLE"


UNVIEWABLE: Any = _Unviewable()
"""Marks a value with no JSON view: a reference that reaches it is absent, and copying it into a
step input fails as too deep."""


def pipeline_view(value: Any) -> Any:
    """The JSON view references resolve against: :func:`json_view`, but data too deep for it, or
    circular, is still viewed.

    ``to_wire`` refuses data nested 255 levels or deeper, and circular data. TypeScript resolves
    references into such data and fails only when a step input copies more than 64 levels of it
    or a cycle, so the view keeps it: a walk that needs no recursion converts each container once
    (a cycle stays a cycle), and a value that cannot be converted becomes :data:`UNVIEWABLE`.
    """
    try:
        return to_wire(value)
    except ValueError:
        return _walk_view(value)


def _walk_view(root: Any) -> Any:
    def leaf(item: Any) -> Any:
        try:
            return to_wire(item)
        except ValueError:
            return UNVIEWABLE

    def empty(item: Any) -> Any:
        return {} if isinstance(item, dict) else []

    if not isinstance(root, (dict, list, tuple)):
        return leaf(root)
    view = empty(root)
    # The view of every container converted so far, by the id of its source: a container reached
    # twice, or a cycle, shares one view, so the walk is linear and reuse counts once, as in
    # TypeScript.
    views: dict[int, Any] = {id(root): view}
    stack: list[tuple[Any, Any]] = [(root, view)]
    while stack:
        source, target = stack.pop()
        items = source.items() if isinstance(source, dict) else enumerate(source)
        for key, item in items:
            if not isinstance(item, (dict, list, tuple)):
                child = leaf(item)
            elif id(item) in views:
                child = views[id(item)]
            else:
                child = empty(item)
                views[id(item)] = child
                stack.append((item, child))
            if isinstance(target, dict):
                target[key if isinstance(key, str) else str(key)] = child
            else:
                target.append(child)
    return view


def _index(current: Any, index: int) -> Any:
    if isinstance(current, list) and index < len(current):
        return current[index]
    return ABSENT


def follow_path(view: Any, path: tuple[PathSegment, ...]) -> Any:
    """Follow path segments through JSON data (dicts, lists and scalars only).

    Returns:
        The value at the path, :data:`ABSENT`, or :data:`UNVIEWABLE` when the path reaches data
        with no JSON view.
    """
    current = view
    for key, index in path:
        if key.startswith("__"):
            return ABSENT
        if current is UNVIEWABLE:
            return UNVIEWABLE
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
"""Returns the JSON view of a reference's root data, or :data:`ABSENT`.

:func:`resolve_input` recognizes a repeated expansion by the identity of the value a reference
reaches, so a lookup should return the same view each time it is asked for the same root while
one step input resolves (``resolve_variables`` caches them)."""


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
    resolved = _follow_reference(reference, lookup)
    return ABSENT if resolved is UNVIEWABLE else resolved


def resolve_operand(value: Any, lookup: RootLookup) -> Any:
    """Resolve the reference operand of a ``when`` condition.

    Unlike :func:`resolve_string`, a literal (anything that is not a
    reference, ``$$``-escaped strings included) is :data:`ABSENT`.
    """
    reference = parse_reference(value) if isinstance(value, str) else None
    resolved = ABSENT if reference is None else _follow_reference(reference, lookup)
    return ABSENT if resolved is UNVIEWABLE else resolved


def _follow_reference(reference: VariableReference, lookup: RootLookup) -> Any:
    root = lookup(reference)
    if root is ABSENT:
        return ABSENT
    return follow_path(root, reference.path)


def _utf16_length(text: str) -> int:
    """Length of a string in UTF-16 code units, as JavaScript's ``length``."""
    if text.isascii():
        return len(text)
    return len(text.encode("utf-16-le", "surrogatepass")) // 2


def _too_deep() -> PipelineResolutionLimitError:
    return PipelineResolutionLimitError(
        f"Pipeline step input is nested deeper than {MAX_INPUT_DEPTH} levels", "depth"
    )


class _Budget:
    """The expansion budget of one step input (``spec/pipeline-variables.md``, Limits)."""

    def __init__(self) -> None:
        self.nodes = MAX_RESOLVED_NODES
        self.chars = MAX_RESOLVED_CHARS
        # Containers already expanded, by identity (held, so an id is never reused while
        # resolving), and non-empty strings, by value.
        self.seen_containers: dict[int, Any] = {}
        self.seen_strings: set[str] = set()

    def node(self, charge: bool = True) -> None:
        if not charge:
            return
        self.nodes -= 1
        if self.nodes < 0:
            raise PipelineResolutionLimitError(
                "Pipeline variable expansion limit exceeded "
                f"(more than {MAX_RESOLVED_NODES} values)",
                "nodes",
            )

    def text(self, text: str, charge: bool = True) -> None:
        if not charge:
            return
        # A string is at least as long in UTF-16 code units as in code points.
        self.chars -= len(text) + 1 if len(text) > self.chars else _utf16_length(text)
        if self.chars < 0:
            raise PipelineResolutionLimitError(
                "Pipeline variable expansion limit exceeded "
                f"(more than {MAX_RESOLVED_CHARS} characters)",
                "chars",
            )

    def first_expansion(self, value: Any) -> bool:
        """Record a referenced value; True the first time this step input expands it."""
        if isinstance(value, (dict, list)):
            if id(value) in self.seen_containers:
                return False
            self.seen_containers[id(value)] = value
            return True
        if isinstance(value, str) and value:
            if value in self.seen_strings:
                return False
            self.seen_strings.add(value)
            return True
        return False


def _copy_resolved(
    value: Any, depth: int, budget: _Budget, charge: bool, ancestors: set[int] | None = None
) -> Any:
    """Copy a referenced value, at most 64 levels deep, charging it when it is a repeat.

    A cycle (``ancestors`` holds the containers being copied) fails as too deep, as in
    TypeScript.
    """
    if value is UNVIEWABLE:
        raise _too_deep()
    budget.node(charge)
    if isinstance(value, str):
        budget.text(value, charge)
        return value
    if not isinstance(value, (dict, list)):
        return value
    ancestors = set() if ancestors is None else ancestors
    if depth >= MAX_INPUT_DEPTH or id(value) in ancestors:
        raise _too_deep()
    ancestors.add(id(value))
    try:
        if isinstance(value, list):
            return [_copy_resolved(item, depth + 1, budget, charge, ancestors) for item in value]
        copied = {}
        for key, item in value.items():
            budget.text(key, charge)
            copied[key] = _copy_resolved(item, depth + 1, budget, charge, ancestors)
        return copied
    finally:
        ancestors.discard(id(value))


def _resolve_bounded(value: Any, lookup: RootLookup, depth: int, budget: _Budget) -> Any:
    if isinstance(value, str):
        reference = (
            parse_reference(value) if value.startswith("$") and not value.startswith("$$") else None
        )
        if reference is None:
            literal = unescape_literal(value)
            budget.node()
            budget.text(literal)
            return literal
        resolved = _follow_reference(reference, lookup)
        if resolved is ABSENT:
            return ABSENT
        # The first expansion of a value is not charged, so one large step output
        # still flows through $prev; repeats are charged in full.
        charge = not budget.first_expansion(resolved)
        budget.node()
        return _copy_resolved(resolved, 0, budget, charge)
    budget.node()
    if not isinstance(value, (dict, list, tuple)):
        return value
    if depth >= MAX_INPUT_DEPTH:
        raise _too_deep()
    if isinstance(value, dict):
        resolved_object = {}
        for key, item in value.items():
            budget.text(str(key))
            item_value = _resolve_bounded(item, lookup, depth + 1, budget)
            if item_value is not ABSENT:
                resolved_object[key] = item_value
        return resolved_object
    items = []
    for item in value:
        item_value = _resolve_bounded(item, lookup, depth + 1, budget)
        if item_value is ABSENT:
            budget.node()
            item_value = None
        items.append(item_value)
    return items


def resolve_input(value: Any, lookup: RootLookup) -> Any:
    """Resolve references anywhere in a step input.

    Unresolved references are omitted from objects and become ``None`` in lists.
    A top-level unresolved reference returns :data:`ABSENT`. Referenced values
    are copies.

    Raises:
        PipelineResolutionLimitError: The input, or a value copied into it, is
            nested deeper than :data:`MAX_INPUT_DEPTH` levels, or the resolved
            input exceeds :data:`MAX_RESOLVED_NODES` values or
            :data:`MAX_RESOLVED_CHARS` characters. Only a repeated expansion of
            the same referenced value is charged for its contents.
    """
    return _resolve_bounded(value, lookup, 0, _Budget())


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
