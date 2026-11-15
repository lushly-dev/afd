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
before the commands change (undo a completion, undo a delete, a destructive command waits for
approval, replay a session from its journal, an agent narrows the view, an agent reviews the
todos without being able to change them). Then:

- Every command gets `output`, `examples`, `title`, accurate `destructive`, `undoable` where it is
  reversible, shared `ErrorCodes`, and an `approval` policy on each mutation.
- `todo-restore` (D3).
- `context.clock`, `context.random` and `context.actor` in the handlers; `createJournalMiddleware`
  and a replay walk-through.
- `defaultMiddleware()` in place of the hand-built logging.
- Storage on `@lushly-dev/local-db` (D4).
- Optionally the hybrid strategy with `todo-list` and `todo-create` first-class.
- CI runs `afd scenario run` and `afd validate --surface --strict` against the TypeScript backend.
- Conformance cases for each new behaviour that every language must share.

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

1. Every scenario in `scenarios/` passes against the TypeScript backend in CI.
2. Every case in `spec/test-cases.json` and `spec/confirmation-cases.json`, including the new ones,
   passes against all four backends and both Umbel modes, except cases a language cannot yet run,
   each named in [STATUS.md](STATUS.md) with its blocker.
3. No finding W1 to W9 stands.
4. Both to-do frontends use `violet-elements` and the current transport; the vanilla frontend is
   gone.
5. todo-directclient runs the main commands through the DirectClient tool surface with `allow` and
   approvals.
6. The READMEs describe what the code does, checked by running each documented command once.
