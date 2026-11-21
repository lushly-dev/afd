---
"afd-python": patch
---

### Fixed

- **`afd shell` keeps running when a request fails** (#1835), as TypeScript's shell does: a failed `call` prints "Call failed: ..." and a failed `tools` prints "Listing tools failed: ...", and the prompt returns. Before, the exception ended the shell with a traceback. `call` followed by a tab is a call, and a bare `call` prints its usage instead of "Unknown command".
- **The CLI prints server text as written.** A result's error code, message and suggestion, reasoning, plan steps and alternatives, tool names and descriptions, and the messages of `afd validate`, `connect` and the other commands are shown as plain text: terminal escape sequences are stripped, and Rich does not read `[/x]` as markup or `:smile:` as an emoji. So are `afd validate --surface` findings and the shell's `help`. `--json` output from `tools`, `status` and `validate` is printed as JSON without Rich, as `call --json` already was, so it is exactly what the server sent. Before, such text could end `afd call`, `afd tools`, `validate` or the shell with a Rich markup error, or change what was shown or emitted.
