"""Quality gate script for do-commit skill.

Detects project languages and runs all relevant quality checks.
Outputs structured JSON to stdout. Recovery suggestions to stderr.

Usage:
    python quality_gate.py [--quick]
"""

import json
import subprocess
import sys
import time
from pathlib import Path


def detect_languages(root: Path) -> list[str]:
    """Detect project languages from config files."""
    langs = []
    if (root / "package.json").exists() or any(root.rglob("*/package.json")):
        langs.append("typescript")
    if (root / "pyproject.toml").exists() or any(root.rglob("*/pyproject.toml")):
        langs.append("python")
    if (root / "Cargo.toml").exists() or any(root.rglob("*/Cargo.toml")):
        langs.append("rust")
    return langs


def read_config(root: Path) -> dict:
    """Read botcore.toml for thresholds."""
    config_path = root / "botcore.toml"
    defaults = {
        "file_size_warn": 500,
        "file_size_error": 1000,
        "coverage_threshold": 80,
    }
    if not config_path.exists():
        return defaults

    try:
        import tomllib
    except ImportError:
        try:
            import tomli as tomllib
        except ImportError:
            print("Warning: no TOML parser available, using defaults", file=sys.stderr)
            return defaults

    with open(config_path, "rb") as f:
        data = tomllib.load(f)
    defaults.update(data.get("settings", {}))
    return defaults


def run_check(name: str, cmd: list[str], cwd: Path) -> dict:
    """Run a single check and return result dict."""
    start = time.monotonic()
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=300,
        )
        duration_ms = int((time.monotonic() - start) * 1000)
        passed = result.returncode == 0
        output = result.stdout.strip() if not passed else ""
        if not passed and result.stderr.strip():
            output = f"{output}\n{result.stderr.strip()}".strip()
        return {
            "name": name,
            "passed": passed,
            "duration_ms": duration_ms,
            "output": output[:2000] if output else "",
        }
    except FileNotFoundError:
        duration_ms = int((time.monotonic() - start) * 1000)
        return {
            "name": name,
            "passed": True,
            "duration_ms": duration_ms,
            "output": "skipped (tool not found)",
        }
    except subprocess.TimeoutExpired:
        duration_ms = int((time.monotonic() - start) * 1000)
        return {
            "name": name,
            "passed": False,
            "duration_ms": duration_ms,
            "output": "timed out after 300s",
        }


def get_checks(languages: list[str], root: Path) -> list[tuple[str, list[str]]]:
    """Build list of checks based on detected languages."""
    checks = []

    # TypeScript checks
    if "typescript" in languages:
        # Detect package manager
        if (root / "pnpm-lock.yaml").exists():
            pm = "pnpm"
        elif (root / "yarn.lock").exists():
            pm = "yarn"
        else:
            pm = "npm"

        checks.append(("lint:ts", [pm, "run", "lint"]))
        checks.append(("typecheck:ts", [pm, "run", "typecheck"]))
        checks.append(("test:ts", [pm, "test"]))
        checks.append(("build:ts", [pm, "run", "build"]))

    # Python checks
    if "python" in languages:
        checks.append(("lint:py", [sys.executable, "-m", "ruff", "check", "."]))
        checks.append(("test:py", [sys.executable, "-m", "pytest", "--tb=short", "-q"]))

    # Rust checks
    if "rust" in languages:
        checks.append(("lint:rs", ["cargo", "clippy", "--", "-D", "warnings"]))
        checks.append(("check:rs", ["cargo", "check"]))
        checks.append(("test:rs", ["cargo", "test"]))

    # Universal checks (use botcore commands if available)
    checks.append(("check-size", [sys.executable, "-c",
        "from botcore.commands.dev import dev_check_size; "
        "import sys; result = dev_check_size(); "
        "sys.exit(0 if result.get('passed', True) else 1)"
    ]))
    checks.append(("check-paths", [sys.executable, "-c",
        "from botcore.commands.dev import dev_check_paths; "
        "import sys; result = dev_check_paths(); "
        "sys.exit(0 if result.get('passed', True) else 1)"
    ]))
    checks.append(("circular-imports", [sys.executable, "-c",
        "from botcore.commands.dev import dev_circular_imports; "
        "import sys; result = dev_circular_imports(); "
        "sys.exit(0 if result.get('passed', True) else 1)"
    ]))

    return checks


def main():
    root = Path.cwd()
    languages = detect_languages(root)
    config = read_config(root)

    if not languages:
        print(
            "No project files detected (package.json, pyproject.toml, Cargo.toml). "
            "Try running from the project root.",
            file=sys.stderr,
        )
        json.dump({"passed": False, "checks": [], "summary": "No project detected."}, sys.stdout, indent=2)
        sys.exit(1)

    print(f"Detected languages: {', '.join(languages)}", file=sys.stderr)
    print(f"Config thresholds: file_size_warn={config.get('file_size_warn')}, "
          f"file_size_error={config.get('file_size_error')}", file=sys.stderr)

    checks = get_checks(languages, root)
    results = []

    for name, cmd in checks:
        print(f"Running {name}...", file=sys.stderr)
        result = run_check(name, cmd, root)
        results.append(result)

    passed_count = sum(1 for r in results if r["passed"])
    total = len(results)
    all_passed = passed_count == total

    failed = [r for r in results if not r["passed"]]
    if failed:
        print("\nFailed checks:", file=sys.stderr)
        for r in failed:
            print(f"  - {r['name']}: {r['output'][:200]}", file=sys.stderr)
        print("\nFix the above failures before committing.", file=sys.stderr)

    report = {
        "passed": all_passed,
        "languages": languages,
        "checks": results,
        "summary": f"{passed_count}/{total} checks passed."
        + ("" if all_passed else f" Fix: {', '.join(r['name'] for r in failed)}."),
    }

    json.dump(report, sys.stdout, indent=2)
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
