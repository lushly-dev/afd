# Architecture

> Part of [Bot Core + Skill Registry Plan](./00-overview.md)

---

## Recommended Direction: Bot Core with Integrated Skill Registry

**Combine bot core extraction with Option E (Hybrid Feed + Local Override)** — skills become a first-class feature of the shared bot core package.

### Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                   botcore (pip package)                │
│                                                        │
│  ┌──────────┐  ┌───────────┐  ┌────────────────────┐ │
│  │ AFD      │  │ Commands  │  │ Skill Registry     │ │
│  │ (result, │  │ (dev,     │  │ (seed, sync,       │ │
│  │  client, │  │  docs,    │  │  lint, list,       │ │
│  │  server) │  │  research,│  │  status)           │ │
│  └──────────┘  │  spec,    │  │                    │ │
│                │  cdp,     │  │  Built-in skills   │ │
│                │  undo)    │  │  (20+ universal)   │ │
│                └───────────┘  └────────────────────┘ │
│                                                        │
│  ┌────────────────────────────────────────────────┐   │
│  │ Plugin Interface                                │   │
│  │  register_commands()                            │   │
│  │  register_skills()     ← plugins add domain    │   │
│  │  register_mcp_tools()    skills & commands      │   │
│  │  register_state_backend()                       │   │
│  └────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────┤
│              Plugins (separate pip packages)           │
│                                                        │
│  lushbot-plugin    proto-plugin    mechanic-plugin     │
│  ├── commands/     ├── commands/   ├── commands/       │
│  ├── skills/       ├── skills/     ├── skills/         │
│  └── state/        └── state/      └── state/          │
│    (convex)          (sqlite)        (postgres)        │
└──────────────────────────────────────────────────────┘
```

---

## Three-Tier Skill Model

Skills naturally fall into three tiers. The bot core models this explicitly:

| Tier | Scope | Example skills | Shipped with | Managed? |
|------|-------|---------------|-------------|----------|
| **Tier 1: Universal** | Any project, any domain | security, testing, problem-solver, researcher, performance, skill-manager | Bot core package | Yes (`source: botcore`) |
| **Tier 2: Domain** | Specific product/technology | fabric-components, design-tokens, afd-developer, noisett, violet | Plugin package | Yes (`source: <plugin>`) |
| **Tier 3: Project** | One repo's implementation | fabric-zero, local-data, feature-modules, lushx | Repo itself | No (unmanaged) |

### Skill Identity via `source:` Frontmatter

```yaml
# Tier 1 (bot core managed)
---
name: security
source: botcore
version: "3.0.0"
---

# Tier 2 (plugin managed)
---
name: design-tokens
source: fabric-proto
version: "2.0.0"
---

# Tier 3 (project-local, unmanaged)
---
name: local-data
version: "1.0.0"
# no source: field → botcore will never overwrite
---
```

---

## Bot Core Components

### What ships with bot core (general-purpose):

| Component | Current source | Notes |
|-----------|---------------|-------|
| **AFD Python** (CommandResult, DirectClient, Server) | `AFD/python/` | Dependency (not absorbed) |
| **Dev commands** (lint, test, build, quality, analysis, portability) | `lushbot/commands/dev/` | 100% general |
| **Docs commands** (markdown lint, changelog/agents checks) | `lushbot/commands/docs.py` | 100% general |
| **Spec commands** (create/status/validate) | `lushbot/commands/spec.py` | 100% general |
| **Research commands** (Gemini + Google) | `lushbot/commands/research.py` | 100% general |
| **Undo/history** | `lushbot/commands/undo.py` | 100% general |
| **Info commands** (workspace discovery) | `lushbot/commands/info.py` | 100% general |
| **CDP browser automation** (28 commands) | `lushbot/commands/cdp/` | 100% general |
| **Utilities** (workspace detection, runner, logging) | `lushbot/utils/` | 100% general |
| **Skill registry** (seed, sync, lint, list, status) | NEW | Key addition |
| **MCP server** (dynamic tool loading from plugins) | Reworked from hardcoded | Needs plugin wiring |
| **CLI** (dynamic command loading from plugins) | Reworked from static imports | Needs plugin wiring |
| **Config system** (`[tool.botcore]` in pyproject.toml) | Extended from existing | Language-aware |

### What stays project-specific (plugin examples):

| Plugin | Commands | Skills | State backend |
|--------|----------|--------|---------------|
| **lushbot** | agent spawn/status/finish, workflow management | lushx | Convex |
| **proto** | component/icon/feature scaffold, flag management | Fabric prototyping skills | SQLite/filesystem |
| **fabux** | KB quality gates (14 specialized checks) | KB curation skills | Filesystem |
| **mechanic** | TBD | TBD | TBD |

---

## Language-Aware Dev Commands

The three bots wrap different tools for the same jobs. Bot core detects the project language and picks the right tool:

| Job | Python | TypeScript | Rust |
|-----|--------|-----------|------|
| Lint | ruff | Biome/ESLint | clippy |
| Test | pytest | Vitest/Jest | cargo test |
| Dead code | vulture | knip | — |
| Circular deps | AST analysis | madge | — |

Config can override auto-detection:

```toml
[tool.botcore]
language = "typescript"
linter = "biome"
test_runner = "vitest"
```

---

## Skill Registry Commands

```bash
# Seed skills from core + installed plugins into current project
botcore skill seed

# Update managed skills after upgrading bot core
botcore skill seed --update

# List all available skills (core + plugins + local)
botcore skill list

# Show version comparison and drift status
botcore skill status
# reviewer    local:4.2.0  core:4.6.0  STATUS: STALE
# security    local:3.0.0  core:3.0.0  STATUS: OK
# local-data  local:1.0.0  unmanaged   STATUS: PROJECT-LOCAL

# Lint skill structure and frontmatter
botcore skill lint

# Rebuild AGENTS.md skill index from discovered skills
botcore skill index

# Adopt an existing unmanaged skill (adds source: field so future seeds update it)
botcore skill adopt <name> [--source botcore]
# Adds `source: botcore` (or specified source) to the skill's SKILL.md frontmatter.
# Use when migrating a repo's existing skills to be botcore-managed.
# If the skill already has a different `source:`, fails with a clear error.
```

### Seed/Update Algorithm

1. Read `[tool.botcore]` from `pyproject.toml` — get skill config (include list or skip list)
2. Discover available skills: bot core built-ins + installed plugin skills
3. For each skill to seed:
   - If **not present** in target → copy it, set `source: botcore` (or plugin name)
   - If **present with matching `source:`** → update content (managed skill, safe to overwrite)
   - If **present with no `source:` or different `source:`** → skip (project-local or different manager)
4. Optionally mirror to `.agent/skills/` if `agent_skills = true` — copies each
   seeded skill to `.agent/skills/<name>/` as well (Claude Code reads from this path)
5. Optionally regenerate AGENTS.md skill index

### Config Example

```toml
[tool.botcore]
# Which skills to include (default: all available)
skills = ["security", "testing", "problem-solver", "afd-developer", "performance"]
# Or use skip list: skills_skip = ["i18n", "modern-css"]

# Where to seed skills
skills_dir = ".claude/skills"

# Also mirror to .agent/skills/? (only needed if repo uses Claude Code CLI)
agent_skills = false

# Language detection override
# language = "typescript"

# Dev command overrides
# linter = "biome"
# test_runner = "vitest"
```

---

## Plugin Contract

```python
# Entry point in pyproject.toml:
# [project.entry-points."botcore.plugins"]
# lushbot = "lushbot.plugin:register"

from botcore import PluginRegistry

def register(registry: PluginRegistry):
    # Add project-specific commands (appear in CLI + MCP)
    registry.add_commands([
        agent_spawn, agent_status, agent_finish,
    ])

    # Add project-specific skills (Tier 2)
    registry.add_skills_dir(Path(__file__).parent / "skills")

    # Add entry workflows for MCP discovery
    registry.add_workflows(["review", "feature", "hotfix"])
```

---

## Where Bot Core Lives

`libraries/py/packages/botcore` — the `libraries` repo already has `py/packages/` set up for shared Python packages. This keeps it versioned alongside other shared libraries.

### Relationship to AFD Package

Bot core **depends on** `afd` (doesn't absorb it). AFD is the command framework. Bot core is the opinionated developer bot built on it. Other tools could use AFD without bot core.

---

## Installation Model for Non-Python Repos

Not all consumer repos have a Python environment. TypeScript-first repos (proto,
fabric-ux-prototype) need botcore for skill seeding and dev commands, but may not
have `pip` in their workflow.

**Recommended approach: `pipx`**

```bash
# One-time install (isolated venv, available globally)
pipx install botcore

# Or with a plugin
pipx install botcore
pipx inject botcore proto-plugin
```

This avoids polluting the TS project's environment. The `botcore` CLI is available
system-wide, reads `botcore.toml` from the repo root (no pyproject.toml needed),
and the MCP server runs from the pipx-managed venv.

**Alternative: workspace-level Python venv**

In monorepos that already have Python tooling (e.g., lushly-dev has lushbot), botcore
can live in the same venv:

```bash
# From workspace root
pip install -e libraries/py/packages/botcore
pip install -e lushbot  # lushbot-plugin auto-registers via entry point
```

**MCP config for non-Python repos** uses the pipx or venv path:

```json
{
  "mcpServers": {
    "botcore": {
      "command": "botcore",
      "args": ["mcp", "serve"],
      "cwd": "D:/Github/Microsoft/fabric-ux-prototype"
    }
  }
}
```
