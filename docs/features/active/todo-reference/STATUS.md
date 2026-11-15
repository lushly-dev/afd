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
- **Done:** nothing merged yet.
- **In progress:** phase 1 on `t3/refresh-todo-afd-examples`, in [#1231](https://github.com/lushly-dev/afd/pull/1231), which
  is not yet merged.
- **Not started:** phases 2 to 5.

## Plan

| Phase | State | Evidence | Next gate |
| --- | --- | --- | --- |
| 1. Fix what is wrong | In progress: W1, W2 (TypeScript, Python), W3, W4 (declared), W6 and the backend half of W5 and W7 are written and pass locally | See [phase 1](#phase-1-fix-what-is-wrong) | Pull request merged |
| 2. The TypeScript reference | Not started | None | Phase 1 merged; jobs written as scenarios first |
| 3. The Violet frontend | Not started | None | Phase 2's commands; the `umbel` server built so `components-brief` answers |
| 4. DirectClient | Not started | None | Phases 2 and 3 |
| 5. The other languages | Not started | None | Phase 2's conformance cases; C++ also [#341](https://github.com/lushly-dev/afd/issues/341) |

## Findings

| Finding | State |
| --- | --- |
| W1 `total` capped at 100 in TypeScript | Fixed on the branch |
| W2 contexts declared but not served | TypeScript and Python fixed on the branch. C++ declares them but serves no context tools (its own stdio loop, phase 5). Rust declares none (phase 5) |
| W3 deletes not marked destructive | Fixed on the branch in TypeScript, Python and Rust (C++ already was), and in the Umbel `todo` plugin's compiled manifest. Under `umbel-mounted` the deletes still advertise `destructiveHint: false`, because a mounted tool cannot declare `destructive` (see follow-ups) |
| W4 no confirmation gate in C++ | Prompt declared on the branch; enforcement open, phase 5 with `afd::mcp_stdio` |
| W5 deprecated `/message` and `/sse` | Backend text fixed on the branch; the frontends still use `/message` until phase 3 replaces them |
| W6 README errors | Fixed on the branch |
| W7 small defects | `todo-clear`'s debug logging removed on the branch. The React `FETCH_ERROR`, vanilla `innerHTML` (phase 3) and todo-directclient text (phase 4) are open |
| W8 todo-directclient's copied commands and hand-written tools | Open, phase 4 |
| W9 cross-backend drift outside the suite | Destructive flags and contexts now checked by every backend's tests against `spec/commands.schema.json` (Rust without contexts). Alternatives, ordering ties, ID formats and tool lists open, phase 5 |

## Phase 1: fix what is wrong

On branch `t3/refresh-todo-afd-examples`, 2026-11-14:

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

## Open questions

None. The owner decided D1 to D3 on 2026-11-14.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-14 | Phase 1 session | The `umbel` MCP server (`components-brief`) does not start in a fresh worktree until `pnpm build` and `cargo build --release -p umbel-first-party` have run; phase 3 needs it | Open, phase 3 |
| 2026-11-14 | Phase 1 review | An Umbel mounted tool cannot declare `destructive`: `MOUNT_TOOL_KEYS` (`endpoints/umbel/src/plugins/manifest.rs`) has no such key and `src/plugins/mounted/mod.rs` never sets it, so `umbel-mounted` advertises the todo deletes as not destructive. It predates this work | Open, phase 5 |
| 2026-11-14 | Phase 1 session | `ruff check` with default rules reports 14 findings in each of the Python backend's command modules on `main`; CI does not lint the example | Open |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-14 | Review and phase 1 | Reviewed the examples against current AFD; wrote the proposal and this file; phase 1 written and verified locally |
