"""Dependency discovery and PyPI version checks behind ``dev_check_deps``."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from afd import CommandResult, error, success


def _parse_version(version: str) -> tuple[int, int, int]:
    """Parse version string into (major, minor, patch) tuple."""
    match = re.match(r"(\d+)(?:\.(\d+))?(?:\.(\d+))?", version)
    if not match:
        return (0, 0, 0)
    major = int(match.group(1)) if match.group(1) else 0
    minor = int(match.group(2)) if match.group(2) else 0
    patch = int(match.group(3)) if match.group(3) else 0
    return (major, minor, patch)


def _collect_staged_deps(ws: Path) -> list[str]:
    """Collect dependency names from staged git changes."""
    packages: list[str] = []

    result = subprocess.run(
        ["git", "diff", "--cached", "--unified=0", "pyproject.toml"],
        cwd=ws,
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        for line in result.stdout.splitlines():
            if line.startswith("+") and not line.startswith("+++"):
                matches = re.findall(r'["\']?([a-zA-Z0-9_-]+)(?:[>=<\[].+)?["\']?,?', line)
                for match in matches:
                    if match and not match.startswith("#"):
                        packages.append(match.lower())

    req_file = ws / "requirements.txt"
    if req_file.exists():
        result = subprocess.run(
            ["git", "diff", "--cached", "--unified=0", "requirements.txt"],
            cwd=ws,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                if line.startswith("+") and not line.startswith("+++"):
                    match = re.match(r"\+([a-zA-Z0-9_-]+)", line)
                    if match:
                        packages.append(match.group(1).lower())

    return packages


def _collect_all_deps(ws: Path) -> list[str]:
    """Collect all declared dependency names from pyproject.toml."""
    import tomllib

    packages: list[str] = []
    pyproject = ws / "pyproject.toml"
    if pyproject.exists():
        data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
        deps = data.get("project", {}).get("dependencies", [])
        for dep in deps:
            match = re.match(r"([a-zA-Z0-9_-]+)", dep)
            if match:
                packages.append(match.group(1).lower())
    return packages


async def _check_pkg_version(
    pkg: str,
    client: object,
    max_major: int,
    max_minor: int,
    outdated: list[str],
    errors: list[dict],
    warnings: list[dict],
) -> None:
    """Check a single package against PyPI and classify staleness."""
    result = subprocess.run(["pip", "show", pkg], capture_output=True, text=True)
    if result.returncode != 0:
        return

    installed_version = None
    for line in result.stdout.splitlines():
        if line.startswith("Version:"):
            installed_version = line.split(":", 1)[1].strip()
            break
    if not installed_version:
        return

    response = await client.get(f"https://pypi.org/pypi/{pkg}/json")  # type: ignore[union-attr]
    if response.status_code != 200:
        return

    latest_version = response.json().get("info", {}).get("version", "")
    if not latest_version:
        return

    installed_parts = _parse_version(installed_version)
    latest_parts = _parse_version(latest_version)
    major_behind = latest_parts[0] - installed_parts[0]
    minor_behind = latest_parts[1] - installed_parts[1] if major_behind == 0 else 0

    if major_behind > max_major:
        errors.append(
            {
                "package": pkg,
                "installed": installed_version,
                "latest": latest_version,
                "major_behind": major_behind,
            }
        )
        outdated.append(pkg)
    elif major_behind > 0 or minor_behind > max_minor:
        warnings.append(
            {
                "package": pkg,
                "installed": installed_version,
                "latest": latest_version,
                "major_behind": major_behind,
                "minor_behind": minor_behind,
            }
        )
        outdated.append(pkg)


async def _check_pypi_deps(
    ws: Path,
    config: object,
    staged_only: bool,
) -> CommandResult[dict]:
    """Check Python dependencies against PyPI."""
    try:
        import httpx
    except ImportError:
        return error(
            "MISSING_HTTPX",
            "httpx package required for dependency checking",
            suggestion="Install with: pip install botcore[quality]",
        )

    packages_to_check = _collect_staged_deps(ws) if staged_only else _collect_all_deps(ws)

    if not packages_to_check:
        return success(
            data={"checked": 0, "outdated": [], "errors": [], "warnings": []},
            reasoning="No new Python dependencies to check",
        )

    packages_to_check = list(set(packages_to_check))
    outdated: list[str] = []
    errors: list[dict] = []
    warnings: list[dict] = []

    async with httpx.AsyncClient(timeout=10.0) as client:
        for pkg in packages_to_check:
            try:
                await _check_pkg_version(
                    pkg,
                    client,
                    config.deps_max_major_behind,  # type: ignore[attr-defined]
                    config.deps_max_minor_behind,  # type: ignore[attr-defined]
                    outdated,
                    errors,
                    warnings,
                )
            except Exception:
                continue

    result_data = {
        "checked": len(packages_to_check),
        "packages": packages_to_check,
        "outdated": outdated,
        "errors": errors,
        "warnings": warnings,
    }

    if errors:
        pkg_list = ", ".join(f"{e['package']} ({e['installed']} → {e['latest']})" for e in errors)
        return error(
            "DEPS_TOO_OLD",
            f"Packages significantly outdated: {pkg_list}",
            suggestion="Update with: pip install --upgrade "
            + " ".join(e["package"] for e in errors),
        )

    if warnings:
        pkg_list = ", ".join(w["package"] for w in warnings)
        return success(
            data=result_data,
            reasoning=f"{len(warnings)} package(s) behind latest: {pkg_list}",
        )

    return success(
        data=result_data,
        reasoning=f"All {len(packages_to_check)} checked packages are up-to-date",
    )
