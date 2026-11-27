# Todo Example Specification

This directory contains the shared API contract for the Todo example. All four backend implementations (TypeScript, Python, Rust and C++) must follow this specification to ensure interoperability with both frontends (FAST-AF and React).

## Files

- `commands.schema.json`: JSON Schema defining the input and output for all 13 commands,
  keyed by MCP tool name, and each command's `metadata`: `mutation`, `destructive`, `contexts`
  and, on `todo-clear`, `confirmPrompt`. The test suites of all four backends fail if it does not
  list exactly the commands their backend defines with that metadata; the C++ backend also
  checks that each input schema it declares is the contract's, descriptions aside. Every backend
  implements all 13 commands. A command with `implementedBy`, or an input property with
  `x-implementedBy`, would exist only in the languages it names, and every backend's tests honour
  both; none has either now (the
  [to-do reference plan](../../../../docs/features/complete/todo-reference/todo-reference.proposal.md)
  used them while `todo-restore`, `todo-history` and `deleted` reached each language).
- `test-cases.json`: Conformance test cases used to verify backend implementations.
- `confirmation-cases.json`: Confirmation enforcement cases (`--suite confirmations`).
- `approval-cases.json`: Approval hold cases (`--suite approvals`): every backend and both Umbel
  modes run all four.
- `task-cases.json`: MCP Tasks cases (`--suite tasks --mode modern`), where `todo-create-batch`
  declares `task: "optional"` (TypeScript and Rust; Python tracked in
  [#1972](https://github.com/lushly-dev/afd/issues/1972)).
- `../../../../spec/protocol-conformance.json`: Shared AFD protocol cases (`--suite protocol` in
  both `legacy` and `modern` modes; `PROTOCOL_CONFORMANCE=1` registers a private
  `todo-internal-ping` command with `expose.mcp: false` for D4 checks), validated against
  `spec/schema/{result,batch,pipeline}.json`.
- `README.md`: This file.

## Conformance Test Cases

Each backend has a script (run from `packages/examples/todo`) that starts it with an in-memory
store and runs every case in `test-cases.json`:

| Backend | Script | Transport |
|---------|--------|-----------|
| TypeScript | `pnpm test:conformance:ts` | MCP over stdio |
| Python | `pnpm test:conformance:py` | MCP over stdio |
| Rust | `pnpm test:conformance:rs` | MCP over stdio (the built binary, `todo-backend-rust stdio`) |
| C++ | `pnpm test:conformance:cpp` | MCP over stdio |

The Rust script needs a Rust toolchain (`backends/rust/rust-toolchain.toml` pins it). The C++
script needs CMake 3.25+ and a C++20 compiler; it builds `todo-server-cpp` first. Before each
case the runner calls `todo-clear` with `{ "all": true }`, then runs the `setup` steps (a step's
`capture` stores its `data`, which later inputs reference as `"$name.field"`), then the command.

The 50 cases cover every command, its errors and the change history, and also what the
backends must agree on beyond a single result: `alternatives` (a filtered list offers the
unfiltered one and the opposite state), ties keeping insertion order in both sort directions,
the `destructive` hints, and the tool list.

A case with `implementedBy` runs only against backends in those languages, and one with `notOn`
skips the backends it names. Two cases skip the Umbel modes:

| Case | Runs against | Why not the others |
| --- | --- | --- |
| `tool_list_grouped` | Every backend but the Umbel modes | Umbel lists its own hybrid tools |
| `tool_list_destructive_hints` | Every backend but the Umbel modes | Umbel's hybrid list does not list the todo commands; `detail_destructive_hints` checks their hints there through `afd-detail` |

So TypeScript, Python, Rust and C++ run all 50, and each Umbel mode, which serves the Rust
backend, 48.

Each `expect` entry maps a dotted path in the `CommandResult` to a value. Paths may index arrays
and read `.length` (`data.todos.0.title`, `data.todos.length`). The value is the exact JSON value
expected (an array is compared whole), or `{ "exists": true }` / `{ "exists": false }` to check
that a field is present (not `null` or missing) without fixing its value.

The command `tools/list` is not a tool: the runner lists the server's tools and answers with a
view that reads one tool per command and TypeScript's grouped tools alike (`toolListView` in
`dx/conformance.ts`):
`data.names` (the tool names in order), `data.actions.<group>` (a grouped tool's actions in
order) and `data.commands.<command>` (the `tool` that runs it and whether it is reported
`destructive`).

## Confirmation Cases

`--suite confirmations` runs `confirmation-cases.json` against a backend started with
`CONFIRMATIONS=enforce`, where `todo-clear` declares `confirmPrompt`
([`spec/confirmations.md`](../../../../spec/confirmations.md)). The runner
starts one backend per client kind named by a case's `client`: `acknowledge` declares no
elicitation capability, so the backend must accept `confirm: true`; `accept` and `decline`
declare form elicitation and answer every confirmation that way. The reset before each case
acknowledges its `todo-clear`. A case's `then` step is checked after the command, so a refused
command is shown to have changed nothing.

| Backend | Script | Enforces confirmations |
|---------|--------|------------------------|
| TypeScript | `pnpm test:conformance:ts --suite confirmations` | Yes, every protocol mode |
| Python | `pnpm test:conformance:py --suite confirmations` | Yes, every protocol mode |
| Rust | `pnpm test:conformance:rs --suite confirmations` | Yes, every protocol mode (over stdio; a 2025 request over the backend's stateless HTTP has no back channel, so there it answers `CONFIRMATION_REQUIRED` to a client that declares elicitation) |
| C++ | `pnpm test:conformance:cpp --suite confirmations` | Yes, every protocol mode (the library's `afd::mcp_stdio`) |

## Approval Cases

`--suite approvals` runs `approval-cases.json` against a backend started with `APPROVALS=agents`,
where `todo-clear`, the one change nothing undoes, is held for any caller that is not a person
([`spec/approvals.md`](../../../../spec/approvals.md)); an MCP caller is an
agent. The client kinds are the confirmation suite's: `acknowledge` declares no elicitation, so a
held clear fails with `APPROVAL_REQUIRED`; `accept` and `decline` declare form elicitation, so the
server asks the person, and the client answers every question that way. A clear would be held, so
the reset before each case deletes the live todos with `todo-delete-batch` instead.

| Backend | Script | Cases |
|---------|--------|-------|
| TypeScript | `pnpm test:conformance:ts --suite approvals` | All 4, in both protocol modes |
| Python | `pnpm test:conformance:py --suite approvals` | All 4, in both protocol modes (`relay="mcp-elicitation"`, [#1312](https://github.com/lushly-dev/afd/issues/1312)) |
| Rust | `pnpm test:conformance:rs --suite approvals` | All 4, in both protocol modes |
| C++ | `pnpm test:conformance:cpp --suite approvals` | All 4, in both protocol modes |
| Umbel (compiled) | `pnpm test:conformance:umbel --suite approvals` | All 4, in both protocol modes (`approval = "non-human"`, `mcp.approvals = "mcp-elicitation"`) |
| Umbel (mounted) | `pnpm test:conformance:umbel-mounted --suite approvals` | All 4, in both protocol modes (`approval = "non-human"`, `mcp.approvals = "mcp-elicitation"`) |

The runner skips a client kind with no case for the backend's language, and fails a suite that
leaves the language no case at all.

## Task Cases

`--suite tasks --mode modern` runs `task-cases.json` on MCP 2026-07-28 against backends where
`todo-create-batch` declares `task: "optional"`
([`spec/tasks.md`](../../../../spec/tasks.md)). The `tasks` client
declares `io.modelcontextprotocol/tasks` and verifies `server/discover` advertisement, `afd-detail`
`task` reporting, `resultType: "task"` creation and `tasks/get` polling to completion on
`todo-create-batch`, inline execution for `todo-create`, `tasks/update` and `tasks/cancel`
acknowledgements, and `-32602` for unknown task IDs. The `no-tasks` client omits the capability and
verifies `todo-create-batch` runs inline.

| Backend | Script | Cases |
|---------|--------|-------|
| TypeScript | `pnpm test:conformance:ts --suite tasks --mode modern` | All 4 cases + wire checks |
| Rust | `pnpm test:conformance:rs --suite tasks --mode modern` | All 4 cases + wire checks |
| Python | Planned ([#1972](https://github.com/lushly-dev/afd/issues/1972)) | — |
| C++ | N/A (not planned for C++) | — |

## Shared Database

`pnpm test:interop` (`dx/run-interop.ts`) checks the TypeScript and Python backends share one
SQLite database, in four parts:

1. The TypeScript server creates a new database and the Python server opens it while the first
   still runs; the todos are changed through each in turn. Each must read what the other wrote
   (live and deleted todos, the change history) and answer every read alike, order, alternatives
   and an accented, mixed-case title sort included, and describe every command alike in
   `afd-detail`.
2. Python's store creates and seeds a new database, and the TypeScript server lists the seed.
3. TypeScript's `SqliteStore.check()` creates and seeds one, and the Python server lists it.
4. Five times, a Python process and the TypeScript store open one new database at the same
   moment; the seed must be there exactly once.

It builds the TypeScript backend first and runs the Python one under `uv`.

## Scenarios and Surface Validation

`pnpm test:scenarios:ts` serves the TypeScript backend over Streamable HTTP with an in-memory
store and runs AFD's own clients against it (`dx/run-scenarios.ts`): `afd validate --surface
--strict` (four input overlaps suppressed, each with its reason), then `afd scenario run` on every
file in `scenarios/` and `backends/typescript/scenarios/` except those tagged `deterministic` or
`contexts`, which the backend's own tests run in-process. It uses a temporary `afd` config home.

## Data Types

### Todo

```typescript
interface Todo {
  id: string; // Unique identifier
  title: string; // 1-200 characters
  description?: string; // Optional, max 1000 characters
  priority: "low" | "medium" | "high";
  completed: boolean;
  createdAt: string; // ISO 8601 timestamp
  updatedAt: string; // ISO 8601 timestamp
  completedAt?: string; // ISO 8601 timestamp, present when completed=true
  deletedAt?: string; // ISO 8601 timestamp, present only on a deleted todo (todo-list { deleted: true })
}
```

### CommandResult

All commands return AFD-compliant results:

```typescript
interface CommandResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    suggestion?: string;
    retryable?: boolean;
  };
  reasoning?: string;
  confidence?: number;
  warnings?: Warning[];
  alternatives?: Alternative<T>[];
  metadata?: {
    executionTimeMs?: number;
  };
}
```

## Commands

Command names are kebab-case MCP tool names, and every command is exposed to MCP clients.

1. `todo-create`: Create a new todo
2. `todo-list`: List todos with filtering, sorting and pagination
3. `todo-get`: Get a single todo by ID
4. `todo-update`: Update todo fields
5. `todo-toggle`: Toggle completion status
6. `todo-delete`: Delete a todo, kept with the deleted todos for `todo-restore`
7. `todo-clear`: Clear completed todos, the deleted todos with `{ "deleted": true }`, or all todos
   with `{ "all": true }`
8. `todo-stats`: Get todo statistics
9. `todo-create-batch`: Create multiple todos (1-100)
10. `todo-delete-batch`: Delete multiple todos (1-100 IDs)
11. `todo-toggle-batch`: Toggle multiple todos, or set them all with `completed`
12. `todo-restore`: Bring deleted todos back as they were
13. `todo-history`: Recent changes with their actor and undo

## Error Codes

Every error includes a `suggestion` for recovery.

- `NOT_FOUND`: Requested resource doesn't exist
- `VALIDATION_ERROR`: Input failed validation
- `NO_CHANGES`: Update requested but no changes provided
- `APPROVAL_REQUIRED`: `todo-clear` from a caller that is not a person, held until a person
  approves

Batch commands report per-item failures in `data.failed` (with the same error codes) and still
return `success: true`; they fail as a whole only when the input itself is invalid.
