"""Package manager connector for npm, pnpm, pip, uv, and cargo operations.

Supports detection of installed package managers and provides a unified
interface for dependency listing and installation.

Example:
    >>> from afd.connectors.package_manager import PackageManagerConnector, detect_package_manager
    >>> pm_type = await detect_package_manager()
    >>> pm = PackageManagerConnector(pm_type)
    >>> result = await pm.install()
"""

from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel

from afd.platform import ExecOptions, ExecResult, exec_command, is_exec_error


# ═══════════════════════════════════════════════════════════════════════════════
# TYPES
# ═══════════════════════════════════════════════════════════════════════════════


PackageManager = Literal["npm", "pnpm", "pip", "uv", "cargo"]
"""Supported package managers."""


class PackageManagerConnectorOptions(BaseModel):
    """Options for PackageManagerConnector.

    Attributes:
        debug: Enable debug logging of commands.
        cwd: Working directory for commands.
    """

    debug: bool = False
    cwd: Optional[str] = None


class Dependency(BaseModel):
    """Represents an installed dependency.

    Attributes:
        name: Package name.
        version: Installed version string.
    """

    name: str
    version: str


# ═══════════════════════════════════════════════════════════════════════════════
# DETECTION
# ═══════════════════════════════════════════════════════════════════════════════


async def detect_package_manager(cwd: Optional[str] = None) -> Optional[PackageManager]:
    """Detect the project's package manager by checking for lockfiles and CLI availability.

    Detection order:
    1. pnpm (pnpm-lock.yaml)
    2. npm (package-lock.json)
    3. uv (uv.lock)
    4. pip (requirements.txt or setup.py)
    5. cargo (Cargo.lock)

    Falls back to CLI availability checks if no lockfile is found.

    Args:
        cwd: Directory to search for lockfiles. Defaults to current directory.

    Returns:
        The detected PackageManager, or None if none detected.

    Example:
        >>> pm = await detect_package_manager()
        >>> pm in ("npm", "pnpm", "pip", "uv", "cargo") or pm is None
        True
    """
    from pathlib import Path

    search_dir = Path(cwd) if cwd else Path.cwd()

    # Check lockfiles first (most reliable)
    lockfile_map: list[tuple[str, PackageManager]] = [
        ("pnpm-lock.yaml", "pnpm"),
        ("package-lock.json", "npm"),
        ("uv.lock", "uv"),
        ("requirements.txt", "pip"),
        ("setup.py", "pip"),
        ("Cargo.lock", "cargo"),
    ]

    for lockfile, pm_type in lockfile_map:
        if (search_dir / lockfile).is_file():
            return pm_type

    # Fallback: check CLI availability
    cli_checks: list[tuple[list[str], PackageManager]] = [
        (["pnpm", "--version"], "pnpm"),
        (["npm", "--version"], "npm"),
        (["uv", "--version"], "uv"),
        (["pip", "--version"], "pip"),
        (["cargo", "--version"], "cargo"),
    ]

    for cmd, pm_type in cli_checks:
        result = await exec_command(cmd, ExecOptions(timeout=5000))
        if not is_exec_error(result):
            return pm_type

    return None


# ═══════════════════════════════════════════════════════════════════════════════
# PACKAGE MANAGER CONNECTOR
# ═══════════════════════════════════════════════════════════════════════════════


class PackageManagerConnector:
    """Connector for package manager operations.

    Supports npm, pnpm, pip, uv, and cargo ecosystems with a unified interface
    for install, add, remove, list, and run operations.

    Example:
        >>> pm = PackageManagerConnector("pnpm", PackageManagerConnectorOptions(debug=True))
        >>> result = await pm.install()
        >>> pm.is_success(result)
        True
    """

    def __init__(
        self,
        pm: PackageManager = "npm",
        options: Optional[PackageManagerConnectorOptions] = None,
    ) -> None:
        self._pm: PackageManager = pm
        self._options = options

    @property
    def pm(self) -> PackageManager:
        """The package manager type."""
        return self._pm

    async def install(self, pkg: Optional[str] = None, dev: bool = False) -> ExecResult:
        """Install dependencies.

        Args:
            pkg: Optional package name to install. If None, installs all project dependencies.
            dev: If True, install as dev dependency.

        Returns:
            ExecResult from the install command.

        Example:
            >>> result = await pm.install()          # install all
            >>> result = await pm.install("lodash")  # install specific package
        """
        if self._pm in ("npm", "pnpm"):
            cmd: list[str] = [self._pm, "install"]
            if pkg:
                cmd.append(pkg)
            if dev:
                cmd.append("--save-dev")
        elif self._pm == "uv":
            if pkg:
                cmd = ["uv", "pip", "install", pkg]
            else:
                cmd = ["uv", "pip", "install", "-r", "requirements.txt"]
        elif self._pm == "pip":
            if pkg:
                cmd = ["pip", "install", pkg]
            else:
                cmd = ["pip", "install", "-r", "requirements.txt"]
        elif self._pm == "cargo":
            if pkg:
                cmd = ["cargo", "add", pkg]
            else:
                cmd = ["cargo", "build"]
        else:
            cmd = [self._pm, "install"]

        return await self._exec_pm(cmd)

    async def add(self, pkg: str, dev: bool = False) -> ExecResult:
        """Add a package to dependencies.

        Args:
            pkg: Package name (with optional version).
            dev: If True, add as dev dependency.

        Returns:
            ExecResult from the add command.

        Example:
            >>> result = await pm.add("lodash")
            >>> result = await pm.add("vitest", dev=True)
        """
        if self._pm in ("npm", "pnpm"):
            cmd: list[str] = [self._pm, "add", pkg]
            if dev:
                cmd.append("--save-dev")
        elif self._pm == "uv":
            cmd = ["uv", "pip", "install", pkg]
        elif self._pm == "pip":
            cmd = ["pip", "install", pkg]
        elif self._pm == "cargo":
            cmd = ["cargo", "add", pkg]
            if dev:
                cmd.append("--dev")
        else:
            cmd = [self._pm, "add", pkg]

        return await self._exec_pm(cmd)

    async def remove(self, pkg: str) -> ExecResult:
        """Remove a package from dependencies.

        Args:
            pkg: Package name to remove.

        Returns:
            ExecResult from the remove command.

        Example:
            >>> result = await pm.remove("lodash")
        """
        if self._pm in ("npm", "pnpm"):
            cmd: list[str] = [self._pm, "remove", pkg]
        elif self._pm == "uv":
            cmd = ["uv", "pip", "uninstall", pkg]
        elif self._pm == "pip":
            cmd = ["pip", "uninstall", "-y", pkg]
        elif self._pm == "cargo":
            cmd = ["cargo", "remove", pkg]
        else:
            cmd = [self._pm, "remove", pkg]

        return await self._exec_pm(cmd)

    async def list_deps(self) -> list[Dependency]:
        """List installed dependencies.

        Returns:
            List of Dependency objects with name and version.

        Raises:
            RuntimeError: If the list command fails.

        Example:
            >>> deps = await pm.list_deps()
            >>> for dep in deps:
            ...     print(f"{dep.name}@{dep.version}")
        """
        import json as json_mod

        if self._pm in ("npm", "pnpm"):
            cmd: list[str] = [self._pm, "list", "--json", "--depth=0"]
            result = await self._exec_pm(cmd)
            if is_exec_error(result):
                raise RuntimeError(
                    f"Failed to list dependencies: {result.stderr or result.error_code}"
                )
            data = json_mod.loads(result.stdout)
            deps: list[Dependency] = []
            dep_map = data.get("dependencies", {})
            for name, info in dep_map.items():
                version = info.get("version", "unknown") if isinstance(info, dict) else "unknown"
                deps.append(Dependency(name=name, version=version))
            return deps

        elif self._pm == "uv":
            cmd = ["uv", "pip", "list", "--format=json"]
            result = await self._exec_pm(cmd)
            if is_exec_error(result):
                raise RuntimeError(
                    f"Failed to list dependencies: {result.stderr or result.error_code}"
                )
            packages = json_mod.loads(result.stdout)
            return [
                Dependency(name=pkg["name"], version=pkg["version"])
                for pkg in packages
            ]

        elif self._pm == "pip":
            cmd = ["pip", "list", "--format=json"]
            result = await self._exec_pm(cmd)
            if is_exec_error(result):
                raise RuntimeError(
                    f"Failed to list dependencies: {result.stderr or result.error_code}"
                )
            packages = json_mod.loads(result.stdout)
            return [
                Dependency(name=pkg["name"], version=pkg["version"])
                for pkg in packages
            ]

        elif self._pm == "cargo":
            cmd = ["cargo", "metadata", "--format-version=1", "--no-deps"]
            result = await self._exec_pm(cmd)
            if is_exec_error(result):
                raise RuntimeError(
                    f"Failed to list dependencies: {result.stderr or result.error_code}"
                )
            metadata = json_mod.loads(result.stdout)
            return [
                Dependency(name=pkg["name"], version=pkg["version"])
                for pkg in metadata.get("packages", [])
            ]

        raise RuntimeError(f"Unsupported package manager for list_deps: {self._pm}")

    async def run(self, script: str) -> ExecResult:
        """Run a package.json script (npm/pnpm only).

        Args:
            script: Script name from package.json.

        Returns:
            ExecResult from the run command.

        Example:
            >>> result = await pm.run("build")
        """
        if self._pm in ("npm", "pnpm"):
            cmd: list[str] = [self._pm, "run", script]
        elif self._pm == "cargo":
            # cargo run is the closest equivalent to npm run
            _CARGO_ALLOWED = frozenset({"run", "build", "test", "bench", "check", "clippy", "fmt"})
            if script not in _CARGO_ALLOWED:
                raise RuntimeError(
                    f"cargo subcommand '{script}' is not allowed. "
                    f"Allowed: {', '.join(sorted(_CARGO_ALLOWED))}"
                )
            cmd = ["cargo", script]
        else:
            raise RuntimeError(f"run() is not supported for {self._pm}")

        return await self._exec_pm(cmd)

    def is_success(self, result: ExecResult) -> bool:
        """Check if a command succeeded.

        Args:
            result: ExecResult to check.

        Returns:
            True if the command succeeded.

        Example:
            >>> result = await pm.install()
            >>> pm.is_success(result)
            True
        """
        return not is_exec_error(result)

    async def _exec_pm(self, cmd: list[str]) -> ExecResult:
        """Execute a package manager command."""
        exec_opts = ExecOptions()

        if self._options:
            if self._options.debug:
                exec_opts.debug = True
            if self._options.cwd:
                exec_opts.cwd = self._options.cwd

        return await exec_command(cmd, exec_opts)
