"""Tests for botcore.commands.pr (pr_status, pr_wait, pr_drift)."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from afd.testing import assert_error, assert_success

from botcore.commands.pr.drift import _extract_credits, pr_drift
from botcore.commands.pr.github import (
    GhCommandError,
    classify_bot,
    collapse_checks,
    parse_owner_repo,
)
from botcore.commands.pr.status import pr_status
from botcore.commands.pr.wait import pr_wait
from botcore.config import PRConfig


def _git(repo: Path, *args: str) -> str:
    res = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return res.stdout.strip()


def _make_raw_pr(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "transport": "graphql",
        "viewer": "owner",
        "rate_limit": {"remaining": 4900, "resetAt": "2026-11-23T12:00:00Z"},
        "number": 42,
        "url": "https://github.com/acme/app/pull/42",
        "title": "Fix widget race",
        "state": "OPEN",
        "is_draft": False,
        "head_ref": "fix/widget",
        "head_sha": "aaaaaaa111111111111111111111111111111111",
        "base_ref": "main",
        "base_sha": "bbbbbbb222222222222222222222222222222222",
        "author": "owner",
        "mergeable": "MERGEABLE",
        "merge_state_status": "CLEAN",
        "is_in_merge_queue": False,
        "merge_queue_entry": None,
        "auto_merge_enabled": False,
        "files": ["src/widget.py"],
        "comments": [],
        "reviews": [
            {
                "id": "r1",
                "url": "https://github.com/acme/app/pull/42#pullrequestreview-1",
                "state": "COMMENTED",
                "body": "Looks good",
                "commit_oid": "aaaaaaa111111111111111111111111111111111",
                "author": "greptile-apps[bot]",
                "submitted_at": "2026-11-23T10:00:00Z",
            }
        ],
        "review_threads": [],
        "warnings": [],
    }
    base.update(overrides)
    return base


# ── Pure helpers ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://github.com/lushly-dev/afd.git", "lushly-dev/afd"),
        ("https://github.com/lushly-dev/afd", "lushly-dev/afd"),
        ("git@github.com:lushly-dev/afd.git", "lushly-dev/afd"),
        ("not-a-remote", None),
    ],
)
def test_parse_owner_repo(url: str, expected: str | None) -> None:
    assert parse_owner_repo(url) == expected


def test_classify_bot_and_collapse_checks() -> None:
    cfg = PRConfig()
    assert classify_bot("greptile-apps[bot]", cfg) == ("gating", "greptile")
    assert classify_bot("coderabbitai[bot]", cfg) == ("advisory", "coderabbit")
    assert classify_bot("github-actions[bot]", cfg) == ("status", "github-actions")
    assert classify_bot("alice", cfg) == ("human", None)

    collapsed = collapse_checks(
        [
            {"name": "ci", "bucket": "pass", "required": True, "url": "https://ci/1"},
            {"name": "ci", "bucket": "fail", "required": False, "url": "https://ci/2"},
            {"name": "lint", "bucket": "pass", "required": False, "url": "https://ci/3"},
        ]
    )
    assert collapsed["ci"]["bucket"] == "fail"
    assert collapsed["ci"]["required"] is True
    assert collapsed["lint"]["bucket"] == "pass"


def test_extract_credits_deduplicates_authors_and_trailers() -> None:
    commits = [
        {
            "author": {"login": "alice"},
            "commit": {
                "author": {"name": "Alice", "email": "alice@example.com"},
                "message": "feat: thing\n\nCo-authored-by: Bob <bob@example.com>\n"
                "Assisted-by: Claude Code\n",
            },
        },
        {
            "author": {"login": "alice"},
            "commit": {
                "author": {"name": "Alice", "email": "alice@example.com"},
                "message": "fix: followup\n\nCo-authored-by: Bob <bob@example.com>\n",
            },
        },
    ]
    credits = _extract_credits(commits)
    assert credits["commit_count"] == 2
    assert len(credits["authors"]) == 1
    assert credits["authors"][0]["login"] == "alice"
    assert len(credits["trailers"]) == 2


# ── pr_status ───────────────────────────────────────────────────────────────


async def test_pr_status_ready_with_graphql(tmp_path: Path) -> None:
    raw = _make_raw_pr()
    checks = {"ci": {"name": "ci", "bucket": "pass", "required": True, "url": "https://ci/1"}}

    with (
        patch("botcore.commands.pr.status.find_workspace", return_value=tmp_path),
        patch("botcore.commands.pr.status.resolve_pr_target", return_value=("acme/app", 42)),
        patch("botcore.commands.pr.status.fetch_pr_raw", return_value=raw),
        patch("botcore.commands.pr.status.fetch_checks", return_value=(checks, False)),
        patch("botcore.commands.pr.status.compute_base_overlap", return_value=([], "ccccccc")),
    ):
        data = assert_success(await pr_status(pr=42, repo="acme/app"))

    assert data["ready"] is True
    assert data["green"] is True
    assert data["gating_bot_reviewed"] is True
    assert data["transport"] == "graphql"
    assert data["blockers"] == []


async def test_pr_status_falls_back_to_rest_on_graphql_rate_limit(tmp_path: Path) -> None:
    """When GraphQL hits rate limit, fetch_pr_raw seamlessly uses REST endpoints."""
    from botcore.commands.pr.github import fetch_pr_raw

    async def fake_gh_json(_cwd: Any, *args: str, **_kwargs: Any) -> Any:
        if args[:2] == ("api", "graphql"):
            raise GhCommandError(
                "API rate limit exceeded", code="GH_RATE_LIMITED", rate_limited=True
            )
        endpoint = args[-1]
        if endpoint == "repos/acme/app/pulls/42":
            return {
                "number": 42,
                "html_url": "https://github.com/acme/app/pull/42",
                "title": "Fix",
                "state": "open",
                "merged": False,
                "draft": False,
                "mergeable": True,
                "mergeable_state": "clean",
                "head": {"ref": "fix", "sha": "aaa1111"},
                "base": {"ref": "main", "sha": "bbb2222"},
                "user": {"login": "owner"},
            }
        if endpoint.endswith("/files?per_page=100"):
            return [{"filename": "src/a.py"}]
        if endpoint == "user":
            return {"login": "owner"}
        return []

    with patch("botcore.commands.pr.github.run_gh_json", side_effect=fake_gh_json):
        raw = await fetch_pr_raw("acme/app", 42, tmp_path)

    assert raw["transport"] == "rest"
    assert raw["number"] == 42
    assert raw["files"] == ["src/a.py"]
    assert raw["is_in_merge_queue"] is None
    assert raw["review_threads_known"] is False
    assert any("REST" in w for w in raw["warnings"])


async def test_pr_status_blocks_on_blocked_merge_state_empty_checks_and_truncation(
    tmp_path: Path,
) -> None:
    from botcore.commands.pr.github import evaluate_readiness

    cfg = PRConfig(gating_bots=[])
    passing = {"ci": {"name": "ci", "bucket": "pass", "required": True, "url": ""}}

    # BLOCKED PR is never ready even when CI passes.
    blocked = evaluate_readiness(_make_raw_pr(merge_state_status="BLOCKED"), passing, {}, cfg)
    assert blocked["ready"] is False
    assert any("BLOCKED" in b for b in blocked["blockers"])

    # Empty checks are not vacuously green.
    empty = evaluate_readiness(_make_raw_pr(), {}, {}, cfg)
    assert empty["green"] is False
    assert empty["ready"] is False

    # Truncated review threads withhold ready=True.
    trunc = evaluate_readiness(
        _make_raw_pr(truncated_sections=["review_threads"]), passing, {}, cfg
    )
    assert trunc["ready"] is False
    assert any("truncated" in b for b in trunc["blockers"])

    # REST fallback (review_threads_known=False) withholds ready=True.
    rest_eval = evaluate_readiness(_make_raw_pr(review_threads_known=False), passing, {}, cfg)
    assert rest_eval["ready"] is False
    assert rest_eval["unresolved_thread_count"] is None


async def test_resolve_pr_target_default_branch_falls_back_to_rest_on_rate_limit(
    tmp_path: Path,
) -> None:
    from botcore.commands.pr.github import resolve_pr_target

    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-b", "feat/rate-limit")
    _git(repo, "config", "user.email", "dev@example.com")
    _git(repo, "config", "user.name", "Dev")
    (repo / "README.md").write_text("hi\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "init")
    _git(repo, "remote", "add", "origin", "https://github.com/acme/app.git")

    async def fake_gh_json(_cwd: Any, *args: str, **_kwargs: Any) -> Any:
        if args[:2] == ("pr", "view"):
            raise GhCommandError(
                "API rate limit exceeded", code="GH_RATE_LIMITED", rate_limited=True
            )
        if args[0] == "api" and "pulls?head=acme%3Afeat%2Frate-limit" in args[1]:
            return [{"number": 99}]
        raise AssertionError(f"Unexpected gh call: {args}")

    with patch("botcore.commands.pr.github.run_gh_json", side_effect=fake_gh_json):
        resolved_repo, num = await resolve_pr_target(None, None, repo)

    assert (resolved_repo, num) == ("acme/app", 99)


async def test_pr_wait_consistency_optional_fail_timeout_and_transport_switch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import asyncio

    # 1. Passing required check + failing optional check agrees with pr_status (ready=True -> 0).
    raw = _make_raw_pr()
    status_opt_fail = {
        "repo": "acme/app",
        "number": 42,
        "url": raw["url"],
        "state": "OPEN",
        "is_draft": False,
        "head_sha": raw["head_sha"],
        "base_ref": "main",
        "base_sha": raw["base_sha"],
        "merge_state_status": "CLEAN",
        "base_overlap_files": [],
        "checks": [
            {"name": "req", "bucket": "pass", "required": True, "url": ""},
            {"name": "opt", "bucket": "fail", "required": False, "url": ""},
        ],
        "check_counts": {"pass": 1, "fail": 1},
        "failed_checks": [{"name": "opt", "bucket": "fail", "required": False, "url": ""}],
        "gating_failed_checks": [],
        "all_checks_done": True,
        "green": True,
        "ready": True,
        "gating_bot_reviewed": True,
        "unresolved_thread_count": 0,
        "review_threads_known": True,
        "changes_requested_by": [],
        "bots": {},
    }
    with (
        patch("botcore.commands.pr.wait.find_workspace", return_value=tmp_path),
        patch("botcore.commands.pr.wait.resolve_pr_target", return_value=("acme/app", 42)),
        patch("botcore.commands.pr.wait.collect_pr_status", return_value=(status_opt_fail, raw)),
    ):
        res = assert_success(await pr_wait(pr=42, repo="acme/app", max_polls=1))
    assert res["outcome"] == "ready"
    assert res["exit_code"] == 0

    # 2. In-flight poll is bounded by timeout_seconds.
    async def slow_poll(**_kwargs: Any) -> Any:
        await asyncio.sleep(5)
        return status_opt_fail, raw

    with (
        patch("botcore.commands.pr.wait.find_workspace", return_value=tmp_path),
        patch("botcore.commands.pr.wait.resolve_pr_target", return_value=("acme/app", 42)),
        patch("botcore.commands.pr.wait.collect_pr_status", side_effect=slow_poll),
    ):
        timed = assert_success(await pr_wait(pr=42, repo="acme/app", timeout_seconds=1))
    assert timed["outcome"] == "timeout"
    assert timed["exit_code"] == 1

    # 3. Switching from GraphQL to REST preserves comment node_id so old comments aren't re-emitted.
    from botcore.commands.pr.github import fetch_pr_raw

    async def fake_rest_only(_cwd: Any, *args: str, **_kwargs: Any) -> Any:
        if args[:2] == ("api", "graphql"):
            raise GhCommandError("rate limit", code="GH_RATE_LIMITED", rate_limited=True)
        ep = args[-1]
        if ep == "repos/acme/app/pulls/42":
            return {
                "number": 42,
                "html_url": "https://github.com/acme/app/pull/42",
                "title": "Fix",
                "state": "open",
                "merged": False,
                "draft": False,
                "mergeable": True,
                "mergeable_state": "clean",
                "head": {"ref": "fix", "sha": "aaa1111"},
                "base": {"ref": "main", "sha": "bbb2222"},
                "user": {"login": "owner"},
            }
        if ep.endswith("/issues/42/comments?per_page=100"):
            return [
                [
                    {
                        "id": 999,
                        "node_id": "IC_shared_node_id",
                        "html_url": "https://github.com/acme/app/pull/42#issuecomment-999",
                        "body": "Old comment",
                        "user": {"login": "reviewer"},
                        "created_at": "2026-11-23T10:00:00Z",
                    }
                ]
            ]
        if ep == "user":
            return {"login": "owner"}
        return []

    with patch("botcore.commands.pr.github.run_gh_json", side_effect=fake_rest_only):
        rest_raw = await fetch_pr_raw("acme/app", 42, tmp_path)
    assert rest_raw["comments"][0]["id"] == "IC_shared_node_id"


async def test_pr_wait_worktrees_have_isolated_locks_and_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from botcore.commands.pr.wait import _slug_hash

    wt_a = tmp_path / "wt-a"
    wt_b = tmp_path / "wt-b"
    wt_a.mkdir()
    wt_b.mkdir()
    assert _slug_hash(wt_a, "acme/app", 42) != _slug_hash(wt_b, "acme/app", 42)


async def test_pr_drift_handles_commit_error_rest_fallback_and_option_injection(
    tmp_path: Path,
) -> None:
    # Option injection on after_rebase_from is rejected before git runs.
    assert_error(
        await pr_drift(pr=42, repo="acme/app", after_rebase_from="--output=/tmp/bad"),
        "INVALID_INPUT",
    )

    # GhCommandError during commit-credits fetch returns AFD CommandResult error (never raises).
    raw = _make_raw_pr()
    with (
        patch("botcore.commands.pr.drift.find_workspace", return_value=tmp_path),
        patch("botcore.commands.pr.drift.resolve_pr_target", return_value=("acme/app", 42)),
        patch("botcore.commands.pr.drift.fetch_pr_raw", return_value=raw),
        patch("botcore.commands.pr.drift.compute_base_overlap", return_value=([], "ccccccc")),
        patch(
            "botcore.commands.pr.drift._fetch_pr_commits",
            side_effect=GhCommandError("timeout", code="GH_TIMEOUT", transient=True),
        ),
    ):
        err_res = await pr_drift(pr=42, repo="acme/app", scan_overlapping_prs=0)
    assert_error(err_res, "GH_TIMEOUT")

    # REST compare fallback never dumps unrelated docs-only commits into touching_pr_files.
    from botcore.commands.pr.drift import _base_changes_since_divergence

    warnings_list: list[str] = []
    cmp_payload = {
        "ahead_by": 1,
        "files": [{"filename": "docs/readme.md", "status": "modified"}],
        "commits": [{"sha": "1234567890ab", "commit": {"message": ""}}],
    }
    with (
        patch("botcore.commands.pr.drift.run_git", return_value=(128, "", "not a git repo")),
        patch("botcore.commands.pr.drift.run_gh_json", return_value=cmp_payload),
    ):
        bc = await _base_changes_since_divergence(
            tmp_path, "acme/app", "1111111", "2222222", ["app.py"], warnings_list
        )
    assert bc["commits_ahead"] == 1
    assert bc["touching_pr_files"] == []
    assert bc["touching_pr_files_attributed"] is False
    assert warnings_list


# ── pr_wait ─────────────────────────────────────────────────────────────────


async def test_pr_wait_read_only_default_emits_events_and_writes_no_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    state_dir = tmp_path / "pr-state"
    monkeypatch.setenv("BOTCORE_PR_STATE", str(state_dir))

    # Poll 1: pending check + noisy status bot comment (ignored)
    raw1 = _make_raw_pr(
        reviews=[],
        comments=[
            {
                "id": "c-ci",
                "url": "https://github.com/acme/app/pull/42#issuecomment-1",
                "body": "Preview deployed",
                "author": "vercel[bot]",
                "created_at": "2026-11-23T10:00:00Z",
            }
        ],
    )
    status1 = {
        "repo": "acme/app",
        "number": 42,
        "url": raw1["url"],
        "state": "OPEN",
        "is_draft": False,
        "head_sha": raw1["head_sha"],
        "base_ref": "main",
        "base_sha": raw1["base_sha"],
        "merge_state_status": "CLEAN",
        "base_overlap_files": [],
        "checks": [{"name": "ci", "bucket": "pending", "required": True, "url": ""}],
        "check_counts": {"pending": 1},
        "failed_checks": [],
        "all_checks_done": False,
        "green": False,
        "ready": False,
        "gating_bot_reviewed": False,
        "unresolved_thread_count": 0,
        "bots": {},
    }

    # Poll 2: human comment + green + gating bot reviewed -> ready!
    raw2 = _make_raw_pr(
        comments=[
            *raw1["comments"],
            {
                "id": "c-human",
                "url": "https://github.com/acme/app/pull/42#issuecomment-2",
                "body": "Nice fix!",
                "author": "reviewer",
                "created_at": "2026-11-23T10:01:00Z",
            },
        ]
    )
    status2 = {
        **status1,
        "checks": [{"name": "ci", "bucket": "pass", "required": True, "url": ""}],
        "check_counts": {"pass": 1},
        "all_checks_done": True,
        "green": True,
        "ready": True,
        "gating_bot_reviewed": True,
        "bots": {
            "greptile": {
                "kind": "gating",
                "reviewed_head": True,
                "latest_state": "COMMENTED",
                "latest_url": "https://github.com/acme/app/pull/42#r1",
            }
        },
    }

    streamed: list[dict[str, Any]] = []
    polls = [(status1, raw1), (status2, raw2)]

    with (
        patch("botcore.commands.pr.wait.find_workspace", return_value=tmp_path),
        patch("botcore.commands.pr.wait.resolve_pr_target", return_value=("acme/app", 42)),
        patch("botcore.commands.pr.wait.collect_pr_status", side_effect=polls),
        patch("botcore.commands.pr.wait.asyncio.sleep", new_callable=AsyncMock),
    ):
        data = assert_success(
            await pr_wait(pr=42, repo="acme/app", interval=1, on_event=streamed.append)
        )

    assert data["outcome"] == "ready"
    assert data["exit_code"] == 0
    assert data["polls"] == 2
    assert any(e["kind"] == "comment" and "reviewer" in e["message"] for e in streamed)
    assert not any("vercel" in e["message"].lower() for e in streamed)
    # Default persist_state=False must not create lock or state files.
    assert not state_dir.exists()


async def test_pr_wait_persist_state_locks_against_duplicate_watcher(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from botcore.commands.disk.lock import RunLock
    from botcore.commands.pr.wait import _slug_hash

    state_dir = tmp_path / "pr-state"
    monkeypatch.setenv("BOTCORE_PR_STATE", str(state_dir))
    lock_path = state_dir / f"{_slug_hash(tmp_path, 'acme/app', 42)}.lock"

    with (
        RunLock(lock_path),
        patch("botcore.commands.pr.wait.find_workspace", return_value=tmp_path),
        patch("botcore.commands.pr.wait.resolve_pr_target", return_value=("acme/app", 42)),
    ):
        res = await pr_wait(pr=42, repo="acme/app", persist_state=True)

    assert_error(res, "PR_ALREADY_WATCHED")


async def test_pr_wait_action_needed_on_failed_check(tmp_path: Path) -> None:
    raw = _make_raw_pr()
    status = {
        "repo": "acme/app",
        "number": 42,
        "url": raw["url"],
        "state": "OPEN",
        "is_draft": False,
        "head_sha": raw["head_sha"],
        "base_ref": "main",
        "base_sha": raw["base_sha"],
        "merge_state_status": "CLEAN",
        "base_overlap_files": [],
        "checks": [{"name": "test", "bucket": "fail", "required": True, "url": "https://ci/fail"}],
        "check_counts": {"fail": 1},
        "failed_checks": [
            {"name": "test", "bucket": "fail", "required": True, "url": "https://ci/fail"}
        ],
        "all_checks_done": True,
        "green": False,
        "ready": False,
        "gating_bot_reviewed": False,
        "unresolved_thread_count": 0,
        "bots": {},
    }

    with (
        patch("botcore.commands.pr.wait.find_workspace", return_value=tmp_path),
        patch("botcore.commands.pr.wait.resolve_pr_target", return_value=("acme/app", 42)),
        patch("botcore.commands.pr.wait.collect_pr_status", return_value=(status, raw)),
    ):
        data = assert_success(await pr_wait(pr=42, repo="acme/app", max_polls=1))

    assert data["outcome"] == "action_needed"
    assert data["exit_code"] == 1


# ── pr_drift ────────────────────────────────────────────────────────────────


async def test_pr_drift_local_git_overlap_deleted_file_and_credits(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-b", "main")
    _git(repo, "config", "user.email", "dev@example.com")
    _git(repo, "config", "user.name", "Dev")
    (repo / "keep.py").write_text("v1\n", encoding="utf-8")
    (repo / "old.py").write_text("legacy\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "base")

    # Feature branch touches keep.py and old.py
    _git(repo, "checkout", "-b", "feat/x")
    (repo / "keep.py").write_text("v1-feat\n", encoding="utf-8")
    (repo / "old.py").write_text("legacy-feat\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "feat change")
    head_sha = _git(repo, "rev-parse", "HEAD")

    # Main advances: edits keep.py and deletes old.py
    _git(repo, "checkout", "main")
    (repo / "keep.py").write_text("v2-main\n", encoding="utf-8")
    (repo / "old.py").unlink()
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "main refactor")
    base_sha = _git(repo, "rev-parse", "HEAD")

    raw = _make_raw_pr(
        head_sha=head_sha,
        base_sha=base_sha,
        files=["keep.py", "old.py"],
    )

    async def fake_gh_json(_cwd: Any, *args: str, **_kwargs: Any) -> Any:
        endpoint = args[-1]
        if "/commits?per_page=100" in endpoint:
            return [
                {
                    "author": {"login": "dev"},
                    "commit": {
                        "author": {"name": "Dev", "email": "dev@example.com"},
                        "message": "feat change\n\nAssisted-by: Claude Code",
                    },
                }
            ]
        if "pulls?state=all" in endpoint:
            return [
                {
                    "number": 50,
                    "title": "Competing PR",
                    "state": "open",
                    "merged_at": None,
                    "html_url": "https://github.com/acme/app/pull/50",
                }
            ]
        if "/pulls/50/files" in endpoint:
            return [{"filename": "keep.py"}]
        return []

    with (
        patch("botcore.commands.pr.drift.find_workspace", return_value=repo),
        patch("botcore.commands.pr.drift.resolve_pr_target", return_value=("acme/app", 42)),
        patch("botcore.commands.pr.drift.fetch_pr_raw", return_value=raw),
        patch("botcore.commands.pr.drift.run_gh_json", side_effect=fake_gh_json),
        patch("botcore.commands.pr.github.run_gh_json", side_effect=fake_gh_json),
    ):
        data = assert_success(await pr_drift(pr=42, repo="acme/app"))

    assert data["base_overlap_files"] == ["keep.py", "old.py"]
    assert data["base_changes"]["commits_ahead"] == 1
    assert data["base_changes"]["deleted_or_renamed_on_base"] == [
        {"status": "deleted", "path": "old.py"}
    ]
    assert len(data["overlapping_prs"]) == 1
    assert data["overlapping_prs"][0]["number"] == 50
    assert data["credits"]["authors"][0]["login"] == "dev"
    assert data["credits"]["trailers"] == [{"key": "Assisted-by", "value": "Claude Code"}]


async def test_pr_wait_persist_state_remembers_events_across_restarts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    state_dir = tmp_path / "pr-state"
    monkeypatch.setenv("BOTCORE_PR_STATE", str(state_dir))

    raw1 = _make_raw_pr(reviews=[], comments=[])
    status1 = {
        "repo": "acme/app",
        "number": 42,
        "url": raw1["url"],
        "state": "OPEN",
        "is_draft": False,
        "head_sha": raw1["head_sha"],
        "base_ref": "main",
        "base_sha": raw1["base_sha"],
        "merge_state_status": "CLEAN",
        "base_overlap_files": [],
        "checks": [{"name": "ci", "bucket": "pending", "required": True, "url": ""}],
        "check_counts": {"pending": 1},
        "failed_checks": [],
        "all_checks_done": False,
        "green": False,
        "ready": False,
        "gating_bot_reviewed": False,
        "unresolved_thread_count": 0,
        "bots": {},
    }

    # Run 1 records baseline on disk and stops at max_polls=1.
    with (
        patch("botcore.commands.pr.wait.find_workspace", return_value=tmp_path),
        patch("botcore.commands.pr.wait.resolve_pr_target", return_value=("acme/app", 42)),
        patch("botcore.commands.pr.wait.collect_pr_status", return_value=(status1, raw1)),
    ):
        run1 = assert_success(
            await pr_wait(pr=42, repo="acme/app", max_polls=1, persist_state=True)
        )
    assert run1["outcome"] == "timeout"
    assert run1["events"] == []

    # Run 2 starts after a new comment arrived in between — watermark ensures it is reported!
    raw2 = _make_raw_pr(
        reviews=[],
        comments=[
            {
                "id": "c-between",
                "url": "https://github.com/acme/app/pull/42#issuecomment-9",
                "body": "Arrived while watcher was stopped",
                "author": "reviewer",
                "created_at": "2026-11-23T10:05:00Z",
            }
        ],
    )
    with (
        patch("botcore.commands.pr.wait.find_workspace", return_value=tmp_path),
        patch("botcore.commands.pr.wait.resolve_pr_target", return_value=("acme/app", 42)),
        patch("botcore.commands.pr.wait.collect_pr_status", return_value=(status1, raw2)),
    ):
        run2 = assert_success(
            await pr_wait(
                pr=42, repo="acme/app", until="any-change", max_polls=1, persist_state=True
            )
        )
    assert run2["outcome"] == "any_change"
    assert any("Arrived while watcher was stopped" in e["message"] for e in run2["events"])


async def test_pr_drift_after_rebase_range_diff(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-b", "main")
    _git(repo, "config", "user.email", "dev@example.com")
    _git(repo, "config", "user.name", "Dev")
    (repo / "a.py").write_text("base\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "base")

    _git(repo, "checkout", "-b", "feat/old")
    (repo / "b.py").write_text("feat\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "add b")
    old_head = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "main")
    (repo / "c.py").write_text("main\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "add c")
    new_base = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-b", "feat/new")
    (repo / "b.py").write_text("feat\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "add b")
    new_head = _git(repo, "rev-parse", "HEAD")

    raw = _make_raw_pr(head_sha=new_head, base_sha=new_base, files=["b.py"])
    with (
        patch("botcore.commands.pr.drift.find_workspace", return_value=repo),
        patch("botcore.commands.pr.drift.resolve_pr_target", return_value=("acme/app", 42)),
        patch("botcore.commands.pr.drift.fetch_pr_raw", return_value=raw),
        patch("botcore.commands.pr.drift.run_gh_json", return_value=[]),
        patch("botcore.commands.pr.github.run_gh_json", return_value=[]),
    ):
        data = assert_success(
            await pr_drift(
                pr=42,
                repo="acme/app",
                after_rebase_from=old_head,
                scan_overlapping_prs=0,
            )
        )

    assert data["range_diff"]["available"] is True
    assert any("add b" in line for line in data["range_diff"]["lines"])
