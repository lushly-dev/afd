---
"@lushly-dev/afd-server": patch
---

An MCP task whose command returned a result JSON cannot hold (a `BigInt`, a cycle) now ends `failed` with `error: { code: -32603, message: "Internal error" }`, as Python and Rust do. Before, building its result threw outside the task runner's guard: the rejection went unhandled, which ends a Node process by default (a stdio server closed its connection), and otherwise the task stayed `working` until its TTL ran out.
