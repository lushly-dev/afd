"""YAML 1.2 core-schema frontmatter parser for Agent Skills (``spec/mcp-resources.md``, S2).

``SKILL.md`` begins with a line ``---``, then one YAML mapping, then a closing line ``---``. The
YAML is resolved with the YAML 1.2 core schema (so unquoted ``2026-11-01`` and ``yes`` remain
strings, ``0o10`` is 8 and ``0x10`` is 16), with no tags, anchors, aliases, repeated keys,
non-string mapping keys, non-finite numbers or nesting deeper than 64 levels.

Events come from PyYAML's ``yaml.parse`` stream and the JSON value is built here, so those rules
are ours and never PyYAML's YAML 1.1 defaults.
"""

from __future__ import annotations

import math
import re
from typing import Any

MAX_FRONTMATTER_DEPTH = 64
"""Nesting deeper than this is refused: frontmatter is metadata."""

# YAML 1.2 Core Schema plain-scalar patterns (YAML 1.2.2, §10.3.2).
_NULL_VALUES = frozenset({"", "null", "Null", "NULL", "~"})
_TRUE_VALUES = frozenset({"true", "True", "TRUE"})
_FALSE_VALUES = frozenset({"false", "False", "FALSE"})
_INT_DEC_RE = re.compile(r"\A[-+]?[0-9]+\Z", re.ASCII)
_INT_OCT_RE = re.compile(r"\A0o[0-7]+\Z", re.ASCII)
_INT_HEX_RE = re.compile(r"\A0x[0-9a-fA-F]+\Z", re.ASCII)
_FLOAT_RE = re.compile(
    r"\A[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?\Z",
    re.ASCII,
)
_INF_RE = re.compile(r"\A[-+]?\.(?:inf|Inf|INF)\Z", re.ASCII)
_NAN_RE = re.compile(r"\A\.(?:nan|NaN|NAN)\Z", re.ASCII)


class FrontmatterError(ValueError):
    """Raised when ``SKILL.md`` frontmatter breaks a rule of S2."""


def _is_fence(line: str) -> bool:
    if line.endswith("\r\n"):
        return line[:-2] == "---"
    if line.endswith("\n"):
        return line[:-1] == "---"
    return line == "---"


def _extract_yaml(text: str) -> str:
    """Return the YAML text between the opening and closing ``---`` lines."""
    # Split only on LF so Unicode/control separators (U+2028, bare CR, etc.) never close fences.
    lines = re.split(r"(?<=\n)", text)
    if not lines or not _is_fence(lines[0]):
        raise FrontmatterError("SKILL.md must begin with a line ---")
    body: list[str] = []
    for line in lines[1:]:
        if _is_fence(line):
            return "".join(body)
        body.append(line)
    raise FrontmatterError("the frontmatter has no closing line ---")


def _parse_finite_int(raw: str, base: int) -> int:
    try:
        parsed = int(raw, base)
        if not math.isfinite(float(parsed)):
            raise FrontmatterError(f"the frontmatter holds {raw}, which is not a finite number")
    except (ValueError, OverflowError) as exc:
        raise FrontmatterError(
            f"the frontmatter holds {raw}, which is not a finite number"
        ) from exc
    return parsed


def _resolve_core_scalar(value: str, style: str | None) -> Any:
    """Resolve one YAML scalar under the YAML 1.2 Core Schema, refusing non-finite numbers."""
    # Any quoted or block scalar is always a string.
    if style is not None:
        return value
    if value in _NULL_VALUES:
        return None
    if value in _TRUE_VALUES:
        return True
    if value in _FALSE_VALUES:
        return False
    if _INT_DEC_RE.fullmatch(value):
        return _parse_finite_int(value, 10)
    if _INT_OCT_RE.fullmatch(value):
        return _parse_finite_int(value[2:], 8)
    if _INT_HEX_RE.fullmatch(value):
        return _parse_finite_int(value[2:], 16)
    if _INF_RE.fullmatch(value) or _NAN_RE.fullmatch(value):
        raise FrontmatterError(f"the frontmatter holds {value}, which is not a finite number")
    if _FLOAT_RE.fullmatch(value):
        parsed = float(value)
        if not math.isfinite(parsed):
            raise FrontmatterError(f"the frontmatter holds {value}, which is not a finite number")
        return parsed
    return value


def parse_frontmatter(text: str) -> dict[str, Any]:
    """Parse the YAML 1.2 core-schema frontmatter at the start of ``text`` into a JSON dict.

    Raises:
        FrontmatterError: Naming the rule the frontmatter breaks.
    """
    try:
        import yaml
    except ImportError as exc:  # pragma: no cover - optional server extra
        raise ImportError(
            "PyYAML is required for SkillCatalog frontmatter parsing. "
            "Install with: pip install afd[server]"
        ) from exc

    yaml_text = _extract_yaml(text)

    # Explicit frame stack so deeply nested input can never hit Python's recursion limit.
    # Each frame is either ("seq", list) or ("map", dict, pending_key_or_sentinel).
    no_key = object()
    stack: list[list[Any]] = []
    root_value: Any = no_key
    docs_seen = 0

    def push_value(val: Any) -> None:
        nonlocal root_value
        if not stack:
            root_value = val
            return
        frame = stack[-1]
        if frame[0] == "seq":
            frame[1].append(val)
        else:
            if frame[2] is no_key:
                if not isinstance(val, str):
                    raise FrontmatterError("a mapping key must be a string")
                if val in frame[1]:
                    raise FrontmatterError(f'the frontmatter repeats the key "{val}"')
                frame[2] = val
            else:
                frame[1][frame[2]] = val
                frame[2] = no_key

    try:
        events = yaml.parse(yaml_text, Loader=yaml.SafeLoader)
        for event in events:
            if isinstance(event, yaml.StreamStartEvent):
                continue
            if isinstance(event, yaml.StreamEndEvent):
                break
            if isinstance(event, yaml.DocumentStartEvent):
                docs_seen += 1
                if docs_seen > 1:
                    raise FrontmatterError("the frontmatter must be one YAML document")
                continue
            if isinstance(event, yaml.DocumentEndEvent):
                continue
            if isinstance(event, yaml.AliasEvent):
                raise FrontmatterError("the frontmatter uses a YAML alias")

            anchor = getattr(event, "anchor", None)
            if anchor is not None:
                raise FrontmatterError("the frontmatter uses a YAML anchor")
            tag = getattr(event, "tag", None)
            if tag is not None:
                raise FrontmatterError("the frontmatter uses a YAML tag")

            if isinstance(event, yaml.MappingStartEvent):
                if len(stack) + 1 > MAX_FRONTMATTER_DEPTH:
                    raise FrontmatterError(
                        f"the frontmatter is nested more than {MAX_FRONTMATTER_DEPTH} levels"
                    )
                if stack and stack[-1][0] == "map" and stack[-1][2] is no_key:
                    raise FrontmatterError("a mapping key must be a string")
                stack.append(["map", {}, no_key])
            elif isinstance(event, yaml.MappingEndEvent):
                frame = stack.pop()
                push_value(frame[1])
            elif isinstance(event, yaml.SequenceStartEvent):
                if len(stack) + 1 > MAX_FRONTMATTER_DEPTH:
                    raise FrontmatterError(
                        f"the frontmatter is nested more than {MAX_FRONTMATTER_DEPTH} levels"
                    )
                if stack and stack[-1][0] == "map" and stack[-1][2] is no_key:
                    raise FrontmatterError("a mapping key must be a string")
                stack.append(["seq", []])
            elif isinstance(event, yaml.SequenceEndEvent):
                frame = stack.pop()
                push_value(frame[1])
            elif isinstance(event, yaml.ScalarEvent):
                resolved = _resolve_core_scalar(event.value, event.style)
                push_value(resolved)
    except FrontmatterError:
        raise
    except yaml.YAMLError as exc:
        first_line = str(exc).splitlines()[0] if str(exc) else "syntax error"
        raise FrontmatterError(f"the frontmatter is not valid YAML: {first_line}") from exc

    if root_value is no_key or not isinstance(root_value, dict):
        raise FrontmatterError("the frontmatter must be one YAML mapping")
    return root_value
