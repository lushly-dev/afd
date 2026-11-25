"""Shared test fixtures for botcore."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ConfigDict

from botcore.plugin import PluginRegistry


@pytest.fixture(autouse=True)
def _no_real_skill_usage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """No test reads this machine's T3 Code store or its Claude Code transcripts, or writes
    its skill usage record, its shared folder least of all: the scheduled job collects, and
    several tests run that job."""
    monkeypatch.setenv("BOTCORE_SKILL_USAGE_T3_STORE", "")
    monkeypatch.setenv("BOTCORE_SKILL_USAGE_CLAUDE_DIR", "")
    monkeypatch.setenv("BOTCORE_SKILL_USAGE_STATE", str(tmp_path / "skill-usage-record"))
    monkeypatch.setenv("BOTCORE_SKILL_USAGE_SHARED", "")
    monkeypatch.setenv("BOTCORE_SKILL_USAGE_AWAY", "")
    monkeypatch.setenv("BOTCORE_SKILL_USAGE_MACHINE", "bench")
    # nor the gate outcome record
    monkeypatch.setenv("BOTCORE_GATE_OUTCOME_STATE", str(tmp_path / "gate-outcome-record"))


@pytest.fixture(autouse=True)
def _no_real_schedule(monkeypatch: pytest.MonkeyPatch) -> None:
    """No test asks this machine's scheduler whether the job is installed: on a development
    machine it is, and on a build machine it is not. A test that needs one says so."""
    from botcore.commands.disk import schedule

    monkeypatch.setattr(
        schedule,
        "current",
        lambda: schedule.ScheduleState(platform="test", installed=False, where=None),
    )


@pytest.fixture()
def tmp_workspace(tmp_path: Path) -> Path:
    """Create a temp workspace with a valid pyproject.toml [tool.botcore] section."""
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text(
        """\
[project]
name = "test-project"
version = "0.1.0"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.botcore]
file_size_warn = 400
coverage_threshold = 70
""",
        encoding="utf-8",
    )
    return tmp_path


@pytest.fixture()
def tmp_workspace_with_typo(tmp_path: Path) -> Path:
    """Create a temp workspace with an invalid config field (typo)."""
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text(
        """\
[project]
name = "test-project"
version = "0.1.0"

[tool.botcore]
file_size_wran = 300
""",
        encoding="utf-8",
    )
    return tmp_path


@pytest.fixture()
def tmp_workspace_botcore_toml(tmp_path: Path) -> Path:
    """Create a temp workspace with botcore.toml (no pyproject.toml)."""
    toml_file = tmp_path / "botcore.toml"
    toml_file.write_text(
        """\
file_size_warn = 600
coverage_threshold = 90
""",
        encoding="utf-8",
    )
    # Add a .git dir so find_workspace can find it
    (tmp_path / ".git").mkdir()
    return tmp_path


@pytest.fixture()
def tmp_workspace_with_packages(tmp_path: Path) -> Path:
    """Create a workspace with multiple packages."""
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text(
        """\
[project]
name = "test-monorepo"
version = "0.1.0"

[tool.botcore]
coverage_threshold = 80

[tool.botcore.packages."@test/core"]
coverage_threshold = 95

[tool.botcore.packages."@test/data"]
file_size_warn = 800
coverage_threshold = 60
""",
        encoding="utf-8",
    )

    # Create packages
    pkg_core = tmp_path / "packages" / "core"
    pkg_core.mkdir(parents=True)
    (pkg_core / "package.json").write_text(
        '{"name": "@test/core", "version": "1.0.0"}',
        encoding="utf-8",
    )

    pkg_data = tmp_path / "packages" / "data"
    pkg_data.mkdir(parents=True)
    (pkg_data / "package.json").write_text(
        '{"name": "@test/data", "version": "1.0.0"}',
        encoding="utf-8",
    )

    pkg_utils = tmp_path / "packages" / "utils"
    pkg_utils.mkdir(parents=True)
    (pkg_utils / "package.json").write_text(
        '{"name": "@test/utils", "version": "1.0.0"}',
        encoding="utf-8",
    )

    return tmp_path


@pytest.fixture()
def tmp_workspace_multilang(tmp_path: Path) -> Path:
    """Create a workspace with multi-language config (TS + Python + Rust)."""
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text(
        """\
[project]
name = "multi-lang-project"
version = "0.1.0"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.botcore]
language = "typescript"

[tool.botcore.language_config.typescript]

[tool.botcore.language_config.python]
root = "python/"

[tool.botcore.language_config.rust]
root = "packages/rust/"
""",
        encoding="utf-8",
    )
    # Create subdirectories
    (tmp_path / "python" / "src").mkdir(parents=True)
    (tmp_path / "packages" / "rust" / "src").mkdir(parents=True)
    (tmp_path / "src").mkdir(parents=True)
    return tmp_path


class _TestPluginConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    greeting: str = "hello"


class MockPlugin:
    """A test plugin implementing the BotCorePlugin protocol."""

    def register(self, registry: PluginRegistry) -> None:
        async def test_command() -> dict[str, Any]:
            return {"message": "from mock plugin"}

        registry.add_commands([test_command])
        registry.set_cli_name("test-bot")

    def config_schema(self) -> type[BaseModel] | None:
        return _TestPluginConfig


@pytest.fixture()
def mock_plugin() -> MockPlugin:
    return MockPlugin()


def isolate_cargo_configs(monkeypatch: pytest.MonkeyPatch, root: Path) -> None:
    """Confine Cargo config discovery to `root` so host configs above TMPDIR never leak."""
    from botcore.commands.disk import cargo

    resolved = root.resolve()
    real_in_folder = cargo._Configs.in_folder

    def in_root(self: cargo._Configs, cargo_dir: Path) -> Path | None:
        try:
            if not cargo_dir.resolve().is_relative_to(resolved):
                return None
        except OSError:
            return None
        return real_in_folder(self, cargo_dir)

    monkeypatch.setattr(cargo._Configs, "in_folder", in_root)


@pytest.fixture(autouse=True)
def _no_host_cargo_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep host Cargo configs out of tests when TMPDIR sits inside $HOME
    (lushly-dev/afd#1954): Cargo's ancestor walk from tmp_path would otherwise reach
    ~/.cargo/config.toml."""
    isolate_cargo_configs(monkeypatch, tmp_path)


@pytest.fixture(autouse=True)
def _isolate_git_routing(monkeypatch):
    """Keep hook-injected Git routing out of child fixtures; restore caller state."""
    import os

    for key in tuple(os.environ):
        if key.startswith("GIT_"):
            monkeypatch.delenv(key)
