---
"@lushly-dev/afd-server": patch
---

`afd-detail` now reports a command's `requires`, `examples` and `contexts` when it declares them, as the tool's `_meta` already did (#474). Under the lazy strategy it is the only place an agent sees a command's full contract, and `afd validate --surface` against a lazy server reads the prerequisite graph and examples from it. On a server with MCP authorization, `requires` names only the commands that exist for the caller. Empty lists are left out.
