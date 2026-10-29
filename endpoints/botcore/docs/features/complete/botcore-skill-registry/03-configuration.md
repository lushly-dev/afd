# Configuration System

> Part of [Bot Core + Skill Registry Plan](./00-overview.md)

---

## Current State (Problems)

All three bots handle config differently, all with gaps:

| Bot | Config location | Loader | Validation | Exported? |
|-----|----------------|--------|------------|-----------|
| **lushbot** | `[tool.lushx]` in pyproject.toml | `_load_lushx_config()` — private function buried in quality.py | None | No — private cross-module import anti-pattern |
| **proto** | `[tool.proto]` + `[tool.proto.hygiene]` in pyproject.toml | `_load_hygiene_config()` — hardcoded `os.path.dirname` path traversal | None | No |
| **fabux** | `[tool.fabux]` in pyproject.toml | `load_config()` — dedicated utils/config.py module | None | Yes — cleanest of the three |

**Specific issues:**
- Proto has `coverage_threshold` at two levels (`tool.proto` = 70, `tool.proto.hygiene` = 60) — the hygiene function only reads the nested one, the top-level is dead config
- Proto uses hardcoded `os.path.dirname(__file__)` to find pyproject.toml — breaks if file moves
- lushbot's `portability.py` imports `from .quality import _load_lushx_config` — private cross-module import
- No bot validates config — typos like `file_size_wran = 300` silently do nothing
- No bot supports CLI flag overrides
- Many commands that are currently hardcoded will need config when generalized (proto's `file_size_warn=300` is baked into code, not configurable)

---

## Design Principles

1. **Layered precedence** — CLI flags > project config > plugin defaults > core defaults
2. **Validated early** — Pydantic with `extra="forbid"` catches typos at load time, not at command execution
3. **One config object** — commands receive config via context, never load it themselves
4. **Plugin-owned validation** — core validates its section, plugins validate theirs
5. **Cross-language** — works for Python repos (pyproject.toml) and non-Python repos (botcore.toml fallback)
6. **Monorepo-aware** — per-package overrides for repos with multiple packages

---

## Config File Discovery

```
1. Find project root (workspace detection — existing find_workspace())
2. Look for pyproject.toml → read [tool.botcore]
3. If no pyproject.toml or no [tool.botcore] → look for botcore.toml at project root
4. If neither found → use all defaults (still works, just no customization)
```

**Why two files?** `pyproject.toml` is the natural home for Python repos (all three bots already use it). But TypeScript-first repos like fast-af, Violet, and fabric-ux-prototype don't have one — `botcore.toml` gives them a clean config location without adding a Python-specific file. Same TOML format, same schema, just different filename.

---

## Config Precedence (4 Layers)

```
CLI flag (--file-size-warn 400)        ← highest, one-off override
  ↓
Project config (pyproject.toml)         ← repo-specific tuning
  ↓
Plugin defaults (plugin.config_defaults()) ← plugin author's opinion for their domain
  ↓
Bot core defaults (BotCoreConfig model) ← sensible universal baseline
```

---

## Full Config Schema

```toml
# ── Core settings ──────────────────────────────────────────────
[tool.botcore]
# Language detection (auto-detect from package.json/pyproject.toml/Cargo.toml if not set)
language = "typescript"

# Dev command tool overrides (auto-selected by language if not set)
linter = "biome"              # python: ruff, typescript: biome, rust: clippy
test_runner = "vitest"         # python: pytest, typescript: vitest, rust: cargo-test
formatter = "biome"            # python: ruff, typescript: biome, rust: rustfmt

# Quality gate thresholds
file_size_warn = 500
file_size_error = 1000
coverage_threshold = 80
coverage_warn_threshold = 60
coverage_paths = ["src/"]
coverage_exclude = []
deps_max_major_behind = 1
deps_max_minor_behind = 3

# Portability checks
path_check_exclude = []
path_check_allowlist = []

# Analysis tools
duplication_threshold = 5
duplication_min_lines = 10
circular_deps_allowed = 0

# Optional checks (some repos don't use these)
check_changelog = true
check_agents = true

# ── Skill registry settings ───────────────────────────────────
[tool.botcore.skills]
# Which skills to seed (default: all available from core + plugins)
include = ["security", "testing", "problem-solver", "afd-developer"]
# Or exclude instead: skip = ["i18n", "modern-css"]

# Skill file locations
source_dir = ".claude/skills"
agent_skills = false           # Also seed to .agent/skills/?

# ── Per-package overrides (monorepo) ──────────────────────────
[tool.botcore.packages."@lushly/data-ingestion"]
file_size_warn = 800           # data pipeline files are legitimately large
file_size_error = 1500
coverage_threshold = 60        # lower bar for data scripts

[tool.botcore.packages."@lushly/core"]
coverage_threshold = 95        # core package needs high coverage

# ── Plugin config sections (validated by each plugin) ─────────
[tool.botcore.plugins.proto]
scaffold_templates = "./templates"
icon_registry = "src/components/icons/registry.ts"
component_library = "@fabric-msft/fabric-web"

[tool.botcore.plugins.lushbot]
convex_url = "https://stoic-bee-395.convex.site"
workflows = ["review", "feature", "hotfix"]

[tool.botcore.plugins.fabux]
kb_search_endpoint = "https://nexus-gateway.calmbush-8fccbb9b.eastus.azurecontainerapps.io"
intake_dir = "kb/"
```

---

## Pydantic Config Models

```python
from pydantic import BaseModel, ConfigDict

# NOTE: DevConfig was considered as a separate model but rejected during review.
# All dev settings live flat on BotCoreConfig to avoid field duplication between
# two Pydantic models that would inevitably drift.

class SkillsConfig(BaseModel):
    """Skill registry settings."""
    model_config = ConfigDict(extra="forbid")

    include: list[str] | None = None     # None = all available
    skip: list[str] = []
    source_dir: str = ".claude/skills"
    agent_skills: bool = False


class BotCoreConfig(BaseModel):
    """
    Top-level config. Flat core settings + nested sections.
    Plugin sections are raw dicts — validated by each plugin.
    """
    model_config = ConfigDict(extra="forbid")

    # Core settings are flattened into top level (not nested under "dev")
    # because they're the most common thing to configure
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

    # Nested sections
    skills: SkillsConfig = SkillsConfig()
    packages: dict[str, PackageOverrideConfig] = {}   # per-package overrides (validated)
    plugins: dict[str, dict[str, Any]] = {}     # plugin-owned, validated by plugins


class PackageOverrideConfig(BaseModel):
    """Validated subset of BotCoreConfig for per-package overrides.
    Only fields that make sense to override per-package are included.
    Uses extra="forbid" so typos in package config are caught."""
    model_config = ConfigDict(extra="forbid")

    file_size_warn: int | None = None
    file_size_error: int | None = None
    coverage_threshold: int | None = None
    coverage_warn_threshold: int | None = None
    coverage_paths: list[str] | None = None
    coverage_exclude: list[str] | None = None
    duplication_threshold: int | None = None
    duplication_min_lines: int | None = None
    circular_deps_allowed: int | None = None


# Plugin authors define their own config model:
class ProtoPluginConfig(BaseModel):
    """Config for proto plugin — validated by proto, not by core."""
    model_config = ConfigDict(extra="forbid")

    scaffold_templates: str = "./templates"
    icon_registry: str = "src/components/icons/registry.ts"
    component_library: str = "@fabric-msft/fabric-web"
```

---

## Plugin Config Validation Flow

Plugins own their config schema. Core orchestrates but doesn't need to know plugin schemas in advance:

```python
# In the plugin contract:
class BotCorePlugin(Protocol):
    def register(self, registry: PluginRegistry) -> None: ...

    def config_schema(self) -> type[BaseModel] | None:
        """Return Pydantic model for [tool.botcore.plugins.<name>] validation.
        Return None if plugin needs no config."""
        ...

# Core loads and validates:
def load_config(workspace: Path) -> BotCoreConfig:
    raw = _read_toml(workspace)              # pyproject.toml or botcore.toml
    config = BotCoreConfig(**raw)             # validates core section (typos → error)

    # Validate each plugin's section against the plugin's own schema
    for name, plugin in discovered_plugins.items():
        schema = plugin.config_schema()
        if schema and name in config.plugins:
            plugin_config = schema(**config.plugins[name])  # plugin validates its own keys
            config.plugins[name] = plugin_config

    # Warn about plugin sections with no matching installed plugin
    for name in config.plugins:
        if name not in discovered_plugins:
            warn(f"Config section [tool.botcore.plugins.{name}] has no matching plugin installed")

    return config
```

---

## Per-Package Override Resolution

For monorepo commands (check-size, check-coverage, etc.), config resolves per-file:

```python
def get_config_for_path(config: BotCoreConfig, file_path: Path, workspace: Path) -> dict:
    """Resolve config with per-package overrides applied.

    Merge semantics: REPLACE, not additive.
    A per-package override of coverage_paths=["lib/"] REPLACES the root
    coverage_paths=["src/"], it does not merge into ["src/", "lib/"].
    This is intentional — additive merging creates surprising behavior
    when a package needs to narrow scope. To include both, list both
    explicitly in the package override.

    Only non-None fields from PackageOverrideConfig are applied.
    """
    base = config.model_dump()

    # Find which package this file belongs to
    package_name = detect_package(file_path, workspace)  # reads nearest package.json or pyproject.toml
    if package_name and package_name in config.packages:
        pkg_config = config.packages[package_name]
        overrides = pkg_config.model_dump(exclude_none=True)  # only set fields
        base.update(overrides)  # package overrides win over root (replace semantics)

    return base
```

Package detection walks up from the file to find the nearest `package.json` (name field) or `pyproject.toml` (project.name). This means:

```
lushly/
├── pyproject.toml or botcore.toml      ← [tool.botcore] root config
├── packages/
│   ├── core/package.json               ← "@lushly/core" → uses packages."@lushly/core" overrides
│   ├── data-ingestion/package.json     ← "@lushly/data-ingestion" → uses its overrides
│   └── plants/package.json             ← "@lushly/plants" → no overrides, uses root config
```

---

## Environment Variables

Config for secrets and machine-specific paths only — never for project settings:

```python
class EnvConfig:
    """Loaded from environment, not pyproject.toml. Never committed."""
    gemini_api_key: str | None     # BOTCORE_GEMINI_API_KEY or GEMINI_API_KEY
    github_token: str | None       # GITHUB_TOKEN
    convex_url: str | None         # CONVEX_URL (plugin-specific but cross-cutting)
```

No `.env` file loading by default — explicit environment variables only. Plugins that need `.env` loading can opt in.

**Injection path:** `EnvConfig` is loaded during config loading (step 3 below) and
attached to the Click context alongside `BotCoreConfig`. Commands that need secrets
receive them via `ctx.obj.env.gemini_api_key`, not by reading `os.environ` directly.
This makes testing straightforward — inject a mock `EnvConfig` instead of patching env vars.

---

## Config Loading Flow (Complete)

```
1. find_workspace() → project root
2. Read pyproject.toml [tool.botcore] or botcore.toml
3. Parse into BotCoreConfig (Pydantic, extra="forbid" → typos crash immediately)
4. Auto-detect language if not set (scan for package.json/Cargo.toml/pyproject.toml[build-system])
5. Auto-select dev tools for detected language (linter, test_runner, formatter)
6. Discover installed plugins via entry points
7. Each plugin validates its own config section (or gets empty defaults)
8. Warn about orphaned plugin config sections
9. Merge CLI flag overrides (highest priority)
10. Freeze config → pass to all commands via Click context
```

---

## What Becomes Configurable That Isn't Today

| Setting | Currently | In bot core |
|---------|-----------|-------------|
| proto `file_size_warn=300` | Hardcoded in hygiene.py | Config: `file_size_warn = 300` |
| proto `file_size_error=500` | Hardcoded in hygiene.py | Config: `file_size_error = 500` |
| proto `duplication_min_lines=12` | `[tool.proto.hygiene]` (nested) | Config: `duplication_min_lines = 12` (flat) |
| proto `orphan_grace_days=14` | `[tool.proto.hygiene]` | Config: `orphan_grace_days = 14` |
| lushbot lint tool (ruff) | Hardcoded subprocess call | Config: `linter = "ruff"` or auto-detect |
| lushbot test tool (pytest) | Hardcoded subprocess call | Config: `test_runner = "pytest"` or auto-detect |
| fabux changelog check | Always runs | Config: `check_changelog = true/false` |
| fabux agents check | Always runs | Config: `check_agents = true/false` |
| proto Biome config path | Hardcoded relative path | Config: `linter = "biome"` + auto-discovery |
| per-package thresholds | Not possible | Config: `[tool.botcore.packages."name"]` |
| skill selection | All or nothing | Config: `skills.include` / `skills.skip` |
