# AGENTS.md

This file provides guidance to AI coding agents working with code in this repository.

> **Documentation Policy**: Skills are the source of truth for detailed knowledge.
> This file is a routing table. See [afd skill](.claude/skills/afd/) for core AFD patterns.
> **First time?** See [SETUP.md](SETUP.md) for installation, tooling, and environment setup.

For development-agent model and effort choices, see
[model routing](docs/operations/model-routing.md). Keep that routing separate
from application LLM selection in `integrate-llms`.

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm -F @lushly-dev/afd-core test` | Test a specific package |
| `pnpm lint` | Biome lint check |
| `pnpm lint:fix` | Auto-fix lint issues |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm check` | TypeScript quality gate (lint + build + typecheck + test:coverage) — mirrors `ci.yml` exactly |
| `pnpm test:hosted:local` | Credential-free HTTPS/OAuth, Convex fixture and durable REST/view-state checks (Node 24, OpenSSL and Chromium) |
| `pnpm test:specimen` | Specimen full Chromium suite and packed-artifact consumers outside the workspace (Node 24, Chromium) |
| `pnpm test:fast-af` | FAST-AF runtime and component Chromium suites and packed-artifact consumers outside the workspace (Node 24, Chromium) |
| `pnpm changeset` | Create a changeset describing your change and its semver impact |
| `pnpm version-packages` | Consume changesets, bump versions, update CHANGELOGs |
| `pnpm release:select` | Inspect eligible pending npm release units |
| `pnpm release:plan --plan <path>` | Pack artifacts from committed release intent; no upload |
| `pnpm publish:npm --plan <path>` | Publish only the approved, bound npm artifact plan |
| `cd packages/server && pnpm vitest run src/server.test.ts` | Run single test file |

## Architecture

AFD (Agent-First Development) — AI agents are first-class users. All functionality exposed as commands before any UI.

```
packages/
├── core/       # @lushly-dev/afd-core — Foundational types (CommandResult, CommandError, CommandDefinition)
├── server/     # @lushly-dev/afd-server — MCP server factory (defineCommand, createMcpServer, createMcpHandler)
├── client/     # @lushly-dev/afd-client — MCP client + DirectClient
├── auth/       # @lushly-dev/afd-auth — Provider-agnostic auth adapter
├── cli/        # @lushly-dev/afd-cli — Command-line tool
├── testing/    # @lushly-dev/afd-testing — JTBD scenario runner + surface validation
├── view-state/ # @lushly-dev/afd-view-state — UI view state management via commands
├── adapters/   # @lushly-dev/afd-adapters — Frontend adapters for rendering CommandResult
├── local-db/   # @lushly-dev/local-db — Async data adapter with swappable backends (Memory, HTTP)
├── rust/       # afd crate — Rust core types and utilities
├── cpp/        # afd-cpp — C++20 implementation (CMake; see packages/cpp/README.md)
└── examples/
    ├── todo/                # Multi-stack example (TS, Python, Rust, C++ backends)
    └── todo-directclient/   # DirectClient + AI integration example

python/  # Python AFD package (pip install afd) — CommandResult, MCP server/client, middleware, validation, telemetry, batch/streaming, testing, handoff
alfred/  # Quality bot — lint, parity, quality (see alfred/AGENTS.md)
endpoints/botcore/  # Reusable Python tooling and managed host; imported units remain quarantined
foundations/specimen/       # @lushly-dev/specimen — native component observation bench (no AFD dependency); quarantined
integrations/specimen-afd/  # @lushly-dev/specimen-afd — AFD command bindings for Specimen; quarantined
endpoints/specimen-cli/     # @lushly-dev/specimen-cli — the `specimen` JSON CLI; quarantined
foundations/fast-af/        # FAST-AF, upstream layout and provenance; quarantined, no AFD/Specimen/Violet dependency
├── packages/element/packages/fast-element/  # @lushly-dev/fast-element — web component runtime (38 exports)
└── packages/violet-elements/                # @lushly-dev/violet-elements — FAST-AF components (private upstream)
```

## Key Conventions

- **Command naming**: `domain-action` kebab-case — `todo-create`, `user-get`, `order-list`
- **CommandResult**: Always return `success(data, { reasoning, confidence })` or `failure({ code, message, suggestion })`
- **Errors**: Always include `suggestion` for recovery guidance
- **Testing**: Vitest with explicit imports, tests in `src/**/*.test.ts`
- **Imports**: Use `import type` for type-only, `node:` prefix for Node.js builtins
- **Lint**: Biome — tab indent, single quotes, no `any`, no unused imports
- **Command Prerequisites**: Declare with `requires: ['command-name']` on `defineCommand()` — metadata only, not enforced at runtime. Exposed via MCP `_meta.requires` (and `afd-help` when the server sets `bootstrap: true`)

## Quality Gates & CI

**Principle: for TypeScript, lefthook IS the CI pipeline.** `pnpm check` runs the exact same steps as the `CI` workflow (`ci.yml`). If it passes locally, that workflow passes remotely.

Lefthook and `pnpm check` do **not** cover Python (`python/`), Rust (`packages/rust/`), C++ (`packages/cpp/`), alfred, Specimen's Chromium suite (`pnpm check` runs only its browser-free subset) or FAST-AF's browser suites (`pnpm check` builds both packages and runs only fast-element's browser-free test). Each has its own path-filtered workflow, listed below. The TypeScript, Python, Rust and C++ todo example backends all run the shared conformance suite in `conformance.yml`.

| Layer | When | What |
|-------|------|------|
| **Pre-commit** (lefthook) | `git commit` | Biome lint+fix, portability, file-size, typecheck |
| **Pre-push** (lefthook) | `git push` | Full lint, test, typecheck, portability, file-size, orphan-files, versions, tooling-tests |
| **Quality gate** (`pnpm check`) | On-demand / release script | lint → build → typecheck → test:coverage + portability, file-size, orphan-files, versions, tooling-tests |
| **CI** (`ci.yml`) | Push to main / PR | Same as quality gate — safety net for skipped hooks |
| **Python** (`python.yml`) | Push to main / PR touching `python/**`, `spec/wire`, `spec/vectors` or `spec/VERSION` | `uv lock --check`; ruff (F821, F841, B904); pytest on 3.10, 3.11, 3.12; wheel install smoke test per extra (base, client, server, cli) |
| **Rust** (`rust.yml`) | Push to main / PR touching `packages/rust/**`, `spec/wire`, `spec/vectors` or `spec/VERSION` | `cargo fmt --check`; clippy `-D warnings` and `cargo test`, each with default and no default features |
| **C++** (`cpp.yml`) | Push to main / PR touching `packages/cpp/**`, `spec/wire`, `spec/vectors`, the todo spec or the C++ todo backend | clang-format (pinned); GCC; Clang with ASan+UBSan and with TSan; no-exceptions/no-RTTI unity build with the macro-hygiene check; macOS; MSVC; Emscripten with tests under Node; 60 s libFuzzer run per fuzz target |
| **Conformance** (`conformance.yml`) | Push to main / PR touching the todo example, `packages/server`, `packages/core`, `packages/rust`, `packages/cpp`, `python/` or the lockfile | Todo example: Python backend pytest, Rust backend fmt/clippy/test, C++ backend build/test, then the 34-case conformance suite against the TypeScript, Python, Rust and C++ backends |
| **Alfred** (`alfred.yml`) | Push to main / PR touching Alfred, Botcore, its controller inputs or AFD language surfaces | ruff, pytest (including parity budgets and managed-host/controller fixtures), isolated wheel smoke |
| **Botcore** (`botcore.yml`) | Push to main / PR touching `endpoints/botcore/**` or `python/**` | Python 3.11/3.12 core tests, Ruff, frozen lock, six-distribution asset/provenance/wheel checks; optional stateful integrations remain quarantined |
| **FAST-AF** (`fast-af.yml`) | Push to main / PR touching `foundations/fast-af`, `tests/consumers/fast-af`, the lockfile or workspace | Node 24; fast-element build-cleanliness, migration rules and upstream `test:ci` on Chromium, Firefox and WebKit; violet-elements regenerated theme/icons/CEM, lint, Chromium suite with coverage thresholds; packed-artifact consumers (every runtime export, components, missing peer, Chromium render) |
| **Specimen** (`specimen.yml`) | Push to main / PR touching the three Specimen units, `tests/consumers/specimen`, `packages/core`, `packages/server` or the lockfile | Node 24, Chromium; full native suite (`test:browser`), integration/CLI suites, packed-artifact consumers (native-only, integration present/absent/unavailable, missing/incompatible peers) |
| **Local hosted-test fixtures** (`hosted-fixtures.yml`) | Path-filtered auth/persistence/runtime/tooling changes; manual dispatch | Node 24, Chromium, `pnpm test:hosted:local`; no external services or credentials; not hosted-provider evidence |
| **Release** (GitHub Actions) | Push to main | `pnpm check` → Changesets opens a version PR or publishes to npm |

**Key rules:**
- Always run `pnpm check` before pushing — catches everything `ci.yml` would catch
- The pre-push `test` step does not install or build, and packages import each other's `dist`: after pulling `main` run `pnpm install`, and after changing a package another one imports run `pnpm build` (or `pnpm check`), before `git push`, or the hook fails on stale output
- Changed FAST-AF? `pnpm check` builds it and runs only fast-element's browser-free test; also run `pnpm test:fast-af` (Chromium required). Edits to imported files, including API reports the build rewrites, must update `foundations/fast-af/provenance/adaptations.json`, or the tooling tests fail. Do not run upstream `check:v3` scopes or sync upstream.
- Changed a Specimen unit? `pnpm check` runs only its browser-free tests; also run `pnpm test:specimen` (Chromium required). Edits to imported Specimen files must update `foundations/specimen/provenance/adaptations.json`, or the tooling tests fail.
- Changed `python/`, `packages/rust/` or `packages/cpp/`? `pnpm check` does not test them. Run the commands from `python.yml`, `rust.yml` or `cpp.yml` locally (`cd python && uv run pytest -q`; `cd packages/rust && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`; `cd packages/cpp && cmake --preset dev && cmake --build --preset dev && ctest --preset dev`)
- Workflow actions are pinned to full commit SHAs with a `# vX.Y.Z` comment; Dependabot updates them
- Changesets manages versioning — run `pnpm changeset` to describe publishable package changes
- The nine existing AFD npm packages form the explicit `afd-npm` fixed group. Other families retain independent versions; registry scope does not define release membership.
- `scripts/release/inventory.json` owns publication admission, routes, identities, and release protocols. Unknown/imported units default to quarantine; source import does not authorize publication.
- npm version PRs record `.release/npm-intent.json`; guarded artifact planning/publication validates that intent. Never run raw `changeset publish` on the complete workspace.
- Shared skills are authored in Botcore's bundled source; `skills/exports.json` declares AFD projections and local overrides. Run `pnpm check:skills` or `pnpm skills:sync`; do not hand-edit generated projections. `.codex/skills` remains the mirror symlink.
- Bootstrap Alfred with `cd alfred && uv sync --frozen --all-extras --dev`; local uv sources select AFD/Botcore without publishing them. From the repository root, use `uv run --project alfred alfred --workspace . catalog` and select a target/profile explicitly for operations.
- Release flow: merge a PR with changesets → the Release workflow opens a release PR → merge it → the workflow runs `pnpm check` and publishes
- Agent release flow: `pnpm changeset` → commit the changeset file → merge through the normal PR workflow

## Skill Index

| Skill | When to Use |
|-------|-------------|
| [afd](.claude/skills/afd/) | Core AFD patterns, command design, workflow |
| [afd-developer](.claude/skills/afd-developer/) | AFD philosophy, honesty check, define-validate-surface |
| [afd-site-design](.claude/skills/afd-site-design/) | afd.dev design system: tokens, colour fields, type ramp, section patterns, motion rules |
| [afd-python](.claude/skills/afd-python/) | Python implementation with Pydantic, FastMCP |
| [afd-typescript](.claude/skills/afd-typescript/) | TypeScript patterns, Zod schemas, defineCommand, createMcpServer, createMcpHandler |
| [afd-rust](.claude/skills/afd-rust/) | Rust implementation patterns |
| [afd-cpp](.claude/skills/afd-cpp/) | C++ implementation patterns (afd-cpp), embedding constraints, host integrations |
| [afd-auth](.claude/skills/afd-auth/) | Auth adapter, middleware, commands, session sync, React hooks |
| [afd-directclient](.claude/skills/afd-directclient/) | DirectClient, pipe() pipelines, pipeline variable resolution |
| [afd-contracts](.claude/skills/afd-contracts/) | TypeSpec-based contract system for multi-layer API schema sync |
| [optimistic-mutations](.claude/skills/optimistic-mutations/) | Optimistic mutation patterns for interactive AFD clients |
| [do-release](.claude/skills/do-release/) | Release workflow: version bump, changelog, quality gate, tag, publish |
| [run-dev-checks](.claude/skills/run-dev-checks/) | Dev commands, quality gates, lefthook, CI alignment |
| [do-init-afd](.claude/skills/do-init-afd/) | Session start: preflight, refresh base, adopt task, report state |
| [do-prepare-pr](.claude/skills/do-prepare-pr/) | Ship: base sync, independent review, docs/changeset, gates, PR, authorized merge |
| [do-end-session](.claude/skills/do-end-session/) | Session close: verify landing, file findings, capture knowledge, archive report |
