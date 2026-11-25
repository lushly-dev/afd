"""Botcore configuration system — Pydantic models + TOML loader."""

from __future__ import annotations

import re
import tomllib
import warnings
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from botcore.utils.workspace import detect_language, detect_package, find_workspace

# ── Language → tool defaults ────────────────────────────────────────────────

_TOOL_DEFAULTS: dict[str, dict[str, str]] = {
    "python": {"linter": "ruff", "test_runner": "pytest", "formatter": "ruff"},
    "typescript": {"linter": "biome", "test_runner": "vitest", "formatter": "biome"},
    "rust": {"linter": "clippy", "test_runner": "cargo-test", "formatter": "rustfmt"},
}


# ── Pydantic models ────────────────────────────────────────────────────────


class RequiredSkill(BaseModel):
    """A skill a kind of change requires: `skill-usage-triggers` reports the changes to
    these paths whose session had not loaded it."""

    model_config = ConfigDict(extra="forbid")

    # A skill's name (or a plugin's `plugin:skill`), as the usage record holds it
    skill: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*(:[A-Za-z0-9][A-Za-z0-9._-]*)?$")
    # Globs over repository-relative paths as git writes them: forward slashes, matched by
    # case; `*` stays in one folder and `**` spans folders
    paths: list[str] = Field(min_length=1)

    @field_validator("paths")
    @classmethod
    def _as_git_writes_them(cls, paths: list[str]) -> list[str]:
        for path in paths:
            if not path or "\\" in path or path.startswith(("/", "./", "../")):
                raise ValueError(
                    f"{path!r} is not a repository-relative path: write it as git does, "
                    "with forward slashes and no leading ./ or /, for example scripts/check-*.mjs"
                )
        return paths


_SKILL_ALIAS_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")


def _check_skill_dir(path: str) -> str:
    """A [skills].extra_dirs entry: repository-relative, forward slashes, no '.' or '..'."""
    if "\x00" in path:
        raise ValueError(f"[skills].extra_dirs {path!r}: may not contain NUL bytes")
    text = path.strip().rstrip("/")
    if not text:
        raise ValueError("a [skills].extra_dirs entry is empty")
    if text.startswith(":"):
        raise ValueError(f"[skills].extra_dirs {path!r}: may not start with ':'")
    if "\\" in text:
        raise ValueError(f"[skills].extra_dirs {path!r}: use forward slashes")
    if text.startswith("/") or (len(text) > 1 and text[1] == ":"):
        raise ValueError(f"[skills].extra_dirs {path!r} must be relative to the repository")
    parts = text.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise ValueError(
            f"[skills].extra_dirs {path!r} may not contain '.', '..' or empty segments"
        )
    return text


class SkillsConfig(BaseModel):
    """Skill registry settings."""

    model_config = ConfigDict(extra="forbid")

    include: list[str] | None = None  # None = all available
    skip: list[str] = []
    source_dir: str = ".claude/skills"
    agent_skills: bool = False
    # Characters of descriptions (plus when_to_use) the host lists; Claude Code's fallback
    listing_budget: int = Field(default=8000, gt=0, strict=True)
    # [[skills.required]]: the skills that kinds of change require
    required: list[RequiredSkill] = []
    # Additional repository-relative skill folders (e.g. a source folder for generated skills)
    extra_dirs: list[str] = []
    # Canonical/alternate skill name -> name the project reports it under
    aliases: dict[str, str] = {}

    @field_validator("extra_dirs")
    @classmethod
    def _clean_extra_dirs(cls, dirs: list[str]) -> list[str]:
        return list(dict.fromkeys(_check_skill_dir(entry) for entry in dirs))

    @field_validator("aliases")
    @classmethod
    def _valid_aliases(cls, aliases: dict[str, str]) -> dict[str, str]:
        for old, new in aliases.items():
            if not _SKILL_ALIAS_NAME.fullmatch(old) or not _SKILL_ALIAS_NAME.fullmatch(new):
                raise ValueError(
                    f"[skills].aliases {old!r} -> {new!r}: both must be valid skill names"
                )
            if old == new:
                raise ValueError(f"[skills].aliases {old!r}: a skill cannot alias itself")
        for start in aliases:
            seen = {start}
            current = aliases[start]
            while current in aliases:
                if current in seen:
                    raise ValueError(f"[skills].aliases contains a cycle at {current!r}")
                seen.add(current)
                current = aliases[current]
        return aliases


class SweepConfig(BaseModel):
    """The bloat sweep's settings, read by the bloat-sweeper skill's scripts/sweep.mjs."""

    model_config = ConfigDict(extra="forbid")

    # The open issue each pass records its measurement on; None until a repository makes one
    trend_issue: int | None = Field(default=None, gt=0, strict=True)
    # Files a pass judged cohesive (one job, many lines), with their size then and the reason
    cohesive: str = "sweep-cohesive.json"
    # Tracked path prefixes never measured, such as imported upstream source
    exclude: list[str] = []
    # File-name patterns measured although the default skips them, such as "*.stories.*"
    include_names: list[str] = []
    # Commits touching a file in this many days are its churn
    churn_days: int = Field(default=90, gt=0, strict=True)
    # Source extensions measured; None = the script's default (TypeScript, JavaScript, Python, Rust)
    extensions: list[str] | None = None
    # A command printing repository-specific measures as JSON, such as bundle sizes
    measures: str | None = None


def _check_disk_pattern(pattern: str) -> str:
    """A [disk] pattern names paths inside a worktree: relative, forward slashes, no `..`."""
    text = pattern.strip()
    if not text:
        raise ValueError("a [disk] pattern is empty")
    if "\\" in text:
        raise ValueError(f"[disk] pattern {pattern!r}: use forward slashes")
    if text.startswith("/") or (len(text) > 1 and text[1] == ":"):
        raise ValueError(f"[disk] pattern {pattern!r} must be relative to the worktree")
    parts = text.split("/")
    if any(part in ("..", ".") for part in parts):
        raise ValueError(f"[disk] pattern {pattern!r} may not contain '.' or '..' segments")
    if parts[0] == ".git" or text == "**":
        raise ValueError(f"[disk] pattern {pattern!r} would reach the worktree's git files")
    return text


class DiskRegenerable(BaseModel):
    """One rebuildable path pattern in [disk].regenerable."""

    model_config = ConfigDict(extra="forbid")

    path: str
    # "idle": stripped once the worktree is idle; "pressure": only when a volume is low
    when: Literal["idle", "pressure"] = "idle"
    # Days without activity before this pattern is stripped; None = the machine's default
    after_days: float | None = Field(default=None, ge=0)

    @field_validator("path")
    @classmethod
    def _relative(cls, value: str) -> str:
        return _check_disk_pattern(value)


class DiskConfig(BaseModel):
    """The disk-* commands' settings for this repository (botcore.toml [disk])."""

    model_config = ConfigDict(extra="forbid")

    # A worktree's work has landed when it is reachable from, or matches, this ref
    landing_ref: str = "origin/main"
    # Paths inside a worktree that a build or install recreates
    regenerable: list[str | DiskRegenerable] = []
    # Ignored files copied into a worktree at setup, such as .env; never stripped
    copies: list[str] = []

    @field_validator("regenerable")
    @classmethod
    def _entries(cls, value: list[str | DiskRegenerable]) -> list[str | DiskRegenerable]:
        return [_check_disk_pattern(v) if isinstance(v, str) else v for v in value]

    @field_validator("copies")
    @classmethod
    def _copies(cls, value: list[str]) -> list[str]:
        return [_check_disk_pattern(v) for v in value]

    def entries(self) -> list[DiskRegenerable]:
        """Every regenerable pattern as a DiskRegenerable."""
        return [DiskRegenerable(path=v) if isinstance(v, str) else v for v in self.regenerable]


class PRConfig(BaseModel):
    """Settings for the pr-* commands (botcore.toml [pr])."""

    model_config = ConfigDict(extra="forbid")

    # Review bots that pr_wait(until="ready") waits for (any one reviewing the current head
    # satisfies the gate; empty list means checks and zero unresolved threads suffice).
    gating_bots: list[str] = ["greptile", "macroscope"]
    # Review bots surfaced in status/events without holding ready.
    advisory_bots: list[str] = ["coderabbit"]
    # CI/deploy bots whose PR comments are status reports already covered by checks.
    status_bots: list[str] = ["github-actions", "vercel", "netlify", "railway", "cloudflare"]
    # Optional directory for pr_wait lock and watermark state files (when persist_state=True).
    state_dir: str | None = None
    # Age in seconds after which a persisted watermark resets to a fresh baseline.
    stale_state_seconds: int = Field(default=6 * 3600, gt=0, strict=True)
    # Default poll interval in seconds for pr_wait.
    default_interval: int = Field(default=20, ge=5, strict=True)


class GateOutcomeConfig(BaseModel):
    """The gate-outcome-* commands' settings for this repository (botcore.toml [gate_outcome])."""

    model_config = ConfigDict(extra="forbid")

    # Workflows that judge the others, such as a required check that waits for every workflow
    # and fails when one did: each keeps its own row, marked, and the report's totals and the
    # queue's failed groups leave it out, so one failure is not counted twice. By file
    # (ci-ok.yml) or by name; none named, each counts like any other
    verdict_workflows: list[str] = []


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
    sweep: SweepConfig = SweepConfig()
    disk: DiskConfig = DiskConfig()
    pr: PRConfig = PRConfig()
    gate_outcome: GateOutcomeConfig = GateOutcomeConfig()
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


def config_table(workspace: Path) -> dict[str, Any]:
    """The botcore table of a checkout's configuration, unvalidated, with botcore's precedence
    (pyproject.toml's [tool.botcore] over botcore.toml), for a command that validates only its
    own section."""
    return _read_toml(workspace)


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
    *,
    selection: bool = False,
) -> None:
    """Validate plugin config sections and warn about orphans.

    With every installed plugin (legacy discovery), a section no plugin reads is an orphan.
    A host's explicit selection leaves the other sections alone: they configure plugins that
    other hosts select, possibly installed in another environment, so they are not orphans.
    """
    for name, plugin in discovered_plugins.items():
        schema = getattr(plugin, "config_schema", lambda: None)()
        if schema and name in config.plugins:
            config.plugins[name] = schema(**config.plugins[name])

    if selection:
        return
    for name in config.plugins:
        if name not in discovered_plugins:
            msg = f"Config section [tool.botcore.plugins.{name}] "
            msg += "has no matching plugin installed"
            warnings.warn(msg, UserWarning, stacklevel=3)


def load_config(
    workspace: Path | None = None,
    cli_overrides: dict[str, Any] | None = None,
    discovered_plugins: dict[str, Any] | None = None,
    *,
    selection: bool = False,
) -> BotCoreConfig:
    """Load and validate botcore configuration.

    Precedence: CLI flags > project config > plugin defaults > core defaults.

    Args:
        workspace: Workspace root. Auto-detected if None.
        cli_overrides: Dict of CLI flag overrides (highest priority).
        discovered_plugins: Dict of name → plugin instances for config validation.
        selection: True when discovered_plugins is a host's explicit selection rather than
            every installed plugin; sections for unselected plugins then raise no warning.

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
        _validate_plugin_configs(config, discovered_plugins, selection=selection)

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
