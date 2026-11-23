"""Read-only pull request readiness, merge-queue, and check status command."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from afd import CommandResult, error, success
from afd.core.metadata import Warning as AfdWarning

from botcore.commands.pr.github import (
    GhCommandError,
    compute_base_overlap,
    evaluate_readiness,
    fetch_checks,
    fetch_pr_raw,
    resolve_pr_target,
    summarize_bots,
)
from botcore.config import load_config
from botcore.utils.workspace import find_workspace


async def collect_pr_status(
    pr: int | str | None = None,
    repo: str | None = None,
    cwd: Path | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Fetch PR state and compute readiness summary. Returns (status_data, raw_pr)."""
    ws = cwd or find_workspace() or Path.cwd()
    config = load_config(workspace=ws)
    pr_config = config.pr

    resolved_repo, number = await resolve_pr_target(pr, repo, ws)
    raw = await fetch_pr_raw(resolved_repo, number, ws)
    used_rest_pr = raw["transport"] == "rest"
    checks, used_rest_checks = await fetch_checks(
        resolved_repo,
        number,
        raw["head_sha"],
        ws,
        prefer_rest=used_rest_pr,
        rollup_checks=raw.get("rollup_checks"),
    )
    bots = summarize_bots(raw, pr_config)
    readiness = evaluate_readiness(raw, checks, bots, pr_config)
    overlap_files, merge_base = await compute_base_overlap(
        ws,
        resolved_repo,
        raw["base_sha"],
        raw["head_sha"],
        raw["files"],
    )

    warnings_list = list(raw.get("warnings", []))
    if used_rest_checks and not used_rest_pr:
        warnings_list.append(
            "Check runs loaded via REST fallback; required-check flags unavailable"
        )

    data: dict[str, Any] = {
        "repo": resolved_repo,
        "number": raw["number"],
        "url": raw["url"],
        "title": raw["title"],
        "state": raw["state"],
        "is_draft": raw["is_draft"],
        "author": raw["author"],
        "head_ref": raw["head_ref"],
        "head_sha": raw["head_sha"],
        "base_ref": raw["base_ref"],
        "base_sha": raw["base_sha"],
        "merge_base": merge_base,
        "mergeable": raw["mergeable"],
        "merge_state_status": raw["merge_state_status"],
        "is_in_merge_queue": raw["is_in_merge_queue"],
        "merge_queue_entry": raw["merge_queue_entry"],
        "auto_merge_enabled": raw["auto_merge_enabled"],
        "base_overlap_files": overlap_files,
        "checks": sorted(checks.values(), key=lambda c: c["name"]),
        "bots": bots,
        "transport": "rest" if (used_rest_pr or used_rest_checks) else "graphql",
        "rate_limit": raw.get("rate_limit"),
        "warnings": warnings_list,
        **readiness,
    }
    return data, raw


async def pr_status(
    pr: int | str | None = None,
    repo: str | None = None,
) -> CommandResult[dict[str, Any]]:
    """Inspect a pull request's checks, bots, merge queue, and readiness. Read-only.

    Args:
        pr: Pull request number, URL, or None for the current branch's PR.
        repo: Repository slug (owner/name); inferred from PR URL or git origin when omitted.
    """
    ws = find_workspace() or Path.cwd()
    try:
        data, _ = await collect_pr_status(pr=pr, repo=repo, cwd=ws)
    except GhCommandError as exc:
        suggestion = (
            "Install and authenticate GitHub CLI (`gh auth status`)"
            if exc.code == "TOOL_NOT_FOUND"
            else "Check the PR number, repository slug, and `gh auth status`"
        )
        return error(exc.code, str(exc), suggestion=suggestion)

    afd_warnings = [AfdWarning(code="PR_STATUS_WARNING", message=msg) for msg in data["warnings"]]
    summary_msg = f"{data['repo']}#{data['number']} ({data['state']}): " + (
        "ready" if data["ready"] else "; ".join(data["blockers"]) or "not ready"
    )
    return success(
        data=data,
        reasoning=summary_msg,
        warnings=afd_warnings or None,
    )
