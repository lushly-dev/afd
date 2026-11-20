"""Tier 2: which worktrees count as finished, removing them safely, keeps and restores."""

from __future__ import annotations

import asyncio
import json
import subprocess
from pathlib import Path

import pytest

from botcore.commands.disk import keep, reclaim, report
from botcore.commands.disk.scan import Processes
from tests.test_disk_report import age_worktree, git

DISK_TOML = """\
[disk]
regenerable = ["dist"]
copies = [".env"]
"""


def commit(cwd: Path, name: str, text: str, message: str) -> None:
    (cwd / name).write_text(text, encoding="utf-8")
    git(cwd, "add", name)
    git(cwd, "commit", "-q", "-m", message)


@pytest.fixture
def repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    origin = tmp_path / "origin.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)], check=True)
    main = tmp_path / "main"
    main.mkdir()
    git(main, "init", "-q", "-b", "main")
    (main / "botcore.toml").write_text(DISK_TOML, encoding="utf-8")
    (main / ".gitignore").write_text("dist/\n.env\n", encoding="utf-8")
    (main / ".env").write_text("TOKEN=same\n", encoding="utf-8")
    git(main, "add", "botcore.toml", ".gitignore")
    git(main, "commit", "-q", "-m", "init")
    git(main, "remote", "add", "origin", str(origin))
    git(main, "push", "-q", "-u", "origin", "main")
    trees = tmp_path / "trees"
    paths = {}
    for name in ("done", "squashed", "open", "dirty", "envcopy", "kept"):
        paths[name] = trees / name
        git(main, "worktree", "add", "-q", "-b", name, str(paths[name]))
        (paths[name] / "dist").mkdir()
        (paths[name] / "dist" / "out.js").write_text("x", encoding="utf-8")
    commit(paths["done"], "done.txt", "merged", "done work")
    git(main, "merge", "-q", "--ff-only", "done")
    commit(paths["squashed"], "feature.txt", "landed by squash", "squashed work")
    commit(main, "feature.txt", "landed by squash", "squash of squashed")
    commit(paths["open"], "open.txt", "not merged", "open work")
    git(main, "push", "-q", "origin", "main")
    git(main, "fetch", "-q", "origin")
    (paths["dirty"] / "notes.txt").write_text("uncommitted", encoding="utf-8")
    (paths["envcopy"] / ".env").write_text("TOKEN=edited\n", encoding="utf-8")
    git(main, "worktree", "lock", "--reason", "someone else's", str(paths["kept"]))
    for path in paths.values():
        age_worktree(main, path)
    settings = tmp_path / "disk.toml"
    settings.write_text(f'repos = [{json.dumps(str(main))}]\ncaches = []\n', encoding="utf-8")
    monkeypatch.setenv("BOTCORE_DISK_SETTINGS", str(settings))
    monkeypatch.setenv("BOTCORE_DISK_STATE", str(tmp_path / "state"))
    monkeypatch.setenv("BOTCORE_DISK_T3_SETTINGS", "")
    idle = lambda: Processes(method="test")  # noqa: E731
    monkeypatch.setattr(report, "running_processes", idle)
    monkeypatch.setattr(reclaim, "running_processes", idle)
    return {"main": main, "settings": settings, "tmp": tmp_path, **paths}


def rows(data: dict) -> dict[str, dict]:
    return {Path(w["path"]).name: w for r in data["repos"] for w in r["worktrees"]}


def run(coro) -> dict:
    result = asyncio.run(coro)
    assert result.success, result.error
    return result.data


def removed(data: dict) -> set[str]:
    return {Path(a["target"]).name for a in data["actions"]
            if a["kind"] == "remove" and a["outcome"] == "done"}


# ── What counts as finished ─────────────────────────────────────────────────


def test_only_landed_worktrees_with_nothing_unique_are_tier_2(repo: dict[str, Path]) -> None:
    by = rows(run(report.disk_report()))
    assert by["done"]["tier"] == 2 and "is in origin/main" in by["done"]["finished"]["landed"]
    assert by["squashed"]["tier"] == 2
    assert "matches origin/main" in by["squashed"]["finished"]["landed"]
    assert by["open"]["tier"] != 2 and by["open"]["finished"]["restorable"]
    assert by["dirty"]["tier"] != 2 and by["dirty"]["finished"]["unique"]
    assert "may be unique: .env" in " ".join(by["envcopy"]["finished"]["unique"])
    assert by["kept"]["tier"] != 2 and "finished" not in by["kept"]
    assert by["main"]["tier"] != 2


def test_a_commit_on_no_branch_is_unique(repo: dict[str, Path]) -> None:
    done = repo["done"]
    git(done, "checkout", "-q", "--detach")
    commit(done, "lost.txt", "only here", "detached work")
    age_worktree(repo["main"], done)
    verdict = rows(run(report.disk_report()))["done"]["finished"]
    assert "on no branch or remote" in " ".join(verdict["unique"])


def test_t3_codes_worktrees_are_never_tier_2(
    repo: dict[str, Path], monkeypatch: pytest.MonkeyPatch,
) -> None:
    t3 = repo["tmp"] / "t3.json"
    t3.write_text(json.dumps({"worktreesDirectory": str(repo["done"].parent)}))
    monkeypatch.setenv("BOTCORE_DISK_T3_SETTINGS", str(t3))
    by = rows(run(report.disk_report()))
    assert by["done"]["managed_by"] == "t3-code" and by["done"]["tier"] != 2


def test_a_recent_worktree_is_not_finished(repo: dict[str, Path]) -> None:
    import os

    admin = Path(git(repo["done"], "rev-parse", "--absolute-git-dir").strip())
    os.utime(admin / "HEAD")  # checked out a moment ago
    assert rows(run(report.disk_report()))["done"]["tier"] != 2


# ── Removing ────────────────────────────────────────────────────────────────


def test_tier_2_removes_finished_worktrees_and_keeps_their_branches(
    repo: dict[str, Path],
) -> None:
    preview = run(reclaim.disk_reclaim(tier=2))
    assert {Path(a["target"]).name for a in preview["actions"] if a["kind"] == "remove"} == {
        "done", "squashed"}
    assert repo["done"].exists()
    data = run(reclaim.disk_reclaim(tier=2, apply=True))
    assert removed(data) == {"done", "squashed"}
    assert not repo["done"].exists() and not repo["squashed"].exists()
    for name in ("open", "dirty", "envcopy", "kept"):
        assert repo[name].exists()
    branches = git(repo["main"], "branch", "--format=%(refname:short)").split()
    assert {"done", "squashed"} <= set(branches)
    worktrees = git(repo["main"], "worktree", "list", "--porcelain")
    assert str(repo["done"]) not in worktrees


def test_include_restorable_also_removes_unlanded_work_and_restore_brings_it_back(
    repo: dict[str, Path],
) -> None:
    head = git(repo["open"], "rev-parse", "HEAD").strip()
    data = run(reclaim.disk_reclaim(tier=2, apply=True, include_restorable=True))
    assert "open" in removed(data) and not repo["open"].exists()
    assert {"dirty", "envcopy"}.isdisjoint(removed(data))
    back = run(keep.disk_restore(str(repo["open"])))
    assert "on open at" in back["how"]
    assert git(repo["open"], "rev-parse", "HEAD").strip() == head
    assert (repo["open"] / "open.txt").read_text() == "not merged"


def test_restore_recreates_a_deleted_branch(repo: dict[str, Path]) -> None:
    head = git(repo["done"], "rev-parse", "HEAD").strip()
    run(reclaim.disk_reclaim(tier=2, apply=True))
    git(repo["main"], "branch", "-q", "-D", "done")
    back = run(keep.disk_restore(str(repo["done"])))
    assert "recreated" in back["how"]
    assert git(repo["done"], "rev-parse", "HEAD").strip() == head


def test_changes_after_planning_stop_a_removal(
    repo: dict[str, Path], monkeypatch: pytest.MonkeyPatch,
) -> None:
    original = reclaim.plan_tier2

    def plan_then_change(data, run_, include_restorable):
        planned = original(data, run_, include_restorable)
        (repo["done"] / "new.txt").write_text("typed just now", encoding="utf-8")
        git(repo["main"], "worktree", "lock", str(repo["squashed"]))
        return planned

    monkeypatch.setattr(reclaim, "plan_tier2", plan_then_change)
    data = run(reclaim.disk_reclaim(tier=2, apply=True))
    outcomes = {Path(a["target"]).name: (a["outcome"], a["detail"])
                for a in data["actions"] if a["kind"] == "remove"}
    assert outcomes["done"][0] == "skipped"
    assert outcomes["squashed"][0] == "skipped" and "locked" in outcomes["squashed"][1]
    assert repo["done"].exists() and repo["squashed"].exists()


def test_a_busy_worktree_is_not_removed(
    repo: dict[str, Path], monkeypatch: pytest.MonkeyPatch,
) -> None:
    busy = Processes(cwds=[str(repo["done"])], method="test", sees_cwds=True)
    monkeypatch.setattr(reclaim, "running_processes", lambda: busy)
    data = run(reclaim.disk_reclaim(tier=2, apply=True))
    assert "done" not in removed(data) and repo["done"].exists()


def test_include_restorable_needs_tier_2(repo: dict[str, Path]) -> None:
    result = asyncio.run(reclaim.disk_reclaim(tier=1, include_restorable=True))
    assert not result.success and result.error.code == "DISK_TIER_INVALID"


# ── Keeps ───────────────────────────────────────────────────────────────────


def test_a_keep_protects_and_expires_visibly(repo: dict[str, Path]) -> None:
    run(keep.disk_keep(str(repo["done"]), until="2999-01-01", reason="parked for review"))
    reason = git(repo["main"], "worktree", "list", "--porcelain")
    assert "botcore-keep until=2999-01-01: parked for review" in reason
    assert rows(run(report.disk_report()))["done"]["tier"] != 2
    lock = repo["main"] / ".git" / "worktrees" / "done" / "locked"
    lock.write_text("botcore-keep until=2000-01-01: old", encoding="utf-8")
    row = rows(run(report.disk_report()))["done"]
    assert row["keep_expired"] == "2000-01-01" and row["tier"] != 2
    run(keep.disk_unkeep(str(repo["done"])))
    assert rows(run(report.disk_report()))["done"]["tier"] == 2


def test_unkeep_never_releases_another_tools_lock(repo: dict[str, Path]) -> None:
    result = asyncio.run(keep.disk_unkeep(str(repo["kept"])))
    assert not result.success and result.error.code == "DISK_LOCKED_ELSEWHERE"
    result = asyncio.run(keep.disk_keep(str(repo["kept"])))
    assert not result.success and result.error.code == "DISK_LOCKED_ELSEWHERE"
    assert "someone else's" in git(repo["main"], "worktree", "list", "--porcelain")


def test_the_main_checkout_cannot_be_kept_and_a_past_date_is_refused(
    repo: dict[str, Path],
) -> None:
    assert asyncio.run(keep.disk_keep(str(repo["main"]))).error.code == "DISK_NOT_A_WORKTREE"
    assert asyncio.run(keep.disk_keep(str(repo["done"]), until="2001-01-01")).error.code == \
        "DISK_KEEP_INVALID"


def test_restore_without_a_record_says_so(repo: dict[str, Path]) -> None:
    result = asyncio.run(keep.disk_restore(str(repo["tmp"] / "never-removed")))
    assert not result.success and result.error.code == "DISK_NOT_REMOVED"


# ── The scheduled job ───────────────────────────────────────────────────────


def test_the_job_removes_worktrees_only_when_setup_said_so(
    repo: dict[str, Path], monkeypatch: pytest.MonkeyPatch,
) -> None:
    from botcore.commands.disk import setup

    tiers = []

    async def fake_reclaim(**kwargs):
        tiers.append(kwargs["tier"])
        from types import SimpleNamespace

        return SimpleNamespace(success=True, data={"still_low": [], "failures": []})

    monkeypatch.setattr(reclaim, "disk_reclaim", fake_reclaim)
    run(setup.disk_run(force=True))
    repo["settings"].write_text(repo["settings"].read_text() + "remove_landed = true\n")
    run(setup.disk_run(force=True))
    assert tiers == [1, 2]
