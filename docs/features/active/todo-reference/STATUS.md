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
- **Last verified:** 2026-11-15 on branch `t3/todo-reference-phase2-localdb`, based on `main` at
  `fa40fe82`, with Node 26.13.0: the full `pnpm verify` passed. On the phase 5 Python
  branch, `pnpm verify` passed on `d5c93a57` on 2026-11-16; the review fixes since were checked
  suite by suite (see [phase 5](#python)). In #1335, 2026-11-16, suite by suite
  (see [Rust](#rust)); `pnpm verify` not run.
- **Done:** phase 1, merged in [#1231](https://github.com/lushly-dev/afd/pull/1231) on 2026-11-15 (`176c7471`). Phase 2, in the
  TypeScript backend: jobs in #1248, undo, restore, history and the clear approval in #1251, the
  journal and full metadata in #1256, CI and conformance in #1260, SQLite storage in #1263, all
  2026-11-15. The parts they left open belong to later phases, as the findings table says.
- **Done:** phase 4, DirectClient: the main commands through the tool surface with `allow` in
  [#1281](https://github.com/lushly-dev/afd/pull/1281), and the page with approvals and view state in
  [#1303](https://github.com/lushly-dev/afd/pull/1303), both 2026-11-15.
- **In progress:** phase 5. Python is merged in [#1319](https://github.com/lushly-dev/afd/pull/1319) on 2026-11-16: Python at parity with
  TypeScript, and both backends on one SQLite database by default (D4). Rust is merged in
  [#1335](https://github.com/lushly-dev/afd/pull/1335) on 2026-11-16: Rust and both Umbel modes at parity, every approval case included. C++: the library's `afd::mcp_stdio` target that it waited on ([#341](https://github.com/lushly-dev/afd/issues/341)) merged in [#1379](https://github.com/lushly-dev/afd/pull/1379) on 2026-11-17, with the backend on it and confirmations enforced; C++ parity merged in [#1426](https://github.com/lushly-dev/afd/pull/1426) on 2026-11-17 (`feca7208`; see [C++](#c)). Python's approval relay ([#1312](https://github.com/lushly-dev/afd/issues/1312)) merged in [#1442](https://github.com/lushly-dev/afd/pull/1442) on 2026-11-17 (`673e8795`): every backend runs every approval case. C++ contexts ([#1425](https://github.com/lushly-dev/afd/issues/1425)) merged in [#1454](https://github.com/lushly-dev/afd/pull/1454) on 2026-11-17 (`3cb229af`), closing W2 (see [C++ contexts](#c-contexts)). C++'s bootstrap commands merged in [#1468](https://github.com/lushly-dev/afd/pull/1468) on 2026-11-17 (`d16dc64e`), the first of three steps for [#1451](https://github.com/lushly-dev/afd/issues/1451); its meta-tools and tool strategies, which give the C++ backend TypeScript's tool list (W9), merged in [#1477](https://github.com/lushly-dev/afd/pull/1477) on 2026-11-17 (`b26a16e6`; see [C++ meta-tools and strategies](#c-meta-tools-and-strategies)), and the up-front approval of its `afd-batch` and `afd-pipe`, the last step, merged in [#1482](https://github.com/lushly-dev/afd/pull/1482) on 2026-11-17 (`8d11828e`; see [C++ up-front approval](#c-up-front-approval)). The wider suite, the last item of phase 5, is on branch `t3/todo-wider-suite` (see [The wider suite](#the-wider-suite)).

## Plan

| Phase | State | Evidence | Next gate |
| --- | --- | --- | --- |
| 1. Fix what is wrong | Done: W1, W2 (TypeScript, Python), W3, W4 (declared), W6 and the backend half of W5 and W7, merged in [#1231](https://github.com/lushly-dev/afd/pull/1231) | See [phase 1](#phase-1-fix-what-is-wrong) | None |
| 2. The TypeScript reference | Done; job 6 runs on the page in phase 3 and through the copilot in phase 4: #1248, #1251, #1256, #1260 and #1263 | See [phase 2](#phase-2-the-typescript-reference) | None |
| 3. The Violet frontend | Done: the FAST-AF page in [#1275](https://github.com/lushly-dev/afd/pull/1275), the React page in [#1276](https://github.com/lushly-dev/afd/pull/1276) | See [phase 3](#phase-3-the-violet-frontend) | None |
| 4. DirectClient | Done: the copilot on the main commands, the tool surface and `allow` (job 10) in [#1281](https://github.com/lushly-dev/afd/pull/1281); the page, with approvals through `onApprovalNeeded` and the page-hosted view (job 6), in [#1303](https://github.com/lushly-dev/afd/pull/1303) | See [phase 4](#phase-4-directclient) | None |
| 5. The other languages | In progress: Python in [#1319](https://github.com/lushly-dev/afd/pull/1319); Rust in [#1335](https://github.com/lushly-dev/afd/pull/1335); C++'s MCP target in [#1379](https://github.com/lushly-dev/afd/pull/1379); C++ parity in [#1426](https://github.com/lushly-dev/afd/pull/1426); Python's approval relay in [#1442](https://github.com/lushly-dev/afd/pull/1442); C++ contexts in [#1454](https://github.com/lushly-dev/afd/pull/1454); C++ bootstrap commands in [#1468](https://github.com/lushly-dev/afd/pull/1468); C++ meta-tools and strategies in [#1477](https://github.com/lushly-dev/afd/pull/1477); C++ up-front approval in [#1482](https://github.com/lushly-dev/afd/pull/1482); the wider suite on branch `t3/todo-wider-suite` | See [phase 5](#phase-5-the-other-languages) | Merge the wider suite; then the exit criteria |

## Findings

| Finding | State |
| --- | --- |
| W1 `total` capped at 100 in TypeScript | Fixed in [#1231](https://github.com/lushly-dev/afd/pull/1231) |
| W2 contexts declared but not served | TypeScript and Python fixed in [#1231](https://github.com/lushly-dev/afd/pull/1231); Python's `todo-history` and `todo-restore` take their contexts in [#1319](https://github.com/lushly-dev/afd/pull/1319). Rust declares and serves them in #1335 (and the Umbel plugin's manifest declares them). C++ declares them, and serves them since [#1454](https://github.com/lushly-dev/afd/pull/1454) ([#1425](https://github.com/lushly-dev/afd/issues/1425); see [C++ contexts](#c-contexts)) |
| W3 deletes not marked destructive | Fixed in [#1231](https://github.com/lushly-dev/afd/pull/1231) in TypeScript, Python and Rust (C++ already was), and in the Umbel `todo` plugin's compiled manifest. Under `umbel-mounted` the deletes advertised `destructiveHint: false`, since a mounted tool could not declare `destructive`; in #1335 it can, and the `todo-http` fixture does (see follow-ups) |
| W4 no confirmation gate in C++ | Fixed: prompt declared in [#1231](https://github.com/lushly-dev/afd/pull/1231); enforced in [#1379](https://github.com/lushly-dev/afd/pull/1379): the backend runs on `afd::mcp_stdio`, reads `CONFIRMATIONS` and passes the confirmation suite in both eras, in CI ([#467](https://github.com/lushly-dev/afd/issues/467)) |
| W5 deprecated `/message` and `/sse` | Backend text fixed in [#1231](https://github.com/lushly-dev/afd/pull/1231); the frontends still use `/message` until phase 3 replaces them |
| W6 README errors | Fixed in [#1231](https://github.com/lushly-dev/afd/pull/1231) |
| W7 small defects | `todo-clear`'s debug logging removed in [#1231](https://github.com/lushly-dev/afd/pull/1231). The React `FETCH_ERROR` and vanilla `innerHTML` went with the old frontends in phase 3. todo-directclient's two latencies and "experiment" are gone in [#1281](https://github.com/lushly-dev/afd/pull/1281): `pnpm benchmark` measures both paths and the README states no numbers |
| W8 todo-directclient's copied commands and hand-written tools | Fixed in [#1281](https://github.com/lushly-dev/afd/pull/1281): the main commands (D5), tools from `listTools()`, and `allow` in look mode |
| W9 cross-backend drift outside the suite | Destructive flags and contexts now checked by every backend's tests against `spec/commands.schema.json` (Rust without contexts). On the phase 5 Python branch: TypeScript and Python answer each read `pnpm test:interop` makes alike on one database, order (an accented, mixed-case title sort among them) and alternatives included, and describe every command alike in `afd-detail` (title, description, category, tags, mutation); Python makes ids in TypeScript's format from the context's random. Title order follows JavaScript's `localeCompare` for Latin text, digits and ASCII punctuation (`collation.py`), not every script. In #1335 Rust returns TypeScript's `alternatives`, keeps ties in insertion order in both directions, makes ids in TypeScript's format from the context's random (a seeded id checked against TypeScript's), and lists TypeScript's grouped tools (`todo` and `bootstrap`, from the library's tool list). Rust's title sort folds case its own way, not `localeCompare` (see follow-ups). On the C++ parity branch C++ returns TypeScript's `alternatives`, keeps ties in insertion order in both directions (a restored todo counts as added again) and makes TypeScript's ids from the context's random (the seeded id checked against TypeScript's); its tests compare each input schema with the contract's, descriptions aside. C++'s title sort folds ASCII case only. Its tool list is TypeScript's grouped one (`todo` and `bootstrap`, from the library's tool list) since [#1477](https://github.com/lushly-dev/afd/pull/1477). On branch `t3/todo-wider-suite` the suite checks alternatives, ties in both directions, the destructive hints and TypeScript's tool list against every backend ([the wider suite](#the-wider-suite)); Python's tool list waits on [#533](https://github.com/lushly-dev/afd/issues/533) |

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

Merged in [#1263](https://github.com/lushly-dev/afd/pull/1263) on 2026-11-15:

- **SQLite storage (D4).** `TODO_STORE_TYPE=sqlite` stores the todos, the deleted todos and the
  history in one database through `@lushly-dev/local-db`'s SQLite adapter (`src/store/sqlite.ts`).
  Each write runs through the adapter's `batch`, one transaction, so a delete or restore moves its
  todo all or nothing, and a write to a todo another process removed meanwhile rolls back; the
  history entry is a separate write after it. The filtering, sorting (ties in insertion order, as
  the in-memory store) and undo rules are the in-memory store's, reused.
  The store is asynchronous, so every command awaits the store, and a middleware outside the
  approval hold reads the counts `todo-clear`'s approval summary shows. The backend's tests run
  every job against both the in-memory and the SQLite store.
- **The default stays the JSON file** until phase 5's Python pull request reads the same
  database, so TypeScript and Python keep sharing data throughout (D4's timing).

Phase 2 is then complete apart from job 6, which waits for the page in phases 3 and 4.

## Phase 3: the Violet frontend

Merged in [#1275](https://github.com/lushly-dev/afd/pull/1275) on 2026-11-15:

- **The page** (`frontends/fast-af`), on `fast-element` and `violet-elements` after
  `health-dashboard`'s pattern, replaces the vanilla frontend. It talks MCP on `/mcp` through
  `@lushly-dev/afd-client/streamable-http` and imports only the 16 violet elements it uses (the
  bundle went from 1.26 MB to 600 kB, most of it the MCP SDK and Zod). Briefed with
  `components-brief` before the markup, through the `umbel` server run directly, since it had
  not connected in the session.
- **Approvals in the page.** The page's client declares form elicitation, so the server's
  `mcp-elicitation` relay asks the page when it holds `todo-clear`; the page shows a
  `violet-approval-card` in an alert `violet-dialog` and answers with the person's choice. This
  settles the phase 2 open question of how a person approves without sign-in.
- **Shared modules** (`frontends/shared`): the client, the session (state and actions), the
  `todo-filter` view state with its `view-state-*` commands served in the page, and the trust
  summary. The React rebuild will use them unchanged.
- **Job 6** runs against the page's view-state commands (`frontends/shared/src/view-state.test.ts`)
  and in the page in Chromium, where the list follows an agent's `view-state-set`.
- **Tests:** the session against a real backend over HTTP (approve, deny, undo, restore,
  other clients' changes, an unreachable backend), and the built page in Chromium against a real
  backend with axe (`pnpm test:page`, run in `conformance.yml`).

Merged in [#1276](https://github.com/lushly-dev/afd/pull/1276) on 2026-11-15:

- **The React page** (`frontends/react`), React 19 on the same violet elements and shared session,
  replaces the old React frontend and its `/message` client. It renders the FAST-AF page's
  structure and class names, so the two share the element imports, the theme and the styles,
  which moved to `frontends/shared`. React sets `value`, `checked` and `open` as properties; the
  elements' events are wired through a ref callback that listens while the element is mounted
  (`useElementEvents`).
- **One browser suite for both** (`frontends/shared/test/page-suite.ts`): each frontend runs it on
  its own build, and `pnpm test:page` runs both in CI.
- **Bundle sizes**, 2026-11-15: the FAST-AF page 602 kB (151 kB gzipped), the React page 810 kB
  (215 kB gzipped), warning limits 700 and 900 kB; most of each is the MCP client SDK and Zod.
- **Selection as view state: declined.** The old frontends' batch select is not rebuilt: agents
  and the CLI keep the batch commands, and the page acts on one todo at a time, with Undo. The
  proposal's sentence stands corrected here.

Phase 3 is then done.

## Phase 4: DirectClient

Merged in [#1281](https://github.com/lushly-dev/afd/pull/1281) on 2026-11-15:

- **The main commands (D5).** todo-directclient imports `@afd/example-todo-ts/commands` and the
  main middleware (`createTodoMiddleware`) into `createDirectRegistry`; its own copies of 8
  commands, its store and its types are gone. The main backend's package now exports
  `./commands`, `./contexts`, `./server-options` and `./store`.
- **Tools from the surface.** `createDirectToolSurface` and `listTools()` give the model each
  command's own JSON Schema, sent to Gemini as `parametersJsonSchema`; the hand-written schemas
  with `required: []` are gone. Gemini's own parts go back unchanged, thought signatures included.
- **`allow`.** `mode: "look"` permits only the commands that declare `mutation: false`; others are
  hidden from the tool list and refused with `COMMAND_NOT_ALLOWED` before they run, including
  through `afd-call`. Job 10 (`todo-directclient/backend/scenarios/`) runs through the look-mode
  client; it fails if the mode is `change`.
- **The copilot is an agent** (`id: todo-copilot`), so the history names it and `todo-clear` is
  held. The tests approve and deny through `onApprovalNeeded`; the server has no hook yet, so the
  model hears `APPROVAL_REQUIRED` until the page can ask.
- **One server.** The chat server serves `/mcp` with the main server's options, behind its Host
  and Origin checks and with its `ALLOWED_HOSTS`, and the separate MCP server on port 3200 is
  gone. The copilot and `/mcp` share one journal (`src/services.ts`). The store is the main
  example's, chosen by `TODO_STORE_TYPE`.
- **Bounded turns.** At most `GEMINI_MAX_TOOL_ROUNDS` rounds and 20 calls per message; a turn that
  reaches a limit returns what already ran. A blank limit keeps its default and anything but a positive integer is refused at startup. A page that
  leaves mid-turn cancels the model request and the remaining calls.
- **The model behind an interface**, with a scripted one in the tests, which need no API key.
  Gemini's call ids go back with their results, and an empty answer is reported, not "Done."
- **Review:** a fresh reviewer found `/mcp` refusing `ALLOWED_HOSTS` and two journal sinks on one
  file (duplicate `seq`), both reproduced and fixed with tests that fail without the fix, plus the
  limits, cancelling, call ids and docs above.
- **Verified** with `pnpm -F @afd/example-todo-directclient test` (86 tests), `pnpm demo` and
  `pnpm benchmark` (2026-11-15, this machine: DirectClient 0.017 ms and MCP 2.1 ms median for
  `todo-list` over 20 todos).

Merged in [#1303](https://github.com/lushly-dev/afd/pull/1303) on 2026-11-15:

- **The page** (`todo-directclient/frontend`, `@afd/example-todo-directclient-page`): Vite, the
  FAST-AF page's own `<todo-app>` (now exported as `@afd/example-todo-fast-af/todo-app`) on the
  shared session over `/mcp`, and a `<todo-copilot>` panel on `violet-message`,
  `violet-tool-call-card`, `violet-approval-card` and a "Change todos / Only look" switch. Briefed
  with `components-brief` before the markup. It replaces the vanilla page, its render helpers and
  `/execute`, so the page's own calls now go through `/mcp` like any MCP client's. Bundle,
  2026-11-15: 616 kB (154 kB gzipped).
- **Streamed turns.** `POST /chat` streams a turn as JSON lines: each call as it starts and ends,
  and the questions the server needs the page to answer, on `POST /chat/answer`
  (`backend/src/turns.ts`). A question settles as a no when it lapses or the page leaves.
- **Approvals through `onApprovalNeeded`.** The hook asks the page that sent the message; the
  person approves or denies in a `violet-approval-card`, and DirectClient retries the held clear
  with the token in the server's process. The page never sees a token.
- **The view in the page (job 6).** The copilot's registry holds stand-ins for `view-state-get`,
  `-set` and `-list` with the view-state package's own schemas, which send each call to the page
  (`backend/src/page.ts`); the page runs it in its own registry, so the list on screen changes.
  Look mode permits them, since they change what the page shows and never the todos.
- **Tests:** the turn protocol over HTTP with the real copilot (`src/turn-http.test.ts`), two
  turns at once keeping their own pages, the page's turn client, and the built page in Chromium
  served by the real server with a scripted model (`frontend/test/copilot.test.ts`: add, job 6,
  approve, deny, job 10, the conversation kept in place with focus in the panel, axe), plus the
  shared page suite on the same build. Breaking the page's view runs or its approval answers
  fails them. `conformance.yml` runs the Chromium suites.
- **Review:** a fresh reviewer found the panel rebuilding the whole conversation on every event,
  which dropped focus and re-read a live region; the panel now changes observable entries in
  place, keeps focus in its field and announces through one status line, and a test built
  against the old panel fails. Also from the review: a view call that never settles no longer
  stalls the page, leftover approval cards close with the turn, a page that leaves while its
  message is read cancels the turn, the approval wait is tested, and the README says an answer
  proves who asked, not that a person did.

## Phase 5: the other languages

### Python

Merged in [#1319](https://github.com/lushly-dev/afd/pull/1319) on 2026-11-16:

- **Commands at parity (D2, D3).** Every command declares TypeScript's `title`, `version`,
  `examples`, an `output_schema` (Pydantic models in `models.py`), `undoable` and, on every
  mutation, an `approval` policy. `todo-restore` and `todo-history` are new, `todo-list` and
  `todo-clear` take `deleted`, and deleted todos are kept until a clear empties them (D7). Each
  result names its undo as TypeScript's does, with the same error codes, suggestions (the
  not-found one now points to the deleted list) and warnings (`RESTORABLE`, `NO_SINGLE_UNDO`).
  Handlers take their time and ids from `context.clock` and `context.random`, in TypeScript's ID
  format. The commands are built before the server (`all_commands`), since the approval
  middleware reads them when it is created.
- **History.** `history.py` is TypeScript's `src/history.ts`: a middleware inside the approval
  hold records each successful change with its actor's kind and id, time, ids and undo, and
  `todo-history` offers an undo only while it is the latest change to its todos.
- **Approvals.** `APPROVALS` (`agents` by default, `off`) and `TODO_APPROVAL_SECRET` (at least 32
  bytes, else a random key) as TypeScript reads them; `todo-clear` is held for any caller that is
  not a person through `create_approval_middleware`, with TypeScript's summary text. The store is
  synchronous here, so the summary reads its counts directly, with no counts middleware. The
  approval suite's two `acknowledge` cases name Python. Until #1312, `accept` and `decline` stayed
  TypeScript's and a held clear could not be approved over the Python server's MCP; since the
  Python relay (2026-11-17, see [the relay](#pythons-approval-relay)), the server asks the person
  as the others do and every case runs against it. The runner skips a client kind with no case
  for the language, and still fails a suite that leaves it none. Each server keeps its own spent
  tokens, so with a shared `TODO_APPROVAL_SECRET` one approval can run the clear once on each
  server; both backends' READMEs say so.
- **The shared SQLite store (D4).** `store/sqlite.py` reads and writes local-db's layout through
  `sqlite3`: the `records` table, `user_version` 1 decided inside `BEGIN IMMEDIATE`, a foreign
  file refused untouched, WAL, `synchronous = FULL`, a 5-second busy timeout; the `todos`,
  `deleted_todos` and `changes` tables, `_order`, 12-digit change ids and the 1,000-change limit.
  Each write reads its rows inside its transaction, which gives the TypeScript store's guard
  against a row another process removed. A failed write or commit is rolled back quietly (SQLite
  may already have rolled it back) and its own error raised, and a connection left inside a
  transaction is closed and reopened on the next call, as the adapter's `rollbackQuietly` does;
  tests force each case. The history `seq` is read inside the write, so two Python writers never
  collide; TypeScript's is read before its write, so a TypeScript writer and another can
  ([#1317](https://github.com/lushly-dev/afd/issues/1317)). Titles sort as `localeCompare` does
  (`collation.py`, checked against orders from Node.js), where `casefold` did not. The JSON file store gained the deleted and history files
  TypeScript's has, so both stores are shared, and `store.py` became a package as in TypeScript.
- **The default moved to SQLite in both languages.** `TODO_STORE_TYPE` defaults to `sqlite` in
  TypeScript and Python, at `data/todos.db`, which both resolve beside `data/todos.json`. A new
  default database is seeded from `data/todos.seed.json`, as the JSON file was: in Python inside
  the transaction that creates the table, in TypeScript in `SqliteStore.check()` when the store
  created the file. The READMEs, todo-directclient's README, `.env.example` and its server comment
  say so. `@afd/example-todo-ts` declares `engines.node >= 22.13.0`, the first Node.js with
  `node:sqlite` unflagged; the root `engines` still allows 22.12.
- **Interop.** `pnpm test:interop` (`dx/run-interop.ts`), 16 checks in four parts: the
  TypeScript server creates a database and the Python server opens it beside it, the todos
  changed through each in turn with each read's data and alternatives compared, a title sort with
  accents and case, and `afd-detail` for all 13 commands; Python creates and seeds a database the
  TypeScript server opens; TypeScript's `check()` creates and seeds one the Python server opens;
  and five rounds of both opening one new file at the same moment, the seed written once.
  `conformance.yml` runs it and now also starts on `packages/local-db/**`, whose layout both
  stores depend on.
- **Tests.** `afd.testing`'s assertions throughout, and its scenario runner on the TypeScript
  backend's jobs in-process on all three stores (job 7 skipped, since Python records no journal;
  job 9 a strict `xfail`, see the follow-ups). The store tests read the adapter's schema text from
  `packages/local-db/src/sqlite-adapter.ts` and compare the file Python writes with it; no other
  test reads TypeScript source, so what TypeScript does is checked by the interop run.
- **Lint (D8).** The repository's ruff rules (`python/pyproject.toml`) in the backend's
  `pyproject.toml`, `N815` excepted in `models.py` for the wire's camelCase; `ruff check` and
  `ruff format --check` in `conformance.yml` and `scripts/affected/suites.mjs`, with Python's
  approval suite and the interop run.
- **Spec.** `python` added to `implementedBy` on both commands, the six test cases and the two
  approval cases, and to `x-implementedBy` on both inputs; `spec/README.md`'s counts and tables.

Verified locally on 2026-11-16 with Node 26.13.0 and Python 3.14: `uv run --locked pytest -q`
(131 passed, 3 skipped, 3 xfailed), `ruff check` and `ruff format --check`; Python conformance
41/41 and confirmations 5/5 in legacy and modern modes, approvals 2/2 in both; TypeScript
conformance 41/41, confirmations 5/5 and approvals 4/4 in both modes; `pnpm test:scenarios:ts`
(surface validation and 10 scenarios); `pnpm test:interop`; `pnpm -F @afd/example-todo-ts test`
(181 tests) and `pnpm -F @afd/example-todo-directclient test` (85 tests); `pnpm test:tooling`.
`pnpm verify` passed on the branch's commit `d5c93a57` (2026-11-16). An independent review found
no blockers; its fixes (the collation, SQLite error handling, the interop directions, `engines`,
the approval and history docs, the tests that read TypeScript source) are checked suite by suite
below and have not yet had a full `pnpm verify`.

### Rust

Merged in [#1335](https://github.com/lushly-dev/afd/pull/1335) on 2026-11-16:

- **Commands at parity (D2, D3, D7).** Every command declares TypeScript's `title`, `version`,
  `tags`, `examples`, contexts, a declared output shape (`returns`), `undoable` and, on every
  mutation, an `approval` policy, with the TypeScript and Python descriptions. `todo-restore` and
  `todo-history` are new, `todo-list` and `todo-clear` take `deleted` (and `todo-list` sorts by
  `deletedAt`), and deleted todos are kept until a clear empties them. Each result names its undo
  as TypeScript's does, with the same error codes, suggestions and warnings (`RESTORABLE`,
  `NO_SINGLE_UNDO`), and a filtered `todo-list` returns TypeScript's `alternatives`. Handlers take
  their time and ids from `context.clock()` and `context.random()`, in TypeScript's ID format;
  `seeded_random("todo")` at one clock gives TypeScript's id. Ties sort in insertion order in both
  directions, as TypeScript's stable sort does (Rust reversed them).
- **The library in place of the backend's own code.** `register_with_schema` validates each
  command's whole input schema, and `src/validation.rs` (418 lines) is gone; the servers list the
  library's own tools instead of a `with_tools` override, so each tool carries its title,
  annotations, `_meta.approval` and, under the individual strategy, `outputSchema`. The bootstrap
  commands are registered (`register_bootstrap_commands`), and the `todo-reading` and
  `todo-editing` contexts are served (`McpServer::with_contexts`). `app::registry` assembles what
  the binary serves.
- **stdio.** `todo-backend-rust stdio` serves MCP over stdin and stdout (`serve_stdio`); HTTP
  stays `server`. The conformance runner now spawns Rust over stdio like the other backends, so
  the confirmation cases pass in both eras (over stateless 2025 HTTP they cannot); Umbel's
  mounted mode still runs the HTTP server.
- **History.** Each command records its own successful change from its result (actor kind and
  id, time from the context's clock, ids, undo) in the handler wrapper, not a middleware, so the
  Umbel plugin, which registers the commands in a registry of its own, keeps the history too. A
  change and its entry run under one store lock (`TodoStore::changing`), so concurrent changes
  are recorded in their order and the right entries are marked superseded; a test runs 200
  concurrent toggles. The approval middleware runs before the handler, so a held call is never
  recorded. An undo is
  offered only while it is its todos' latest change; the latest 1,000 are kept.
- **Approvals.** `APPROVALS` (`agents` by default, `off`) and `TODO_APPROVAL_SECRET` (at least 32
  bytes, else a random key per process), as TypeScript and Python read them. `todo-clear` is held
  for any caller that is not a person, with TypeScript's summary text; the library has the MCP
  relay (`ApprovalRelay::McpElicitation`), so a client that declares form elicitation is asked,
  and all four approval cases pass in both eras over stdio. Over HTTP only the hold is tested (a
  client that declares no elicitation gets `APPROVAL_REQUIRED` and no token); asking the person
  over MCP 2026-07-28 HTTP is not exercised. `TODO_APPROVAL_SECRET` is read only when clears are
  held, and `APPROVALS` is read exactly, as TypeScript reads both. The command line and shell run
  as `human` (the person at the terminal), so a clear there is not held.
- **Umbel.** `plugins/todo` regenerated: thirteen commands, the backend's descriptions and
  schemas, `contexts` on each and the two `[[contexts]]`. A manifest can declare only a fixed
  approval and Umbel refuses a per-call policy, so the plugin drops `todo-clear`'s; under Umbel the
  clear is gated by its confirmation prompt alone
  ([#1329](https://github.com/lushly-dev/afd/issues/1329)). So `todo-clear`'s description, shared
  word for word by TypeScript, Python, Rust and the plugin's manifest, now says a caller that is
  not a person waits for approval where the server holds clears, and that elsewhere the
  confirmation prompt gates it, where enforced (the review's blocker: it promised the hold in every
  host). The runner refuses `--suite approvals` against either Umbel target, naming #1329. Mounted tools can declare `destructive` since
  [#1338](https://github.com/lushly-dev/afd/pull/1338) (split out for Umbel's plugin-isolation
  gate), and the `todo-http` fixture marks the deletes and the clear, which closes the phase 1
  follow-up. The plugin's test now compares contexts and the fixture's `destructive`, and checks
  the history under the host.
- **Spec and CI.** `rust` added to `implementedBy` on both commands, the six test cases and all
  four approval cases, and to `x-implementedBy` on both inputs. The runner spawns the built Rust
  binary, as for C++, rather than `cargo run`, and passes `APPROVALS=off` to the backend Umbel
  mounts. `conformance.yml` runs Rust's confirmations and approvals in both eras;
  `scripts/affected/suites.mjs` adds both suites (legacy) to `pnpm verify` and names the modern
  runs as remote only. `umbel.yml`'s gate now names `packages/examples/todo/backends/rust/`, so a
  backend-only change runs the plugin's drift test.

Verified locally on 2026-11-16 with Node 26.13.0 and Rust 1.98.0: `cargo test --locked` (49
tests), `cargo clippy --locked --all-targets -- -D warnings` (also `--no-default-features`) and
`cargo fmt --check` in the backend; Rust conformance 41/41, confirmations 5/5 and approvals 4/4
in legacy and modern modes; `umbel` 41/41 in both modes and confirmations 5/5 modern;
`umbel-mounted` 41/41 in both modes; `cargo test -p umbel-plugin-todo` (5), `cargo test -p umbel
--test plugin_mounted` (31) and the manifest unit tests; `cargo clippy -p umbel -p
umbel-plugin-todo --all-targets -D warnings` and `cargo fmt --check` in Umbel; TypeScript and
Python conformance 41/41 and approvals 4/4 and 2/2 (legacy), the TypeScript spec test and the
Python tests (135 passed). The README's commands were run once. No lockfile changed. Not run:
`pnpm verify`, Umbel's full workspace `cargo test`, `external-clients.sh`. The review's fixes
were checked suite by suite; see the session log.

### C++

In review in [#1426](https://github.com/lushly-dev/afd/pull/1426), on the library's `afd::mcp_stdio`
([#1379](https://github.com/lushly-dev/afd/pull/1379), merged 2026-11-17):

- **Commands at parity (D2, D3, D7).**
  - Every command declares TypeScript's metadata: `title`, `version`, `tags`, `examples`, an
    output schema, `undoable` and, on every mutation, an `approval` policy. Descriptions are the
    ones TypeScript, Python and Rust share.
  - `todo-restore` and `todo-history` are new. `todo-list` and `todo-clear` take `deleted`, and
    `todo-list` sorts by `deletedAt`. Deleted todos are kept until a clear empties them.
  - Each result names its undo as TypeScript's does, with the same error codes, suggestions and
    warnings (`RESTORABLE`, `NO_SINGLE_UNDO`). The not-found suggestion now points to the deleted
    list.
  - Handlers take their time and ids from the context's clock and random, in TypeScript's ID
    format: `SeededRandom("todo")` at one clock gives TypeScript's id. Ties keep insertion order
    in both directions, and a restored todo counts as added again.
- **Its own input schemas.**
  - Each command declares its whole input schema, with TypeScript's descriptions, instead of
    validating against the embedded spec. So the advertised tools now describe their inputs, and
    the spec embedding (`src/spec.*`, `cmake/spec_schema.cpp.in`) is gone.
  - A test resolves the spec's `$ref`s and compares each schema with the contract's, descriptions
    aside, alongside the command list and metadata.
- **History.**
  - The wrapper every command's definition gets (`detail::define`, `src/commands/shared.cpp`)
    records each successful change from its result: actor kind and id, time from the context's
    clock, ids and undo. This is Rust's approach.
  - A change and its entry run under one store lock, so entries keep the changes' order (a test
    runs 200 concurrent toggles).
  - The approval middleware runs before the handler, so a held call is never recorded. The latest
    1,000 changes are kept, and an undo is offered only while it is its todos' latest change.
- **Approvals.**
  - `APPROVALS` (`agents` by default, `off`) and `TODO_APPROVAL_SECRET` (at least 32 bytes, else
    32 random bytes per process), read exactly as TypeScript reads them, the secret only when
    clears are held.
  - `todo-clear` is held for any caller that is not a person, with TypeScript's summary text,
    through `create_approval_middleware` with `ApprovalRelay::mcp_elicitation`. A client that
    declares form elicitation is asked; any other MCP client gets `APPROVAL_REQUIRED` and no
    token.
  - The command form runs as `human`, the person at the terminal.
- **What stood (W2, W9).** `afd::mcp_stdio` had no context tools, meta-tools, bootstrap commands
  or tool strategies, so the two contexts were declared but not served, and the tool list is one
  tool per command ([#1425](https://github.com/lushly-dev/afd/issues/1425)). Contexts are served
  since [C++ contexts](#c-contexts); the tool list since [C++ meta-tools and strategies](#c-meta-tools-and-strategies).
  The title sort folds ASCII case only, as before.
- **Spec and CI.**
  - `implementedBy` and `x-implementedBy` are gone from `commands.schema.json` and the six test
    cases, since all four languages implement everything. The two `acknowledge` approval cases
    are every language's; `accept` and `decline` name `cpp` beside TypeScript and Rust. `sortBy`
    takes `deletedAt`.
  - `conformance.yml` runs C++'s approvals in both eras; `scripts/affected/suites.mjs` adds them
    (legacy) to `pnpm verify`.
  - The library's `schema_test.cpp` no longer strips `x-implementedBy`.

Verified locally on 2026-11-17 with Node 26 and Apple clang: the backend's tests (36 cases, 715
assertions) with warnings as errors; C++ conformance 41/41 in legacy, modern and auto modes,
confirmations 5/5 and approvals 4/4 in legacy and modern modes; the README's commands, run once.
An independent review compared 27 calls side by side with the TypeScript server (identical but
for validation texts, now listed in the README) and found one blocker, fixed: an `offset` beyond
int64 was cast out of range, which on x86 could read out of bounds. Integer inputs are now clamped
to [0, 2^53 - 1]. Its improvements (missing-key reads, a test that an approved clear over MCP is
recorded once and a declined one not at all) are in too. Not run locally: GCC and MSVC. MSVC
later failed on `std::getenv` (see the findings log); fixed in [#1453](https://github.com/lushly-dev/afd/pull/1453).

### Python's approval relay

Merged in [#1442](https://github.com/lushly-dev/afd/pull/1442) on 2026-11-17 (`673e8795`), for
[#1312](https://github.com/lushly-dev/afd/issues/1312).

- **The library.** `create_approval_middleware(relay="mcp-elicitation")` asks the person behind
  an MCP client that declares form elicitation, as TypeScript's, Rust's and C++'s do
  (`spec/command-metadata.md`, "Asking the human over MCP"): `input_required` on 2026-07-28, a
  server-sent elicitation on a 2025 stdio or stateful HTTP connection, then the call runs again.
  `afd-batch` and `afd-pipe` are approved up front (#459), which the issue left out but the spec
  and the parity matrix ask of every server that serves them.
- **One state per call.** The confirmation's `requestState` was its bare digest; it is now a
  sealed JSON object that carries the questions asked and the earlier rounds' answers, each
  lapsing 10 minutes after it was asked, so a call that needs a confirmation and an approval asks
  for each in turn. The SDK still seals it and binds it to the request and the principal, so a
  retry with other arguments is refused before any handler runs.
- **The backend.** `server.py` passes `relay="mcp-elicitation"`. `include_token` keeps Python's
  default (on), which in-process callers rely on; an MCP agent that cannot elicit still gets
  the token, which no tool argument can carry.
- **Spec and CI.** `accept` and `decline` in `approval-cases.json` are every language's now;
  `conformance.yml` already ran Python's approvals in both eras.

Verified locally on 2026-11-17: the Python library's tests (3,216, with 48 new relay tests over
real MCP sessions in both eras), the backend's tests, Python conformance 41/41 in legacy and
modern modes, confirmations 5/5 and approvals 4/4 in legacy, modern and auto modes, and the full
`pnpm verify` on Node 26. An independent review found no blocker; its improvements are in: the
spec's own parity table, no channel or relay inherited by a call outside a request, a shielded
up-front plan, and tests for identical steps, hidden and nested commands, first-class tools, a
batch confirmed then approved, a policy that raises, a 2025 client that gives no answer, every
step reference and a re-asked batch.

### C++ contexts

Merged in [#1454](https://github.com/lushly-dev/afd/pull/1454) on 2026-11-17 (`3cb229af`), for
[#1425](https://github.com/lushly-dev/afd/issues/1425). The issue let the meta-tools, bootstrap
commands and strategies be split out; they are [#1451](https://github.com/lushly-dev/afd/issues/1451).

- **The library.** `afd/contexts.hpp` (`ContextConfig`, `ContextStack`, `register_context_commands`)
  gives C++ the three context tools with Rust's results and errors. `StdioServerOptions::contexts`
  serves them: a 2025 connection keeps one stack, a 2026-07-28 request names its context in
  `_meta["dev.afd/context"]` (an unknown one is `-32602`, as in Rust), `tools/list` is filtered,
  `ttlMs` is 0 and `server/discover` says how to send a context. A confirm-gated command outside
  the context is refused before anyone is asked, and `COMMAND_NOT_IN_CONTEXT` names the context
  tools.
- **The backend.** `todo_contexts()` is `src/contexts.ts`; `todo-reading` shows list, get, stats
  and history. The spec tests compare the thirteen todo commands, leaving the context tools out.

Verified locally on 2026-11-17 with Apple clang: the library's tests (278 cases, 9 new context
cases and 10 new server cases in both eras) in the dev and no-exceptions/no-RTTI builds, the
backend's 38 cases with warnings as errors, C++ conformance 41/41 in legacy, modern and auto modes,
confirmations 5/5 and approvals 4/4 in both eras, and the full `pnpm verify` on Node 26. An
independent review found no blocker; its improvements are in: the server refuses contexts that
differ from the registered ones, the registry takes the active context from the scope, three stale
spec rows, and tests for each check's order.

### C++ bootstrap commands

Merged in [#1468](https://github.com/lushly-dev/afd/pull/1468) on 2026-11-17 (`d16dc64e`): the first of three steps for
[#1451](https://github.com/lushly-dev/afd/issues/1451). The next two are the meta-tools and tool
strategies on `afd::mcp_stdio`, then the up-front approval of `afd-batch` and `afd-pipe`.

- **The library.** `afd/bootstrap.hpp` (`register_bootstrap_commands`) gives C++ `afd-help`,
  `afd-docs` and `afd-schema`, TypeScript's commands ported, `afd-schema`'s TypeScript generator
  among them. They describe the MCP-exposed commands in the active context. With all three
  registered, `server/discover` adds TypeScript's bootstrap sentence and an unknown command's
  suggestion points to `afd-help`.
- **The backend.** It registers them after the context tools, as TypeScript's `bootstrap: true`
  does, so its tool list has TypeScript's tools, one per command, until the grouped strategy.

### C++ meta-tools and strategies

Merged in [#1477](https://github.com/lushly-dev/afd/pull/1477) on 2026-11-17 (`b26a16e6`): the second step for
[#1451](https://github.com/lushly-dev/afd/issues/1451).

- **The library.** `StdioServerOptions::tool_strategy` (`individual`, `grouped` by default, `lazy`)
  and `group_by` give TypeScript's and Rust's tool lists; the five meta-tools are
  `spec/meta-tools.json`, checked field for field. Every route goes through the same exposure,
  context, confirmation and validation checks. `afd-batch` and `afd-pipe` ask once for every gated
  step, in both eras. Over MCP an unexposed command is answered as an unknown one (D4), which the
  C++ server had not done.
- **The backend.** The default grouped list: `afd-batch`, `afd-pipe`, `afd-call`, `afd-detail`,
  `todo` and `bootstrap`, as TypeScript's, with `todo-reading` narrowing `todo` to list, get,
  stats and history. That closes the C++ part of W9's tool list.

### C++ up-front approval

Merged in [#1482](https://github.com/lushly-dev/afd/pull/1482) on 2026-11-17 (`8d11828e`): the third and last step for
[#1451](https://github.com/lushly-dev/afd/issues/1451). With the MCP relay, a C++ `afd-batch` or
`afd-pipe` that needs approval asks once, before any step runs, in both eras, as TypeScript, Python
and Rust do; a gated step reading an earlier step, more than 20 gated steps or a decline runs
nothing. Every backend now approves batches and pipelines up front.

### The wider suite

On branch `t3/todo-wider-suite`, from `main` at `8d11828e`: phase 5's last item. `spec/test-cases.json`
grows from 41 to 50 cases, which every backend passes in both eras:

- **Alternatives:** a filtered `todo-list` offers the unfiltered list and the opposite state, and
  an unfiltered one offers none.
- **Ties:** equal priorities and equal titles keep insertion order in both directions.
- **Destructive hints:** through `afd-detail` everywhere, and in the tool list everywhere but
  Umbel, whose hybrid list leaves the todo commands out.
- **The tool list:** TypeScript's grouped list, which TypeScript, Rust and C++ serve. The runner
  reads `tools/list` the same way for every strategy (`toolListView`).

The Rust backend now registers its bootstrap commands after the context commands, so its
`bootstrap` group lists its actions in TypeScript's order; the case found the difference.

What the suite cannot check yet: Python's tool list. Its backend lists one tool per command, and
Python's grouped strategy lists other tools, until [#533](https://github.com/lushly-dev/afd/issues/533)
decides the alignment; `tool_list_grouped` does not run against Python.

## Open questions

None. The owner decided D1 to D3 on 2026-11-14 and D6 to D10 on 2026-11-15, and noted that the
app is a reference first: where a choice is close it leans toward making the system visible.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-14 | Phase 1 session | The `umbel` MCP server (`components-brief`) does not start in a fresh worktree until `pnpm build` and `cargo build --release -p umbel-first-party` have run; phase 3 needs it | Also needs `pnpm -F @lushly-dev/specimen build:host` for the export (2026-11-15); with the three built it serves. A session whose server failed at startup does not reconnect without `/mcp` |
| 2026-11-14 | Phase 1 review | An Umbel mounted tool cannot declare `destructive`: `MOUNT_TOOL_KEYS` (`endpoints/umbel/src/plugins/manifest.rs`) has no such key and `src/plugins/mounted/mod.rs` never sets it, so `umbel-mounted` advertises the todo deletes as not destructive. It predates this work | Fixed: a `destructive` key on `[[mount.tools]]` in #1338, set by the `todo-http` fixture in #1335 |
| 2026-11-15 | Phase 2 slice | The current frontends call `todo-clear` over MCP, where every caller counts as an agent, so their "clear completed" is held with `APPROVAL_REQUIRED` (or needs `APPROVALS=off`) until the page has an approval flow | Fixed: both pages ask through form elicitation, FAST-AF in [#1275](https://github.com/lushly-dev/afd/pull/1275), React in [#1276](https://github.com/lushly-dev/afd/pull/1276) |
| 2026-11-15 | Phase 2 CI review | `umbel.yml` runs AFD's CLI against Umbel but starts on neither `packages/client/**` nor, in its `Affected units` gate, the CLI or the example, so a client change does not run it. The gate applies only to the host jobs; the conformance job runs on every trigger, so the fix is the triggers: the CLI's own packages (`client`, `core`, `server`, `testing`) now start it | Fixed, 2026-11-15, in the Umbel trigger pull request |
| 2026-11-15 | Phase 4 page | `afd-testing`'s `src/runner/todo-example.test.ts` still expected the fixture to clear first, which #1260 turned off (`clearFirst: false`); CI never ran it, because it reads the todo example's commands and scenarios by path and the affected-units scope did not know | Fixed in [#1297](https://github.com/lushly-dev/afd/pull/1297): the expectation, and `EXTRA_INPUTS` entries in `scripts/affected/scope.mjs`; #1303 marks them `ownTests`, a new option, so only `afd-testing`'s own tests run |
| 2026-11-15 | Phase 4 review | DirectClient's `COMMAND_NOT_ALLOWED` suggestion tells a model to "Call one of the commands returned by listCommandNames()", a JavaScript method a model cannot call (`packages/client`) | Open |
| 2026-11-14 | Phase 1 session | `ruff check` with default rules reports 14 findings in each of the Python backend's command modules on `main`; CI does not lint the example | Fixed in #1319 (D8): the repository's rules found 84 across the backend; the rewrite leaves none, and `conformance.yml` and `pnpm verify` run `ruff check` and `ruff format --check` |
| 2026-11-16 | Phase 5 Python | `afd.testing` cannot be imported with only the `testing` extra: `afd/testing/__init__.py` imports `fixtures.py`, which imports `afd.transports` and so `httpx` from the `client` extra (`python/pyproject.toml`). The example lists both extras | Open |
| 2026-11-16 | Phase 5 Python | `afd.testing`'s scenario evaluator compares an expected array of objects whole (`_deep_equal` in `python/src/afd/testing/scenarios/evaluator.py`), where TypeScript's matches it item by item with matchers (`evaluateArrayAssertions` in `packages/testing/src/runner/evaluator.ts`), so job 9 fails against Python; its test is a strict `xfail` | Open |
| 2026-11-16 | Phase 5 Python | The Python library has no MCP relay for approvals (TypeScript's `relay: 'mcp-elicitation'`), so the approval suite's accept and decline cases run against TypeScript only, and a held clear cannot be approved over the Python server's MCP at all: only `APPROVALS=off`, an in-process caller with the token, a person in process or the TypeScript server can clear | Fixed in [#1442](https://github.com/lushly-dev/afd/pull/1442) ([#1312](https://github.com/lushly-dev/afd/issues/1312)): `relay="mcp-elicitation"` and the up-front approval of `afd-batch` and `afd-pipe`; see [the relay](#pythons-approval-relay) |
| 2026-11-16 | Phase 5 review | TypeScript's `SqliteStore.record()` reads the next `seq` outside its write, so two writers (TypeScript and Python, or two TypeScript servers) can take one `seq` and one history entry replaces the other; the reviewer saw 79 of 80 entries once in 5 mixed runs. Python's store reads it inside the write. Documented in both stores, the todo README and the TypeScript README | Open: [#1317](https://github.com/lushly-dev/afd/issues/1317) |
| 2026-11-16 | Phase 5 review | A shared `TODO_APPROVAL_SECRET` lets one token run the clear once on each server, since each process keeps its own nonce store (the library's in-memory default). Documented in both backends' READMEs; a shared nonce store would close it | Open |
| 2026-11-16 | Phase 5 Python | `backends/cpp/tests/commands_test.cpp` says `deleted` is TypeScript-only; the spec now names Python too (and Rust, in #1335). Left for the C++ pull request, so this one does not run the C++ suites for a comment | Fixed on the C++ parity branch: C++ takes `deleted`, and the spec marks no language |
| 2026-11-16 | Phase 5 Rust | Rust's title sort folds case with `to_lowercase` and then compares exactly, not as JavaScript's `localeCompare` (Python's `collation.py` approximates it for Latin text). Rust keeps its own in-memory store and shares no database, so no list is compared across languages; porting the collation needs NFD normalization, a new dependency | Open |
| 2026-11-16 | Phase 5 Rust | Under Umbel `todo-clear` is not held for agents: a plugin manifest declares only a fixed `approval = "required"`, and the loader refuses a definition with a per-call policy (`mismatch` in `endpoints/umbel/src/plugins/loader.rs`), so the plugin drops it and the clear is gated by its confirmation prompt alone. The description says so in every host | Open: [#1329](https://github.com/lushly-dev/afd/issues/1329) |
| 2026-11-16 | Phase 5 Rust | The conformance runner reaches the Rust backend over stdio, so asking the person over Streamable HTTP (MCP 2026-07-28) is not exercised: the backend's HTTP test checks only that a client declaring no elicitation gets `APPROVAL_REQUIRED` without a token, and Umbel's mounted run uses HTTP with `APPROVALS=off` | Open |
| 2026-11-16 | Phase 5 Rust review | Two small differences from TypeScript kept on purpose: Rust's `NOT_FOUND` errors carry `retryable: false`, which TypeScript leaves unset, and the Rust commands are also exposed to its own command line (`expose.cli`) | Kept |
| 2026-11-17 | Windows verify | The C++ backend does not build with MSVC: `main.cpp` (from #1379) calls `std::getenv`, which MSVC deprecates (C4996), and `AFD_WARNINGS_AS_ERRORS` makes that C2220, so `test:conformance:cpp` failed on Windows. No CI job built the backend with MSVC: `conformance.yml` runs it on Linux and `cpp.yml`'s MSVC legs build only the library, daily | Fixed in [#1453](https://github.com/lushly-dev/afd/pull/1453): `_dupenv_s` on MSVC, `std::getenv` elsewhere, warnings still errors; `conformance.yml`'s `todo-cpp-windows` job builds the backend and its tests with MSVC and runs them |
| 2026-11-17 | Phase 5 C++ | `afd::mcp_stdio` serves one tool per command and nothing else: no context tools, meta-tools, bootstrap commands or tool strategies, so the C++ backend declares its two contexts but cannot serve them (W2) and its tool list is not TypeScript's (W9) | Contexts (W2) fixed in [#1454](https://github.com/lushly-dev/afd/pull/1454) ([#1425](https://github.com/lushly-dev/afd/issues/1425)); the bootstrap commands in [#1468](https://github.com/lushly-dev/afd/pull/1468); the meta-tools and strategies (W9) in [#1477](https://github.com/lushly-dev/afd/pull/1477), the up-front approval in [#1482](https://github.com/lushly-dev/afd/pull/1482), and the hybrid step in [#1202](https://github.com/lushly-dev/afd/issues/1202) |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-14 | Review and phase 1 | Reviewed the examples against current AFD; wrote the proposal and this file; phase 1 written and verified locally |
| 2026-11-15 | Phase 1 merged, phase 2 jobs | Phase 1 merged in #1231. Wrote phase 2's jobs as scenarios with the drafted commands; two fresh readers walked them and the proposal records what changed; the owner decided D6 to D10 |
| 2026-11-15 | Phase 2 slice | Built undo, deleted todos, `todo-restore`, `todo-history` and the clear approval in TypeScript; jobs 1 to 5, 8 and 9 run in the backend's tests |
| 2026-11-15 | Phase 2 journal | Journal and replay (job 7), title, output and examples on every command, strict surface validation in the tests, `defaultMiddleware()`; in #1256 |
| 2026-11-15 | Phase 2 CI | Approval suite, six TypeScript-only conformance cases, `afd validate --surface --strict` and `afd scenario run` against the backend in CI, the older scenarios without a clear; in #1260 |
| 2026-11-15 | Phase 2 SQLite | The SQLite store on local-db (D4), opt-in until phase 5; every job runs on both stores; phase 2 complete but job 6; in #1263 |
| 2026-11-15 | Phase 3 page | The FAST-AF page on violet-elements with approvals in the page, the shared modules, job 6; the vanilla frontend removed; in #1275 |
| 2026-11-15 | Phase 3 React | The React page on the same elements and shared session, one browser suite for both; phase 3 done; in #1276 |
| 2026-11-15 | Phase 4 copilot | todo-directclient on the main commands, tools from `listTools()`, `allow` and job 10, `/mcp` on the same server; in #1281 |
| 2026-11-15 | Phase 4 page | The copilot page on the FAST-AF element and violet conversation elements, streamed turns, approvals through `onApprovalNeeded`, the page-hosted view (job 6); the vanilla page and `/execute` removed; in #1303 |
| 2026-11-16 | Phase 5 Python | Python at parity with TypeScript (restore, history, approvals, titles, outputs, undo), the shared SQLite store and the default moved to it in both languages, the interop run, `afd.testing` in the tests, ruff in CI; in #1319 |
| 2026-11-16 | Phase 5 Rust | Rust at parity on the library (`register_with_schema`, its tool list, stdio, bootstrap, contexts, the approval relay): restore, history, undo, titles, outputs, alternatives, TypeScript's ids and ties; the Umbel plugin regenerated and `destructive` on mounted tools; all approval cases in both eras. In #1335 |
| 2026-11-17 | Phase 5 C++ | C++ at parity on the library (restore, history, undo, titles, outputs, alternatives, TypeScript's ids and ties, the clear held for agents through the MCP relay); the spec's `implementedBy` markers removed; all approval cases in both eras. In #1426 |
| 2026-11-17 | Phase 5 Python relay | The Python library's MCP approval relay and the up-front approval of `afd-batch` and `afd-pipe` (#1312); the Python backend asks the person over MCP; every approval case runs against every backend |
| 2026-11-17 | Phase 5 C++ contexts | Contexts on `afd::mcp_stdio` and the C++ backend's two contexts (W2); the meta-tools, bootstrap commands and strategies split out to #1451 |
| 2026-11-17 | Phase 5 C++ bootstrap | C++ `afd-help`, `afd-docs` and `afd-schema` (`register_bootstrap_commands`), registered by the C++ backend; #1451 split into three steps. In #1468 |
| 2026-11-17 | Phase 5 C++ tool list | The meta-tools and the individual, grouped and lazy strategies on `afd::mcp_stdio`; the C++ backend lists TypeScript's grouped tools (W9) |
| 2026-11-17 | Phase 5 C++ up-front approval | One approval up front for C++'s `afd-batch` and `afd-pipe` over the MCP relay; #1451 done. In #1482 |
| 2026-11-17 | Phase 5 wider suite | 50 cases: alternatives, ties, destructive hints and the tool list; the Rust backend's bootstrap order |
| 2026-11-17 | C++ on MSVC | The C++ backend reads its settings without `std::getenv` on MSVC and builds there with warnings as errors; `conformance.yml` builds and tests it on Windows. In [#1453](https://github.com/lushly-dev/afd/pull/1453) |
