# To-do reference example: status

Read this before the [proposal](todo-reference.proposal.md). It records exactly what is done and
what is not, so an agent never has to scan the code to learn what is current. It follows the shape
of the [Umbel status](../../../../endpoints/umbel/docs/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Work on a branch is "in progress", with
  what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them; link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.

## Status block

- **State:** active. The owner asked on 2026-11-14 to save the proposal and start the work, and
  decided D1 to D3 the same day (the proposal's [decisions](todo-reference.proposal.md#decisions)):
  React stays beside the FAST-AF frontend, both on `violet-elements`.
- **Last verified:** 2026-11-15 on branch `t3/refresh-todo-afd-examples`, based on `main` at
  `57397cdb`, with Node 26.13.0: the full `pnpm verify` passed.
- **Done:** phase 1, merged in [#1231](https://github.com/lushly-dev/afd/pull/1231) on 2026-11-15 (`176c7471`). The parts it left open belong to
  later phases, as the findings table says.
- **In progress:** phase 2. The jobs are written and walked, and the owner decided D6 to D10.
  The first slice (jobs 1, 3, 4 and 9) and jobs 2, 5 and 8 merged in [#1251](https://github.com/lushly-dev/afd/pull/1251) on 2026-11-15, in the
  TypeScript backend; job 7, the rest of the commands' metadata, local-db and CI remain. See
  [Phase 2](#phase-2-the-typescript-reference).
- **Not started:** phases 3 to 5.

## Plan

| Phase | State | Evidence | Next gate |
| --- | --- | --- | --- |
| 1. Fix what is wrong | Done: W1, W2 (TypeScript, Python), W3, W4 (declared), W6 and the backend half of W5 and W7, merged in [#1231](https://github.com/lushly-dev/afd/pull/1231) | See [phase 1](#phase-1-fix-what-is-wrong) | None |
| 2. The TypeScript reference | In progress: jobs 1 to 5, 8 and 9 merged in [#1251](https://github.com/lushly-dev/afd/pull/1251); 7 in [#1256](https://github.com/lushly-dev/afd/pull/1256); 6 waits for phases 3 and 4 | See [phase 2](#phase-2-the-typescript-reference) | The rest of phase 2: local-db (D4) |
| 3. The Violet frontend | Not started | None | Phase 2's commands; the `umbel` server built so `components-brief` answers |
| 4. DirectClient | Not started | None | Phases 2 and 3 |
| 5. The other languages | Not started | None | Phase 2's conformance cases; C++ also [#341](https://github.com/lushly-dev/afd/issues/341) |

## Findings

| Finding | State |
| --- | --- |
| W1 `total` capped at 100 in TypeScript | Fixed in [#1231](https://github.com/lushly-dev/afd/pull/1231) |
| W2 contexts declared but not served | TypeScript and Python fixed in [#1231](https://github.com/lushly-dev/afd/pull/1231). C++ declares them but serves no context tools (its own stdio loop, phase 5). Rust declares none (phase 5) |
| W3 deletes not marked destructive | Fixed in [#1231](https://github.com/lushly-dev/afd/pull/1231) in TypeScript, Python and Rust (C++ already was), and in the Umbel `todo` plugin's compiled manifest. Under `umbel-mounted` the deletes still advertise `destructiveHint: false`, because a mounted tool cannot declare `destructive` (see follow-ups) |
| W4 no confirmation gate in C++ | Prompt declared in [#1231](https://github.com/lushly-dev/afd/pull/1231); enforcement open, phase 5 with `afd::mcp_stdio` |
| W5 deprecated `/message` and `/sse` | Backend text fixed in [#1231](https://github.com/lushly-dev/afd/pull/1231); the frontends still use `/message` until phase 3 replaces them |
| W6 README errors | Fixed in [#1231](https://github.com/lushly-dev/afd/pull/1231) |
| W7 small defects | `todo-clear`'s debug logging removed in [#1231](https://github.com/lushly-dev/afd/pull/1231). The React `FETCH_ERROR`, vanilla `innerHTML` (phase 3) and todo-directclient text (phase 4) are open |
| W8 todo-directclient's copied commands and hand-written tools | Open, phase 4 |
| W9 cross-backend drift outside the suite | Destructive flags and contexts now checked by every backend's tests against `spec/commands.schema.json` (Rust without contexts). Alternatives, ordering ties, ID formats and tool lists open, phase 5 |

## Phase 1: fix what is wrong

Written on branch `t3/refresh-todo-afd-examples` on 2026-11-14 and merged in
[#1231](https://github.com/lushly-dev/afd/pull/1231) on 2026-11-15:

- **W1.** The TypeScript stores return every match when no `limit` is given
  (`backends/typescript/src/store/memory.ts`, `file.ts`), so `todo-list` counts past 100. New
  conformance case `list_total_past_one_page` (120 todos, `limit: 10`, `total: 120`) in
  `spec/test-cases.json`, now 35 cases. Against the unfixed store it failed with "Expected
  data.total to be 120, got 100".
- **W2.** `todo-reading` (list, get, stats) and `todo-editing` (every command) are defined once
  per language (`backends/typescript/src/contexts.ts`, `backends/python/src/todo_backend/contexts.py`)
  and passed to both servers; every command declares its contexts, and C++ derives them from
  `mutation`. `backends/typescript/src/contexts.test.ts` shows that reading hides the writes and
  refuses `todo-create` with `COMMAND_NOT_IN_CONTEXT`; `server-options.test.ts` checks the same
  through the server's own options on `/mcp`, and fails if the `contexts` option is removed; the
  Python test checks the context tools are registered.
- **W3.** `destructive` on `todo-delete` and `todo-delete-batch` in TypeScript, Python and Rust
  (Rust gains a `DESTRUCTIVE` constant on its `Command` trait instead of deriving it from the
  confirmation prompt). The Umbel plugin's `umbel-plugin.toml` marks both, and
  `plugins/todo/tests/todo.rs` now compares `destructive` for every command.
- **W4.** `confirm_prompt` on the C++ `todo-clear`. `spec/README.md` says why it is not enforced.
- **Shared metadata.** Each command in `spec/commands.schema.json` now carries `metadata`
  (`mutation`, `destructive`, `contexts`, `confirmPrompt`), and the TypeScript, Python, Rust and C++
  tests compare their definitions with it. Rust had no check of the command list before; it now
  checks the list and the metadata except `contexts`.
- **W5, W6, W7 (backend).** `server.ts` prints and documents `afd connect …/mcp` and how `TRANSPORT=auto`
  chooses; the backend README says the same. The example README names `afd-batch`, counts four
  backends, adds the C++ entry to the VS Code configuration and transport table, documents the
  contexts and destructive commands, replaces the streaming section that promised progress chunks
  and import paths that do not exist, and links this status file. `todo-clear` no longer logs from
  its handler. `docs/language-parity.md` counts 35 cases.

Verified locally on 2026-11-14:

- TypeScript: `vitest run`, 10 files and 120 tests; `pnpm typecheck`; conformance 35/35 in
  legacy and modern modes, and confirmations 5/5.
- Python: `uv run pytest`, 28 tests; conformance 35/35 in both modes, and confirmations 5/5.
- Rust: `cargo fmt --check`, `cargo clippy --all-targets -D warnings`, `cargo test`, 42 tests;
  conformance 35/35 in both modes, and confirmations 5/5 in modern mode.
- C++: Debug build with `AFD_WARNINGS_AS_ERRORS=ON`, `ctest`; clang-format 22.1.8 clean;
  conformance 35/35 in both modes.
- Umbel: `cargo test -p umbel-plugin-todo`; conformance 35/35 for `umbel` (both modes) and
  `umbel-mounted` (both modes), confirmations 5/5 in modern mode; `external-clients.sh` (4
  scenarios passed).
- `afd-testing`: `src/runner/todo-example.test.ts`, 4 tests.
- Biome over the example and this folder.

Verified on 2026-11-15, after merging `main` at `57397cdb`: `pnpm verify --keep-going` on Node
26.13.0 passed every step it planned (`pnpm check`, Loam, alfred, Umbel, `packages/cpp` and the
conformance suite in all four languages) except Umbel's workspace `cargo test`. That step failed only
because this machine's cargo `build-dir` is separate from the target directory, so the
component-loader tests looked for their `.wasm` fixtures in the wrong place. Rerun with target and
build directories the same (fixtures and `hello-mcp` rebuilt there first, `--no-fail-fast`), every
test target passed.

## Phase 2: the TypeScript reference

Merged in [#1251](https://github.com/lushly-dev/afd/pull/1251) on 2026-11-15 (`06f22645`):

- **Undo.** Every change's result names its undo (`undoCommand`, `undoArgs`) and the command
  declares `undoable`: create (`todo-delete`), update and toggle (`todo-update`, setting the
  previous values), toggle-batch when one call can undo it (a mixed toggle warns
  `NO_SINGLE_UNDO`), delete and delete-batch (`todo-restore`).
- **Deleted todos.** A delete keeps the todo, out of every live read; `todo-list { deleted: true }`
  lists them (with `deletedAt`, sortable), and the not-found error says so. `todo-restore` (new)
  brings them back. The file store keeps them in `todos.deleted.json`, so the Python backend,
  sharing `todos.json`, never sees one as live.
- **History.** `todo-history` (new) reads a change log that `src/history.ts`'s middleware records
  from each successful change: actor, time, ids and undo, with an undo offered only while it is a
  todo's latest change; the latest 1,000 kept, in `todos.history.json` for the file store.
- **Approval.** `todo-clear` is held for any caller that is not a person
  (`createApprovalMiddleware`, `relay: 'mcp-elicitation'`), with a summary of what would go;
  `{ deleted: true }` empties the deleted todos. `APPROVALS=off` holds nothing, and the
  conformance runner sets it.
- **Context.** Handlers take their time and ids from `context.clock` and `context.random`.
- **Spec.** `todo-restore` and `todo-history` are in `spec/commands.schema.json` with
  `implementedBy: ["typescript"]`, the new inputs with `x-implementedBy`; the Python, Rust and C++
  tests check only their own commands, and the C++ backend, whose schema compiler refuses unknown
  keywords, leaves the TypeScript-only inputs out of its schemas.
- **Jobs.** Jobs 1 to 5, 8 and 9 moved to `backends/typescript/scenarios/` and run in
  `src/scenarios.test.ts`, in-process through the server's middleware (job 5 through
  `createDirectRegistry` in `todo-reading`). Removing the approval middleware fails job 4, and
  running job 5 with no context fails it.

Merged in [#1256](https://github.com/lushly-dev/afd/pull/1256) on 2026-11-15:

- **Journal and replay (job 7).** `TODO_JOURNAL` records each call past the approval hold through
  `createJournalMiddleware`, with the clock and random values it read; held calls are not
  recorded, so no approval token reaches a journal. `src/registry.ts` is the module
  `afd replay --module` loads: a fresh in-memory store and the same middleware without the
  approval hold, which every journaled call already passed. Importing the store module touches
  no data file; the server chooses its store at startup. `src/replay.test.ts` records job 7 and
  an approved agent clear and replays both to the same results, finds a changed session, and
  checks the replay module creates no data file; the CLI replay of a recorded session matched.
- **Metadata.** Every command declares a `title`, an `output` schema and `examples`, and every
  mutation an `approval` policy. `src/surface.test.ts` runs strict surface validation: four input
  overlaps are suppressed with their reason (the single-id commands, and `todo-restore` as
  `todo-delete-batch`'s undo); seven descriptions were rewritten.
- **Middleware.** `defaultMiddleware()` replaces the hand-built logging.

Merged in [#1260](https://github.com/lushly-dev/afd/pull/1260) on 2026-11-15:

- **Approval suite.** `spec/approval-cases.json` (`--suite approvals`, `APPROVALS=agents`): an
  agent's clear held with its suggestion, a delete not held, a clear a person approves through
  form elicitation, and one a person declines. It resets by deleting, since a clear is held.
  TypeScript passes it in both MCP eras, in CI.
- **New conformance cases.** Six cases in `spec/test-cases.json` marked
  `implementedBy: ["typescript"]` (undo metadata, delete and restore, an id that cannot be
  restored, emptying the deleted todos, history); the runner keeps each backend to its
  language's cases and fails a suite that leaves it none. The other backends run the 35 shared
  ones unchanged.
- **Scenarios and surface in CI.** `pnpm test:scenarios:ts` (`dx/run-scenarios.ts`) serves the
  backend over Streamable HTTP and runs `afd validate --surface --strict` (the four overlaps
  suppressed, from one list shared with `surface.test.ts`) and `afd scenario run` on every
  scenario not tagged `deterministic` or `contexts`: ten pass. The four older scenarios no longer
  start by clearing, and `filter-by-priority` cleans up after itself.
- **CI.** `conformance.yml` runs both and triggers on `packages/cli`, `packages/client` and
  `packages/testing`; `scripts/affected/suites.mjs` lists the same steps for `pnpm verify`.

Left in phase 2: storage on local-db (D4).

## Open questions

None. The owner decided D1 to D3 on 2026-11-14 and D6 to D10 on 2026-11-15, and noted that the
app is a reference first: where a choice is close it leans toward making the system visible.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-14 | Phase 1 session | The `umbel` MCP server (`components-brief`) does not start in a fresh worktree until `pnpm build` and `cargo build --release -p umbel-first-party` have run; phase 3 needs it | Open, phase 3 |
| 2026-11-14 | Phase 1 review | An Umbel mounted tool cannot declare `destructive`: `MOUNT_TOOL_KEYS` (`endpoints/umbel/src/plugins/manifest.rs`) has no such key and `src/plugins/mounted/mod.rs` never sets it, so `umbel-mounted` advertises the todo deletes as not destructive. It predates this work | Open, phase 5 |
| 2026-11-15 | Phase 2 slice | The current frontends call `todo-clear` over MCP, where every caller counts as an agent, so their "clear completed" is held with `APPROVAL_REQUIRED` (or needs `APPROVALS=off`) until the page has an approval flow | Open, phase 3 |
| 2026-11-15 | Phase 2 CI review | `umbel.yml` runs AFD's CLI against Umbel but starts on neither `packages/client/**` nor, in its `Affected units` gate, the CLI or the example, so a client change does not run it | Open |
| 2026-11-14 | Phase 1 session | `ruff check` with default rules reports 14 findings in each of the Python backend's command modules on `main`; CI does not lint the example | Open, phase 5's Python pull request (D8, owner 2026-11-15) |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-14 | Review and phase 1 | Reviewed the examples against current AFD; wrote the proposal and this file; phase 1 written and verified locally |
| 2026-11-15 | Phase 1 merged, phase 2 jobs | Phase 1 merged in #1231. Wrote phase 2's jobs as scenarios with the drafted commands; two fresh readers walked them and the proposal records what changed; the owner decided D6 to D10 |
| 2026-11-15 | Phase 2 slice | Built undo, deleted todos, `todo-restore`, `todo-history` and the clear approval in TypeScript; jobs 1 to 5, 8 and 9 run in the backend's tests |
| 2026-11-15 | Phase 2 journal | Journal and replay (job 7), title, output and examples on every command, strict surface validation in the tests, `defaultMiddleware()`; in #1256 |
| 2026-11-15 | Phase 2 CI | Approval suite, six TypeScript-only conformance cases, `afd validate --surface --strict` and `afd scenario run` against the backend in CI, the older scenarios without a clear; in #1260 |
