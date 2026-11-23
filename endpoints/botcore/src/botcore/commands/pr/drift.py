"""Read-only PR staleness, base-drift, competing-PR, and handoff gatherer."""

from __future__ import annotations

import re
import urllib.parse
from pathlib import Path
from typing import Any

from afd import CommandResult, error, success
from afd.core.metadata import Warning as AfdWarning

from botcore.commands.pr.github import (
    GhCommandError,
    compute_base_overlap,
    fetch_pr_raw,
    resolve_pr_target,
    run_gh_json,
    run_gh_rest_list,
    run_git,
)
from botcore.utils.workspace import find_workspace

TRAILER_RE = re.compile(
    r"^(Co-authored-by|Assisted-by|Signed-off-by|Reviewed-by):\s*(.+)$",
    re.IGNORECASE | re.MULTILINE,
)


def _is_safe_git_ref(ref: str) -> bool:
    """Reject empty refs or leading '-' to prevent git option injection."""
    return bool(ref) and not ref.startswith("-")


async def _resolve_commit_oid(cwd: Path, ref: str) -> tuple[str | None, str | None]:
    if not _is_safe_git_ref(ref):
        return None, f"Invalid git ref {ref!r}: refs may not be empty or start with '-'"
    rc, out, err = await run_git(
        cwd, "rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}"
    )
    if rc != 0:
        return None, err or f"Unknown commit ref {ref!r}"
    oid = out.strip()
    return (oid, None) if oid else (None, f"Empty commit OID for {ref!r}")


async def _fetch_pr_commits(repo: str, number: int, cwd: Path) -> list[dict[str, Any]]:
    """Fetch every page of PR commits via REST to collect authors and credit trailers."""
    return await run_gh_rest_list(cwd, f"repos/{repo}/pulls/{number}/commits?per_page=100")


def _extract_credits(commits: list[dict[str, Any]]) -> dict[str, Any]:
    """Extract unique commit authors and attribution trailers from PR commits."""
    authors: list[dict[str, str]] = []
    seen_authors: set[tuple[str, str]] = set()
    trailers: list[dict[str, str]] = []
    seen_trailers: set[tuple[str, str]] = set()

    for item in commits:
        commit = item.get("commit") or {}
        author_obj = commit.get("author") or {}
        name = str(author_obj.get("name") or "")
        email = str(author_obj.get("email") or "")
        login = str((item.get("author") or {}).get("login") or "")
        key = (name, email)
        if (name or email) and key not in seen_authors:
            seen_authors.add(key)
            authors.append({"name": name, "email": email, "login": login})

        message = str(commit.get("message") or "")
        for match in TRAILER_RE.finditer(message):
            t_key = match.group(1)
            t_val = match.group(2).strip()
            pair = (t_key.lower(), t_val)
            if pair not in seen_trailers:
                seen_trailers.add(pair)
                trailers.append({"key": t_key, "value": t_val})

    return {"authors": authors, "trailers": trailers, "commit_count": len(commits)}


async def _base_changes_since_divergence(
    cwd: Path,
    repo: str,
    merge_base: str | None,
    base_sha: str,
    pr_files: list[str],
    warnings_list: list[str],
) -> dict[str, Any]:
    """Find commits on base since merge_base, highlighting file overlaps and deletions."""
    pr_set = set(pr_files)
    if not merge_base or not base_sha or merge_base == base_sha:
        return {
            "commits_ahead": 0,
            "touching_pr_files": [],
            "touching_pr_files_attributed": True,
            "deleted_or_renamed_on_base": [],
        }

    # Try local git first (read-only).
    rc_count, out_count, _ = await run_git(cwd, "rev-list", "--count", f"{merge_base}..{base_sha}")
    if rc_count == 0 and out_count.strip().isdigit():
        ahead = int(out_count.strip())
        touching: list[dict[str, str]] = []
        if pr_files:
            rc_log, out_log, _ = await run_git(
                cwd,
                "log",
                "--format=%H%x09%s",
                "-n",
                "50",
                f"{merge_base}..{base_sha}",
                "--",
                *pr_files,
            )
            if rc_log == 0:
                for line in out_log.splitlines():
                    sha, _, subject = line.partition("\t")
                    if sha:
                        touching.append({"sha": sha[:12], "subject": subject})

        deleted_or_renamed: list[dict[str, str]] = []
        rc_ns, out_ns, _ = await run_git(cwd, "diff", "--name-status", f"{merge_base}..{base_sha}")
        if rc_ns == 0:
            for line in out_ns.splitlines():
                parts = line.split("\t")
                if len(parts) < 2:
                    continue
                status_code = parts[0]
                old_path = parts[1]
                if status_code.startswith("D") and old_path in pr_set:
                    deleted_or_renamed.append({"status": "deleted", "path": old_path})
                elif status_code.startswith("R") and old_path in pr_set:
                    deleted_or_renamed.append(
                        {
                            "status": "renamed",
                            "path": old_path,
                            "new_path": parts[2] if len(parts) > 2 else "",
                        }
                    )

        return {
            "commits_ahead": ahead,
            "touching_pr_files": touching,
            "touching_pr_files_attributed": True,
            "deleted_or_renamed_on_base": deleted_or_renamed,
        }

    # Fallback to GitHub compare API. The compare endpoint lists aggregate files and commits
    # without per-commit file paths, so we never attribute unrelated commits to PR files.
    try:
        cmp_data = await run_gh_json(cwd, "api", f"repos/{repo}/compare/{merge_base}...{base_sha}")
    except GhCommandError:
        return {
            "commits_ahead": None,
            "touching_pr_files": [],
            "touching_pr_files_attributed": False,
            "deleted_or_renamed_on_base": [],
        }

    deleted_or_renamed = []
    for f in cmp_data.get("files") or []:
        if not isinstance(f, dict):
            continue
        fname = f.get("filename") or ""
        prev = f.get("previous_filename") or ""
        st = f.get("status") or ""
        if st == "removed" and fname in pr_set:
            deleted_or_renamed.append({"status": "deleted", "path": fname})
        elif st == "renamed" and prev in pr_set:
            deleted_or_renamed.append({"status": "renamed", "path": prev, "new_path": fname})

    commits = cmp_data.get("commits") or []
    ahead_by = int(cmp_data.get("ahead_by", len(commits)))
    if ahead_by > 0 and pr_files:
        warnings_list.append(
            "Local git commits unavailable; per-commit touching_pr_files attribution skipped "
            "(pass fetch=True or fetch base locally for commit-level attribution)"
        )
    return {
        "commits_ahead": ahead_by,
        "touching_pr_files": [],
        "touching_pr_files_attributed": False,
        "deleted_or_renamed_on_base": deleted_or_renamed,
    }


async def _find_overlapping_prs(
    cwd: Path,
    repo: str,
    pr_number: int,
    base_ref: str,
    pr_files: list[str],
    limit: int,
) -> list[dict[str, Any]]:
    """Find recent open or merged PRs targeting base_ref that touch any of pr_files."""
    if not pr_files or limit <= 0:
        return []
    pr_set = set(pr_files)
    encoded_base = urllib.parse.quote(base_ref, safe="")
    try:
        candidates = await run_gh_json(
            cwd,
            "api",
            f"repos/{repo}/pulls?state=all&base={encoded_base}&sort=updated&direction=desc"
            f"&per_page={min(limit, 30)}",
        )
    except GhCommandError:
        return []

    overlaps: list[dict[str, Any]] = []
    for cand in candidates if isinstance(candidates, list) else []:
        num = cand.get("number")
        if not isinstance(num, int) or num == pr_number:
            continue
        state = "MERGED" if cand.get("merged_at") else str(cand.get("state") or "").upper()
        if state == "CLOSED":
            continue
        try:
            cand_files = await run_gh_rest_list(cwd, f"repos/{repo}/pulls/{num}/files?per_page=100")
        except GhCommandError:
            continue
        shared = sorted(pr_set & {f["filename"] for f in cand_files if f.get("filename")})
        if shared:
            overlaps.append(
                {
                    "number": num,
                    "title": cand.get("title") or "",
                    "state": state,
                    "url": cand.get("html_url") or "",
                    "overlapping_files": shared,
                }
            )
    return overlaps


async def _compute_range_diff(
    cwd: Path,
    old_head: str,
    new_head: str,
    base_ref: str,
) -> dict[str, Any]:
    """Compute a read-only ``git range-diff`` summary after a rebase."""
    old_oid, old_err = await _resolve_commit_oid(cwd, old_head)
    if old_err or not old_oid:
        return {
            "available": False,
            "error": old_err or "Invalid after_rebase_from ref",
            "lines": [],
        }
    new_oid, new_err = await _resolve_commit_oid(cwd, new_head)
    if new_err or not new_oid:
        return {"available": False, "error": new_err or "Invalid head ref", "lines": []}
    base_oid, base_err = await _resolve_commit_oid(cwd, base_ref)
    if base_err or not base_oid:
        return {"available": False, "error": base_err or "Invalid base ref", "lines": []}

    rc_old_mb, out_old_mb, _ = await run_git(cwd, "merge-base", base_oid, old_oid)
    rc_new_mb, out_new_mb, _ = await run_git(cwd, "merge-base", base_oid, new_oid)
    old_base = out_old_mb.strip() if rc_old_mb == 0 and out_old_mb.strip() else base_oid
    new_base = out_new_mb.strip() if rc_new_mb == 0 and out_new_mb.strip() else base_oid

    rc, out, err = await run_git(
        cwd,
        "range-diff",
        "--no-color",
        "--no-patch",
        f"{old_base}..{old_oid}",
        f"{new_base}..{new_oid}",
    )
    if rc != 0:
        return {"available": False, "error": err or "git range-diff failed", "lines": []}
    lines = [line for line in out.splitlines() if line.strip()]
    return {
        "available": True,
        "old_range": f"{old_base[:12]}..{old_oid[:12]}",
        "new_range": f"{new_base[:12]}..{new_oid[:12]}",
        "lines": lines,
    }


async def pr_drift(  # noqa: PLR0913 - structured inspection knobs
    pr: int | str | None = None,
    repo: str | None = None,
    fetch: bool = False,
    after_rebase_from: str | None = None,
    scan_overlapping_prs: int = 10,
) -> CommandResult[dict[str, Any]]:
    """Gather PR staleness, base-branch drift, overlapping PRs, and author credits.

    Read-only by default (``fetch=False`` makes no local git ref changes).

    Args:
        pr: Pull request number, URL, or None for the current branch's PR.
        repo: Repository slug (owner/name); inferred from PR URL or git origin when omitted.
        fetch: When True, run ``git fetch --no-tags origin`` for the base ref before analysis.
        after_rebase_from: Prior pre-rebase head SHA to summarize with ``git range-diff``.
        scan_overlapping_prs: Number of recent open/merged PRs to check for file overlap (0 skips).
    """
    if scan_overlapping_prs < 0:
        return error(
            "INVALID_INPUT",
            f"scan_overlapping_prs must be >= 0, got {scan_overlapping_prs}",
            suggestion="Pass 0 to skip or a positive integer up to 30",
        )
    if after_rebase_from is not None and not _is_safe_git_ref(after_rebase_from):
        return error(
            "INVALID_INPUT",
            f"Invalid after_rebase_from ref {after_rebase_from!r}",
            suggestion="Pass a commit SHA or branch ref that does not start with '-'",
        )

    ws = find_workspace() or Path.cwd()
    try:
        resolved_repo, number = await resolve_pr_target(pr, repo, ws)
        raw = await fetch_pr_raw(resolved_repo, number, ws)
        warnings_list = list(raw.get("warnings", []))

        if fetch and raw["base_ref"]:
            if not _is_safe_git_ref(raw["base_ref"]):
                warnings_list.append(f"Skipped unsafe base ref name: {raw['base_ref']!r}")
            else:
                rc_fetch, _, err_fetch = await run_git(
                    ws, "fetch", "--no-tags", "origin", "--", raw["base_ref"]
                )
                if rc_fetch != 0:
                    warnings_list.append(f"git fetch origin {raw['base_ref']} failed: {err_fetch}")

        overlap_files, merge_base = await compute_base_overlap(
            ws, resolved_repo, raw["base_sha"], raw["head_sha"], raw["files"]
        )
        base_changes = await _base_changes_since_divergence(
            ws, resolved_repo, merge_base, raw["base_sha"], raw["files"], warnings_list
        )
        commits = await _fetch_pr_commits(resolved_repo, number, ws)
        credits = _extract_credits(commits)
        overlapping_prs = await _find_overlapping_prs(
            ws, resolved_repo, number, raw["base_ref"], raw["files"], scan_overlapping_prs
        )
    except GhCommandError as exc:
        suggestion = (
            "Install and authenticate GitHub CLI (`gh auth status`)"
            if exc.code == "TOOL_NOT_FOUND"
            else "Check the PR number, repository slug, network, and `gh auth status`"
        )
        return error(exc.code, str(exc), suggestion=suggestion)

    range_diff: dict[str, Any] | None = None
    if after_rebase_from:
        range_diff = await _compute_range_diff(
            ws, after_rebase_from, raw["head_sha"] or "HEAD", raw["base_sha"] or raw["base_ref"]
        )

    data: dict[str, Any] = {
        "repo": resolved_repo,
        "number": raw["number"],
        "url": raw["url"],
        "title": raw["title"],
        "state": raw["state"],
        "is_draft": raw["is_draft"],
        "author": raw["author"],
        "base_ref": raw["base_ref"],
        "base_sha": raw["base_sha"],
        "head_ref": raw["head_ref"],
        "head_sha": raw["head_sha"],
        "merge_base": merge_base,
        "mergeable": raw["mergeable"],
        "merge_state_status": raw["merge_state_status"],
        "pr_files": raw["files"],
        "base_overlap_files": overlap_files,
        "base_changes": base_changes,
        "overlapping_prs": overlapping_prs,
        "credits": credits,
        "range_diff": range_diff,
        "transport": raw["transport"],
        "warnings": warnings_list,
    }

    afd_warnings = [AfdWarning(code="PR_DRIFT_WARNING", message=msg) for msg in warnings_list]
    ahead = base_changes.get("commits_ahead")
    reasoning = (
        f"{resolved_repo}#{number}: {ahead if ahead is not None else '?'} commit(s) on "
        f"{raw['base_ref']} since divergence, {len(overlap_files)} overlapping file(s), "
        f"{len(overlapping_prs)} overlapping PR(s)"
    )
    return success(data=data, reasoning=reasoning, warnings=afd_warnings or None)
