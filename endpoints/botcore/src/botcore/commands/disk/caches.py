"""Tier 0: tool caches pruned with each tool's own command, and aged cache folders."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from botcore.commands.disk.scan import DAY, Processes, allocated, busy_reason, newest_mtime
from botcore.commands.disk.settings import MachineSettings, expand


def _tool_out(args: list[str], cwd: Path | None) -> str | None:
    exe = shutil.which(args[0])
    if exe is None:
        return None
    try:
        done = subprocess.run(
            [exe, *args[1:]], cwd=cwd, capture_output=True, text=True, timeout=60, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    out = done.stdout.strip()
    return out if done.returncode == 0 and out else None


def pnpm_link_mode(checkouts: list[Path]) -> str:
    """How pnpm put packages into these checkouts: "hardlink", "clone-or-copy" or "unknown".

    `pnpm store prune` deletes every store file with one link, taking it to mean no project
    uses it. Clones and copies always have one link, so prune is only safe with hard links.
    """
    for checkout in checkouts:
        store = checkout / "node_modules" / ".pnpm"
        if not store.is_dir():
            continue
        seen = 0
        for package_json in store.glob("*/node_modules/*/package.json"):
            try:
                links = package_json.stat().st_nlink
            except OSError:
                continue
            if links > 1:
                return "hardlink"
            seen += 1
            if seen >= 20:
                return "clone-or-copy"
        if seen:
            return "clone-or-copy"
    return "unknown"


def pnpm_store_dir(checkouts: list[Path]) -> str | None:
    """The store an install used, from its node_modules/.modules.yaml.

    Read from the install's own record rather than `pnpm store path`, which writes probe files.
    """
    for checkout in checkouts:
        manifest = checkout / "node_modules" / ".modules.yaml"
        try:
            text = manifest.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            key, _, value = line.partition(":")
            if key.strip() == "storeDir" and value.strip():
                return value.strip().strip("'\"")
    return None


def _pnpm(repos: list[Path], deadline: float) -> dict | None:
    store = pnpm_store_dir(repos)
    if store is None:
        return None
    mode = pnpm_link_mode(repos)
    row = {
        "name": "pnpm",
        "path": store,
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
    return row


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
    if not path.is_dir():
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
        "uv": lambda: _uv(deadline),
        "playwright": lambda: _playwright(deadline),
    }
    rows = []
    for name in settings.caches:
        maker = makers.get(name)
        if maker is None:
            rows.append({"name": name, "error": "unknown cache name"})
            continue
        row = maker()
        if row is not None:
            rows.append(row)
    return rows


def _key(path: Path | str) -> str:
    return os.path.normcase(os.path.realpath(os.path.abspath(str(path))))


def _within(inner: str, outer: str) -> bool:
    return inner == outer or inner.startswith(outer.rstrip(os.sep) + os.sep)


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


def _aged_items(pattern: str, protected: list[Path]) -> tuple[list[Path], str | None]:
    """The entries an [[aged]] pattern names, or why the pattern itself is refused."""
    text = pattern.rstrip()
    wildcard = text.endswith("/*") or text.endswith("\\*")
    base = expand(text[:-2] if wildcard else text)
    if not text[:-2 if wildcard else None].strip() or not base.is_absolute():
        return [], "an [[aged]] path must be absolute"
    refused = unsafe_aged_root(base, protected)
    if refused:
        return [], refused
    if not wildcard:
        return ([base] if base.exists() else []), None
    try:
        return sorted(Path(e.path) for e in os.scandir(base) if not e.is_symlink()), None
    except OSError:
        return [], None


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
            modified = newest_mtime(item)
            entries.append({
                "path": str(item),
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
        (e for e in entries if not e["eligible"] and not e["refused"]),
        key=lambda e: -(e["age_days"] or 0),
    )
    for entry in oldest_first:
        if remaining <= limit:
            break
        entry["eligible"] = True
        remaining -= entry["bytes"] or 0
