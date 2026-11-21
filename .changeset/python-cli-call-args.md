---
"afd-python": minor
---

### Added

- **`afd call` and the shell's `call` take `key=value` pairs** as well as a JSON object, as TypeScript's do (#1822): values are parsed as JSON when they can be (`count=2`, `done=true`, `tags=["a"]`) and kept as strings otherwise (`title=milk`, `note='two words'`). The pairs are one argument, so quote it when it holds several: `afd call todo-create 'title="Buy milk" priority=2'`. JSON must be strict: `NaN` is refused in an object and stays a string in a pair.
- **`-H "Name: value"` request headers on `connect`, `tools`, `call` and `validate`, and in `shell`** (#1822), with those in `AFD_HEADERS` (one per line; a flag replaces an environment header of the same name). Headers are never saved, and `connect` says so when it is given some. `call --module` refuses `-H` and ignores `AFD_HEADERS`, since it runs in process.

### Changed

- **`afd call`'s arguments follow TypeScript's rules**, which changes three cases for scripts: an empty or blank argument now calls the tool with `{}` (it failed before); text that does not start with `{` is read as pairs, so a JSON array such as `[1]` is a malformed pair and exits 1 (it exited 2 with "Arguments must be a JSON object"), and `["a=b"]` is the pair `["a` = `b"]`; and malformed arguments print "Invalid arguments (...). Use a JSON object or key=value pairs." instead of "Invalid JSON arguments".
- **A malformed header exits 1** on every command, `batch` and `stream` included (it exited 2 there), as TypeScript does. So does a header whose value holds a character HTTP does not allow (a line break, a vertical tab, another control character), which before reached the HTTP encoder, whose error repeated it. The message names where the header came from (`--header 2`, `AFD_HEADERS line 3`, counting blank lines) and never repeats any of it, since it may hold a credential.

### Fixed

- **`afd connect --timeout`** is now used for the connection (it was ignored) and must be finite and greater than 0.
- **`call`, `connect`, `tools` and `validate` print the text of an exception without Rich markup** and strip terminal escape sequences from it (a command's own failed result is still rendered as before), as `batch` and `stream` do; so does the shell for a malformed argument, after which it now waits for the next command instead of ending.
