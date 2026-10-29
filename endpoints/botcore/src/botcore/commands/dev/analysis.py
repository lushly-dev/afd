"""Analysis commands — dead-code, circular-imports, unused-deps, dep-graph."""

from __future__ import annotations

import ast
import json
import re
import subprocess
import sys
import tomllib
from collections import defaultdict
from pathlib import Path

from afd import CommandResult, error, success

from botcore.config import load_config
from botcore.utils.runner import run_external_tool
from botcore.utils.workspace import find_workspace, resolve_language


async def dev_dead_code(
    path: str | None = None, min_confidence: int = 80, language: str | None = None,
) -> CommandResult[dict]:
    """Find dead/unused code using vulture (Python), knip (TS), or cargo-udeps (Rust)."""
    from botcore.commands.dev.core import _aggregate_results, _should_run_all

    ws = find_workspace()
    config = load_config(workspace=ws)

    if _should_run_all(language, path, config):
        results: dict[str, CommandResult[dict]] = {}
        for lang in config.languages:
            results[lang] = await dev_dead_code(
                path=path, min_confidence=min_confidence, language=lang,
            )
        return _aggregate_results(results, "dead-code")

    lang = resolve_language(
        Path(path) if path else None, config, ws, language_override=language,
    ) if ws else (language or config.language)
    scan_path = path or (str(ws / "src") if ws else "src")

    if lang == "typescript":
        result = await run_external_tool(
            "npx", ["knip", "--no-progress"],
            install_hint="npm i -D knip",
            cwd=ws,
        )
        if result is None:
            return success(
                data={"path": scan_path, "issues": [], "count": 0, "skipped": True},
                reasoning="knip not available — skipped TypeScript dead code check",
            )
        return success(
            data={"path": scan_path, "raw_output": result.get("output", ""), "tool": "knip"},
            reasoning="TypeScript dead code check via knip",
        )

    if lang == "rust":
        result = await run_external_tool(
            "cargo", ["+nightly", "udeps"],
            install_hint="cargo install cargo-udeps",
            cwd=ws,
        )
        if result is None:
            return success(
                data={"path": scan_path, "issues": [], "count": 0, "skipped": True},
                reasoning="cargo-udeps not available — skipped Rust dead code check",
            )
        return success(
            data={"path": scan_path, "raw_output": result.get("output", ""), "tool": "cargo-udeps"},
            reasoning="Rust dead code check via cargo-udeps",
        )

    # Default: Python via vulture
    result = subprocess.run(
        [sys.executable, "-m", "vulture", scan_path, f"--min-confidence={min_confidence}"],
        capture_output=True,
        text=True,
        cwd=ws,
    )

    issues = []
    for line in result.stdout.strip().splitlines():
        if not line:
            continue
        parts = line.split(":", 2)
        if len(parts) >= 3:
            issues.append({
                "file": parts[0],
                "line": int(parts[1]) if parts[1].isdigit() else 0,
                "message": parts[2].strip(),
            })

    result_data: dict = {
        "path": scan_path,
        "issues": issues,
        "count": len(issues),
    }

    if issues:
        unused_funcs = sum(1 for i in issues if "unused function" in i["message"].lower())
        unused_vars = sum(1 for i in issues if "unused variable" in i["message"].lower())
        unused_imports = sum(1 for i in issues if "unused import" in i["message"].lower())

        result_data["summary"] = {
            "unused_functions": unused_funcs,
            "unused_variables": unused_vars,
            "unused_imports": unused_imports,
        }

        return success(
            data=result_data,
            reasoning=(
                f"Found {len(issues)} dead code issues: "
                f"{unused_funcs} functions, {unused_vars} variables, "
                f"{unused_imports} imports"
            ),
        )

    return success(
        data=result_data,
        reasoning=f"No dead code found in {scan_path}",
    )


async def dev_circular_imports(
    path: str | None = None, language: str | None = None,
) -> CommandResult[dict]:
    """Detect circular imports in Python code, or circular deps via madge (TS)."""
    from botcore.commands.dev.core import _aggregate_results, _should_run_all

    ws = find_workspace()
    config = load_config(workspace=ws)

    if _should_run_all(language, path, config):
        results: dict[str, CommandResult[dict]] = {}
        for lang in config.languages:
            results[lang] = await dev_circular_imports(path=path, language=lang)
        return _aggregate_results(results, "circular-imports")

    lang = resolve_language(
        Path(path) if path else None, config, ws, language_override=language,
    ) if ws else (language or config.language)

    if lang == "typescript":
        # --extensions is required: without it madge processes 0 files when
        # pointed at a TypeScript directory and cycles go undetected.
        result = await run_external_tool(
            "npx", ["madge", "--circular", "--extensions", "ts,tsx", path or "."],
            install_hint="npm i -D madge",
            cwd=ws,
        )
        if result is None:
            return success(
                data={"path": path or ".", "cycles": [], "cycle_count": 0, "skipped": True},
                reasoning="madge not available — skipped TypeScript circular dependency check",
            )
        output = result.get("output", "")
        # Fail closed on empty scans: madge reports "Processed N files", and
        # N == 0 means a mis-targeted invocation, not a clean dependency graph.
        processed = re.search(r"Processed (\d+) files", output)
        files_processed = int(processed.group(1)) if processed else None
        if files_processed == 0:
            return error(
                "NO_FILES_SCANNED",
                "madge processed 0 files — wrong path or missing extensions",
                suggestion="Point at a directory containing TypeScript sources",
            )
        # Cycles are listed as "N) a.ts > b.ts > a.ts" lines; madge's prose
        # ("No circular dependency found!") also contains the word "circular",
        # so parse the numbered lines rather than substring-matching.
        cycles = [
            line.strip() for line in output.splitlines()
            if re.match(r"^\s*\d+\)\s", line)
        ]
        if len(cycles) > config.circular_deps_allowed:
            cycle_summary = "; ".join(cycles[:5])
            return error(
                "CIRCULAR_DEPS",
                f"Found {len(cycles)} circular dependenc"
                f"{'y' if len(cycles) == 1 else 'ies'}: {cycle_summary}",
                suggestion="Break cycles by restructuring imports",
            )
        return success(
            data={
                "path": path or ".",
                "cycles": cycles,
                "cycle_count": len(cycles),
                "files_processed": files_processed,
                "tool": "madge",
            },
            reasoning=f"Circular dependency check via madge — {len(cycles)} cycle(s)",
        )

    scan_path = Path(path) if path else (ws / "src" if ws else Path("src"))

    if not scan_path.exists():
        return error(
            "PATH_NOT_FOUND",
            f"Path not found: {scan_path}",
            suggestion="Verify the path exists or omit to use default src/",
        )

    all_modules, imports = _collect_python_imports(scan_path)

    internal_imports: dict[str, set[str]] = defaultdict(set)
    for src, targets in imports.items():
        for target in targets:
            for mod in all_modules:
                if target == mod or target.startswith(mod + ".") or mod.startswith(target + "."):
                    internal_imports[src].add(target)
                    break

    cycles = _find_cycles(dict(internal_imports), all_modules)

    result_data = {
        "path": str(scan_path),
        "modules_scanned": len(all_modules),
        "cycles": cycles,
        "cycle_count": len(cycles),
    }

    if cycles:
        cycle_summary = "; ".join(" → ".join(c) for c in cycles[:5])
        return error(
            "CIRCULAR_IMPORTS",
            f"Found {len(cycles)} circular import(s): {cycle_summary}",
            suggestion="Break cycles by restructuring imports or using lazy imports",
        )

    return success(
        data=result_data,
        reasoning=f"No circular imports found in {len(imports)} modules",
    )


def _collect_python_imports(
    scan_path: Path,
) -> tuple[set[str], dict[str, set[str]]]:
    """Parse Python files under *scan_path* and return (modules, imports).

    Skips imports inside ``if TYPE_CHECKING:`` blocks and function/method
    bodies since those are not runtime circular-import risks.
    """
    all_modules: set[str] = set()
    imports: dict[str, set[str]] = defaultdict(set)

    for py_file in scan_path.rglob("*.py"):
        if "__pycache__" in str(py_file):
            continue
        try:
            content = py_file.read_text(encoding="utf-8")
            tree = ast.parse(content)
        except Exception:
            continue
        try:
            rel_path = py_file.relative_to(scan_path)
            module_name = (
                str(rel_path.with_suffix(""))
                .replace("/", ".").replace("\\", ".")
            )
            if module_name.endswith(".__init__"):
                module_name = module_name[:-9]
        except ValueError:
            continue

        all_modules.add(module_name)
        for node in _top_level_imports(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name != module_name:
                        imports[module_name].add(alias.name)
            elif isinstance(node, ast.ImportFrom):
                if node.module and node.level == 0 and node.module != module_name:
                    imports[module_name].add(node.module)

    return all_modules, imports


def _top_level_imports(tree: ast.Module) -> list[ast.stmt]:
    """Return module-level import nodes, excluding TYPE_CHECKING blocks."""
    result: list[ast.stmt] = []
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            result.append(node)
        elif isinstance(node, ast.If) and _is_type_checking_guard(node):
            continue  # skip TYPE_CHECKING block entirely
    return result


def _is_type_checking_guard(node: ast.If) -> bool:
    """Return True when the if-test is ``TYPE_CHECKING`` or similar."""
    test = node.test
    if isinstance(test, ast.Name) and test.id == "TYPE_CHECKING":
        return True
    if isinstance(test, ast.Attribute) and test.attr == "TYPE_CHECKING":
        return True
    return False


def _find_cycles(graph: dict[str, set[str]], known_modules: set[str]) -> list[list[str]]:
    """Find cycles in the import graph via DFS."""
    cycles: list[list[str]] = []
    visited: set[str] = set()

    def dfs(node: str, path: list[str]) -> None:
        if node in path:
            cycle_start = path.index(node)
            cycle = path[cycle_start:] + [node]
            if len(set(cycle)) > 1 and cycle not in cycles:
                cycles.append(cycle)
            return

        if node in visited:
            return

        visited.add(node)
        path.append(node)

        for neighbor in graph.get(node, []):
            for mod in known_modules:
                if neighbor == mod or mod.startswith(neighbor + "."):
                    dfs(neighbor, path.copy())
                    break

    for node in graph:
        dfs(node, [])

    return cycles


async def dev_unused_deps(language: str | None = None) -> CommandResult[dict]:
    """Find unused dependencies in pyproject.toml (Python), depcheck (TS), or cargo-udeps (Rust)."""
    import re

    from botcore.commands.dev.core import _aggregate_results, _should_run_all

    ws = find_workspace()
    if not ws:
        return error(
            "NO_WORKSPACE",
            "Could not find workspace root",
            suggestion="Run from within a Git repository",
        )

    config = load_config(workspace=ws)

    if _should_run_all(language, None, config):
        results: dict[str, CommandResult[dict]] = {}
        for lang in config.languages:
            results[lang] = await dev_unused_deps(language=lang)
        return _aggregate_results(results, "unused-deps")

    lang = resolve_language(None, config, ws, language_override=language)

    if lang == "typescript":
        result = await run_external_tool(
            "npx", ["depcheck", "--json"],
            install_hint="npm i -D depcheck",
            cwd=ws,
        )
        if result is None:
            return success(
                data={"declared": [], "used": [], "potentially_unused": [], "skipped": True},
                reasoning="depcheck not available — skipped TypeScript unused deps check",
            )
        try:
            data = json.loads(result.get("output", "{}"))
            unused = list(data.get("dependencies", []))
        except (json.JSONDecodeError, TypeError):
            unused = []
        return success(
            data={"potentially_unused": unused, "tool": "depcheck"},
            reasoning=(
                f"{len(unused)} potentially unused npm deps"
                if unused else "No unused npm deps"
            ),
        )

    if lang == "rust":
        result = await run_external_tool(
            "cargo", ["+nightly", "udeps"],
            install_hint="cargo install cargo-udeps",
            cwd=ws,
        )
        if result is None:
            return success(
                data={"declared": [], "used": [], "potentially_unused": [], "skipped": True},
                reasoning="cargo-udeps not available — skipped Rust unused deps check",
            )
        return success(
            data={"raw_output": result.get("output", ""), "tool": "cargo-udeps"},
            reasoning="Rust unused dependency check via cargo-udeps",
        )

    # Default: Python
    pyproject = ws / "pyproject.toml"
    if not pyproject.exists():
        return error(
            "NO_PYPROJECT",
            "No pyproject.toml found",
            suggestion="Initialize project with 'hatch new' or create pyproject.toml",
        )

    data = tomllib.loads(pyproject.read_text(encoding="utf-8"))

    declared_deps: set[str] = set()
    for dep in data.get("project", {}).get("dependencies", []):
        match = re.match(r"([a-zA-Z0-9_-]+)", dep)
        if match:
            declared_deps.add(match.group(1).lower().replace("-", "_"))

    src_path = ws / "src"
    if not src_path.exists():
        src_path = ws

    used_imports = _scan_imports(src_path)
    potentially_unused = declared_deps - used_imports
    runtime_deps = {"pip", "setuptools", "wheel", "hatchling", "hatch"}
    potentially_unused -= runtime_deps

    result_data = {
        "declared": sorted(declared_deps),
        "used": sorted(used_imports),
        "potentially_unused": sorted(potentially_unused),
    }

    if potentially_unused:
        deps_list = ", ".join(sorted(potentially_unused))
        return success(
            data=result_data,
            reasoning=f"{len(potentially_unused)} potentially unused deps: {deps_list}",
        )

    return success(
        data=result_data,
        reasoning=f"All {len(declared_deps)} declared dependencies appear to be used",
    )


# Known stdlib modules (subset) for filtering
_STDLIB_MODULES = {
    "os", "sys", "re", "json", "pathlib", "typing", "asyncio", "io",
    "subprocess", "collections", "datetime", "time", "functools",
    "itertools", "contextlib", "logging", "unittest", "dataclasses",
    "abc", "copy", "tempfile", "shutil", "glob", "hashlib", "base64",
    "urllib", "http", "email", "html", "xml", "sqlite3", "csv",
    "pickle", "struct", "codecs", "locale", "gettext", "argparse",
    "configparser", "traceback", "warnings", "inspect", "importlib",
    "pkgutil", "platform", "socket", "ssl", "select", "threading",
    "multiprocessing", "queue", "concurrent", "contextvars", "enum",
    "numbers", "decimal", "fractions", "random", "statistics", "math",
    "cmath", "operator", "string", "textwrap", "difflib", "secrets",
    "uuid", "weakref", "types", "pprint", "reprlib", "graphlib",
    "heapq", "bisect", "array", "ast", "dis", "compileall", "venv",
    "zipfile", "tarfile", "gzip", "bz2", "lzma", "zlib", "signal",
    "tomllib",
}


def _scan_imports(src_path: Path) -> set[str]:
    """Scan Python files for imported third-party packages."""
    used_imports: set[str] = set()

    for py_file in src_path.rglob("*.py"):
        if "__pycache__" in str(py_file):
            continue

        try:
            content = py_file.read_text(encoding="utf-8")
            tree = ast.parse(content)
        except Exception:
            continue

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    pkg = alias.name.split(".")[0].lower().replace("-", "_")
                    if pkg not in _STDLIB_MODULES:
                        used_imports.add(pkg)
            elif isinstance(node, ast.ImportFrom):
                if node.module and node.level == 0:
                    pkg = node.module.split(".")[0].lower().replace("-", "_")
                    if pkg not in _STDLIB_MODULES:
                        used_imports.add(pkg)

    return used_imports


async def dev_dep_graph(
    path: str | None = None,
    output: str = "json",
    language: str | None = None,
) -> CommandResult[dict]:
    """Generate dependency graph of modules (Python AST, madge for TS, cargo-modules for Rust)."""
    from botcore.commands.dev.core import _aggregate_results, _should_run_all

    ws = find_workspace()
    config = load_config(workspace=ws)

    if _should_run_all(language, path, config):
        results: dict[str, CommandResult[dict]] = {}
        for lang in config.languages:
            results[lang] = await dev_dep_graph(path=path, output=output, language=lang)
        return _aggregate_results(results, "dep-graph")

    lang = resolve_language(
        Path(path) if path else None, config, ws, language_override=language,
    ) if ws else (language or config.language)

    if lang == "typescript":
        result = await run_external_tool(
            "npx", ["madge", "--json", path or "."],
            install_hint="npm i -D madge",
            cwd=ws,
        )
        if result is None:
            return success(
                data={"path": path or ".", "modules": [], "module_count": 0, "skipped": True},
                reasoning="madge not available — skipped TypeScript dependency graph",
            )
        try:
            graph_data = json.loads(result.get("output", "{}"))
        except (json.JSONDecodeError, TypeError):
            graph_data = {}
        return success(
            data={"path": path or ".", "graph": graph_data, "tool": "madge",
                  "module_count": len(graph_data)},
            reasoning=f"TypeScript dependency graph: {len(graph_data)} modules",
        )

    if lang == "rust":
        result = await run_external_tool(
            "cargo", ["modules", "structure", "--lib"],
            install_hint="cargo install cargo-modules",
            cwd=ws,
        )
        if result is None:
            return success(
                data={"path": path or ".", "modules": [], "module_count": 0, "skipped": True},
                reasoning="cargo-modules not available — skipped Rust dependency graph",
            )
        return success(
            data={
                "path": path or ".",
                "raw_output": result.get("output", ""),
                "tool": "cargo-modules",
            },
            reasoning="Rust module structure via cargo-modules",
        )

    # Default: Python AST graph
    scan_path = Path(path) if path else (ws / "src" if ws else Path("src"))

    if not scan_path.exists():
        return error(
            "PATH_NOT_FOUND",
            f"Path not found: {scan_path}",
            suggestion="Verify the path exists or omit to use default src/",
        )

    modules, raw_imports = _collect_python_imports(scan_path)
    root_pkgs = {m.split(".")[0] for m in modules if m}
    graph: dict[str, list[str]] = {
        mod: sorted({
            t for t in targets
            if t.split(".")[0] in root_pkgs
        })
        for mod, targets in raw_imports.items()
    }

    result_data: dict = _build_dep_graph_result(
        scan_path, modules, graph, output,
    )

    edges = result_data["edges"]
    return success(
        data=result_data,
        reasoning=f"Generated dependency graph: {len(modules)} modules, {edges} edges",
    )


def _build_dep_graph_result(
    scan_path: Path,
    modules: set[str],
    graph: dict[str, list[str]],
    output: str,
) -> dict:
    """Build the result data dict for dep-graph, optionally with DOT output."""
    result_data: dict = {
        "path": str(scan_path),
        "modules": sorted(modules),
        "module_count": len(modules),
        "edges": sum(len(v) for v in graph.values()),
        "graph": dict(graph),
    }

    if output == "dot":
        dot_lines = ["digraph dependencies {", "  rankdir=LR;"]
        for src, targets in graph.items():
            for target in targets:
                dot_lines.append(f'  "{src}" -> "{target}";')
        dot_lines.append("}")
        result_data["dot"] = "\n".join(dot_lines)

    return result_data
