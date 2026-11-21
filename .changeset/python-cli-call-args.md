---
"afd-python": minor
---

### Added

- **`afd call` and the shell's `call` take `key=value` pairs** as well as a JSON object, as TypeScript's do (#1822): values are parsed as JSON when they can be (`count=2`, `done=true`, `tags=["a"]`) and kept as strings otherwise (`title=milk`, `note='two words'`). JSON must be strict: `NaN` is refused in an object and stays a string in a pair.
- **`-H "Name: value"` request headers on `connect`, `tools`, `call` and `validate`, and in `shell`** (#1822), with those in `AFD_HEADERS` (one per line; a flag replaces an environment header of the same name). Headers are never saved. `call --module` refuses `-H`, since it runs in process.

### Fixed

- **`afd connect --timeout`** is now used for the connection; it was ignored.
- **`call`, `connect`, `tools`, `validate` and the shell print error text without Rich markup** and strip terminal escape sequences from it, as `batch` and `stream` do.
- **A malformed argument no longer ends the shell**: it prints the error and waits for the next command.
