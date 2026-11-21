---
"afd-python": minor
---

### Breaking changes

- **A command named like a built-in that is on is refused** (#1731), as TypeScript's `assertValidCommandNames` refuses it: with `bootstrap=True`, registering `afd-help`, `afd-docs` or `afd-schema` raises `ValueError`, and with `contexts`, so does `afd-context-list`, `afd-context-enter` or `afd-context-exit`. The same check runs before each request, so a command added through `server.registry` directly, a built-in turned on in `server.config` after registration, or a definition renamed after registration is refused there too. Before, the command silently replaced the built-in. Without those options the names are ordinary commands, as before. Rename the command, or leave the option off.
