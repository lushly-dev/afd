---
'@lushly-dev/afd-view-state': minor
---

Add `@lushly-dev/afd-view-state/commands` for `createViewStateCommands`. The commands now use `defineCommand` from `@lushly-dev/afd-server/define`, so neither this subpath nor the root entry loads the MCP transport, and both bundle for the browser. The root re-export of `createViewStateCommands` is kept but marked `@deprecated`; it will be removed from the root in the next major version.

`createViewStateCommands(registry, { expose })` sets `expose` on all three commands. The default is unchanged (private to MCP), which since MCP exposure became opt-in meant the documented MCP setup listed no view-state tools: pass `expose: { mcp: true }`, as the README now shows.

The factory's return type is now a labelled tuple, `[viewStateGet, viewStateSet, viewStateList]`, so callers can destructure precisely typed commands. It is still an array and remains assignable to `ZodCommandDefinition[]`.

Minor: a new subpath and option, plus a deprecation.
