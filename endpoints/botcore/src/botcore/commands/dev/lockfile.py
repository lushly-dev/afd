"""Lockfile freshness check — check-lockfile."""

from __future__ import annotations

import subprocess

from afd import CommandResult, error, success

from botcore.config import load_config
from botcore.utils.workspace import find_workspace, resolve_language, resolve_path


async def dev_check_lockfile(
    path: str | None = None,
    language: str | None = None,
) -> CommandResult[dict]:
    """Check for lockfile drift — lockfile changed without manifest change.

    Detects when a lockfile is staged for commit without a corresponding
    manifest file change, which usually indicates accidental drift from
    running install commands.

    Warning-only: always returns success, but includes a warning message.
    """
    ws = find_workspace()
    if not ws:
        return error(
            "NO_WORKSPACE",
            "Could not find workspace root",
            suggestion="Run from within a Git repository",
        )

    config = load_config(workspace=ws)
    lang = (
        resolve_language(
            resolve_path(path, ws) if path else None,
            config,
            ws,
            language_override=language,
        )
        if ws
        else (language or config.language)
    )

    # Language-specific lockfile -> manifest mappings
    lockfile_pairs: dict[str, list[tuple[str, list[str]]]] = {
        "typescript": [
            ("pnpm-lock.yaml", ["package.json", "packages/*/package.json"]),
            ("package-lock.json", ["package.json", "packages/*/package.json"]),
            ("yarn.lock", ["package.json", "packages/*/package.json"]),
        ],
        "python": [
            ("poetry.lock", ["pyproject.toml"]),
            ("uv.lock", ["pyproject.toml"]),
            ("Pipfile.lock", ["Pipfile"]),
        ],
        "rust": [
            ("Cargo.lock", ["Cargo.toml"]),
        ],
    }

    # Get staged files
    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only"],
        cwd=ws,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return success(
            data={"checked": False, "reason": "git diff failed"},
            reasoning="Could not check staged files",
        )

    staged = set(result.stdout.strip().split("\n")) if result.stdout.strip() else set()

    if not staged:
        return success(
            data={"checked": True, "drift": False},
            reasoning="No staged files",
        )

    # Check pairs for the detected language (or all if unknown)
    pairs_to_check = (
        lockfile_pairs.get(lang, [])
        if lang
        else [pair for pairs in lockfile_pairs.values() for pair in pairs]
    )

    warnings = []
    for lockfile, manifests in pairs_to_check:
        if lockfile not in staged:
            continue

        # Check if any manifest file is also staged
        # Support glob patterns like "packages/*/package.json"
        manifest_staged = False
        for manifest in manifests:
            if "*" in manifest:
                # Glob pattern -- check if any matching file is staged
                import fnmatch

                manifest_staged = any(fnmatch.fnmatch(f, manifest) for f in staged)
            else:
                manifest_staged = manifest in staged
            if manifest_staged:
                break

        if not manifest_staged:
            warnings.append(
                {
                    "lockfile": lockfile,
                    "expected_manifests": manifests,
                    "message": f"{lockfile} changed without a manifest file change"
                    " -- accidental install drift?",
                }
            )

    return success(
        data={
            "checked": True,
            "drift": len(warnings) > 0,
            "warnings": warnings,
        },
        reasoning=f"{len(warnings)} lockfile drift warning(s)"
        if warnings
        else "No lockfile drift detected",
    )
