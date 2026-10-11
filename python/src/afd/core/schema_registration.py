"""Registration-time checks for AFD's supported JSON Schema subset."""

from __future__ import annotations

import math
import re
from functools import lru_cache
from typing import Any

_TYPES = {"string", "number", "integer", "boolean", "object", "array", "null"}
_ANNOTATIONS = {
    "title",
    "description",
    "examples",
    "deprecated",
    "readOnly",
    "writeOnly",
    "$comment",
    "$schema",
    "$id",
}
_KEYWORDS = _ANNOTATIONS | {
    "type",
    "properties",
    "required",
    "enum",
    "items",
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "additionalProperties",
    "$ref",
    "definitions",
    "$defs",
    "default",
    "pattern",
    "format",
    "const",
    "anyOf",
    "oneOf",
    "allOf",
    "not",
    "multipleOf",
}
_FORMATS = {"email", "uuid", "date-time", "date", "time"}


def _reference(root: dict[str, Any], ref: str) -> dict[str, Any]:
    if ref == "#":
        return root
    if not (ref.startswith("#/definitions/") or ref.startswith("#/$defs/")):
        raise ValueError(f"Unsupported $ref {ref!r}: only local schema references are supported")
    target: Any = root
    for segment in ref[2:].split("/"):
        segment = segment.replace("~1", "/").replace("~0", "~")
        if not isinstance(target, dict) or segment not in target:
            raise ValueError(f"Unresolved $ref {ref!r}")
        target = target[segment]
    if not isinstance(target, dict):
        raise ValueError(f"$ref {ref!r} must resolve to a schema object")
    return target


def check_schema(schema: dict[str, Any]) -> None:
    """Reject unsupported keywords and invalid schema shapes at registration."""
    if not isinstance(schema, dict):
        raise TypeError("input_schema must be a JSON Schema object or a Pydantic model class")

    def visit(node: Any, path: str) -> None:
        if not isinstance(node, dict):
            raise ValueError(f"Schema at {path} must be an object")
        for key, value in node.items():
            here = f"{path}/{key}"
            if key not in _KEYWORDS:
                raise ValueError(f"Unsupported schema keyword {key!r} at {here}")
            if key in {"properties", "definitions", "$defs"}:
                if not isinstance(value, dict):
                    raise ValueError(f"Schema keyword {key!r} at {here} must be an object")
                for name, child in value.items():
                    visit(child, f"{here}/{name}")
            elif key in {"items", "not"}:
                visit(value, here)
            elif key == "additionalProperties":
                if not isinstance(value, bool):
                    visit(value, here)
            elif key in {"anyOf", "oneOf", "allOf"}:
                if not isinstance(value, list) or not value:
                    raise ValueError(f"Schema keyword {key!r} at {here} must be a nonempty array")
                for index, child in enumerate(value):
                    visit(child, f"{here}/{index}")
            elif key == "$ref":
                if not isinstance(value, str):
                    raise ValueError(f"$ref at {here} must be a string")
                _reference(schema, value)
            elif key == "format" and value not in _FORMATS:
                raise ValueError(f"Unsupported format {value!r} at {here}")
            elif key == "pattern":
                try:
                    _compile_pattern(value)
                except (ValueError, re.error) as exc:
                    raise ValueError(f"Unsupported pattern at {here}: {exc}") from exc
            elif key == "type":
                values = value if isinstance(value, list) else [value]
                if not values or any(
                    not isinstance(item, str) or item not in _TYPES for item in values
                ):
                    raise ValueError(f"Unsupported type at {here}")
            elif key == "required":
                if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
                    raise ValueError(f"required at {here} must be an array of names")
            elif key == "enum" and (not isinstance(value, list) or not value):
                raise ValueError(f"enum at {here} must be a nonempty array")
            elif key in {
                "minimum",
                "maximum",
                "exclusiveMinimum",
                "exclusiveMaximum",
                "multipleOf",
                "minItems",
                "maxItems",
                "minLength",
                "maxLength",
            }:
                if (
                    isinstance(value, bool)
                    or not isinstance(value, (int, float))
                    or not math.isfinite(value)
                ):
                    raise ValueError(f"{key} at {here} must be a finite number")
                if key == "multipleOf" and value <= 0:
                    raise ValueError(f"multipleOf at {here} must be positive")
                if key in {"minItems", "maxItems", "minLength", "maxLength"} and (
                    value < 0 or int(value) != value
                ):
                    raise ValueError(f"{key} at {here} must be a nonnegative integer")

    visit(schema, "#")


def _utf16(value: str) -> str:
    # JavaScript RegExp(pattern) has no Unicode flag: astral code points are
    # two units. Work on the same units while schema lengths remain code points.
    encoded = value.encode("utf-16-le", errors="surrogatepass")
    return "".join(
        chr(encoded[index] | encoded[index + 1] << 8) for index in range(0, len(encoded), 2)
    )


@lru_cache(maxsize=256)
def _compile_pattern(pattern: str) -> re.Pattern[str]:
    if not isinstance(pattern, str):
        raise ValueError("pattern must be a string")
    if any(token in pattern for token in (r"\p{", r"\P{", "(?<", r"\u{", "(?P", "(?>")):
        raise ValueError("unsupported ECMAScript construct")
    output = []
    in_class = False
    index = 0
    whitespace = r" \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
    while index < len(pattern):
        char = pattern[index]
        if char == "\\":
            index += 1
            if index >= len(pattern):
                raise ValueError("unterminated escape")
            escaped = pattern[index]
            if escaped in "AZaNeU" or escaped == "S" and in_class:
                raise ValueError(f"unsupported escape \\{escaped}")
            if escaped in "sS":
                output.append(
                    whitespace
                    if in_class
                    else "[" + ("^" if escaped == "S" else "") + whitespace + "]"
                )
            else:
                output.append("\\" + escaped)
        else:
            if char == "[":
                in_class = True
            elif char == "]":
                in_class = False
            if not in_class and char == ".":
                output.append(r"[^\n\r\u2028\u2029]")
            elif not in_class and char == "$":
                output.append(r"\Z")
            elif (
                not in_class
                and char == "("
                and pattern[index : index + 2] == "(?"
                and pattern[index : index + 3] not in {"(?:", "(?=", "(?!"}
            ):
                raise ValueError("unsupported group syntax")
            elif not in_class and char in "*+?}" and pattern[index + 1 : index + 2] == "+":
                raise ValueError("unsupported possessive repetition")
            else:
                output.append(char)
        index += 1
    return re.compile(_utf16("".join(output)), re.ASCII)


def pattern_matches(pattern: str, value: str) -> bool:
    """Search with the supported ECMAScript semantics, rejecting other syntax."""
    return _compile_pattern(pattern).search(_utf16(value)) is not None
