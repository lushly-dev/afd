"""Tests for botcore CLI."""

from __future__ import annotations

import json
import tomllib
from pathlib import Path
from unittest.mock import AsyncMock, patch

from click.testing import CliRunner

import botcore
from botcore.cli import cli


async def _fake_plugin_command() -> dict[str, str]:
    return {"status": "ok"}


class _CliFakePlugin:
    def register(self, registry) -> None:
        registry.add_commands([_fake_plugin_command])

    def config_schema(self):
        return None


def test_version():
    runner = CliRunner()
    result = runner.invoke(cli, ["--version"])
    assert result.exit_code == 0
    assert "botcore" in result.output


def test_version_matches_pyproject():
    """`__version__` must track [project] version -- the CLI and MCP server report it.

    Regression: v0.4.0 bumped pyproject.toml but not `__version__`, so
    `botcore --version` and the MCP server handshake both advertised 0.3.5
    from a 0.4.0 package.
    """
    pyproject = Path(__file__).parent.parent / "pyproject.toml"
    declared = tomllib.loads(pyproject.read_text(encoding="utf-8"))["project"]["version"]
    assert botcore.__version__ == declared


def test_version_output_reports_the_real_version():
    runner = CliRunner()
    result = runner.invoke(cli, ["--version"])
    assert botcore.__version__ in result.output


def test_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["--help"])
    assert result.exit_code == 0
    assert "init" in result.output
    assert "serve" in result.output


def test_help_with_plugin_commands_registered():
    runner = CliRunner()
    with patch("botcore.plugin.discover_plugins", return_value={"fake": _CliFakePlugin()}):
        result = runner.invoke(cli, ["--help"])
    assert result.exit_code == 0
    assert "init" in result.output


def test_init_non_interactive(tmp_path):
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path) as td:
        # Create a .git dir so workspace detection works
        Path(td, ".git").mkdir()

        result = runner.invoke(cli, ["init", "--non-interactive"])
        assert result.exit_code == 0

        config_path = Path(td) / "botcore.toml"
        assert config_path.exists()

        content = config_path.read_text()
        assert "[skills]" in content
        assert 'source_dir = ".claude/skills"' in content


def test_init_non_interactive_json(tmp_path):
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path) as td:
        Path(td, ".git").mkdir()

        # --json works as subcommand flag (user-facing syntax)
        result = runner.invoke(cli, ["init", "--non-interactive", "--json"])
        assert result.exit_code == 0

        output = json.loads(result.output)
        assert output["status"] == "success"
        assert "config_path" in output
        assert "skills_seeded" in output
        assert "language" in output


def test_init_json_as_group_flag(tmp_path):
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path) as td:
        Path(td, ".git").mkdir()

        # --json also works as group flag (backward compat)
        result = runner.invoke(cli, ["--json", "init", "--non-interactive"])
        assert result.exit_code == 0

        output = json.loads(result.output)
        assert output["status"] == "success"


def test_init_skips_existing(tmp_path):
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path) as td:
        Path(td, ".git").mkdir()
        config = Path(td) / "botcore.toml"
        config.write_text("existing = true\n")

        result = runner.invoke(cli, ["init", "--non-interactive"])
        assert result.exit_code == 0
        assert "already exists" in result.output

        # File should be unchanged
        assert config.read_text() == "existing = true\n"


def test_init_skips_existing_json(tmp_path):
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path) as td:
        Path(td, ".git").mkdir()
        config = Path(td) / "botcore.toml"
        config.write_text("existing = true\n")

        result = runner.invoke(cli, ["init", "--non-interactive", "--json"])
        assert result.exit_code == 0

        output = json.loads(result.output)
        assert output["status"] == "skipped"
        assert "already exists" in output["reason"]


def test_init_force_overwrites(tmp_path):
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path) as td:
        Path(td, ".git").mkdir()
        config = Path(td) / "botcore.toml"
        config.write_text("existing = true\n")

        result = runner.invoke(cli, ["init", "--non-interactive", "--force"])
        assert result.exit_code == 0

        content = config.read_text()
        assert "existing = true" not in content
        assert "[skills]" in content


def test_init_language_override(tmp_path):
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path) as td:
        Path(td, ".git").mkdir()

        result = runner.invoke(cli, ["init", "--non-interactive", "--language", "typescript"])
        assert result.exit_code == 0

        config = Path(td) / "botcore.toml"
        content = config.read_text()
        assert 'language = "typescript"' in content
        assert 'linter = "biome"' in content
        assert 'test_runner = "vitest"' in content


def test_init_python_defaults(tmp_path):
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path) as td:
        Path(td, ".git").mkdir()

        result = runner.invoke(cli, ["init", "--non-interactive", "--language", "python"])
        assert result.exit_code == 0

        config = Path(td) / "botcore.toml"
        content = config.read_text()
        assert 'language = "python"' in content
        assert 'linter = "ruff"' in content
        assert 'test_runner = "pytest"' in content


def test_init_no_skills(tmp_path):
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path) as td:
        Path(td, ".git").mkdir()

        result = runner.invoke(cli, ["init", "--non-interactive", "--no-skills", "--json"])
        assert result.exit_code == 0

        output = json.loads(result.output)
        assert output["skills_seeded"] == 0


def test_init_extension_flags(tmp_path):
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path) as td:
        Path(td, ".git").mkdir()

        result = runner.invoke(
            cli, ["init", "--non-interactive", "--with-agents", "--with-llm", "--json"]
        )
        assert result.exit_code == 0

        output = json.loads(result.output)
        assert "agents" in output["extensions_selected"]
        assert "llm" in output["extensions_selected"]
        assert "memory" not in output["extensions_selected"]


def test_init_rejects_invalid_language(tmp_path):
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path) as td:
        Path(td, ".git").mkdir()

        result = runner.invoke(cli, ["init", "--non-interactive", "--language", "go"])
        assert result.exit_code != 0
        assert "Invalid value" in result.output or "invalid choice" in result.output.lower()


def test_serve_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["serve", "--help"])
    assert result.exit_code == 0
    assert "--name" in result.output
    assert "--transport" in result.output


def test_skill_seed_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["skill-seed", "--help"])
    assert result.exit_code == 0
    assert "--update" in result.output
    assert "--dry-run" in result.output


def test_skill_list_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["skill-list", "--help"])
    assert result.exit_code == 0
    assert "--show-source" in result.output


def test_skill_status_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["skill-status", "--help"])
    assert result.exit_code == 0


def test_info_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["info", "--help"])
    assert result.exit_code == 0


def test_info_json():
    runner = CliRunner()
    with patch("botcore.commands.info.find_workspace") as mock_ws:
        mock_ws.return_value = Path.cwd()
        with patch("botcore.commands.info.get_packages") as mock_pkg:
            mock_pkg.return_value = []
            result = runner.invoke(cli, ["info", "--json"])
            assert result.exit_code == 0
            output = json.loads(result.output)
            assert output["success"] is True
            assert "workspace_root" in output["data"]


def test_command_error_exit_code():
    """Commands that return error status should exit with code 1."""
    runner = CliRunner()
    mock_result = {
        "status": "error",
        "error": "NO_WORKSPACE",
        "suggestion": "Run from a git repo",
    }
    with patch("botcore.commands.info.info_workspace", new_callable=AsyncMock) as mock_cmd:
        mock_cmd.return_value = mock_result
        result = runner.invoke(cli, ["info"])
        assert result.exit_code == 1


def test_init_skill_seed_failure_is_non_fatal(tmp_path):
    """If skill_seed raises, init still succeeds with config created."""
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path) as td:
        Path(td, ".git").mkdir()

        with patch("botcore.commands.skill.seed.skill_seed", new_callable=AsyncMock) as mock:
            mock.side_effect = RuntimeError("plugin discovery failed")
            result = runner.invoke(cli, ["init", "--non-interactive"])
            assert result.exit_code == 0

            config = Path(td) / "botcore.toml"
            assert config.exists()
            assert "skill seeding failed" in result.output


def test_init_skill_seed_failure_json_still_succeeds(tmp_path):
    """In JSON mode, skill_seed failure still returns success with 0 skills."""
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path) as td:
        Path(td, ".git").mkdir()

        with patch("botcore.commands.skill.seed.skill_seed", new_callable=AsyncMock) as mock:
            mock.side_effect = RuntimeError("plugin discovery failed")
            result = runner.invoke(cli, ["init", "--non-interactive", "--json"])
            assert result.exit_code == 0

            output = json.loads(result.output)
            assert output["status"] == "success"
            assert output["skills_seeded"] == 0


def test_serve_missing_mcp_dependency():
    """serve should give a clear error when mcp is not installed."""
    runner = CliRunner()
    with patch.dict("sys.modules", {"mcp": None, "mcp.server.fastmcp": None}):
        with patch("botcore.server.create_mcp_server", side_effect=ImportError("no mcp")):
            result = runner.invoke(cli, ["serve"])
            assert result.exit_code == 1
            combined = result.output + str(result.exception or "")
            assert "mcp" in combined.lower()


# ── CommandResult normalization ──────────────────────────────────────────────


def test_skill_status_json_is_real_json(tmp_path):
    """--json must emit the dumped CommandResult, not a quoted Python repr."""
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path) as td:
        Path(td, ".git").mkdir()
        with patch("botcore.commands.skill.status.find_workspace", return_value=Path(td)):
            result = runner.invoke(cli, ["skill-status", "--json"])
        assert result.exit_code == 0, result.output
        output = json.loads(result.output)
        assert isinstance(output, dict)
        assert output["success"] is True
        assert "data" in output


def test_skill_list_json_is_real_json(tmp_path):
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path) as td:
        Path(td, ".git").mkdir()
        with patch("botcore.commands.skill.list.find_workspace", return_value=Path(td)):
            result = runner.invoke(cli, ["skill-list", "--json"])
        assert result.exit_code == 0, result.output
        output = json.loads(result.output)
        assert isinstance(output, dict)
        assert output["success"] is True


def test_skill_status_no_workspace_exits_nonzero():
    """A CommandResult error (success=False) must exit 1 and show code + hint."""
    runner = CliRunner()
    with patch("botcore.commands.skill.status.find_workspace", return_value=None):
        result = runner.invoke(cli, ["skill-status"])
    assert result.exit_code == 1
    assert "NO_WORKSPACE" in result.output
    assert "Hint:" in result.output


def test_skill_status_no_workspace_json_exits_nonzero():
    runner = CliRunner()
    with patch("botcore.commands.skill.status.find_workspace", return_value=None):
        result = runner.invoke(cli, ["skill-status", "--json"])
    assert result.exit_code == 1
    output = json.loads(result.output)
    assert output["success"] is False
    assert output["error"]["code"] == "NO_WORKSPACE"
    assert output["error"]["suggestion"]


def test_non_json_success_prints_data(tmp_path):
    runner = CliRunner()
    with patch("botcore.commands.info.find_workspace", return_value=Path.cwd()):
        with patch("botcore.commands.info.get_packages", return_value=[]):
            result = runner.invoke(cli, ["info"])
    assert result.exit_code == 0
    output = json.loads(result.output)
    assert "workspace_root" in output
    assert "success=" not in result.output


def test_init_reports_seeded_count(tmp_path):
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path) as td:
        Path(td, ".git").mkdir()
        result = runner.invoke(cli, ["init", "--non-interactive", "--json"])
        assert result.exit_code == 0, result.output
        output = json.loads(result.output)
        seeded_dirs = [p for p in Path(td, ".claude", "skills").iterdir() if p.is_dir()]
        assert output["skills_seeded"] > 0
        assert output["skills_seeded"] == len(seeded_dirs)


def test_init_reports_seeded_count_text(tmp_path):
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path) as td:
        Path(td, ".git").mkdir()
        result = runner.invoke(cli, ["init", "--non-interactive"])
        assert result.exit_code == 0, result.output
        assert "Skills seeded:" in result.output
