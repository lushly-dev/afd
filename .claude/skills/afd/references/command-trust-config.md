# Command trust metadata

`destructive`, `confirmPrompt`, and `undoable` describe a command for consumers. AFD transports the metadata; the application owns confirmation and undo behavior. `approval` is different: it is a pre-execution gate that AFD enforces where `createApprovalMiddleware` is installed. See `spec/command-metadata.md` for exact fields, defaults, and surfaces.

## Define the command

```typescript
defineCommand({
  name: 'todo-delete',
  destructive: true,
  confirmPrompt: 'This todo will be permanently deleted.',
  mutation: true,
  // description, input schema, and handler omitted here
});
```

A frontend should obtain metadata and request any required confirmation **before** executing the command. A warning returned after execution cannot prevent an operation that already happened.

## Read metadata from supported APIs

The core `CommandRegistry` exposes `get(name)` and `list()`, which return command definitions:

```typescript
const command = registry.get('todo-delete');
const destructive = command?.destructive ?? false;
const prompt = command?.confirmPrompt ?? 'Confirm this action.';
const commands = registry.list();
```

For remote clients, `tools/list` exposes planning fields such as `destructive`, `undoable`, and `mutation` through `_meta`. `confirmPrompt` is display text available through `afd-detail` when that tool is enabled. Grouped tools put per-command planning metadata in `_meta.actions`.

AFD does not define a `tool_end` event carrying all command metadata or a post-execution frontend confirmation protocol. An application can define its own event protocol, but it must not present that protocol as an AFD API.

## Hold a command for approval

Confirmation is post hoc; it cannot stop an agent that calls the command directly. When a human must sign off first, declare `approval` and install the middleware:

```typescript
const todoDelete = defineCommand({
  name: 'todo-delete',
  mutation: true,
  destructive: true,
  approval: (input, context) => (context.actor?.kind === 'human' ? 'not-required' : 'required'),
  // description, input schema, and handler omitted here
});

createMcpServer({
  commands,
  middleware: [createApprovalMiddleware({ secret: process.env.AFD_APPROVAL_SECRET!, commands })],
});
```

A gated call fails with `APPROVAL_REQUIRED` before the handler runs; `error.details` has `approvalToken`, `expiresAt` and `summary`. After the human approves, retry the same command, input and actor with `context.approval` set to the token. Tokens are HMAC-signed, expire (5 minutes by default) and work once by default.

- Only trusted surface code sets `context.approval`, never tool arguments. When the agent being gated receives the result, use `includeToken: false` and deliver the token to the human through `onApprovalRequired`.
- The policy is reported as `_meta.approval` (`required`, `not-required` or `conditional`). `afd validate` warns about `mutation` or `destructive` commands without one; declare `'not-required'` to record that none is needed.
- A policy function fails closed: anything but `'not-required'` holds the call. Write it so that a call with no actor is held.
- Pass the middleware the same `commands` as the server: an unlisted command is never held. Single-use tracking is per middleware instance unless you share a `nonceStore`.

## Exposure and recovery

Use `expose` on the definition and `CommandContext.interface` to select the intended interface. A first-party `createDirectRegistry` applies the same execution validation, middleware and interface exposure as the server. Application identity and permissions still belong to application middleware.

`undoable` is a capability declaration. A successful result may supply `undoCommand` and `undoArgs`; consumers must verify and execute that recovery command explicitly. Warnings can explain consequences or recovery steps, but they do not grant authorization or reverse an operation automatically.
