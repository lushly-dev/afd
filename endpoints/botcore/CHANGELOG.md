# Changelog

All notable changes to botcore will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **0.6.0 managed hosts:** explicit worktree/target contexts, host-owned identity,
  deterministic plugin admission, effects metadata/policy and shared CLI/MCP/DirectClient dispatch.
- **Quality verdicts:** strict adapters keep execution success separate from passing checks,
  with target/evidence and nonpassing empty/skipped/unavailable aggregate behavior.
- **Provenance:** imported from upstream Botcore main with exact source allowlist and MIT notices;
  all distributions remain quarantined under original publisher authority.

### Changed

- Managed raw Python requires explicit trusted-local mode. Legacy trusted-local MCP/CLI
  aliases retain their behavior and are ineligible for restricted profiles.
- Duplicate command/docs registrations and foreign category fragments now reject clearly.
  Category release operations safely deny npm projects pending host protocol/unit routing.
- Development uses the repository's Python AFD source and MCP SDK 2.3; a lazy SDK
  adapter retains MCP 1 support and wheel metadata retains `afd>=0.9.0`.
- Agents wildcard discovery declares an optional connectors extra and returns an
  actionable unavailable-integration result before session creation when absent.


## [0.5.0] - 2026-07-28

### Changed

- **runner: raise the default output budget to 100,000 chars** -- `MAX_OUTPUT_LENGTH` was 8000, a limit inherited from small-context models. Truncating a structured payload (JSON, NDJSON) does not shorten it, it *corrupts* it into an unparseable string, so any command returning structured data over 8KB failed at the parse step rather than degrading gracefully. Callers that relied on the old default now receive up to 100,000 chars.
- **runner: report truncation explicitly** -- `run_command` now returns a `truncated: bool` on every return path, so a caller can detect a clipped payload instead of silently parsing corrupt output.
- **skills: mcp-builder output guidance** -- the skill and its `token-budget`/`troubleshooting` references taught the 8000 default as the recommended pattern. Guidance is now "bound prose, never truncate structured payloads."

### Added

- **runner: `max_output` parameter** -- `run_command(..., max_output=N)` overrides the default budget per call; `max_output=None` disables truncation entirely for commands whose output must survive intact.

### Fixed

- **runner: `smart_truncate` with small budgets** -- head/tail sizes were hardcoded at 3000/4000, so any `max_len` under 7000 returned output *longer* than the requested budget. Head and tail now scale to fit `max_len`.
- **`__version__` drift** -- v0.4.0 bumped `pyproject.toml` but not `botcore.__version__`, so `botcore --version` and the MCP server handshake both advertised `0.3.5` from a `0.4.0` package. A test now pins `__version__` to the `[project] version`, so the two cannot diverge again.
- **changeset: platform-dependent paths in command results** -- `changeset_create`, `changeset_delete`, and `changeset_status` returned `str(Path.relative_to(...))`, which emits `.changeset\name.md` on Windows and `.changeset/name.md` elsewhere. Those values are handed to agents and fed back into `changeset_delete` as `undo_args`, so results now use POSIX separators on every platform.

## [0.4.0] - 2026-04-02

### Changed

- **BREAKING: skill naming convention** -- All 55 bundled skills renamed from verb-noun to noun-first format. Three naming tiers: bare noun for actions (`commit`, `pr`, `release`), noun-role for agent skills (`code-reviewer`, `mcp-builder`, `test-writer`), and noun-`learn` for reference skills (`caching-learn`, `authentication-learn`, `concurrency-learn`). Update any `skills` lists in agent configs and `include`/`skip` lists in `[skills]` config to use new names.

### Added

- **agents: state config model** -- `AgentsStateConfig` nested model replaces flat `state_backend`/`state_path`/`state_retention_hours` fields with structured `state.enabled`, `state.resolve_path()`, and `state.autosave` support.
- **agents: per-agent permissions** -- Agent capability declarations and permission profiles for shell, filesystem, MCP, and custom tool access.
- **skills: configure-agents** -- New skill for configuring botcore agent teams with MAS research patterns, persona definitions, and skill granularity guidance.

## [0.3.5] - 2026-03-19

### Improved

- **trace summaries** -- Split Chrome trace summaries into clearer signal buckets so main-thread work, browser/compositor pressure, and metric spans are reported separately. Summaries now surface `mainThreadTopByDuration`, `primaryThreadLongTasks`, `browserPipelineLongTasks`, `metricSpans`, and a compact `signals` block to make “is this a real app red flag?” easier to answer quickly.

## [0.3.4] - 2026-03-19

### Added

- **trace analysis** -- Add `cdp_trace_query` and `cdp_trace_summary` so Chrome DevTools traces can be queried and summarized through Perfetto instead of raw JSON parsing. The new workflow exposes a stable summary for automation plus direct PerfettoSQL for deeper investigation.

### Fixed

- **cdp tracing** -- Replace the earlier Playwright trace artifact path with real Chrome DevTools `Tracing.start/end` capture and save traces into a dedicated `.botcore/traces` directory. This produces Perfetto-readable trace files that FAST-AF and other botcore consumers can analyze directly.
- **cdp extra** -- Include `perfetto` in the `cdp` extra so trace analysis works in standard BotCore browser installs instead of requiring a one-off local dependency.

## [0.3.3] - 2026-03-19

### Fixed

- **cdp_snapshot** -- Replace the removed `page.accessibility` path with Playwright's current locator-based `aria_snapshot()` API. Accessibility snapshots now work again in the CDP toolchain, including subtree snapshots via `root_selector`, and return both a structured tree and the raw ARIA snapshot text.

## [0.3.2] - 2026-03-19

### Fixed

- **cli** -- Restore plugin command registration in the Click CLI startup path by registering discovered plugin commands with explicit command names. This fixes `botcore skill-lint` and other plugin-backed CLI flows that were crashing during startup with `SimpleRegistry.register()` argument errors.
- **version** -- Sync `src/botcore/__init__.py` with the package version so runtime metadata now matches `pyproject.toml`.

## [0.3.1] - 2026-03-14

### Added

- `dev_check_lockfile()` command -- detects lockfile drift (lockfile staged without manifest change), supports TypeScript/Python/Rust ecosystems
- `staged_only` parameter on `dev_check_size()` -- filters to only staged files for pre-commit hooks

### Fixed

- `quality_gate.py` now uses smart script name lookup for TypeScript projects (tries `type-check` before `typecheck`, `test:run` before `test`)

## [0.3.0] - 2026-03-14

### Added

- **cli** -- Click CLI entry point (`botcore` command) with `init`, `serve`, `skill-seed`, `skill-list`, `skill-status`, `info`, `changeset-create`, `changeset-status`, and `changeset-consume` subcommands. `botcore init` scaffolds a new project with language-detected `botcore.toml` and skill seeding. `--non-interactive --json` mode for agent-safe zero-prompt setup with structured output. `--language`, `--force`, `--no-skills`, and extension flags (`--with-agents`, `--with-llm`, `--with-memory`) for fine-grained control. `botcore serve` starts the MCP server. `python -m botcore` delegates to the CLI. Entry point registered via `[project.scripts]` in pyproject.toml.
- **changesets** -- Changeset-based changelog workflow. Each user-visible change gets a `.changeset/<id>.md` file with type and description. Three new commands: `changeset_create` (create a changeset file), `changeset_status` (list pending changesets), `changeset_consume` (consume changesets into CHANGELOG.md grouped by type). `docs_check_changelog` updated to be changeset-aware — passes when changeset files exist for staged changes. CLI commands: `botcore changeset-create`, `botcore changeset-status`, `botcore changeset-consume`. No new dependencies.
- **botcore-agents** -- Per-agent permission profiles (`AgentPermissionsConfig`) extending `LlmPermissionsConfig` with `shell_allowlist` (fnmatch glob patterns, shell operator splitting) and `filesystem_paths` (resolved prefix matching). Each agent declares its own `permissions` in config; the orchestrator passes them through to `llm_session_create`. Permission handler includes `agent_name` in all audit log messages. Secure by default — shell and filesystem denied unless explicitly enabled.
- **botcore-architecture skill** — System topology, package map, request flows, security boundaries, and extension points for agent learning
- **botcore-principles skill** — 12 design tenets (CommandResult Everywhere, Opt-In Composability, Constrained Agency, Meta-Tool Pattern, etc.) with decision heuristics and anti-patterns
- **ROADMAP.md** — Feature trajectory: foundation (active), Phase 2 (proposed), future, and non-goals
- **3 foundation specs** (`docs/features/active/`) — Agent capability declarations, orchestrator state serialization, per-agent permissions
- **4 proposed specs** (`docs/features/proposed/`) — Async task execution, cost-aware routing, SQLite memory backend, Azure connectors
- **botcore-connectors** -- New plugin package for typed HTTP connectors (`pip install botcore-connectors`)
  - **Connector base layer** (spec 01) -- `ConnectorBase` with inlined retry, rate-limiting, backoff, telemetry (trace ID + timing), and HTTP-to-error-code mapping. `ConnectorContext` Pydantic model for shared config.
  - **Auth & credential resolution** (spec 02) -- `DefaultCredentialResolver` with env var → `gh` CLI fallback chain, token caching with TTL, 401 auto-retry with invalidation, and token redaction from logs/serialization.
  - **Config & plugin wiring** (spec 03) -- `ConnectorsConfig` Pydantic model with per-connector sub-models, `[connectors].enabled` filtering, `ConnectorsPlugin` with two-phase init and `BotCorePlugin` protocol conformance.
  - **Security model** (spec 04) -- Input validation helpers (`check_max_length`, `check_owner_repo`, `check_no_path_traversal`, `validate_inputs`), scope enforcement (`check_scope`), and structured audit logging with `sanitize_args`.
  - **GitHub connector** (spec 05) -- `GitHubConnector` subclass with dual rate-limit tracking (API vs search), `X-RateLimit-Reset` backoff, error remapping (NOT_FOUND → GITHUB_NOT_FOUND, etc.), and 8 commands: `github_issue_create`, `github_issue_list`, `github_issue_comment`, `github_pr_create`, `github_pr_list`, `github_pr_review`, `github_search_code`, `github_search_issues`. 248 tests passing.
- **botcore-memory plugin (Phase 1)** -- New `packages/botcore-memory` package providing persistent agent memory with local JSON file store, 5 CRUD commands (`memory_set`, `memory_get`, `memory_search`, `memory_delete`, `memory_list`), three scopes (agent/team/task), scope-based access control, and `MemoryStore` ABC for future backends (Cosmos DB)
- **botcore-agents plugin (Phase 1)** -- Separate `packages/botcore-agents/` package providing single-agent lifecycle management
  - `AgentsPlugin` implementing `BotCorePlugin` protocol with entry-point discovery
  - `AgentOrchestrator` singleton managing agent pool, task store, and LLM session lifecycle
  - `AgentConfig` / `AgentsPluginConfig` Pydantic models with `extra="forbid"` validation
  - `Task`, `AgentHealth`, `AgentState` domain models with field constraints and status literals
  - 9 commands: `agent_create`, `agent_start`, `agent_stop`, `agent_status`, `agent_heartbeat`, `task_assign`, `task_status`, `state_save`, `state_load`
  - Direct `botcore-llm` integration — agents backed by LLM sessions with scoped tools
  - Role-based agent pooling — `task_assign(role="pm")` routes to idle agents or auto-spawns new instances from config templates when all are busy
  - `_resolve_agent_for_role` with search order: reuse idle → spawn from template → error at pool capacity
  - Sequential instance naming (`researcher-1`, `researcher-2`, …) with config inheritance from role template
  - Capability declarations — `connector_commands` field on `AgentConfig` for fine-grained tool access, `resolve_connector_commands()` with 4-step resolution (explicit list → deny-by-default → wildcard via `KNOWN_CONNECTORS` → prefix filter), and `_resolve_tools()` combining skills + connector commands at session creation
  - Synchronous task execution via `llm_chat` (background execution planned for Phase 3)
  - **State serialization** — `OrchestratorSnapshot` model, `OrchestratorStateBackend` Protocol, and `JsonStateBackend` with atomic writes (`tempfile` + `os.replace`), async I/O via `asyncio.to_thread()`, and configurable retention. `save_state`/`load_state` on orchestrator with `NO_BACKEND`, `STATE_SAVE_ERROR`, `STATE_LOAD_ERROR` error codes. Restored agents forced to `stopped` with cleared session metadata.
  - 110 unit + integration tests with mocked LLM commands
- **botcore-llm plugin (Phase 1)** -- Separate `packages/botcore-llm/` package providing LLM runtime via Copilot SDK
  - `LlmPlugin` implementing `BotCorePlugin` protocol with entry-point discovery
  - `CopilotClientManager` singleton for client lifecycle (start/stop)
  - Command-to-tool bridge (`botcore_command_to_copilot_tool`) auto-converts botcore commands to Copilot SDK tools
  - Permission gate denying shell/filesystem by default, configurable via `LlmPermissionsConfig`
  - In-memory `SessionRegistry` for active session tracking
  - 5 commands: `llm_session_create`, `llm_session_destroy`, `llm_session_list`, `llm_model_list`, `llm_chat`
  - `LlmConfig` Pydantic model with permissions, cost, and session settings
  - 40 unit tests with mocked Copilot client (no real CLI needed)
- **Lefthook git hooks** -- Pre-commit, pre-push, and on-demand quality gate hooks
  - `check-file-size.mjs` -- Warn >300 lines, error >500, hard cap 1000 with `# botcore-override: max-lines=N` escape hatch
  - `check-portability.mjs` -- Detect machine-specific paths in Python source
  - Pre-commit: ruff check --fix (staged), ruff format (staged), portability, file-size
  - Pre-push: Full ruff lint, format-check, pytest, portability, file-size
  - On-demand `check`: Same as pre-push
- **Comprehensive test coverage** -- 22+ tests covering non-CDP modules (#1)
- **do-documentation-update** -- standalone skill for documentation update passes (CHANGELOG, AGENTS.md, README.md, specs, roadmap, link verification). Includes changelog-versioning reference covering SemVer, git tags, comparison links, and monorepo strategies.
- **do-clean-repo** -- periodic repo cleanup skill for stale branches, orphaned worktrees, dead test files, agent artifacts, build output, orphaned configs, and lockfile hygiene. Scan and full modes with confirmation before destructive actions.
- **retry_async** -- shared async retry utility in `botcore.utils.runner` with configurable attempts, delay, and input validation. CDP retry loops refactored to use it.
- **AFD 0.6.0 adoption** -- Full adoption of AFD 0.6.0 features across botcore core:
  - **Middleware stack** -- `MiddlewareRegistry` wrapper applies `default_middleware()` (trace_id, logging, timing) plus plugin-registered middleware to every command execution via `get_client()`
  - **Telemetry** -- Opt-in telemetry via `telemetry_enabled` and `telemetry_format` config fields; wires `ConsoleTelemetrySink` into the middleware chain when enabled
  - **Batch execution** -- `batch_execute()` helper runs multiple commands with timing, summary, confidence, and `stop_on_error` support
  - **Pipeline docs** -- `PIPELINE_DOCS` constant documenting `DirectClient.pipe()` with variable resolution, aliases, conditionals, and error handling
  - **Richer CommandResult** -- `suggestions` on info/docs commands, `confidence` and `sources` on research results
  - **Testing helpers** -- Migrated 10 test files (~80 assertions) to `afd.testing.assert_success` / `assert_error`
  - **Plugin middleware wiring** -- `add_middleware()` activated with proper signature; CLI startup discovers plugins and wires middleware into registry
- **5 active plugin specs** -- LLM Runtime, Agent Orchestration, Connectors, Memory System, and Teams Interface plugin specs with AFD integration sections
- **botcore-teams plugin (Phase 1)** -- Microsoft Teams bot interface as first external plugin in `plugins/botcore-teams/`
  - Regex intent parser (6 patterns: task_assign, task_status, team_status, task_cancel, task_list, unknown)
  - Adaptive Card v1.4 renderer for `CommandResult` (success/error, plan steps, sources, confidence, suggestions)
  - Tenant-gated auth (`validate_tenant`, `extract_identity` → `TeamsIdentity`)
  - Command handlers (`teams_handle_message`, `teams_handle_card_action`) with stub dispatch fallback
  - Bot Framework webhook (`TeamsBot` + `create_app()` via aiohttp + botbuilder)
  - `TeamsPlugin` entry-point implementing `BotCorePlugin` protocol
  - 62 tests, 94% coverage

### Fixed

- **version** -- `__init__.__version__` now matches `pyproject.toml` version (was `0.2.0`, should be `0.2.1`)
- **connectors** -- Fix stale pre-flight GitHub rate-limit gating by allowing requests after reset window expiry; harden audit sanitization to recurse into list/tuple/set containers so nested sensitive keys are redacted
- **teams** -- Repair dispatch path to use DirectClient with UNKNOWN_TOOL fallback; add `allowed_groups` authorization gate; thread `original_text` through Retry button action data; change `TeamsIdentity.roles` to immutable `tuple[str, ...]`
- **memory** -- Wire plugin config injection via `configure` hook in `build_namespace`; enforce `max_entries_per_scope` atomically in local store with `MEMORY_SCOPE_FULL` error
- **plugins** -- Inject validated plugin config in `build_namespace` and call plugin `configure` hooks before registration; add configure hooks for botcore-agents and botcore-llm; reset agents orchestrator on config change
- **retry_async** -- Add `attempts >= 1` validation (was unreachable error path); remove misleading `RuntimeError` fallback

### Changed

- **afd** -- Bumped minimum from `>=0.1.0` to `>=0.6.0`. Picks up Python-TypeScript parity (batch execution, streaming, middleware stack, telemetry, MCP client, testing helpers, connectors, handoff), contextual tool loading, output shape predictability, schema examples, and command prerequisites. No breaking changes for botcore — all existing `CommandResult`, `success`, `error`, `DirectClient` usage is unchanged.
- **`__main__.py`** — `python -m botcore` now delegates to the CLI instead of starting the MCP server directly. Use `botcore serve` to start the server.
- **AGENTS.md** — Added CLI section with command table; added `cli.py` to architecture tree
- **AGENTS.md** — Added Architecture & Principles section and Roadmap section referencing new skills and feature trajectory
- **LANDSCAPE.md** — Trimmed to pure competitive positioning; architecture and vision sections replaced with pointers to skills, specs, and ROADMAP.md
- **monorepo layout** -- Moved `botcore-llm/` into `packages/botcore-llm/` to establish `packages/` convention for plugin packages
- **botcore.toml** -- Expanded configuration with language, tooling, threshold, and hygiene settings
- **CONTRIBUTING.md** -- Comprehensive rewrite with lefthook setup, development workflow, and contribution guidelines
- **do-commit** -- Step 3 (Documentation Gate) now delegates to the `do-documentation-update` skill instead of inlining checks. Adds spec completion, roadmap updates, and link verification to the documentation pass.

## [0.2.1] - 2026-02-22

### Changed

- Promoted project status from Alpha to Beta across repository docs and package metadata.

## [0.2.0] - 2026-02-22

### Changed

- Migrated to standalone repository from `libraries/py/packages/botcore`

### Added

- `do-commit`, `do-pr`, `do-release`, `do-review`, `do-hotfix` action skills
- `automate-browsers`, `build-botcore-plugins`, `configure-botcore`, `run-dev-checks` skills
- 52 bundled universal skills total
- Multi-language project support. `LanguageConfig` model with per-language `root`, `linter`, `test_runner`, `formatter`. `language_config` dict on `BotCoreConfig` with `languages` property and `get_tools_for()` method. `resolve_language()` 5-step priority chain (explicit override → root prefix → package override → marker walkup → primary fallback). All dev commands (`lint`, `test`, `build`) accept `--language` and `--path` params. Quality commands (`check-size`, `check-coverage`, `check-deps`) dispatch to npm/cargo ecosystems. Analysis commands (`dead-code`, `circular-imports`, `unused-deps`, `dep-graph`) dispatch to knip, madge, depcheck, cargo-udeps, cargo-modules. `run_external_tool()` helper with skip-with-warning behavior. Multi-language "run all" mode. Config validation warns on primary language not in `language_config` and overlapping root prefixes. `language` field added to `PackageOverrideConfig`. 24 new tests.

## [0.1.0] - 2026-02-19

Initial release (developed in `libraries/py/packages/botcore`).

### Added

- Shared bot infrastructure package (Phases 1a–1c). Config system, plugin contract, and full command extraction from lushbot: dev commands (lint, test, build, quality gates, analysis, portability), docs (lint, changelog, agents), CDP browser automation (28 commands), research (Gemini + Google), spec lifecycle, and undo/history. Language-aware dispatch (Python/TypeScript/Rust). 80 tests.
- Skill registry (Phase 2). 6 new commands: `skill_seed` (copy skills with `source:` ownership), `skill_list` (installed + available), `skill_status` (version drift detection), `skill_lint` (SK001–SK015 quality rules), `skill_adopt` (claim unmanaged skills), `skill_index` (generate `_index.md`). YAML frontmatter engine with `SkillManifest` model. Three-tier skill ownership via `source:` protocol. 21 bundled universal skills. 70 new tests (150 total).
- Unified plugin system (Phase 3). MCP server factory (`create_mcp_server`), dynamic namespace builder (`build_namespace`), and docs aggregator (`build_docs`). Plugin commands and docs automatically wired into MCP and CLI surfaces. `PluginRegistry` gains `add_docs()`/`docs` for topic-based documentation. `CORE_DOCS` dict centralizes botcore command documentation. 22 new tests (172 total).
- Phase 1d: lushbot wired to botcore plugin system. `LushxPlugin` registers agent commands + afd-lint + docs via `botcore.plugins` entry point. Dead extension code removed (~100 lines).
