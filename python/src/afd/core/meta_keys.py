"""The ``_meta`` key rule (``spec/mcp-resources.md``, T2) and advertised schema check (V2).

An extra ``_meta`` key on a command's tool, a resource entry or a resource read's content item is
allowed when it is either:

1. a prefixed key in MCP's ``_meta`` key format with a prefix of two or more labels
   (``dev.umbel/origin``, ``com.example/flags``) outside ``dev.afd/`` and outside the prefixes MCP
   reserves (any whose second label is ``modelcontextprotocol`` or ``mcp``, case-insensitively); or
2. exactly ``ui``, the MCP Apps key (allowed on a command's tool and a read's content item, not on
   a resource entry), whose value is a JSON object and whose ``resourceUri``, if present, begins
   with ``ui://``.

Every other key is refused, so an extra entry can never replace an entry the server sets itself.
"""

from __future__ import annotations

import copy
import math
import re
from collections.abc import Mapping
from typing import Any

MCP_APPS_META_KEY = "ui"
"""The MCP Apps ``_meta`` key. Its value must be a JSON object with an optional ``ui://`` ``resourceUri``."""

# One prefix label: a letter, then letters, digits and `-`, ending in a letter or digit.
_LABEL_RE = re.compile(r"\A[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?\Z", re.ASCII)
# A key name: begins and ends with a letter or digit, with `-`, `_` and `.` between.
_NAME_RE = re.compile(r"\A[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\Z", re.ASCII)


def _is_finite_json_int(value: int) -> bool:
    try:
        return math.isfinite(float(value))
    except OverflowError:
        return False


def is_json_value(value: Any) -> bool:
    """Whether ``value`` is plain acyclic JSON: finite numbers, strings, booleans, None, lists or dicts."""
    # Iterative traversal with explicit ancestor tracking avoids recursion limits and cycles.
    stack: list[tuple[Any, bool]] = [(value, False)]
    active: set[int] = set()
    while stack:
        current, exiting = stack.pop()
        if exiting:
            active.discard(id(current))
            continue
        if current is None or isinstance(current, (bool, str)):
            continue
        if isinstance(current, int):
            if not _is_finite_json_int(current):
                return False
            continue
        if isinstance(current, float):
            if not math.isfinite(current):
                return False
            continue
        if isinstance(current, list):
            obj_id = id(current)
            if obj_id in active:
                return False
            active.add(obj_id)
            stack.append((current, True))
            for item in current:
                stack.append((item, False))
            continue
        if isinstance(current, dict):
            obj_id = id(current)
            if obj_id in active:
                return False
            active.add(obj_id)
            stack.append((current, True))
            for key, item in current.items():
                if not isinstance(key, str):
                    return False
                stack.append((item, False))
            continue
        return False
    return True


def check_meta_entry(key: Any, value: Any, *, allow_ui: bool) -> str | None:
    """Check one extra ``_meta`` entry against T2's key rule.

    ``allow_ui`` is ``True`` for a command's tool and a read's content item, and ``False`` for a
    listed resource entry (``ui`` is not allowed on a resource entry).

    Returns:
        The reason the entry is refused, naming ``key``, or ``None`` when allowed.
    """
    if not isinstance(key, str):
        return f'_meta key "{key}" must be a string'

    def why(reason: str) -> str:
        return f'_meta key "{key}" {reason}'

    if not is_json_value(value):
        return why("must hold a JSON value")

    if key == MCP_APPS_META_KEY:
        if not allow_ui:
            return why("is not allowed here (it belongs on a tool or a read)")
        if not isinstance(value, dict):
            return why("must hold an object")
        if "resourceUri" in value:
            uri = value["resourceUri"]
            if not isinstance(uri, str) or not uri.startswith("ui://"):
                return why("needs a resourceUri that begins ui://")
        return None

    parts = key.split("/")
    if len(parts) != 2:
        return why(
            'must be a prefixed key with two or more labels (dev.example/name) or "ui", in MCP\'s key format'
        )
    prefix, name = parts
    labels = prefix.split(".")
    if (
        len(labels) < 2
        or not all(_LABEL_RE.fullmatch(label) for label in labels)
        or not _NAME_RE.fullmatch(name)
    ):
        return why(
            'must be a prefixed key with two or more labels (dev.example/name) or "ui", in MCP\'s key format'
        )

    # Reserved prefixes are compared without regard to case, which only widens the refusal.
    if prefix.lower() == "dev.afd" or labels[1].lower() in ("modelcontextprotocol", "mcp"):
        return why("is under a prefix AFD or MCP reserves")
    return None


def assert_tool_meta(command: str, tool_meta: Any) -> dict[str, Any] | None:
    """Validate a command's ``tool_meta`` against T2 and return a clean copy (or ``None`` if empty).

    Raises:
        ValueError: Naming ``command`` and the offending key when a rule is broken.
    """
    if tool_meta is None:
        return None
    if not isinstance(tool_meta, Mapping):
        raise ValueError(
            f'command "{command}": tool_meta must be a mapping of _meta key to JSON value'
        )
    cleaned: dict[str, Any] = {}
    for key, value in tool_meta.items():
        reason = check_meta_entry(key, value, allow_ui=True)
        if reason is not None:
            raise ValueError(f'command "{command}": {reason}')
        cleaned[key] = copy.deepcopy(value)
    return cleaned if cleaned else None


def assert_advertised_input_schema(command: str, schema: Any) -> dict[str, Any] | None:
    """Validate a command's ``advertised_input_schema`` against V2.

    The advertised schema must be a JSON object whose ``type`` is ``"object"``; nothing else in it
    is checked or compiled.

    Raises:
        ValueError: Naming ``command`` when ``schema`` is not an object schema.
    """
    if schema is None:
        return None
    if not isinstance(schema, dict) or not is_json_value(schema) or schema.get("type") != "object":
        raise ValueError(
            f'command "{command}": advertised_input_schema must be a JSON object with type "object"'
        )
    return copy.deepcopy(schema)
