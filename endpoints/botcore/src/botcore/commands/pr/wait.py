"""Cross-platform PR event watcher with optional persisted lock and watermark state."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
from collections.abc import Callable
from contextlib import nullcontext
from pathlib import Path
from typing import Any, Literal

from afd import CommandResult, error, success

from botcore.commands.disk.lock import LockHeld, RunLock
from botcore.commands.pr.github import (
    FAILED_BUCKETS,
    GhCommandError,
    classify_bot,
    resolve_pr_target,
)
from botcore.commands.pr.status import collect_pr_status
from botcore.config import PRConfig, load_config
from botcore.utils.workspace import find_workspace

STATE_ENV = "BOTCORE_PR_STATE"
MAX_FAILED_POLLS = 10


def _default_state_dir(pr_config: PRConfig, ws: Path) -> Path:
    """Resolve the state directory, expanding ~ and resolving relative paths against ws."""
    env_dir = os.environ.get(STATE_ENV)
    if env_dir:
        candidate = Path(env_dir).expanduser()
        return candidate if candidate.is_absolute() else (ws / candidate).resolve()
    if pr_config.state_dir:
        candidate = Path(pr_config.state_dir).expanduser()
        return candidate if candidate.is_absolute() else (ws / candidate).resolve()
    return Path.home() / ".local" / "state" / "botcore" / "pr-wait"


def _slug_hash(ws: Path, repo: str, number: int) -> str:
    """Scope persisted lock/watermark identity to workspace and PR to isolate worktrees."""
    ws_key = os.path.normcase(str(ws.resolve()))
    return hashlib.sha256(f"{ws_key}::{repo.lower()}#{number}".encode()).hexdigest()[:16]


def _load_watermark(path: Path, stale_seconds: int) -> dict[str, Any] | None:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict):
        return None
    updated = raw.get("updated_at")
    if not isinstance(updated, (int, float)) or (time.time() - updated) > stale_seconds:
        return None
    return raw


def _save_watermark(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    state["updated_at"] = time.time()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def _fresh_state() -> dict[str, Any]:
    return {
        "head_sha": "",
        "base_sha": "",
        "merge_state": "",
        "reported": [],
        "seen_comments": [],
        "seen_reviews": [],
        "seen_thread_comments": [],
        "updated_at": time.time(),
    }


def _snippet(text: str, limit: int = 120) -> str:
    clean = " ".join(text.split())
    return clean if len(clean) <= limit else clean[: limit - 3] + "..."


class _EventTracker:
    """Diff successive PR snapshots into deduplicated event dicts."""

    def __init__(
        self,
        state: dict[str, Any],
        pr_config: PRConfig,
        *,
        baseline: bool,
        on_event: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.state = state
        self.pr_config = pr_config
        self.baseline = baseline
        self.on_event = on_event
        self.reported: set[str] = set(state.get("reported", []))
        self.seen_comments: set[str] = set(state.get("seen_comments", []))
        self.seen_reviews: set[str] = set(state.get("seen_reviews", []))
        self.seen_thread_comments: set[str] = set(state.get("seen_thread_comments", []))
        self.events: list[dict[str, Any]] = []

    def emit(self, key: str, kind: str, message: str, url: str = "") -> None:
        if key in self.reported:
            return
        self.reported.add(key)
        if self.baseline:
            return
        event = {"key": key, "kind": kind, "message": message, "url": url}
        self.events.append(event)
        if self.on_event is not None:
            self.on_event(event)

    def sync_state(self) -> dict[str, Any]:
        self.state["reported"] = sorted(self.reported)
        self.state["seen_comments"] = sorted(self.seen_comments)
        self.state["seen_reviews"] = sorted(self.seen_reviews)
        self.state["seen_thread_comments"] = sorted(self.seen_thread_comments)
        return self.state

    def _record_comments_and_reviews(self, raw: dict[str, Any]) -> None:
        ignore_authors = {a.lower() for a in (raw.get("author"), raw.get("viewer")) if a}
        for c in raw.get("comments", []):
            cid = str(c.get("id") or "")
            if not cid or cid in self.seen_comments:
                continue
            self.seen_comments.add(cid)
            author = c.get("author") or ""
            kind, _ = classify_bot(author, self.pr_config)
            if kind == "status" or author.lower() in ignore_authors:
                continue
            self.emit(
                f"comment:{cid}",
                "comment",
                f"new comment from {author}: {_snippet(c.get('body') or '')}",
                c.get("url") or "",
            )

        for r in raw.get("reviews", []):
            rid = str(r.get("id") or "")
            if not rid or rid in self.seen_reviews:
                continue
            self.seen_reviews.add(rid)
            author = r.get("author") or ""
            if author.lower() in ignore_authors:
                continue
            self.emit(
                f"review:{rid}",
                "review",
                f"review {r.get('state', '')} from {author}: {_snippet(r.get('body') or '')}",
                r.get("url") or "",
            )

        for thread in raw.get("review_threads", []):
            path_label = thread.get("path") or ""
            for tc in thread.get("comments", []):
                tcid = str(tc.get("id") or "")
                if not tcid or tcid in self.seen_thread_comments:
                    continue
                self.seen_thread_comments.add(tcid)
                author = tc.get("author") or ""
                if author.lower() in ignore_authors:
                    continue
                loc = f" on {path_label}" if path_label else ""
                self.emit(
                    f"thread:{tcid}",
                    "thread",
                    f"thread comment from {author}{loc}: {_snippet(tc.get('body') or '')}",
                    tc.get("url") or "",
                )

    def process(self, status: dict[str, Any], raw: dict[str, Any]) -> list[dict[str, Any]]:
        """Update tracker from one poll and return newly emitted events from this poll."""
        start_idx = len(self.events)
        head = status["head_sha"]
        short = head[:7] if head else "unknown"
        base = status["base_ref"]

        if status["state"] == "MERGED":
            self.emit(f"merged:{head}", "pr_merged", f"PR merged on {short}", status["url"])
        elif status["state"] == "CLOSED":
            self.emit(f"closed:{head}", "pr_closed", f"PR closed on {short}", status["url"])

        gating_failed = status.get("gating_failed_checks", status.get("failed_checks", []))
        for check in gating_failed:
            if check["bucket"] in FAILED_BUCKETS:
                self.emit(
                    f"fail:{head}:{check['name']}",
                    "check_failed",
                    f"check failed on {short}: {check['name']} ({check['bucket']})",
                    check.get("url") or "",
                )

        if status["all_checks_done"] and status["checks"]:
            counts_str = ", ".join(f"{n} {b}" for b, n in sorted(status["check_counts"].items()))
            self.emit(
                f"checks:{head}",
                "checks_finished",
                f"checks finished on {short}: {counts_str}",
                status["url"],
            )

        self._record_comments_and_reviews(raw)

        for bot_name, info in sorted(status["bots"].items()):
            if info.get("reviewed_head"):
                self.emit(
                    f"bot:{head}:{bot_name}",
                    "bot_reviewed",
                    f"{bot_name} finished reviewing {short} ({info.get('latest_state')})",
                    info.get("latest_url") or "",
                )

        old_base = self.state.get("base_sha") or ""
        new_base = status["base_sha"]
        if new_base and old_base and new_base != old_base and status["base_overlap_files"]:
            touched = status["base_overlap_files"]
            more = f" and {len(touched) - 5} more" if len(touched) > 5 else ""
            self.emit(
                f"base:{new_base}",
                "base_overlap",
                f"{base} moved to {new_base[:7]} touching PR files: {', '.join(touched[:5])}{more}",
                status["url"],
            )
        if new_base:
            self.state["base_sha"] = new_base
        self.state["head_sha"] = head

        merge_state = status["merge_state_status"]
        if merge_state in ("BEHIND", "DIRTY") and self.state.get("merge_state") != merge_state:
            msg = (
                f"merge state is DIRTY: branch conflicts with {base}"
                if merge_state == "DIRTY"
                else f"merge state is BEHIND: update branch from {base}"
            )
            self.emit(f"merge:{merge_state}:{head}:{new_base}", "merge_state", msg, status["url"])
        if merge_state != "UNKNOWN":
            self.state["merge_state"] = merge_state

        return self.events[start_idx:]


def _terminal_outcome(
    status: dict[str, Any],
    until: Literal["ready", "green", "any-change"],
    poll_events: list[dict[str, Any]],
) -> tuple[str, int] | None:
    """Return (outcome, exit_code) when waiting should stop, else None."""
    if status["state"] == "MERGED":
        return "merged", 0
    if status["state"] == "CLOSED":
        return "closed", 1
    if until == "any-change":
        return ("any_change", 0) if poll_events else None

    gating_failed = status.get("gating_failed_checks", status.get("failed_checks", []))
    if status["merge_state_status"] == "DIRTY":
        return "action_needed", 1
    if gating_failed:
        return "action_needed", 1
    if until == "green" and status["green"]:
        return "green", 0
    if until == "ready" and status["green"] and status["gating_bot_reviewed"]:
        if status["ready"]:
            return "ready", 0
        unresolved = status.get("unresolved_thread_count")
        changes_requested = status.get("changes_requested_by") or []
        if (
            status.get("review_threads_known") is False
            or (isinstance(unresolved, int) and unresolved > 0)
            or bool(changes_requested)
            or status["merge_state_status"] in ("BEHIND", "BLOCKED")
        ):
            return "action_needed", 1
    return None


async def pr_wait(  # noqa: PLR0913 - command options mirror pr-wait CLI
    pr: int | str | None = None,
    repo: str | None = None,
    until: Literal["ready", "green", "any-change"] = "ready",
    interval: int | None = None,
    timeout_seconds: int = 1800,
    max_polls: int | None = None,
    persist_state: bool = False,
    on_event: Callable[[dict[str, Any]], None] | None = None,
) -> CommandResult[dict[str, Any]]:
    """Wait for PR events until ready, green, or any change. Read-only by default.

    Args:
        pr: Pull request number, URL, or None for the current branch's PR.
        repo: Repository slug (owner/name); inferred from PR URL or git origin when omitted.
        until: Stop condition: "ready", "green", or "any-change".
        interval: Seconds between polls (defaults to [pr].default_interval).
        timeout_seconds: Maximum wall-clock seconds bounding resolution and all polls.
        max_polls: Optional maximum number of polls (useful for bounded checks/tests).
        persist_state: When True, take a worktree-scoped cross-platform lock and save event
            watermarks so restarts don't miss events. False (default) writes nothing to disk.
        on_event: Optional callback invoked with each event dict as it arrives.
    """
    if until not in ("ready", "green", "any-change"):
        return error(
            "INVALID_INPUT",
            f"Unsupported until condition: {until!r}",
            suggestion="Use one of: ready, green, any-change",
        )
    if timeout_seconds <= 0:
        return error(
            "INVALID_INPUT",
            f"timeout_seconds must be positive, got {timeout_seconds}",
            suggestion="Pass a positive timeout_seconds value",
        )
    if max_polls is not None and max_polls <= 0:
        return error(
            "INVALID_INPUT",
            f"max_polls must be positive, got {max_polls}",
            suggestion="Omit max_polls or pass a positive integer",
        )

    deadline = time.monotonic() + timeout_seconds
    ws = find_workspace() or Path.cwd()
    config = load_config(workspace=ws)
    pr_config = config.pr
    poll_interval = pr_config.default_interval if interval is None else max(interval, 1)

    try:
        remaining = max(0.01, deadline - time.monotonic())
        resolved_repo, number = await asyncio.wait_for(
            resolve_pr_target(pr, repo, ws), timeout=remaining
        )
    except TimeoutError:
        return success(
            data={
                "repo": repo or "",
                "number": pr,
                "until": until,
                "outcome": "timeout",
                "exit_code": 1,
                "polls": 0,
                "events": [],
                "status": None,
            },
            reasoning=f"Timed out after {timeout_seconds}s while resolving PR target",
        )
    except GhCommandError as exc:
        return error(
            exc.code,
            str(exc),
            suggestion="Check the PR number, repository slug, and `gh auth status`",
        )

    state_file: Path | None = None
    lock_cm: Any = nullcontext()
    if persist_state:
        base_dir = _default_state_dir(pr_config, ws)
        slug = _slug_hash(ws, resolved_repo, number)
        lock_cm = RunLock(base_dir / f"{slug}.lock", label="pr_wait watcher")
        state_file = base_dir / f"{slug}.json"

    try:
        with lock_cm:
            loaded = (
                _load_watermark(state_file, pr_config.stale_state_seconds)
                if state_file is not None
                else None
            )
            tracker = _EventTracker(
                loaded if loaded is not None else _fresh_state(),
                pr_config,
                baseline=(loaded is None),
                on_event=on_event,
            )
            return await _poll_loop(
                resolved_repo=resolved_repo,
                number=number,
                ws=ws,
                until=until,
                poll_interval=poll_interval,
                timeout_seconds=timeout_seconds,
                deadline=deadline,
                max_polls=max_polls,
                tracker=tracker,
                state_file=state_file,
            )
    except LockHeld as exc:
        return error(
            "PR_ALREADY_WATCHED",
            f"Another pr_wait instance already watches {resolved_repo}#{number}: {exc}",
            suggestion="Reuse the active watcher instead of starting a second one on the same PR",
        )


async def _poll_loop(  # noqa: PLR0913 - internal poll coordinator
    *,
    resolved_repo: str,
    number: int,
    ws: Path,
    until: Literal["ready", "green", "any-change"],
    poll_interval: int,
    timeout_seconds: int,
    deadline: float,
    max_polls: int | None,
    tracker: _EventTracker,
    state_file: Path | None,
) -> CommandResult[dict[str, Any]]:
    polls = 0
    transient_failures = 0
    latest_status: dict[str, Any] | None = None

    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return success(
                data={
                    "repo": resolved_repo,
                    "number": number,
                    "until": until,
                    "outcome": "timeout",
                    "exit_code": 1,
                    "polls": polls,
                    "events": tracker.events,
                    "status": latest_status,
                },
                reasoning=f"{resolved_repo}#{number}: timed out after {timeout_seconds}s",
            )

        polls += 1
        try:
            status, raw = await asyncio.wait_for(
                collect_pr_status(pr=number, repo=resolved_repo, cwd=ws),
                timeout=remaining,
            )
            latest_status = status
            transient_failures = 0
        except TimeoutError:
            return success(
                data={
                    "repo": resolved_repo,
                    "number": number,
                    "until": until,
                    "outcome": "timeout",
                    "exit_code": 1,
                    "polls": polls,
                    "events": tracker.events,
                    "status": latest_status,
                },
                reasoning=f"{resolved_repo}#{number}: timed out after {timeout_seconds}s",
            )
        except GhCommandError as exc:
            if not exc.transient:
                return error(
                    exc.code,
                    str(exc),
                    suggestion="Verify GitHub authentication and PR access with `gh auth status`",
                )
            transient_failures += 1
            if transient_failures >= MAX_FAILED_POLLS:
                return error(
                    "GH_UNREACHABLE",
                    f"GitHub unreachable for {transient_failures} consecutive polls: {exc}",
                    suggestion="Check network connectivity and `gh api rate_limit`",
                )
        else:
            poll_events = tracker.process(status, raw)
            if state_file is not None:
                _save_watermark(state_file, tracker.sync_state())
            tracker.baseline = False

            terminal = _terminal_outcome(status, until, poll_events)
            if terminal is not None:
                outcome, exit_code = terminal
                return success(
                    data={
                        "repo": resolved_repo,
                        "number": number,
                        "until": until,
                        "outcome": outcome,
                        "exit_code": exit_code,
                        "polls": polls,
                        "events": tracker.events,
                        "status": status,
                    },
                    reasoning=f"{resolved_repo}#{number}: {outcome} after {polls} poll(s)",
                )

        if max_polls is not None and polls >= max_polls:
            return success(
                data={
                    "repo": resolved_repo,
                    "number": number,
                    "until": until,
                    "outcome": "timeout",
                    "exit_code": 1,
                    "polls": polls,
                    "events": tracker.events,
                    "status": latest_status,
                },
                reasoning=f"{resolved_repo}#{number}: reached max_polls ({max_polls})",
            )

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return success(
                data={
                    "repo": resolved_repo,
                    "number": number,
                    "until": until,
                    "outcome": "timeout",
                    "exit_code": 1,
                    "polls": polls,
                    "events": tracker.events,
                    "status": latest_status,
                },
                reasoning=f"{resolved_repo}#{number}: timed out after {timeout_seconds}s",
            )

        await asyncio.sleep(min(poll_interval, remaining))
