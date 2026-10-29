"""Tests for botcore.config."""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from botcore.config import (
    _TOOL_DEFAULTS,
    BotCoreConfig,
    LanguageConfig,
    PackageOverrideConfig,
    SkillsConfig,
    get_config_for_path,
    load_config,
)


def test_load_default_config(tmp_path: Path) -> None:
    """No config file → all defaults."""
    config = load_config(workspace=tmp_path)
    assert config.file_size_warn == 500
    assert config.file_size_error == 1000
    assert config.coverage_threshold == 80
    assert config.coverage_warn_threshold == 60
    assert config.skills == SkillsConfig()
    assert config.packages == {}
    assert config.plugins == {}


def test_load_from_pyproject(tmp_workspace: Path) -> None:
    """Valid [tool.botcore] parsed correctly."""
    config = load_config(workspace=tmp_workspace)
    assert config.file_size_warn == 400
    assert config.coverage_threshold == 70
    # Defaults still apply for unset fields
    assert config.file_size_error == 1000


def test_load_from_botcore_toml(tmp_workspace_botcore_toml: Path) -> None:
    """Fallback to botcore.toml works."""
    config = load_config(workspace=tmp_workspace_botcore_toml)
    assert config.file_size_warn == 600
    assert config.coverage_threshold == 90


def test_typo_raises_validation_error(tmp_workspace_with_typo: Path) -> None:
    """extra='forbid' catches unknown fields."""
    with pytest.raises(ValidationError, match="file_size_wran"):
        load_config(workspace=tmp_workspace_with_typo)


def test_per_package_override(tmp_workspace_with_packages: Path) -> None:
    """Package-specific thresholds resolve correctly."""
    config = load_config(workspace=tmp_workspace_with_packages)

    # Root config
    assert config.coverage_threshold == 80

    # Package override — @test/core has coverage_threshold=95
    core_file = tmp_workspace_with_packages / "packages" / "core" / "src" / "index.ts"
    core_file.parent.mkdir(parents=True, exist_ok=True)
    core_file.write_text("export const x = 1;", encoding="utf-8")

    resolved = get_config_for_path(config, core_file, tmp_workspace_with_packages)
    assert resolved["coverage_threshold"] == 95

    # Package override — @test/data has file_size_warn=800, coverage_threshold=60
    data_file = tmp_workspace_with_packages / "packages" / "data" / "src" / "main.ts"
    data_file.parent.mkdir(parents=True, exist_ok=True)
    data_file.write_text("export const y = 2;", encoding="utf-8")

    resolved = get_config_for_path(config, data_file, tmp_workspace_with_packages)
    assert resolved["file_size_warn"] == 800
    assert resolved["coverage_threshold"] == 60

    # Package with no override — @test/utils uses root config
    utils_file = tmp_workspace_with_packages / "packages" / "utils" / "src" / "helpers.ts"
    utils_file.parent.mkdir(parents=True, exist_ok=True)
    utils_file.write_text("export const z = 3;", encoding="utf-8")

    resolved = get_config_for_path(config, utils_file, tmp_workspace_with_packages)
    assert resolved["coverage_threshold"] == 80


def test_skills_config() -> None:
    """Skills config parsed with include/skip/source_dir."""
    config = BotCoreConfig(
        skills=SkillsConfig(
            include=["security", "testing"],
            skip=[],
            source_dir=".agent/skills",
            agent_skills=True,
        )
    )
    assert config.skills.include == ["security", "testing"]
    assert config.skills.source_dir == ".agent/skills"
    assert config.skills.agent_skills is True


def test_config_precedence(tmp_workspace: Path) -> None:
    """CLI overrides > project config > defaults."""
    # tmp_workspace has file_size_warn=400 and coverage_threshold=70
    config = load_config(
        workspace=tmp_workspace,
        cli_overrides={"file_size_warn": 250},
    )
    # CLI override wins
    assert config.file_size_warn == 250
    # Project config still applies
    assert config.coverage_threshold == 70
    # Default for unset fields
    assert config.file_size_error == 1000


def test_language_autodetect_python(tmp_workspace: Path) -> None:
    """Auto-detect language as Python when pyproject.toml has build-system."""
    config = load_config(workspace=tmp_workspace)
    assert config.language == "python"
    assert config.linter == "ruff"
    assert config.test_runner == "pytest"
    assert config.formatter == "ruff"


def test_language_autodetect_typescript(tmp_path: Path) -> None:
    """Auto-detect language as TypeScript when package.json present."""
    (tmp_path / "package.json").write_text('{"name": "test"}', encoding="utf-8")
    (tmp_path / ".git").mkdir()
    config = load_config(workspace=tmp_path)
    assert config.language == "typescript"
    assert config.linter == "biome"


def test_language_autodetect_rust(tmp_path: Path) -> None:
    """Auto-detect language as Rust when Cargo.toml present."""
    (tmp_path / "Cargo.toml").write_text('[package]\nname = "test"\n', encoding="utf-8")
    config = load_config(workspace=tmp_path)
    assert config.language == "rust"
    assert config.linter == "clippy"


# ── Multi-language config tests ─────────────────────────────────────────


def test_language_config_parses(tmp_workspace_multilang: Path) -> None:
    """LanguageConfig entries created, tool defaults auto-populated."""
    config = load_config(workspace=tmp_workspace_multilang)
    assert "typescript" in config.language_config
    assert "python" in config.language_config
    assert "rust" in config.language_config
    # Tools auto-populated from _TOOL_DEFAULTS
    assert config.language_config["python"].linter == "ruff"
    assert config.language_config["python"].test_runner == "pytest"
    assert config.language_config["typescript"].linter == "biome"
    assert config.language_config["rust"].linter == "clippy"
    assert config.language_config["rust"].formatter == "rustfmt"


def test_language_config_empty_backward_compat(tmp_workspace: Path) -> None:
    """No language_config → identical to existing behavior."""
    config = load_config(workspace=tmp_workspace)
    assert config.language_config == {}
    # Existing fields still work
    assert config.language == "python"
    assert config.linter == "ruff"


def test_languages_property_from_language_config() -> None:
    """languages property returns keys from language_config."""
    config = BotCoreConfig(
        language_config={
            "python": LanguageConfig(),
            "typescript": LanguageConfig(),
        }
    )
    assert config.languages == ["python", "typescript"]


def test_languages_property_fallback_to_language() -> None:
    """languages returns [config.language] when language_config is empty."""
    config = BotCoreConfig(language="rust")
    assert config.languages == ["rust"]

    config_none = BotCoreConfig()
    assert config_none.languages == []


def test_get_tools_for_defaults() -> None:
    """get_tools_for returns _TOOL_DEFAULTS when no overrides."""
    config = BotCoreConfig()
    tools = config.get_tools_for("python")
    assert tools == _TOOL_DEFAULTS["python"]


def test_get_tools_for_overrides() -> None:
    """Explicit linter in LanguageConfig overrides the default."""
    config = BotCoreConfig(
        language_config={
            "python": LanguageConfig(linter="mypy"),
        }
    )
    tools = config.get_tools_for("python")
    assert tools["linter"] == "mypy"
    # Other defaults still present
    assert tools["test_runner"] == "pytest"
    assert tools["formatter"] == "ruff"


def test_get_tools_for_unknown_language() -> None:
    """Unknown language returns empty dict, no crash."""
    config = BotCoreConfig()
    tools = config.get_tools_for("haskell")
    assert tools == {}


def test_get_tools_for_none() -> None:
    """None language returns empty dict."""
    config = BotCoreConfig()
    assert config.get_tools_for(None) == {}


def test_language_config_warns_primary_not_in_config(tmp_path: Path) -> None:
    """Warns when primary language is not in language_config keys."""
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text(
        """\
[tool.botcore]
language = "python"

[tool.botcore.language_config.typescript]
""",
        encoding="utf-8",
    )
    (tmp_path / ".git").mkdir()
    with pytest.warns(UserWarning, match="Primary language 'python' is not listed"):
        load_config(workspace=tmp_path)


def test_language_config_warns_overlapping_roots(tmp_path: Path) -> None:
    """Warns when root prefixes overlap."""
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text(
        """\
[tool.botcore]
language = "typescript"

[tool.botcore.language_config.typescript]
root = "packages/"

[tool.botcore.language_config.rust]
root = "packages/rust/"
""",
        encoding="utf-8",
    )
    (tmp_path / ".git").mkdir()
    with pytest.warns(UserWarning, match="Overlapping roots"):
        load_config(workspace=tmp_path)


def test_package_override_language() -> None:
    """language field works in PackageOverrideConfig."""
    pkg = PackageOverrideConfig(language="rust", coverage_threshold=90)
    assert pkg.language == "rust"
    assert pkg.coverage_threshold == 90


def test_legacy_version_stamp_does_not_relax_unknown_fields(tmp_path):
    from pydantic import ValidationError

    from botcore.config import load_config

    config_file = tmp_path / "botcore.toml"
    config_file.write_text('botcore_version = "0.3.5"\nlanguage = "python"\n')
    config = load_config(workspace=tmp_path)
    assert config.botcore_version == "0.3.5"
    assert config.language == "python"
    config_file.write_text('botcore_version = "0.3.5"\nunknown_option = true\n')
    with pytest.raises(ValidationError, match="unknown_option"):
        load_config(workspace=tmp_path)
