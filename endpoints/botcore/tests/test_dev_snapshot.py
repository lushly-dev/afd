"""Tests for botcore.commands.dev.snapshot (dev_snapshot)."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from afd.testing import assert_error, assert_success

from botcore.commands.dev.snapshot import dev_snapshot


def _git(repo: Path, *args: str) -> str:
    res = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return res.stdout.strip()


def _init_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-b", "main")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test User")
    (repo / "app.py").write_text("line1\nline2\n", encoding="utf-8")
    _git(repo, "add", "app.py")
    _git(repo, "commit", "-m", "initial")
    return repo


async def test_snapshot_clean_repo_and_compare_unchanged(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)

    first = assert_success(await dev_snapshot(path=str(repo)))
    assert first["head"] == _git(repo, "rev-parse", "HEAD")
    assert first["branch"] == "main"
    assert first["dirty_count"] == 0
    assert first["untracked_count"] == 0
    assert len(first["digest"]) == 64

    # Compare by dict, JSON string, and bare digest.
    for target in (first, json.dumps(first), first["digest"]):
        second = assert_success(await dev_snapshot(path=str(repo), compare_to=target))
        assert second["comparison"]["unchanged"] is True
        assert second["comparison"]["changed_components"] == []


async def test_snapshot_detects_edit_untracked_and_diff_delta(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    base_sha = _git(repo, "rev-parse", "HEAD")

    before = assert_success(await dev_snapshot(base=base_sha, path=str(repo)))
    assert before["diff_stat"]["files_changed"] == 0
    assert before["diff_stat"]["insertions"] == 0

    (repo / "app.py").write_text("line1\nline2\nline3\nline4\n", encoding="utf-8")
    (repo / "notes.txt").write_text("hello\n", encoding="utf-8")

    after = assert_success(await dev_snapshot(base=base_sha, compare_to=before, path=str(repo)))
    comp = after["comparison"]
    assert comp["unchanged"] is False
    assert "unstaged_diff_sha256" in comp["changed_components"]
    assert "status_sha256" in comp["changed_components"]
    assert "untracked_sha256" in comp["changed_components"]
    assert comp["diff_delta"] == {
        "files_delta": 1,
        "insertions_delta": 2,
        "deletions_delta": 0,
        "net_lines_delta": 2,
        "untracked_delta": 1,
    }

    # Changing untracked content alone also changes untracked_sha256 and digest.
    (repo / "notes.txt").write_text("changed\n", encoding="utf-8")
    after_edit = assert_success(await dev_snapshot(base=base_sha, compare_to=after, path=str(repo)))
    assert after_edit["comparison"]["unchanged"] is False
    assert after_edit["comparison"]["changed_components"] == ["untracked_sha256"]


async def test_snapshot_detects_branch_switch_same_commit_and_staged_index_edit(
    tmp_path: Path,
) -> None:
    repo = _init_repo(tmp_path)
    _git(repo, "branch", "other-at-same-commit")
    before = assert_success(await dev_snapshot(path=str(repo)))

    # Switching between two existing branches at the exact same commit must change digest.
    _git(repo, "checkout", "other-at-same-commit")
    after_switch = assert_success(await dev_snapshot(path=str(repo), compare_to=before))
    assert after_switch["comparison"]["unchanged"] is False
    assert "symbolic_head" in after_switch["comparison"]["changed_components"]

    # Modifying staged index while leaving working-tree bytes identical must change digest.
    (repo / "app.py").write_text("staged-v1\n", encoding="utf-8")
    _git(repo, "add", "app.py")
    (repo / "app.py").write_text("worktree-final\n", encoding="utf-8")
    mid = assert_success(await dev_snapshot(path=str(repo)))

    # Now update ONLY the index (stage a different intermediate state), keep worktree identical.
    (repo / "app.py").write_text("staged-v2\n", encoding="utf-8")
    _git(repo, "add", "app.py")
    (repo / "app.py").write_text("worktree-final\n", encoding="utf-8")
    after_stage = assert_success(await dev_snapshot(path=str(repo), compare_to=mid))
    assert after_stage["comparison"]["unchanged"] is False
    assert "staged_diff_sha256" in after_stage["comparison"]["changed_components"]


async def test_snapshot_excludes_t3_refs_by_default_and_detects_other_refs(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    head = _git(repo, "rev-parse", "HEAD")
    before = assert_success(await dev_snapshot(path=str(repo)))

    # A refs/t3/ checkpoint does not disturb the default snapshot.
    _git(repo, "update-ref", "refs/t3/checkpoint-1", head)
    after_t3 = assert_success(await dev_snapshot(path=str(repo), compare_to=before))
    assert after_t3["comparison"]["unchanged"] is True

    # With exclude_ref_prefixes=[], refs/t3/ changes ARE detected.
    before_all = assert_success(await dev_snapshot(path=str(repo), exclude_ref_prefixes=[]))
    _git(repo, "update-ref", "refs/t3/checkpoint-2", head)
    after_all = assert_success(
        await dev_snapshot(path=str(repo), compare_to=before_all, exclude_ref_prefixes=[])
    )
    assert after_all["comparison"]["unchanged"] is False
    assert "refs_sha256" in after_all["comparison"]["changed_components"]

    # Non-standard refs like refs/factory/* are included and detected.
    _git(repo, "update-ref", "refs/factory/slot-1", head)
    after_factory = assert_success(await dev_snapshot(path=str(repo), compare_to=before))
    assert after_factory["comparison"]["unchanged"] is False
    assert "refs_sha256" in after_factory["comparison"]["changed_components"]


async def test_snapshot_error_paths_and_option_injection_guard(tmp_path: Path) -> None:
    # Missing path
    assert_error(await dev_snapshot(path=str(tmp_path / "missing")), "PATH_NOT_FOUND")

    # Non-git directory
    plain = tmp_path / "plain"
    plain.mkdir()
    assert_error(await dev_snapshot(path=str(plain)), "NOT_A_GIT_REPO")

    # Invalid / empty / failed compare_to baselines must be refused (never unchanged=True).
    repo = _init_repo(tmp_path)
    assert_error(await dev_snapshot(path=str(repo), compare_to="not-a-digest"), "INVALID_INPUT")
    assert_error(await dev_snapshot(path=str(repo), compare_to={}), "INVALID_INPUT")
    assert_error(await dev_snapshot(path=str(repo), compare_to="{}"), "INVALID_INPUT")
    assert_error(
        await dev_snapshot(path=str(repo), compare_to={"success": False, "error": {}}),
        "INVALID_INPUT",
    )

    # Option injection via base must be refused and never write any file.
    target_file = tmp_path / "should-not-exist.txt"
    assert_error(
        await dev_snapshot(path=str(repo), base=f"--output={target_file}"),
        "INVALID_BASE",
    )
    assert not target_file.exists()
    assert_error(await dev_snapshot(path=str(repo), base="nonexistent-ref-xyz"), "INVALID_BASE")
