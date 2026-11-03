---
"@lushly-dev/afd-auth": minor
"@lushly-dev/afd-view-state": minor
---

Define the auth and view-state commands on Zod Mini through `defineCommandWithSchema`, each schema beside its JSON Schema as a literal, so a browser host that uses them bundles neither classic Zod nor `toJSONSchema`. What a command advertises does not change: its input and output JSON Schemas are the same as before, and a test in each package holds them equal to the schemas.

`@lushly-dev/afd-auth/commands` adds `createAuthSessionGetCommand(adapter)` and `createAuthMutationCommands(adapter, options)`, in modules of their own, so a host can load `auth-session-get` before first paint and the sign-in commands later. `createAuthCommands` returns both, in the same order.

Two things a caller can see:

- `inputSchema` and `outputSchema` of these commands are now Zod Mini schemas, though `ZodCommandDefinition` still types `inputSchema` as classic. `safeParse` and `parse` still work; classic's methods such as `.optional()`, `.extend()` or `.shape.id.describe()` do not.
- With no Zod locale loaded, as on Zod Mini alone, a bad email at `auth-sign-in` says `Invalid email` rather than `Invalid email address`, and an in-process `NaN` or `Infinity` is described as `nan` or `number`, which JSON cannot carry. With classic Zod loaded anywhere in the process nothing changes.
