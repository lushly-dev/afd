"""alfred_parity — Cross-language API surface and wire-shape sync.

Two checks:

- **Name parity.** Parses the public exports of the TypeScript, Python and Rust
  entry points, normalizes naming conventions, and reports names missing from
  each language (TypeScript is the source of truth).
- **Wire shapes.** For every golden fixture in ``spec/wire/*.json``, verifies
  that the TypeScript, Python and Rust round-trip test suites exist and
  reference it. The suites themselves assert that each language parses and
  re-serializes the fixture unchanged (see ``spec/wire/README.md``).
"""

from __future__ import annotations

import ast
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from afd.core.result import CommandResult, error, success


@dataclass
class ExportEntry:
    """A single exported name from a language."""

    name: str
    normalized: str
    kind: str  # "type" or "function" (any value export)


@dataclass
class ParityReport:
    """Result of comparing exports across languages."""

    typescript: list[ExportEntry] = field(default_factory=list)
    python: list[ExportEntry] = field(default_factory=list)
    rust: list[ExportEntry] = field(default_factory=list)
    missing_from_python: list[str] = field(default_factory=list)
    missing_from_rust: list[str] = field(default_factory=list)
    missing_from_typescript: list[str] = field(default_factory=list)
    extra_in_python: list[str] = field(default_factory=list)
    extra_in_rust: list[str] = field(default_factory=list)
    extra_in_typescript: list[str] = field(default_factory=list)


# ─── Name normalization ──────────────────────────────────────────────────────


def _camel_to_snake(name: str) -> str:
    """Convert camelCase/PascalCase to snake_case."""
    s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def _normalize(name: str) -> str:
    """Normalize a name to snake_case for cross-language comparison."""
    # Already snake_case (Python/Rust)
    if "_" in name and name == name.lower():
        return name
    # camelCase/PascalCase (TypeScript)
    return _camel_to_snake(name)


def _entry(name: str, kind: str) -> ExportEntry:
    return ExportEntry(name=name, normalized=_normalize(name), kind=kind)


def _dedupe(entries: list[ExportEntry]) -> list[ExportEntry]:
    """Keep the first entry per exported name."""
    seen: set[str] = set()
    unique: list[ExportEntry] = []
    for entry in entries:
        if entry.name not in seen:
            seen.add(entry.name)
            unique.append(entry)
    return unique


# Names to exclude from parity checks (language-specific internals)
_SKIP_NAMES = {
    "__version__",
    "VERSION",
    "version",
    "is_native",
    "is_wasm",
}

# Names that are platform/connector-specific (only in TS, not expected elsewhere)
_TS_ONLY_PREFIXES = {
    "is_windows", "is_mac", "is_linux", "exec", "find_up",
    "get_temp_dir", "normalize_path", "exec_error_code",
    "create_exec_result", "is_exec_error",
    "git_hub_connector", "package_manager_connector",
}


# ─── Source scanning helpers ─────────────────────────────────────────────────


def _strip_comments(content: str, *, rust: bool = False) -> str:
    """Blank out ``//`` and ``/* */`` comments, keeping string literals intact.

    Comment characters are replaced with spaces (newlines are kept), so
    offsets and line numbers do not change. With ``rust=True``, block comments
    nest and character literals such as ``'"'`` are skipped.
    """
    out = list(content)
    i = 0
    n = len(content)
    while i < n:
        ch = content[i]
        nxt = content[i + 1] if i + 1 < n else ""
        if ch == "/" and nxt == "/":
            end = content.find("\n", i)
            end = n if end == -1 else end
            for j in range(i, end):
                out[j] = " "
            i = end
        elif ch == "/" and nxt == "*":
            depth = 0
            j = i
            while j < n:
                if content.startswith("/*", j):
                    depth += 1 if rust or depth == 0 else 0
                    j += 2
                elif content.startswith("*/", j):
                    depth -= 1
                    j += 2
                    if depth == 0:
                        break
                else:
                    j += 1
            for k in range(i, min(j, n)):
                if out[k] != "\n":
                    out[k] = " "
            i = j
        elif ch in "\"'`" and not (rust and ch in "'`"):
            i = _skip_string(content, i, multiline=rust)
        elif rust and ch == "'":
            # A char literal ('a', '\n', '"'); a lifetime ('a) is left alone.
            m = re.match(r"'(?:\\.|[^\\'])'", content[i:])
            i += len(m.group(0)) if m else 1
        else:
            i += 1
    return "".join(out)


def _skip_string(content: str, start: int, *, multiline: bool = False) -> int:
    """Index just past the string literal that starts at ``start``.

    JavaScript ``'``/``"`` strings end at a newline; template literals and,
    with ``multiline=True``, Rust strings may span lines.
    """
    quote = content[start]
    i = start + 1
    n = len(content)
    while i < n:
        ch = content[i]
        if ch == "\\":
            i += 2
            continue
        if ch == quote:
            return i + 1
        if quote != "`" and not multiline and ch == "\n":
            return i  # unterminated single-line string
        i += 1
    return n


# ─── TypeScript ──────────────────────────────────────────────────────────────

_TS_BRACE_EXPORT_RE = re.compile(
    r"\bexport\s*(type\s+)?\{([^{}]*)\}(?:\s*from\s*(['\"])([^'\"]+)\3)?"
)
_TS_STAR_EXPORT_RE = re.compile(
    r"\bexport\s+(type\s+)?\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s+)?from\s*(['\"])([^'\"]+)\3"
)
# `export default ...` is not matched: its exported name is `default`.
_TS_DECLARATION_RE = re.compile(
    r"\bexport\s+(?:declare\s+)?"
    r"(?P<keyword>async\s+function\*?|function\*?|abstract\s+class|class|interface|"
    r"type|const\s+enum|enum|const|let|var|namespace)\s+(?P<name>[A-Za-z_$][\w$]*)"
)
_TS_TYPE_KEYWORDS = {"interface", "type"}


def _resolve_ts_module(base_dir: Path, specifier: str) -> Path | None:
    """Resolve a relative module specifier (``./foo.js``) to a source file."""
    if not specifier.startswith("."):
        return None
    target = (base_dir / specifier).resolve()
    stem = target.with_suffix("") if target.suffix in {".js", ".mjs", ".cjs"} else target
    candidates = [
        stem.with_suffix(".ts"),
        stem.with_suffix(".tsx"),
        stem.with_suffix(".d.ts"),
        target,
        stem / "index.ts",
        stem / "index.tsx",
    ]
    return next((path for path in candidates if path.is_file()), None)


def parse_typescript_exports(
    content: str,
    base_dir: Path | None = None,
    _visited: set[Path] | None = None,
) -> list[ExportEntry]:
    """Parse the exports of a TypeScript module (e.g. ``index.ts``).

    Handles ``export { a, b as c } from``, ``export type { ... }``, inline
    ``type`` modifiers, local ``export { ... }`` lists, direct declarations
    (``export function``, ``export const``, ``export class``, ``export
    interface``, ``export type X =``, ``export enum``), ``export * as ns
    from`` and ``export * from``. Star re-exports are followed into the
    target module when ``base_dir`` (the module's directory) is given.
    Comments are ignored.
    """
    code = _strip_comments(content)
    visited = _visited if _visited is not None else set()
    entries: list[ExportEntry] = []

    for m in _TS_BRACE_EXPORT_RE.finditer(code):
        statement_is_type = m.group(1) is not None
        for raw in m.group(2).split(","):
            item = raw.strip()
            if not item:
                continue
            inline_type = False
            if re.match(r"type\s+", item):
                inline_type = True
                item = re.sub(r"^type\s+", "", item)
            parts = re.split(r"\s+as\s+", item)
            name = parts[-1].strip()
            if not re.fullmatch(r"[A-Za-z_$][\w$]*", name) or name == "default":
                continue
            if name in _SKIP_NAMES:
                continue
            kind = "type" if statement_is_type or inline_type else "function"
            entries.append(_entry(name, kind))

    for m in _TS_STAR_EXPORT_RE.finditer(code):
        statement_is_type = m.group(1) is not None
        namespace = m.group(2)
        if namespace:
            if namespace not in _SKIP_NAMES:
                entries.append(_entry(namespace, "type" if statement_is_type else "function"))
            continue
        if base_dir is None:
            continue
        module = _resolve_ts_module(base_dir, m.group(4))
        if module is None or module in visited:
            continue
        visited.add(module)
        nested = parse_typescript_exports(
            module.read_text(encoding="utf-8"), module.parent, visited
        )
        if statement_is_type:
            nested = [_entry(e.name, "type") for e in nested]
        entries.extend(nested)

    for m in _TS_DECLARATION_RE.finditer(code):
        name = m.group("name")
        if name in _SKIP_NAMES:
            continue
        keyword = m.group("keyword").split()[0]
        entries.append(_entry(name, "type" if keyword in _TS_TYPE_KEYWORDS else "function"))

    return _dedupe(entries)


# ─── Python ──────────────────────────────────────────────────────────────────


def _string_list(node: ast.AST) -> list[str] | None:
    """The strings of a list/tuple literal of string constants, else None."""
    if isinstance(node, (ast.List, ast.Tuple)):
        values = []
        for element in node.elts:
            if not (isinstance(element, ast.Constant) and isinstance(element.value, str)):
                return None
            values.append(element.value)
        return values
    return None


def _all_value(node: ast.AST, current: list[str]) -> list[str] | None:
    """Evaluate an ``__all__`` expression: literals, ``__all__`` and ``+``."""
    literal = _string_list(node)
    if literal is not None:
        return literal
    if isinstance(node, ast.Name) and node.id == "__all__":
        return list(current)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left = _all_value(node.left, current)
        right = _all_value(node.right, current)
        if left is not None and right is not None:
            return left + right
    return None


def _python_all_names(tree: ast.Module) -> list[str]:
    """Names in ``__all__``, following assignments in source order.

    Supports ``__all__ = [...]``/``(...)``, annotated assignment,
    ``__all__ += [...]``, ``__all__ = __all__ + [...]``, and
    ``__all__.extend([...])`` / ``__all__.append("x")``, including inside
    ``if``/``try`` blocks at module level.
    """
    names: list[str] = []

    def is_all(target: ast.AST) -> bool:
        return isinstance(target, ast.Name) and target.id == "__all__"

    def visit(statements: list[ast.stmt]) -> None:
        nonlocal names
        for stmt in statements:
            assigned = (
                isinstance(stmt, ast.Assign) and any(is_all(t) for t in stmt.targets)
            ) or (isinstance(stmt, ast.AnnAssign) and is_all(stmt.target) and stmt.value)
            if assigned:
                value = _all_value(stmt.value, names)
                if value is not None:
                    names = value
            elif (
                isinstance(stmt, ast.AugAssign)
                and is_all(stmt.target)
                and isinstance(stmt.op, ast.Add)
            ):
                value = _all_value(stmt.value, names)
                if value is not None:
                    names = names + value
            elif (
                isinstance(stmt, ast.Expr)
                and isinstance(stmt.value, ast.Call)
                and isinstance(stmt.value.func, ast.Attribute)
                and is_all(stmt.value.func.value)
                and stmt.value.args
            ):
                method = stmt.value.func.attr
                argument = stmt.value.args[0]
                if method == "extend":
                    value = _string_list(argument)
                    if value is not None:
                        names = names + value
                elif (
                    method == "append"
                    and isinstance(argument, ast.Constant)
                    and isinstance(argument.value, str)
                ):
                    names = names + [argument.value]
            elif isinstance(stmt, ast.If):
                visit(stmt.body)
                visit(stmt.orelse)
            elif isinstance(stmt, ast.Try):
                visit(stmt.body)
                for handler in stmt.handlers:
                    visit(handler.body)
                visit(stmt.orelse)
                visit(stmt.finalbody)

    visit(tree.body)
    return names


def parse_python_exports(content: str) -> list[ExportEntry]:
    """Parse the ``__all__`` of a Python module (e.g. ``__init__.py``)."""
    try:
        tree = ast.parse(content)
    except SyntaxError:
        return []

    entries: list[ExportEntry] = []
    for name in _python_all_names(tree):
        if name in _SKIP_NAMES:
            continue
        # Heuristic: uppercase first letter = type, otherwise function
        entries.append(_entry(name, "type" if name[0].isupper() else "function"))
    return _dedupe(entries)


# ─── Rust ────────────────────────────────────────────────────────────────────

_RUST_PUB_USE_RE = re.compile(r"\bpub\s+use\s+([^;]+);")
_RUST_ITEM_RE = re.compile(
    r"\bpub\s+(?:(?:const|async|unsafe|extern\s+\"[^\"]*\")\s+)*"
    r"(?P<keyword>fn|struct|enum|trait|type|union|const|static(?:\s+mut)?)\s+"
    r"(?P<name>[A-Za-z_]\w*)"
)
_RUST_TOKEN_RE = re.compile(r"r#[A-Za-z_]\w*|[A-Za-z_]\w*|::|[{},*]")
# Outer attributes directly before an item, such as `#[cfg(test)]`.
_RUST_TRAILING_ATTRIBUTES_RE = re.compile(r"(?:#\[(?:[^\[\]]|\[[^\[\]]*\])*\]\s*)+$")
_RUST_TEST_ONLY_RE = re.compile(r"\bcfg\s*\(\s*(?:test|doctest)\s*\)")


def _rust_depths(code: str) -> list[int]:
    """Brace depth at every offset of comment-free Rust code.

    Braces inside string and character literals do not count.
    """
    depths = [0] * len(code)
    depth = 0
    i = 0
    n = len(code)
    while i < n:
        ch = code[i]
        literal_end = i
        if ch == '"':
            literal_end = _skip_string(code, i, multiline=True)
        elif ch == "'":
            m = re.match(r"'(?:\\.|[^\\'])'", code[i:])
            literal_end = i + len(m.group(0)) if m else i
        if literal_end > i:
            for j in range(i, literal_end):
                depths[j] = depth
            i = literal_end
            continue
        if ch == "}":
            depth -= 1
        depths[i] = depth
        if ch == "{":
            depth += 1
        i += 1
    return depths


def _is_test_only(code: str, start: int) -> bool:
    """Whether the item at ``start`` has a ``#[cfg(test)]``/``#[cfg(doctest)]``."""
    attributes = _RUST_TRAILING_ATTRIBUTES_RE.search(code[max(0, start - 500) : start])
    return attributes is not None and _RUST_TEST_ONLY_RE.search(attributes.group(0)) is not None


def _parse_use_tree(tokens: list[str], pos: int, prefix: list[str]):
    """Parse one use tree; return ``(exports, next_pos)``.

    ``exports`` holds ``(exported_name, path, is_glob)`` tuples.
    """
    path = list(prefix)
    exports: list[tuple[str, list[str], bool]] = []
    while pos < len(tokens):
        token = tokens[pos]
        if token == "::":
            pos += 1
        elif token == "{":
            pos += 1
            while pos < len(tokens) and tokens[pos] != "}":
                sub, pos = _parse_use_tree(tokens, pos, path)
                exports.extend(sub)
                if pos < len(tokens) and tokens[pos] == ",":
                    pos += 1
            return exports, pos + 1
        elif token == "*":
            exports.append(("*", path, True))
            return exports, pos + 1
        elif token in {",", "}"}:
            break
        elif token == "as":
            alias = tokens[pos + 1] if pos + 1 < len(tokens) else "_"
            if alias != "_" and path:
                exports.append((alias.removeprefix("r#"), path, False))
            return exports, pos + 2
        else:
            path = path + [token]
            pos += 1
    if path and path[-1] == "self":
        path = path[:-1]
    if len(path) > len(prefix) or (path and path == prefix):
        exports.append((path[-1].removeprefix("r#"), path, False))
    return exports, pos


def _rust_module_file(base_dir: Path, path: list[str]) -> Path | None:
    """The file of module ``path`` (relative to the crate root ``src/``)."""
    segments = [s for s in path if s not in {"crate", "self"}]
    if not segments or "super" in segments:
        return None
    candidates = [
        base_dir.joinpath(*segments).with_suffix(".rs"),
        base_dir.joinpath(*segments, "mod.rs"),
    ]
    return next((p for p in candidates if p.is_file()), None)


def parse_rust_exports(
    content: str,
    base_dir: Path | None = None,
    _visited: set[Path] | None = None,
) -> list[ExportEntry]:
    """Parse the public surface of a Rust module (e.g. ``lib.rs``).

    Handles ``pub use`` in every form (single items, groups, nested groups,
    ``self``, ``as`` aliases, ``_``) and top-level ``pub fn``/``struct``/
    ``enum``/``trait``/``type``/``const``/``static`` items. ``pub(crate)``
    items and items inside blocks (such as methods) are ignored. Glob
    re-exports (``pub use foo::*``) are followed into the module file when
    ``base_dir`` (the crate's ``src/``) is given. Comments are ignored.
    """
    code = _strip_comments(content, rust=True)
    depths = _rust_depths(code)
    visited = _visited if _visited is not None else set()
    entries: list[ExportEntry] = []

    for m in _RUST_PUB_USE_RE.finditer(code):
        if depths[m.start()] != 0 or _is_test_only(code, m.start()):
            continue
        tokens = _RUST_TOKEN_RE.findall(m.group(1))
        exports, _ = _parse_use_tree(tokens, 0, [])
        for name, path, is_glob in exports:
            if is_glob:
                if base_dir is None:
                    continue
                module = _rust_module_file(base_dir, path)
                if module is None or module in visited:
                    continue
                visited.add(module)
                entries.extend(
                    parse_rust_exports(module.read_text(encoding="utf-8"), base_dir, visited)
                )
                continue
            if name in _SKIP_NAMES or name == "self":
                continue
            # Rust: uppercase first letter = struct/enum (type), lowercase = function
            entries.append(_entry(name, "type" if name[0].isupper() else "function"))

    for m in _RUST_ITEM_RE.finditer(code):
        if depths[m.start()] != 0 or _is_test_only(code, m.start()):
            continue
        name = m.group("name")
        if name in _SKIP_NAMES:
            continue
        keyword = m.group("keyword").split()[0]
        kind = "type" if keyword in {"struct", "enum", "trait", "type", "union"} else "function"
        entries.append(_entry(name, kind))

    return _dedupe(entries)


# ─── Wire fixture coverage ───────────────────────────────────────────────────

WIRE_FIXTURE_DIR = Path("spec") / "wire"

# The round-trip test of each language (see spec/wire/README.md).
WIRE_ROUND_TRIP_TESTS = {
    "typescript": Path("packages") / "server" / "src" / "wire-fixtures.test.ts",
    "python": Path("python") / "tests" / "test_wire_fixtures.py",
    "rust": Path("packages") / "rust" / "tests" / "wire_fixtures.rs",
}


def _references(test_source: str, fixture: str) -> bool:
    """Whether ``test_source`` names ``fixture`` in a string literal."""
    return re.search(rf"([\"'`]){re.escape(fixture)}\1", test_source) is not None


def check_wire_fixtures(root: Path) -> dict:
    """Check that every golden wire fixture is round-tripped in every language.

    Each fixture in ``spec/wire/*.json`` must be valid JSON, and each
    language's round-trip test must exist and reference the fixture by file
    name. Every problem counts as one gap.
    """
    wire_dir = root / WIRE_FIXTURE_DIR
    report: dict = {
        "fixture_dir": WIRE_FIXTURE_DIR.as_posix(),
        "fixtures": [],
        "suites": {lang: path.as_posix() for lang, path in WIRE_ROUND_TRIP_TESTS.items()},
        "missing_suites": [],
        "invalid_fixtures": [],
        "uncovered": {lang: [] for lang in WIRE_ROUND_TRIP_TESTS},
        "gaps": 0,
    }
    if not wire_dir.is_dir():
        report["missing_fixture_dir"] = True
        report["gaps"] = 1
        return report

    fixtures = sorted(path.name for path in wire_dir.glob("*.json"))
    report["fixtures"] = fixtures
    for name in fixtures:
        try:
            json.loads((wire_dir / name).read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            report["invalid_fixtures"].append(name)

    for lang, relative in WIRE_ROUND_TRIP_TESTS.items():
        suite = root / relative
        if not suite.is_file():
            report["missing_suites"].append(lang)
            report["uncovered"][lang] = list(fixtures)
            continue
        source = suite.read_text(encoding="utf-8")
        report["uncovered"][lang] = [name for name in fixtures if not _references(source, name)]

    report["gaps"] = (
        (0 if fixtures else 1)
        + len(report["invalid_fixtures"])
        + sum(len(names) for names in report["uncovered"].values())
    )
    return report


# ─── Diffing ─────────────────────────────────────────────────────────────────


def _diff_exports(
    ts: list[ExportEntry],
    py: list[ExportEntry],
    rs: list[ExportEntry],
) -> ParityReport:
    """Compare normalized export sets across languages."""
    report = ParityReport(typescript=ts, python=py, rust=rs)

    ts_names = {e.normalized for e in ts}
    py_names = {e.normalized for e in py}
    rs_names = {e.normalized for e in rs}

    # Filter out TS-only platform utilities
    ts_core = {n for n in ts_names if n not in _TS_ONLY_PREFIXES}

    # Missing from each language (relative to TS as source of truth)
    report.missing_from_python = sorted(ts_core - py_names)
    report.missing_from_rust = sorted(ts_core - rs_names)
    report.missing_from_typescript = sorted((py_names | rs_names) - ts_names)

    # Extra in each language (not in TS core)
    report.extra_in_python = sorted(py_names - ts_core)
    report.extra_in_rust = sorted(rs_names - ts_core)
    report.extra_in_typescript = sorted(ts_names - ts_core - py_names - rs_names)

    return report


# ─── Command ─────────────────────────────────────────────────────────────────


async def alfred_parity(path: str | None = None) -> CommandResult[dict]:
    """Check cross-language API surface and wire-shape parity (TS, Python, Rust).

    Parses public exports from each language's entry point, normalizes
    naming conventions (camelCase → snake_case), and reports gaps. Also checks
    that every golden fixture in ``spec/wire`` is round-tripped by the
    TypeScript, Python and Rust test suites.

    Args:
        path: Root of the AFD repo. Defaults to current working directory.

    Returns:
        CommandResult with gap report per language. ``total_gaps`` is
        ``name_gaps`` plus ``wire_fixtures.gaps``.
    """
    root = Path(path) if path else Path(".")

    ts_file = root / "packages" / "core" / "src" / "index.ts"
    py_file = root / "python" / "src" / "afd" / "__init__.py"
    rs_file = root / "packages" / "rust" / "src" / "lib.rs"

    missing_files = [str(f) for f in (ts_file, py_file, rs_file) if not f.exists()]
    if missing_files:
        return error(
            "NOT_FOUND",
            f"Export files not found: {', '.join(missing_files)}",
            suggestion="Run from the AFD repo root, or pass --path /path/to/afd",
        )

    ts_exports = parse_typescript_exports(ts_file.read_text(encoding="utf-8"), ts_file.parent)
    py_exports = parse_python_exports(py_file.read_text(encoding="utf-8"))
    rs_exports = parse_rust_exports(rs_file.read_text(encoding="utf-8"), rs_file.parent)

    report = _diff_exports(ts_exports, py_exports, rs_exports)
    wire = check_wire_fixtures(root)

    name_gaps = (
        len(report.missing_from_python)
        + len(report.missing_from_rust)
        + len(report.missing_from_typescript)
    )
    total_gaps = name_gaps + wire["gaps"]
    total_checks = max(len(ts_exports) + len(wire["fixtures"]) * len(WIRE_ROUND_TRIP_TESTS), 1)
    confidence = max(0.0, 1.0 - (total_gaps / total_checks))

    return success(
        data={
            "counts": {
                "typescript": len(ts_exports),
                "python": len(py_exports),
                "rust": len(rs_exports),
            },
            "missing_from_python": report.missing_from_python,
            "missing_from_rust": report.missing_from_rust,
            "missing_from_typescript": report.missing_from_typescript,
            "extra_in_python": report.extra_in_python,
            "extra_in_rust": report.extra_in_rust,
            "extra_in_typescript": report.extra_in_typescript,
            "name_gaps": name_gaps,
            "wire_fixtures": wire,
            "total_gaps": total_gaps,
        },
        confidence=confidence,
        reasoning=(
            f"Parsed {len(ts_exports)} TS, {len(py_exports)} Python, {len(rs_exports)} Rust "
            f"exports: {name_gaps} name gaps. Checked {len(wire['fixtures'])} wire fixtures "
            f"against {len(WIRE_ROUND_TRIP_TESTS)} round-trip suites: {wire['gaps']} gaps."
        ),
    )
