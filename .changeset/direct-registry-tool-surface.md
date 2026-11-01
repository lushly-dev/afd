---
"@lushly-dev/afd-server": minor
"@lushly-dev/afd-client": minor
---

Bring AFD contexts and the MCP tool surface to the in-process registry (#527, part 3).

`createDirectRegistry(commands, { contexts })` takes the same context definitions as `createMcpServer`. The active context is per-call input, never registry state: `registry.execute(name, input, context, { activeContext })` scopes one call, including the commands it runs through `afd-call`, `afd-batch` and `afd-pipe`. An unknown context fails with `CONTEXT_NOT_FOUND` and a command outside it with `COMMAND_NOT_IN_CONTEXT`; without `activeContext` every command is available, as on MCP with no context selected.

`createDirectToolSurface({ strategy?, firstClassTools?, bootstrap? })`, from `@lushly-dev/afd-server/direct` and the root, is passed as `createDirectRegistry(commands, { tools })`. The registry then gains `listTools({ strategy?, activeContext? })`, which returns the MCP server's own tool list for every strategy, and routes the meta-tools and, under `grouped`, grouped tools through the server's tool router. It registers the context tools when `contexts` is set, which behave as on the stateless MCP 2026-07-28 lane (`persisted: false`), and the bootstrap tools with `bootstrap: true`. The surface lists and routes the commands exposed to the registry's `interface`, where the server uses `expose.mcp`. Without `tools`, `listTools` throws a `TypeError`, and a host that does not import the surface does not bundle the router. Refusals from a registry without a surface no longer point to `afd-discover` or the context tools, which it does not serve.

`DirectClient` passes a call's `activeContext` to the registry as that call option, on every `pipe()` step and on the approval retry, and never puts it in the command context. `DirectClient.listTools(options?)` forwards to `registry.listTools` with the `allow` predicate applied, and `DirectRegistry` gains the optional `listTools` and the `execute` call option.

The confirmation gate moved out of `confirmations.ts` into an internal module, so the tool router and the tool list load no Node.js built-in. No public export changed.
