---
'@lushly-dev/afd-server': minor
'@lushly-dev/afd-client': minor
---

Add `createDirectRegistry(commands, options?)` to `@lushly-dev/afd-server`: a `DirectClient`-compatible registry that runs every call through the same execution engine as `createMcpServer` (Zod input validation, middleware, error sanitization, `onCommand`/`onError`). It lists and runs only the commands exposed to one interface (`'agent'` by default; flags a command leaves out fall back to `defaultExpose`) and returns `COMMAND_NOT_EXPOSED` or `COMMAND_NOT_FOUND` otherwise. Hand-written registries that call `command.handler(input)` skipped all of this; the todo-directclient example, the showcase pipeline demo and the `afd-directclient` skill now use `createDirectRegistry`.

`DirectClient` gains an `allow?: (commandName) => boolean` option. Refused commands return `COMMAND_NOT_ALLOWED` without reaching the registry and are left out of `listCommands()`, `listCommandNames()` and `hasCommand()`. `UNKNOWN_TOOL` failures now carry a `suggestion`.

Minor: new API and a new opt-in option.
