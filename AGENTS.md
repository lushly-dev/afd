# AGENTS.md

AFD (Agent-First Development) treats AI agents as first-class users: every capability is a command, reachable from the CLI and over MCP, before any UI exists. This repository holds the four language implementations of that contract, the units built on them and the tooling that keeps them in step.

This is the only project instruction file (never add a `CLAUDE.md`). It carries what every session needs and says where the rest lives. Skills are in `.claude/skills/` (`.codex/skills` is a symlink to it), and a skill's body loads only when it is used.

## Layout

`packages/`, `python/` and `spec/` are AFD itself: the TypeScript, Rust, C++ and Python implementations and the contract they share. `foundations/` holds libraries that depend on nothing in AFD (Specimen, FAST-AF, Violet), `integrations/` binds them to AFD and to each other, and `endpoints/` holds what people and agents run: CLIs and servers, Botcore, Health, Umbel and Loam. `pnpm check:boundaries` enforces that direction from `architecture.json`. `alfred/` (the quality bot) and `endpoints/botcore/` have their own `AGENTS.md`.

## Confirming work

| Command | Purpose |
|---------|---------|
| `pnpm -F @lushly-dev/afd-core test` | Test one package |
| `cd packages/server && pnpm vitest run src/server.test.ts` | Run one test file |
| `pnpm lint:fix` | Apply Biome's style and list what it cannot fix |
| `pnpm check` | The TypeScript gate `ci.yml` runs, over the packages the change affects |
| `pnpm verify` | `pnpm check`, then the local suite of every other workflow the change triggers |

Run `pnpm verify` before pushing, on the `.nvmrc` Node, so that remote CI confirms a green result instead of finding failures one push at a time. `pnpm verify --list --files <paths>` prints the plan and runs nothing; read it before choosing what to touch, because a documentation edit inside a unit can trigger its heaviest suites. Report a gate that did not run as not run.

## Read first

| Before you | Read |
|------------|------|
| Start or resume a session | `start-session`: base refresh, install, the Node version, task intake. For a new machine, [SETUP.md](SETUP.md) |
| Work in Loam, Umbel or an active feature | Its `STATUS.md`, in `endpoints/loam/docs/`, `endpoints/umbel/docs/` or `docs/features/active/<feature>/`. It is the source of truth for progress; update it before the session ends |
| Add or change a command | `afd`: jobs written as scenarios before the commands, `domain-action` names, a `CommandResult` whose errors carry a `suggestion`, parity across the four languages. Then the language's skill |
| Write or change markup with `violet-*` components | Call `components-brief` once for the page first: the `umbel` server in `.mcp.json` (the [components plugin's README](endpoints/umbel/plugins/components/README.md#use-in-this-repository) says how to build it). In Loam, then `loam-design`, whose rules win where the two differ |
| Edit FAST-AF, Violet, Specimen, Botcore or Health | [gates.md](.claude/skills/prepare-pr/references/gates.md): they were imported and are changed here, never upstream first, and an edit needs a provenance record |
| Change CI, a hook, `scripts/affected` or a dependency | [gates.md](.claude/skills/prepare-pr/references/gates.md): what each gate covers, the scope rules, the dependency age limit |
| Edit a skill | `manage-skills`. The Botcore-sourced skills are generated: edit the source in `endpoints/botcore/src/botcore/skills/` and run `pnpm skills:sync` |
| Delegate work or choose a model | [Model routing](docs/operations/model-routing.md), which is separate from the models an application built with AFD selects |
| Push, open a pull request or merge | `prepare-pr`: review, changeset, gates, the pull request, and lockfile changes merged one at a time |
| End a session | `end-session`: what landed, what to file, what to record |
| Cut a release | `cut-release` |

The harness lists every skill with its description. The others cover each language, auth, DirectClient, design, review, documentation and skills, Botcore and MCP servers.

**Publishing is the maintainer's.** Do not push a tag, create a release, merge the npm version PR (merging it publishes) or run `changeset publish`, a publish script or a publish workflow unless the user names that step in the current turn.
