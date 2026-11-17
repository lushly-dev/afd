"""Analysis commands — dead-code, circular-imports, unused-deps, dep-graph.

Python import scanning lives in import_graph.py and is re-exported here.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tomllib
from collections import defaultdict

from afd import CommandResult, error, success

from botcore.commands.dev.import_graph import _STDLIB_MODULES as _STDLIB_MODULES
from botcore.commands.dev.import_graph import (
    _build_dep_graph_result as _build_dep_graph_result,
)
from botcore.commands.dev.import_graph import (
    _collect_python_imports as _collect_python_imports,
)
from botcore.commands.dev.import_graph import _find_cycles as _find_cycles
from botcore.commands.dev.import_graph import (
    _is_type_checking_guard as _is_type_checking_guard,
)
from botcore.commands.dev.import_graph import _scan_imports as _scan_imports
from botcore.commands.dev.import_graph import _top_level_imports as _top_level_imports
from botcore.config import load_config
from botcore.utils.runner import run_external_tool
from botcore.utils.workspace import find_workspace, resolve_language, resolve_path


async def dev_dead_code(
    path: str | None = None,
    min_confidence: int = 80,
    language: str | None = None,
) -> CommandResult[dict]:
    """Find dead/unused code using vulture (Python), knip (TS), or cargo-udeps (Rust)."""
    from botcore.commands.dev.core import _aggregate_results, _should_run_all

    ws = find_workspace()
    config = load_config(workspace=ws)

    if _should_run_all(language, path, config):
        results: dict[str, CommandResult[dict]] = {}
        for lang in config.languages:
            results[lang] = await dev_dead_code(
                path=path,
                min_confidence=min_confidence,
                language=lang,
            )
        return _aggregate_results(results, "dead-code")

    lang = (
        resolve_language(
            resolve_path(path, ws) if path else None,
            config,
            ws,
            language_override=language,
        )
        if ws
        else (language or config.language)
    )
    scan_path = str(resolve_path(path, ws))

    if lang == "typescript":
        result = await run_external_tool(
            "npx",
            ["knip", "--no-progress"],
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
            "cargo",
            ["+nightly", "udeps"],
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
            issues.append(
                {
                    "file": parts[0],
                    "line": int(parts[1]) if parts[1].isdigit() else 0,
                    "message": parts[2].strip(),
                }
            )

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
    path: str | None = None,
    language: str | None = None,
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

    lang = (
        resolve_language(
            resolve_path(path, ws) if path else None,
            config,
            ws,
            language_override=language,
        )
        if ws
        else (language or config.language)
    )

    if lang == "typescript":
        # --extensions is required: without it madge processes 0 files when
        # pointed at a TypeScript directory and cycles go undetected.
        result = await run_external_tool(
            "npx",
            ["madge", "--circular", "--extensions", "ts,tsx", path or "."],
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
        cycles = [line.strip() for line in output.splitlines() if re.match(r"^\s*\d+\)\s", line)]
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

    scan_path = resolve_path(path, ws)

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
            "npx",
            ["depcheck", "--json"],
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
                f"{len(unused)} potentially unused npm deps" if unused else "No unused npm deps"
            ),
        )

    if lang == "rust":
        result = await run_external_tool(
            "cargo",
            ["+nightly", "udeps"],
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

    lang = (
        resolve_language(
            resolve_path(path, ws) if path else None,
            config,
            ws,
            language_override=language,
        )
        if ws
        else (language or config.language)
    )

    if lang == "typescript":
        result = await run_external_tool(
            "npx",
            ["madge", "--json", path or "."],
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
            data={
                "path": path or ".",
                "graph": graph_data,
                "tool": "madge",
                "module_count": len(graph_data),
            },
            reasoning=f"TypeScript dependency graph: {len(graph_data)} modules",
        )

    if lang == "rust":
        result = await run_external_tool(
            "cargo",
            ["modules", "structure", "--lib"],
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
    scan_path = resolve_path(path, ws)

    if not scan_path.exists():
        return error(
            "PATH_NOT_FOUND",
            f"Path not found: {scan_path}",
            suggestion="Verify the path exists or omit to use default src/",
        )

    modules, raw_imports = _collect_python_imports(scan_path)
    root_pkgs = {m.split(".")[0] for m in modules if m}
    graph: dict[str, list[str]] = {
        mod: sorted({t for t in targets if t.split(".")[0] in root_pkgs})
        for mod, targets in raw_imports.items()
    }

    result_data: dict = _build_dep_graph_result(
        scan_path,
        modules,
        graph,
        output,
    )

    edges = result_data["edges"]
    return success(
        data=result_data,
        reasoning=f"Generated dependency graph: {len(modules)} modules, {edges} edges",
    )
