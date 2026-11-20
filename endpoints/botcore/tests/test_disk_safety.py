"""The disk commands' safety rules, one test per way a report could mark the wrong thing ready."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from botcore.commands.disk import caches, report, scan
from botcore.commands.disk.git import tracked_under
from botcore.commands.disk.report import may_contain
from botcore.commands.disk.scan import Processes, busy_reason, find_candidates, mount_point
from botcore.commands.disk.settings import MachineSettings, t3_worktree_roots
from botcore.config import DiskRegenerable
from tests.test_disk_report import age_worktree, git, repo, rows, run_report  # noqa: F401


def _git_version() -> tuple[int, ...]:
    out = subprocess.run(["git", "--version"], capture_output=True, text=True).stdout
    return tuple(int(n) for n in re.findall(r"\d+", out)[:2])


def _add_setting(repo_: dict[str, Path], text: str) -> None:
    repo_["settings"].write_text(repo_["settings"].read_text(encoding="utf-8") + text, "utf-8")


# ── What a folder is ────────────────────────────────────────────────────────


@pytest.mark.skipif(sys.platform == "win32", reason="symlinks need privileges on Windows")
def test_a_registered_folder_replaced_by_a_link_is_not_inspected(
    repo: dict[str, Path],  # noqa: F811
) -> None:
    old = repo["old"]
    shutil.rmtree(old)
    old.symlink_to(repo["fresh"], target_is_directory=True)
    row = rows(run_report())["old"]
    assert row["tier"] == 3 and row["strip"] == []
    assert "symbolic link" in " ".join(row["reasons"])


def test_a_registered_folder_replaced_by_another_repository_is_not_inspected(
    repo: dict[str, Path],  # noqa: F811
) -> None:
    old = repo["old"]
    shutil.rmtree(old)
    old.mkdir()
    git(old, "init", "-q", "-b", "main")
    (old / "dist").mkdir()
    row = rows(run_report())["old"]
    assert row["tier"] == 3 and row["strip"] == []
    assert any("another" in r for r in row["reasons"])


@pytest.mark.skipif(sys.platform == "win32" or os.geteuid() == 0,
                    reason="permission bits are POSIX; root reads everything")
def test_an_unreadable_folder_is_not_called_missing(repo: dict[str, Path]) -> None:  # noqa: F811
    trees = repo["old"].parent
    os.chmod(trees, 0)
    try:
        data = run_report()
    finally:
        os.chmod(trees, 0o755)
    assert "cannot be read" in data["repos"][0]["blocked"]
    assert all("missing" not in " ".join(w["reasons"]) for w in data["repos"][0]["worktrees"])


def test_a_missing_parent_folder_blocks_the_repository(repo: dict[str, Path]) -> None:  # noqa: F811
    shutil.rmtree(repo["old"].parent)
    data = run_report()
    assert "unplugged" in data["repos"][0]["blocked"]


def test_a_deleted_worktree_folder_is_report_only(repo: dict[str, Path]) -> None:  # noqa: F811
    shutil.rmtree(repo["old"])
    data = run_report()
    assert "blocked" not in data["repos"][0]
    assert rows(data)["old"]["reasons"][0].startswith("missing")


@pytest.mark.skipif(_git_version() < (2, 48), reason="relative worktree paths need git 2.48")
def test_relative_gitdir_records_still_find_activity(repo: dict[str, Path]) -> None:  # noqa: F811
    rel = repo["old"].parent / "rel"
    git(repo["main"], "worktree", "add", "-q", "--relative-paths", "-b", "rel", str(rel))
    (rel / "dist").mkdir()
    age_worktree(repo["main"], rel)
    assert rows(run_report())["rel"]["tier"] == 1
    git(rel, "commit", "-q", "--allow-empty", "-m", "fresh work")
    row = rows(run_report())["rel"]
    assert row["tier"] == 3 and row["idle_days"] < 1


def test_a_nested_worktree_is_its_own_row_not_part_of_its_parent(
    repo: dict[str, Path],  # noqa: F811
) -> None:
    inner = repo["old"] / "gen" / "inner"
    git(repo["main"], "worktree", "add", "-q", "-b", "inner", str(inner))
    (inner / "dist").mkdir()
    age_worktree(repo["main"], repo["old"])
    data = run_report()
    outer = rows(data)["old"]
    assert {r["path"]: r["reason"] for r in outer["refused"]}.get("gen") == "holds another checkout"
    assert not any(s["path"].startswith("gen") for s in outer["strip"])
    assert "inner" in rows(data)


# ── Tiers ───────────────────────────────────────────────────────────────────


def test_an_incomplete_walk_marks_nothing_ready(
    repo: dict[str, Path], monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    (repo["old"] / "src" / "deep").mkdir(parents=True)
    age_worktree(repo["main"], repo["old"])
    monkeypatch.setattr(scan, "MAX_DEPTH", 0)
    row = rows(run_report())["old"]
    assert row["complete"] is False and row["tier"] == 3
    assert not any(s["ready"] for s in row["strip"])


def test_a_recent_build_inside_an_output_folder_counts_as_activity(
    repo: dict[str, Path],  # noqa: F811
) -> None:
    age_worktree(repo["main"], repo["old"])
    (repo["old"] / "dist" / "new-chunk.js").write_text("built just now", encoding="utf-8")
    assert rows(run_report())["old"]["tier"] == 3


def test_a_failed_process_listing_makes_nothing_ready(
    repo: dict[str, Path], monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    age_worktree(repo["main"], repo["old"])
    monkeypatch.setattr(report, "running_processes", lambda: Processes(method="t", ok=False))
    row = rows(run_report())["old"]
    assert row["tier"] == 3 and "could not be listed" in row["busy"]


def test_a_spent_budget_inspects_nothing(repo: dict[str, Path]) -> None:  # noqa: F811
    age_worktree(repo["main"], repo["old"])
    data = run_report(budget_seconds=0)
    assert data["complete"] is False
    assert all(w["tier"] == 3 for r in data["repos"] for w in r["worktrees"])


def test_a_disk_value_that_is_not_a_table_skips_only_that_repository(
    repo: dict[str, Path],  # noqa: F811
) -> None:
    (repo["main"] / "botcore.toml").write_text("disk = 42\n", encoding="utf-8")
    git(repo["main"], "commit", "-q", "-am", "broken")
    data = run_report()
    assert "not valid" in data["repos"][0]["error"]


# ── Volumes ─────────────────────────────────────────────────────────────────


def test_a_recorded_volume_id_must_match(
    repo: dict[str, Path], monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    mount = mount_point(repo["old"])
    monkeypatch.setattr(scan, "volume_id", lambda _m: "VOLUME-A")
    _add_setting(repo, f'\n[[volume]]\nmount = {json.dumps(str(mount))}\nid = "VOLUME-A"\n')
    age_worktree(repo["main"], repo["old"])
    assert rows(run_report())["old"]["tier"] == 1
    monkeypatch.setattr(scan, "volume_id", lambda _m: "VOLUME-B")
    data = run_report()
    assert "blocked" in data["repos"][0] and rows(data)["old"]["tier"] == 3


def test_an_unreadable_volume_blocks_without_failing_the_report(
    repo: dict[str, Path], monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    mount = mount_point(repo["old"])
    _add_setting(repo, f'\n[[volume]]\nmount = {json.dumps(str(mount))}\n')

    def denied(_path):
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(scan.shutil, "disk_usage", denied)
    data = run_report()
    assert "no permission" in data["repos"][0]["blocked"]


def test_every_worktree_volume_is_watched(repo: dict[str, Path]) -> None:  # noqa: F811
    mounts = {v["mount"] for v in run_report()["volumes"]}
    assert str(mount_point(repo["old"])) in mounts


# ── Patterns, copies and tracked files ──────────────────────────────────────


def test_tracked_paths_compare_case_insensitively_where_the_disk_does() -> None:
    files = ["build/keep.txt", "src/a.py"]
    assert tracked_under(Path("."), ["BUILD"], files, fold=True) == {"BUILD"}
    assert tracked_under(Path("."), ["BUILD"], files, fold=False) == set()
    assert tracked_under(Path("."), ["src"], files, fold=False) == {"src"}


def test_a_folder_that_may_hold_a_declared_copy_is_refused() -> None:
    assert may_contain("dist", "dist/.env")
    assert may_contain("apps/web/dist", "apps/*/dist/.env")
    assert may_contain("a/b", "**/x")
    assert not may_contain("dist", ".env")
    assert not may_contain("dist", "dist")
    assert may_contain("Dist", "dist/.env", fold=True)
    assert not may_contain("Dist", "dist/.env", fold=False)


def test_package_folders_links_and_checkouts_are_never_entered(tmp_path: Path) -> None:
    for folder in ("node_modules/pkg/gen", ".venv/lib/gen", "nested/gen", "src/gen"):
        (tmp_path / folder).mkdir(parents=True)
    (tmp_path / "nested" / ".git").write_text("gitdir: /x\n", encoding="utf-8")
    found, complete = find_candidates(tmp_path, [DiskRegenerable(path="**/gen")], 1e18)
    assert complete and [c.rel for c in found] == ["src/gen"]


def test_windows_paths_match_with_either_slash() -> None:
    procs = Processes(cmdlines=["node D:/work/repo/task.js"])
    assert busy_reason(Path("D:\\work\\repo"), procs, windows=True)
    assert busy_reason(Path("D:\\Work\\Repo"), procs, windows=True)
    assert busy_reason(Path("D:\\work\\rep"), procs, windows=True) is None


# ── Caches, aged folders and T3 Code ────────────────────────────────────────


def test_pnpm_store_is_read_from_the_install_record(tmp_path: Path) -> None:
    modules = tmp_path / "node_modules"
    modules.mkdir()
    record = "layoutVersion: 5\nstoreDir: /Volumes/Dev/.pnpm-store/v10\n"
    (modules / ".modules.yaml").write_text(record, encoding="utf-8")
    assert caches.pnpm_store_dir([tmp_path]) == "/Volumes/Dev/.pnpm-store/v10"
    assert caches.pnpm_store_dir([tmp_path / "none"]) is None


def test_aged_patterns_that_reach_protected_folders_are_refused(tmp_path: Path) -> None:
    worktrees = tmp_path / "trees"
    (worktrees / "wt").mkdir(parents=True)
    for pattern in ("/*", "~/*", f"{tmp_path}/*", f"{worktrees}/wt/*", "relative/*"):
        settings = MachineSettings(aged=[{"path": pattern, "max_age_days": 0}])
        row = caches.report_aged(settings, 0.0, 1e18, [worktrees / "wt"])[0]
        assert row["refused"] and row["entries"] == [], pattern


def test_t3_codes_default_folder_counts_when_its_settings_cannot_be_read(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    broken = tmp_path / "settings.json"
    broken.write_text("{not json", encoding="utf-8")
    monkeypatch.setenv("BOTCORE_DISK_T3_SETTINGS", str(broken))
    roots, read_ok = t3_worktree_roots(MachineSettings())
    assert not read_ok
    assert Path(os.path.realpath(Path.home() / ".t3" / "worktrees")) in roots


def test_deletion_never_goes_through_a_checkout(tmp_path: Path) -> None:
    from botcore.commands.disk.remove import remove_inside

    root = tmp_path / "wt"
    nested = root / "gen" / "deep" / "inner"
    nested.mkdir(parents=True)
    (nested / ".git").write_text("gitdir: /x\n", encoding="utf-8")
    (nested / "work.txt").write_text("unique", encoding="utf-8")
    (root / "gen" / "built.js").write_text("x", encoding="utf-8")
    removal = remove_inside(root / "gen", root)
    assert not removal.complete
    assert (nested / "work.txt").read_text() == "unique"
    assert not (root / "gen" / "built.js").exists()


def test_declared_copies_fold_case_where_the_volume_does() -> None:
    from botcore.commands.disk.report import _holds_copy
    from botcore.commands.disk.scan import Candidate

    cand = Candidate("apps/web/.next", DiskRegenerable(path="apps/*/.next"), "dir")
    assert _holds_copy(cand, "Apps/web/.next/cache/**", fold=True)
    if os.name != "nt":  # patterns always ignore case on Windows
        assert not _holds_copy(cand, "Apps/web/.next/cache/**", fold=False)


def test_session_folders_are_matched_as_prefixes_not_substrings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from botcore.commands.disk import setup

    for name in ("TMPDIR", "TEMP", "TMP"):
        monkeypatch.delenv(name, raising=False)
    assert setup._session_path("/var/folders/ab/T/x/bin/uv")
    assert setup._session_path("/Users/j/.local/state/fnm_multishells/123_456/bin/node")
    assert setup._session_path("/tmp/session/bin/git")
    assert not setup._session_path("/home/j/tmp/bin/uv")
    assert not setup._session_path("/opt/homebrew/bin/uv")
    monkeypatch.setenv("TMPDIR", "/scratch/me")
    assert setup._session_path("/scratch/me/bin/gh")
    monkeypatch.setenv("TMPDIR", str(Path.home()))
    assert not setup._session_path(str(Path.home() / ".local" / "bin" / "uv"))


def test_case_probe_looks_past_folders_without_letters(tmp_path: Path) -> None:
    from botcore.commands.disk.git import case_insensitive

    numbered = tmp_path / "Trees" / "2672"
    numbered.mkdir(parents=True)
    assert case_insensitive(numbered) == case_insensitive(tmp_path / "Trees")


@pytest.mark.skipif(sys.platform == "win32", reason="symlinks need privileges on Windows")
def test_a_session_link_hops_to_the_lasting_tool(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from botcore.commands.disk import setup

    monkeypatch.setattr(setup, "_session_path", lambda path: "/session/" in path)
    lasting = tmp_path / "tools" / "uv"
    lasting.parent.mkdir()
    lasting.write_text("")
    (tmp_path / "session").mkdir()
    (tmp_path / "session" / "uv").symlink_to(lasting)
    found = setup.stable_tool_path("uv", str(tmp_path / "session" / "uv"))
    assert found == os.path.join(os.path.realpath(lasting.parent), "uv")
    (tmp_path / "session" / "gone").symlink_to(tmp_path / "tools" / "missing")
    assert setup.stable_tool_path("gone", str(tmp_path / "session" / "gone")) is None


def test_an_uninstall_that_cannot_confirm_says_why(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    from botcore.commands.disk import schedule, setup

    monkeypatch.setattr(schedule, "uninstall", lambda: None)
    monkeypatch.setattr(schedule, "current", lambda: schedule.ScheduleState(
        "linux", True, "crontab", "the crontab could not be read"))
    result = asyncio.run(setup.disk_setup(uninstall=True))
    assert not result.success and "could not be read" in result.error.message
