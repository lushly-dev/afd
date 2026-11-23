"""Run the tests of Botcore's sibling packages against their sources, and the scenarios that
cross them.

The siblings are the packages under ``packages/``, the ``botcore-connectors`` plugin and the
plugins under ``plugins/`` except those with a gate of their own (``OWN_GATE``: botcore-factory
has its own lock file and workflow). A new plugin's tests therefore run without a change here,
and an ``OWN_GATE`` entry whose plugin is gone stops the run.

Each package's tests run in their own pytest process, from the package's directory: they all
live in a ``tests`` package, so one process would import two ``tests.conftest`` modules and
stop, and each package's own pytest and coverage settings apply. A package whose coverage
settings declare ``fail_under`` runs under coverage, so its floor holds. The packages import
each other (botcore-agents uses botcore-llm, and its connector tests the botcore-connectors
plugin), so every ``src`` directory is on the path.

Botcore's integration scenarios (``tests/integration``) drive the agents, LLM and memory
packages together, so they run here rather than with the core tests. Their ``live`` tier calls
the real Copilot CLI and needs its sign-in, so only the tier with a mocked LLM runs.

The ``packages`` dependency group installs what the siblings need beyond Botcore's extras:

    uv sync --frozen --extra dev --extra mcp --extra cdp --group packages
    uv run --frozen python scripts/package_tests.py
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import tomllib
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYTEST_ARGS = ("-q", "-p", "no:cacheprovider")
#: Plugins whose tests run in a workflow of their own, with their own environment.
OWN_GATE = frozenset({"botcore-factory"})
#: The integration scenarios, without the tier that needs a signed-in Copilot CLI.
INTEGRATION = ("tests/integration", "-m", "not live")


@dataclass(frozen=True)
class Run:
    """One pytest process: what it is called, where it runs and its arguments."""

    label: str
    cwd: Path
    args: tuple[str, ...]

    def command(self) -> list[str]:
        return [sys.executable, "-m", "pytest", *self.args, *PYTEST_ARGS]


def _has_tests(path: Path) -> bool:
    return (path / "tests").is_dir()


def packages(root: Path = ROOT) -> list[Path]:
    """Every sibling package with tests: ``packages/*``, the connectors and the plugins."""
    found = sorted(path for path in (root / "packages").iterdir() if _has_tests(path))
    connectors = root / "botcore-connectors"
    if _has_tests(connectors):
        found.append(connectors)
    plugins = root / "plugins"
    if plugins.is_dir():
        found.extend(
            path
            for path in sorted(plugins.iterdir())
            if _has_tests(path) and path.name not in OWN_GATE
        )
    return found


def missing_gates(root: Path = ROOT) -> list[str]:
    """Plugins named in ``OWN_GATE`` that no longer exist: the exemption has outlived them."""
    return sorted(name for name in OWN_GATE if not _has_tests(root / "plugins" / name))


def coverage_floor(package: Path) -> float | None:
    """The ``fail_under`` the package's ``pyproject.toml`` declares for coverage, if any."""
    manifest = package / "pyproject.toml"
    if not manifest.is_file():
        return None
    with manifest.open("rb") as handle:
        config = tomllib.load(handle)
    floor = config.get("tool", {}).get("coverage", {}).get("report", {}).get("fail_under")
    return float(floor) if floor is not None else None


def package_run(package: Path, root: Path = ROOT) -> Run:
    args = ("tests",)
    if coverage_floor(package) is not None:
        # pytest-cov reads the package's own [tool.coverage] settings, fail_under included.
        args += ("--cov",)
    return Run(package.relative_to(root).as_posix(), package, args)


def runs(root: Path = ROOT) -> list[Run]:
    """Each package's tests, then the integration scenarios across them."""
    found = [package_run(package, root) for package in packages(root)]
    return [*found, Run("tests/integration (not live)", root, INTEGRATION)]


def main(root: Path = ROOT) -> int:
    stale = missing_gates(root)
    if stale:
        print(f"OWN_GATE names plugins that do not exist: {', '.join(stale)}", file=sys.stderr)
        return 1
    sources = [str(package / "src") for package in packages(root)]
    failed = []
    # Coverage data goes to a scratch directory, never into the source tree.
    with tempfile.TemporaryDirectory(prefix="botcore-package-tests-") as scratch:
        for index, run in enumerate(runs(root)):
            print(f"== {run.label}", flush=True)
            env = {
                **os.environ,
                "PYTHONPATH": os.pathsep.join(sources),
                "COVERAGE_FILE": str(Path(scratch) / f".coverage.{index}"),
            }
            done = subprocess.run(run.command(), cwd=run.cwd, env=env, check=False)
            if done.returncode != 0:
                failed.append(run.label)
    if failed:
        print(f"Failed: {', '.join(failed)}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
