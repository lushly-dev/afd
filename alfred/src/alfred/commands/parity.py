"""alfred_parity — Cross-language API surface sync.

Parses public exports from TypeScript, Python, and Rust implementations
of AFD, normalizes naming conventions, and reports gaps.
"""

import re
from dataclasses import dataclass, field
from pathlib import Path

from afd.core.result import CommandResult, success, error


@dataclass
class ExportEntry:
    """A single exported name from a language."""

    name: str
    normalized: str
    kind: str  # "type" or "function"


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


# ─── Parsing ─────────────────────────────────────────────────────────────────

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


def parse_typescript_exports(content: str) -> list[ExportEntry]:
    """Parse TypeScript export statements from index.ts."""
    entries: list[ExportEntry] = []

    # Match: export type { Foo, Bar } from '...';
    type_re = re.compile(r"export\s+type\s*\{([^}]+)\}", re.MULTILINE)
    for m in type_re.finditer(content):
        names = [n.strip() for n in m.group(1).split(",") if n.strip()]
        for name in names:
            if name in _SKIP_NAMES:
                continue
            entries.append(ExportEntry(
                name=name,
                normalized=_normalize(name),
                kind="type",
            ))

    # Match: export { foo, bar } from '...';
    value_re = re.compile(r"export\s*\{([^}]+)\}\s*from", re.MULTILINE)
    for m in value_re.finditer(content):
        # Skip if preceded by "type" (already captured above)
        prefix_start = max(0, m.start() - 20)
        prefix = content[prefix_start:m.start()]
        if "type" in prefix:
            continue
        names = [n.strip() for n in m.group(1).split(",") if n.strip()]
        for name in names:
            if name in _SKIP_NAMES:
                continue
            entries.append(ExportEntry(
                name=name,
                normalized=_normalize(name),
                kind="function",
            ))

    # Match: export { FooClass } from '...'; (class re-exports look like value exports)
    # Already handled above.

    return entries


def parse_python_exports(content: str) -> list[ExportEntry]:
    """Parse Python __all__ list from __init__.py."""
    entries: list[ExportEntry] = []

    # Extract the __all__ list
    all_re = re.compile(r"__all__\s*=\s*\[(.*?)\]", re.DOTALL)
    m = all_re.search(content)
    if not m:
        return entries

    names_str = m.group(1)
    name_re = re.compile(r'["\'](\w+)["\']')
    for nm in name_re.finditer(names_str):
        name = nm.group(1)
        if name in _SKIP_NAMES:
            continue
        # Heuristic: uppercase first letter = type, otherwise function
        kind = "type" if name[0].isupper() else "function"
        entries.append(ExportEntry(
            name=name,
            normalized=_normalize(name),
            kind=kind,
        ))

    return entries


def parse_rust_exports(content: str) -> list[ExportEntry]:
    """Parse Rust pub use re-exports from lib.rs."""
    entries: list[ExportEntry] = []

    # Match: pub use module::{Foo, bar, Baz};
    use_re = re.compile(r"pub\s+use\s+\w+::\{([^}]+)\}", re.MULTILINE)
    for m in use_re.finditer(content):
        names = [n.strip() for n in m.group(1).split(",") if n.strip()]
        for name in names:
            if name in _SKIP_NAMES:
                continue
            # Rust: uppercase first letter = struct/enum (type), lowercase = function
            kind = "type" if name[0].isupper() else "function"
            entries.append(ExportEntry(
                name=name,
                normalized=_normalize(name),
                kind=kind,
            ))

    return entries


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
    """Check cross-language API surface parity (TypeScript, Python, Rust).

    Parses public exports from each language's entry point, normalizes
    naming conventions (camelCase → snake_case), and reports gaps.

    Args:
        path: Root of the AFD repo. Defaults to current working directory.

    Returns:
        CommandResult with gap report per language.
    """
    root = Path(path) if path else Path(".")

    ts_file = root / "packages" / "core" / "src" / "index.ts"
    py_file = root / "python" / "src" / "afd" / "__init__.py"
    rs_file = root / "packages" / "rust" / "src" / "lib.rs"

    missing_files = []
    if not ts_file.exists():
        missing_files.append(str(ts_file))
    if not py_file.exists():
        missing_files.append(str(py_file))
    if not rs_file.exists():
        missing_files.append(str(rs_file))

    if missing_files:
        return error(
            "NOT_FOUND",
            f"Export files not found: {', '.join(missing_files)}",
            suggestion="Run from the AFD repo root, or pass --path /path/to/afd",
        )

    ts_exports = parse_typescript_exports(ts_file.read_text(encoding="utf-8"))
    py_exports = parse_python_exports(py_file.read_text(encoding="utf-8"))
    rs_exports = parse_rust_exports(rs_file.read_text(encoding="utf-8"))

    report = _diff_exports(ts_exports, py_exports, rs_exports)

    total_gaps = (
        len(report.missing_from_python)
        + len(report.missing_from_rust)
        + len(report.missing_from_typescript)
    )
    total_exports = max(len(ts_exports), 1)
    confidence = max(0.0, 1.0 - (total_gaps / total_exports))

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
            "total_gaps": total_gaps,
        },
        confidence=confidence,
        reasoning=(
            f"Parsed {len(ts_exports)} TS, {len(py_exports)} Python, {len(rs_exports)} Rust exports. "
            f"{total_gaps} gaps found across languages."
        ),
    )
