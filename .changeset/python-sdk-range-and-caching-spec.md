---
"afd-spec": patch
---

`INVALID_COMMAND_RESULT` ([`spec/error-codes.md`](https://github.com/lushly-dev/afd/blob/main/spec/error-codes.md), "Other codes a result can carry") now covers every path in Python: a handler or middleware that returns something other than a `CommandResult` gets it on a single call, a batch item, a pipeline step and a stream, in the MCP server, the command registry and `DirectClient` alike, and a dict with a boolean `success` is parsed as a result instead. It stays Python-only; TypeScript does not check this at runtime.
