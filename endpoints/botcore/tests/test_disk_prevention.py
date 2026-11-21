"""Prevention: the idle-worktree warning, Factory's slots, and where Cargo puts build output."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from botcore.commands.disk import cargo, reclaim, report, setup
from botcore.commands.disk.settings import AgedFolder, MachineSettings
from tests.test_disk_report import age_worktree, git, repo, rows  # noqa: F401


def run(coro) -> dict:
    result = asyncio.run(coro)
    assert result.success, result.error
    return result.data


def settings_file(repo: dict[str, Path], extra: str) -> None:  # noqa: F811
    repo["settings"].write_text(
        f"repos = [{json.dumps(str(repo['main']))}]\ncaches = []\n{extra}\n", encoding="utf-8"
    )


def add_idle(repo: dict[str, Path], name: str) -> Path:  # noqa: F811
    path = repo["tmp"] / "trees" / name
    git(repo["main"], "worktree", "add", "-q", "-b", name, str(path))
    age_worktree(repo["main"], path)
    return path


# ── Too many idle worktrees ─────────────────────────────────────────────────


def test_report_warns_when_a_repository_has_too_many_idle_worktrees(
    repo: dict[str, Path],  # noqa: F811
) -> None:
    age_worktree(repo["main"], repo["old"])
    add_idle(repo, "second")
    kept = add_idle(repo, "kept")
    git(repo["main"], "worktree", "lock", "--reason", "parked", str(kept))
    settings_file(repo, "idle_worktree_limit = 1")

    data = run(report.disk_report())

    [row] = data["repos"]
    assert row["idle_worktrees"] == {"count": 2, "days": 3, "t3_code": 0, "limit": 1}
    assert data["warnings"] == [row["warning"]]
    assert "2 worktrees idle 3 days or more, over the limit of 1" in row["warning"]
    assert row["warning"] in run_suggestions()


def run_suggestions() -> list[str]:
    result = asyncio.run(report.disk_report())
    return list(result.suggestions or [])


@pytest.mark.parametrize("limit", ["idle_worktree_limit = 2", "idle_worktree_limit = 0"])
def test_no_warning_at_the_limit_or_when_it_is_off(
    repo: dict[str, Path], limit: str,  # noqa: F811
) -> None:
    age_worktree(repo["main"], repo["old"])
    add_idle(repo, "second")
    settings_file(repo, limit)

    data = run(report.disk_report())

    assert data["warnings"] == [] and "warning" not in data["repos"][0]
    assert data["repos"][0]["idle_worktrees"]["count"] == 2


def test_status_keeps_the_last_full_runs_warnings(
    repo: dict[str, Path], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    monkeypatch.setenv("BOTCORE_DISK_STATE", str(tmp_path / "state"))
    age_worktree(repo["main"], repo["old"])
    add_idle(repo, "second")
    settings_file(repo, "idle_worktree_limit = 1")

    run(reclaim.disk_reclaim(tier=1))
    status = json.loads((tmp_path / "state" / "status.json").read_text())
    [warning] = status["worktree_warnings"]["warnings"]
    settings_file(repo, "idle_worktree_limit = 0")
    run(reclaim.disk_reclaim(tier=1, repo=str(repo["main"])))  # one repository: kept as it was

    assert setup.disk_warnings() == [warning]
    data = run(setup.disk_status())
    assert data["warnings"] == [warning] and data["warnings_at"]
    run(reclaim.disk_reclaim(tier=1))
    assert setup.disk_warnings() == []


# ── Factory's slots ─────────────────────────────────────────────────────────


def test_factory_slots_are_stripped_but_never_removed(
    repo: dict[str, Path],  # noqa: F811
) -> None:
    slots = repo["tmp"] / f"{repo['main'].name}.factory-slots"
    slot = slots / "slot-1"
    git(repo["main"], "worktree", "add", "-q", "--detach", str(slot), "main")
    (slot / "dist").mkdir()
    (slot / "dist" / "bundle.js").write_bytes(b"x" * 20000)
    age_worktree(repo["main"], slot)
    settings_file(repo, "remove_landed_after_days = 1")

    row = rows(run(report.disk_report()))["slot-1"]

    assert row["managed_by"] == "factory"
    assert row["tier"] == 1 and "finished" not in row
    assert any("Factory's lane reuses this slot" in r for r in row["reasons"])
    assert report.manager(slot, []) == "factory"
    assert report.manager(repo["old"], []) is None


# ── Cargo ───────────────────────────────────────────────────────────────────


@pytest.fixture
def cargo_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    home = tmp_path / "home" / ".cargo"
    home.mkdir(parents=True)
    monkeypatch.setenv("CARGO_HOME", str(home))
    for name in ("CARGO_TARGET_DIR", "CARGO_BUILD_TARGET_DIR", "CARGO_BUILD_BUILD_DIR"):
        monkeypatch.delenv(name, raising=False)
    return home


def write_config(home: Path, build: str) -> None:
    (home / "config.toml").write_text(f"[build]\n{build}\n", encoding="utf-8")


def test_cargo_default_keeps_output_in_each_worktree(cargo_home: Path) -> None:
    check = cargo.cargo_check(MachineSettings())
    assert check == {"arrangement": "inside each worktree", "settings": [], "problems": []}
    write_config(cargo_home, 'build-dir = "{workspace-root}/target/build"')
    check = cargo.cargo_check(MachineSettings())
    assert check["arrangement"] == "inside each worktree" and not check["problems"]


def test_cargo_build_dir_per_workspace_needs_an_aged_folder(
    cargo_home: Path, tmp_path: Path,
) -> None:
    root = tmp_path / "Dev" / "cargo-build"
    write_config(cargo_home, f"build-dir = {json.dumps(str(root) + '/{workspace-path-hash}')}")

    [moved] = cargo.cargo_outputs(MachineSettings())[0]
    assert (moved.kind, moved.root, moved.aged) == ("build-dir", str(root), str(root / "*"))
    [problem] = cargo.cargo_check(MachineSettings())["problems"]
    assert str(root) in problem and f'path = "{root / "*"}"' in problem

    covered = MachineSettings(aged=[AgedFolder(path=str(root / "*"), max_age_days=7)])
    check = cargo.cargo_check(covered)
    assert check["arrangement"] == "moved out of the worktrees" and not check["problems"]
    assert check["settings"][0]["covered_by"] == str(root / "*")
    assert cargo.cargo_roots(covered) == [root]


def test_cargo_environment_overrides_the_config(
    cargo_home: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    write_config(cargo_home, f"target-dir = {json.dumps(str(tmp_path / 'ignored'))}")
    shared = tmp_path / "Dev" / "target"
    monkeypatch.setenv("CARGO_TARGET_DIR", str(shared))
    [moved] = cargo.cargo_outputs(MachineSettings())[0]
    assert (moved.source, moved.root, moved.aged) == ("CARGO_TARGET_DIR", str(shared), str(shared))
    parent = MachineSettings(aged=[AgedFolder(path=str(tmp_path / "Dev" / "*"))])
    assert not cargo.cargo_check(parent)["problems"]
    monkeypatch.setenv("CARGO_TARGET_DIR", "target-local")  # relative: wherever Cargo runs
    assert cargo.cargo_check(MachineSettings())["arrangement"] == "inside each worktree"


def test_cargo_config_paths_are_relative_to_the_folder_holding_cargo_home(
    cargo_home: Path,
) -> None:
    write_config(cargo_home, 'target-dir = "shared-target"')
    [moved] = cargo.cargo_outputs(MachineSettings())[0]
    assert moved.root == str(cargo_home.parent / "shared-target")


def test_cargo_name_prefix_and_bad_config_are_reported(cargo_home: Path, tmp_path: Path) -> None:
    prefixed = str(tmp_path) + "/b-{workspace-path-hash}"
    write_config(cargo_home, f"build-dir = {json.dumps(prefixed)}")
    [problem] = cargo.cargo_check(MachineSettings())["problems"]
    assert "a folder of its own" in problem
    (cargo_home / "config.toml").write_text("[build\n", encoding="utf-8")
    [problem] = cargo.cargo_check(MachineSettings())["problems"]
    assert "not valid TOML" in problem


def test_setup_reports_the_cargo_arrangement(
    repo: dict[str, Path], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    home = Path(str(tmp_path / "cargo-home"))
    home.mkdir()
    root = tmp_path / "cargo-build"
    write_config(home, f"build-dir = {json.dumps(str(root) + '/{workspace-path-hash}')}")
    monkeypatch.chdir(repo["main"])
    result = asyncio.run(setup.disk_setup(install_schedule=False))
    assert result.success, result.error
    assert result.data["cargo"]["arrangement"] == "moved out of the worktrees"
    assert any(str(root) in s for s in result.suggestions or [])
