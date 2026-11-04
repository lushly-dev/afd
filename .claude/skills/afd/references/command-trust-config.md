# Trust metadata: destructive, confirmations, approvals, exposure, undo

Exact fields, defaults and surfaces are in [`spec/command-metadata.md`](../../../../spec/command-metadata.md)
("Confirmations" and "Approvals"); the TypeScript options are in `packages/server/README.md`. This
page is for choosing between them and avoiding the mistakes.

| Need | Use | Enforced by |
|------|-----|-------------|
| Tell planners a call is irreversible | `destructive: true` (with `mutation: true`) | Nothing; it is reported in `_meta` and `afd validate --execute` never calls it |
| Ask "do you mean it?" before it runs | `confirmPrompt` plus the server's `confirmations` option | The MCP and HTTP surfaces, when `confirmations` is not `off` |
| Hold it until a human signs off | `approval` plus `createApprovalMiddleware` | The middleware, on every surface it runs on |
| Keep it off a surface | `expose` | Every registry and server |
| Offer a way back | `undoable: true`, and `undoCommand` / `undoArgs` in the result | Nothing; the consumer runs the undo |

## Confirmations

```typescript
defineCommand({ name: 'todo-clear', mutation: true, destructive: true,
  confirmPrompt: 'Delete every todo? This cannot be undone.', /* input, handler */ });
createMcpServer({ name: 'todo', version: '1.0.0', commands, confirmations: 'enforce' });
```

- `confirmations` is `'off'` by default: `confirmPrompt` is then display text only, which a
  frontend shows before it calls. Read it from `registry.get(name)` locally or `afd-detail`
  remotely; it is never in `_meta`.
- Under `'enforce'`, a client that supports form elicitation asks the user; any other caller gets
  `CONFIRMATION_REQUIRED` until it repeats the call with `confirm: true`. That acknowledgement comes
  from the agent, not a person. `'require-human'` accepts only an elicitation.
- DirectClient, in-process registries and `server.execute()` are never gated: the host owns
  in-process calls.

## Approvals

```typescript
const todoDelete = defineCommand({ name: 'todo-delete', mutation: true, destructive: true,
  approval: (input, context) => (context.actor?.kind === 'human' ? 'not-required' : 'required'),
  /* input, handler */ });
createMcpServer({ name: 'todo', version: '1.0.0', commands,
  middleware: [createApprovalMiddleware({ secret: process.env.AFD_APPROVAL_SECRET!, commands })] });
```

A held call fails with `APPROVAL_REQUIRED` before the handler runs; `error.details` has
`approvalToken`, `expiresAt` and `summary`. Once a human approves, trusted surface code retries the
same command, input and actor with `context.approval` set to the token. Tokens are HMAC-signed,
bound to command, input and actor, expire (5 minutes by default) and work once by default.

- Without the middleware, `approval` is a declaration only. Pass it the same `commands` as the
  server: an unlisted command is never held. Install it after any middleware that sets
  `context.actor` (auth), since tokens bind the actor. The secret must be at least 32 bytes.
- A policy function fails closed: anything but `'not-required'` holds the call. Write it so a
  call with no actor is held.
- Never read `context.approval` from tool arguments. MCP results leave the token out by default
  (`includeToken`); deliver it to the human through `onApprovalRequired`, or set
  `relay: 'mcp-elicitation'` to ask the person behind an eliciting MCP client (single-command
  calls only; leave it off where the agent's own code is the MCP client).
- DirectClient and `createDirectRegistry` strip a caller's `context.approval` and use a private
  exchange: handle holds with the client's `onApprovalNeeded` hook.
- `afd call <name> <input> --module <path>` runs the flow in-process and prompts; `--approve`
  approves without the prompt for scripts.
- `afd validate` warns (`MISSING_APPROVAL_POLICY`) about a `mutation` or `destructive` command with
  no policy; declare `'not-required'` to record that none is needed.

## Exposure

`expose: { palette, agent, mcp, cli }`. Flags left out fall back to `defaultExpose`: `palette` and
`agent` on, `mcp` and `cli` off, so `expose: { mcp: true }` keeps the in-app defaults.
`registry.listByExposure('mcp')` lists one surface's commands.

A refused call depends on the caller
([`spec/error-codes.md`, D4](../../../../spec/error-codes.md#unknown-and-unexposed-commands-d4)): over MCP an
unexposed command is `COMMAND_NOT_FOUND`, identical to an unknown one; an in-process registry
called with an interface gets `COMMAND_NOT_EXPOSED`; with no interface it runs. Exposure is not
authorization: application identity and permissions belong in middleware.

## Undo

`undoable: true` declares a capability and appears in `_meta`, `afd-detail` and `afd tools`
(`(undoable)`). The result may carry `undoCommand: 'todo-unarchive'` and `undoArgs: { id }`.
Nothing validates that pair: a consumer that offers undo must check that `undoCommand` exists,
that `undoArgs` pass its input schema, and that it restores the state.
