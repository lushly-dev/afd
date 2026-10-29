# Appendix A: Module Architecture (Microkernel)

> Part of [Bot Core + Skill Registry Plan](./00-overview.md)

> **Status:** Phase 5 design reference. Do not implement until Phase 4 validates that
> consumers actually need different tool matrices. This appendix is here so the design
> is captured, not so it ships in Phase 1.

---

## Design Shift: Modules over Monolith

Rather than shipping all tool integrations in a single bot core package, tools are **independently installable modules**. A user picks what they need:

```bash
pip install botcore                  # kernel only (framework + registry + config)
pip install botcore-ruff             # ruff linting module
pip install botcore-biome            # biome linting module
pip install botcore-research         # Gemini + Google research module
pip install botcore-cdp              # Chrome DevTools Protocol module
```

Or convenience bundles:

```bash
pip install botcore[python]          # ruff + pytest + vulture + ast-analysis
pip install botcore[typescript]      # biome + vitest + knip + madge
pip install botcore[full]            # everything
```

---

## Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Plugins (repo-specific)                      │
│   lushbot-plugin │ proto-plugin │ fabux-plugin │ mechanic-plugin │
│   agent spawn    │ component    │ KB quality   │   TBD           │
│   workflows      │ icon/flag    │ intake       │                 │
│   Convex state   │ scaffold     │              │                 │
├─────────────────────────────────────────────────────────────────┤
│                     Modules (tool units)                         │
│   botcore-ruff    │ botcore-biome   │ botcore-research           │
│   botcore-pytest  │ botcore-vitest  │ botcore-cdp                │
│   botcore-vulture │ botcore-knip    │ botcore-spec               │
│   botcore-madge   │ botcore-eslint  │ botcore-docs               │
├─────────────────────────────────────────────────────────────────┤
│                     Bot Core (kernel)                            │
│   Module registry │ Config system  │ Skill registry              │
│   CLI framework   │ MCP framework  │ Quality gates               │
│   Bootstrap cmds  │ CommandResult  │ DirectClient                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Capability-Based Dispatch

Modules don't just register commands — they declare **capabilities** (what jobs they can do):

```python
# In botcore-ruff module:
class RuffModule:
    capabilities = ["lint", "format"]
    language = "python"

    def register(self, registry: ModuleRegistry):
        registry.register_capability("lint", self.lint_command, language="python")
        registry.register_capability("format", self.format_command, language="python")
        registry.add_commands([self.lint_command, self.format_command])

# In botcore-biome module:
class BiomeModule:
    capabilities = ["lint", "format"]
    language = "typescript"

    def register(self, registry: ModuleRegistry):
        registry.register_capability("lint", self.lint_command, language="typescript")
        registry.register_capability("format", self.format_command, language="typescript")
        registry.add_commands([self.lint_command, self.format_command])
```

When the user runs `botcore dev lint`:

1. Config resolves which module provides `lint` (auto-detect language, or explicit `linter = "biome"`)
2. If only one module provides `lint` for the detected language → use it
3. If multiple → config must declare a preference, or error with clear message
4. The resolved module's command runs

---

## Module vs Plugin

| Aspect | Module | Plugin |
|--------|--------|--------|
| **Scope** | Single tool or capability group | Entire project's custom needs |
| **Entry point** | `botcore.modules` | `botcore.plugins` |
| **Examples** | botcore-ruff, botcore-cdp | lushbot-plugin, proto-plugin |
| **Installed by** | Anyone | Project maintainer |
| **Provides** | Commands + capabilities | Commands + skills + state + workflows |
| **Config section** | `[tool.botcore.modules.<name>]` | `[tool.botcore.plugins.<name>]` |
| **Independently publishable** | Yes — pip install botcore-ruff | Yes — pip install lushbot-plugin |

---

## Module Categories

| Category | Modules | Capability keys |
|----------|---------|----------------|
| **Linting** | botcore-ruff, botcore-biome, botcore-eslint, botcore-clippy | `lint` |
| **Testing** | botcore-pytest, botcore-vitest, botcore-cargo-test | `test` |
| **Formatting** | botcore-ruff, botcore-biome, botcore-prettier, botcore-rustfmt | `format` |
| **Analysis** | botcore-vulture, botcore-knip, botcore-madge | `dead-code`, `circular-deps`, `unused-deps` |
| **Research** | botcore-research | `research` |
| **Browser** | botcore-cdp | `cdp` |
| **Docs** | botcore-docs | `docs-lint`, `check-changelog`, `check-agents` |
| **Spec** | botcore-spec | `spec-create`, `spec-validate`, `spec-status` |

---

## Module Entry Point Contract

```python
# Entry point in pyproject.toml:
# [project.entry-points."botcore.modules"]
# ruff = "botcore_ruff:RuffModule"

from botcore.module import ModuleContract

class RuffModule(ModuleContract):
    """Ruff-based linting and formatting for Python projects."""

    name = "ruff"
    version = "1.0.0"
    capabilities = ["lint", "format"]
    language = "python"                    # None for language-agnostic modules
    optional_deps = ["ruff"]              # checked at registration, helpful error if missing

    def register(self, registry: ModuleRegistry) -> None:
        registry.register_capability("lint", self.lint_cmd, language="python")
        registry.register_capability("format", self.format_cmd, language="python")
        registry.add_commands([self.lint_cmd, self.format_cmd])

    def config_schema(self) -> type[BaseModel] | None:
        """Return Pydantic model for [tool.botcore.modules.ruff] validation.
        Most modules return None — they have no config."""
        return None
```

---

## Dependency Groups for Convenience Bundles

```toml
# In botcore's pyproject.toml:
[project.optional-dependencies]
python = ["botcore-ruff", "botcore-pytest", "botcore-vulture"]
typescript = ["botcore-biome", "botcore-vitest", "botcore-knip", "botcore-madge"]
full = ["botcore-ruff", "botcore-biome", "botcore-pytest", "botcore-vitest",
        "botcore-vulture", "botcore-knip", "botcore-madge", "botcore-research",
        "botcore-cdp", "botcore-docs", "botcore-spec"]
```

---

## Config Resolution for Capabilities

```toml
# Explicit override — user picks biome for linting regardless of detected language:
[tool.botcore]
linter = "biome"
# This is uncommon but valid — e.g., a mixed-language repo where TS tooling is preferred.
# Most repos should omit this and let auto-detection choose the right tool.

# Or let auto-detection work:
# No linter key → detect language → pick default module for that language
```

```python
def resolve_capability(capability: str, config: BotCoreConfig, registry: ModuleRegistry) -> Command:
    """Find the right module command for a capability."""
    providers = registry.get_providers(capability)

    if not providers:
        raise ModuleNotFoundError(
            f"No module provides '{capability}'. "
            f"Install one: pip install botcore-ruff (Python) or botcore-biome (TypeScript)"
        )

    # Check explicit config override
    config_key = CAPABILITY_CONFIG_MAP.get(capability)  # e.g., "lint" → "linter"
    if config_key and getattr(config, config_key, None):
        preferred = getattr(config, config_key)
        match = next((p for p in providers if p.module_name == preferred), None)
        if match:
            return match.command
        raise ConfigError(f"Config says {config_key}={preferred} but module '{preferred}' is not installed")

    # Auto-detect: filter by language
    lang = config.language or detect_language(config.workspace)
    lang_providers = [p for p in providers if p.language == lang or p.language is None]

    if len(lang_providers) == 1:
        return lang_providers[0].command
    elif len(lang_providers) > 1:
        names = [p.module_name for p in lang_providers]
        raise AmbiguousCapabilityError(
            f"Multiple modules provide '{capability}' for {lang}: {names}. "
            f"Set '{config_key} = \"{names[0]}\"' in [tool.botcore] to choose."
        )
    else:
        raise ModuleNotFoundError(
            f"No module provides '{capability}' for language '{lang}'. "
            f"Available: {[f'{p.module_name} ({p.language})' for p in providers]}"
        )
```

---

## What Ships in the Kernel vs Modules

The kernel is deliberately small — framework + registration + config + bootstrap:

**In kernel (botcore):**
- Module/plugin registry and discovery
- Config system (load, validate, resolve)
- CLI framework (Click with dynamic command loading)
- MCP framework (FastMCP with dynamic tool loading)
- Bootstrap commands (help, docs, schema — ported from AFD)
- Skill registry (seed, sync, lint, list, status)
- Quality gate runner (orchestrates modules, not the tools themselves)
- Workspace detection utilities
- CommandResult / success / error / failure (re-export from AFD)

**In modules (separately installable):**
- Every linter, test runner, formatter, analysis tool
- Research (requires google-generativeai dependency)
- CDP browser automation (requires websockets dependency)
- Spec lifecycle commands
- Doc quality commands

This means `pip install botcore` is lightweight. Heavier dependencies (google-generativeai, ruff, websockets) only install when their module is chosen.
