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
from botcore.commands.disk.remove import Removal, UnsafePath, remove_inside
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
    assert "-dry-" in Path(data["receipt"]).name
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
    assert str(mount_point(repo["old"])) in {v["mount"] for v in status_["volumes"]}


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
    for name in ("HEAD", "index", "logs/HEAD", "ORIG_HEAD", "FETCH_HEAD"):
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


def test_build_info_is_stripped_before_output_and_failed_build_info_keeps_output(
    repo: dict[str, Path], state: Path, monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    """lushly-dev/afd#1939: file candidates (such as *.tsbuildinfo) are stripped before folder
    candidates (such as dist) within a worktree, and if build info cannot be removed its
    output folder stays intact."""
    main, old = repo["main"], repo["old"]
    (main / "botcore.toml").write_text(
        '[disk]\nregenerable = ["**/dist", "**/*.tsbuildinfo"]\n', encoding="utf-8",
    )
    (main / ".gitignore").write_text("dist/\n*.tsbuildinfo\n", encoding="utf-8")
    git(main, "commit", "-q", "-am", "add tsbuildinfo rule")
    git(old, "merge", "-q", "main")

    # Package a: build info removal will fail -> dist must stay.
    # Package b: build info removal succeeds -> dist is removed.
    for pkg in ("a", "b"):
        pkg_dir = old / "packages" / pkg
        (pkg_dir / "dist").mkdir(parents=True)
        (pkg_dir / "dist" / "index.js").write_bytes(b"z" * 4096)
        (pkg_dir / "tsconfig.tsbuildinfo").write_text("{}", encoding="utf-8")
    age_worktree(main, old)

    # Dry run plans every file candidate before every folder candidate in the worktree.
    dry = run_reclaim()
    strips = [a for a in dry["actions"] if a["kind"] == "strip"]
    kinds = [a["target_kind"] for a in strips]
    assert kinds.index("dir") > max(i for i, k in enumerate(kinds) if k == "file")

    # Simulate a locked build-info file in packages/a during apply.
    locked_info = old / "packages" / "a" / "tsconfig.tsbuildinfo"
    real_remove = reclaim.remove_inside
    order: list[str] = []

    def fail_locked_info(path: Path, root: Path):
        order.append(path.relative_to(old).as_posix())
        if path == locked_info:
            res = Removal(str(path))
            res.fail(str(path), "file is locked by another process")
            return res
        return real_remove(path, root)

    monkeypatch.setattr(reclaim, "remove_inside", fail_locked_info)
    data = run_reclaim(apply=True)
    by_rel = {
        Path(a["target"]).relative_to(old).as_posix(): a
        for a in data["actions"]
        if a["kind"] == "strip"
    }
    assert by_rel["packages/a/tsconfig.tsbuildinfo"]["outcome"] == "partial"
    assert by_rel["packages/a/dist"]["outcome"] == "skipped"
    assert "packages/a/tsconfig.tsbuildinfo" in by_rel["packages/a/dist"]["detail"]
    assert (old / "packages" / "a" / "dist" / "index.js").exists()

    assert by_rel["packages/b/tsconfig.tsbuildinfo"]["outcome"] == "done"
    assert by_rel["packages/b/dist"]["outcome"] == "done"
    assert not (old / "packages" / "b" / "dist").exists()
    assert order.index("packages/b/tsconfig.tsbuildinfo") < order.index("packages/b/dist")

    # A root-level build info that fails also protects nested dist folders in the worktree.
    root_info = old / "tsconfig.tsbuildinfo"
    root_info.write_text("{}", encoding="utf-8")
    (old / "packages" / "c" / "dist").mkdir(parents=True)
    (old / "packages" / "c" / "dist" / "index.js").write_bytes(b"z" * 4096)
    age_worktree(main, old)

    def fail_root_info(path: Path, root: Path):
        if path == root_info:
            res = Removal(str(path))
            res.fail(str(path), "locked")
            return res
        return real_remove(path, root)

    monkeypatch.setattr(reclaim, "remove_inside", fail_root_info)
    second = run_reclaim(apply=True)
    by_rel_2 = {
        Path(a["target"]).relative_to(old).as_posix(): a
        for a in second["actions"]
        if a["kind"] == "strip"
    }
    assert by_rel_2["packages/c/dist"]["outcome"] == "skipped"
    assert (old / "packages" / "c" / "dist" / "index.js").exists()
