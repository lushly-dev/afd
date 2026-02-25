"""Tests for afd.connectors.package_manager module."""

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from afd.connectors.package_manager import (
    Dependency,
    PackageManager,
    PackageManagerConnector,
    PackageManagerConnectorOptions,
    detect_package_manager,
)
from afd.platform import ExecErrorCode, ExecResult, create_exec_result


# ═══════════════════════════════════════════════════════════════════════════════
# PACKAGE MANAGER TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class TestPackageManagerTypes:
    """Tests for package manager Pydantic models."""

    def test_dependency_model(self):
        dep = Dependency(name="lodash", version="4.17.21")
        assert dep.name == "lodash"
        assert dep.version == "4.17.21"

    def test_connector_options_defaults(self):
        opts = PackageManagerConnectorOptions()
        assert opts.debug is False
        assert opts.cwd is None

    def test_connector_options_custom(self):
        opts = PackageManagerConnectorOptions(debug=True, cwd="/project")
        assert opts.debug is True
        assert opts.cwd == "/project"


# ═══════════════════════════════════════════════════════════════════════════════
# DETECT PACKAGE MANAGER
# ═══════════════════════════════════════════════════════════════════════════════


class TestDetectPackageManager:
    """Tests for detect_package_manager() across ecosystems."""

    async def test_detects_pnpm_from_lockfile(self, tmp_path):
        (tmp_path / "pnpm-lock.yaml").write_text("")
        result = await detect_package_manager(str(tmp_path))
        assert result == "pnpm"

    async def test_detects_npm_from_lockfile(self, tmp_path):
        (tmp_path / "package-lock.json").write_text("{}")
        result = await detect_package_manager(str(tmp_path))
        assert result == "npm"

    async def test_detects_uv_from_lockfile(self, tmp_path):
        (tmp_path / "uv.lock").write_text("")
        result = await detect_package_manager(str(tmp_path))
        assert result == "uv"

    async def test_detects_pip_from_requirements(self, tmp_path):
        (tmp_path / "requirements.txt").write_text("pydantic>=2.0\n")
        result = await detect_package_manager(str(tmp_path))
        assert result == "pip"

    async def test_detects_pip_from_setup_py(self, tmp_path):
        (tmp_path / "setup.py").write_text("from setuptools import setup\n")
        result = await detect_package_manager(str(tmp_path))
        assert result == "pip"

    async def test_detects_cargo_from_lockfile(self, tmp_path):
        (tmp_path / "Cargo.lock").write_text("")
        result = await detect_package_manager(str(tmp_path))
        assert result == "cargo"

    async def test_pnpm_takes_precedence_over_npm(self, tmp_path):
        (tmp_path / "pnpm-lock.yaml").write_text("")
        (tmp_path / "package-lock.json").write_text("{}")
        result = await detect_package_manager(str(tmp_path))
        assert result == "pnpm"

    async def test_returns_none_for_empty_dir_with_no_cli(self, tmp_path):
        # Mock all CLI checks to fail
        async def mock_exec_fail(cmd, opts=None):
            return create_exec_result("", "not found", 1, 0.0, ExecErrorCode.SPAWN_FAILED)

        with patch("afd.connectors.package_manager.exec_command", side_effect=mock_exec_fail):
            result = await detect_package_manager(str(tmp_path))
            assert result is None


# ═══════════════════════════════════════════════════════════════════════════════
# PACKAGE MANAGER CONNECTOR
# ═══════════════════════════════════════════════════════════════════════════════


class TestPackageManagerConnector:
    """Tests for PackageManagerConnector operations."""

    def _mock_exec(self, stdout="", stderr="", exit_code=0, error_code=None):
        result = create_exec_result(stdout, stderr, exit_code, 10.0, error_code)

        async def mock_fn(cmd, opts=None):
            return result

        return mock_fn

    def test_pm_property(self):
        pm = PackageManagerConnector("pnpm")
        assert pm.pm == "pnpm"

    def test_default_pm_is_npm(self):
        pm = PackageManagerConnector()
        assert pm.pm == "npm"

    async def test_install_all_npm(self):
        pm = PackageManagerConnector("npm")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.install()

        assert captured_cmds[0] == ["npm", "install"]

    async def test_install_package_pnpm(self):
        pm = PackageManagerConnector("pnpm")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.install("lodash")

        assert captured_cmds[0] == ["pnpm", "install", "lodash"]

    async def test_install_dev_npm(self):
        pm = PackageManagerConnector("npm")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.install("vitest", dev=True)

        assert "--save-dev" in captured_cmds[0]

    async def test_install_pip(self):
        pm = PackageManagerConnector("pip")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.install("pydantic")

        assert captured_cmds[0] == ["pip", "install", "pydantic"]

    async def test_install_all_pip(self):
        pm = PackageManagerConnector("pip")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.install()

        assert captured_cmds[0] == ["pip", "install", "-r", "requirements.txt"]

    async def test_install_uv(self):
        pm = PackageManagerConnector("uv")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.install("httpx")

        assert captured_cmds[0] == ["uv", "pip", "install", "httpx"]

    async def test_install_cargo(self):
        pm = PackageManagerConnector("cargo")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.install("serde")

        assert captured_cmds[0] == ["cargo", "add", "serde"]

    async def test_add_npm(self):
        pm = PackageManagerConnector("npm")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.add("lodash", dev=True)

        assert captured_cmds[0] == ["npm", "add", "lodash", "--save-dev"]

    async def test_remove_pnpm(self):
        pm = PackageManagerConnector("pnpm")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.remove("lodash")

        assert captured_cmds[0] == ["pnpm", "remove", "lodash"]

    async def test_remove_pip(self):
        pm = PackageManagerConnector("pip")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.remove("requests")

        assert captured_cmds[0] == ["pip", "uninstall", "-y", "requests"]

    async def test_list_deps_npm(self):
        pm = PackageManagerConnector("npm")
        deps_json = json.dumps({
            "dependencies": {
                "lodash": {"version": "4.17.21"},
                "express": {"version": "4.18.2"},
            }
        })
        mock = self._mock_exec(stdout=deps_json)

        with patch("afd.connectors.package_manager.exec_command", side_effect=mock):
            deps = await pm.list_deps()
            assert len(deps) == 2
            names = {d.name for d in deps}
            assert "lodash" in names
            assert "express" in names

    async def test_list_deps_pip(self):
        pm = PackageManagerConnector("pip")
        deps_json = json.dumps([
            {"name": "pydantic", "version": "2.6.0"},
            {"name": "httpx", "version": "0.27.0"},
        ])
        mock = self._mock_exec(stdout=deps_json)

        with patch("afd.connectors.package_manager.exec_command", side_effect=mock):
            deps = await pm.list_deps()
            assert len(deps) == 2
            assert deps[0].name == "pydantic"
            assert deps[0].version == "2.6.0"

    async def test_list_deps_uv(self):
        pm = PackageManagerConnector("uv")
        deps_json = json.dumps([
            {"name": "click", "version": "8.1.7"},
        ])
        mock = self._mock_exec(stdout=deps_json)

        with patch("afd.connectors.package_manager.exec_command", side_effect=mock):
            deps = await pm.list_deps()
            assert len(deps) == 1
            assert deps[0].name == "click"

    async def test_list_deps_cargo(self):
        pm = PackageManagerConnector("cargo")
        metadata = json.dumps({
            "packages": [
                {"name": "serde", "version": "1.0.200"},
            ]
        })
        mock = self._mock_exec(stdout=metadata)

        with patch("afd.connectors.package_manager.exec_command", side_effect=mock):
            deps = await pm.list_deps()
            assert len(deps) == 1
            assert deps[0].name == "serde"

    async def test_list_deps_failure(self):
        pm = PackageManagerConnector("npm")
        mock = self._mock_exec(stderr="error", exit_code=1, error_code=ExecErrorCode.EXIT_CODE)

        with patch("afd.connectors.package_manager.exec_command", side_effect=mock):
            with pytest.raises(RuntimeError, match="Failed to list dependencies"):
                await pm.list_deps()

    async def test_run_npm(self):
        pm = PackageManagerConnector("npm")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.run("build")

        assert captured_cmds[0] == ["npm", "run", "build"]

    async def test_run_cargo_restricted_to_allowlist(self):
        pm = PackageManagerConnector("cargo")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.run("build")

        assert captured_cmds[0] == ["cargo", "build"]

    async def test_run_cargo_rejects_unsafe_subcommands(self):
        pm = PackageManagerConnector("cargo")
        with pytest.raises(RuntimeError, match="not allowed"):
            await pm.run("publish")

    async def test_run_not_supported_for_pip(self):
        pm = PackageManagerConnector("pip")
        with pytest.raises(RuntimeError, match="not supported"):
            await pm.run("build")

    def test_is_success_true(self):
        pm = PackageManagerConnector("npm")
        result = create_exec_result("ok", "", 0, 10.0)
        assert pm.is_success(result) is True

    def test_is_success_false(self):
        pm = PackageManagerConnector("npm")
        result = create_exec_result("", "fail", 1, 10.0, ExecErrorCode.EXIT_CODE)
        assert pm.is_success(result) is False

    async def test_cwd_option_passed_through(self):
        pm = PackageManagerConnector("npm", PackageManagerConnectorOptions(cwd="/project"))
        captured_opts = []

        async def capture(cmd, opts=None):
            captured_opts.append(opts)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.install()

        assert captured_opts[0].cwd == "/project"

    async def test_debug_option_passed_through(self):
        pm = PackageManagerConnector("npm", PackageManagerConnectorOptions(debug=True))
        captured_opts = []

        async def capture(cmd, opts=None):
            captured_opts.append(opts)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.install()

        assert captured_opts[0].debug is True


# ═══════════════════════════════════════════════════════════════════════════════
# ROOT IMPORTS
# ═══════════════════════════════════════════════════════════════════════════════


class TestPackageManagerRootImports:
    """Tests that package manager connectors are importable from package root."""

    def test_package_manager_importable(self):
        from afd import PackageManagerConnector, PackageManagerConnectorOptions
        assert PackageManagerConnector is not None

    def test_detection_importable(self):
        from afd import detect_package_manager, Dependency
        assert callable(detect_package_manager)
        assert Dependency is not None
