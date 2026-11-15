# To-do reference example

Bring the to-do examples (`packages/examples/todo` and `packages/examples/todo-directclient`) up to
AFD as it stands now, so that they show every feature a to-do app can honestly use, in all four
languages, with a frontend built on the components this repository's own apps use.

Progress is in [STATUS.md](STATUS.md). Read it first.

## Why

Apart from dependency bumps the to-do examples have not changed since September 2026. They still
show the 2025-era basics well: `CommandResult` with reasoning, confidence and alternatives,
domain batch commands, confirmations, and a 34-case conformance suite that every backend passes.
They show almost nothing added since: approvals, undo, the journal and replay, the command
context's clock, random and actor, tool strategies, the DirectClient tool surface, view-state,
`@lushly-dev/local-db`, the testing package's scenario runner and surface validation, or the
`violet-*` components. Some of what they say and do is now wrong.

The to-do app is also the cross-language parity vehicle: [Language Parity](../../../language-parity.md)
counts its suite as a parity check, the C++ backend is C++'s only MCP surface, and the Umbel
`todo` plugin is the Rust backend. An example that lags makes the parity check weaker too.

## What the review found (2026-11-14)

Verified by reading the code at `main` `9ab86ec4`; nothing was run for the review.

### Wrong today

| # | Finding | Evidence |
|---|---------|----------|
| W1 | TypeScript `todo-list` reports `total` at most 100: the count query inherits the store's default limit. Python, Rust and C++ count every match. The suite has no case above 100 | `backends/typescript/src/store/memory.ts:111`, `store/file.ts:190`, `commands/list.ts` |
| W2 | Commands declare `contexts`, but neither the TypeScript nor the Python server passes the `contexts` option, so the `afd-context-*` tools never appear | `backends/typescript/src/server-options.ts`, `backends/python/src/todo_backend/server.py` |
| W3 | `todo-delete` and `todo-delete-batch` carry a `destructive` tag but not `destructive: true` in TypeScript, Python and Rust; C++ sets it. `destructiveHint` differs by backend | `commands/delete.ts`, `delete-batch.ts`; `commands.py`; `rust/src/commands/mod.rs`; `cpp/src/commands.cpp:310,490` |
| W4 | The C++ `todo-clear` has no `confirm_prompt`, so C++ has no confirmation gate | `cpp/src/commands.cpp:313-340` |
| W5 | The frontends POST JSON-RPC to the deprecated `/message` lane (removed in 3.0) and read `content[0].text` instead of the structured result; the server prints `afd connect …/sse` | `frontends/react/src/api.ts:10`, `frontends/vanilla/app.js:702`, `backends/typescript/src/server.ts:10,62` |
| W6 | README errors: the batch tool is called `afd.batch` (it is `afd-batch`); "all three backends" (there are four); a streaming section that promises progress chunks `/stream` never sends and import paths (`afd-core/batch`, `afd-core/streaming`) that do not exist; "server runs at :3100" while `TRANSPORT=auto` speaks stdio without a terminal | `todo/README.md`, `backends/typescript/README.md:12` |
| W7 | Small defects: `todo-clear` logs its raw input from the handler; the React client's `FETCH_ERROR` has no `suggestion`; the vanilla app renders with `innerHTML`; todo-directclient states two latencies (~0.03ms and ~0.003ms) and calls its server an "experiment" | `commands/clear.ts:35-38`, `react/src/api.ts:39`, `vanilla/app.js`, `todo-directclient/README.md:7`, `backend/src/chat.ts:7`, `backend/src/server.ts:56` |
| W8 | todo-directclient keeps its own copy of 8 of the 11 commands, which has drifted; it hand-writes Gemini schemas with `required: []`; it sets no `allow`, so the model can run `todo-clear` | `todo-directclient/backend/src/commands/`, `backend/src/chat.ts:278-290` |
| W9 | Cross-backend drift the suite does not catch: Rust returns no `alternatives`; descending-order ties and title ordering differ (Rust reverses ties, each language folds case its own way); ID formats differ; the default tool lists differ in strategy and in whether bootstrap tools and meta-tools appear | `rust/src/store.rs:128-135`; the four stores |

### Not shown anywhere in the examples

Approvals (`approval:`, `createApprovalMiddleware`, `onApprovalNeeded`); undo metadata
(`undoable`, `undoCommand`, `undoArgs`); the journal and `afd replay`; `context.clock`,
`context.random` and `context.actor` (IDs and times come from `Date.now()` and `Math.random()`);
`examples` and `title` on commands; `output` on every command (8 of 11 TypeScript commands lack
one); `defaultMiddleware()`; the hybrid tool strategy; `createDirectToolSurface` with `listTools()`
and `allow`; `@lushly-dev/afd-view-state`; `@lushly-dev/local-db`; the `afd-testing` scenario
runner and `validateCommandSurface` against the TypeScript backend; the streamable-HTTP client in a
browser.

### A correction to the brief

Violet is the design-token platform (`violet-core`, `violet-runtime`), and `violet-afd` is the
command layer for those tokens; none is a UI library. The `violet-*` web components are
`@lushly-dev/violet-elements` in FAST-AF. `endpoints/health-dashboard` and Loam's tasks app
(`endpoints/loam/apps/tasks`) are the patterns to follow. The examples need `violet-elements` and
`fast-element`, not `violet-afd`.

## What the to-do app owns, and what it leaves

The to-do app owns what a to-do app would use for real: complete command metadata, approvals on
the destructive commands, undo, the deterministic context with the journal and replay, contexts
(reading and editing), view-state for the UI, local-db storage, jobs written as scenarios and run
in CI, a browser client on the current transport, and DirectClient with the tool surface.

It leaves handoff to `examples/chat`, sign-in and surface-validation demonstrations to
`examples/showcase`, and defers MCP authorization, output budgets (not in TypeScript yet) and
tasks. Pipelines stay in showcase; one to-do pipeline scenario is cheap and is in scope.

**A reference first, a to-do app second** (owner, 2026-11-15). The app exists to show how AFD
works, so where a choice is close it leans toward making the system visible: results say what
they did, why and how to undo it, metadata is complete, and changes are recorded where a person
or agent can read them. Some choices are not what a shipping to-do app would make, and that is
accepted when they show AFD more clearly.

## Decisions

The owner asked on 2026-11-14 to save this proposal and start the work, and answered the review's
three questions the same day: keep a React frontend (D1), bring the other languages along (D2) and
make deletes undoable (D3).

| # | Decision | Taken | Depends on it |
|---|----------|-------|---------------|
| D1 | Two frontends on `violet-elements`: a FAST-AF page following `health-dashboard`, and the React frontend rebuilt on the same elements, which React 19 renders directly, for React developers. The vanilla frontend retires | Owner, 2026-11-14 (the review recommended FAST-AF only; the owner kept React) | Phase 3 |
| D2 | Python, Rust and C++ get the new behaviour in this effort, one pull request per language after the TypeScript reference; C++'s MCP work waits on `afd::mcp_stdio` ([#341](https://github.com/lushly-dev/afd/issues/341)) | Owner, 2026-11-14 | Phase 5 |
| D3 | Deleting a todo can be undone, through a new `todo-restore` command in all four languages and the Umbel plugin | Owner, 2026-11-14 | Phases 2 and 5 |
| D4 | The TypeScript store moves onto `@lushly-dev/local-db`'s SQLite adapter; the Python backend reads the same database through the standard library's `sqlite3`, which keeps the shared-data story without a JSON file store in each language | Settled in this proposal | Phase 2 |
| D5 | todo-directclient imports the main example's commands instead of keeping its own copy | Settled in this proposal | Phase 4 |
| D6 | Approval holds only `todo-clear`, the one change with no undo, for any caller that is not a person; deletes are undoable instead of held | Owner, 2026-11-15 | Phase 2 |
| D7 | A deleted todo is kept, findable with `todo-list { deleted: true }`, until `todo-clear { deleted: true }` or `{ all: true }` empties them; nothing purges on a timer | Owner, 2026-11-15 | Phase 2 |
| D9 | A `todo-history` command shows recent changes with their actor and undo (job 9) | Owner, 2026-11-15 | Phase 2 |
| D10 | Phase 2's first slice is jobs 1, 3, 4 and 9 (tagged `slice`): undo a completion, undo a delete, clearing waits for a person, and history with undo; jobs 2, 5, 7 and 8 follow in phase 2, and job 6 in phases 3 and 4 | Owner, 2026-11-15 | Phase 2 |
| D8 | Python lint findings and a lint step for the example go in phase 5's Python pull request | Owner, 2026-11-15 | Phase 5 |

## Plan

Each phase is one or more pull requests. A phase that changes the Rust command surface also
regenerates the Umbel `todo` plugin's manifest and schemas and passes `umbel.yml`, because
`endpoints/umbel/plugins/todo/tests/todo.rs` pins the plugin to the backend.

### Phase 1: fix what is wrong

No new commands. W1 to W4, W6, and the backend half of W5 and W7.

- W1: count every match in the TypeScript store; add a conformance case with more than 100 todos.
- W2: configure `contexts` (`todo-reading`, `todo-editing`) on the TypeScript and Python servers.
- W3: `destructive: true` on `todo-delete` and `todo-delete-batch` in TypeScript, Python and Rust;
  regenerate the Umbel plugin assets if they carry it.
- W4: `confirm_prompt` declared on the C++ `todo-clear`. The C++ stdio loop does not enforce
  confirmations, so enforcement moves to phase 5 with `afd::mcp_stdio`.
- Each command's `mutation`, `destructive`, `contexts` and `confirmPrompt` recorded in
  `spec/commands.schema.json`, and checked by every backend's tests, so the declarations cannot
  drift again.
- W5 (backend): `/mcp` in the server's startup text and comments.
- W6: correct the READMEs.
- W7 (backend): remove the handler's debug logging.

The frontends' half of W5 and W7 is phase 3, which replaces them.

### Phase 2: the TypeScript reference

Jobs first: write the jobs the new behaviour serves as scenarios in `scenarios/`
before the commands change ([Phase 2 jobs](#phase-2-jobs)). Then:

- Every command gets `output`, `examples`, `title`, accurate `destructive`, `undoable` where it is
  reversible, shared `ErrorCodes`, and an `approval` policy on each mutation.
- `todo-restore` (D3), `todo-list { deleted: true }` (D7) and `todo-history` (D9).
- `context.clock`, `context.random` and `context.actor` in the handlers; `createJournalMiddleware`
  and a replay walk-through.
- `defaultMiddleware()` in place of the hand-built logging.
- Storage on `@lushly-dev/local-db` (D4).
- CI runs `afd scenario run` and `afd validate --surface --strict` against the TypeScript backend.
- Conformance cases for each new behaviour that every language must share.

#### Phase 2 jobs

Written as scenario files on 2026-11-15, before any command changes, and revised after two readers
walked them (below). Each job moves beside the backend once it is built
([`backends/typescript/scenarios/`](../../../../packages/examples/todo/backends/typescript/scenarios/),
run by `src/scenarios.test.ts`); until then it waits, checked but not run, in
[`scenarios/`](scenarios/). Jobs 1 to 5 and 7 to 9 are built; job 6 waits for the page.

| # | Job | File | Tags |
|---|-----|------|------|
| 1 | Undo a completion, single or batch: take a mistaken "done" back in one step | [01](../../../../packages/examples/todo/backends/typescript/scenarios/01-undo-a-completion.scenario.yaml) | `slice`, `undo` |
| 2 | Undo an edit: put back what a todo said before | [02](../../../../packages/examples/todo/backends/typescript/scenarios/02-undo-an-edit.scenario.yaml) | `undo` |
| 3 | Undo a delete, single or batch; an id never deleted is reported, not restored | [03](../../../../packages/examples/todo/backends/typescript/scenarios/03-undo-a-delete.scenario.yaml) | `slice`, `undo` |
| 4 | Clearing, the one change with no way back, waits for a person when an agent asks | [04](../../../../packages/examples/todo/backends/typescript/scenarios/04-clear-waits-for-approval.scenario.yaml) | `slice`, `approval` |
| 5 | An agent asked only to review is offered only the reading commands | [05](../../../../packages/examples/todo/backends/typescript/scenarios/05-review-without-changing.scenario.yaml) | `contexts` |
| 6 | An agent narrows the view on screen instead of copying the list into the chat | [06](scenarios/06-narrow-the-view.scenario.yaml) | `view` |
| 7 | A developer turns an agent session's journal into a regression test | [07](../../../../packages/examples/todo/backends/typescript/scenarios/07-replay-a-session.scenario.yaml) | `journal`, `deterministic`, `developer` |
| 8 | Find a deleted todo long after the delete and bring it back | [08](../../../../packages/examples/todo/backends/typescript/scenarios/08-find-a-deleted-todo.scenario.yaml) | `undo` |
| 9 | See what changed, who changed it, and undo it from there | [09](../../../../packages/examples/todo/backends/typescript/scenarios/09-see-what-changed.scenario.yaml) | `slice`, `undo`, `history` |

Keeping an agent from changing anything at all is a phase 4 job, served by DirectClient's
`allow`: contexts narrow what an agent is offered and are not a security boundary
(`packages/server/README.md`, "Contexts").

#### Phase 2 drafted commands

Only what changes. Every command also gains `output`, `examples` and `title`, and every mutation
an `approval` policy. `destructive` stays as phase 1 set it: an undoable delete still deletes, and
the shared `spec/commands.schema.json` metadata does not change in phase 2.

| Command | Change | Undo (`undoCommand`, `undoArgs`) | Approval |
|---------|--------|----------------------------------|----------|
| `todo-create` | `id` from `context.random`, `createdAt` from `context.clock`; `undoable` | `todo-delete`, `{ id }` | `not-required` |
| `todo-create-batch` | As `todo-create` | `todo-delete-batch`, `{ ids }` | `not-required` |
| `todo-get`, `todo-update`, `todo-toggle`, `todo-delete` | `NOT_FOUND` for a deleted todo, suggesting `todo-list { deleted: true }` and `todo-restore`; the batch commands report a deleted id as `failed` with the same error | | |
| `todo-list` | Leaves deleted todos out; new `deleted: true` lists only them; a deleted todo carries `deletedAt`, and `sortBy` gains `deletedAt` | | |
| `todo-stats` | Leaves deleted todos out | | |
| `todo-update` | `undoable` | `todo-update`, `{ id, <previous value of each changed field> }`; an empty description comes back as `""`, which the store treats as none | `not-required` |
| `todo-toggle` | `undoable`; reopening clears `completedAt` | `todo-update`, `{ id, completed: <previous> }`, so undoing twice is harmless; undoing a reopen stamps a new `completedAt` | `not-required` |
| `todo-toggle-batch` | `undoable` when `completed` is given and something changed | `todo-toggle-batch`, `{ ids: <those it changed>, completed: <their previous value> }`; none when nothing changed; a plain toggle of mixed states has no single undo, and its result warns so | `not-required` |
| `todo-delete` | Keeps the todo, out of every list but `deleted: true`, until `todo-clear { deleted: true }` or `{ all: true }`; `undoable`; the "cannot be undone" warning goes | `todo-restore`, `{ ids: [id] }` | `not-required`: it can be undone |
| `todo-delete-batch` | As `todo-delete` | `todo-restore`, `{ ids: <deletedIds> }` | `not-required` |
| `todo-restore` (new, D3) | `{ ids }` (1 to 100) to `{ restoredIds, failed, summary }`, like `todo-delete-batch`: an id not restored is a `failed` entry whose error is `NOT_FOUND`, suggesting `todo-list { deleted: true }`; `mutation`, context `todo-editing`, `undoable` | `todo-delete-batch`, `{ ids: <restoredIds> }` | `not-required` |
| `todo-history` (new) | `{ limit?, offset?, actor?: <actor kind>, todoId? }` to `{ entries: [{ at, actor, command, ids, undoCommand?, undoArgs? }], total, hasMore }`, newest first, from a change log the app keeps in its store from each mutation's result, the latest 1,000 changes; an entry offers its undo only while it is the latest change to each of its todos, so undoing an old entry never overwrites a later edit; context `todo-reading` | | |
| `todo-clear` | `{}` removes completed todos for good, as now; new `{ deleted: true }` empties the deleted todos; `{ all: true }` removes every todo, deleted ones included; keeps `destructive` and `confirmPrompt` | None | `required` unless `context.actor.kind` is `human`; the approval's `summarize` says what goes and how many ("Remove 3 completed todos for good") |
| `view-state-get`, `view-state-set` | From `@lushly-dev/afd-view-state`, hosted by the page (phases 3 and 4), with one view, `todo-filter`: `{ status, priority, search }`, with `replace` support | `view-state-set` with `previous` and `replace: true` | |

The server adds `createApprovalMiddleware` with `relay: 'mcp-elicitation'`, so a stdio client or a
modern `/mcp` client that declares form elicitation asks its person, and a held clear is reachable
from those before phase 3's page exists. A 2025 HTTP client, and a clear inside `afd-batch` or
`afd-pipe`, get `APPROVAL_REQUIRED` with no token. `APPROVALS` (`agents` by default, or `off`)
switches the hold, as `CONFIRMATIONS` switches confirmations. It adds `createJournalMiddleware` for each session; and `defaultMiddleware()` in place of the
hand-built logging. The hybrid tool strategy is dropped: a first-class command that declares
contexts draws a warning, which `afd validate --surface --strict` fails.

`undoCommand` names a command, not a tool. Under the default `grouped` strategy the tool is
`todo` with an `action`, so the commands' descriptions and the README say to run an undo through
`afd-call` (or the group tool) with `undoArgs` as its input.

**Conformance.** The suites reset each case with `todo-clear { all: true }`, two cases in
`spec/test-cases.json` expect a clear to succeed, and the confirmation suite
(`spec/confirmation-cases.json`, run in both modes in CI) exercises `todo-clear`'s confirmation
with clients that accept, decline or declare no elicitation. Every one of those would be held,
since an MCP caller's default actor is `agent`. They test the shared contract that Python, Rust
and C++ meet without approvals until phase 5, so they run with `APPROVALS=off`, exactly as they
set `CONFIRMATIONS`. A new `spec/approval-cases.json` suite runs with `APPROVALS=agents`: a clear
held with its suggestion, a client that declares form elicitation and answers `approve: true` (the
approval field, which the runner's current `confirm: true` handler does not set), one that
declines, and a clear inside `afd-batch`. It runs against TypeScript in phase 2 and every language
in phase 5. The four scenarios in `packages/examples/todo/scenarios/` and the testing package's
`todo` fixture adapter (`clearFirst`) also start by clearing: phase 2 rewrites the four so they
need no clear, and the new jobs use titles of their own instead of an empty store.

#### What writing and walking the jobs changed

Writing them:

- **Undo of a completion is `todo-update`, not `todo-toggle`.** Toggling again is undo only if
  nothing toggled in between; setting the previous value is safe to repeat.
- **A delete keeps the todo.** Otherwise `todo-restore` would need the whole todo as input, which
  the agent would have to read and send back. Keeping it lets `undoArgs` be just the ids.
- **Approval only where there is no way back.** Once deletes can be undone, holding them would
  interrupt the person for a change that costs nothing to reverse. Only `todo-clear` is held (D6).
- **The view job runs against the page, not the backend**, since view state is the page's; exit
  criterion 1 leaves the `view` scenarios to phases 3 and 4.

One fresh reader (Opus 5.5, `high`) walked them on 2026-11-15 from all three seats: the job list,
the person, and the calling agent against the TypeScript server's code. What that changed:

- **Job 5 promised what contexts cannot give.** On `/mcp` (MCP 2026-07-28) a context is per-request
  `_meta`, `afd-context-enter` stores nothing, and contexts are not a security boundary. The job is
  now "offered only the reading commands", out of the slice and run in-process; "cannot change
  anything" moves to phase 4's `allow`.
- **A deleted todo could not be found again** once the delete's result was gone: `todo-list
  { deleted: true }` and job 8 added.
- **Holding `todo-clear` would have broken the conformance suite** and left clear unreachable over
  MCP until phase 3: the elicitation relay and the conformance client's approval above.
- **Job 7 was a developer's job presented as the person's**, and replay starts from a fresh store,
  so it cannot show what happened to a real list. It is now the developer's regression-test job,
  and job 9 with `todo-history` gives the person "what changed, who did it, and the undo".
- **Bulk mistakes had no undo:** `todo-create(-batch)` and `todo-toggle-batch` now declare one.
- **`todo-restore` matched the other batch commands**, reporting unrestored ids as `failed`
  instead of failing the call; its `undoArgs` use the ids actually deleted or restored.
- **The hybrid strategy conflicted with the strict gate**, and was dropped.
- **Corrections to the limits below:** a whole-string reference keeps its type (job 6 now passes
  `previous` whole with `replace`), and steps over `--server` run as `agent`, not `test`.
- **Jobs 1 and 3 now check their whole "so that"**: `completedAt` cleared, and both batch-restored
  todos read back.

A second fresh reader (Opus 5.5, `high`) walked what the first walk added. What that changed:

- **The conformance plan would have broken the confirmation suite**, and the runner's elicitation
  handler answers `confirm`, not `approve`: replaced by `APPROVALS=off` for the shared suites and a
  new approval suite.
- **`todo-clear {}` would have purged deleted todos** whenever someone cleared completed ones, so a
  routine clear ended job 8's promise: purging is now its own `{ deleted: true }`, and the
  approval names what goes and how many.
- **Jobs 8 and 9 could pass while missing their point**: job 8 now reads the original id back and
  lists newest deletion first, and job 9 asserts the entry's command, actor, time and undo and
  reads the changed todo back.
- **History needed paging, filters and a limit**, and undoing an old entry could overwrite a later
  edit: `offset`, `actor`, `todoId`, `total`, the latest 1,000 changes, and undo only on a todo's
  latest change.
- **Deleted todos needed `deletedAt`** and a defined `NOT_FOUND` from every command, and
  `todo-toggle-batch` no undo when nothing changed.

Declined: purging a single deleted todo (no job needs it; `{ deleted: true }` empties them all),
and grouping a plain mixed `todo-toggle-batch` into two undo calls (one undo per result is the
contract; the result warns instead). The first reader's estimate of a 6,000 to 9,000-token tool list per session is not
measured; phase 2 measures it with `afd tools` once the metadata is added.

#### What a scenario cannot show here

- `undoCommand` is outside `expect`, so a step names the undo command itself; and a step's
  `input` must be an object, so steps pass `undoArgs` fields (or `ids`) by name where an agent
  passes the whole object.
- No step can set `context.approval`, so job 4 shows the hold; a person approving and the retry
  are in the backend's tests.
- `afd replay` is a CLI step, not a command: job 7 is the session, and a backend test replays its
  journal. Its fixed clock and seeded random need the in-process runner; `afd scenario run
  --server` can set neither.
- `afd scenario run` sends no `_meta`, so job 5 runs in-process with an active context.
- One scenario runs as one actor, so job 9 cannot show an agent's change beside a person's; the
  backend's tests filter `todo-history` by actor. The clock cannot move, so job 8 shows "long
  after" only as not having the delete's result to hand.
- **Open for phase 3:** with no sign-in, the server cannot tell the person at the page from an
  agent, so the page's own `todo-clear` is held too. How the page records a person's approval and
  retries is phase 3's design.

### Phase 3: the Violet frontend

A FAST-AF page on `fast-element` and `violet-elements`, and the React frontend rebuilt on the same
elements (D1), both talking to the backend through
`@lushly-dev/afd-client/streamable-http` on `/mcp`. Call `components-brief` (the `umbel` server in
`.mcp.json`) before the markup. It replaces the hand-built components:

| Today | With `violet-elements` |
|-------|------------------------|
| Toast | `violet-snackbar`, with an undo action from `undoCommand` |
| ConfirmModal | `violet-approval-card` or `violet-dialog`, driven by the command's approval and confirmation metadata |
| ErrorRecovery | `violet-alert` with the error's `suggestion` and a retry action |
| CommandLog | `violet-tool-call-card` and `violet-tool-result-card` |
| TrustPanel | `violet-progress` (confidence), `violet-badge`, `violet-source-citation`, `violet-accordion` |
| Form, item, filter, empty list | `violet-text-field`, `violet-checkbox`, `violet-segmented-control`, `violet-empty-state` |

The filter and selection become view-state. The trust panel, command log and approval handling are
written once as plain modules both frontends use, so the two differ only in how they render. The
vanilla frontend is removed.

### Phase 4: DirectClient

todo-directclient imports the main commands (D5), builds its model tools with
`createDirectToolSurface` and `listTools()`, limits them with `allow`, asks for approval with
`onApprovalNeeded` rendered as a `violet-approval-card`, hosts the view-state commands so the
copilot can change the view, and gets a `package.json` and Vite build so its page shares phase 3's
components.

### Phase 5: the other languages

One pull request each, against the phase 2 conformance cases (D2).

- Python: `title`, `output_schema`, contexts, approvals, `todo-restore`, `afd.testing` in its tests,
  the shared SQLite store.
- Rust: `register_with_schema` in place of its own validator, the library's tool list instead of
  the override, stdio, bootstrap commands, a declared output shape, `alternatives`, contexts,
  approvals, `todo-restore`; the Umbel plugin regenerated.
- C++: `confirm_prompt` and the rest once `afd::mcp_stdio` exists.
- The suite widens to alternatives, ordering ties, `destructive` hints and the tool list.

## Exit criteria

1. Every scenario in `scenarios/` passes against the TypeScript backend in CI: those tagged
   `deterministic` or `contexts` in-process, the rest also through `afd scenario run --server`.
   Those tagged `view` pass against the page's host in phases 3 and 4. A first slice is the
   scenarios tagged `slice`.
2. Every case in `spec/test-cases.json` and `spec/confirmation-cases.json`, including the new ones,
   passes against all four backends and both Umbel modes, except cases a language cannot yet run,
   each named in [STATUS.md](STATUS.md) with its blocker.
3. No finding W1 to W9 stands.
4. Both to-do frontends use `violet-elements` and the current transport; the vanilla frontend is
   gone.
5. todo-directclient runs the main commands through the DirectClient tool surface with `allow` and
   approvals.
6. The READMEs describe what the code does, checked by running each documented command once.
