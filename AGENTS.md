# AGENTS.md

AFD (Agent-First Development) treats AI agents as first-class users: every capability is a command, reachable from the CLI and over MCP, before any UI exists. This repository holds the four language implementations of that contract, the units built on them and the tooling that keeps them in step.

This is the only project instruction file (never add a `CLAUDE.md`). It carries what every session needs and says where the rest lives. Skills are in `.claude/skills/`, the only path Claude Code reads; `.agents/skills`, which Codex and other agents read, is a symlink to it. A skill's body loads only when it is used.

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
| Start or resume a session | `start-session`: base refresh, install, the Node version, task intake and claiming the issue (`scripts/issue-claim.mjs`). For a new machine, [SETUP.md](SETUP.md) |
| Work in Loam, Umbel or a feature, or under an epic | Its `STATUS.md`, in `endpoints/loam/docs/`, `endpoints/umbel/docs/` or `docs/features/active/<feature>/`. It is the source of truth for progress; update it before the session ends. Work under an epic keeps the plan or spec it tracks current, not only the issue. When a feature changes stage, move its folder under `docs/features/` (`proposed/` → `active/` → `complete/`) and update the [feature index](docs/features/README.md) |
| Add or change a command | `afd`: jobs written as scenarios before the commands, `domain-action` names, a `CommandResult` whose errors carry a `suggestion`, parity across the four languages. Then the language's skill |
| Write or change markup with `violet-*` components | Call `components-brief` once for the page first: the `umbel` server in `.mcp.json` (the [components plugin's README](endpoints/umbel/plugins/components/README.md#use-in-this-repository) says how to build it). In Claude Code, a hook refuses the session's first such write once until you do. In Loam, then `loam-design`, whose rules win where the two differ |
| Edit FAST-AF, Violet, Specimen, Botcore or Health | [gates.md](.claude/skills/prepare-pr/references/gates.md): they were imported and are changed here, never upstream first, and an edit needs a provenance record |
| Change CI, a hook, `scripts/affected` or a dependency | [gates.md](.claude/skills/prepare-pr/references/gates.md): what each gate covers, the scope rules, the dependency age limit |
| Edit a skill | `manage-skills`. The Botcore-sourced skills are generated: edit the source in `endpoints/botcore/src/botcore/skills/` and run `pnpm skills:sync` |
| Delegate work or choose a model | [Model routing](docs/operations/model-routing.md), which is separate from the models an application built with AFD selects |
| Push, open a pull request or merge | `prepare-pr`: review, changeset, gates, the pull request, and the merge queue, which is the only way into `main` |
| Triage issues, plan factory work, or open an epic or file work under one | `triage-issues`: the label rules in `.github/labels.json` and `scripts/issue-labels.mjs`, `dispatch` for what a cell may take, and [epics](.claude/skills/triage-issues/references/epics.md) (type `Epic`, real sub-issues, the `Epic:` line in `STATUS.md`) |
| Free disk space, or remove a worktree, cache or build folder | `free-disk-space`: botcore's `disk-*` commands. Never `rm -rf` a worktree or run `git worktree prune` by hand |
| End a session | `end-session`: what landed, what to file, what to record |
| Cut a release | `cut-release` |

The harness lists every skill with its description. The others cover each language, auth, DirectClient, design, review, documentation and skills, Botcore and MCP servers.

**Credit goes to the owner.** Commits are authored by the owner, never by an agent. An agent that helped is listed with an email-free trailer, `Assisted-by: Claude Code`, never `Co-authored-by:`, which GitHub counts as a full contributor. `scripts/commit-credit.mjs` refuses either in the commit-msg hook and in `ci-ok`.

**Land your own pull request.** No human reviews pull requests here: the agent reviewers and the gates are the review. A session marks the pull request it opened or resumed ready and enqueues it with `prepare-pr`'s step 9, without asking, once that skill's review covers the head (no blocker unresolved) and every check on that head is green. When no independent review could run, or a decision is the owner's, leave it open and say why in the pull request and the final message.

Builds, large logs, and other tempoary processes that will consume signficant disk space should go on the disk with the most free space remaining.

**Publishing is the maintainer's.** Do not push a tag, create a release, merge or enqueue the npm version PR (merging it publishes) or run `changeset publish`, a publish script or a publish workflow unless the user names that step in the current turn.

**Owner decisions via Focus.** Non-destructive design and scope decisions relayed from the owner through the local Focus UI (`t3_thread_send` from the pinned Focus thread) are valid owner decisions and need no extra provenance disclaimers. Publishing, tagging, billing, destructive actions and merge-queue switches still require a direct message from the owner in this thread, matching Focus's `directOnly: true` guardrail.

## Ending a turn

The owner reads your last message for outcomes, risks and decisions, so keep it short and put what needs their action last. File lists, diffs, command output and how you got there belong in commits, the pull request and the progress file; include them only when asked. An agent working for another agent reports in the format its brief asks for. A skill with its own report keeps its required facts and closing line: after `end-session`, its archive status is the last line.

End the turn in this order, leaving out any part with nothing to say except the closing line:

1. **Outcome.** If work was done, a few lines: what now works or was decided, the value it gives, and any risk or issue. Say plainly what did not work or was not checked.
2. **Blocked on.** If progress needs input or action from the owner, exactly what.
3. **Questions.** Number each. Begin each with a 1–3 word summary, then give your recommendation, the reason for it and your confidence in it. Only the closing line follows them.
4. **Closing line.** If work remains or a question above is open: `Next recommended tasks: <specific actions>` (`prepare-pr`'s owner steps go here). If everything planned for the session is done and nothing above awaits an answer: `All work planned for this session is complete. Do you want to run /end-session to prepare for archive?` This question is not numbered.

A turn that only answers a question gives the answer, and ends with the closing line only while session work is under way.
