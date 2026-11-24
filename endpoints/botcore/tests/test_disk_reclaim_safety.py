"""disk-reclaim's second review: each way a reclaim could delete the wrong thing or lose a run."""

# ruff: noqa: F811
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from botcore.commands.disk import caches, reclaim, remove, schedule, setup
from botcore.commands.disk.lock import RunLock, holder
from botcore.commands.disk.remove import remove_inside
from tests.test_disk_reclaim import run_reclaim, state  # noqa: F401
from tests.test_disk_report import age, age_worktree, git, repo  # noqa: F401


def strip_action(data: dict) -> dict:
    return next(a for a in data["actions"] if a["kind"] == "strip")


def plan_then(monkeypatch: pytest.MonkeyPatch, after) -> None:
    original = reclaim.plan_strips

    def wrapped(*args, **kwargs):
        planned = original(*args, **kwargs)
        after()
        return planned

    monkeypatch.setattr(reclaim, "plan_strips", wrapped)


# ── Rechecks just before deleting ───────────────────────────────────────────


def test_a_lock_taken_after_planning_stops_the_strip(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    age_worktree(repo["main"], repo["old"])
    plan_then(monkeypatch, lambda: git(repo["main"], "worktree", "lock", str(repo["old"])))
    action = strip_action(run_reclaim(apply=True))
    assert action["outcome"] == "skipped" and "locked" in action["detail"]
    assert (repo["old"] / "dist" / "bundle.js").exists()


def test_a_build_that_finished_after_planning_stops_the_strip(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    age_worktree(repo["main"], repo["old"])
    plan_then(monkeypatch, lambda: (repo["old"] / "dist" / "fresh.js").write_text("x"))
    action = strip_action(run_reclaim(apply=True))
    assert action["outcome"] == "skipped" and "active" in action["detail"]


def test_a_nested_repository_is_never_stripped(
    repo: dict[str, Path],
    state: Path,
) -> None:
    nested = repo["old"] / "vendor" / "lib"
    (nested / "gen").mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(nested)], check=True)
    (nested / "gen" / "tracked.js").write_text("v1", encoding="utf-8")
    git(nested, "add", "-f", "gen/tracked.js")
    git(nested, "commit", "-q", "-m", "nested")
    (nested / "gen" / "tracked.js").write_text("edited, uncommitted", encoding="utf-8")
    age_worktree(repo["main"], repo["old"])
    run_reclaim(apply=True)
    assert (nested / "gen" / "tracked.js").read_text() == "edited, uncommitted"


def test_a_git_failure_skips_the_action_and_still_writes_the_receipt(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    age_worktree(repo["main"], repo["old"])

    def vanish():
        os.rename(repo["old"], repo["tmp"] / "moved-away")

    plan_then(monkeypatch, vanish)
    data = run_reclaim(apply=True)
    assert strip_action(data)["outcome"] == "skipped"
    assert Path(data["receipt"]).exists()
    assert "last_apply" in json.loads((state / "status.json").read_text())


def test_forced_pressure_runs_every_step_it_previews(
    repo: dict[str, Path],
    state: Path,
) -> None:
    fresh = repo["fresh"]
    admin = Path(git(fresh, "rev-parse", "--absolute-git-dir").strip())
    eight_hours = time.time() - 8 * 3600
    for name in ("HEAD", "index", "logs/HEAD", "ORIG_HEAD", "FETCH_HEAD"):
        age(admin / name, eight_hours)
    for folder, dirs, files in os.walk(fresh):
        dirs[:] = [d for d in dirs if d != ".git"]
        for name in files + dirs:
            age(Path(folder) / name, eight_hours)
    preview = run_reclaim(pressure=True)
    planned = {a["target"] for a in preview["actions"] if a["kind"] == "strip"}
    assert str(fresh / "dist") in planned
    applied = run_reclaim(apply=True, pressure=True)
    assert {a["target"] for a in applied["actions"] if a["outcome"] == "done"} >= planned


# ── Aged folders ────────────────────────────────────────────────────────────


def test_an_aged_folder_refreshed_after_planning_is_kept(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cache = repo["tmp"] / "cache" / "slot"
    cache.mkdir(parents=True)
    (cache / "old.bin").write_bytes(b"r")
    age(cache / "old.bin")
    age(cache)
    repo["settings"].write_text(
        repo["settings"].read_text()
        + (f"\n[[aged]]\npath = {json.dumps(str(cache.parent) + '/*')}\nmax_age_days = 7\n")
    )
    original = reclaim.plan_tier0

    def plan_then_refresh(data):
        planned = original(data)
        (cache / "new.bin").write_bytes(b"n")
        return planned

    monkeypatch.setattr(reclaim, "plan_tier0", plan_then_refresh)
    action = next(a for a in run_reclaim(apply=True, tier=0)["actions"] if a["kind"] == "aged")
    assert action["outcome"] == "skipped" and "changed" in action["detail"]
    assert (cache / "old.bin").exists()


def test_an_aged_pattern_over_the_home_folder_deletes_nothing(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    home = repo["tmp"] / "home"
    (home / "Documents").mkdir(parents=True)
    (home / "Documents" / "thesis.docx").write_text("years of work", encoding="utf-8")
    age(home / "Documents" / "thesis.docx")
    age(home / "Documents")
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    repo["settings"].write_text(
        repo["settings"].read_text() + '\n[[aged]]\npath = "~/*"\nmax_age_days = 1\n'
    )
    data = run_reclaim(apply=True, tier=0)
    assert not [a for a in data["actions"] if a["kind"] == "aged"]
    assert (home / "Documents" / "thesis.docx").exists()


# ── pnpm ────────────────────────────────────────────────────────────────────


def test_hard_link_evidence_must_come_from_the_store_being_pruned(tmp_path: Path) -> None:
    def install(name: str, store: str, linked: bool) -> Path:
        checkout = tmp_path / name
        pkg = checkout / "node_modules" / ".pnpm" / "x@1" / "node_modules" / "x"
        pkg.mkdir(parents=True)
        (pkg / "package.json").write_text("{}")
        if linked:
            os.link(pkg / "package.json", tmp_path / f"{name}-store-copy")
        (checkout / "node_modules" / ".modules.yaml").write_text(f"storeDir: {store}\n")
        return checkout

    linked = install("a", "/stores/one", True)
    cloned = install("b", "/stores/two", False)
    rows = {r["path"]: r for r in caches._pnpm([linked, cloned], 1e18)}
    assert rows["/stores/one"]["action"] == "pnpm store prune"
    assert rows["/stores/one"]["cwd"] == str(linked)
    assert rows["/stores/two"]["action"] is None
    mixed = install("c", "/stores/one", False)
    assert caches._pnpm([linked, mixed], 1e18)[0]["action"] is None


# ── Lock, receipts and status ───────────────────────────────────────────────


def test_the_lock_survives_a_reader_and_frees_on_exit(state: Path) -> None:
    lock_path = state / "run.lock"
    with RunLock(lock_path):
        assert holder(lock_path)["pid"] == os.getpid()
    with RunLock(lock_path) as again:
        assert again.held
    assert lock_path.exists()  # never deleted: the kernel, not the file, is the lock


def test_receipts_have_unique_names_and_the_newest_is_kept(state: Path) -> None:
    payload = {"apply": False, "actions": [], "failures": []}
    first, second = reclaim.write_receipt(payload), reclaim.write_receipt(payload)
    assert first != second and first.exists() and second.exists()


def test_the_job_does_not_rerun_every_hour_while_space_stays_low() -> None:
    gib = 1024**3
    last = {"still_low": ["/V"], "free_after": {"/V": 10 * gib}}
    same = [{"mount": "/V", "below_threshold": True, "free_gb": 10.2}]
    worse = [{"mount": "/V", "below_threshold": True, "free_gb": 8.5}]
    assert setup._newly_low(same, last) == []
    assert setup._newly_low(worse, last) == ["/V"]
    assert setup._newly_low(same, {}) == ["/V"]


def test_the_job_reports_a_refused_reclaim(
    repo: dict[str, Path],
    state: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def refused(**_kwargs):
        return SimpleNamespace(
            success=False,
            data=None,
            error=SimpleNamespace(code="DISK_RUN_IN_PROGRESS", message="busy"),
        )

    monkeypatch.setattr(reclaim, "disk_reclaim", refused)
    result = asyncio.run(setup.disk_run(force=True))
    assert not result.success and result.error.code == "DISK_RUN_IN_PROGRESS"


# ── Setup and schedulers ────────────────────────────────────────────────────


def test_setup_refuses_a_botcore_inside_a_checkout(
    repo: dict[str, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    exe = repo["old"] / ".venv" / "bin" / "botcore"
    exe.parent.mkdir(parents=True)
    exe.write_text("#!/bin/sh\n")
    monkeypatch.setattr(setup.shutil, "which", lambda name: str(exe))
    monkeypatch.setattr(setup, "uv_cache_dir", lambda: None)
    found, why = setup._persistent_exe([repo["old"]])
    assert found is None and "inside" in why


@pytest.mark.skipif(sys.platform == "win32", reason="symlinks need privileges on Windows")
def test_tools_are_recorded_by_paths_that_last(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(setup, "_session_path", lambda path: "/session" in path)
    # fnm: the session folder links to the Node version's folder, and pnpm there links to
    # corepack's pnpm.js
    version_bin = tmp_path / "versions" / "v24" / "bin"
    (tmp_path / "versions" / "v24" / "lib").mkdir(parents=True)
    version_bin.mkdir()
    (tmp_path / "versions" / "v24" / "lib" / "pnpm.js").write_text("")
    (version_bin / "pnpm").symlink_to("../lib/pnpm.js")
    (tmp_path / "session").symlink_to(tmp_path / "versions" / "v24", target_is_directory=True)
    found = str(tmp_path / "session" / "bin" / "pnpm")
    assert setup.stable_tool_path("pnpm", found) == os.path.join(
        os.path.realpath(version_bin), "pnpm"
    )
    # Homebrew: a link into a versioned Cellar folder is kept as the link
    brew = tmp_path / "brew" / "bin"
    (tmp_path / "brew" / "Cellar" / "uv" / "0.12" / "bin").mkdir(parents=True)
    brew.mkdir()
    real_uv = tmp_path / "brew" / "Cellar" / "uv" / "0.12" / "bin" / "uv"
    real_uv.write_text("")
    (brew / "uv").symlink_to(real_uv)
    assert setup.stable_tool_path("uv", str(brew / "uv")) == str(brew / "uv")
    # A tool that only exists in the session is left out
    (tmp_path / "session-only").mkdir()
    (tmp_path / "session-only" / "gh").write_text("")
    assert setup.stable_tool_path("gh", str(tmp_path / "session-only" / "gh")) is None
    monkeypatch.setattr(
        setup.shutil, "which", lambda name: {"pnpm": found, "uv": str(brew / "uv")}.get(name)
    )
    settings = setup.MachineSettings(tools={"gh": "/old/gh"})
    assert set(setup.record_tools(settings)) == {"pnpm", "uv"}
    assert setup.job_path(settings).split(os.pathsep)[:2] == [
        os.path.realpath(version_bin),
        str(brew),
    ]


def test_an_unreadable_crontab_is_never_overwritten(monkeypatch: pytest.MonkeyPatch) -> None:
    writes = []

    def fake_run(args, stdin=None):
        if args[:2] == ["crontab", "-l"]:
            return subprocess.CompletedProcess(args, 1, "", "crontab: permission denied")
        writes.append(stdin)
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(schedule, "_run", fake_run)
    monkeypatch.setattr(
        schedule.shutil, "which", lambda name: None if name == "systemctl" else name
    )
    state_ = schedule._linux_install("/x/botcore", "/usr/bin")
    assert not state_.installed and writes == []
    assert schedule.read_crontab() is None


def test_an_absent_crontab_reads_as_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        schedule,
        "_run",
        lambda args, stdin=None: subprocess.CompletedProcess(args, 1, "", "no crontab for jason"),
    )
    monkeypatch.setattr(schedule.shutil, "which", lambda name: name)
    assert schedule.read_crontab() == ""


# ── Deletion: the path-based walker Windows uses ────────────────────────────


@pytest.mark.skipif(sys.platform == "win32", reason="symlinks need privileges on Windows")
def test_the_path_walker_also_never_follows_links_or_enters_checkouts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(remove, "HANDLES", False)
    root = tmp_path / "wt"
    (root / "dist" / "inner").mkdir(parents=True)
    (root / "dist" / "inner" / ".git").write_text("gitdir: /x\n")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "precious").write_text("keep")
    (root / "dist" / "link").symlink_to(outside, target_is_directory=True)
    (root / "dist" / "built.js").write_text("x")
    removal = remove_inside(root / "dist", root)
    assert (outside / "precious").exists()
    assert (root / "dist" / "inner" / ".git").exists()
    assert not (root / "dist" / "built.js").exists() and not removal.complete
