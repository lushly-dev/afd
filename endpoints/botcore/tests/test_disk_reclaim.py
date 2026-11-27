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
    return {
        Path(a["target"]).name if a["kind"] == "strip" else a["target"]: a["outcome"]
        for a in data["actions"]
    }


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
    repo: dict[str, Path],  # noqa: F811
    state: Path,
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
    repo: dict[str, Path],  # noqa: F811
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
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
    repo: dict[str, Path],  # noqa: F811
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
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
    repo: dict[str, Path],  # noqa: F811
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    age_worktree(repo["main"], repo["old"])
    busy = Processes(cwds=[str(repo["old"])], method="test", sees_cwds=True)
    monkeypatch.setattr(reclaim, "running_processes", lambda: busy)
    action = next(a for a in run_reclaim(apply=True)["actions"] if a["kind"] == "strip")
    assert action["outcome"] == "skipped" and "process" in action["detail"]


def test_low_space_strips_pressure_patterns_and_younger_output(
    repo: dict[str, Path],  # noqa: F811
    state: Path,
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
    repo: dict[str, Path],  # noqa: F811
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Scoped busy protection: an unrelated `cargo` process does not block evicting stale
    aged folders, while recently-touched dirs, held `.cargo-lock` dirs, and dirs named on a
    process command line stay protected."""
    root = repo["tmp"] / "cache"
    stale = root / "stale"
    recent = root / "recent"
    locked = root / "locked"
    named = root / "named"
    for folder in (stale, recent, locked, named):
        folder.mkdir(parents=True)
        (folder / "big").write_bytes(b"r" * 4096)
    for folder in (stale, locked, named):
        age(folder / "big")
        age(folder)
    five_min_ago = time.time() - 300
    age(recent / "big", five_min_ago)
    age(recent, five_min_ago)
    lock_file = locked / ".cargo-lock"
    lock_file.write_bytes(b"")
    age(lock_file)
    age(locked)

    # max_gb = 0 makes all four eligible so we can verify each scoped guard independently.
    text = repo["settings"].read_text(encoding="utf-8")
    text += f"\n[[aged]]\npath = {json.dumps(str(root) + '/*')}\nmax_gb = 0\n"
    repo["settings"].write_text(text, encoding="utf-8")

    cargo_procs = Processes(
        cmdlines=[
            "/home/u/.cargo/bin/cargo build --release",
            f"/home/u/.cargo/bin/rustc --out-dir {named / 'debug' / 'deps'}",
        ],
        method="test",
    )
    monkeypatch.setattr(reclaim, "running_processes", lambda: cargo_procs)
    with RunLock(lock_file):
        # Refresh mtime to match what report_aged sees (RunLock writes a sibling .json, not lock).
        (locked / ".cargo-lock.json").unlink(missing_ok=True)
        age(locked)
        first = run_reclaim(apply=True, tier=0)
    by_target = {a["target"]: a for a in first["actions"] if a["kind"] == "aged"}
    assert by_target[str(stale)]["outcome"] == "done"
    assert not stale.exists()
    assert by_target[str(recent)]["outcome"] == "skipped"
    assert "modified recently" in by_target[str(recent)]["detail"]
    assert by_target[str(locked)]["outcome"] == "skipped"
    assert "lock" in by_target[str(locked)]["detail"]
    assert by_target[str(named)]["outcome"] == "skipped"
    assert "process" in by_target[str(named)]["detail"]
    assert recent.exists() and locked.exists() and named.exists()

    # Once cargo and the lock are gone, the remaining folders can be evicted.
    monkeypatch.setattr(reclaim, "running_processes", lambda: Processes(method="test"))
    second = outcomes(run_reclaim(apply=True, tier=0))
    assert second[str(recent)] == "done"
    assert second[str(locked)] == "done"
    assert second[str(named)] == "done"
    assert root.exists()


def test_aged_bucket_eviction_prunes_empty_buckets_and_keeps_populated_ones(
    repo: dict[str, Path],  # noqa: F811
    state: Path,
) -> None:
    root = repo["tmp"] / "cargo-build"
    fresh = root / "ab" / "0305f56e9b9616"
    stale_in_shared = root / "ab" / "11223344556677"
    stale_alone = root / "cd" / "deadbeef001122"
    for folder in (fresh, stale_in_shared, stale_alone):
        (folder / "debug" / "deps").mkdir(parents=True)
        (folder / "debug" / "deps" / "x.rlib").write_bytes(b"x" * 4096)
    for folder in (stale_in_shared, stale_alone):
        for p in (
            folder / "debug" / "deps" / "x.rlib",
            folder / "debug" / "deps",
            folder / "debug",
            folder,
        ):
            age(p)

    text = repo["settings"].read_text(encoding="utf-8")
    text += f"\n[[aged]]\npath = {json.dumps(str(root) + '/*')}\nmax_age_days = 7\n"
    repo["settings"].write_text(text, encoding="utf-8")

    data = run_reclaim(apply=True, tier=0)
    res = outcomes(data)
    assert res[str(stale_in_shared)] == "done"
    assert res[str(stale_alone)] == "done"
    assert str(fresh) not in res
    assert fresh.exists() and (root / "ab").exists()
    assert not stale_in_shared.exists()
    assert not stale_alone.exists()
    assert not (root / "cd").exists()


@pytest.mark.parametrize("handles", [True, False], ids=["handle-walk", "path-walk"])
def test_a_checkout_kept_inside_an_aged_folder_is_a_warning_not_a_failure(
    repo: dict[str, Path],  # noqa: F811
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
    handles: bool,
) -> None:
    """#2625: a temp folder a test suite writes to holds git fixtures. Each is kept whole,
    and that is the rule working: the run stays ok and disk-status healthy, naming them."""
    from botcore.commands.disk import remove, schedule, setup

    if handles and not remove.HANDLES:
        pytest.skip("this system has no handle walk (Windows): the path walk case covers it")
    monkeypatch.setattr(remove, "HANDLES", handles)
    root = repo["tmp"] / "scratch"
    fixture = root / "afd-doc-lines-abc123"
    deep = root / "pytest-of-me" / "pytest-1" / "test_x0" / "work"
    plain = root / "afd-versions-def456"
    for folder in (fixture, deep, plain):
        folder.mkdir(parents=True)
        (folder / "file.txt").write_text("x", encoding="utf-8")
    (fixture / ".git").mkdir()
    (deep / ".git").write_text("gitdir: /x\n", encoding="utf-8")
    (root / "pytest-of-me" / "loose.txt").write_text("x", encoding="utf-8")
    for p in sorted(root.rglob("*"), key=lambda p: -len(p.parts)):
        age(p)
    text = repo["settings"].read_text(encoding="utf-8")
    text += f"\n[[aged]]\npath = {json.dumps(str(root) + '/*')}\nmax_age_days = 2\n"
    repo["settings"].write_text(text, encoding="utf-8")

    data = run_reclaim(apply=True, tier=0)
    res = outcomes(data)
    assert res[str(plain)] == "done" and not plain.exists()
    assert res[str(fixture)] == "kept" and (fixture / ".git").is_dir()
    assert res[str(root / "pytest-of-me")] == "kept" and (deep / "file.txt").exists()
    assert not (root / "pytest-of-me" / "loose.txt").exists()  # what is not a checkout goes
    assert data["failures"] == []
    assert sorted(data["kept"]) == sorted([str(fixture), str(root / "pytest-of-me")])
    last = json.loads((state / "status.json").read_text())["last_apply"]
    assert last["ok"] is True and sorted(last["kept"]) == sorted(data["kept"])

    monkeypatch.setattr(schedule, "current", lambda: schedule.ScheduleState("test", True, "here"))
    status = asyncio.run(setup.disk_status()).data
    assert status["healthy"], status["problems"]
    (warning,) = [w for w in status["warnings"] if "holds a git checkout" in w]
    assert sorted(data["kept"])[0] in warning or sorted(data["kept"])[1] in warning
    assert "and 1 more" in warning and "by hand" not in warning


@pytest.mark.parametrize("handles", [True, False], ids=["handle-walk", "path-walk"])
@pytest.mark.parametrize("stuck", ["unlink", "lstat"])
def test_an_aged_folder_with_a_checkout_and_a_real_leftover_is_still_partial(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, handles: bool, stuck: str
) -> None:
    """A kept checkout explains only itself: a file beside it that could not be removed, or
    even read, keeps the folder `partial`, a failure."""
    from botcore.commands.disk import remove

    if handles and not remove.HANDLES:
        pytest.skip("this system has no handle walk (Windows): the path walk case covers it")
    if stuck == "lstat" and handles:
        pytest.skip("the handle walk reads entries through scandir, not lstat")
    monkeypatch.setattr(remove, "HANDLES", handles)
    root = tmp_path / "scratch"
    folder = root / "fixture"
    (folder / "repo" / ".git").mkdir(parents=True)
    (folder / "stuck.bin").write_text("x", encoding="utf-8")
    real = getattr(os, stuck)

    def refusing(path, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003 - os's own signature
        if os.fspath(path).endswith("stuck.bin"):
            raise PermissionError(13, "Permission denied")
        return real(path, *args, **kwargs)

    monkeypatch.setattr(remove.os, stuck, refusing)
    action = reclaim.Action(kind="aged", target=str(folder), root=str(root))
    reclaim._do_remove(action)
    assert action.outcome == "partial", action.detail
    assert (folder / "stuck.bin").exists() and (folder / "repo" / ".git").is_dir()


def test_a_checkout_inside_a_strip_still_leaves_the_strip_partial(tmp_path: Path) -> None:
    """Only an [[aged]] folder keeps a checkout as a matter of course: inside a worktree's
    build output one is unexpected, and the strip says it was left undone."""
    worktree = tmp_path / "wt"
    (worktree / "dist" / "inner" / ".git").mkdir(parents=True)
    action = reclaim.Action(kind="strip", target=str(worktree / "dist"), root=str(worktree))
    reclaim._do_remove(action)
    assert action.outcome == "partial" and "holds a git checkout" in (action.detail or "")


def test_low_space_pressure_escalates_aged_folders_and_stops_when_recovered(
    repo: dict[str, Path],  # noqa: F811
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = time.time()
    root = repo["tmp"] / "cargo-build"

    def make_ws(rel: str, hours_ago: float) -> Path:
        folder = root / rel
        folder.mkdir(parents=True)
        (folder / "blob").write_bytes(b"x" * 4096)
        when = now - hours_ago * 3600
        age(folder / "blob", when)
        age(folder, when)
        return folder

    oldest = make_ws("aa/11111111111111", 5 * 24)  # 5 days (< 7d configured)
    mid = make_ws("bb/22222222222222", 2 * 24)  # 2 days
    six_h_plus = make_ws("cc/33333333333333", 10)  # 10 hours
    under_6h = make_ws("dd/44444444444444", 3)  # 3 hours
    active = make_ws("ee/55555555555555", 0.25)  # 15 minutes (< 1h safety floor)

    mount = mount_point(root)
    text = repo["settings"].read_text(encoding="utf-8")
    text += (
        f"\n[[volume]]\nmount = {json.dumps(str(mount))}\nlow_space_gb = 1000000\n"
        f"\n[[aged]]\npath = {json.dumps(str(root) + '/*')}\nmax_age_days = 7\n"
    )
    repo["settings"].write_text(text, encoding="utf-8")

    # Dry run previews all pressure steps without deleting anything.
    dry = run_reclaim(apply=False, tier=0)
    dry_steps = {a["target"]: a["step"] for a in dry["actions"] if a["kind"] == "aged"}
    assert dry_steps == {
        str(oldest): "pressure-1.0d",
        str(mid): "pressure-1.0d",
        str(six_h_plus): "pressure-0.25d",
        str(under_6h): "pressure-oldest",
    }
    assert str(active) not in dry_steps
    assert oldest.exists()

    # Apply with simulated recovery once `oldest` is deleted: stops immediately, keeping `mid`+.
    real_volume_state = reclaim.volume_state

    def recovering_volume(mnt: Path, expected_id, low_space_gb):
        vs = real_volume_state(mnt, expected_id, low_space_gb)
        if not oldest.exists() and low_space_gb is not None:
            vs.free_bytes = int((low_space_gb + 10) * 1024**3)
        return vs

    monkeypatch.setattr(reclaim, "volume_state", recovering_volume)
    recovered = run_reclaim(apply=True, tier=0)
    aged_done = [a for a in recovered["actions"] if a["kind"] == "aged" and a["outcome"] == "done"]
    assert [a["target"] for a in aged_done] == [str(oldest)]
    assert not oldest.exists() and not (root / "aa").exists()
    assert mid.exists() and six_h_plus.exists() and under_6h.exists() and active.exists()
    assert not [a for a in recovered["actions"] if a["kind"] == "strip"]

    # Apply while volume stays persistently low: escalates through 1.0d, 0.25d, pressure-oldest,
    # while leaving the 15-minute-old `active` folder untouched.
    monkeypatch.setattr(reclaim, "volume_state", real_volume_state)
    full = run_reclaim(apply=True, tier=0)
    steps_done = {
        a["target"]: a["step"]
        for a in full["actions"]
        if a["kind"] == "aged" and a["outcome"] == "done"
    }
    assert steps_done == {
        str(mid): "pressure-1.0d",
        str(six_h_plus): "pressure-0.25d",
        str(under_6h): "pressure-oldest",
    }
    assert not mid.exists() and not six_h_plus.exists() and not under_6h.exists()
    assert active.exists()


def test_forced_pressure_and_max_gb_only_aged_escalation(
    repo: dict[str, Path],  # noqa: F811
    state: Path,
) -> None:
    now = time.time()
    root = repo["tmp"] / "aged-pressure"

    def make_entry(name: str, hours_ago: float) -> Path:
        folder = root / name
        folder.mkdir(parents=True)
        (folder / "f").write_bytes(b"x" * 4096)
        when = now - hours_ago * 3600
        age(folder / "f", when)
        age(folder, when)
        return folder

    day_old = make_entry("day-old", 30)
    ten_h = make_entry("ten-h", 10)
    three_h = make_entry("three-h", 3)

    # Forced pressure on a non-low volume runs 1.0d and 0.25d steps, but not pressure-oldest (<6h).
    base_settings = repo["settings"].read_text(encoding="utf-8")
    repo["settings"].write_text(
        base_settings + f"\n[[aged]]\npath = {json.dumps(str(root) + '/*')}\nmax_age_days = 7\n",
        encoding="utf-8",
    )
    forced = run_reclaim(apply=True, tier=0, pressure=True)
    forced_steps = {
        a["target"]: a["step"]
        for a in forced["actions"]
        if a["kind"] == "aged" and a["outcome"] == "done"
    }
    assert forced_steps == {str(day_old): "pressure-1.0d", str(ten_h): "pressure-0.25d"}
    assert not day_old.exists() and not ten_h.exists() and three_h.exists()

    # A max_gb-only [[aged]] entry (no max_age_days) also escalates under low space.
    capped_root = repo["tmp"] / "capped-only"
    capped_old = capped_root / "stale"
    capped_old.mkdir(parents=True)
    (capped_old / "f").write_bytes(b"x" * 4096)
    when = now - 36 * 3600
    age(capped_old / "f", when)
    age(capped_old, when)
    mount = mount_point(capped_root)
    repo["settings"].write_text(
        base_settings
        + f"\n[[volume]]\nmount = {json.dumps(str(mount))}\nlow_space_gb = 1000000\n"
        + f"\n[[aged]]\npath = {json.dumps(str(capped_root) + '/*')}\nmax_gb = 500\n",
        encoding="utf-8",
    )
    low_run = run_reclaim(apply=True, tier=0)
    capped_actions = [a for a in low_run["actions"] if a["kind"] == "aged"]
    assert [(a["target"], a["step"], a["outcome"]) for a in capped_actions] == [
        (str(capped_old), "pressure-1.0d", "done"),
    ]
    assert not capped_old.exists()


def test_is_locked_probes_without_modifying_file(tmp_path: Path) -> None:
    from botcore.commands.disk.lock import is_locked

    missing = tmp_path / "absent"
    assert is_locked(missing) is False
    assert not missing.exists()

    target = tmp_path / ".cargo-lock"
    target.write_bytes(b"")
    old_mtime = time.time() - 5 * 86400
    age(target, old_mtime)
    before = target.stat().st_mtime
    assert is_locked(target) is False
    assert target.stat().st_mtime == before

    with RunLock(target):
        assert is_locked(target) is True
    assert is_locked(target) is False

    if sys.platform != "win32":
        link = tmp_path / "link-lock"
        link.symlink_to(target)
        assert is_locked(link) is True


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
    assert sorted(p.name[:9] for p in folder.glob("*.json")) == [
        "20260103T",
        "20260104T",
        "20260105T",
    ]


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
        check=True,
        capture_output=True,
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
    repo: dict[str, Path],  # noqa: F811
    state: Path,
) -> None:
    repo["settings"].write_text("strip_after_days = -1\n", encoding="utf-8")
    for command in (report.disk_report, reclaim.disk_reclaim):
        result = asyncio.run(command())
        assert not result.success and result.error.code == "DISK_SETTINGS_INVALID"


def test_build_info_is_stripped_before_output_and_failed_build_info_keeps_output(
    repo: dict[str, Path],  # noqa: F811
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """lushly-dev/afd#1939: file candidates (such as *.tsbuildinfo) are stripped before folder
    candidates (such as dist) within a worktree, and if build info cannot be removed its
    output folder stays intact."""
    main, old = repo["main"], repo["old"]
    (main / "botcore.toml").write_text(
        '[disk]\nregenerable = ["**/dist", "**/*.tsbuildinfo"]\n',
        encoding="utf-8",
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


def test_low_space_escalates_large_idle_in_tree_targets_largest_first_and_stops_on_recovery(
    repo: dict[str, Path],  # noqa: F811
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """lushly-dev/afd#2241: on a volume still below threshold after the 6-hour step, oversized
    in-tree outputs (e.g. endpoints/umbel/target) in worktrees idle >= 1 hour are stripped
    largest-first, respecting .cargo-lock and stopping as soon as the volume recovers."""
    main = repo["main"]
    (main / "botcore.toml").write_text(
        '[disk]\nregenerable = [{ path = "**/target", after_days = 1 }, "**/dist"]\n',
        encoding="utf-8",
    )
    (main / ".gitignore").write_text("target/\ndist/\n", encoding="utf-8")
    git(main, "commit", "-q", "-am", "add target rule")

    now = time.time()

    def make_wt(
        name: str, hours_ago: float, size_bytes: int, rel: str = "endpoints/umbel/target"
    ) -> Path:
        wt = repo["tmp"] / name
        git(main, "worktree", "add", "-q", "-b", name, str(wt))
        out = wt / rel
        out.mkdir(parents=True)
        (out / "artifact.bin").write_bytes(b"x" * size_bytes)
        when = now - hours_ago * 3600
        admin = Path(git(wt, "rev-parse", "--absolute-git-dir").strip())
        for git_file in ("HEAD", "index", "logs/HEAD", "ORIG_HEAD", "FETCH_HEAD"):
            age(admin / git_file, when)
        for p in (out / "artifact.bin", out, out.parent, wt):
            age(p, when)
        return wt

    # Use a small threshold in tests so we don't allocate multi-GiB files on disk.
    monkeypatch.setattr(reclaim, "LARGE_STRIP_PRESSURE_BYTES", 20_000)

    huge = make_wt("huge-umbel", 2.0, 80_000)  # idle 2h (< 6h, >= 1h), largest
    medium = make_wt("medium-umbel", 2.5, 40_000)  # idle 2.5h, second largest
    small = make_wt("small-umbel", 2.5, 4_000)  # below LARGE_STRIP_PRESSURE_BYTES
    active = make_wt("active-umbel", 0.25, 90_000)  # idle 15 min (< 1h safety floor)
    locked_wt = make_wt("locked-umbel", 2.0, 95_000)  # holds .cargo-lock

    mount = mount_point(huge)
    text = repo["settings"].read_text(encoding="utf-8")
    text += f"\n[[volume]]\nmount = {json.dumps(str(mount))}\nlow_space_gb = 1000000\n"
    repo["settings"].write_text(text, encoding="utf-8")

    # Dry run previews qualifying large outputs largest-first and leaves active/small out.
    dry = run_reclaim(apply=False)
    large_dry = [a for a in dry["actions"] if a["step"] == "pressure-large"]
    assert [Path(a["worktree"]).name for a in large_dry] == [
        "locked-umbel",
        "huge-umbel",
        "medium-umbel",
    ]
    assert (huge / "endpoints/umbel/target/artifact.bin").exists()

    # Apply while locked_wt holds profile-level .cargo-lock (target/debug/.cargo-lock) and volume
    # recovers after huge is stripped: locked_wt is skipped, huge is stripped, medium is spared.
    debug_lock = locked_wt / "endpoints/umbel/target/debug/.cargo-lock"
    debug_lock.parent.mkdir(parents=True)
    debug_lock.write_bytes(b"")
    for p in (debug_lock, debug_lock.parent, locked_wt / "endpoints/umbel/target"):
        age(p, now - 2.0 * 3600)

    real_volume_state = reclaim.volume_state

    def recovering_volume(mnt: Path, expected_id, low_space_gb):
        vs = real_volume_state(mnt, expected_id, low_space_gb)
        if not (huge / "endpoints/umbel/target").exists() and low_space_gb is not None:
            vs.free_bytes = int((low_space_gb + 10) * 1024**3)
        return vs

    monkeypatch.setattr(reclaim, "volume_state", recovering_volume)
    with RunLock(debug_lock):
        (debug_lock.parent / ".cargo-lock.json").unlink(missing_ok=True)
        for p in (debug_lock.parent, locked_wt / "endpoints/umbel/target"):
            age(p, now - 2.0 * 3600)
        applied = run_reclaim(apply=True)

    large_applied = {
        Path(a["worktree"]).name: a for a in applied["actions"] if a["step"] == "pressure-large"
    }
    assert large_applied["locked-umbel"]["outcome"] == "skipped"
    assert "lock" in large_applied["locked-umbel"]["detail"]
    assert large_applied["huge-umbel"]["outcome"] == "done"
    assert "medium-umbel" not in large_applied
    assert not (huge / "endpoints/umbel/target").exists()
    assert (locked_wt / "endpoints/umbel/target/artifact.bin").exists()
    assert (medium / "endpoints/umbel/target/artifact.bin").exists()
    assert (small / "endpoints/umbel/target/artifact.bin").exists()
    assert (active / "endpoints/umbel/target/artifact.bin").exists()

    # Cross-target profile lock (target/<triple>/release/.cargo-lock) and root lock are detected.
    wasm_lock = medium / "endpoints/umbel/target/wasm32-wasip2/release/.cargo-lock"
    wasm_lock.parent.mkdir(parents=True)
    wasm_lock.write_bytes(b"")
    with RunLock(wasm_lock):
        assert reclaim._cargo_lock_held(medium / "endpoints/umbel/target") is True
    assert reclaim._cargo_lock_held(medium / "endpoints/umbel/target") is False


def test_pressure_large_survives_expired_report_deadline_and_nested_low_volume(
    repo: dict[str, Path],  # noqa: F811
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An already-expired report deadline must not prevent sizing pressure-large candidates, and
    the low-space check must evaluate target_path rather than only the worktree root."""
    from botcore.commands.disk.scan import VolumeState

    main = repo["main"]
    (main / "botcore.toml").write_text(
        '[disk]\nregenerable = [{ path = "**/target", after_days = 1 }]\n',
        encoding="utf-8",
    )
    (main / ".gitignore").write_text("target/\n", encoding="utf-8")
    git(main, "commit", "-q", "-am", "add target rule")

    wt = repo["tmp"] / "nested-vol"
    git(main, "worktree", "add", "-q", "-b", "nested-vol", str(wt))
    target = wt / "endpoints/umbel/target"
    target.mkdir(parents=True)
    (target / "blob.bin").write_bytes(b"y" * 50_000)

    monkeypatch.setattr(reclaim, "LARGE_STRIP_PRESSURE_BYTES", 20_000)
    data = {
        "repos": [
            {
                "main": str(main),
                "blocked": None,
                "worktrees": [
                    {
                        "path": str(wt),
                        "can_strip": True,
                        "exists": True,
                        "idle_seconds": 7200,
                        "idle_days": 0.08,
                        "strip": [
                            {
                                "path": "endpoints/umbel/target",
                                "kind": "dir",
                                "pattern": "**/target",
                                "when": "idle",
                                "after_days": 1.0,
                                "ready": False,
                                "bytes": None,
                            }
                        ],
                    }
                ],
            }
        ]
    }
    healthy = VolumeState(str(wt), True, None, None, 500 * 1024**3, 1000 * 1024**3, 50.0)
    low_nested = VolumeState(str(target), True, None, None, 2 * 1024**3, 100 * 1024**3, 50.0)
    ctx = report.Context(
        settings=reclaim.MachineSettings(),
        processes=Processes(method="test"),
        volumes={str(wt): healthy, str(target): low_nested},
        t3_roots=[],
        deadline=time.monotonic() - 10.0,  # already expired
    )
    groups = reclaim.plan_large_strip_pressure(data, ctx)
    assert len(groups) == 1
    assert groups[0][0].target == str(target)
    assert groups[0][0].bytes_estimate is not None and groups[0][0].bytes_estimate >= 20_000


def test_pressure_large_pairs_build_info_and_stops_if_prereq_recovers_volume(
    repo: dict[str, Path],  # noqa: F811
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """lushly-dev/afd#1939 + #2241: pressure-large strips ancestor build-info files before a
    large directory, keeps the directory if build-info removal fails, and spares the directory if
    removing a prerequisite file already recovers the volume."""
    main = repo["main"]
    (main / "botcore.toml").write_text(
        '[disk]\nregenerable = ["**/dist", "**/*.tsbuildinfo"]\n',
        encoding="utf-8",
    )
    (main / ".gitignore").write_text("dist/\n*.tsbuildinfo\n", encoding="utf-8")
    git(main, "commit", "-q", "-am", "add dist and tsbuildinfo")

    now = time.time()

    def make_pkg_wt(name: str, size_bytes: int) -> Path:
        wt = repo["tmp"] / name
        git(main, "worktree", "add", "-q", "-b", name, str(wt))
        pkg = wt / "packages" / "app"
        (pkg / "dist").mkdir(parents=True)
        (pkg / "dist" / "bundle.bin").write_bytes(b"z" * size_bytes)
        (pkg / "tsconfig.tsbuildinfo").write_text("{}", encoding="utf-8")
        when = now - 2.0 * 3600
        admin = Path(git(wt, "rev-parse", "--absolute-git-dir").strip())
        for git_file in ("HEAD", "index", "logs/HEAD", "ORIG_HEAD", "FETCH_HEAD"):
            age(admin / git_file, when)
        for p in (
            pkg / "dist" / "bundle.bin",
            pkg / "dist",
            pkg / "tsconfig.tsbuildinfo",
            pkg,
            wt,
        ):
            age(p, when)
        return wt

    monkeypatch.setattr(reclaim, "LARGE_STRIP_PRESSURE_BYTES", 20_000)
    wt_fail = make_pkg_wt("wt-fail-info", 60_000)
    wt_recover = make_pkg_wt("wt-recover-info", 40_000)

    mount = mount_point(wt_fail)
    text = repo["settings"].read_text(encoding="utf-8")
    text += f"\n[[volume]]\nmount = {json.dumps(str(mount))}\nlow_space_gb = 1000000\n"
    repo["settings"].write_text(text, encoding="utf-8")

    # 1) Locked build-info in wt_fail keeps wt_fail/packages/app/dist intact;
    #    wt_recover's build-info succeeds and simulates volume recovery, sparing wt_recover/dist.
    fail_info = wt_fail / "packages/app/tsconfig.tsbuildinfo"
    recover_info = wt_recover / "packages/app/tsconfig.tsbuildinfo"
    real_remove = reclaim.remove_inside
    real_volume_state = reclaim.volume_state

    def fake_remove(path: Path, root: Path):
        if path == fail_info:
            res = Removal(str(path))
            res.fail(str(path), "locked")
            return res
        return real_remove(path, root)

    def recover_after_prereq(mnt: Path, expected_id, low_space_gb):
        vs = real_volume_state(mnt, expected_id, low_space_gb)
        if not recover_info.exists() and low_space_gb is not None:
            vs.free_bytes = int((low_space_gb + 10) * 1024**3)
        return vs

    monkeypatch.setattr(reclaim, "remove_inside", fake_remove)
    monkeypatch.setattr(reclaim, "volume_state", recover_after_prereq)
    data = run_reclaim(apply=True)

    by_target = {a["target"]: a for a in data["actions"] if a["step"] == "pressure-large"}
    assert by_target[str(fail_info)]["outcome"] == "partial"
    assert by_target[str(wt_fail / "packages/app/dist")]["outcome"] == "skipped"
    assert (wt_fail / "packages/app/dist/bundle.bin").exists()

    assert by_target[str(recover_info)]["outcome"] == "done"
    assert str(wt_recover / "packages/app/dist") not in by_target
    assert (wt_recover / "packages/app/dist/bundle.bin").exists()
