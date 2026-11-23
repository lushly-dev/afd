"""The sibling-package runner finds every package's tests and holds declared coverage floors."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "package_tests.py"


@pytest.fixture
def runner(monkeypatch):
    spec = importlib.util.spec_from_file_location("botcore_package_tests", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    # Dataclasses resolve their annotations through the module's entry in sys.modules.
    monkeypatch.setitem(sys.modules, spec.name, module)
    spec.loader.exec_module(module)
    return module


def _package(path: Path, pyproject: str | None = None) -> Path:
    (path / "tests").mkdir(parents=True)
    if pyproject is not None:
        (path / "pyproject.toml").write_text(pyproject, encoding="utf-8")
    return path


def test_the_real_tree_runs_connectors_and_teams_but_not_the_factory(runner):
    found = {path.relative_to(SCRIPT.parents[1]).as_posix() for path in runner.packages()}
    assert {"botcore-connectors", "plugins/botcore-teams"} <= found
    assert any(name.startswith("packages/") for name in found)
    assert "plugins/botcore-factory" not in found
    assert runner.missing_gates() == []


def test_a_new_plugin_runs_without_being_listed(runner, tmp_path):
    _package(tmp_path / "packages" / "botcore-one")
    (tmp_path / "packages" / "no-tests").mkdir()
    _package(tmp_path / "botcore-connectors")
    _package(tmp_path / "plugins" / "botcore-factory")
    _package(tmp_path / "plugins" / "botcore-new")
    found = [path.relative_to(tmp_path).as_posix() for path in runner.packages(tmp_path)]
    assert found == ["packages/botcore-one", "botcore-connectors", "plugins/botcore-new"]


def test_an_own_gate_exemption_for_a_removed_plugin_stops_the_run(runner, tmp_path):
    (tmp_path / "plugins").mkdir()
    assert runner.missing_gates(tmp_path) == ["botcore-factory"]


def test_a_declared_coverage_floor_runs_under_coverage(runner, tmp_path):
    floored = _package(
        tmp_path / "floored", "[tool.coverage.report]\nfail_under = 80\nshow_missing = true\n"
    )
    plain = _package(tmp_path / "plain", "[tool.pytest.ini_options]\ntestpaths = ['tests']\n")
    bare = _package(tmp_path / "bare")
    assert runner.coverage_floor(floored) == 80.0
    assert runner.package_run(floored, tmp_path).args == ("tests", "--cov")
    for package in (plain, bare):
        assert runner.coverage_floor(package) is None
        assert runner.package_run(package, tmp_path).args == ("tests",)
    run = runner.package_run(plain, tmp_path)
    assert run.cwd == plain
    assert run.command()[:4] == [sys.executable, "-m", "pytest", "tests"]


def test_the_integration_scenarios_run_last_without_the_live_tier(runner, tmp_path):
    _package(tmp_path / "packages" / "botcore-one")
    (tmp_path / "plugins").mkdir()
    last = runner.runs(tmp_path)[-1]
    assert last.cwd == tmp_path
    assert last.args == ("tests/integration", "-m", "not live")
    assert (SCRIPT.parents[1] / "tests" / "integration").is_dir()


def test_teams_declares_the_floor_the_runner_enforces(runner):
    teams = SCRIPT.parents[1] / "plugins" / "botcore-teams"
    assert runner.coverage_floor(teams) == 80.0


def _tree(root: Path, *, failing: bool = False, empty: bool = False) -> None:
    """A Botcore-shaped tree: one package, the exempt factory and the integration scenarios."""
    one = _package(root / "packages" / "botcore-one")
    (one / "src").mkdir()
    if not empty:
        verdict = "False" if failing else "True"
        (one / "tests" / "test_one.py").write_text(
            f"def test_one():\n    assert {verdict}\n", encoding="utf-8"
        )
    _package(root / "plugins" / "botcore-factory")
    integration = root / "tests" / "integration"
    integration.mkdir(parents=True)
    (integration / "test_scenario.py").write_text(
        "import pytest\n\n\ndef test_mocked():\n    assert True\n\n\n"
        "@pytest.mark.live\ndef test_live():\n    raise AssertionError('live ran')\n",
        encoding="utf-8",
    )
    (integration / "conftest.py").write_text(
        "def pytest_configure(config):\n    config.addinivalue_line('markers', 'live: real LLM')\n",
        encoding="utf-8",
    )


def test_a_passing_tree_passes_without_running_the_live_tier(runner, tmp_path, capsys):
    _tree(tmp_path)
    assert runner.main(tmp_path) == 0
    out = capsys.readouterr().out
    assert "== packages/botcore-one" in out
    assert "== tests/integration (not live)" in out


def test_a_failing_package_fails_the_run_and_is_named(runner, tmp_path, capsys):
    _tree(tmp_path, failing=True)
    assert runner.main(tmp_path) == 1
    assert "Failed: packages/botcore-one" in capsys.readouterr().err


def test_a_package_whose_tests_collect_nothing_fails_the_run(runner, tmp_path, capsys):
    _tree(tmp_path, empty=True)
    assert runner.main(tmp_path) == 1
    assert "Failed: packages/botcore-one" in capsys.readouterr().err


def test_a_stale_own_gate_stops_the_run_before_any_test(runner, tmp_path, capsys):
    _tree(tmp_path)
    (tmp_path / "plugins" / "botcore-factory" / "tests").rmdir()
    assert runner.main(tmp_path) == 1
    captured = capsys.readouterr()
    assert "OWN_GATE names plugins that do not exist: botcore-factory" in captured.err
    assert "==" not in captured.out
