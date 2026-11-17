"""Python import scanning for the circular-imports, unused-deps and dep-graph commands."""

from __future__ import annotations

import ast
from collections import defaultdict
from pathlib import Path


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
            module_name = str(rel_path.with_suffix("")).replace("/", ".").replace("\\", ".")
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


# Known stdlib modules (subset) for filtering
# fmt: off
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
# fmt: on


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
