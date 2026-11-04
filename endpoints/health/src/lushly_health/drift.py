"""Read-only dependency drift over a target's lockfiles; standard library only.

A package resolved at several versions is common and usually harmless when it comes in
transitively, so only *direct* dependencies warn: those are the versions a workspace
chose and can align. Every other split is counted, not listed. Lockfiles record what
resolved, so ranges that disagree show up here as the versions they resolved to.
"""

from __future__ import annotations

import os
import re
import tomllib
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

LOCKFILES = {"pnpm-lock.yaml": "npm", "uv.lock": "pypi", "Cargo.lock": "cargo"}
EVIDENCE_PATHS = tuple(f"**/{name}" for name in LOCKFILES)
# Installed or generated trees hold other projects' lockfiles, not this target's.
_PRUNED = {"node_modules", "target", "dist", "build", "venv", "__pycache__"}
_SAMPLE = 10
_PNPM_KEY = re.compile(r"^  '?(.+@[^@':]+)'?:\s*(?:\{\})?$")
_PNPM_IMPORTER_DEP = re.compile(r"^ {6}'?([^':]+)'?:$")
_PNPM_IMPORTER_VERSION = re.compile(r"^ {8}version: '?([^'\s]+)'?$")
_PNPM_GROUPS = {"dependencies:", "devDependencies:", "optionalDependencies:"}


@dataclass
class _Resolved:
    """Versions per package name within one ecosystem."""

    everything: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    direct: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))


def _find_lockfiles(root: Path) -> list[Path]:
    found = []
    for current, directories, files in os.walk(root):
        directories[:] = sorted(
            name for name in directories if name not in _PRUNED and not name.startswith(".")
        )
        found.extend(Path(current, name) for name in sorted(files) if name in LOCKFILES)
    return found


def _read_pnpm(text: str, resolved: _Resolved) -> None:
    section = None
    in_group = False
    name = None
    for line in text.splitlines():
        if line and not line.startswith((" ", "#")):
            section = line.rstrip(":")
            continue
        if section == "packages":
            match = _PNPM_KEY.match(line)
            if match:
                package, version = match.group(1).rsplit("@", 1)
                resolved.everything[package].add(version.split("(")[0])
        elif section == "importers":
            if line.startswith("    ") and not line.startswith("     "):
                in_group = line.strip() in _PNPM_GROUPS
            elif in_group and (dep := _PNPM_IMPORTER_DEP.match(line)):
                name = dep.group(1)
            elif in_group and name and (found := _PNPM_IMPORTER_VERSION.match(line)):
                version = found.group(1).split("(")[0]
                # Workspace links and local files are the workspace itself, not a resolution.
                if not version.startswith(("link:", "file:", "workspace:")):
                    package, _, aliased = version.rpartition("@")
                    resolved.direct[package or name].add(aliased)
                name = None


def _local_dependency_names(package: dict) -> list[dict]:
    rows = list(package.get("dependencies", []))
    for table in ("optional-dependencies", "dev-dependencies"):
        for group in package.get(table, {}).values():
            rows.extend(group)
    return rows


def _read_uv(text: str, resolved: _Resolved) -> None:
    packages = tomllib.loads(text).get("package", [])
    versions: dict[str, set[str]] = defaultdict(set)
    local = []
    for package in packages:
        source = package.get("source", {})
        if {"virtual", "editable", "directory"} & set(source):
            local.append(package)
        elif "version" in package:
            versions[package["name"]].add(package["version"])
    for name, found in versions.items():
        resolved.everything[name] |= found
    for package in local:
        for row in _local_dependency_names(package):
            name = row["name"]
            # uv names the version only when one lockfile holds several.
            chosen = {row["version"]} if "version" in row else versions.get(name, set())
            resolved.direct[name] |= chosen


def _read_cargo(text: str, resolved: _Resolved) -> None:
    packages = tomllib.loads(text).get("package", [])
    versions: dict[str, set[str]] = defaultdict(set)
    local = []
    for package in packages:
        if "source" in package:
            versions[package["name"]].add(package["version"])
        else:
            local.append(package)
    for name, found in versions.items():
        resolved.everything[name] |= found
    for package in local:
        for row in package.get("dependencies", []):
            name, _, rest = row.partition(" ")
            # Cargo names the version only when one lockfile holds several.
            chosen = {rest.split(" ")[0]} if rest else versions.get(name, set())
            resolved.direct[name] |= chosen


_READERS = {"npm": _read_pnpm, "pypi": _read_uv, "cargo": _read_cargo}


def _splits(table: dict[str, set[str]]) -> dict[str, set[str]]:
    return {name: found for name, found in table.items() if len(found) > 1}


def check_dependency_version_drift(path: Path, lang: str) -> dict[str, str | None]:
    """Report direct dependencies resolved at several versions across the target's lockfiles."""
    lockfiles = _find_lockfiles(path)
    if not lockfiles:
        return {"status": "skipped", "message": "No supported lockfile found"}
    ecosystems: dict[str, _Resolved] = defaultdict(_Resolved)
    for lockfile in lockfiles:
        ecosystem = LOCKFILES[lockfile.name]
        _READERS[ecosystem](lockfile.read_text(encoding="utf-8"), ecosystems[ecosystem])

    direct = sorted(
        (ecosystem, name, sorted(found))
        for ecosystem, resolved in ecosystems.items()
        for name, found in _splits(resolved.direct).items()
    )
    overall = sum(len(_splits(resolved.everything)) for resolved in ecosystems.values())
    scanned = f"{len(lockfiles)} lockfile{'s' if len(lockfiles) != 1 else ''}"
    metric = f"direct={len(direct)} all={overall}"
    if not direct:
        return {
            "status": "pass",
            "message": (
                f"No direct dependency resolves to several versions in {scanned}; "
                f"{overall} packages split overall"
            ),
            "metric": metric,
        }
    sample = "; ".join(
        f"{name} ({ecosystem}): {', '.join(found)}" for ecosystem, name, found in direct[:_SAMPLE]
    )
    more = f"; and {len(direct) - _SAMPLE} more" if len(direct) > _SAMPLE else ""
    return {
        "status": "warn",
        "message": (
            f"{len(direct)} direct dependencies resolve to several versions in {scanned}: "
            f"{sample}{more}. {overall} packages split overall"
        ),
        "suggestion": "Align these dependencies, or keep the split where it is deliberate",
        "metric": metric,
    }
