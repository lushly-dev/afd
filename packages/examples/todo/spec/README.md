# Todo Example Specification

This directory contains the shared API contract for the Todo example. All four backend implementations (TypeScript, Python, Rust and C++) must follow this specification to ensure interoperability with all frontend implementations (Vanilla JS, React, etc.).

## Files

- `commands.schema.json`: JSON Schema defining the input and output for all 13 commands,
  keyed by MCP tool name, and each command's `metadata`: `mutation`, `destructive`, `contexts`
  and, on `todo-clear`, `confirmPrompt`. The test suites of all four backends fail if it does not
  list exactly the commands their backend defines with that metadata (Rust's leaves out
  `contexts`, which it does not declare yet); the C++ backend also validates every input
  against it. A command with `implementedBy` (`todo-restore`, `todo-history`), or an input
  property with `x-implementedBy` (`deleted` on `todo-list` and `todo-clear`), exists so far only
  in the languages it names, TypeScript and Python, and only their tests expect it: the
  [to-do reference plan](../../../../docs/features/active/todo-reference/todo-reference.proposal.md)
  added it to TypeScript in phase 2 and to Python in phase 5, and removes the field once Rust and
  C++ have it too.
- `test-cases.json`: Conformance test cases used to verify backend implementations.
- `confirmation-cases.json`: Confirmation enforcement cases (`--suite confirmations`).
- `approval-cases.json`: Approval hold cases (`--suite approvals`): TypeScript runs all four,
  Python the two that need no elicitation.
- `README.md`: This file.

## Conformance Test Cases

Each backend has a script (run from `packages/examples/todo`) that starts it with an in-memory
store and runs every case in `test-cases.json`:

| Backend | Script | Transport |
|---------|--------|-----------|
| TypeScript | `pnpm test:conformance:ts` | MCP over stdio |
| Python | `pnpm test:conformance:py` | MCP over stdio |
| Rust | `pnpm test:conformance:rs` | MCP streamable HTTP, on a free local port |
| C++ | `pnpm test:conformance:cpp` | MCP over stdio |

The Rust script needs a Rust toolchain (`backends/rust/rust-toolchain.toml` pins it). The C++
script needs CMake 3.25+ and a C++20 compiler; it builds `todo-server-cpp` first. Before each
case the runner calls `todo-clear` with `{ "all": true }`, then runs the `setup` steps (a step's
`capture` stores its `data`, which later inputs reference as `"$name.field"`), then the command.

A case with `implementedBy` runs only against backends in those languages, like the commands
marked so in `commands.schema.json`. Six cases in `test-cases.json` (undo metadata, deleting and
restoring, emptying the deleted todos, history) are TypeScript's and Python's, so those two run
all 41; the Rust and C++ backends run the 35 shared ones, and phase 5 removes the field once they
catch up.

Each `expect` entry maps a dotted path in the `CommandResult` to a value. Paths may index arrays
and read `.length` (`data.todos.0.title`, `data.todos.length`). The value is either the exact
JSON value expected, or `{ "exists": true }` / `{ "exists": false }` to check that a field is
present (not `null` or missing) without fixing its value.

## Confirmation Cases

`--suite confirmations` runs `confirmation-cases.json` against a backend started with
`CONFIRMATIONS=enforce`, where `todo-clear` declares `confirmPrompt`
([`spec/command-metadata.md`](../../../../spec/command-metadata.md#confirmations)). The runner
starts one backend per client kind named by a case's `client`: `acknowledge` declares no
elicitation capability, so the backend must accept `confirm: true`; `accept` and `decline`
declare form elicitation and answer every confirmation that way. The reset before each case
acknowledges its `todo-clear`. A case's `then` step is checked after the command, so a refused
command is shown to have changed nothing.

| Backend | Script | Enforces confirmations |
|---------|--------|------------------------|
| TypeScript | `pnpm test:conformance:ts --suite confirmations` | Yes, every protocol mode |
| Python | `pnpm test:conformance:py --suite confirmations` | Yes, every protocol mode |
| Rust | `pnpm test:conformance:rs --suite confirmations --mode modern` | Yes. In legacy mode the accept and decline cases fail by design: a 2025 request over the backend's stateless HTTP has no back channel, so the backend answers `CONFIRMATION_REQUIRED` |
| C++ | Not yet | No. `todo-clear` declares the prompt, but the backend's own stdio loop does not enforce confirmations; that waits on the library's `afd::mcp_stdio` ([#341](https://github.com/lushly-dev/afd/issues/341)) |

## Approval Cases

`--suite approvals` runs `approval-cases.json` against a backend started with `APPROVALS=agents`,
where `todo-clear`, the one change nothing undoes, is held for any caller that is not a person
([`spec/command-metadata.md`](../../../../spec/command-metadata.md#approvals)); an MCP caller is an
agent. The client kinds are the confirmation suite's: `acknowledge` declares no elicitation, so a
held clear fails with `APPROVAL_REQUIRED`; `accept` and `decline` declare form elicitation, so the
server asks the person, and the client answers every question that way. A clear would be held, so
the reset before each case deletes the live todos with `todo-delete-batch` instead.

| Backend | Script | Cases |
|---------|--------|-------|
| TypeScript | `pnpm test:conformance:ts --suite approvals` | All 4, in both protocol modes |
| Python | `pnpm test:conformance:py --suite approvals` | The 2 `acknowledge` cases, in both protocol modes. The `accept` and `decline` cases need the server to ask the person over MCP, which the Python library cannot do yet ([#1312](https://github.com/lushly-dev/afd/issues/1312)): a held clear answers `APPROVAL_REQUIRED` whatever the client declares |
| Rust, C++ | Not yet | Approvals come in phase 5 |

The runner skips a client kind with no case for the backend's language, and fails a suite that
leaves the language no case at all.

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
12. `todo-restore`: Bring deleted todos back as they were (TypeScript and Python so far)
13. `todo-history`: Recent changes with their actor and undo (TypeScript and Python so far)

## Error Codes

Every error includes a `suggestion` for recovery.

- `NOT_FOUND`: Requested resource doesn't exist
- `VALIDATION_ERROR`: Input failed validation
- `NO_CHANGES`: Update requested but no changes provided
- `APPROVAL_REQUIRED`: `todo-clear` from a caller that is not a person, held until a person
  approves (TypeScript and Python)

Batch commands report per-item failures in `data.failed` (with the same error codes) and still
return `success: true`; they fail as a whole only when the input itself is invalid.
