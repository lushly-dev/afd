"""Tier 0: tool caches pruned with each tool's own command, and aged cache folders."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from botcore.commands.disk.scan import (
    DAY,
    Processes,
    allocated,
    busy_reason,
    exists,
    is_dir,
    is_link,
    newest_mtime,
)
from botcore.commands.disk.settings import MachineSettings, expand
from botcore.commands.disk.steps import command, doing, each


def _tool_out(args: list[str], cwd: Path | None) -> str | None:
    exe = shutil.which(args[0])
    if exe is None:
        return None
    try:
        with command(f"running {args[0]} in", cwd or "", allow=60):
            done = subprocess.run(
                [exe, *args[1:]], cwd=cwd, capture_output=True, text=True, timeout=60,
                check=False,
            )
    except (OSError, subprocess.TimeoutExpired):
        return None
    out = done.stdout.strip()
    return out if done.returncode == 0 and out else None


def _sample_mode(checkout: Path) -> str:
    """How pnpm put packages into one checkout: "hardlink", "clone-or-copy" or "unknown".

    `pnpm store prune` deletes every store file with one link, taking it to mean no project
    uses it. Clones and copies always have one link, so prune is only safe with hard links.
    """
    store = checkout / "node_modules" / ".pnpm"
    if not is_dir(store):
        return "unknown"
    seen = 0
    doing("reading", store)
    for package_json in store.glob("*/node_modules/*/package.json"):
        doing("reading", store)
        try:
            links = package_json.stat().st_nlink
        except OSError:
            continue
        if links > 1:
            return "hardlink"
        seen += 1
        if seen >= 20:
            break
    return "clone-or-copy" if seen else "unknown"


def pnpm_link_mode(checkouts: list[Path]) -> str:
    """The link mode across checkouts: "hardlink" only if every sampled one hard-links."""
    modes = {_sample_mode(c) for c in checkouts} - {"unknown"}
    if not modes:
        return "unknown"
    return "hardlink" if modes == {"hardlink"} else "clone-or-copy"


def pnpm_store_dir(checkouts: list[Path]) -> str | None:
    """The store the first of these checkouts' installs used, from node_modules/.modules.yaml.

    Read from the install's own record rather than `pnpm store path`, which writes probe files.
    """
    for checkout in checkouts:
        found = _store_of(checkout)
        if found:
            return found
    return None


def _store_of(checkout: Path) -> str | None:
    manifest = checkout / "node_modules" / ".modules.yaml"
    doing("reading", manifest)
    try:
        text = manifest.read_text(encoding="utf-8")
    except OSError:
        return None
    for line in text.splitlines():
        key, _, value = line.partition(":")
        if key.strip() == "storeDir" and value.strip():
            return value.strip().strip("'\"")
    return None


def _pnpm(checkouts: list[Path], deadline: float) -> list[dict]:
    """One row per store, judged only from the checkouts that use that store."""
    by_store: dict[str, list[Path]] = {}
    for checkout in checkouts:
        store = _store_of(checkout)
        if store:
            by_store.setdefault(store, []).append(checkout)
    rows = []
    for store, users in by_store.items():
        mode = pnpm_link_mode(users)
        row = {
            "name": "pnpm",
            "path": store,
            "cwd": str(users[0]),
            "bytes": allocated(Path(store), deadline),
            "link_mode": mode,
            "action": "pnpm store prune" if mode == "hardlink" else None,
            "reclaimable_bytes": None,
        }
        if mode != "hardlink":
            row["note"] = (
                "not pruned: packages are cloned or copied, so pnpm store prune would empty the "
                "whole store" if mode == "clone-or-copy" else "not pruned: link mode unknown"
            )
        rows.append(row)
    return rows


def _uv(deadline: float) -> dict | None:
    path = _tool_out(["uv", "cache", "dir"], None)
    if path is None:
        return None
    return {
        "name": "uv",
        "path": path,
        "bytes": allocated(Path(path), deadline),
        "action": "uv cache prune",
        "reclaimable_bytes": None,
    }


def _playwright_dir() -> Path:
    override = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if override and override != "0":
        return Path(override)
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Caches" / "ms-playwright"
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA", home / "AppData" / "Local")) / "ms-playwright"
    return home / ".cache" / "ms-playwright"


def _playwright(deadline: float) -> dict | None:
    path = _playwright_dir()
    if not is_dir(path):
        return None
    return {
        "name": "playwright",
        "path": str(path),
        "bytes": allocated(path, deadline),
        "action": None,
        "reclaimable_bytes": None,
        "note": "reported only: which browser builds a project needs is the project's call",
    }


def report_caches(settings: MachineSettings, repos: list[Path], deadline: float) -> list[dict]:
    """One row per cache in the machine settings' `caches` list."""
    makers = {
        "pnpm": lambda: _pnpm(repos, deadline),
        "uv": lambda: [r for r in [_uv(deadline)] if r],
        "playwright": lambda: [r for r in [_playwright(deadline)] if r],
    }
    rows: list[dict] = []
    for name in settings.caches:
        maker = makers.get(name)
        if maker is None:
            rows.append({"name": name, "error": "unknown cache name"})
            continue
        rows += maker()
    return rows


def _key(path: Path | str) -> str:
    return os.path.normcase(os.path.realpath(os.path.abspath(str(path))))


def _within(inner: str, outer: str) -> bool:
    return inner == outer or inner.startswith(outer.rstrip(os.sep) + os.sep)


# How deep an aged entry's age is read. Builds write deep in a folder: for a Cargo workspace
# build dir (`<hash>/<profile>/deps/...` or `<hash>/<triple>/<profile>/deps`), three levels
# reach cross-compiled `deps` directories as well as files inside `<profile>/deps` and
# `<profile>/.fingerprint`.
AGED_DEPTH = 3
HASH_BUCKET = re.compile(r"^[0-9a-f]{2}$")  # Cargo {workspace-path-hash}: `<2 hex>/<rest>`
HASH_LEAF = re.compile(r"^[0-9a-f]{8,}$")
BUCKET_IGNORED_FILES = {".DS_Store", "Thumbs.db", "desktop.ini"}


def parse_aged_pattern(pattern: str) -> tuple[Path, int, str]:
    """Split an `[[aged]]` path into `(expanded_base, wildcard_depth, raw_base)`."""
    text = pattern.rstrip()
    if text.endswith(("/*/*", "\\*\\*")):
        raw, depth = text[:-4], 2
    elif text.endswith(("/*", "\\*")):
        raw, depth = text[:-2], 1
    else:
        raw, depth = text, 0
    return expand(raw), depth, raw


def aged_base(pattern: str) -> Path:
    """The directory an `[[aged]]` pattern sits under (with any `/*` or `/*/*` stripped)."""
    return parse_aged_pattern(pattern)[0]


def unsafe_aged_root(path: Path, protected: list[Path] | None = None) -> str | None:
    """Why an [[aged]] path may never be cleared, or None.

    Never a filesystem root, the home folder or its ancestors, and never a folder that is,
    holds or sits inside a checkout, a repository's git folder or T3 Code's worktree folder:
    those have their own rules.
    """
    resolved = _key(path)
    if os.path.dirname(resolved) == resolved:
        return "a filesystem root"
    home = _key(Path.home())
    if _within(home, resolved):
        return "the home folder or one of its ancestors"
    for item in protected or []:
        other = _key(item)
        if _within(other, resolved) or _within(resolved, other):
            return f"it is, holds or sits inside {item}"
    return None


def _bucket_leaves(bucket: Path) -> list[Path] | None:
    """Workspace hash directories inside a Cargo `<2-hex>/<hash>` bucket, or None if `bucket`
    is not a non-empty hash bucket holding only hex workspace directories."""
    if not HASH_BUCKET.match(bucket.name):
        return None
    try:
        children = list(each("reading", bucket, os.scandir(bucket)))
    except OSError:
        return None
    leaves: list[Path] = []
    for child in children:
        if (
            child.name in BUCKET_IGNORED_FILES
            and not is_link(child)
            and not child.is_dir(follow_symlinks=False)
        ):
            continue
        if (
            is_link(child)
            or not child.is_dir(follow_symlinks=False)
            or not HASH_LEAF.match(child.name)
        ):
            return None
        leaves.append(Path(child.path))
    return sorted(leaves) if leaves else None


def _aged_items(pattern: str, protected: list[Path]) -> tuple[list[Path], str | None]:
    """The entries an [[aged]] pattern names, or why the pattern itself is refused."""
    base, depth, raw = parse_aged_pattern(pattern)
    if not raw.strip() or not base.is_absolute():
        return [], "an [[aged]] path must be absolute"
    refused = unsafe_aged_root(base, protected)
    if refused:
        return [], refused
    if depth == 0:
        return ([base] if exists(base) else []), None
    try:
        found = list(each("reading", base, os.scandir(base)))
    except OSError:
        return [], None
    items: list[Path] = []
    if depth == 1:
        for entry in found:
            if is_link(entry):
                continue
            child = Path(entry.path)
            if entry.is_dir(follow_symlinks=False) and unsafe_aged_root(child, protected) is None:
                leaves = _bucket_leaves(child)
                if leaves is not None:
                    items.extend(leaves)
                    continue
            items.append(child)
        return sorted(items), None
    for entry in found:
        if is_link(entry) or not entry.is_dir(follow_symlinks=False):
            continue
        mid = Path(entry.path)
        if unsafe_aged_root(mid, protected) is not None:
            continue
        try:
            grandchildren = list(each("reading", mid, os.scandir(mid)))
        except OSError:
            continue
        items.extend(Path(e.path) for e in grandchildren if not is_link(e))
    return sorted(items), None


def report_aged(
    settings: MachineSettings, now: float, deadline: float, protected: list[Path] | None = None,
    processes: Processes | None = None,
) -> list[dict]:
    """Each [[aged]] folder's entries, their ages and sizes, and which are past a limit."""
    rows = []
    protected = protected or []
    for aged in settings.aged:
        entries = []
        items, refused_pattern = _aged_items(aged.path, protected)
        for item in items:
            refused = unsafe_aged_root(item, protected)
            if refused is None and processes is not None:
                refused = busy_reason(item, processes)
            modified = newest_mtime(item, AGED_DEPTH)
            entries.append({
                "path": str(item),
                "mtime": modified,
                "age_days": None if modified is None else round((now - modified) / DAY, 2),
                "bytes": None if refused else allocated(item, deadline),
                "eligible": False,
                "refused": refused,
            })
        _mark_eligible(entries, aged.max_age_days, aged.max_gb)
        reclaim = sum(e["bytes"] or 0 for e in entries if e["eligible"])
        rows.append({
            "name": f"aged:{aged.path}",
            "path": aged.path,
            "refused": refused_pattern,
            "max_age_days": aged.max_age_days,
            "max_gb": aged.max_gb,
            "entries": entries,
            "reclaimable_bytes": reclaim,
        })
    return rows


def _mark_eligible(entries: list[dict], max_age: float | None, max_gb: float | None) -> None:
    for entry in entries:
        if entry["refused"] or entry["age_days"] is None:
            continue
        if max_age is not None and entry["age_days"] >= max_age:
            entry["eligible"] = True
    if max_gb is None:
        return
    remaining = sum(e["bytes"] or 0 for e in entries if not e["eligible"])
    limit = max_gb * 1024**3
    oldest_first = sorted(
        (
            e
            for e in entries
            if not e["eligible"] and not e["refused"] and e["age_days"] is not None
        ),
        key=lambda e: e["mtime"] if e.get("mtime") is not None else -(e["age_days"] or 0),
    )
    for entry in oldest_first:
        if remaining <= limit:
            break
        entry["eligible"] = True
        remaining -= entry["bytes"] or 0
