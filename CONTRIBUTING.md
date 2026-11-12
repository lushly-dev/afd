# Contributing to AFD

AFD (Agent-First Development) is a methodology where AI agents are first-class users. Everything in this repo follows **Command-First** design: all functionality is exposed as commands with schemas before any UI is built. If you're contributing, you're building for agents — not just humans.

This repository holds more than the AFD libraries. Specimen, FAST-AF, Violet, Umbel, Loam, Botcore and Health live here too ([what each one is](README.md#the-rest-of-the-repository)). The principles below apply to all of them; the tools and test commands differ by area, and [Where things live](#where-things-live) says which go with which.

## Prerequisites

- **Node.js** >= 22.12.0 (development and CI use Node 26 LTS, pinned in `.nvmrc`)
- **pnpm** 10.30.1 (pinned in `package.json`)
- **Lefthook** (auto-installed via `pnpm install`)

Python, uv, Rust, CMake and Chromium are needed only for the areas that use them. [SETUP.md](SETUP.md) lists versions and what each is for.

## Getting Started

```bash
git clone https://github.com/lushly-dev/afd.git
cd afd
pnpm install   # Installs deps + Lefthook git hooks
pnpm build     # Build all packages
pnpm test      # Run all tests
```

For the Python package:

```bash
cd python
uv sync --frozen --all-extras
uv run pytest -q
```

For Alfred (quality bot):

```bash
cd alfred
uv sync --frozen --all-extras --dev
uv run alfred --workspace .. lint        # Architecture compliance
uv run alfred --workspace .. parity      # Cross-language API sync
uv run alfred --workspace .. quality     # Command description quality
```

## Core Principles

Every contribution should follow these patterns:

### 1. Commands Return `CommandResult`

All handlers — TypeScript, Python, Rust, and C++ — must return `CommandResult`:

```typescript
return success(data, { confidence: 0.95, reasoning: 'Cache hit' });
return failure({ code: 'NOT_FOUND', message: '...', suggestion: 'Try...' });
```

### 2. Errors Include `suggestion`

Every error must include a `suggestion` field so agents can self-recover. Alfred's `afd-actionable-errors` lint rule enforces this.

### 3. Commands Use `domain-action` Naming

Commands are kebab-case in `domain-action` format: `todo-create`, `user-get`, `order-list`. Alfred's `afd-kebab-naming` rule enforces this in TypeScript.

### 4. Jobs Before Commands

A feature that adds or changes commands starts from the jobs it serves. Write each job as a `*.scenario.yaml` before specifying the commands; a job you can't write with the commands you drafted is a gap in the design. See [jobs first](.claude/skills/afd/references/jobs-first.md).

### 5. No Business Logic in UI

Data transforms (`.map().filter()`, `.reduce()`, `Math.*`) belong in command handlers, not UI components. Alfred's `afd-no-business-in-ui` rule catches violations.

## How to Add a Command

The most common contribution is adding or modifying commands. Use `defineCommand()` with a Zod schema:

```typescript
import { defineCommand, success } from '@lushly-dev/afd-server';
import { z } from 'zod';

const myCommand = defineCommand({
  name: 'domain-action',
  description: 'Imperative verb description (10-120 chars)',
  input: z.object({ /* ... */ }),
  mutation: false,  // true for state-changing commands
  async handler(input, context) {
    return success(result, { reasoning: 'why this result' });
  },
});
```

After adding commands, run `alfred quality` to validate description quality (imperative voice, length, no near-duplicates).

## Multi-Language Parity

AFD ships implementations in TypeScript, Python, Rust, and C++. TypeScript is the source of truth for the API surface. When adding exports to `packages/core/src/index.ts`, mirror them in:

- **Python**: `python/src/afd/__init__.py` (`__all__` list)
- **Rust**: `packages/rust/src/lib.rs` (`pub use` re-exports)
- **C++**: `packages/cpp/include/afd/` (declarations in `namespace afd`, reached from `afd/afd.hpp`; C++ uses TypeScript's names in snake_case)

Run `alfred parity` to detect drift. The tool normalizes naming conventions (camelCase ↔ snake_case) across languages.

## Quality Gates

### Lefthook Git Hooks

Lefthook runs automatically on commit and push — no manual setup needed.

**Pre-commit** (every commit):
- Biome lint + auto-fix on staged `.ts`/`.js`/`.json` files
- Portability check (no machine-specific paths)
- File size check on staged `.ts` files (warn >500 lines, error >1000; markdown is not size-checked)
- TypeScript type checking

**Pre-push** (before push):
- Full lint, plus tests and typecheck for the packages your change affects
- Portability + file size on all files
- Orphan file detection (`.ts` files not imported anywhere)
- Versions, package boundaries, skills and the tooling tests

**Commit messages** are validated by commitlint (Conventional Commits).

### On-Demand Check

Run the quality gate manually:

```bash
pnpm check    # Lint, build, typecheck and tests with coverage for the packages your change affects
pnpm verify   # pnpm check, then every area suite your change would trigger in CI
```

`pnpm check` is the same gate CI runs for TypeScript. It doesn't run a browser, and it doesn't cover Python, Rust or C++; those areas have suites of their own, which `pnpm verify` runs for you when your change reaches them. Pass `pnpm verify` before you push, so CI confirms a green result instead of finding failures one push at a time.

### Alfred Quality Bot

Alfred provides deterministic architecture compliance — agents and humans skip expensive manual review:

| Command | What it checks |
|---------|----------------|
| `alfred lint` | 6 AFD architecture rules (CommandResult, actionable errors, kebab naming, no-fetch-in-UI, no-business-in-UI, layer imports) |
| `alfred parity` | API surface sync across TypeScript, Python, Rust, and C++ |
| `alfred quality` | Command description quality (length, imperative voice, duplicates) |

## Development Workflow

### Building

```bash
pnpm build                          # All packages
pnpm -F @lushly-dev/afd-core build  # Specific package
```

### Testing

```bash
pnpm test                                          # All tests
pnpm -F @lushly-dev/afd-core test                  # Specific package
cd packages/server && pnpm vitest run src/server.test.ts  # Single file
pnpm -F @lushly-dev/afd-server test:watch          # Watch mode
```

Tests use Vitest with explicit imports (`describe`, `it`, `expect` from `'vitest'`). Place tests in `src/**/*.test.ts`.

### Linting & Formatting

[Biome](https://biomejs.dev/) handles both linting and formatting:

```bash
pnpm lint       # Check
pnpm lint:fix   # Auto-fix
pnpm format     # Format
pnpm typecheck  # Type check
```

## Code Style

Enforced by Biome — most issues auto-fix on save or commit:

- **Indentation**: Tabs
- **Quotes**: Single quotes
- **Trailing commas**: ES5 style
- **Line width**: 100 characters
- **Imports**: `import type { ... }` for type-only imports (`useImportType: "error"`)
- **Node builtins**: `node:` prefix required (`useNodejsImportProtocol: "error"`)
- **No `any`**: `noExplicitAny: "error"` — use proper types
- **No unused**: `noUnusedImports` and `noUnusedVariables` are errors

## Commit Messages

Enforced by commitlint. Use [Conventional Commits](https://www.conventionalcommits.org/) with scoped types:

```
feat(core): add pipeline timeout support
fix(server): handle empty input validation
docs(python): update command naming guide
chore(deps): update dependencies
```

**Allowed scopes**: `core`, `server`, `client`, `auth`, `cli`, `testing`, `adapters`, `view-state`, `examples`, `alfred`, `botcore`, `specimen`, `violet`, `fast-af`, `health`, `python`, `rust`, `cpp`, `site`, `deps`. The scope is optional; leave it out for an area with no scope of its own, such as Umbel or Loam.

## Submitting Changes

1. Fork the repository and create a branch from `main`
2. Make changes following the principles above
3. Verify locally:
   - `pnpm verify` — the quality gate and every area suite your change triggers
   - `alfred lint` — no architecture violations (if adding commands)
4. If you changed a published package, run `pnpm changeset` and commit the file it creates ([recording a change](CHANGELOG.md#recording-a-change))
5. Push and open a pull request

### PR Guidelines

- Keep PRs focused on a single concern
- Include tests for new functionality
- Update documentation if behavior changes — see `AGENTS.md` for the routing table and `.claude/skills/` for deep topic guides
- All Lefthook hooks must pass

## Where Things Live

The repository is laid out by what a thing is for. Foundations stand on their own, integrations bind a foundation to AFD commands, and endpoints are what you install and run.

```
packages/       # AFD in TypeScript (core, server, client, auth, cli, testing, view-state,
                # adapters, local-db), plus rust/ (the afd crate), cpp/ (afd-cpp) and examples/
python/         # AFD in Python (pip install afd)
spec/           # The contract every language implements, with its test vectors
foundations/    # Specimen, FAST-AF and Violet: no AFD dependency
integrations/   # specimen-afd, specimen-fast-af, violet-afd: a foundation as AFD commands
endpoints/      # specimen-cli, violet-cli, violet-server, botcore, health, health-dashboard,
                # umbel (Rust plugin host), loam (application shell)
alfred/         # Quality bot (lint, parity, quality)
site/           # afd.dev
docs/           # Feature proposals and status, operations notes, the whitepaper
```

| Area | Read first | Beyond `pnpm check` |
|------|-----------|---------------------|
| AFD packages (`packages/`) | This file | Usually nothing; `pnpm verify` adds the conformance suite when a change reaches it |
| Python, Rust, C++ | Each package's README | Its own test command ([SETUP.md](SETUP.md#working-on-one-area)) |
| Specimen | [README](foundations/specimen/README.md) | `pnpm test:specimen` |
| FAST-AF | [README](foundations/fast-af/README.md) | `pnpm test:fast-af`, `pnpm test:stories` |
| Violet | [README](foundations/violet/README.md) | `pnpm test:violet` and each package's `lint` |
| Umbel | [STATUS.md](endpoints/umbel/docs/STATUS.md), then its [README](endpoints/umbel/README.md) | Its Cargo checks |
| Loam | [STATUS.md](endpoints/loam/docs/STATUS.md), then its [packages README](endpoints/loam/packages/README.md) | Its browser, walk and hosted suites |
| Botcore, Health | Their READMEs | Their `uv` test commands |

Three things to know about the projects that were brought in from other repositories:

- **Imported files are tracked.** FAST-AF, Violet and Specimen each keep a `provenance/` folder that records every file's hash and every change made here, with its reason. If you edit an imported file, add the change to that family's `provenance/adaptations.json`, or the tooling tests fail.
- **Being here is not being published.** A package publishes only once [`scripts/release/inventory.json`](scripts/release/inventory.json) admits it. Don't add a publish step for one that is held back.
- **Status files are the source of truth.** Umbel, Loam and each active feature keep a `STATUS.md` that says exactly what is done. Read it before you start, and update it when your change moves it.

## Further Reading

- [README.md](README.md) — What AFD is, a quickstart, and the rest of the family
- [SETUP.md](SETUP.md) — Tools and versions, by area
- [AGENTS.md](AGENTS.md) — Commands, CI workflows and the skill routing table, written for coding agents and just as useful to people
- [alfred/AGENTS.md](alfred/AGENTS.md) — Alfred command reference and lint rules
- [`.claude/skills/`](.claude/skills) — Deep topic skills for AFD patterns, each language, auth, DirectClient, releases and design
- [docs/](docs/README.md) — Feature proposals and their status, and operations notes

## Questions?

Open an issue on [GitHub](https://github.com/lushly-dev/afd/issues) for questions or discussion.
