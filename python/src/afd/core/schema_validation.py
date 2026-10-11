"""The command-input JSON Schema subset defined in spec/validation.md.

Validate the advertised JSON types before invoking a native Pydantic parser.
This keeps useful JSON conversions (UUID/date strings) without lax primitive
coercion. No third-party JSON Schema runtime is required by the base package.
"""

from __future__ import annotations

import copy
import json
import math
import re
from datetime import date, datetime, time
from typing import Any

from afd.core.schema_registration import _reference, pattern_matches
from afd.core.schema_registration import check_schema as check_schema

MISSING = object()


class SchemaValidationError(ValueError):
    """A rejected input, carrying the standard validation issue dictionaries."""

    def __init__(self, schema: dict[str, Any], value: Any, issues: list[dict[str, Any]]):
        super().__init__("Input validation failed")
        self.schema = schema
        self.value = value
        self.issues = issues


def _kind(value: Any) -> str:
    if value is MISSING:
        return "undefined"
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    return "object"


def _matches_type(value: Any, kind: str) -> bool:
    actual = _kind(value)
    if kind == "integer":
        return actual == "number" and math.isfinite(value) and int(value) == value
    return actual == kind and (kind != "number" or math.isfinite(value))


def _equal(left: Any, right: Any) -> bool:
    if _kind(left) != _kind(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(_equal(left[key], right[key]) for key in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(
            _equal(a, b) for a, b in zip(left, right, strict=True)
        )
    return left == right


def _literal(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _format_valid(value: str, name: str) -> bool:
    try:
        if name == "uuid":
            return bool(
                re.fullmatch(
                    r"(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)",
                    value,
                )
            )
        if name == "email":
            return bool(
                re.fullmatch(
                    r"(?!\.)(?!.*\.\.)[A-Za-z0-9_'+\-.]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}",
                    value,
                )
            )
        if name == "date":
            return bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value, re.ASCII)) and bool(
                date.fromisoformat(value)
            )
        if name == "time":
            return bool(re.fullmatch(r"\d{2}:\d{2}:\d{2}(?:\.\d+)?", value, re.ASCII)) and bool(
                time.fromisoformat(value)
            )
        if not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", value, re.ASCII
        ):
            return False
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def validate_schema(schema: dict[str, Any], value: Any) -> Any:
    """Validate, strip unknown properties, and insert unvalidated defaults."""
    issues: list[dict[str, Any]] = []

    def issue(
        errors: list[dict[str, Any]],
        path: str,
        code: str,
        message: str,
        expected: str | None = None,
    ) -> None:
        item: dict[str, Any] = {"path": path or "(root)", "code": code, "message": message}
        if expected is not None:
            item["expected"] = expected
        errors.append(item)

    def invalid_type(errors: list[dict[str, Any]], path: str, expected: str, current: Any) -> None:
        issue(
            errors,
            path,
            "invalid_type",
            f"Invalid input: expected {expected}, received {_kind(current)}",
            expected,
        )

    def siblings(
        node: dict[str, Any],
        keyword: str,
        current: Any,
        parsed: Any,
        path: str,
        errors: list[dict[str, Any]],
        refs: frozenset[tuple[int, int]],
    ) -> Any:
        rest = {key: child for key, child in node.items() if key != keyword}
        sibling_data = walk(rest, current, path, errors, refs)
        # A type-only sibling does not transform data. Object/array siblings
        # combine the values they declare with those of the selected branch.
        if (
            isinstance(parsed, dict)
            and isinstance(sibling_data, dict)
            and ("properties" in rest or "additionalProperties" in rest)
        ):
            return {**sibling_data, **parsed}
        return parsed

    def walk(
        node: dict[str, Any],
        current: Any,
        path: str,
        errors: list[dict[str, Any]],
        refs: frozenset[tuple[int, int]] = frozenset(),
    ) -> Any:
        if "$ref" in node:
            target = _reference(schema, node["$ref"])
            marker = (id(target), id(current))
            if marker in refs:
                raise ValueError("Non-progressing recursive schema reference")
            parsed = walk(target, current, path, errors, refs | {marker})
            return siblings(node, "$ref", current, parsed, path, errors, refs)
        if node.get("not") == {}:
            invalid_type(errors, path, "never", current)
            return current
        if "not" in node:
            trial: list[dict[str, Any]] = []
            walk(node["not"], current, path, trial, refs)
            if not trial:
                invalid_type(errors, path, "never", current)
                return current
        for keyword in ("anyOf", "oneOf"):
            if keyword not in node:
                continue
            branches = node[keyword]
            # Zod's discriminated-union semantics report the selected branch.
            if keyword == "oneOf" and isinstance(current, dict):
                discriminator = next(
                    (
                        key
                        for key, prop in branches[0].get("properties", {}).items()
                        if "const" in prop
                        and all(
                            "const" in branch.get("properties", {}).get(key, {})
                            for branch in branches
                        )
                    ),
                    None,
                )
                if discriminator is not None:
                    for branch in branches:
                        if _equal(
                            current.get(discriminator, MISSING),
                            branch["properties"][discriminator]["const"],
                        ):
                            return siblings(
                                node,
                                keyword,
                                current,
                                walk(branch, current, path, errors, refs),
                                path,
                                errors,
                                refs,
                            )
                    options = " | ".join(
                        repr(branch["properties"][discriminator]["const"]) for branch in branches
                    )
                    issue(
                        errors,
                        f"{path}.{discriminator}".lstrip("."),
                        "invalid_union",
                        f"Invalid discriminator value. Expected {options}",
                    )
                    return current
            matches = []
            for branch in branches:
                trial = []
                parsed = walk(branch, current, path, trial, refs)
                if not trial:
                    matches.append(parsed)
                    if keyword == "anyOf":
                        return siblings(node, keyword, current, parsed, path, errors, refs)
            if len(matches) == 1:
                return siblings(node, keyword, current, matches[0], path, errors, refs)
            message = "Invalid input: more than one option matched" if matches else "Invalid input"
            issue(errors, path, "invalid_union", message)
            return current
        if "allOf" in node:
            output = MISSING
            for branch in node["allOf"]:
                parsed = walk(branch, current, path, errors, refs)
                if isinstance(output, dict) and isinstance(parsed, dict):
                    output = {**output, **parsed}
                else:
                    output = parsed
            return siblings(node, "allOf", current, output, path, errors, refs)
        if "enum" in node or "const" in node:
            choices = node["enum"] if "enum" in node else [node["const"]]
            if not any(_equal(current, choice) for choice in choices):
                message = (
                    f"Invalid input: expected {_literal(choices[0])}"
                    if len(choices) == 1
                    else "Invalid option: expected one of "
                    + "|".join(_literal(choice) for choice in choices)
                )
                issue(errors, path, "invalid_value", message)
                return current
        declared = node.get("type")
        if declared is not None:
            types = declared if isinstance(declared, list) else [declared]
            if not any(_matches_type(current, kind) for kind in types):
                nonnull = [kind for kind in types if kind != "null"]
                if len(nonnull) > 1:
                    issue(errors, path, "invalid_union", "Invalid input")
                else:
                    expected = nonnull[0] if nonnull else "null"
                    if expected == "integer":
                        expected = "int" if _kind(current) == "number" else "number"
                    invalid_type(errors, path, expected, current)
                return current
        if isinstance(current, dict):
            properties = node.get("properties", {})
            required = node.get("required", [])
            output = {}
            for key, child in properties.items():
                child_path = f"{path}.{key}".lstrip(".")
                if key in current:
                    output[key] = walk(child, current[key], child_path, errors)
                elif "default" in child:
                    output[key] = copy.deepcopy(child["default"])
                elif key in required:
                    before = len(errors)
                    walk(child, MISSING, child_path, errors)
                    if len(errors) == before:
                        # An unconstrained schema accepts every JSON value,
                        # but missing is not a JSON value. Presence is still
                        # mandatory when the enclosing object requires it.
                        invalid_type(errors, child_path, "nonoptional", MISSING)
            for key in required:
                if key not in properties and key not in current:
                    invalid_type(errors, f"{path}.{key}".lstrip("."), "nonoptional", MISSING)
            extra = [key for key in current if key not in properties]
            additional = node.get("additionalProperties", None if "properties" in node else True)
            if additional is False and extra:
                label = "key" if len(extra) == 1 else "keys"
                issue(
                    errors,
                    path,
                    "unrecognized_keys",
                    f"Unrecognized {label}: " + ", ".join(_literal(key) for key in extra),
                )
            elif additional is True:
                output.update({key: current[key] for key in extra})
            elif isinstance(additional, dict):
                for key in extra:
                    output[key] = walk(
                        additional, current[key], f"{path}.{key}".lstrip("."), errors
                    )
            return output
        if isinstance(current, list):
            output = [
                walk(node.get("items", {}), item, f"{path}.{index}".lstrip("."), errors)
                for index, item in enumerate(current)
            ]
            for keyword, code, sign in (
                ("minItems", "too_small", ">="),
                ("maxItems", "too_big", "<="),
            ):
                bound = node.get(keyword)
                if bound is not None and (
                    (len(current) < bound) if code == "too_small" else (len(current) > bound)
                ):
                    issue(
                        errors,
                        path,
                        code,
                        f"Too {'small' if code == 'too_small' else 'big'}: expected array to have {sign}{bound} items",
                    )
            return output
        if isinstance(current, str):
            for keyword, code, sign in (
                ("minLength", "too_small", ">="),
                ("maxLength", "too_big", "<="),
            ):
                bound = node.get(keyword)
                if bound is not None and (
                    (len(current) < bound) if code == "too_small" else (len(current) > bound)
                ):
                    issue(
                        errors,
                        path,
                        code,
                        f"Too {'small' if code == 'too_small' else 'big'}: expected string to have {sign}{bound} characters",
                    )
            pattern = node.get("pattern")
            name = node.get("format")
            if name and (
                not _format_valid(current, name)
                or (pattern and not pattern_matches(pattern, current))
            ):
                message = {
                    "email": "Invalid email address",
                    "uuid": "Invalid UUID",
                    "date-time": "Invalid ISO datetime",
                    "date": "Invalid ISO date",
                    "time": "Invalid ISO time",
                }[name]
                issue(errors, path, "invalid_format", message)
            elif pattern and not pattern_matches(pattern, current):
                issue(
                    errors,
                    path,
                    "invalid_format",
                    f"Invalid string: must match pattern /{pattern}/",
                )
        if _kind(current) == "number":
            for keyword, code, sign in (
                ("minimum", "too_small", ">="),
                ("exclusiveMinimum", "too_small", ">"),
                ("maximum", "too_big", "<="),
                ("exclusiveMaximum", "too_big", "<"),
            ):
                bound = node.get(keyword)
                if (
                    bound is not None
                    and not {
                        ">=": current >= bound,
                        ">": current > bound,
                        "<=": current <= bound,
                        "<": current < bound,
                    }[sign]
                ):
                    issue(
                        errors,
                        path,
                        code,
                        f"Too {'small' if code == 'too_small' else 'big'}: expected {'int' if declared == 'integer' and abs(bound) == 9007199254740991 else 'number'} to be {sign}{bound}",
                    )
            if "multipleOf" in node:
                factor = node["multipleOf"]
                quotient = current / factor
                if not math.isclose(quotient, round(quotient), rel_tol=0, abs_tol=1e-10):
                    issue(
                        errors,
                        path,
                        "not_multiple_of",
                        f"Invalid number: must be a multiple of {factor}",
                    )
        return current

    parsed = walk(schema, value, "", issues)
    if issues:
        raise SchemaValidationError(schema, value, issues)
    return parsed


def schema_error_details(exc: SchemaValidationError) -> dict[str, Any]:
    """Build portable issue and top-level field metadata for a rejected input."""
    properties = exc.schema.get("properties", {})
    details: dict[str, Any] = {"errors": exc.issues}
    if properties:
        details["expectedFields"] = list(properties)
    if isinstance(exc.value, dict):
        unexpected = [str(key) for key in exc.value if key not in properties]
        missing = [
            key
            for key in exc.schema.get("required", [])
            if key not in exc.value and "default" not in properties.get(key, {})
        ]
        if unexpected:
            details["unexpectedFields"] = unexpected
        if missing:
            details["missingFields"] = missing
    return details


def schema_validation_failure(exc: SchemaValidationError) -> Any:
    """A framework-independent VALIDATION_ERROR result for core execution."""
    from afd.core.errors import CommandError
    from afd.core.result import failure

    details = schema_error_details(exc)
    errors = details["errors"]
    rendered = [
        item["message"] if item["path"] == "(root)" else f"{item['path']}: {item['message']}"
        for item in errors
    ]
    parts = [rendered[0] if len(rendered) == 1 else "\n".join(f"- {item}" for item in rendered)]
    for key, label in (
        ("unexpectedFields", "Unknown field(s)"),
        ("missingFields", "Missing required field(s)"),
        ("expectedFields", "Expected fields"),
    ):
        if key in details:
            parts.append(f"{label}: {', '.join(details[key])}")
    return failure(
        CommandError(
            code="VALIDATION_ERROR",
            message="Input validation failed",
            suggestion=". ".join(parts),
            details=details,
        )
    )
