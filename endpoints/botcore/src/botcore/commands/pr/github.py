"""Shared read-only GitHub and git helpers for the pr-* commands.

All reads prefer GraphQL via ``gh api graphql`` for single-request fidelity (merge queue,
review thread resolution, atomic head-pinned check rollup) and automatically fall back to
GitHub REST when the GraphQL rate limit is exhausted.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import urllib.parse
from pathlib import Path
from typing import Any

from botcore.config import PRConfig

_GH_TIMEOUT = 60.0
_GIT_TIMEOUT = 60.0

PR_URL_RE = re.compile(r"https?://[^/]+/([^/\s]+/[^/\s]+)/pull/(\d+)")
REPO_SSH_RE = re.compile(r"[:/]([^/\s:]+/[^/\s]+?)(?:\.git)?$")
OWNER_REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")

TRANSIENT_RE = re.compile(
    r"HTTP (5\d\d|429)|rate limit|timed? ?out|connection (reset|refused)|EOF|"
    r"temporar|could not resolve host|TLS handshake|Something went wrong",
    re.IGNORECASE,
)
RATE_LIMIT_RE = re.compile(
    r"rate limit|API rate limit exceeded|RESOURCE_LIMITS_EXCEEDED|HTTP 403.*rate|HTTP 429",
    re.IGNORECASE,
)

FAILED_BUCKETS = ("fail", "cancel")
BUCKET_RANK = {"fail": 4, "cancel": 3, "pending": 2, "pass": 1, "skipping": 0}

PR_GRAPHQL_QUERY = """
query($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  rateLimit { remaining resetAt }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      url
      title
      state
      isDraft
      headRefName
      headRefOid
      baseRefName
      mergeable
      mergeStateStatus
      isInMergeQueue
      mergeQueueEntry { state position }
      autoMergeRequest { enabledAt }
      author { login }
      baseRef { target { oid } }
      commits(last: 1) {
        nodes {
          commit {
            oid
            statusCheckRollup {
              contexts(first: 100) {
                pageInfo { hasNextPage }
                nodes {
                  __typename
                  ... on CheckRun {
                    name
                    status
                    conclusion
                    detailsUrl
                    isRequired(pullRequestNumber: $number)
                  }
                  ... on StatusContext {
                    context
                    state
                    targetUrl
                    isRequired(pullRequestNumber: $number)
                  }
                }
              }
            }
          }
        }
      }
      files(first: 100) {
        pageInfo { hasNextPage }
        nodes { path }
      }
      comments(last: 100) {
        pageInfo { hasPreviousPage }
        nodes { id url body createdAt author { login __typename } }
      }
      reviews(last: 100) {
        pageInfo { hasPreviousPage }
        nodes { id url state body submittedAt commit { oid } author { login __typename } }
      }
      reviewThreads(last: 100) {
        pageInfo { hasPreviousPage }
        nodes {
          id
          isResolved
          path
          line
          comments(first: 100) {
            pageInfo { hasNextPage }
            nodes { id url body createdAt author { login __typename } }
          }
        }
      }
    }
  }
}
"""


class GhCommandError(Exception):
    """Error running a ``gh`` CLI call."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "GH_FAILED",
        transient: bool = False,
        rate_limited: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.transient = transient
        self.rate_limited = rate_limited


def _git_env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["LC_ALL"] = "C"
    env["GIT_OPTIONAL_LOCKS"] = "0"
    env["GIT_TERMINAL_PROMPT"] = "0"
    return env


async def run_git(cwd: Path, *args: str, timeout: float = _GIT_TIMEOUT) -> tuple[int, str, str]:
    """Run git in cwd with read-only defaults and return (returncode, stdout, stderr)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "git",
            "-C",
            str(cwd),
            *args,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_git_env(),
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except TimeoutError:
            proc.kill()
            await proc.communicate()
            return -1, "", f"git timed out after {timeout:.0f}s"
        except asyncio.CancelledError:
            proc.kill()
            await proc.communicate()
            raise
    except FileNotFoundError:
        return -2, "", "git executable not found on PATH"
    except OSError as exc:
        return -1, "", str(exc)

    return (
        proc.returncode or 0,
        out.decode("utf-8", errors="replace"),
        err.decode("utf-8", errors="replace").strip(),
    )


async def run_gh(cwd: Path | None, *args: str, timeout: float = _GH_TIMEOUT) -> str:
    """Run ``gh`` and return stdout, raising GhCommandError on failure."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "gh",
            *args,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except TimeoutError:
            proc.kill()
            await proc.communicate()
            raise GhCommandError(
                f"gh {' '.join(args[:3])} timed out after {timeout:.0f}s",
                code="GH_TIMEOUT",
                transient=True,
            )
        except asyncio.CancelledError:
            proc.kill()
            await proc.communicate()
            raise
    except FileNotFoundError as exc:
        raise GhCommandError(
            "gh CLI is not installed or not on PATH",
            code="TOOL_NOT_FOUND",
        ) from exc
    except OSError as exc:
        raise GhCommandError(str(exc), code="GH_FAILED") from exc

    stdout_text = out.decode("utf-8", errors="replace")
    stderr_text = err.decode("utf-8", errors="replace").strip()
    if proc.returncode != 0:
        msg = stderr_text or stdout_text.strip() or f"gh exited with {proc.returncode}"
        raise GhCommandError(
            msg,
            code="GH_RATE_LIMITED" if RATE_LIMIT_RE.search(msg) else "GH_FAILED",
            transient=bool(TRANSIENT_RE.search(msg)),
            rate_limited=bool(RATE_LIMIT_RE.search(msg)),
        )
    return stdout_text


async def run_gh_json(cwd: Path | None, *args: str, timeout: float = _GH_TIMEOUT) -> Any:
    """Run ``gh`` and parse JSON stdout."""
    raw = await run_gh(cwd, *args, timeout=timeout)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise GhCommandError(f"Invalid JSON from gh: {exc}", code="GH_INVALID_JSON") from exc


async def run_gh_rest_list(
    cwd: Path | None, endpoint: str, *, timeout: float = _GH_TIMEOUT
) -> list[dict[str, Any]]:
    """Fetch every page of a REST list endpoint via ``gh api --paginate --slurp``."""
    data = await run_gh_json(cwd, "api", "--paginate", "--slurp", endpoint, timeout=timeout)
    if not isinstance(data, list):
        return []
    items: list[dict[str, Any]] = []
    for entry in data:
        if isinstance(entry, list):
            items.extend(item for item in entry if isinstance(item, dict))
        elif isinstance(entry, dict):
            items.append(entry)
    return items


def parse_owner_repo(remote_url: str) -> str | None:
    """Extract ``owner/name`` from an HTTPS or SSH git remote URL."""
    match = REPO_SSH_RE.search(remote_url.strip())
    if not match:
        return None
    slug = match.group(1).strip("/")
    return slug if OWNER_REPO_RE.match(slug) else None


async def _resolve_branch_pr_rest(repo: str, cwd: Path) -> int:
    """Resolve the current branch's open PR number via REST (GraphQL-free)."""
    rc, branch_out, err = await run_git(cwd, "rev-parse", "--abbrev-ref", "HEAD")
    branch = branch_out.strip()
    if rc != 0 or not branch or branch == "HEAD":
        raise GhCommandError(
            f"Cannot infer current branch PR (detached HEAD or git error: {err})",
            code="PR_NOT_FOUND",
        )
    owner = repo.split("/", 1)[0]
    head_query = urllib.parse.quote(f"{owner}:{branch}", safe="")
    pulls = await run_gh_json(
        cwd,
        "api",
        f"repos/{repo}/pulls?head={head_query}&state=open&per_page=10",
    )
    if isinstance(pulls, list) and pulls:
        return int(pulls[0]["number"])
    raise GhCommandError(
        f"No open pull request found for branch {branch!r} in {repo}",
        code="PR_NOT_FOUND",
    )


async def resolve_pr_target(
    pr: int | str | None,
    repo: str | None,
    cwd: Path,
) -> tuple[str, int]:
    """Resolve (owner/name, pr_number) from explicit input, URL, or current branch."""
    resolved_repo = repo
    resolved_num: int | None = None

    if isinstance(pr, int):
        if pr <= 0:
            raise GhCommandError(f"PR number must be positive, got {pr}", code="INVALID_INPUT")
        resolved_num = pr
    elif isinstance(pr, str) and pr.strip():
        text = pr.strip()
        url_match = PR_URL_RE.search(text)
        if url_match:
            resolved_repo = resolved_repo or url_match.group(1)
            resolved_num = int(url_match.group(2))
        else:
            digits = text.lstrip("#")
            if not digits.isdigit() or int(digits) <= 0:
                raise GhCommandError(
                    f"Invalid PR identifier {pr!r}: pass a PR number or GitHub PR URL",
                    code="INVALID_INPUT",
                )
            resolved_num = int(digits)

    if not resolved_repo:
        rc, out, _ = await run_git(cwd, "remote", "get-url", "origin")
        if rc == 0:
            resolved_repo = parse_owner_repo(out)

    if resolved_num is None:
        try:
            data = await run_gh_json(cwd, "pr", "view", "--json", "number,url")
            resolved_num = int(data["number"])
            url_match = PR_URL_RE.search(str(data.get("url", "")))
            if url_match and not resolved_repo:
                resolved_repo = url_match.group(1)
        except GhCommandError as exc:
            if exc.rate_limited and resolved_repo:
                resolved_num = await _resolve_branch_pr_rest(resolved_repo, cwd)
            else:
                raise

    if not resolved_repo:
        data = await run_gh_json(cwd, "repo", "view", "--json", "nameWithOwner")
        resolved_repo = str(data["nameWithOwner"])

    if not OWNER_REPO_RE.match(resolved_repo):
        raise GhCommandError(
            f"Invalid repository slug {resolved_repo!r}; expected owner/name",
            code="INVALID_INPUT",
        )
    return resolved_repo, resolved_num


def classify_bot(login: str | None, pr_config: PRConfig) -> tuple[str, str | None]:
    """Classify a GitHub login into (kind, matched_bot_name).

    Returns one of: ("gating", name), ("advisory", name), ("status", name), ("human", None).
    """
    if not login:
        return "human", None
    norm = login.lower().removesuffix("[bot]")
    for bot in pr_config.gating_bots:
        if bot.lower() in norm:
            return "gating", bot.lower()
    for bot in pr_config.advisory_bots:
        if bot.lower() in norm:
            return "advisory", bot.lower()
    for bot in pr_config.status_bots:
        if bot.lower() in norm:
            return "status", bot.lower()
    return "human", None


def normalize_check_bucket(status: str | None, conclusion: str | None) -> str:
    """Map GitHub check-run / status state to a unified bucket."""
    st = (status or "").lower()
    conc = (conclusion or "").lower()
    if st in ("queued", "in_progress", "waiting", "pending", "requested"):
        return "pending"
    if conc in ("failure", "timed_out", "action_required", "startup_failure", "stale"):
        return "fail"
    if conc in ("cancelled", "canceled"):
        return "cancel"
    if conc in ("success", "neutral"):
        return "pass"
    if conc in ("skipped",):
        return "skipping"
    if st == "success":
        return "pass"
    if st in ("failure", "error"):
        return "fail"
    return "pending"


def collapse_checks(checks: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Deduplicate checks by name, keeping the worst bucket (fail > cancel > pending > pass)."""
    collapsed: dict[str, dict[str, Any]] = {}
    for entry in checks:
        name = str(entry.get("name") or "unnamed")
        bucket = str(entry.get("bucket") or "pending")
        existing = collapsed.get(name)
        is_required = bool(entry.get("required", False)) or (
            bool(existing["required"]) if existing is not None else False
        )
        if existing is None or BUCKET_RANK.get(bucket, 0) > BUCKET_RANK.get(existing["bucket"], 0):
            collapsed[name] = {
                "name": name,
                "bucket": bucket,
                "required": is_required,
                "url": entry.get("url") or "",
            }
        else:
            existing["required"] = is_required
    return collapsed


def _extract_rollup_checks(pr_node: dict[str, Any]) -> tuple[list[dict[str, Any]] | None, bool]:
    """Extract head-pinned checks from GraphQL statusCheckRollup.

    Returns (checks_list_or_None, has_next_page).
    """
    head_sha = pr_node.get("headRefOid") or ""
    commit_nodes = (pr_node.get("commits") or {}).get("nodes") or []
    if not commit_nodes:
        return None, False
    commit = (commit_nodes[-1] or {}).get("commit") or {}
    if head_sha and commit.get("oid") and commit.get("oid") != head_sha:
        return None, False
    rollup = commit.get("statusCheckRollup")
    if rollup is None:
        return [], False
    contexts = rollup.get("contexts") or {}
    has_more = bool((contexts.get("pageInfo") or {}).get("hasNextPage", False))
    parsed: list[dict[str, Any]] = []
    for node in contexts.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        typename = node.get("__typename")
        if typename == "CheckRun":
            parsed.append(
                {
                    "name": node.get("name") or "unnamed",
                    "bucket": normalize_check_bucket(node.get("status"), node.get("conclusion")),
                    "required": bool(node.get("isRequired", False)),
                    "url": node.get("detailsUrl") or "",
                }
            )
        elif typename == "StatusContext":
            parsed.append(
                {
                    "name": node.get("context") or "status",
                    "bucket": normalize_check_bucket(node.get("state"), None),
                    "required": bool(node.get("isRequired", False)),
                    "url": node.get("targetUrl") or "",
                }
            )
    return parsed, has_more


async def fetch_checks_rest(
    repo: str,
    head_sha: str,
    cwd: Path,
) -> list[dict[str, Any]]:
    """Read check runs and commit statuses for head_sha via GitHub REST (GraphQL-free)."""
    checks: list[dict[str, Any]] = []
    if not head_sha:
        return checks
    pages = await run_gh_json(
        cwd,
        "api",
        "--paginate",
        "--slurp",
        f"repos/{repo}/commits/{head_sha}/check-runs?per_page=100",
    )
    run_pages = pages if isinstance(pages, list) else [pages]
    for page in run_pages:
        if not isinstance(page, dict):
            continue
        for run in page.get("check_runs", []):
            checks.append(
                {
                    "name": run.get("name", "unnamed"),
                    "bucket": normalize_check_bucket(run.get("status"), run.get("conclusion")),
                    "required": False,
                    "url": run.get("html_url") or run.get("details_url") or "",
                }
            )
    try:
        status_data = await run_gh_json(cwd, "api", f"repos/{repo}/commits/{head_sha}/status")
        for item in status_data.get("statuses", []):
            checks.append(
                {
                    "name": item.get("context", "status"),
                    "bucket": normalize_check_bucket(item.get("state"), None),
                    "required": False,
                    "url": item.get("target_url") or "",
                }
            )
    except GhCommandError:
        pass
    return checks


async def fetch_checks(
    repo: str,
    number: int,
    head_sha: str,
    cwd: Path,
    *,
    prefer_rest: bool = False,
    rollup_checks: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, dict[str, Any]], bool]:
    """Resolve PR checks pinned to head_sha, using atomic GraphQL rollup or REST fallback.

    Returns (collapsed_checks, used_rest).
    """
    if rollup_checks is not None and not prefer_rest:
        return collapse_checks(rollup_checks), False

    rest_checks = await fetch_checks_rest(repo, head_sha, cwd)
    return collapse_checks(rest_checks), True


async def _fetch_pr_rest(repo: str, number: int, cwd: Path) -> dict[str, Any]:
    """Fetch PR details purely over GitHub REST APIs (GraphQL rate-limit fallback).

    Uses GraphQL-compatible ``node_id``s so watermarks survive GraphQL <-> REST switches,
    and marks merge-queue and thread-resolution state as unknown rather than fabricating False.
    """
    pr_obj = await run_gh_json(cwd, "api", f"repos/{repo}/pulls/{number}")
    files_raw = await run_gh_rest_list(cwd, f"repos/{repo}/pulls/{number}/files?per_page=100")
    reviews_raw = await run_gh_rest_list(cwd, f"repos/{repo}/pulls/{number}/reviews?per_page=100")
    comments_raw = await run_gh_rest_list(
        cwd, f"repos/{repo}/issues/{number}/comments?per_page=100"
    )
    review_comments_raw = await run_gh_rest_list(
        cwd, f"repos/{repo}/pulls/{number}/comments?per_page=100"
    )

    viewer_login = ""
    try:
        viewer = await run_gh_json(cwd, "api", "user")
        viewer_login = str(viewer.get("login") or "")
    except GhCommandError:
        pass

    mergeable_bool = pr_obj.get("mergeable")
    mergeable_state = str(pr_obj.get("mergeable_state") or "unknown").upper()
    mergeable = (
        "MERGEABLE"
        if mergeable_bool is True
        else ("CONFLICTING" if mergeable_bool is False else "UNKNOWN")
    )
    state = "MERGED" if pr_obj.get("merged") else str(pr_obj.get("state") or "open").upper()

    return {
        "transport": "rest",
        "viewer": viewer_login,
        "rate_limit": None,
        "number": int(pr_obj["number"]),
        "url": pr_obj.get("html_url") or "",
        "title": pr_obj.get("title") or "",
        "state": state,
        "is_draft": bool(pr_obj.get("draft", False)),
        "head_ref": (pr_obj.get("head") or {}).get("ref") or "",
        "head_sha": (pr_obj.get("head") or {}).get("sha") or "",
        "base_ref": (pr_obj.get("base") or {}).get("ref") or "",
        "base_sha": (pr_obj.get("base") or {}).get("sha") or "",
        "author": (pr_obj.get("user") or {}).get("login") or "",
        "mergeable": mergeable,
        "merge_state_status": mergeable_state,
        "is_in_merge_queue": None,
        "merge_queue_entry": None,
        "auto_merge_enabled": pr_obj.get("auto_merge") is not None,
        "files": [f["filename"] for f in files_raw if f.get("filename")],
        "rollup_checks": None,
        "review_threads_known": False,
        "truncated_sections": [],
        "comments": [
            {
                "id": str(c.get("node_id") or c.get("id") or ""),
                "url": c.get("html_url") or "",
                "body": c.get("body") or "",
                "author": (c.get("user") or {}).get("login") or "",
                "created_at": c.get("created_at") or "",
            }
            for c in comments_raw
        ],
        "reviews": [
            {
                "id": str(r.get("node_id") or r.get("id") or ""),
                "url": r.get("html_url") or "",
                "state": str(r.get("state") or "").upper(),
                "body": r.get("body") or "",
                "commit_oid": r.get("commit_id") or "",
                "author": (r.get("user") or {}).get("login") or "",
                "submitted_at": r.get("submitted_at") or "",
            }
            for r in reviews_raw
        ],
        "review_threads": [
            {
                "id": str(rc.get("node_id") or rc.get("id") or ""),
                "is_resolved": None,
                "path": rc.get("path") or "",
                "line": rc.get("line") or rc.get("original_line"),
                "comments": [
                    {
                        "id": str(rc.get("node_id") or rc.get("id") or ""),
                        "url": rc.get("html_url") or "",
                        "body": rc.get("body") or "",
                        "author": (rc.get("user") or {}).get("login") or "",
                        "created_at": rc.get("created_at") or "",
                    }
                ],
            }
            for rc in review_comments_raw
        ],
        "warnings": [
            "GraphQL rate limit exhausted; fell back to REST (merge-queue and review-thread "
            "resolution states are unknown over REST)"
        ],
    }


async def fetch_pr_raw(repo: str, number: int, cwd: Path) -> dict[str, Any]:
    """Fetch PR data via GraphQL, falling back to REST on rate limit."""
    owner, name = repo.split("/", 1)
    try:
        payload = await run_gh_json(
            cwd,
            "api",
            "graphql",
            "-f",
            f"owner={owner}",
            "-f",
            f"name={name}",
            "-F",
            f"number={number}",
            "-f",
            f"query={PR_GRAPHQL_QUERY}",
        )
    except GhCommandError as exc:
        if exc.rate_limited:
            return await _fetch_pr_rest(repo, number, cwd)
        raise

    if payload.get("errors") and not (payload.get("data") or {}).get("repository"):
        err_text = "; ".join(str(e.get("message", e)) for e in payload["errors"])
        if RATE_LIMIT_RE.search(err_text):
            return await _fetch_pr_rest(repo, number, cwd)
        raise GhCommandError(err_text, code="GH_GRAPHQL_ERROR")

    data = payload.get("data") or {}
    pr_node = (data.get("repository") or {}).get("pullRequest")
    if not pr_node:
        raise GhCommandError(f"Pull request {repo}#{number} not found", code="PR_NOT_FOUND")

    truncated: list[str] = []
    warnings_list: list[str] = []

    rollup_checks, checks_more = _extract_rollup_checks(pr_node)
    if checks_more:
        truncated.append("checks")

    files_conn = pr_node.get("files") or {}
    files = [n["path"] for n in (files_conn.get("nodes") or []) if n and n.get("path")]
    if (files_conn.get("pageInfo") or {}).get("hasNextPage"):
        # Fetch full file list via paginated REST when PR exceeds 100 files.
        try:
            rest_files = await run_gh_rest_list(
                cwd, f"repos/{repo}/pulls/{number}/files?per_page=100"
            )
            files = [f["filename"] for f in rest_files if f.get("filename")]
        except GhCommandError:
            truncated.append("files")

    comments_conn = pr_node.get("comments") or {}
    if (comments_conn.get("pageInfo") or {}).get("hasPreviousPage"):
        truncated.append("comments")
    comments = [
        {
            "id": str(n.get("id", "")),
            "url": n.get("url") or "",
            "body": n.get("body") or "",
            "author": (n.get("author") or {}).get("login") or "",
            "created_at": n.get("createdAt") or "",
        }
        for n in (comments_conn.get("nodes") or [])
        if n
    ]

    reviews_conn = pr_node.get("reviews") or {}
    if (reviews_conn.get("pageInfo") or {}).get("hasPreviousPage"):
        truncated.append("reviews")
    reviews = [
        {
            "id": str(n.get("id", "")),
            "url": n.get("url") or "",
            "state": str(n.get("state") or "").upper(),
            "body": n.get("body") or "",
            "commit_oid": (n.get("commit") or {}).get("oid") or "",
            "author": (n.get("author") or {}).get("login") or "",
            "submitted_at": n.get("submittedAt") or "",
        }
        for n in (reviews_conn.get("nodes") or [])
        if n
    ]

    threads_conn = pr_node.get("reviewThreads") or {}
    if (threads_conn.get("pageInfo") or {}).get("hasPreviousPage"):
        truncated.append("review_threads")
    threads = []
    for t in threads_conn.get("nodes") or []:
        if not t:
            continue
        tc_conn = t.get("comments") or {}
        if (tc_conn.get("pageInfo") or {}).get("hasNextPage") and "review_threads" not in truncated:
            truncated.append("review_threads")
        threads.append(
            {
                "id": str(t.get("id", "")),
                "is_resolved": bool(t.get("isResolved", False)),
                "path": t.get("path") or "",
                "line": t.get("line"),
                "comments": [
                    {
                        "id": str(c.get("id", "")),
                        "url": c.get("url") or "",
                        "body": c.get("body") or "",
                        "author": (c.get("author") or {}).get("login") or "",
                        "created_at": c.get("createdAt") or "",
                    }
                    for c in (tc_conn.get("nodes") or [])
                    if c
                ],
            }
        )

    if truncated:
        warnings_list.append(
            f"Truncated GraphQL connection(s) (>100 items): {', '.join(sorted(truncated))}"
        )

    return {
        "transport": "graphql",
        "viewer": (data.get("viewer") or {}).get("login") or "",
        "rate_limit": data.get("rateLimit"),
        "number": int(pr_node["number"]),
        "url": pr_node.get("url") or "",
        "title": pr_node.get("title") or "",
        "state": str(pr_node.get("state") or "OPEN").upper(),
        "is_draft": bool(pr_node.get("isDraft", False)),
        "head_ref": pr_node.get("headRefName") or "",
        "head_sha": pr_node.get("headRefOid") or "",
        "base_ref": pr_node.get("baseRefName") or "",
        "base_sha": ((pr_node.get("baseRef") or {}).get("target") or {}).get("oid") or "",
        "author": (pr_node.get("author") or {}).get("login") or "",
        "mergeable": str(pr_node.get("mergeable") or "UNKNOWN").upper(),
        "merge_state_status": str(pr_node.get("mergeStateStatus") or "UNKNOWN").upper(),
        "is_in_merge_queue": bool(pr_node.get("isInMergeQueue", False)),
        "merge_queue_entry": pr_node.get("mergeQueueEntry"),
        "auto_merge_enabled": pr_node.get("autoMergeRequest") is not None,
        "files": files,
        "rollup_checks": rollup_checks,
        "review_threads_known": True,
        "truncated_sections": sorted(truncated),
        "comments": comments,
        "reviews": reviews,
        "review_threads": threads,
        "warnings": warnings_list,
    }


async def compute_base_overlap(
    cwd: Path,
    repo: str,
    base_sha: str,
    head_sha: str,
    pr_files: list[str],
) -> tuple[list[str], str | None]:
    """Find files in pr_files that also changed (or were renamed/deleted) on base since merge-base.

    Uses local git first (read-only), falling back to GitHub's compare API when local
    commits are absent. Returns (overlapping_files, merge_base_sha).
    """
    if not base_sha or not head_sha:
        return [], None
    pr_set = set(pr_files)
    rc_mb, out_mb, _ = await run_git(cwd, "merge-base", base_sha, head_sha)
    if rc_mb == 0 and out_mb.strip():
        merge_base = out_mb.strip()
        if merge_base == base_sha:
            return [], merge_base
        rc_diff, out_diff, _ = await run_git(
            cwd, "diff", "--name-only", "--no-renames", f"{merge_base}..{base_sha}"
        )
        if rc_diff == 0:
            base_touched = {line.strip() for line in out_diff.splitlines() if line.strip()}
            return sorted(pr_set & base_touched), merge_base

    # Fallback: GitHub compare API (read-only, works without local fetch).
    try:
        cmp_data = await run_gh_json(cwd, "api", f"repos/{repo}/compare/{head_sha}...{base_sha}")
        merge_base = (cmp_data.get("merge_base_commit") or {}).get("sha")
        base_touched: set[str] = set()
        for f in cmp_data.get("files") or []:
            if not isinstance(f, dict):
                continue
            if f.get("filename"):
                base_touched.add(str(f["filename"]))
            if f.get("previous_filename"):
                base_touched.add(str(f["previous_filename"]))
        return sorted(pr_set & base_touched), merge_base
    except GhCommandError:
        return [], None


def summarize_bots(
    raw: dict[str, Any],
    pr_config: PRConfig,
) -> dict[str, dict[str, Any]]:
    """Summarize review status of gating and advisory bots on the current head."""
    head_sha = raw["head_sha"]
    bot_state: dict[str, dict[str, Any]] = {}

    for rev in raw["reviews"]:
        kind, bot = classify_bot(rev.get("author"), pr_config)
        if kind not in ("gating", "advisory") or not bot:
            continue
        on_head = bool(head_sha and rev.get("commit_oid") == head_sha)
        entry = bot_state.setdefault(
            bot,
            {
                "kind": kind,
                "reviewed_head": False,
                "latest_state": None,
                "latest_url": "",
            },
        )
        if on_head:
            entry["reviewed_head"] = True
        entry["latest_state"] = rev.get("state")
        entry["latest_url"] = rev.get("url") or ""

    for comment in raw["comments"]:
        kind, bot = classify_bot(comment.get("author"), pr_config)
        if kind not in ("gating", "advisory") or not bot:
            continue
        entry = bot_state.setdefault(
            bot,
            {
                "kind": kind,
                "reviewed_head": False,
                "latest_state": "COMMENTED",
                "latest_url": comment.get("url") or "",
            },
        )
        if head_sha and head_sha[:7] in (comment.get("body") or ""):
            entry["reviewed_head"] = True
        entry["latest_url"] = comment.get("url") or entry["latest_url"]

    return bot_state


def evaluate_readiness(  # noqa: C901, PLR0912 - unified readiness truth table
    raw: dict[str, Any],
    checks: dict[str, dict[str, Any]],
    bots: dict[str, dict[str, Any]],
    pr_config: PRConfig,
) -> dict[str, Any]:
    """Compute green/ready booleans, check tallies, and blocking reasons."""
    counts: dict[str, int] = {}
    failed_checks: list[dict[str, Any]] = []
    pending_checks: list[str] = []
    required_checks = [c for c in checks.values() if c.get("required")]

    for check in checks.values():
        b = check["bucket"]
        counts[b] = counts.get(b, 0) + 1
        if b in FAILED_BUCKETS:
            failed_checks.append(check)
        elif b == "pending":
            pending_checks.append(check["name"])

    gating_checks = required_checks if required_checks else list(checks.values())
    gating_failed = [c for c in gating_checks if c["bucket"] in FAILED_BUCKETS]
    truncated = set(raw.get("truncated_sections") or [])
    checks_truncated = "checks" in truncated
    all_gating_passed = (
        bool(gating_checks)
        and not checks_truncated
        and all(c["bucket"] in ("pass", "skipping") for c in gating_checks)
    )
    all_done = len(pending_checks) == 0

    review_threads_known = bool(raw.get("review_threads_known", True))
    unresolved_threads = (
        [t for t in raw["review_threads"] if t.get("is_resolved") is False]
        if review_threads_known
        else []
    )

    changes_requested_by: list[str] = []
    latest_by_reviewer: dict[str, str] = {}
    for rev in raw["reviews"]:
        author = rev.get("author") or ""
        state = rev.get("state") or ""
        if author and state in ("APPROVED", "CHANGES_REQUESTED", "DISMISSED"):
            latest_by_reviewer[author] = state
    for author, state in latest_by_reviewer.items():
        if state == "CHANGES_REQUESTED":
            changes_requested_by.append(author)

    gating_bot_required = bool(pr_config.gating_bots)
    gating_bot_reviewed = (
        True
        if not gating_bot_required
        else any(
            bots.get(bot.lower(), {}).get("reviewed_head", False) for bot in pr_config.gating_bots
        )
    )

    merge_state = raw["merge_state_status"]
    green = all_gating_passed and len(gating_failed) == 0
    blockers: list[str] = []
    if raw["state"] != "OPEN":
        blockers.append(f"PR state is {raw['state']}")
    if raw["is_draft"]:
        blockers.append("PR is still a draft")
    if merge_state == "DIRTY":
        blockers.append("branch conflicts with base (DIRTY)")
    elif merge_state == "BEHIND":
        blockers.append("branch is behind base (BEHIND)")
    elif merge_state == "BLOCKED":
        blockers.append("branch protection blocks merge (BLOCKED)")
    elif merge_state == "UNKNOWN":
        blockers.append("mergeability not yet computed (UNKNOWN)")
    elif merge_state not in ("CLEAN", "HAS_HOOKS"):
        blockers.append(f"merge state is {merge_state}")

    if gating_failed:
        blockers.append("failed checks: " + ", ".join(sorted(c["name"] for c in gating_failed)))
    elif checks_truncated:
        blockers.append("check list truncated (>100 checks); cannot confirm all checks passed")
    elif not gating_checks:
        blockers.append("no checks reported on current head")
    elif not green:
        blockers.append("required checks still pending")

    if not review_threads_known:
        blockers.append("review-thread resolution state unavailable over REST fallback")
    elif "review_threads" in truncated:
        blockers.append("review threads truncated (>100 threads); cannot confirm all resolved")
    elif unresolved_threads:
        blockers.append(f"{len(unresolved_threads)} unresolved review thread(s)")

    if changes_requested_by:
        blockers.append("changes requested by: " + ", ".join(sorted(changes_requested_by)))
    if gating_bot_required and not gating_bot_reviewed:
        blockers.append("awaiting gating bot review on current head")

    ready = raw["state"] == "OPEN" and not raw["is_draft"] and len(blockers) == 0

    return {
        "green": green,
        "ready": ready,
        "all_checks_done": all_done,
        "check_counts": counts,
        "failed_checks": failed_checks,
        "gating_failed_checks": gating_failed,
        "pending_checks": sorted(pending_checks),
        "required_check_count": len(required_checks),
        "review_threads_known": review_threads_known,
        "truncated_sections": sorted(truncated),
        "unresolved_thread_count": len(unresolved_threads) if review_threads_known else None,
        "unresolved_threads": [
            {
                "id": t["id"],
                "path": t.get("path") or "",
                "line": t.get("line"),
                "url": (t["comments"][0]["url"] if t.get("comments") else ""),
            }
            for t in unresolved_threads
        ],
        "changes_requested_by": sorted(changes_requested_by),
        "gating_bot_reviewed": gating_bot_reviewed,
        "blockers": blockers,
    }
