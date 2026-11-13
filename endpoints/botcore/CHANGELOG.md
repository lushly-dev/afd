# Changelog

All notable changes to botcore will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

What a plugin served through the managed host needs: its own command policies, a catalog a model can call from, and refusals that name the fix. `docs/host-composition.md` describes all three.

### Added

- **Plugins declare their command policies.** `PluginRegistry.add_policy(name, policy)` and `add_policies({...})` declare the `CommandPolicy` of each command a plugin registers, so a host no longer passes every one to `build_host(policies=...)`. `build_host` refuses a policy for a command the declaring plugin did not register. An explicit host policy for the same command may only narrow the plugin's: effects among the plugin's, every confined path kept, no always-present effect left out; anything else refuses construction. The plugin's per-argument effects still decide each call, and a call whose effects fall outside the host's set is `EFFECT_DENIED`.
- **The catalog carries what a model needs.** `CommandHost.catalog()`, and so the managed CLI `catalog` and MCP `start`, gives each command a one-line `description` (the docstring's first line) and an `input_schema` derived with Pydantic from the handler's signature and type hints: required inputs, defaults, `Literal` enums, optional, list and dict types, and per-input descriptions from Google-style `Args:` or Sphinx `:param` docstrings, each capped at 200 characters. `DirectClient.list_commands()` reports the same one-line descriptions instead of whole docstrings.

### Changed

- **Wrong arguments are refused with the way forward.** On the CLI, MCP and DirectClient surfaces alike, an argument the handler does not take, or a missing required one, is refused before binding with `VALIDATION_ERROR` (was `INVALID_TARGET_OR_INPUT`). Its details list `expectedFields`, `unexpectedFields` and `missingFields`, and its `suggestedFields` and suggestion name the input a wrong key most likely meant: the same name in another case convention (`timeoutMs` for `timeout_ms`), else the closest name.
- Effects a call computes beyond its policy's declared set are `EFFECT_DENIED` (was `INVALID_TARGET_OR_INPUT`).

## [0.7.0] - 2026-11-13

The bloat sweep, shared with Lushly: a skill and the `[sweep]` section it reads. A `[sweep]` section in `botcore.toml` needs this release, since earlier ones refuse unknown keys.

### Added

- **`bloat-sweeper` skill.** A periodic pass that ranks files over `file_size_warn` by size and churn, finds code copied between files, judges each candidate's seam, and fixes the worst few in one PR, so a commit gate only needs to guard runaway growth. Its `scripts/sweep.mjs` needs only Node and git (and `gh` for open pull requests and the trend issue), ships in the wheel, and reads a new `[sweep]` section (`SweepConfig`): `trend_issue`, `cohesive`, `exclude`, `churn_days`, `extensions` and `measures`. Adapted from Lushly's `do-sweep` bloat mode, with areas taken from the nearest package manifest and stories left out of the ranking. A repository adopting it with its own trend issue and cohesive file sets `trend_issue` and `cohesive`, and carries measures such as bundle sizes or test-only exports through `measures`; a `[sweep]` section needs this release, since older ones refuse unknown keys.

## [0.6.1] - 2026-11-12

Fixes for repositories that seed Botcore's skills, and docs checks that cover a whole
monorepo. Prepared on 2026-11-07 and released with the docs-check fix that landed since.

### Fixed

- **Docs checks cover the whole repository**
  ([#779](https://github.com/lushly-dev/afd/issues/779)). `docs_check_changelog` reads staged
  code under any `src/` directory, in any of the common languages, against the CHANGELOG.md
  nearest it, so each package of a monorepo answers to its own; before, only `.py` under a
  top-level `src/` counted. `docs_check_agents` also sees new packages (`package.json`,
  `pyproject.toml`, `Cargo.toml`), skills and workflows, and command modules in any language.
  `docs_lint` lints a single file it is given, where it checked nothing, and skips
  `node_modules`, virtual environments and build output. In an npm repository the checks
  suggest its Changesets command rather than `changeset_create`, which refuses one.
  `docs_check_agents` now reports packages, skills and workflows only when they are added, and
  labels an edited command module "Changed command"; in a monorepo these advisory checks can
  flag more than before. `docs-manager` 2.1.1 describes the checks as they now are.
- **Seeded skills** read correctly outside AFD. `security-auditor` defers to a repository lane
  that defines blockers by impact; `docs-manager` allows a root `CLAUDE.md` whose only line is
  `@AGENTS.md`; `plugin-builder`, `mcp-builder`, `security-auditor` and `botcore-config` link
  `host-composition.md` on GitHub and name package modules rather than AFD repository paths.
  Their versions are bumped so `skill-status` reports the drift and `skill-seed --update`
  refreshes them.
- **skill-manager** (4.1.1) no longer names AFD's `pnpm verify` as its example of a single source, so seeded
  copies don't cite a command a consuming repository lacks.

## [0.6.0] - 2026-11-07

The first release published from lushly-dev/afd (`publish-botcore.yml`); 0.5.0 and earlier
were published from lushly-dev/botcore. It carries every change made in either repository
since 0.5.0.

### Added

- **0.6.0 managed hosts:** explicit worktree/target contexts, host-owned identity,
  deterministic plugin admission, effects metadata/policy and shared CLI/MCP/DirectClient dispatch.
- **Quality verdicts:** strict adapters keep execution success separate from passing checks,
  with target/evidence and nonpassing empty/skipped/unavailable aggregate behavior.
- **Provenance:** imported from upstream Botcore main with exact source allowlist and MIT notices;
  its envelope records that AFD publishes `lushly-botcore` and that the other distributions
  have no publisher.

<!-- Ported from lushly-dev/botcore's unreleased changesets (changes made there after 0.5.0 and imported at `7d5c54ca`): -->

- **botcore-llm** -- `llm_chat_stream` (in `botcore_llm.chat_stream`) streams a chat turn as afd stream chunks: progress for the sent message and each tool started, `{"text": ...}` data chunks from the Copilot SDK's `assistant.message_delta` events, then a complete or error chunk. Closing it early aborts the turn. `llm_chat` now collects this stream; its result is unchanged, but cancelling `llm_chat` now also aborts the turn in the session. Data chunks carry `message_id`; a turn that uses tools streams every assistant message, and the complete chunk's `content` is the final one. When the SDK returns no final message, `llm_chat` now returns the last streamed message's text and id instead of empty strings

- **botcore-agents** -- `task_status` shows a running task's progress: `partial_result` (the reply text streamed so far) and `progress_message` (the latest progress, such as `Running grep`). They are held in memory only, not saved with orchestrator state, and are dropped when the task completes, fails, or is cancelled, or when state is restored

- **research** -- `research_stream` streams a research answer as afd stream chunks (progress, text data chunks, then a complete or error chunk); `research_query` collects it into the same result as before and no longer blocks the event loop. The MCP `{name}-research` tool forwards the stream as MCP progress notifications and now returns the result's JSON fields instead of its string form

- **botcore-agents** -- `task_assign_stream` and `task_resume_stream` stream an agent task as afd chunks: a progress chunk with the task id and agent, the agent's chat progress and `{"text", "message_id", "task_id"}` data chunks from `llm_chat_stream`, then a complete or error chunk. `task_assign` and `task_resume` now collect these streams with unchanged results. Closing a stream early aborts the chat turn and marks the task `cancelled`. A task cancelled by `agent_stop` while running now stays `cancelled` (`TASK_CANCELLED`) and its agent stays stopped, and `TASK_EXECUTION_ERROR` now carries a suggestion. Stopping and deleting an agent while its task runs now ends the task as `TASK_CANCELLED` instead of raising

### Changed

- **Publishing moves to AFD for `lushly-botcore` only.** PyPI releases come from AFD's
  `publish-botcore.yml` on a `botcore-vX.Y.Z` tag, after the release inventory admits the
  `botcore` unit on the `pypi-botcore` route and the native guard checks the tag, manifest and
  built artifacts. 0.5.0 was the last release from `lushly-dev/botcore`; 0.6.0 is the first
  from AFD. `botcore-connectors`, `botcore-llm`, `botcore-agents`, `botcore-memory` and
  `botcore-teams` stay quarantined with no publisher. The handoff record is
  `docs/features/active/platform-monorepo/botcore-handoff.md` in AFD.
- **skills: one lint rule set, and ownership in `metadata:`** -- `skill_lint` (MCP, Alfred)
  and `botcore skill-lint` / `skill_lint_spec` (CLI) now share one rule set. Before, the
  first warned when `triggers` or `version` were missing while the second called them
  unsupported, which led a consumer to strip `source:` and silently stop seeding.
  - **Retired rules:** SK006 (triggers required) and SK013 (version required).
  - **Errors:** SK004 (name format and directory) and SK005 (description over 1,024
    characters) are errors.
  - **New warnings:**
    - SK016: description over 300 characters.
    - SK017: `triggers` fields and "Triggers:" lists.
    - SK019: listing over `[skills] listing_budget`, default 8,000 characters. The
      count mirrors how hosts list descriptions.
  - **SK018** accepts current Claude Code fields, and warns on an unquoted numeric
    `version`.
  - **SK001** also covers a `metadata:` that is not a mapping.
  - **SK009** counts lines (500), not characters.
  - **SK012** now flags a lowercase `skill.md`; SK004 covers a directory/name mismatch.
  - **SK008** runs even without a `references/` directory.
  - **SK010** looks only for upper-case TODO, FIXME and TBD, and Lorem ipsum.
  - **Strict:** `strict=True` turns every warning into an error.
  - **`skill_lint_spec`** keeps the default budget and reports `listing.config_error` when
    the enclosing workspace's config fails to load. It counts a mirrored copy of a skill
    once.
  - **Ownership:** botcore now records `source`, `version` and `portable` under the
    open standard's `metadata:` map. It still reads top-level fields from older copies.
    Seed, adopt and render write `metadata:`, and the bundled skills use it. A numeric
    version becomes text instead of hiding the skill's owner.
- **skills: the remaining skills rewritten and merged** -- nine bundled skills remain. Each
  is a single SKILL.md (2.0.0) whose API claims were checked against the code.
  - **Merges.** `review` merged into `code-reviewer`; `docs-update` and `content-humanizer`
    merged into `docs-manager`. All three are now renames, so `skill_seed` migrates
    managed copies.
  - **Code reviewer.** It no longer treats phased delivery as a blocker or requires web
    research on every review.
  - **Plugins.** `plugin-builder` documents the managed host, command policies,
    `error(code, message, ...)` and fail-closed discovery.
  - **MCP servers.** `mcp-builder` documents the MCP SDK and managed raw Python, and
    gives the correct client config locations.
  - **Security.** `security-auditor` covers MCP, command and agent security against
    Botcore's real boundaries.
  - **Browser automation.** `browser-automation` documents the trace commands and the
    CDP commands' actual behaviour. A test checks it names every exported command.
  - **Configuration.** `botcore-config` and `agent-config` state only settings the code
    reads, and `agent-config` gains the `state` block.
  - **Help text.** The `docs` help topic now describes what `docs_lint`,
    `docs_check_changelog` and `docs_check_agents` check.
- **skills: generic skills retired** -- 43 bundled skills whose content was general
  engineering guidance that current models already know are removed, leaving 12 with
  botcore- or ecosystem-specific content. The retired set is every `-learn` skill, the
  commit/PR/hotfix/release/cleanup workflow chain, and api-designer, component-tester,
  content-designer, dependency-manager, design-implementer, dev-checks,
  duplication-finder, git-manager, license-auditor, persona-creator, problem-solver,
  project-manager, prompt-creator, research, spec-writer, storybook-builder,
  systems-architect and test-writer. `RETIRED_SKILLS` lists them under their current and
  earlier names. `skill_seed` removes botcore-managed copies, and their `.agent/skills`
  mirrors, when no `include` list is set and `skip` doesn't name them. It reports the
  copies it keeps in `retired_locally_owned` and never suggests deleting a copy another
  source owns. `skill_status` reports them as `retired`. Renames whose target was
  retired are dropped.
- **skills: skill-manager rewritten for current models** -- the skill now covers what belongs
  in a skill (context an agent can't derive, observed gotchas, repository workflows) and what
  belongs in a hook, script, AGENTS.md or the owning doc instead; descriptions of a sentence
  or two without trigger lists, sized against the shared listing budget; goal-and-constraint
  bodies with reasons instead of capitalised rules; and with/without and trigger evaluations.
  Its references, templates, README and CI example (a removed PowerShell linter) are
  deleted; the 13,000-word reference set restated the open standard. Skill version 4.0.0.
- **skills: mcp-builder token guidance** -- the skill and its `token-budget`/`troubleshooting`
  references replaced the fixed "under 10 tools" and "under 50 tokens per description" caps
  with measuring the serialized `tools/list` payload and keeping it small, dropped
  model-version claims in favour of model-neutral observations to re-test, and made the
  execute pattern an option to re-test on the target client rather than a rule. Skill
  version 1.2.0.
- `{name}-run` output is bounded by `MAX_OUTPUT_LENGTH` (100,000 characters) instead of a
  hard-coded 8,000; the code input guard is `MAX_RUN_CODE_LENGTH` (32,000 characters), an
  abuse guard rather than a context budget.
- `research_stream` and `research_query` take `max_length`; the default
  `MAX_RESEARCH_LENGTH` is 100,000 characters (was 12,000).
- Bundled skills state the linter's SK009 threshold (50,000 characters) instead of line
  targets, describe file-size thresholds from configuration, and ground the file-length
  target in cohesion rather than context-window size.
- Managed raw Python requires explicit trusted-local mode. Legacy trusted-local MCP/CLI
  aliases retain their behavior and are ineligible for restricted profiles.
- Duplicate command/docs registrations and foreign category fragments now reject clearly.
  Category release operations safely deny npm projects pending host protocol/unit routing.
- Development uses the repository's Python AFD source and MCP SDK 2.3; a lazy SDK
  adapter retains MCP 1 support and wheel metadata retains `afd>=0.9.0`.
- Agents wildcard discovery declares an optional connectors extra and returns an
  actionable unavailable-integration result before session creation when absent.

<!-- Ported from lushly-dev/botcore's unreleased changesets (changes made there after 0.5.0 and imported at `7d5c54ca`): -->

- **research** -- **Breaking:** `research_query` now uses OpenAI GPT models with the built-in web search instead of Gemini + Google Search. The `research` extra installs `openai` instead of `google-genai`, and the key is `OPENAI_API_KEY` (was `GEMINI_API_KEY`; `EnvConfig.gemini_api_key` is now `openai_api_key`). Modes: `fast` uses GPT-6 Luna, `deep` and `thinking` use GPT-6.1 Sol at higher reasoning effort

- **skills** -- update LLM guidance for current models: adaptive thinking and effort instead of chain-of-thought prompts and budget_tokens, output_config structured outputs, agent loops that handle early end_turn, pause_turn, and refusal, model-ID placeholders instead of pinned IDs and price tables, and content-humanizer specifics that must come from verified sources Superseded later in this release: AFD retired that skill.

- **deps** -- require `afd>=0.9.0` (was 0.6.0) in botcore and all plugin packages. Pipeline step aliases are now referenced as `$steps.<alias>` (`$g.field` is a literal in afd 0.9); the built-in pipeline docs describe the full 0.9 reference syntax. A command handler that raises now returns `COMMAND_EXECUTION_ERROR` with a generic message (the exception is logged to the `afd.direct` logger) instead of `VALIDATION_ERROR` with the exception text

- **skills** -- make AGENTS.md the only agent instruction file: docs-manager, docs-update, and commit no longer generate or sync a CLAUDE.md (Claude Code reads AGENTS.md only when no CLAUDE.md exists)

- **botcore-llm, botcore-agents** -- **Breaking:** `default_model` no longer defaults to `"gpt-4.1"`. Set it under `[tool.botcore.plugins.llm]` / `[tool.botcore.plugins.agents]` (or pass a model explicitly); otherwise `llm_session_create` and `agent_start` return `CONFIG_ERROR` naming the missing setting. Use `llm_model_list` to find model IDs your Copilot account can use.

- **skills: LLM integration** -- add GPT-6.1 Sol and Claude Sonnet 5.5 model guidance with effort and completed-task cost evaluation. Superseded later in this release: AFD retired that skill.

- Update bundled Node environment skill guidance for the Node 24 LTS baseline. Superseded later in this release: AFD retired that skill.

### Fixed

- `smart_truncate` keeps 40% head and 60% tail of its budget at every size. The head and
  tail had stayed pinned at 3,000 and 4,000 characters after `MAX_OUTPUT_LENGTH` rose to
  100,000, so output just over the cap shrank to about 7,000 characters.

<!-- Ported from lushly-dev/botcore's unreleased changesets (changes made there after 0.5.0 and imported at `7d5c54ca`): -->

- **core** -- `botcore` imports on Python 3.11 again: `skill_lint.py` used a PEP 695 `type` alias (3.12+ syntax), which made `import botcore.commands` raise `SyntaxError` on 3.11 even though the package declares `requires-python >=3.11`

- **botcore-llm** -- works with github-copilot-sdk 1.0.26 (now the minimum): client connects via `connection=`, sessions use keyword `create_session`/`send_and_wait` and `disconnect()`, tool results use snake_case `ToolResult` fields, and the permission gate reads the SDK's typed requests and returns `PermissionDecision` objects instead of denying every request

- **skill lint** -- SK008 no longer flags repo paths that contain a `references/` segment (e.g. `docs/references/x.md`) or leaks backticks and other markdown delimiters into the reported file name, in both `skill_lint` and `skill-lint` spec checks

- **skills: renamed skill migration** -- projects seeded before 0.4.0 ended up with each renamed skill twice (e.g. `manage-documentation` next to `docs-manager`) after upgrading. `skill_seed` now reads a bundled old-to-new name map: an old-name skill with `source: botcore` is removed and the new name seeded in its place (reported under `migrated`); an old-name skill botcore doesn't own is left untouched, reported under `renamed_locally_owned` with a delete-or-adopt suggestion, and its new name is not seeded alongside it. `skill_status` reports old-name skills with the new `renamed` status.

- **skill_lint** -- report the linted skill directory in `path` when a path is given (it previously always showed the default skills directory), and make `SKILL_NOT_FOUND` name the directory it checked with a suggestion

- **skill** -- `render_frontmatter` now emits valid YAML for triggers and descriptions containing special characters (e.g. `!bash`, `@file`), and `skill_seed`/`skill_adopt` inject `source:` with a minimal line edit instead of rewriting the frontmatter. Fixes `commands-learn` showing as `unmanaged` after a fresh seed and never updating with `skill_seed --update`.

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
