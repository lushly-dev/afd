---
"@lushly-dev/afd-server": minor
---

Deliver declared context fields over MCP (`spec/context-fields.md`). `tools/call` reads each declared field from `params._meta[meta]` on both protocol eras, over Streamable HTTP and stdio; undeclared `_meta` keys are still dropped, and a value `createContext` sets for the same name wins. AFD's HTTP lanes read `_meta` too: `/message` and `/rpc` from `params._meta`, `/stream` from its input's `_meta` member, and `/batch` from the request body, with `_meta` left out of the command input. `server/discover` lists the fields under `_meta["dev.afd/context-fields"]` and `afd-help` returns them as `contextFields`, each with its JSON Schema. `tools/list` does not vary by a field.
