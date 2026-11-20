"""disk-reclaim: what it deletes, what it never deletes, and the checks made just before."""

from __future__ import annotations

import asyncio
import json
import os
import stat
import subprocess
import sys
import time
from pathlib import Path

import pytest
from click.testing import CliRunner

from botcore.commands.disk import reclaim, report
from botcore.commands.disk.lock import LockHeld, RunLock
from botcore.commands.disk.remove import UnsafePath, remove_inside
from botcore.commands.disk.scan import Processes, mount_point
from tests.test_disk_report import age, age_worktree, git, repo  # noqa: F401


@pytest.fixture
def state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    folder = tmp_path / "state"
    monkeypatch.setenv("BOTCORE_DISK_STATE", str(folder))
    monkeypatch.setattr(reclaim, "running_processes", lambda: Processes(method="test"))
    return folder


def run_reclaim(**kwargs) -> dict:
    result = asyncio.run(reclaim.disk_reclaim(**kwargs))
    assert result.success, result.error
    return result.data


def outcomes(data: dict) -> dict[str, str]:
    return {Path(a["target"]).name if a["kind"] == "strip" else a["target"]: a["outcome"]
            for a in data["actions"]}


# ── Planning and carrying out ───────────────────────────────────────────────


def test_a_dry_run_changes_nothing(repo: dict[str, Path], state: Path) -> None:  # noqa: F811
    age_worktree(repo["main"], repo["old"])
    data = run_reclaim()
    strips = [a for a in data["actions"] if a["kind"] == "strip"]
    assert [Path(a["target"]).relative_to(repo["old"]).as_posix() for a in strips] == ["dist"]
    assert strips[0]["outcome"] == "planned"
    assert (repo["old"] / "dist" / "bundle.js").exists()
    assert Path(data["receipt"]).name.endswith("-dry.json")
    assert "last_dry_run" in json.loads((state / "status.json").read_text())


def test_apply_strips_only_ready_untracked_ignored_output(
    repo: dict[str, Path], state: Path,  # noqa: F811
) -> None:
    age_worktree(repo["main"], repo["old"])
    data = run_reclaim(apply=True)
    assert outcomes(data) == {"dist": "done"}
    assert not (repo["old"] / "dist").exists()
    assert (repo["fresh"] / "dist" / "bundle.js").exists()  # not idle long enough
    assert (repo["old"] / "build" / "keep.txt").exists()  # tracked
    admin = Path(git(repo["old"], "rev-parse", "--absolute-git-dir").strip())
    record = json.loads((admin / reclaim.STRIP_RECORD).read_text())
    assert record["paths"] == [str(repo["old"] / "dist")]
    status_ = json.loads((state / "status.json").read_text())
    assert status_["last_apply"]["ok"] is True
    assert "/" in json.dumps(status_["volumes"])


def test_a_worktree_that_came_back_to_life_is_left_alone(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    age_worktree(repo["main"], repo["old"])
    original = reclaim.plan_strips

    def plan_then_touch(*args, **kwargs):
        planned = original(*args, **kwargs)
        (repo["old"] / "new-work.txt").write_text("typed just now", encoding="utf-8")
        return planned

    monkeypatch.setattr(reclaim, "plan_strips", plan_then_touch)
    data = run_reclaim(apply=True)
    action = next(a for a in data["actions"] if a["kind"] == "strip")
    assert action["outcome"] == "skipped" and "active" in action["detail"]
    assert (repo["old"] / "dist" / "bundle.js").exists()


def test_a_path_that_became_tracked_is_left_alone(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    old = repo["old"]
    age_worktree(repo["main"], old)
    original = reclaim.plan_strips

    def plan_then_track(*args, **kwargs):
        planned = original(*args, **kwargs)
        git(old, "add", "-f", "dist/bundle.js")
        git(old, "commit", "-q", "-m", "track the bundle")
        age_worktree(repo["main"], old)
        return planned

    monkeypatch.setattr(reclaim, "plan_strips", plan_then_track)
    action = next(a for a in run_reclaim(apply=True)["actions"] if a["kind"] == "strip")
    assert action["outcome"] == "skipped" and "tracked" in action["detail"]
    assert (old / "dist" / "bundle.js").exists()


def test_a_process_that_starts_in_the_worktree_stops_the_strip(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    age_worktree(repo["main"], repo["old"])
    busy = Processes(cwds=[str(repo["old"])], method="test", sees_cwds=True)
    monkeypatch.setattr(reclaim, "running_processes", lambda: busy)
    action = next(a for a in run_reclaim(apply=True)["actions"] if a["kind"] == "strip")
    assert action["outcome"] == "skipped" and "process" in action["detail"]


def test_low_space_strips_pressure_patterns_and_younger_output(
    repo: dict[str, Path], state: Path,  # noqa: F811
) -> None:
    fresh = repo["fresh"]
    (fresh / "node_modules" / "pkg").mkdir(parents=True)
    two_days = time.time() - 2 * 86400
    age_worktree(repo["main"], fresh)
    admin = Path(git(fresh, "rev-parse", "--absolute-git-dir").strip())
    for name in ("HEAD", "index", "logs/HEAD"):
        age(admin / name, two_days)
    for child in fresh.iterdir():
        age(child, two_days)
    mount = mount_point(fresh)
    text = repo["settings"].read_text(encoding="utf-8")
    text += f"\n[[volume]]\nmount = {json.dumps(str(mount))}\nlow_space_gb = 1000000\n"
    repo["settings"].write_text(text, encoding="utf-8")
    data = run_reclaim(apply=True)
    done = {Path(a["target"]).name: a["step"] for a in data["actions"] if a["outcome"] == "done"}
    assert done.get("dist") == "pressure-1.0d"
    assert done.get("node_modules") == "pressure-1.0d"
    assert data["still_low"] == [str(mount)]


def test_aged_folders_wait_for_rust_builds(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    cache = repo["tmp"] / "cache" / "slot1"
    cache.mkdir(parents=True)
    (cache / "big").write_bytes(b"r" * 4096)
    for path in (cache / "big", cache):
        age(path)
    text = repo["settings"].read_text(encoding="utf-8")
    text += f'\n[[aged]]\npath = {json.dumps(str(cache.parent) + "/*")}\nmax_age_days = 7\n'
    repo["settings"].write_text(text, encoding="utf-8")
    cargo = Processes(cmdlines=["/home/u/.cargo/bin/cargo build --release"], method="test")
    monkeypatch.setattr(reclaim, "running_processes", lambda: cargo)
    assert outcomes(run_reclaim(apply=True, tier=0))[str(cache)] == "skipped"
    monkeypatch.setattr(reclaim, "running_processes", lambda: Processes(method="test"))
    assert outcomes(run_reclaim(apply=True, tier=0))[str(cache)] == "done"
    assert not cache.exists() and cache.parent.exists()


def test_tier_0_never_strips(repo: dict[str, Path], state: Path) -> None:  # noqa: F811
    age_worktree(repo["main"], repo["old"])
    data = run_reclaim(apply=True, tier=0)
    assert not [a for a in data["actions"] if a["kind"] == "strip"]
    assert (repo["old"] / "dist" / "bundle.js").exists()


def test_cli_dry_run(repo: dict[str, Path], state: Path) -> None:  # noqa: F811
    from botcore.cli import cli

    out = CliRunner().invoke(cli, ["disk-reclaim", "--repo", str(repo["main"]), "--json"])
    assert out.exit_code == 0, out.output
    assert json.loads(out.output)["data"]["apply"] is False


# ── Lock and receipts ───────────────────────────────────────────────────────


def test_one_run_at_a_time(repo: dict[str, Path], state: Path) -> None:  # noqa: F811
    with RunLock(state / "run.lock"):
        result = asyncio.run(reclaim.disk_reclaim())
        assert not result.success and result.error.code == "DISK_RUN_IN_PROGRESS"
        with pytest.raises(LockHeld):
            with RunLock(state / "run.lock"):
                pass


def test_a_dead_holders_lock_is_taken_over(state: Path) -> None:
    state.mkdir(parents=True)
    (state / "run.lock").write_text(json.dumps({"pid": 2**22 + 12345, "at": time.time()}))
    with RunLock(state / "run.lock") as lock:
        assert lock.held


def test_receipts_are_capped(state: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    folder = state / "receipts"
    folder.mkdir(parents=True)
    for index in range(6):
        (folder / f"2026010{index}T000000Z-dry.json").write_text("{}")
    monkeypatch.setattr(reclaim, "MAX_RECEIPTS", 3)
    reclaim.prune_receipts(folder)
    assert sorted(p.name[:9] for p in folder.glob("*.json")) == ["20260103T", "20260104T",
                                                                  "20260105T"]


# ── remove_inside ───────────────────────────────────────────────────────────


def test_remove_refuses_paths_outside_the_root(tmp_path: Path) -> None:
    root = tmp_path / "wt"
    (root / "a").mkdir(parents=True)
    with pytest.raises(UnsafePath):
        remove_inside(tmp_path / "elsewhere", root)
    with pytest.raises(UnsafePath):
        remove_inside(root, root)
    with pytest.raises(UnsafePath):
        remove_inside(root / ".." / "wt", root)


@pytest.mark.skipif(sys.platform == "win32", reason="symlinks need privileges on Windows")
def test_remove_never_follows_a_link(tmp_path: Path) -> None:
    root = tmp_path / "wt"
    (root / "dist").mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "precious").write_text("keep", encoding="utf-8")
    (root / "dist" / "link").symlink_to(outside, target_is_directory=True)
    (root / "dist" / "file-link").symlink_to(outside / "precious")
    removal = remove_inside(root / "dist", root)
    assert removal.complete and not (root / "dist").exists()
    assert (outside / "precious").read_text() == "keep"
    # a candidate that is itself a link pointing out of the worktree: only the link goes
    (root / "gen").symlink_to(outside, target_is_directory=True)
    remove_inside(root / "gen", root)
    assert not (root / "gen").is_symlink() and (outside / "precious").exists()


@pytest.mark.skipif(sys.platform != "win32", reason="junctions are a Windows feature")
def test_remove_never_follows_a_junction(tmp_path: Path) -> None:
    root = tmp_path / "wt"
    (root / "node_modules").mkdir(parents=True)
    outside = tmp_path / "store"
    outside.mkdir()
    (outside / "precious").write_text("keep", encoding="utf-8")
    subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(root / "node_modules" / "pkg"), str(outside)],
        check=True, capture_output=True,
    )
    removal = remove_inside(root / "node_modules", root)
    assert removal.complete and not (root / "node_modules").exists()
    assert (outside / "precious").read_text() == "keep"


def test_remove_clears_read_only_files(tmp_path: Path) -> None:
    root = tmp_path / "wt"
    target = root / "target" / "pack"
    target.mkdir(parents=True)
    locked = target / "pack-1.idx"
    locked.write_bytes(b"i" * 100)
    os.chmod(locked, stat.S_IREAD)
    removal = remove_inside(root / "target", root)
    assert removal.complete and not (root / "target").exists()


def test_tool_running_matches_programs_not_substrings() -> None:
    procs = Processes(cmdlines=["node /x/pnpm.cjs install", "/opt/uvicorn app:main"])
    assert reclaim.tool_running(("pnpm",), procs)
    assert not reclaim.tool_running(("uv",), procs)
    win = Processes(cmdlines=[r"C:\Users\j\.cargo\bin\cargo.exe build"])
    assert reclaim.tool_running(("cargo",), win)


def test_report_and_reclaim_share_settings_errors(
    repo: dict[str, Path], state: Path,  # noqa: F811
) -> None:
    repo["settings"].write_text("strip_after_days = -1\n", encoding="utf-8")
    for command in (report.disk_report, reclaim.disk_reclaim):
        result = asyncio.run(command())
        assert not result.success and result.error.code == "DISK_SETTINGS_INVALID"
