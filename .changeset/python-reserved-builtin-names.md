---
"afd-python": minor
---

### Breaking changes

- **A command named like a built-in that is on is refused** (#1731), as TypeScript's `assertValidCommandNames` refuses it: with `bootstrap=True`, registering `afd-help`, `afd-docs` or `afd-schema` raises `ValueError`, and with `contexts`, so does `afd-context-list`, `afd-context-enter` or `afd-context-exit`. The same check runs before each `tools/list` and command call (the meta-tools included), so a command added through `server.registry` directly, a built-in turned on in `server.config` after registration, or a definition renamed after registration is refused there too, and renaming the command afterwards rebuilds the server's lookups. (`server.registry.execute` still runs the registry's own commands by any name: the built-ins are not in it.) Before, the command silently replaced the built-in. Without those options the names are ordinary commands, as before. Rename the command, or leave the option off.
