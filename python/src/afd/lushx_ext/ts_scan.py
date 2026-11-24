"""Scanning of TypeScript source for the AFD linter.

``_mask_ts_source`` blanks string literals, comments and regex literals while
keeping offsets, and ``_ts_handler_spans`` finds the inline handlers of
``defineCommand(...)`` calls in the masked text.
"""

import re
from collections.abc import Sequence

# One bracket matcher for every masked-source scanner: the Rust and C++ scans in ambient.py use it too.
from afd.lushx_ext.ambient import _CLOSERS, _OPENERS, _match_close

_DEFINE_COMMAND_RE = re.compile(r"\bdefineCommand\b")
# A `handler` property at the start of an options-object property:
# `handler: ...`, `handler(...)`, `async handler(...)` or `handler<T>(...)`.
_HANDLER_KEY_RE = re.compile(r"\s*(?:async\s+)?handler\s*[:(<]")


def _mask_ts_source(content: str) -> str:
    """Blank out string literals and comments, keeping offsets and newlines.

    The result has the same length as ``content`` and a newline wherever
    ``content`` has one, so offsets and line numbers carry over unchanged.
    Code inside template-literal ``${...}`` stays visible. Regex literals are
    blanked too, found with the usual heuristic: a ``/`` where an expression
    can start (see ``_regex_can_start``). A regex the heuristic misses can
    throw off the scan for the rest of that file, which at worst misses or
    misplaces a handler.
    """
    out = list(content)
    n = len(content)
    i = 0
    # Brace depth of each open `${` in a template literal, innermost last.
    template_stack: list[int] = []
    depth = 0

    def blank(start: int, end: int) -> None:
        for k in range(start, end):
            if out[k] != "\n":
                out[k] = " "

    def scan_template(start: int) -> int:
        """Blank template text from ``start``; return where code resumes."""
        k = start
        while k < n:
            ch = content[k]
            if ch == "\\":
                k += 2
                continue
            if ch == "`":
                blank(start, k)
                return k + 1
            if ch == "$" and k + 1 < n and content[k + 1] == "{":
                blank(start, k)
                template_stack.append(depth)
                return k + 2
            k += 1
        blank(start, n)
        return n

    while i < n:
        ch = content[i]
        nxt = content[i + 1] if i + 1 < n else ""
        if ch == "/" and nxt == "/":
            end = content.find("\n", i)
            end = n if end == -1 else end
            blank(i, end)
            i = end
        elif ch == "/" and nxt == "*":
            end = content.find("*/", i + 2)
            end = n if end == -1 else end + 2
            blank(i, end)
            i = end
        elif ch in ("'", '"'):
            k = i + 1
            while k < n and content[k] not in (ch, "\n"):
                k += 2 if content[k] == "\\" else 1
            end = min(k + 1, n)
            blank(i + 1, min(k, n))
            i = end
        elif ch == "`":
            i = scan_template(i + 1)
        elif ch == "/" and _regex_can_start(out, i):
            regex_end = _regex_end(content, i)
            if regex_end is None:
                i += 1  # no closing slash on this line: division after all
            else:
                blank(i + 1, regex_end)
                i = regex_end + 1
        elif ch == "{":
            depth += 1
            i += 1
        elif ch == "}":
            if template_stack and template_stack[-1] == depth:
                template_stack.pop()
                i = scan_template(i + 1)
            else:
                depth -= 1
                i += 1
        else:
            i += 1
    return "".join(out)


# Characters and keywords after which a `/` starts a regex rather than dividing.
_REGEX_PRECEDING_CHARS = frozenset("(,=:[!&|?{};+-*%<>~^")
_REGEX_PRECEDING_WORDS = frozenset(
    {
        "return",
        "typeof",
        "case",
        "do",
        "else",
        "in",
        "of",
        "void",
        "yield",
        "await",
        "delete",
        "throw",
        "new",
    }
)


def _regex_can_start(out: Sequence[str], i: int) -> bool:
    """True when a ``/`` at ``i`` sits where an expression can start."""
    k = i - 1
    while k >= 0 and out[k].isspace():
        k -= 1
    if k < 0:
        return True
    prev = out[k]
    if prev in _REGEX_PRECEDING_CHARS:
        return True
    if prev.isalnum() or prev in "_$":
        start = k
        while start > 0 and (out[start - 1].isalnum() or out[start - 1] in "_$"):
            start -= 1
        return "".join(out[start : k + 1]) in _REGEX_PRECEDING_WORDS
    return False


def _regex_end(content: str, i: int) -> int | None:
    """Index of the slash closing the regex opened at ``i``, or None."""
    in_class = False
    k = i + 1
    while k < len(content) and content[k] != "\n":
        ch = content[k]
        if ch == "\\":
            k += 2
            continue
        if ch == "[":
            in_class = True
        elif ch == "]":
            in_class = False
        elif ch == "/" and not in_class:
            return k
        k += 1
    return None


def _property_end(masked: str, start: int, limit: int) -> int:
    """End of the object property value starting at ``start``.

    Stops at the first ``,`` or closing bracket at the property's own depth, so
    block bodies, expression bodies and method shorthand are all covered. A
    comma inside type arguments at that depth (``Promise<Result<A, B>>``,
    ``async <T, U>(...)``) does not end the property: a ``<`` directly after a
    name or after ``async`` opens type arguments when its ``>`` closes before
    the property can end, so an unspaced comparison (``a<b``) is not read as
    one.
    """
    depth = 0
    angle = 0
    for k in range(start, limit):
        ch = masked[k]
        if ch in _OPENERS:
            depth += 1
        elif ch in _CLOSERS:
            if depth == 0:
                return k
            depth -= 1
        elif depth == 0 and ch == "<" and _opens_type_arguments(masked, k, limit):
            angle += 1
        elif depth == 0 and ch == ">" and angle and masked[k - 1] != "=":
            angle -= 1
        elif ch == "," and depth == 0 and not angle:
            return k
    return limit


def _opens_type_arguments(masked: str, k: int, limit: int) -> bool:
    """True when the ``<`` at ``k`` opens type arguments.

    It must follow a name directly or ``async``, and its matching ``>`` must
    come before a ``;`` or a closing bracket of the enclosing scope.
    """
    prev = masked[k - 1] if k else ""
    if not (prev.isalnum() or prev in "_$"):
        j = k - 1
        while j >= 0 and masked[j].isspace():
            j -= 1
        if masked[max(j - 4, 0) : j + 1] != "async" or (
            j >= 5 and (masked[j - 5].isalnum() or masked[j - 5] in "_$")
        ):
            return False
    angle = depth = 0
    for m in range(k, limit):
        ch = masked[m]
        if ch in _OPENERS:
            depth += 1
        elif ch in _CLOSERS:
            if depth == 0:
                return False
            depth -= 1
        elif depth == 0 and ch == ";":
            return False
        elif ch == "<":
            angle += 1
        elif ch == ">" and masked[m - 1] != "=":
            angle -= 1
            if angle == 0:
                return True
    return False


def _ts_handler_spans(masked: str) -> list[tuple[int, int]]:
    """Source spans of the inline handlers of ``defineCommand(...)`` calls.

    Only the ``handler`` property at the top level of the options object
    counts. A handler passed by reference (``handler: runCreate``) yields a
    span holding just that name, so its body elsewhere is not checked.
    """
    spans: list[tuple[int, int]] = []
    for match in _DEFINE_COMMAND_RE.finditer(masked):
        k = match.end()
        while k < len(masked) and masked[k].isspace():
            k += 1
        if k < len(masked) and masked[k] == "<":
            # Skip explicit type arguments: defineCommand<Input, Output>(...).
            angle = 0
            while k < len(masked):
                if masked[k] == "<":
                    angle += 1
                elif masked[k] == ">" and masked[k - 1] != "=":
                    angle -= 1
                    if angle == 0:
                        k += 1
                        break
                k += 1
            while k < len(masked) and masked[k].isspace():
                k += 1
        if k >= len(masked) or masked[k] != "(":
            continue  # an import or other mention, not a call
        call_end = _match_close(masked, k)
        brace = masked.find("{", k, call_end)
        if brace == -1:
            continue
        obj_end = _match_close(masked, brace)
        # Walk the options object's own properties, skipping nested values.
        pos = brace + 1
        while pos < obj_end:
            prop_end = _property_end(masked, pos, obj_end)
            if _HANDLER_KEY_RE.match(masked, pos, prop_end):
                spans.append((pos, prop_end))
            pos = prop_end + 1
    return spans
