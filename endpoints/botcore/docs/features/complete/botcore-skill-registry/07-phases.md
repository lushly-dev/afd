# Phases

> Part of [Bot Core + Skill Registry Plan](./00-overview.md)

---

## Phase 1: Extract — Monolithic Bot Core Package

Pull general-purpose code out of lushbot into `libraries/py/packages/botcore` as a
**single monolithic package** — all commands, all quality gates, research, cdp, spec,
docs, info, undo included. No module split yet. Plugin extension points exist for
project-specific commands, but the core ships everything.

Split into sub-phases to keep each deliverable reviewable:

### Phase 1a: Skeleton + Config + Plugin Contract ✅

> **Completed 2026-02-19** — `libraries/py/packages/botcore/` · 34 tests · 80% coverage

- [x] Package scaffold (`pyproject.toml`, `src/botcore/`, `tests/`)
- [x] `BotCoreConfig` + `PackageOverrideConfig` + `SkillsConfig` + `EnvConfig` Pydantic models
- [x] Config loader (pyproject.toml `[tool.botcore]` + `botcore.toml` fallback)
- [x] `BotCorePlugin` protocol + entry-point discovery (`botcore.plugins`)
- [x] Extracted commands: `info_workspace`, `info_env`, `info_scripts`
- [x] Generalized workspace detection (pnpm, Cargo, pyproject, package.json, .git)
- [x] Language auto-detection + dev tool defaults (Python/TypeScript/Rust)
- [x] Per-package override resolution with REPLACE semantics
- [x] Command runner utilities (`run_command`, `run_python_module`, `smart_truncate`)
- [x] AFD registry wrapper (`SimpleRegistry` + lazy `DirectClient`)
- [x] Unit tests: config, plugin, info, runner, registry

**Acceptance criteria — all met:**
- [x] `pip install -e .` succeeds
- [x] `from botcore import BotCoreConfig, load_config` works
- [x] Config with typo raises `ValidationError` naming the unknown field
- [x] `info_workspace()` returns `CommandResult` with workspace path
- [x] Plugin discovery finds test plugin registered via entry point
- [x] All tests pass, ruff clean

### Phase 1b: Dev + Docs Commands ✅

> **Completed 2026-02-19** — 29 new tests (63 total)

- [x] Dev core commands: `dev_lint`, `dev_test`, `dev_build`, `dev_skill_lint`
- [x] Language-aware tool dispatch (Python→ruff/pytest, TypeScript→biome/vitest, Rust→clippy/cargo)
- [x] Quality gates: `dev_check_size`, `dev_check_coverage`, `dev_check_deps`
- [x] Analysis: `dev_dead_code`, `dev_circular_imports`, `dev_unused_deps`, `dev_dep_graph`
- [x] Portability: `dev_check_paths`
- [x] Docs: `docs_lint`, `docs_check_changelog`, `docs_check_agents`
- [x] Config-driven thresholds (file_size_warn/error from `BotCoreConfig`)
- [x] Optional dependency group: `quality` (httpx)

**Acceptance criteria — all met:**
- [x] `dev_lint` dispatches to ruff for Python and biome for TypeScript projects
- [x] `dev_check_size` respects `file_size_warn`/`file_size_error` from config
- [x] All extracted commands return `CommandResult`
- [x] All tests pass, ruff clean

### Phase 1c: CDP + Research + Spec + Undo ✅

> **Completed 2026-02-19** — 17 new tests (80 total) · 34% coverage

- [x] CDP browser automation (28 commands across 7 modules)
- [x] CDP session management (`.botcore/cdp-session.json`)
- [x] CDP performance profiling (`perf_metrics`, `perf_trace_*`, `perf_profile_*`, `perf_coverage`)
- [x] Research commands (`research_query` with Gemini + Google)
- [x] Spec lifecycle (`spec_create`, `spec_status`, `spec_validate`)
- [x] Undo/history (`undo_status`, `undo_clear`, `save_history`, `load_history`)
- [x] Optional dependency groups: `cdp` (playwright, httpx), `research` (google-genai)

**Acceptance criteria — all met:**
- [x] CDP session management works (save/load/clear)
- [x] `research_query` validates mode and checks for dependencies
- [x] `spec_create` writes spec from template with frontmatter
- [x] All tests pass, ruff clean

### Phase 1d: First Consumer (lushbot) ✅

> **Completed 2026-02-19** — `LushxPlugin` wired to botcore plugin system

- [x] `LushxPlugin` (BotCorePlugin) registers agent commands + afd-lint + docs
- [x] `botcore.plugins` entry point in pyproject.toml
- [x] `execute.py` uses `build_namespace()` — no hardcoded namespace
- [x] `mcp_server.py` uses `build_docs()` — no hardcoded CLI_DOCS
- [x] `smart_truncate` imported from `botcore.utils.runner` (duplicate deleted)
- [x] Dead extension code removed (~100 lines: `register_command`, `register_mcp_tool`, subdirectory system)
- [x] Tests: plugin registration, dynamic namespace with short aliases

**Acceptance criteria — all met:**
- [x] lushbot's existing test suite passes with botcore installed
- [x] `lushx dev lint` still works (now delegating to botcore)
- [x] Agent spawn/status/finish commands work via lushbot-plugin
- [x] Dynamic namespace includes botcore core + plugin commands + short aliases

---

## Phase 2: Skill Registry — Seed/Sync/Lint ✅

> **Completed 2026-02-19** — 70 new tests (150 total)

Build `botcore skill seed/sync/lint/list/status/adopt` commands. Ship the 20+ general
skills as part of the package. Implement the `source:` frontmatter protocol.

- [x] 6 commands: `skill_seed`, `skill_list`, `skill_status`, `skill_lint`, `skill_adopt`, `skill_index`
- [x] YAML frontmatter engine with `SkillManifest` model
- [x] Three-tier skill ownership via `source:` protocol (botcore, plugin, local)
- [x] 21 bundled universal skills
- [x] 15 lint rules (SK001–SK015)

**Acceptance criteria — all met:**
- [x] `botcore skill seed` writes skills to `.claude/skills/` with `source: botcore` frontmatter
- [x] `botcore skill status` shows version drift for managed skills
- [x] `botcore skill adopt <name>` claims an existing unmanaged skill (adds `source:` field)
- [x] Skills with mismatched `source:` are not overwritten by `seed`

---

## Phase 3: Wire — Unified Plugin System ✅

> **Completed 2026-02-19** — 22 new tests (172 total)

MCP server factory (`create_mcp_server`), dynamic namespace builder (`build_namespace`),
and docs aggregator (`build_docs`). Plugin commands and docs are automatically wired into
MCP and CLI surfaces — no hardcoded tool lists.

- [x] `botcore.server` module: `build_namespace()`, `build_docs()`, `create_mcp_server()`
- [x] `botcore.docs` module: `CORE_DOCS` dict (6 topics)
- [x] `PluginRegistry.add_docs()` / `.docs` property for topic-based documentation
- [x] Optional `mcp` dependency group
- [x] libbot MCP server reduced from 329→27 lines (delegates to factory)
- [x] libbot CLI COMMANDS built dynamically from `build_namespace()`
- [x] `LibbotPlugin` registers docs via `add_docs("lib", LIB_DOCS)`

**Acceptance criteria — all met:**
- [x] MCP server exposes plugin commands as tools (no hardcoded tool list)
- [x] CLI `--help` shows plugin commands alongside core commands
- [x] Removing a plugin removes all its commands from CLI + MCP
- [x] Dead registration code is deleted

---

## Phase 4: Validate — Second Consumer ✅

> **Completed 2026-02-19** — libbot (libraries monorepo) validates the plugin model

Originally planned for proto or mechanic, but **libbot** — the libraries monorepo bot —
serves as the second consumer. It was developed in parallel with botcore in the same repo,
proving the plugin model works end-to-end. The lushx bot (in the lushbot repo) is the
primary consumer; libbot is the validation consumer.

- [x] `LibbotPlugin` registers 4 project-specific commands via `botcore.plugins` entry point
- [x] `libbot dev lint` delegates to `botcore dev lint` (language-aware dispatch)
- [x] MCP server uses `create_mcp_server("lib")` — fully factory-driven
- [x] CLI built dynamically from `build_namespace()`
- [x] Plugin docs registered and served via `{name}-docs` tool
- [x] 48 tests pass (plugin registration, dynamic namespace, CLI, commands)

**Acceptance criteria — all met:**
- [x] libbot's plugin registers its project-specific commands
- [x] `libbot dev lint` delegates to `botcore dev lint` (language-aware dispatch)
- [x] libbot and lushx can pin different botcore versions without conflict
- [x] All tests pass for both botcore (172) and libbot (48)

---

## Phase 5: Module Split (If Needed)

If Phase 4 reveals that consumers need different tool matrices (e.g., proto needs biome
but not ruff, mechanic needs clippy), split tool-specific commands into separately
installable `botcore-*` module packages with the capability-based dispatch system
described in [Appendix A: Module Architecture](./10-appendix-module-architecture.md).
**Do not split prematurely** — only when a real consumer needs a different tool matrix
than what ships in core.

**Acceptance criteria (conditional):**
- `pip install botcore` does not install ruff/biome/websockets
- `pip install botcore[python]` installs ruff + pytest + vulture
- Capability dispatch resolves correct provider based on language + config
