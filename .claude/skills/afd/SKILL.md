---
name: afd
description: >
  Core Agent-First Development (AFD) rules: the honesty check, the command-first
  workflow, CommandResult and errors, naming, meta-tools and the afd CLI. Use when
  designing commands or asking how AFD works; for code in one language, use
  afd-typescript, afd-python, afd-rust or afd-cpp.
---

# Agent-First Development

Agents are first-class users. Every capability is a command before any UI exists, and the UI is a
thin caller of the same commands.

## The honesty check

> "If it can't be done via CLI, the architecture is wrong."

No UI-only code paths: business logic lives in handlers, and people and agents run the same
commands, so what you prove at the CLI is exactly what the UI and every agent get. Ephemeral or
derived UI state (hover, focus, local sorting) is not a command; see
[command-schema.md](references/command-schema.md).

## Workflow

1. **Define** the command: input schema, description, the error codes it returns, and the
   metadata agents plan with (`output`, `examples`, `requires`, `contexts`, `mutation`,
   `destructive`, `approval`).
2. **Validate** it with `afd call` and `afd validate --surface`. Don't start the UI until the CLI
   call works.
3. **Surface** it: the UI calls the command and shows its `reasoning`, `confidence` and `warnings`.

To fix a bug, reproduce it with `afd call`, fix it in the handler, and confirm it at the CLI before
looking at the UI.

## Command rules

- **Names** are `domain-action` kebab-case with at least two segments (`todo-create`,
  `user-get`), the same in every language (`validateCommandName`). No dots, camelCase or
  underscores. TypeScript's `defineCommand` only warns on a bad name; `afd validate --surface`
  reports it as an error.
- **Results**: `success(data, { reasoning, confidence, warnings, suggestions })` or
  `error(code, message, { suggestion, retryable, details })` (`failure()` takes a whole
  `CommandError`); Python and Rust have equivalents. Every error carries a `suggestion` saying how
  to recover: `Use todo-list to see available todos`.
- **Error codes** come from the shared catalog first: `ErrorCodes` in
  `packages/core/src/errors.ts`, with meaning and retryability in
  [`spec/error-codes.md`](../../../spec/error-codes.md). Add an application code (the todo
  example's `NO_CHANGES`) only when none fits.
- **Exposure**: a command is private to MCP until it sets `expose: { mcp: true }`. Over MCP a
  private command answers `COMMAND_NOT_FOUND`, exactly like an unknown name.
- **`requires`** is planning metadata. Nothing enforces it at runtime.

## Meta-tools

| Tool | Does |
|------|------|
| `afd-call` | Runs any exposed command: `{ command, input }` |
| `afd-batch` | Runs several commands in one call |
| `afd-pipe` | Chains steps; inputs reference `$prev`, `$steps.alias`, `$input` |
| `afd-discover` | Lists commands by category, tag or search, paginated |
| `afd-detail` | Full schemas, examples and metadata for 1 to 10 commands |
| `afd-help`, `afd-docs`, `afd-schema` | Bootstrap tools: list, document, export schemas |
| `afd-context-list`, `-enter`, `-exit` | Context scoping, when the server configures contexts |

Every tool strategy (`individual`, `grouped`, `lazy`, `hybrid`) routes all five meta-tools,
listed or not. On large surfaces an agent runs `afd-discover` → `afd-detail` → `afd-call`. The
default strategy and lists differ by language: [mcp-integration.md](references/mcp-integration.md).

## CLI

| Task | Command |
|------|---------|
| Connect | `afd connect http://localhost:3100/mcp` |
| List tools | `afd tools` (`-c <category>`, `-f json`) |
| Call | `afd call todo-create '{"title":"Test"}'`, or `afd call todo-create title=Test` |
| Call in-process | `afd call <name> '<json>' --module ./dist/registry.js` (runs approvals locally) |
| Lint the agent contract | `afd validate --surface` |
| Replay a journal | `afd replay session.jsonl --module ./dist/registry.js` |

Every option: `packages/cli/README.md`.

## Parity

Languages share capabilities and agent-visible behaviour, not identical API names. The capability
matrix and the intended gaps are in [`docs/language-parity.md`](../../../docs/language-parity.md).
The command layer stays framework-agnostic: React and browser integrations belong in ecosystem
layers (UI packages, adapters, examples), outside the core parity target.

## References

| Read | When |
|------|------|
| [command-schema.md](references/command-schema.md) | `CommandResult` fields, error shape, confidence, batch results, tags, `requires`, what is not a command |
| [mcp-integration.md](references/mcp-integration.md) | Tool strategies, grouped tools, `_meta`, bootstrap and context tools, HTTP endpoints |
| [command-trust-config.md](references/command-trust-config.md) | `destructive`, `confirmPrompt`, `approval`, `expose`, `undoable` |
| [surface-validation.md](references/surface-validation.md) | Reading and fixing `afd validate --surface` findings |
| [telemetry.md](references/telemetry.md) | TypeScript default middleware, middleware order, telemetry sinks |
| [handoff-pattern.md](references/handoff-pattern.md) | A command that hands off to WebSocket, SSE or WebRTC |
| [platform-utils.md](references/platform-utils.md) | `exec`, `findUp` and the GitHub and package-manager connectors |
| [philosophy.md](references/philosophy.md) | Explaining why AFD to a person |

JTBD scenario files, fixtures and test helpers are documented in `packages/testing/README.md`.
In-process agents: afd-directclient. Sign-in: afd-auth.
