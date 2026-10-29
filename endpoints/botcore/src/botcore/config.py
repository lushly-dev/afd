"""Botcore configuration system — Pydantic models + TOML loader."""

from __future__ import annotations

import tomllib
import warnings
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict

from botcore.utils.workspace import detect_language, detect_package, find_workspace

# ── Language → tool defaults ────────────────────────────────────────────────

_TOOL_DEFAULTS: dict[str, dict[str, str]] = {
    "python": {"linter": "ruff", "test_runner": "pytest", "formatter": "ruff"},
    "typescript": {"linter": "biome", "test_runner": "vitest", "formatter": "biome"},
    "rust": {"linter": "clippy", "test_runner": "cargo-test", "formatter": "rustfmt"},
}


# ── Pydantic models ────────────────────────────────────────────────────────


class SkillsConfig(BaseModel):
    """Skill registry settings."""

    model_config = ConfigDict(extra="forbid")

    include: list[str] | None = None  # None = all available
    skip: list[str] = []
    source_dir: str = ".claude/skills"
    agent_skills: bool = False


class LanguageConfig(BaseModel):
    """Per-language tooling configuration."""

    model_config = ConfigDict(extra="forbid")

    root: str | None = None
    linter: str | None = None
    test_runner: str | None = None
    formatter: str | None = None


class PackageOverrideConfig(BaseModel):
    """Per-package overrides — only fields that make sense to override."""

    model_config = ConfigDict(extra="forbid")

    language: str | None = None
    file_size_warn: int | None = None
    file_size_error: int | None = None
    coverage_threshold: int | None = None
    coverage_warn_threshold: int | None = None
    coverage_paths: list[str] | None = None
    coverage_exclude: list[str] | None = None
    duplication_threshold: int | None = None
    duplication_min_lines: int | None = None
    circular_deps_allowed: int | None = None


class BotCoreConfig(BaseModel):
    """Top-level config. Flat core settings + nested sections."""

    model_config = ConfigDict(extra="forbid")

    # Legacy generated-config stamp; informational, not a runtime version constraint.
    botcore_version: str | None = None

    # Core settings
    language: str | None = None
    linter: str | None = None
    test_runner: str | None = None
    formatter: str | None = None
    file_size_warn: int = 500
    file_size_error: int = 1000
    coverage_threshold: int = 80
    coverage_warn_threshold: int = 60
    coverage_paths: list[str] = ["src/"]
    coverage_exclude: list[str] = []
    deps_max_major_behind: int = 1
    deps_max_minor_behind: int = 3
    path_check_exclude: list[str] = []
    path_check_allowlist: list[str] = []
    duplication_threshold: int = 5
    duplication_min_lines: int = 10
    circular_deps_allowed: int = 0
    check_changelog: bool = True
    check_agents: bool = True
    telemetry_enabled: bool = False
    telemetry_format: str = "text"  # "text" or "json"

    # Nested sections
    skills: SkillsConfig = SkillsConfig()
    language_config: dict[str, LanguageConfig] = {}
    packages: dict[str, PackageOverrideConfig] = {}
    plugins: dict[str, dict[str, Any]] = {}

    @property
    def languages(self) -> list[str]:
        """Derive active languages from language_config keys, or fallback to primary."""
        if self.language_config:
            return list(self.language_config.keys())
        return [self.language] if self.language else []

    def get_tools_for(self, lang: str | None) -> dict[str, str | None]:
        """Merge _TOOL_DEFAULTS with language_config overrides for a language."""
        if not lang:
            return {}
        defaults = _TOOL_DEFAULTS.get(lang, {})
        overrides: dict[str, str | None] = {}
        if lang in self.language_config:
            lc = self.language_config[lang]
            overrides = lc.model_dump(exclude_none=True, exclude={"root"})
        return {**defaults, **overrides}


class EnvConfig(BaseModel):
    """Environment variables — secrets and machine-specific paths only.

    Loaded via environment variables, not pyproject.toml. Will be wired
    into CLI context when the CLI stub is added.
    """

    model_config = ConfigDict(extra="forbid")

    openai_api_key: str | None = None
    github_token: str | None = None
    convex_url: str | None = None


# ── Loader functions ────────────────────────────────────────────────────────


def _read_toml(workspace: Path) -> dict[str, Any]:
    """Read botcore config from pyproject.toml [tool.botcore] or botcore.toml."""
    # Try pyproject.toml first
    pyproject = workspace / "pyproject.toml"
    if pyproject.exists():
        try:
            data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
            botcore_section = data.get("tool", {}).get("botcore")
            if botcore_section is not None:
                return dict(botcore_section)
        except Exception:
            pass

    # Fallback to botcore.toml
    botcore_toml = workspace / "botcore.toml"
    if botcore_toml.exists():
        try:
            data = tomllib.loads(botcore_toml.read_text(encoding="utf-8"))
            return dict(data)
        except Exception:
            pass

    return {}


def _apply_language_defaults(config: BotCoreConfig, workspace: Path | None) -> None:
    """Auto-detect language and apply dev tool defaults in-place."""
    if config.language is None and workspace:
        config.language = detect_language(workspace)

    if config.language and config.language in _TOOL_DEFAULTS:
        defaults = _TOOL_DEFAULTS[config.language]
        if config.linter is None:
            config.linter = defaults["linter"]
        if config.test_runner is None:
            config.test_runner = defaults["test_runner"]
        if config.formatter is None:
            config.formatter = defaults["formatter"]

    # Populate tool defaults for each language_config entry
    for lang, lc in config.language_config.items():
        if lang in _TOOL_DEFAULTS:
            defaults = _TOOL_DEFAULTS[lang]
            if lc.linter is None:
                lc.linter = defaults["linter"]
            if lc.test_runner is None:
                lc.test_runner = defaults["test_runner"]
            if lc.formatter is None:
                lc.formatter = defaults["formatter"]


def _validate_language_config(config: BotCoreConfig) -> None:
    """Validate language_config entries and warn about suspicious configurations."""
    if not config.language_config:
        return

    # Warn if primary language is set but not in language_config keys
    if config.language and config.language not in config.language_config:
        msg = (
            f"Primary language '{config.language}' is not listed in "
            f"[tool.botcore.language_config] — it won't get multi-language dispatch"
        )
        warnings.warn(msg, UserWarning, stacklevel=3)

    # Warn on overlapping root prefixes
    roots: list[tuple[str, str]] = []
    for lang, lc in config.language_config.items():
        if lc.root:
            # Normalize to trailing /
            root = lc.root if lc.root.endswith("/") else lc.root + "/"
            roots.append((lang, root))

    for i, (lang_a, root_a) in enumerate(roots):
        for lang_b, root_b in roots[i + 1 :]:
            if root_a.startswith(root_b) or root_b.startswith(root_a):
                msg = (
                    f"Overlapping roots: {lang_a} ({root_a!r}) and "
                    f"{lang_b} ({root_b!r}) — longest prefix wins but check intent"
                )
                warnings.warn(msg, UserWarning, stacklevel=3)


def _validate_plugin_configs(
    config: BotCoreConfig,
    discovered_plugins: dict[str, Any],
) -> None:
    """Validate plugin config sections and warn about orphans."""
    for name, plugin in discovered_plugins.items():
        schema = getattr(plugin, "config_schema", lambda: None)()
        if schema and name in config.plugins:
            config.plugins[name] = schema(**config.plugins[name])

    for name in config.plugins:
        if name not in discovered_plugins:
            msg = f"Config section [tool.botcore.plugins.{name}] "
            msg += "has no matching plugin installed"
            warnings.warn(msg, UserWarning, stacklevel=3)


def load_config(
    workspace: Path | None = None,
    cli_overrides: dict[str, Any] | None = None,
    discovered_plugins: dict[str, Any] | None = None,
) -> BotCoreConfig:
    """Load and validate botcore configuration.

    Precedence: CLI flags > project config > plugin defaults > core defaults.

    Args:
        workspace: Workspace root. Auto-detected if None.
        cli_overrides: Dict of CLI flag overrides (highest priority).
        discovered_plugins: Dict of name → plugin instances for config validation.

    Returns:
        Validated BotCoreConfig.
    """
    if workspace is None:
        workspace = find_workspace()

    raw = _read_toml(workspace) if workspace else {}

    if cli_overrides:
        raw.update(cli_overrides)

    config = BotCoreConfig(**raw)
    _apply_language_defaults(config, workspace)
    _validate_language_config(config)

    if discovered_plugins is not None:
        _validate_plugin_configs(config, discovered_plugins)

    return config


def get_config_for_path(
    config: BotCoreConfig,
    file_path: Path,
    workspace: Path,
) -> dict[str, Any]:
    """Resolve config with per-package overrides applied.

    Merge semantics: REPLACE, not additive. A per-package override of
    coverage_paths=["lib/"] replaces the root coverage_paths=["src/"].
    """
    base = config.model_dump()

    package_name = detect_package(file_path, workspace)
    if package_name and package_name in config.packages:
        pkg_config = config.packages[package_name]
        overrides = pkg_config.model_dump(exclude_none=True)
        base.update(overrides)

    return base
