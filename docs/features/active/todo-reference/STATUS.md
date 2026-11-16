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
  suite by suite (see [phase 5](#python)).
- **Done:** phase 1, merged in [#1231](https://github.com/lushly-dev/afd/pull/1231) on 2026-11-15 (`176c7471`). Phase 2, in the
  TypeScript backend: jobs in #1248, undo, restore, history and the clear approval in #1251, the
  journal and full metadata in #1256, CI and conformance in #1260, SQLite storage in #1263, all
  2026-11-15. The parts they left open belong to later phases, as the findings table says.
- **Done:** phase 4, DirectClient: the main commands through the tool surface with `allow` in
  [#1281](https://github.com/lushly-dev/afd/pull/1281), and the page with approvals and view state in
  [#1303](https://github.com/lushly-dev/afd/pull/1303), both 2026-11-15.
- **In progress:** phase 5. Python is merged in [#1319](https://github.com/lushly-dev/afd/pull/1319) on 2026-11-16: Python at parity with
  TypeScript, and both backends on one SQLite database by default (D4). Rust and C++ are not
  started.

## Plan

| Phase | State | Evidence | Next gate |
| --- | --- | --- | --- |
| 1. Fix what is wrong | Done: W1, W2 (TypeScript, Python), W3, W4 (declared), W6 and the backend half of W5 and W7, merged in [#1231](https://github.com/lushly-dev/afd/pull/1231) | See [phase 1](#phase-1-fix-what-is-wrong) | None |
| 2. The TypeScript reference | Done; job 6 runs on the page in phase 3 and through the copilot in phase 4: #1248, #1251, #1256, #1260 and #1263 | See [phase 2](#phase-2-the-typescript-reference) | None |
| 3. The Violet frontend | Done: the FAST-AF page in [#1275](https://github.com/lushly-dev/afd/pull/1275), the React page in [#1276](https://github.com/lushly-dev/afd/pull/1276) | See [phase 3](#phase-3-the-violet-frontend) | None |
| 4. DirectClient | Done: the copilot on the main commands, the tool surface and `allow` (job 10) in [#1281](https://github.com/lushly-dev/afd/pull/1281); the page, with approvals through `onApprovalNeeded` and the page-hosted view (job 6), in [#1303](https://github.com/lushly-dev/afd/pull/1303) | See [phase 4](#phase-4-directclient) | None |
| 5. The other languages | In progress: Python in [#1319](https://github.com/lushly-dev/afd/pull/1319); Rust and C++ not started | See [phase 5](#phase-5-the-other-languages) | Rust, and C++ after [#341](https://github.com/lushly-dev/afd/issues/341) |

## Findings

| Finding | State |
| --- | --- |
| W1 `total` capped at 100 in TypeScript | Fixed in [#1231](https://github.com/lushly-dev/afd/pull/1231) |
| W2 contexts declared but not served | TypeScript and Python fixed in [#1231](https://github.com/lushly-dev/afd/pull/1231); Python's `todo-history` and `todo-restore` take their contexts on the phase 5 branch. C++ declares them but serves no context tools (its own stdio loop, phase 5). Rust declares none (phase 5) |
| W3 deletes not marked destructive | Fixed in [#1231](https://github.com/lushly-dev/afd/pull/1231) in TypeScript, Python and Rust (C++ already was), and in the Umbel `todo` plugin's compiled manifest. Under `umbel-mounted` the deletes still advertise `destructiveHint: false`, because a mounted tool cannot declare `destructive` (see follow-ups) |
| W4 no confirmation gate in C++ | Prompt declared in [#1231](https://github.com/lushly-dev/afd/pull/1231); enforcement open, phase 5 with `afd::mcp_stdio` |
| W5 deprecated `/message` and `/sse` | Backend text fixed in [#1231](https://github.com/lushly-dev/afd/pull/1231); the frontends still use `/message` until phase 3 replaces them |
| W6 README errors | Fixed in [#1231](https://github.com/lushly-dev/afd/pull/1231) |
| W7 small defects | `todo-clear`'s debug logging removed in [#1231](https://github.com/lushly-dev/afd/pull/1231). The React `FETCH_ERROR` and vanilla `innerHTML` went with the old frontends in phase 3. todo-directclient's two latencies and "experiment" are gone in [#1281](https://github.com/lushly-dev/afd/pull/1281): `pnpm benchmark` measures both paths and the README states no numbers |
| W8 todo-directclient's copied commands and hand-written tools | Fixed in [#1281](https://github.com/lushly-dev/afd/pull/1281): the main commands (D5), tools from `listTools()`, and `allow` in look mode |
| W9 cross-backend drift outside the suite | Destructive flags and contexts now checked by every backend's tests against `spec/commands.schema.json` (Rust without contexts). On the phase 5 Python branch: TypeScript and Python answer each read `pnpm test:interop` makes alike on one database, order (an accented, mixed-case title sort among them) and alternatives included, and describe every command alike in `afd-detail` (title, description, category, tags, mutation); Python makes ids in TypeScript's format from the context's random. Title order follows JavaScript's `localeCompare` for Latin text, digits and ASCII punctuation (`collation.py`), not every script. Rust and C++ ordering ties, ID formats and tool lists open, phase 5 |

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
  approval suite's two `acknowledge` cases now name Python; `accept` and `decline` stay
  TypeScript's until the library can ask over MCP
  ([#1312](https://github.com/lushly-dev/afd/issues/1312)). The runner now skips a client kind
  with no case for the language, and still fails a suite that leaves it none. **Until #1312, a
  held clear cannot be approved over the Python server's MCP:** no MCP call carries the token, so
  the retry is held again. `APPROVALS` stays `agents` by default (parity, and safe); a clear runs
  with `APPROVALS=off`, from trusted in-process code that retries with the token, from a person in
  process, or through the TypeScript server on the same database. Each server keeps its own spent
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

## Open questions

None. The owner decided D1 to D3 on 2026-11-14 and D6 to D10 on 2026-11-15, and noted that the
app is a reference first: where a choice is close it leans toward making the system visible.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-14 | Phase 1 session | The `umbel` MCP server (`components-brief`) does not start in a fresh worktree until `pnpm build` and `cargo build --release -p umbel-first-party` have run; phase 3 needs it | Also needs `pnpm -F @lushly-dev/specimen build:host` for the export (2026-11-15); with the three built it serves. A session whose server failed at startup does not reconnect without `/mcp` |
| 2026-11-14 | Phase 1 review | An Umbel mounted tool cannot declare `destructive`: `MOUNT_TOOL_KEYS` (`endpoints/umbel/src/plugins/manifest.rs`) has no such key and `src/plugins/mounted/mod.rs` never sets it, so `umbel-mounted` advertises the todo deletes as not destructive. It predates this work | Open, phase 5 |
| 2026-11-15 | Phase 2 slice | The current frontends call `todo-clear` over MCP, where every caller counts as an agent, so their "clear completed" is held with `APPROVAL_REQUIRED` (or needs `APPROVALS=off`) until the page has an approval flow | Fixed: both pages ask through form elicitation, FAST-AF in [#1275](https://github.com/lushly-dev/afd/pull/1275), React in [#1276](https://github.com/lushly-dev/afd/pull/1276) |
| 2026-11-15 | Phase 2 CI review | `umbel.yml` runs AFD's CLI against Umbel but starts on neither `packages/client/**` nor, in its `Affected units` gate, the CLI or the example, so a client change does not run it. The gate applies only to the host jobs; the conformance job runs on every trigger, so the fix is the triggers: the CLI's own packages (`client`, `core`, `server`, `testing`) now start it | Fixed, 2026-11-15, in the Umbel trigger pull request |
| 2026-11-15 | Phase 4 page | `afd-testing`'s `src/runner/todo-example.test.ts` still expected the fixture to clear first, which #1260 turned off (`clearFirst: false`); CI never ran it, because it reads the todo example's commands and scenarios by path and the affected-units scope did not know | Fixed in [#1297](https://github.com/lushly-dev/afd/pull/1297): the expectation, and `EXTRA_INPUTS` entries in `scripts/affected/scope.mjs`; #1303 marks them `ownTests`, a new option, so only `afd-testing`'s own tests run |
| 2026-11-15 | Phase 4 review | DirectClient's `COMMAND_NOT_ALLOWED` suggestion tells a model to "Call one of the commands returned by listCommandNames()", a JavaScript method a model cannot call (`packages/client`) | Open |
| 2026-11-14 | Phase 1 session | `ruff check` with default rules reports 14 findings in each of the Python backend's command modules on `main`; CI does not lint the example | Fixed in #1319 (D8): the repository's rules found 84 across the backend; the rewrite leaves none, and `conformance.yml` and `pnpm verify` run `ruff check` and `ruff format --check` |
| 2026-11-16 | Phase 5 Python | `afd.testing` cannot be imported with only the `testing` extra: `afd/testing/__init__.py` imports `fixtures.py`, which imports `afd.transports` and so `httpx` from the `client` extra (`python/pyproject.toml`). The example lists both extras | Open |
| 2026-11-16 | Phase 5 Python | `afd.testing`'s scenario evaluator compares an expected array of objects whole (`_deep_equal` in `python/src/afd/testing/scenarios/evaluator.py`), where TypeScript's matches it item by item with matchers (`evaluateArrayAssertions` in `packages/testing/src/runner/evaluator.ts`), so job 9 fails against Python; its test is a strict `xfail` | Open |
| 2026-11-16 | Phase 5 Python | The Python library has no MCP relay for approvals (TypeScript's `relay: 'mcp-elicitation'`), so the approval suite's accept and decline cases run against TypeScript only, and a held clear cannot be approved over the Python server's MCP at all: only `APPROVALS=off`, an in-process caller with the token, a person in process or the TypeScript server can clear | Open: [#1312](https://github.com/lushly-dev/afd/issues/1312) |
| 2026-11-16 | Phase 5 review | TypeScript's `SqliteStore.record()` reads the next `seq` outside its write, so two writers (TypeScript and Python, or two TypeScript servers) can take one `seq` and one history entry replaces the other; the reviewer saw 79 of 80 entries once in 5 mixed runs. Python's store reads it inside the write. Documented in both stores, the todo README and the TypeScript README | Open: [#1317](https://github.com/lushly-dev/afd/issues/1317) |
| 2026-11-16 | Phase 5 review | A shared `TODO_APPROVAL_SECRET` lets one token run the clear once on each server, since each process keeps its own nonce store (the library's in-memory default). Documented in both backends' READMEs; a shared nonce store would close it | Open |
| 2026-11-16 | Phase 5 Python | `backends/cpp/tests/commands_test.cpp` says `deleted` is TypeScript-only; the spec now names Python too. Left for the C++ pull request, so this one does not run the C++ suites for a comment | Open, phase 5's C++ pull request |

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
