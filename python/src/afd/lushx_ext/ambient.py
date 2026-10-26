"""Ambient time and randomness in Python, Rust and C++ command handlers.

Backs ``afd-no-ambient-time`` and ``afd-no-ambient-random`` outside TypeScript
(the TypeScript scan lives in ``linters.py``). Each finder returns
``(line, kind, name)`` tuples, where ``kind`` is ``"time"`` or ``"random"``.

Handler scope is heuristic, per language:

- **Python** (parsed with ``ast``): functions decorated with
  ``@<x>.command(...)`` taking a description (``@server.command``,
  ``@registry.command``) or with ``@define_command(...)``, and the ``handler=``
  of a ``CommandDefinition(...)`` call when it is a lambda or a function
  defined in the same file. A call counts only when its root name was
  imported (``import time``, ``from datetime import datetime``), so a
  parameter named ``random`` is not mistaken for the module.
- **Rust**: the bodies of ``impl CommandHandler for ...`` blocks, free ``fn``
  items (outside any ``impl``) whose parameters name ``CommandContext``, and
  closures with a ``CommandContext``-typed parameter. Methods of other
  ``impl`` blocks that take a context (a registry's own batch code) are not
  handlers and are skipped.
- **C++**: lambdas and functions whose parameters name ``CommandContext``
  (the ``CommandHandler`` signature).

In Rust and C++, a parameter list that also names a ``Next`` type is
middleware and is skipped. The Rust and C++ scans are lexical: strings,
comments and char literals are blanked first, keeping offsets.
"""

from __future__ import annotations

import ast
import re
from collections.abc import Iterable, Iterator

Finding = tuple[int, str, str]

_TIME = "time"
_RANDOM = "random"

# ─── Python ─────────────────────────────────────────────────────────────────

_PY_TIME_CALLS = frozenset({
    "time.time",
    "time.time_ns",
    "time.monotonic",
    "time.monotonic_ns",
    "time.perf_counter",
    "time.perf_counter_ns",
    "datetime.datetime.now",
    "datetime.datetime.utcnow",
    "datetime.datetime.today",
    "datetime.date.today",
})
_PY_RANDOM_CALLS = frozenset({"uuid.uuid1", "uuid.uuid4", "os.urandom"})
_PY_RANDOM_MODULES = ("random.", "secrets.")


def python_ambient_calls(content: str) -> list[Finding]:
    """Ambient calls inside Python command handlers."""
    if "command" not in content.lower():
        return []
    try:
        tree = ast.parse(content)
    except (SyntaxError, ValueError):
        return []
    aliases = _python_import_aliases(tree)
    if not aliases:
        return []
    found: dict[tuple[int, int], Finding] = {}
    for handler in _python_handlers(tree):
        body = handler.body if isinstance(handler.body, list) else [handler.body]
        for stmt in body:
            for node in ast.walk(stmt):
                if not isinstance(node, ast.Call):
                    continue
                kind = _python_call_kind(node, aliases)
                if kind:
                    name = f"{ast.unparse(node.func)}()"
                    found[(node.lineno, node.col_offset)] = (node.lineno, kind, name)
    return sorted(found.values())


def _python_import_aliases(tree: ast.Module) -> dict[str, str]:
    """Local name → qualified module path, from every import in the file."""
    aliases: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.asname:
                    aliases[alias.asname] = alias.name
                else:
                    root = alias.name.split(".", 1)[0]
                    aliases[root] = root
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            for alias in node.names:
                aliases[alias.asname or alias.name] = f"{node.module}.{alias.name}"
    return aliases


def _python_qualified(func: ast.expr, aliases: dict[str, str]) -> str | None:
    """Dotted name of a call target with its root resolved through imports."""
    parts: list[str] = []
    while isinstance(func, ast.Attribute):
        parts.append(func.attr)
        func = func.value
    if not isinstance(func, ast.Name) or func.id not in aliases:
        return None
    parts.append(aliases[func.id])
    return ".".join(reversed(parts))


def _python_call_kind(node: ast.Call, aliases: dict[str, str]) -> str | None:
    qualified = _python_qualified(node.func, aliases)
    if qualified is None:
        return None
    if qualified in _PY_TIME_CALLS:
        return _TIME
    if qualified in _PY_RANDOM_CALLS:
        return _RANDOM
    if qualified.startswith(_PY_RANDOM_MODULES):
        # `random.Random(seed)` is a seeded generator, which is deterministic.
        if qualified == "random.Random" and (node.args or node.keywords):
            return None
        return _RANDOM
    return None


def _is_command_decorator(decorator: ast.expr) -> bool:
    if not isinstance(decorator, ast.Call):
        return False
    func = decorator.func
    name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
    if name == "define_command":
        return True
    if name != "command" or not isinstance(func, ast.Attribute):
        return False
    # AFD's decorators take a name and a description; click's `@cli.command()` does not.
    has_description = any(k.arg == "description" for k in decorator.keywords)
    return has_description or len(decorator.args) >= 2


def _python_handlers(tree: ast.Module) -> Iterator[ast.FunctionDef | ast.AsyncFunctionDef | ast.Lambda]:
    functions = [
        node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]
    for function in functions:
        if any(_is_command_decorator(d) for d in function.decorator_list):
            yield function
    referenced: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
        if name != "CommandDefinition":
            continue
        for keyword in node.keywords:
            if keyword.arg != "handler":
                continue
            if isinstance(keyword.value, ast.Lambda):
                yield keyword.value
            elif isinstance(keyword.value, ast.Name):
                referenced.add(keyword.value.id)
    for function in functions:
        if function.name in referenced:
            yield function


# ─── Rust and C++ ───────────────────────────────────────────────────────────

_RUST_TIME = (
    re.compile(r"\b(?P<n>SystemTime|Instant|Utc|Local)\s*::\s*now\s*\("),
    re.compile(r"\bOffsetDateTime\s*::\s*(?P<n>now_utc|now_local)\s*\("),
)
_RUST_RANDOM = (
    re.compile(r"\brand\s*::\s*(?P<n>random|thread_rng|rng)\b"),
    re.compile(r"(?<![\w:])(?P<n>thread_rng)\s*\("),
    re.compile(r"\bUuid\s*::\s*(?P<n>new_v4|now_v1|now_v7)\s*\("),
    re.compile(r"\b(?P<n>OsRng)\b"),
)
_RUST_NAMES = {
    "SystemTime": "SystemTime::now()",
    "Instant": "Instant::now()",
    "Utc": "Utc::now()",
    "Local": "Local::now()",
    "now_utc": "OffsetDateTime::now_utc()",
    "now_local": "OffsetDateTime::now_local()",
    "random": "rand::random()",
    "rng": "rand::rng()",
    "thread_rng": "thread_rng()",
    "new_v4": "Uuid::new_v4()",
    "now_v1": "Uuid::now_v1()",
    "now_v7": "Uuid::now_v7()",
    "OsRng": "OsRng",
}

_CPP_CLOCKS = r"system_clock|steady_clock|high_resolution_clock|utc_clock|tai_clock|gps_clock|file_clock"
_CPP_TIME = (
    re.compile(rf"\b(?P<n>{_CPP_CLOCKS})\s*::\s*now\s*\("),
    re.compile(r"\bstd\s*::\s*(?P<n>time)\s*\("),
    # The C `time(nullptr)`, not a member or another namespace's `time`.
    re.compile(r"(?<![\w.:>])(?P<n>time)\s*\(\s*(?:nullptr|NULL|0)\s*\)"),
    re.compile(r"(?<![\w.:>])(?P<n>clock_gettime|gettimeofday)\s*\("),
)
_CPP_RANDOM = (
    re.compile(r"(?:\bstd\s*::\s*|(?<![\w.:>]))(?P<n>rand)\s*\(\s*\)"),
    re.compile(r"\b(?P<n>random_device)\b"),
)
_CPP_NAMES = {
    "time": "std::time()",
    "clock_gettime": "clock_gettime()",
    "gettimeofday": "gettimeofday()",
    "rand": "std::rand()",
    "random_device": "std::random_device",
}

_CONTEXT_RE = re.compile(r"\bCommandContext\b")
_NEXT_RE = re.compile(r"\b\w*Next\b")
_RUST_FN_RE = re.compile(r"\bfn\s+[A-Za-z_]\w*\s*")
_RUST_IMPL_RE = re.compile(r"\bimpl\b")
_RUST_HANDLER_IMPL_RE = re.compile(r"\bCommandHandler\s+for\b")
_RUST_CLOSURE_RE = re.compile(r"\|([^|;{}]*)\|")
_CPP_NOT_FUNCTIONS = frozenset({
    "if", "while", "for", "switch", "return", "sizeof", "decltype", "catch", "alignof", "noexcept",
})


def rust_ambient_calls(content: str) -> list[Finding]:
    """Ambient calls inside Rust functions and closures taking a CommandContext."""
    if "CommandContext" not in content:
        return []
    masked = mask_c_like(content, rust=True)
    return _scan(content, masked, _rust_handler_spans(masked), _RUST_TIME, _RUST_RANDOM, _RUST_NAMES)


def cpp_ambient_calls(content: str) -> list[Finding]:
    """Ambient calls inside C++ lambdas and functions taking a CommandContext."""
    if "CommandContext" not in content:
        return []
    masked = mask_c_like(content, rust=False)
    return _scan(content, masked, _cpp_handler_spans(masked), _CPP_TIME, _CPP_RANDOM, _CPP_NAMES)


def _scan(
    content: str,
    masked: str,
    spans: Iterable[tuple[int, int]],
    time_patterns: Iterable[re.Pattern[str]],
    random_patterns: Iterable[re.Pattern[str]],
    names: dict[str, str],
) -> list[Finding]:
    found: dict[int, Finding] = {}
    groups = ((_TIME, tuple(time_patterns)), (_RANDOM, tuple(random_patterns)))
    for start, end in spans:
        for kind, patterns in groups:
            for pattern in patterns:
                for match in pattern.finditer(masked, start, end):
                    raw = match.group("n")
                    name = names.get(raw, f"{raw}::now()")
                    line = content[: match.start()].count("\n") + 1
                    found[match.start()] = (line, kind, name)
    return sorted(found.values())


def mask_c_like(content: str, *, rust: bool) -> str:
    """Blank strings, comments and char literals, keeping offsets and newlines.

    Covers ``//`` and ``/* */`` comments (nested in Rust), escaped strings, raw
    strings (Rust ``r#"..."#``, C++ ``R"d(...)d"``) and char literals. A Rust
    lifetime (``'a``) and a C++ digit separator (``1'000``) are left alone.
    """
    out = list(content)
    n = len(content)

    def blank(start: int, end: int) -> None:
        for k in range(start, min(end, n)):
            if out[k] != "\n":
                out[k] = " "

    i = 0
    while i < n:
        ch = content[i]
        nxt = content[i + 1] if i + 1 < n else ""
        if ch == "/" and nxt == "/":
            end = content.find("\n", i)
            end = n if end == -1 else end
            blank(i, end)
            i = end
        elif ch == "/" and nxt == "*":
            end = _block_comment_end(content, i, nested=rust)
            blank(i, end)
            i = end
        elif ch == '"':
            raw_end = _raw_string_end(content, i, rust=rust)
            if raw_end is not None:
                blank(i, raw_end)
                i = raw_end
                continue
            k = i + 1
            while k < n and content[k] != '"' and (rust or content[k] != "\n"):
                k += 2 if content[k] == "\\" else 1
            blank(i + 1, k)
            i = k + 1
        elif ch == "'":
            end = _char_literal_end(content, i, rust=rust)
            if end is None:
                i += 1
            else:
                blank(i + 1, end - 1)
                i = end
        else:
            i += 1
    return "".join(out)


def _block_comment_end(content: str, start: int, *, nested: bool) -> int:
    depth = 0
    k = start
    while k < len(content):
        pair = content[k : k + 2]
        if pair == "/*" and (nested or depth == 0):
            depth += 1
            k += 2
        elif pair == "*/":
            depth -= 1
            k += 2
            if depth == 0:
                return k
        else:
            k += 1
    return len(content)


_RUST_RAW_PREFIX = re.compile(r"b?r(#*)$")
_CPP_RAW_PREFIX = re.compile(r"(?:u8|[uUL])?R$")


def _raw_string_end(content: str, quote: int, *, rust: bool) -> int | None:
    """End of a raw string whose opening quote is at ``quote``, or None."""
    head = content[max(quote - 8, 0) : quote]
    if rust:
        match = _RUST_RAW_PREFIX.search(head)
        if not match or _word_char_before(content, quote - len(match.group(0))):
            return None
        closer = '"' + match.group(1)
        end = content.find(closer, quote + 1)
        return len(content) if end == -1 else end + len(closer)
    match = _CPP_RAW_PREFIX.search(head)
    if not match or _word_char_before(content, quote - len(match.group(0))):
        return None
    paren = content.find("(", quote + 1)
    if paren == -1:
        return None
    closer = ")" + content[quote + 1 : paren] + '"'
    end = content.find(closer, paren + 1)
    return len(content) if end == -1 else end + len(closer)


def _word_char_before(content: str, k: int) -> bool:
    return k > 0 and (content[k - 1].isalnum() or content[k - 1] == "_")


def _char_literal_end(content: str, quote: int, *, rust: bool) -> int | None:
    """Index after a char literal opening at ``quote``, or None when it is not one."""
    n = len(content)
    if not rust and quote > 0 and content[quote - 1].isalnum():
        # A digit separator (`1'000`) continues a number; `u8'a'` and `L'a'` do not.
        k = quote - 1
        while k > 0 and (content[k - 1].isalnum() or content[k - 1] in "_'"):
            k -= 1
        if content[k].isdigit():
            return None
    if quote + 1 < n and content[quote + 1] == "\\":
        end = content.find("'", quote + 2)
        return None if end == -1 or "\n" in content[quote:end] else end + 1
    if quote + 2 < n and content[quote + 2] == "'" and content[quote + 1] != "\n":
        return quote + 3
    if not rust:
        # Multi-character literal ('ab'): close on the same line.
        end = content.find("'", quote + 1)
        return None if end == -1 or "\n" in content[quote:end] else end + 1
    return None  # a Rust lifetime or label


_OPENERS = {"(": ")", "[": "]", "{": "}"}
_CLOSERS = frozenset(_OPENERS.values())


def _match_close(masked: str, open_idx: int) -> int:
    depth = 0
    for k in range(open_idx, len(masked)):
        ch = masked[k]
        if ch in _OPENERS:
            depth += 1
        elif ch in _CLOSERS:
            depth -= 1
            if depth == 0:
                return k
    return len(masked)


def _skip_angles(masked: str, k: int) -> int:
    """Index after the ``<...>`` group starting at ``k`` (``->`` is not a closer)."""
    angle = 0
    while k < len(masked):
        ch = masked[k]
        if ch == "<":
            angle += 1
        elif ch == ">" and masked[k - 1] != "-":
            angle -= 1
            if angle == 0:
                return k + 1
        k += 1
    return k


def _body_after(masked: str, start: int, stops: str) -> tuple[int, int] | None:
    """Span of the ``{...}`` body after a parameter list, or None at a stop char.

    Bracketed groups (``noexcept(...)``, attributes) are skipped, and a comma
    inside angle brackets of a return type does not stop the search.
    """
    angle = 0
    k = start
    n = len(masked)
    while k < n:
        ch = masked[k]
        if ch == "{":
            return k, _match_close(masked, k) + 1
        if ch in "([":
            k = _match_close(masked, k) + 1
            continue
        if ch == "-" and k + 1 < n and masked[k + 1] == ">":
            k += 2
            continue
        if ch == "<":
            angle += 1
        elif ch == ">":
            angle = max(angle - 1, 0)
        elif ch in stops and not (ch == "," and angle):
            return None
        k += 1
    return None


def _is_handler_params(params: str) -> bool:
    return bool(_CONTEXT_RE.search(params)) and not _NEXT_RE.search(params)


def _rust_impl_blocks(masked: str) -> list[tuple[int, int, bool]]:
    """``(start, end, is_command_handler)`` for each ``impl`` block body."""
    blocks: list[tuple[int, int, bool]] = []
    for match in _RUST_IMPL_RE.finditer(masked):
        brace = masked.find("{", match.end())
        semi = masked.find(";", match.end())
        if brace == -1 or (semi != -1 and semi < brace):
            continue
        header = masked[match.end() : brace]
        blocks.append((brace, _match_close(masked, brace) + 1, bool(_RUST_HANDLER_IMPL_RE.search(header))))
    return blocks


def _rust_handler_spans(masked: str) -> list[tuple[int, int]]:
    blocks = _rust_impl_blocks(masked)
    spans: list[tuple[int, int]] = [(start, end) for start, end, handler in blocks if handler]
    n = len(masked)
    for match in _RUST_FN_RE.finditer(masked):
        if any(start <= match.start() < end for start, end, _ in blocks):
            continue  # a method: covered by its handler impl, or not a handler
        k = match.end()
        if k < n and masked[k] == "<":
            k = _skip_angles(masked, k)
        while k < n and masked[k].isspace():
            k += 1
        if k >= n or masked[k] != "(":
            continue
        close = _match_close(masked, k)
        if not _is_handler_params(masked[k:close]):
            continue
        body = _body_after(masked, close + 1, ";})")
        if body:
            spans.append(body)
    for match in _RUST_CLOSURE_RE.finditer(masked):
        if not _is_handler_params(match.group(1)):
            continue
        k = match.end()
        while k < n and masked[k].isspace():
            k += 1
        if masked.startswith("->", k):
            body = _body_after(masked, k, ";,)}")
            if body:
                spans.append(body)
            continue
        for word in ("async", "move"):
            if masked.startswith(word, k):
                k += len(word)
                while k < n and masked[k].isspace():
                    k += 1
        if k < n and masked[k] == "{":
            spans.append((k, _match_close(masked, k) + 1))
        else:
            spans.append((k, _expression_end(masked, k)))
    return spans


def _expression_end(masked: str, start: int) -> int:
    """End of a closure's expression body: a ``,``, ``;`` or closer at its depth."""
    depth = 0
    for k in range(start, len(masked)):
        ch = masked[k]
        if ch in _OPENERS:
            depth += 1
        elif ch in _CLOSERS:
            if depth == 0:
                return k
            depth -= 1
        elif ch in ",;" and depth == 0:
            return k
    return len(masked)


def _cpp_handler_spans(masked: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    seen: set[int] = set()
    for match in _CONTEXT_RE.finditer(masked):
        open_idx = _enclosing_paren(masked, match.start())
        if open_idx is None or open_idx in seen:
            continue
        seen.add(open_idx)
        if not _cpp_callable_paren(masked, open_idx):
            continue
        close = _match_close(masked, open_idx)
        if not _is_handler_params(masked[open_idx:close]):
            continue
        body = _body_after(masked, close + 1, ";,)}]=")
        if body:
            spans.append(body)
    return spans


def _enclosing_paren(masked: str, k: int) -> int | None:
    """Index of the unclosed ``(`` around ``k``, stopping at a brace or ``;``."""
    depth = 0
    for j in range(k - 1, -1, -1):
        ch = masked[j]
        if ch in ")]":
            depth += 1
        elif ch in "([":
            if depth == 0:
                return j if ch == "(" else None
            depth -= 1
        elif ch in "{};" and depth == 0:
            return None
    return None


def _cpp_callable_paren(masked: str, open_idx: int) -> bool:
    """True when the ``(`` opens a lambda's or function's parameter list."""
    j = open_idx - 1
    while j >= 0 and masked[j].isspace():
        j -= 1
    if j < 0:
        return False
    if masked[j] in "]>":
        return True  # a lambda, or a template lambda / function template
    if not (masked[j].isalnum() or masked[j] == "_"):
        return False
    start = j
    while start > 0 and (masked[start - 1].isalnum() or masked[start - 1] == "_"):
        start -= 1
    return masked[start : j + 1] not in _CPP_NOT_FUNCTIONS
