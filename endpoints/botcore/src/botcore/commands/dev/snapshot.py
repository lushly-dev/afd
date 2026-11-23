"""Read-only checkout integrity snapshot and diff-size ratchet command."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from pathlib import Path
from typing import Any

from afd import CommandResult, error, success

from botcore.utils.workspace import find_workspace, resolve_path

DEFAULT_EXCLUDED_REF_PREFIXES: tuple[str, ...] = ("refs/t3/",)
_GIT_TIMEOUT = 60.0
_REQUIRED_COMPONENT_KEYS: tuple[str, ...] = (
    "head",
    "symbolic_head",
    "refs_sha256",
    "stash_sha256",
    "status_sha256",
    "staged_diff_sha256",
    "unstaged_diff_sha256",
    "untracked_sha256",
)


def _git_env() -> dict[str, str]:
    """Read-only git environment that never takes optional locks or prompts."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["LC_ALL"] = "C"
    env["GIT_OPTIONAL_LOCKS"] = "0"
    env["GIT_TERMINAL_PROMPT"] = "0"
    return env


async def _git_bytes(cwd: Path, *args: str) -> tuple[int, bytes, str]:
    """Run git in cwd and return (returncode, stdout_bytes, stderr_text)."""
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
            stdout_data, stderr_data = await asyncio.wait_for(
                proc.communicate(), timeout=_GIT_TIMEOUT
            )
        except TimeoutError:
            proc.kill()
            await proc.communicate()
            return -1, b"", f"git {' '.join(args[:2])} timed out after {_GIT_TIMEOUT:.0f}s"
        except asyncio.CancelledError:
            proc.kill()
            await proc.communicate()
            raise
    except FileNotFoundError:
        return -2, b"", "git executable not found on PATH"
    except OSError as exc:
        return -1, b"", str(exc)

    return proc.returncode or 0, stdout_data, stderr_data.decode("utf-8", errors="replace").strip()


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _is_sha256_hex(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(ch in "0123456789abcdefABCDEF" for ch in value)
    )


def _parse_porcelain_z(raw: bytes) -> list[dict[str, str]]:
    """Parse ``git status --porcelain=v1 -z --untracked-files=all`` entries."""
    entries: list[dict[str, str]] = []
    parts = raw.decode("utf-8", errors="surrogateescape").split("\0")
    idx = 0
    while idx < len(parts):
        record = parts[idx]
        idx += 1
        if len(record) < 4:
            continue
        code = record[:2]
        path_str = record[3:]
        entry: dict[str, str] = {"status": code, "path": path_str}
        if code[0] in "RC" or code[1] in "RC":
            if idx < len(parts) and parts[idx]:
                entry["orig_path"] = parts[idx]
            idx += 1
        entries.append(entry)
    return entries


def _hash_untracked(repo_root: Path, rel_paths: list[str]) -> tuple[str, list[str]]:
    """Hash sorted untracked files' names and contents without mutating git."""
    hasher = hashlib.sha256()
    unreadable: list[str] = []
    for rel in sorted(rel_paths):
        hasher.update(rel.encode("utf-8", errors="surrogateescape"))
        hasher.update(b"\0")
        file_path = repo_root / rel
        try:
            if file_path.is_symlink():
                hasher.update(b"symlink:")
                hasher.update(os.readlink(file_path).encode("utf-8", errors="surrogateescape"))
            elif file_path.is_file():
                file_hash = hashlib.sha256()
                with file_path.open("rb") as handle:
                    while chunk := handle.read(65536):
                        file_hash.update(chunk)
                hasher.update(file_hash.hexdigest().encode("ascii"))
            else:
                hasher.update(b"missing-or-dir")
        except OSError:
            unreadable.append(rel)
            hasher.update(b"unreadable")
        hasher.update(b"\n")
    return hasher.hexdigest(), unreadable


def _parse_numstat(raw: bytes) -> dict[str, Any]:
    """Parse ``git diff --numstat`` into file/insertion/deletion counts."""
    files = 0
    insertions = 0
    deletions = 0
    binary_files = 0
    for line in raw.decode("utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        parts = line.split("\t", 2)
        if len(parts) < 3:
            continue
        files += 1
        added, removed = parts[0], parts[1]
        if added == "-" or removed == "-":
            binary_files += 1
        else:
            insertions += int(added)
            deletions += int(removed)
    return {
        "files_changed": files,
        "insertions": insertions,
        "deletions": deletions,
        "net_lines": insertions - deletions,
        "binary_files": binary_files,
    }


def _validate_snapshot_dict(candidate: dict[str, Any]) -> dict[str, Any]:
    """Ensure a dict baseline is a valid dev_snapshot payload, never {} or a failed envelope."""
    if "success" in candidate:
        if candidate["success"] is not True or not isinstance(candidate.get("data"), dict):
            raise ValueError("compare_to contains a failed or incomplete CommandResult envelope")
        candidate = candidate["data"]

    has_digest = _is_sha256_hex(candidate.get("digest"))
    has_all_components = all(key in candidate for key in _REQUIRED_COMPONENT_KEYS)
    if not has_digest and not has_all_components:
        raise ValueError(
            "compare_to snapshot is incomplete: expected a 64-char 'digest' or all snapshot "
            "component hashes"
        )
    return candidate


def _parse_compare_target(
    compare_to: dict[str, Any] | str,
) -> tuple[dict[str, Any] | None, str | None]:
    """Normalize compare_to into either a validated snapshot dict or a bare digest string."""
    if isinstance(compare_to, dict):
        return _validate_snapshot_dict(compare_to), None

    text = compare_to.strip()
    if text.startswith("{"):
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError(f"compare_to is not valid JSON: {exc}") from exc
        if not isinstance(parsed, dict):
            raise ValueError("compare_to JSON must be an object")
        return _validate_snapshot_dict(parsed), None

    if _is_sha256_hex(text):
        return None, text.lower()

    raise ValueError(
        "compare_to must be a previous dev_snapshot dict, JSON string, or 64-char sha256 digest"
    )


def _build_comparison(
    current: dict[str, Any],
    prior_dict: dict[str, Any] | None,
    prior_digest: str | None,
) -> dict[str, Any]:
    """Compare current snapshot against a prior snapshot or digest."""
    if prior_digest is not None:
        unchanged = current["digest"] == prior_digest
        return {
            "unchanged": unchanged,
            "changed_components": [] if unchanged else ["digest"],
            "prior_digest": prior_digest,
        }

    assert prior_dict is not None
    changed = [
        key
        for key in _REQUIRED_COMPONENT_KEYS
        if key in prior_dict and prior_dict.get(key) != current.get(key)
    ]
    if "digest" in prior_dict and not changed and prior_dict["digest"] != current["digest"]:
        changed.append("digest")

    comparison: dict[str, Any] = {
        "unchanged": len(changed) == 0,
        "changed_components": changed,
        "prior_digest": prior_dict.get("digest"),
    }

    prior_stat = prior_dict.get("diff_stat")
    curr_stat = current.get("diff_stat")
    if isinstance(prior_stat, dict) and isinstance(curr_stat, dict):
        comparison["diff_delta"] = {
            "files_delta": curr_stat["files_changed"] - prior_stat.get("files_changed", 0),
            "insertions_delta": curr_stat["insertions"] - prior_stat.get("insertions", 0),
            "deletions_delta": curr_stat["deletions"] - prior_stat.get("deletions", 0),
            "net_lines_delta": curr_stat["net_lines"] - prior_stat.get("net_lines", 0),
            "untracked_delta": (
                curr_stat.get("untracked_files", 0) - prior_stat.get("untracked_files", 0)
            ),
        }
    return comparison


async def _resolve_commit_oid(repo_root: Path, ref: str) -> tuple[str | None, str | None]:
    """Safely resolve a caller-supplied ref to a commit OID, preventing git option injection."""
    if not ref or ref.startswith("-"):
        return None, f"Invalid git ref {ref!r}: refs may not be empty or start with '-'"
    rc, out, err = await _git_bytes(
        repo_root, "rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}"
    )
    if rc != 0:
        return None, err or f"Unknown commit ref {ref!r}"
    oid = out.decode("utf-8", errors="replace").strip()
    return (oid, None) if oid else (None, f"Empty commit OID for {ref!r}")


async def _collect_git_state(
    repo_root: Path,
    excluded: tuple[str, ...],
    base: str | None,
) -> tuple[dict[str, Any] | None, CommandResult[dict[str, Any]] | None]:
    """Gather all read-only git hashes and diff statistics for repo_root."""
    rc_head, out_head, _ = await _git_bytes(repo_root, "rev-parse", "--verify", "HEAD")
    head = out_head.decode("utf-8", errors="replace").strip() if rc_head == 0 else None

    rc_sym, out_sym, _ = await _git_bytes(repo_root, "symbolic-ref", "-q", "HEAD")
    symbolic_head = out_sym.decode("utf-8", errors="replace").strip() if rc_sym == 0 else None

    rc_branch, out_branch, _ = await _git_bytes(repo_root, "rev-parse", "--abbrev-ref", "HEAD")
    branch = out_branch.decode("utf-8", errors="replace").strip() if rc_branch == 0 else None

    # Enumerate ALL refs first (excluding refs/stash which is hashed separately), then apply
    # exclude_ref_prefixes so refs/factory/, refs/notes/, etc. are covered and exclusions work.
    rc_refs, out_refs, err_refs = await _git_bytes(
        repo_root, "for-each-ref", "--format=%(refname) %(objectname)"
    )
    if rc_refs != 0:
        return None, error(
            "GIT_FAILED",
            f"Could not read git refs: {err_refs}",
            suggestion="Check that this directory is a healthy git repository",
        )
    ref_lines = [
        line
        for line in out_refs.decode("utf-8", errors="replace").splitlines()
        if line
        and not line.startswith("refs/stash ")
        and not any(line.startswith(prefix) for prefix in excluded)
    ]
    refs_sha256 = _sha256_bytes("\n".join(ref_lines).encode("utf-8"))

    rc_stash, out_stash, _ = await _git_bytes(repo_root, "stash", "list", "--format=%H %gs")
    stash_lines = (
        [line for line in out_stash.decode("utf-8", errors="replace").splitlines() if line]
        if rc_stash == 0
        else []
    )
    stash_sha256 = _sha256_bytes("\n".join(stash_lines).encode("utf-8"))

    rc_status, out_status, err_status = await _git_bytes(
        repo_root, "status", "--porcelain=v1", "-z", "--untracked-files=all"
    )
    if rc_status != 0:
        return None, error(
            "GIT_FAILED",
            f"Could not read git status: {err_status}",
            suggestion="Check git status in the target checkout",
        )
    status_sha256 = _sha256_bytes(out_status)
    dirty_entries = _parse_porcelain_z(out_status)

    # Hash staged (index vs HEAD) and unstaged (working tree vs index) diffs separately so
    # staging changes on an already-modified file cannot hide behind identical working-tree bytes.
    staged_args = (
        ("diff", "--binary", "--cached", "HEAD") if head else ("diff", "--binary", "--cached")
    )
    rc_staged, out_staged, err_staged = await _git_bytes(repo_root, *staged_args)
    if rc_staged != 0:
        return None, error(
            "GIT_FAILED",
            f"Could not compute staged diff: {err_staged}",
            suggestion="Check that the git index and HEAD are readable",
        )
    staged_diff_sha256 = _sha256_bytes(out_staged)

    rc_unstaged, out_unstaged, err_unstaged = await _git_bytes(repo_root, "diff", "--binary")
    if rc_unstaged != 0:
        return None, error(
            "GIT_FAILED",
            f"Could not compute unstaged diff: {err_unstaged}",
            suggestion="Check that the working tree is readable",
        )
    unstaged_diff_sha256 = _sha256_bytes(out_unstaged)
    diff_sha256 = _sha256_bytes(out_staged + b"\0" + out_unstaged)

    rc_untracked, out_untracked, err_untracked = await _git_bytes(
        repo_root, "ls-files", "-z", "--others", "--exclude-standard"
    )
    if rc_untracked != 0:
        return None, error(
            "GIT_FAILED",
            f"Could not list untracked files: {err_untracked}",
            suggestion="Check git ls-files in the target checkout",
        )
    untracked_paths = [
        p for p in out_untracked.decode("utf-8", errors="surrogateescape").split("\0") if p
    ]
    untracked_sha256, unreadable = _hash_untracked(repo_root, untracked_paths)

    diff_stat: dict[str, Any] | None = None
    if base is not None or head is not None:
        stat_label = base if base is not None else "HEAD"
        if base is not None:
            resolved_oid, resolve_err = await _resolve_commit_oid(repo_root, base)
            if resolve_err or not resolved_oid:
                return None, error(
                    "INVALID_BASE",
                    f"Could not resolve base {base!r}: {resolve_err}",
                    suggestion="Pass a valid git ref or commit SHA for base (e.g. origin/main)",
                )
        else:
            resolved_oid = head
        assert resolved_oid is not None
        rc_stat, out_stat, err_stat = await _git_bytes(
            repo_root, "diff", "--numstat", resolved_oid, "--"
        )
        if rc_stat != 0:
            return None, error(
                "INVALID_BASE",
                f"Could not diff against base {stat_label!r}: {err_stat}",
                suggestion="Pass a valid git ref or commit SHA for base (e.g. origin/main)",
            )
        diff_stat = _parse_numstat(out_stat)
        diff_stat["base"] = stat_label
        diff_stat["base_oid"] = resolved_oid
        diff_stat["untracked_files"] = len(untracked_paths)

    digest_payload = json.dumps(
        {
            "head": head,
            "symbolic_head": symbolic_head,
            "refs_sha256": refs_sha256,
            "stash_sha256": stash_sha256,
            "status_sha256": status_sha256,
            "staged_diff_sha256": staged_diff_sha256,
            "unstaged_diff_sha256": unstaged_diff_sha256,
            "untracked_sha256": untracked_sha256,
        },
        sort_keys=True,
    ).encode("utf-8")

    return {
        "repo_root": str(repo_root),
        "head": head,
        "symbolic_head": symbolic_head,
        "branch": branch,
        "digest": _sha256_bytes(digest_payload),
        "refs_sha256": refs_sha256,
        "ref_count": len(ref_lines),
        "excluded_ref_prefixes": list(excluded),
        "stash_sha256": stash_sha256,
        "stash_count": len(stash_lines),
        "status_sha256": status_sha256,
        "dirty_count": len(dirty_entries),
        "dirty_files": dirty_entries,
        "staged_diff_sha256": staged_diff_sha256,
        "unstaged_diff_sha256": unstaged_diff_sha256,
        "diff_sha256": diff_sha256,
        "untracked_sha256": untracked_sha256,
        "untracked_count": len(untracked_paths),
        "unreadable_untracked": unreadable,
        "diff_stat": diff_stat,
    }, None


async def dev_snapshot(
    base: str | None = None,
    compare_to: dict[str, Any] | str | None = None,
    exclude_ref_prefixes: list[str] | None = None,
    path: str | None = None,
) -> CommandResult[dict[str, Any]]:
    """Capture a read-only checkout integrity snapshot and optional diff-size comparison.

    Args:
        base: Git ref or SHA for diff-size statistics (default: HEAD).
        compare_to: Prior dev_snapshot dict, JSON string, or 64-char sha256 digest to compare.
        exclude_ref_prefixes: Ref prefixes to ignore (default: ["refs/t3/"]).
        path: Directory inside the target git checkout (default: current workspace).
    """
    ws = find_workspace()
    target = resolve_path(path, ws, default=".") if path else (ws or Path.cwd())
    if not target.exists():
        return error(
            "PATH_NOT_FOUND",
            f"Path does not exist: {target}",
            suggestion="Pass an existing directory inside a git repository",
        )
    cwd = target if target.is_dir() else target.parent

    prior_dict: dict[str, Any] | None = None
    prior_digest: str | None = None
    if compare_to is not None:
        try:
            prior_dict, prior_digest = _parse_compare_target(compare_to)
        except ValueError as exc:
            return error(
                "INVALID_INPUT",
                str(exc),
                suggestion="Pass the data dict or digest returned by an earlier dev_snapshot call",
            )

    rc_top, out_top, err_top = await _git_bytes(cwd, "rev-parse", "--show-toplevel")
    if rc_top == -2:
        return error(
            "TOOL_NOT_FOUND",
            "git is not installed or not on PATH",
            suggestion="Install git and ensure it is available on PATH",
        )
    if rc_top != 0:
        return error(
            "NOT_A_GIT_REPO",
            f"Not inside a git repository ({cwd}): {err_top}",
            suggestion="Run from inside a git worktree or pass path=<repo>",
        )
    repo_root = Path(out_top.decode("utf-8", errors="replace").strip())

    excluded = (
        DEFAULT_EXCLUDED_REF_PREFIXES
        if exclude_ref_prefixes is None
        else tuple(exclude_ref_prefixes)
    )
    data, err = await _collect_git_state(repo_root, excluded, base)
    if err is not None:
        return err
    assert data is not None

    if compare_to is not None:
        comparison = _build_comparison(data, prior_dict, prior_digest)
        data["comparison"] = comparison
        reasoning = (
            "Checkout unchanged since prior snapshot"
            if comparison["unchanged"]
            else f"Checkout changed in: {', '.join(comparison['changed_components'])}"
        )
    else:
        reasoning = f"Snapshot {data['digest'][:12]} ({data['dirty_count']} dirty entries)"

    return success(data=data, reasoning=reasoning)
