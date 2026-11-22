"""Prevention: the idle-worktree warning, Factory's slots, and where Cargo puts build output."""

from __future__ import annotations

import asyncio
import json
import tomllib
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

    result = asyncio.run(report.disk_report())
    data = result.data

    [row] = data["repos"]
    assert row["idle_worktrees"] == {"count": 2, "days": 3, "t3_code": 0, "limit": 1,
                                     "complete": True}
    assert data["warnings"] == [row["warning"]]
    assert "2 worktrees idle 3 days or more, over the limit of 1" in row["warning"]
    assert row["warning"] in (result.suggestions or [])


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


def test_idle_is_measured_in_seconds_and_leaves_out_what_this_run_removed() -> None:
    day = report.DAY
    row = {"main": "/repo", "worktrees": [
        {"path": "/repo", "main": True, "exists": True, "locked": None, "managed_by": None,
         "idle_seconds": 9 * day, "reasons": []},
        {"path": "/w/almost", "main": False, "exists": True, "locked": None, "managed_by": None,
         "idle_seconds": int(3 * day) - 300, "reasons": []},  # rounds to 3.00 days
        {"path": "/w/idle", "main": False, "exists": True, "locked": None, "managed_by": None,
         "idle_seconds": 4 * day, "reasons": []},
        {"path": "/w/slot", "main": False, "exists": True, "locked": None,
         "managed_by": "factory", "idle_seconds": 9 * day, "reasons": []},
        {"path": "/w/late", "main": False, "exists": True, "locked": None, "managed_by": None,
         "idle_seconds": None, "reasons": ["not inspected: the time budget was spent"]},
    ]}
    settings = MachineSettings(idle_worktree_limit=0)
    report.count_idle(row, settings)
    assert row["idle_worktrees"]["count"] == 1 and row["idle_worktrees"]["complete"] is False
    report.count_idle(row, settings, gone={report.path_key("/w/idle")})
    assert row["idle_worktrees"]["count"] == 0


def test_status_keeps_each_repositorys_last_complete_count(
    repo: dict[str, Path], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    monkeypatch.setenv("BOTCORE_DISK_STATE", str(tmp_path / "state"))
    age_worktree(repo["main"], repo["old"])
    add_idle(repo, "second")
    settings_file(repo, "idle_worktree_limit = 1")

    run(reclaim.disk_reclaim(tier=1))
    [warning] = setup.disk_warnings()
    assert "over the limit of 1" in warning
    settings_file(repo, "idle_worktree_limit = 0")
    run(reclaim.disk_reclaim(tier=1, budget_seconds=0))  # counted nothing: kept as it was
    assert setup.disk_warnings() == [warning]
    data = run(setup.disk_status())
    assert data["warnings"] == [warning]

    status_path = tmp_path / "state" / "status.json"
    status = json.loads(status_path.read_text())
    [entry] = status["worktree_warnings"]["repos"].values()
    entry["at"] = "2020-01-01T00:00:00+00:00"
    status_path.write_text(json.dumps(status))
    [stale] = setup.disk_warnings()
    assert stale.startswith(warning) and "counted 2020-01-01" in stale

    run(reclaim.disk_reclaim(tier=1, repo=str(repo["main"])))  # a full count of that repo
    assert setup.disk_warnings() == []


def test_new_keys_stay_out_of_the_settings_file_at_their_defaults() -> None:
    keys = set(tomllib.loads(setup.settings_toml(MachineSettings())))
    assert not keys & {"idle_worktree_limit", "remove_landed"}
    text = setup.settings_toml(MachineSettings(idle_worktree_limit=5, remove_landed=True))
    assert "idle_worktree_limit = 5" in text and "remove_landed = true" in text


# ── Factory's slots ─────────────────────────────────────────────────────────


def test_factory_slots_are_stripped_but_never_removed_or_counted(
    repo: dict[str, Path],  # noqa: F811
) -> None:
    slot = repo["tmp"] / f"{repo['main'].name}.factory-slots" / "slot-1"
    git(repo["main"], "worktree", "add", "-q", "--detach", str(slot), "main")
    (slot / "dist").mkdir()
    (slot / "dist" / "bundle.js").write_bytes(b"x" * 20000)
    age_worktree(repo["main"], slot)
    settings_file(repo, "remove_landed_after_days = 1")

    data = run(report.disk_report())
    row = rows(data)["slot-1"]

    assert row["managed_by"] == "factory"
    assert row["tier"] == 1 and "finished" not in row
    assert any("Factory's lane reuses this slot" in r for r in row["reasons"])
    assert data["repos"][0]["idle_worktrees"]["count"] == 0


def test_only_this_repositorys_slot_folder_is_factorys(tmp_path: Path) -> None:
    main = tmp_path / "afd"
    slot = tmp_path / "afd.factory-slots" / "slot-1"
    other = tmp_path / "other.factory-slots" / "checkout"
    t3_root = tmp_path
    assert report.manager(slot, [t3_root], main) == "factory"  # more specific than T3 Code's
    assert report.manager(other, [], main) is None
    assert report.manager(other, [t3_root], main) == "t3-code"
    assert report.repository_of(main / ".git") == main


# ── Cargo ───────────────────────────────────────────────────────────────────


@pytest.fixture
def cargo_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    home = tmp_path / "home" / ".cargo"
    home.mkdir(parents=True)
    monkeypatch.setenv("CARGO_HOME", str(home))
    for name in ("CARGO_TARGET_DIR", "CARGO_BUILD_TARGET_DIR", "CARGO_BUILD_BUILD_DIR"):
        monkeypatch.delenv(name, raising=False)
    return home


@pytest.fixture
def place(tmp_path: Path) -> Path:
    folder = tmp_path / "work" / "tree"
    folder.mkdir(parents=True)
    return folder


def write_config(folder: Path, build: str, name: str = "config.toml") -> Path:
    path = folder / name
    path.write_text(f"[build]\n{build}\n", encoding="utf-8")
    return path


def check(place: Path, settings: MachineSettings | None = None) -> dict:
    return cargo.cargo_check(settings or MachineSettings(), [place])


def suggested_entry(problem: str) -> dict:
    block = problem[problem.index("\n[[aged]]\n") + 1:]
    return tomllib.loads(block)["aged"][0]


def test_cargo_default_keeps_output_in_each_worktree(cargo_home: Path, place: Path) -> None:
    assert check(place) == {"arrangement": "inside each worktree", "settings": [], "problems": []}
    write_config(cargo_home, 'build-dir = "{workspace-root}/target/build"')
    assert check(place) == {"arrangement": "inside each worktree", "settings": [], "problems": []}


def test_cargo_host_ancestor_config_outside_test_sandbox_is_ignored(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """lushly-dev/afd#1954: simulate TMPDIR inside $HOME where ~/.cargo/config.toml sets
    build-dir; confining config discovery to the test sandbox keeps the host config out."""
    fake_home = tmp_path / "host-home"
    host_cargo = fake_home / ".cargo"
    host_cargo.mkdir(parents=True)
    write_config(
        host_cargo,
        f"build-dir = {json.dumps(str(tmp_path / 'host-build') + '/{workspace-path-hash}')}",
    )
    sandbox = fake_home / "antigravity-tmp" / "pytest-0"
    nested_place = sandbox / "work" / "tree"
    nested_place.mkdir(parents=True)
    isolated_cargo = sandbox / "cargo-home"
    isolated_cargo.mkdir()
    monkeypatch.setenv("CARGO_HOME", str(isolated_cargo))
    for name in ("CARGO_TARGET_DIR", "CARGO_BUILD_TARGET_DIR", "CARGO_BUILD_BUILD_DIR"):
        monkeypatch.delenv(name, raising=False)

    # Without the sandbox boundary at `sandbox`, Cargo's real ancestor walk reaches fake_home.
    assert cargo.cargo_check(MachineSettings(), [nested_place])["problems"]

    # Confining discovery to `sandbox` via conftest's helper isolates the test.
    from tests.conftest import isolate_cargo_configs

    isolate_cargo_configs(monkeypatch, sandbox)
    assert cargo.cargo_check(MachineSettings(), [nested_place]) == {
        "arrangement": "inside each worktree",
        "settings": [],
        "problems": [],
    }


def test_cargo_build_dir_per_workspace_needs_an_aged_folder(
    cargo_home: Path, place: Path, tmp_path: Path,
) -> None:
    root = tmp_path / "Dev" / "cargo-build"
    write_config(cargo_home, f"build-dir = {json.dumps(str(root) + '/{workspace-path-hash}')}")

    [problem] = check(place)["problems"]
    entry = suggested_entry(problem)
    assert entry == {"path": str(root / "*"), "max_age_days": 7}

    covered = MachineSettings(aged=[AgedFolder(**entry)])
    result = check(place, covered)
    assert result["arrangement"] == "moved out of the worktrees" and not result["problems"]
    assert result["settings"][0]["covered_by"] == str(root / "*")
    (root / "ab").mkdir(parents=True)  # a hash bucket: still Cargo's alone
    assert check(place)["settings"][0]["aged"] == str(root / "*")


@pytest.mark.parametrize("rule", [
    {"path": "ROOT/*"},  # no age and no size: it clears nothing
    {"path": "ROOT", "max_age_days": 7},  # the folder as one entry, always in use
    {"path": "PARENT/*", "max_age_days": 7},
])
def test_cargo_rules_that_clear_nothing_do_not_cover_it(
    cargo_home: Path, place: Path, tmp_path: Path, rule: dict,
) -> None:
    root = tmp_path / "Dev" / "cargo-build"
    write_config(cargo_home, f"build-dir = {json.dumps(str(root) + '/{workspace-path-hash}')}")
    path = rule["path"].replace("ROOT", str(root)).replace("PARENT", str(root.parent))
    assert check(place, MachineSettings(aged=[AgedFolder(**{**rule, "path": path})]))["problems"]


def test_cargo_never_suggests_clearing_a_folder_that_holds_other_things(
    cargo_home: Path, place: Path, tmp_path: Path,
) -> None:
    write_config(cargo_home, 'build-dir = "{cargo-cache-home}/{workspace-path-hash}"')
    (cargo_home / "bin").mkdir()
    [problem] = check(place)["problems"]
    assert "[[aged]]\npath" not in problem and "a folder of its own" in problem

    shared = tmp_path / "Dev"
    (shared / "photos").mkdir(parents=True)
    write_config(cargo_home, f"build-dir = {json.dumps(str(shared) + '/{workspace-path-hash}')}")
    [problem] = check(place)["problems"]
    assert "[[aged]]\npath" not in problem


def test_cargo_shared_target_folder_needs_a_size_cap(
    cargo_home: Path, place: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    write_config(cargo_home, f"target-dir = {json.dumps(str(tmp_path / 'ignored'))}")
    shared = tmp_path / "Dev" / "target"
    monkeypatch.setenv("CARGO_TARGET_DIR", str(shared))
    [moved] = cargo.cargo_outputs(MachineSettings(), [place])[0]
    assert (moved.source, moved.root, moved.per_workspace) == ("CARGO_TARGET_DIR", str(shared),
                                                                False)
    [problem] = check(place)["problems"]
    assert "one folder" in problem and "max_gb" in problem
    aged_only = MachineSettings(aged=[AgedFolder(path=str(shared), max_age_days=7)])
    assert check(place, aged_only)["problems"]
    capped = MachineSettings(aged=[AgedFolder(path=str(shared), max_gb=50)])
    assert not check(place, capped)["problems"]


@pytest.mark.parametrize(("variable", "value"), [
    ("CARGO_TARGET_DIR", "target-local"),
    ("CARGO_BUILD_BUILD_DIR", "{workspace-root}/build"),
])
def test_cargo_paths_relative_to_the_build_stay_inside(
    cargo_home: Path, place: Path, monkeypatch: pytest.MonkeyPatch, variable: str, value: str,
) -> None:
    monkeypatch.setenv(variable, value)
    assert check(place)["arrangement"] == "inside each worktree"


@pytest.mark.parametrize(("variable", "value"), [
    ("CARGO_TARGET_DIR", "../escape"),
    ("CARGO_BUILD_BUILD_DIR", "{workspace-root}/../out/{workspace-path-hash}"),
])
def test_cargo_paths_that_escape_the_build_cannot_be_covered(
    cargo_home: Path, place: Path, monkeypatch: pytest.MonkeyPatch, variable: str, value: str,
) -> None:
    monkeypatch.setenv(variable, value)
    [problem] = check(place)["problems"]
    assert "relative to where Cargo runs" in problem


def test_cargo_values_are_literal_and_relative_to_the_folder_holding_cargo(
    cargo_home: Path, place: Path,
) -> None:
    write_config(cargo_home, 'target-dir = "~/some-data"')
    [moved] = cargo.cargo_outputs(MachineSettings(), [place])[0]
    assert moved.root == str(cargo_home.parent / "~" / "some-data")


def test_cargo_reads_configs_as_cargo_does(
    cargo_home: Path, place: Path, tmp_path: Path,
) -> None:
    write_config(cargo_home, f"target-dir = {json.dumps(str(tmp_path / 'from-toml'))}")
    write_config(cargo_home, f"target-dir = {json.dumps(str(tmp_path / 'from-config'))}",
                 name="config")
    [moved] = cargo.cargo_outputs(MachineSettings(), [place])[0]
    assert moved.root == str(tmp_path / "from-config")  # `config` wins when both exist

    above = place.parent / ".cargo"
    above.mkdir()
    (above / "extra.toml").write_text(
        f"[build]\nbuild-dir = {json.dumps(str(tmp_path / 'inc') + '/{workspace-path-hash}')}\n",
        encoding="utf-8")
    (above / "config.toml").write_text('include = ["extra.toml"]\n', encoding="utf-8")
    found = {o.kind: o for o in cargo.cargo_outputs(MachineSettings(), [place])[0]}
    assert found["build-dir"].root == str(tmp_path / "inc")
    assert found["build-dir"].source == str(above / "extra.toml")
    assert found["target-dir"].root == str(tmp_path / "from-config")  # still from CARGO_HOME


def test_cargo_config_problems_are_warnings(cargo_home: Path, place: Path) -> None:
    (cargo_home / "config.toml").write_bytes(b"[build]\ntarget-dir = \"\xff\"\n")
    [problem] = check(place)["problems"]
    assert "could not be read" in problem
    (cargo_home / "config.toml").write_text('include = ["missing.toml"]\n', encoding="utf-8")
    [problem] = check(place)["problems"]
    assert "missing" in problem


def test_cargo_suggestion_is_valid_toml_for_windows_paths() -> None:
    value = r"D:\Build\{workspace-path-hash}"
    placed = cargo.Placement("build-dir", "CARGO_BUILD_BUILD_DIR", value, "moved", r"D:\Build",
                             True, r"D:\Build\*")
    assert suggested_entry(placed.problem or "")["path"] == r"D:\Build\*"


def test_setup_reports_the_cargo_arrangement(
    repo: dict[str, Path], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    home = tmp_path / "cargo-home"
    home.mkdir()
    root = tmp_path / "cargo-build"
    write_config(home, f"build-dir = {json.dumps(str(root) + '/{workspace-path-hash}')}")
    monkeypatch.chdir(repo["main"])
    result = asyncio.run(setup.disk_setup(install_schedule=False))
    assert result.success, result.error
    assert result.data["cargo"]["arrangement"] == "moved out of the worktrees"
    assert any(str(root) in s for s in result.suggestions or [])


def test_cargo_cache_home_template_is_a_real_folder(
    cargo_home: Path, place: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CARGO_BUILD_BUILD_DIR", "{cargo-cache-home}/build/{workspace-path-hash}")
    [moved] = cargo.cargo_outputs(MachineSettings(), [place])[0]
    assert (moved.state, moved.root) == ("moved", str(cargo_home / "build"))
    assert moved.aged == str(cargo_home / "build" / "*")


def test_cargo_cover_refused_by_the_planner_does_not_count(
    cargo_home: Path, place: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    holder = place.parent  # holds the checkout, so the planner refuses to clear it
    monkeypatch.setenv("CARGO_TARGET_DIR", str(holder / "target"))
    rule = MachineSettings(aged=[AgedFolder(path=str(holder / "*"), max_gb=50)])
    [problem] = check(place, rule)["problems"]
    assert '"build-dir"' not in problem and "cargo-build" in problem  # a folder of its own


def test_cargo_include_must_be_toml_and_file_browser_litter_is_ignored(
    cargo_home: Path, place: Path, tmp_path: Path,
) -> None:
    (cargo_home / "config.toml").write_text('include = ["extra.conf"]\n', encoding="utf-8")
    [problem] = check(place)["problems"]
    assert "must end in .toml" in problem
    root = tmp_path / "builds"
    (root / "ab").mkdir(parents=True)
    (root / ".DS_Store").write_bytes(b"")
    write_config(cargo_home, f"build-dir = {json.dumps(str(root) + '/{workspace-path-hash}')}")
    assert cargo.cargo_outputs(MachineSettings(), [place])[0][0].aged == str(root / "*")


def test_aged_entries_are_aged_by_what_builds_touch_deep_inside(tmp_path: Path) -> None:
    from botcore.commands.disk import caches
    from botcore.commands.disk.scan import newest_mtime

    bucket = tmp_path / "ab"
    deps = bucket / "0305f56e9b9616" / "debug" / "deps"
    deps.mkdir(parents=True)
    old = 1_000_000_000.0
    for folder in (bucket, bucket / "0305f56e9b9616", deps.parent):
        os_utime(folder, old)
    assert newest_mtime(bucket) == old
    assert newest_mtime(bucket, caches.AGED_DEPTH) > old


def os_utime(path: Path, when: float) -> None:
    import os

    os.utime(path, (when, when))
