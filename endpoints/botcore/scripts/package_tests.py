"""Run the tests of Botcore's sibling packages (``packages/*``) against their sources.

Each package's tests run in their own pytest process: they all live in a ``tests`` package, so
one process would import two ``tests.conftest`` modules and stop. The packages import each other
(botcore-agents uses botcore-llm, and its connector tests the botcore-connectors plugin), so
every ``src`` directory, and botcore-connectors', is on the path. botcore-llm needs
the GitHub Copilot SDK, which the ``packages`` dependency group installs:

    uv sync --frozen --extra dev --extra mcp --extra cdp --group packages
    uv run --frozen python scripts/package_tests.py
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYTEST_ARGS = ("-q", "-p", "no:cacheprovider")
PACKAGES = sorted(path for path in (ROOT / "packages").iterdir() if (path / "tests").is_dir())


def main() -> int:
    sources = [str(package / "src") for package in PACKAGES]
    sources.append(str(ROOT / "botcore-connectors" / "src"))
    env = {**os.environ, "PYTHONPATH": os.pathsep.join(sources)}
    failed = []
    for package in PACKAGES:
        print(f"== {package.name}", flush=True)
        done = subprocess.run(
            [sys.executable, "-m", "pytest", str(package / "tests"), *PYTEST_ARGS],
            cwd=ROOT,
            env=env,
            check=False,
        )
        if done.returncode != 0:
            failed.append(package.name)
    if failed:
        print(f"Failed: {', '.join(failed)}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
