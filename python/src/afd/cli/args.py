"""Command-line arguments and request headers, as ``packages/cli/src/args.ts`` and
``credentials.ts``.

Tool arguments are one JSON object (``{"title": "Buy  milk"}``) or whitespace-separated
``key=value`` pairs. A value is parsed as JSON when it can be (``count=2``, ``done=true``,
``tags=["a", "b"]``, ``title="Buy milk"``) and kept as a string otherwise
(``title=milk``, ``note='two words'``).

Headers come from ``AFD_HEADERS`` (one ``Name: value`` per line) and then each
``--header`` flag; a flag replaces an environment header of the same name. They are
sent with every request and never saved.
"""

from __future__ import annotations

import os
import re
from collections.abc import Iterable, Mapping
from typing import Any

from afd.client_stream import strict_json_loads

HEADERS_ENV = "AFD_HEADERS"

_HEADER_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
_SPACE = " \t\n\r"


def _closing_quote(text: str, start: int) -> int:
    """Index of the quote that closes the one at ``start``; ``"`` honours backslashes."""
    quote = text[start]
    i = start + 1
    while i < len(text):
        char = text[i]
        if quote == '"' and char == "\\":
            i += 2
            continue
        if char == quote:
            return i
        i += 1
    raise ValueError(f"Unterminated {quote} quote in: {text[start:]}")


def _closing_bracket(text: str, start: int) -> int:
    """Index of the bracket that closes the JSON array or object opened at ``start``."""
    depth = 0
    i = start
    while i < len(text):
        char = text[i]
        if char == '"':
            i = _closing_quote(text, i)
        elif char in "{[":
            depth += 1
        elif char in "}]":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError(f"Unbalanced brackets in: {text[start:]}")


def split_pairs(text: str) -> list[str]:
    """Split ``key=value`` pairs on whitespace. A value that starts with a quote runs to
    the closing quote, and one that starts with ``{`` or ``[`` to the matching bracket."""
    tokens: list[str] = []
    i = 0
    while i < len(text):
        if text[i] in _SPACE:
            i += 1
            continue
        token = ""
        at_value_start = True
        saw_equals = False
        while i < len(text) and text[i] not in _SPACE:
            char = text[i]
            end = -1
            if at_value_start and char in "\"'":
                end = _closing_quote(text, i)
            elif at_value_start and saw_equals and char in "{[":
                end = _closing_bracket(text, i)
            if end != -1:
                token += text[i : end + 1]
                i = end + 1
                at_value_start = False
                continue
            token += char
            i += 1
            at_value_start = char == "=" and not saw_equals
            if char == "=":
                saw_equals = True
        tokens.append(token)
    return tokens


def _parse_value(value: str) -> Any:
    if len(value) >= 2 and value.startswith("'") and value.endswith("'"):
        return value[1:-1]
    try:
        return strict_json_loads(value)
    except ValueError:
        return value  # caption=NaN stays the string "NaN", as JSON.parse refuses it


def parse_tool_args(raw: str | None) -> dict[str, Any]:
    """Parse tool arguments: a JSON object when the text starts with ``{``, otherwise
    ``key=value`` pairs. Empty input gives ``{}``.

    Raises:
        ValueError: The arguments are malformed or not an object.
    """
    text = (raw or "").strip()
    if not text:
        return {}
    if text.startswith("{"):
        parsed = strict_json_loads(text)
        if not isinstance(parsed, dict):
            raise ValueError("Arguments must be a JSON object")
        return parsed
    args: dict[str, Any] = {}
    for token in split_pairs(text):
        equals = token.find("=")
        if equals <= 0:
            raise ValueError(f'Expected key=value, got "{token}"')
        args[token[:equals]] = _parse_value(token[equals + 1 :])
    return args


def describe_args_error(error: Exception) -> str:
    """The message printed when :func:`parse_tool_args` rejects the arguments."""
    return f"Invalid arguments ({error}). Use a JSON object or key=value pairs."


def parse_header(header: str) -> tuple[str, str]:
    """Parse one ``Name: value`` header.

    Raises:
        ValueError: The name is not an HTTP token, or the value has a line break.
    """
    colon = header.find(":")
    name = "" if colon == -1 else header[:colon].strip()
    if not name or not _HEADER_NAME.match(name):
        raise ValueError(
            f'Invalid header "{header}". Use "Name: value", e.g. "Authorization: Bearer <token>".'
        )
    value = header[colon + 1 :].strip()
    if re.search(r"[\r\n\0]", value):
        raise ValueError(f'Invalid header "{name}": the value must not contain line breaks.')
    return name, value


def resolve_headers(
    flags: Iterable[str] = (), env: Mapping[str, str] | None = None
) -> dict[str, str]:
    """Headers from :data:`HEADERS_ENV`, then each ``--header`` flag; a flag replaces an
    environment header with the same name, compared case-insensitively.

    Raises:
        ValueError: A header is malformed; the message names where it came from.
    """
    source_env = os.environ if env is None else env
    lines = [line for line in re.split(r"\r?\n", source_env.get(HEADERS_ENV, "")) if line.strip()]
    by_name: dict[str, tuple[str, str]] = {}
    for source, header in [*((HEADERS_ENV, line) for line in lines),
                           *(("--header", flag) for flag in flags)]:
        try:
            name, value = parse_header(header)
        except ValueError as exc:
            raise ValueError(f"{source}: {exc}") from exc
        by_name[name.lower()] = (name, value)
    return dict(by_name.values())
