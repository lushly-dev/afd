# Config Reference

## File Locations

Botcore reads config from two locations (first match wins):

1. `pyproject.toml` → `[tool.botcore]` section
2. `botcore.toml` → top-level keys

## BotCoreConfig — All Fields

```toml
[tool.botcore]
# ── Core Settings ──────────────────────────────────────────
language = "python"           # "python" | "typescript" | "rust" | null (auto-detect)
linter = "ruff"               # Tool name or null (derived from language)
test_runner = "pytest"        # Tool name or null (derived from language)
formatter = "ruff"            # Tool name or null (derived from language)

# ── File Size Limits ───────────────────────────────────────
file_size_warn = 500          # Lines — dev_check_size warns above this
file_size_error = 1000        # Lines — dev_check_size errors above this

# ── Coverage ───────────────────────────────────────────────
coverage_threshold = 80       # Percent — dev_check_coverage fails below this
coverage_warn_threshold = 60  # Percent — dev_check_coverage warns below this
coverage_paths = ["src/"]     # Paths to measure coverage in
coverage_exclude = []         # Patterns to exclude from coverage

# ── Dependency Staleness ───────────────────────────────────
deps_max_major_behind = 1     # Major versions behind → error
deps_max_minor_behind = 3     # Minor versions behind → warning

# ── Portability ────────────────────────────────────────────
path_check_exclude = []       # Glob patterns to skip in path checks
path_check_allowlist = []     # Patterns for allowed hardcoded paths

# ── Code Duplication ───────────────────────────────────────
duplication_threshold = 5     # Max duplicate occurrences before flagging
duplication_min_lines = 10    # Min lines for a block to count as duplicate

# ── Circular Dependencies ─────────────────────────────────
circular_deps_allowed = 0     # Number of allowed circular dependency cycles

# ── Repo File Checks ──────────────────────────────────────
check_changelog = true        # Whether to check for CHANGELOG.md
check_agents = true           # Whether to check for AGENTS.md

# ── Skills ─────────────────────────────────────────────────
[tool.botcore.skills]
include = null                # List of skill names to include (null = all)
skip = []                     # List of skill names to skip
source_dir = ".claude/skills" # Local skills directory path
agent_skills = false          # Enable agent-managed skills

# ── Per-Package Overrides ──────────────────────────────────
[tool.botcore.packages.my-package]
file_size_warn = 300
file_size_error = 600
coverage_threshold = 90
coverage_warn_threshold = 70
coverage_paths = ["lib/"]
coverage_exclude = ["lib/generated/"]
duplication_threshold = 3
duplication_min_lines = 8
circular_deps_allowed = 1

# ── Plugin Config ──────────────────────────────────────────
[tool.botcore.plugins.my-plugin]
# Fields defined by the plugin's config_schema()
api_key_env = "MY_PLUGIN_KEY"
max_retries = 5
```

## SkillsConfig Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `include` | `list[str] \| None` | `None` | Skill names to include. `None` means all available. |
| `skip` | `list[str]` | `[]` | Skill names to exclude. |
| `source_dir` | `str` | `".claude/skills"` | Local skills directory path. |
| `agent_skills` | `bool` | `False` | Enable agent-managed skills. |

## PackageOverrideConfig Fields

All fields are optional (None means "inherit from root config"):

| Field | Type | Description |
|---|---|---|
| `file_size_warn` | `int \| None` | File size warning threshold (lines) |
| `file_size_error` | `int \| None` | File size error threshold (lines) |
| `coverage_threshold` | `int \| None` | Coverage failure threshold (percent) |
| `coverage_warn_threshold` | `int \| None` | Coverage warning threshold (percent) |
| `coverage_paths` | `list[str] \| None` | Paths to measure coverage in |
| `coverage_exclude` | `list[str] \| None` | Coverage exclusion patterns |
| `duplication_threshold` | `int \| None` | Max duplicate occurrences |
| `duplication_min_lines` | `int \| None` | Min lines for duplication detection |
| `circular_deps_allowed` | `int \| None` | Allowed circular dependency count |

## EnvConfig Fields

Loaded from environment variables, not TOML:

| Field | Env Variable | Description |
|---|---|---|
| `gemini_api_key` | `GEMINI_API_KEY` | Gemini API key for research |
| `github_token` | `GITHUB_TOKEN` | GitHub API token |
| `convex_url` | `CONVEX_URL` | Convex deployment URL |

## Validation

All models use Pydantic with `extra="forbid"`:

```python
class BotCoreConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
```

This means any typo or unknown field causes an immediate `ValidationError`:

```
pydantic_core._pydantic_core.ValidationError: 1 validation error for BotCoreConfig
coverage_treshold  ← typo
  Extra inputs are not permitted
```
