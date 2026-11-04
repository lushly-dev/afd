---
name: afd-directclient
description: >
  Runs AFD commands in-process with createDirectRegistry and DirectClient: allow,
  activeContext, approvals, pipe() and the MCP tool surface, plus optimistic UI. Use when
  embedding an agent or chat loop in an app; for defining commands or MCP servers, use
  afd-typescript.
---

# DirectClient and createDirectRegistry

`DirectClient` (`@lushly-dev/afd-client`) lets an agent in the app's own process call commands with no transport; an agent in another process uses MCP. Reference: `packages/client/README.md` ("DirectClient") and `packages/server/README.md` ("In-process entry point").

## Always build the registry with `createDirectRegistry`

Import it from `@lushly-dev/afd-server`, or `@lushly-dev/afd-server/direct` in a browser, worker or webview (no MCP SDK, no Node built-in). It runs each call through `createMcpServer`'s engine: Zod validation of the whole input, middleware with `onCommand`/`onError`, error sanitization (exception text only with `devMode: true`), and exposure to its `interface` (`'agent'` by default; others get `COMMAND_NOT_EXPOSED`).

A hand-rolled registry that calls `command.handler(input)` skips all of that: `{ "title": { "nested": true } }` reaches your store, exceptions leak, `expose: { agent: false }` is ignored, and so are the `allow` and `activeContext` call options.

Flags a command leaves out fall back to `defaultExpose` (`palette` and `agent` on), so `expose: { mcp: true }` stays callable by in-app agents. Use `expose: { agent: false }` for commands the AI must not run.

`@lushly-dev/afd-client` has no browser entry for `DirectClient` yet ([#655](https://github.com/lushly-dev/afd/issues/655)); its root also loads `McpClient`, the deprecated transports and `eventsource`.

## Calling

```typescript
import { isSuccess } from '@lushly-dev/afd-core';
import { createDirectClient, isUnknownToolError } from '@lushly-dev/afd-client';
import { createDirectRegistry } from '@lushly-dev/afd-server';

const registry = createDirectRegistry(commands, { middleware });
const client = createDirectClient(registry, {
  actor: { kind: 'agent', label: 'Assistant', onBehalfOf: userId },
  allow: (name) => name.startsWith('todo-') && name !== 'todo-clear',
});

const result = await client.call<Todo>('todo-create', { title: 'Fast task' });
if (isUnknownToolError(result)) console.error(result.data?.hint);
else if (isSuccess(result)) console.log(result.data.id);
```

- `call<T>()` returns `CommandResult<T> | CommandResult<UnknownToolError>`, so check `isUnknownToolError` before reading `data` as `T`. It never rejects: a throw becomes `COMMAND_EXECUTION_ERROR` without the exception text.
- The default actor is `{ kind: 'human' }`. Set `{ kind: 'agent' }` for an assistant, so middleware, approval tokens and `metadata.actorKind` tell it from the user.
- A context `timeout` is enforced (per step in `pipe()`) and combined with `signal`. After `TIMEOUT` the handler may still have finished, so check a mutation's effect before retrying.
- For an LLM's tool list, prefer `listTools()` (below) to `listCommands()`. `packages/examples/todo-directclient/` is a Gemini chat loop.

## `allow`

A refused name, or a predicate that throws, returns `COMMAND_NOT_ALLOWED` and is hidden from `listCommands()`, `listCommandNames()`, `hasCommand()` and `listTools()`. The client also passes the predicate to the registry as the `allow` call option on every call, `pipe()` step and approval retry, and `createDirectRegistry` checks it on every command the call runs: the `afd-call` target, `afd-batch` items, `afd-pipe` steps, a grouped tool's action, and a command a handler runs with its own context. Allowing a meta-tool never reaches a refused command.

- Allow a grouped tool by its group name (`note`). A refused action is `COMMAND_NOT_FOUND`; a group with none permitted is `COMMAND_NOT_ALLOWED`.
- The predicate rides on the context as an opaque token: handlers cannot read or replace it, and tool arguments cannot carry one.
- Without a client: `registry.execute(name, input, context, { allow })` and `registry.listTools({ allow })`.

## Contexts and the MCP tool surface

```typescript
import { createDirectRegistry, createDirectToolSurface } from '@lushly-dev/afd-server/direct';

const registry = createDirectRegistry(commands, {
  contexts: [{ name: 'billing' }, { name: 'writing' }],
  tools: createDirectToolSurface({ strategy: 'lazy' }), // also firstClassTools, bootstrap
});
const client = createDirectClient(registry, { actor: { kind: 'agent' } });

client.listTools({ activeContext: 'billing' }); // what the MCP server would list
await client.call('invoice-pay', { id: 'in-1' }, { activeContext: 'billing' });
```

- **The active context is per call, never registry state.** Handlers never see it; `pipe()` steps and the approval retry carry it. An unknown name, or any name on a registry without `contexts`, is `CONTEXT_NOT_FOUND`; a command outside it, `COMMAND_NOT_IN_CONTEXT`. A host that wants a stack keeps it and passes the top. Contexts are not a security boundary.
- **`createDirectToolSurface` defaults to `'individual'`**, where `createMcpServer` defaults to `'grouped'`. Pass `strategy` to match a server.
- **`listTools({ strategy?, activeContext? })`** runs the server's own tool-list code. It throws `TypeError` on a registry built without `tools` (which then does not bundle the router) and `RangeError` for an unknown context.
- **Meta-tools route through the server's router**: `afd-batch` returns a `BatchResult`, `afd-pipe` a `PipelineResult`. `afd-context-enter` and `-exit` only validate and return `persisted: false`, as on the stateless MCP 2026-07-28 lane.
- **Exposure follows the registry's `interface`**, not `expose.mcp`. Use `interface: 'mcp'` for exactly the server's surface.

## Approvals

```typescript
const commands = [todoDelete, todoList];
const registry = createDirectRegistry(commands, {
  middleware: [createApprovalMiddleware({ secret: approvalSecret, commands })],
});
const client = createDirectClient(registry, {
  actor: { kind: 'agent', onBehalfOf: userId },
  onApprovalNeeded: async ({ summary, signal }) => confirmDialog(summary, { signal }), // true approves
});
```

A held call returns `APPROVAL_REQUIRED` before its handler runs, and the hook receives `{ command, input, summary, expiresAt, actor, reason?, signal? }`.

- On `true` the client retries once, same input and actor, through a private exchange, and returns the retry's result; a retry held again (`reason: 'expired'`) is returned as is. Anything else, a throw or no hook returns the original token-free result.
- The hook never sees the token, and public contexts strip `approval`. Use matching `afd-client`, `afd-core` and `afd-server` versions; a custom registry must support the private exchange.
- `timeout` bounds each attempt, not the human. Close the prompt when `signal` aborts; a call cancelled while waiting is denied.
- In `pipe()` each gated step asks when reached, with its resolved input (tokens bind to input), and `timeoutMs` includes the wait.
- In a page the secret is readable by page scripts: the gate stops the model, not page code. Keep approvals on a server when you need that boundary.
- Confirmations (`confirmPrompt`) never gate in-process calls.

Contract: `spec/command-metadata.md`, "Approvals".

## `pipe()` and `$input`

```typescript
await client.pipe(
  {
    input: { userId: 1 },
    steps: [
      { command: 'user-get', input: { id: '$input.userId' }, as: 'user' },
      { command: 'order-list', input: { userId: '$steps.user.id' } },
    ],
    options: { timeoutMs: 5_000 }, // and continueOnFailure; steps may carry `when`
  },
  { traceId: 'trace-123' } // reaches handlers as context; no reference can read it
);
```

`spec/pipeline-variables.md` is normative. What catches people:

- A reference is a whole string: `$prev` (last successful step), `$first`, `$steps[n]`, `$steps.<alias>` or `$input`, plus an optional path (`$prev.items[0].id`, `$prev.items.0`).
- `$input` is the request's own `input` field, never the `pipe()` context, so auth and other context values cannot be copied into step inputs.
- Other `$` strings (`'$9.99'`) are literals; `'$$prev'` sends `'$prev'`. Only own keys and in-bounds indices resolve, and `__` segments never do.
- An unresolved reference is omitted from an object, `null` in an array, and false in `when`. Inputs nested past 64 levels fail with `VALIDATION_ERROR` before any step.
- Step data is copied between steps. Each step goes through `call()`, so `allow`, validation, approvals, `timeout` and `activeContext` all hold.

## Optimistic UI in an app client

Optimistic updates are a client pattern, not an AFD feature: the client owns pending state and rendering, and commands stay correct without it. Keep visual state out of commands, put view state an agent should see or drive in `view-state-*` commands, and keep business data in commands. Return the authoritative entity (canonical ID, corrected order, normalized values) and declare `output`, so the client replaces its guess with `data`; explain corrections in `reasoning` or `warnings`. On failure, roll back or refetch: `undoCommand`/`undoArgs` undo a success and are not a rollback. Don't apply `destructive` or approval-gated commands optimistically, since a held call waits for a human. Collaborative conflict resolution is out of scope.
