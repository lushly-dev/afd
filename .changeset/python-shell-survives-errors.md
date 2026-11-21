---
"afd-python": patch
---

### Fixed

- **`afd shell` keeps running when a request fails** (#1835), as TypeScript's shell does: a failed `call` prints "Call failed: ..." and a failed `tools` prints "Listing tools failed: ...", both without terminal escapes or Rich markup, and the prompt returns. Before, the exception ended the shell with a traceback. `call` without a name prints its usage, and an unknown command is echoed literally, so `[/x]` in it no longer raises a Rich markup error.
