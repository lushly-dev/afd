---
"@lushly-dev/afd-core": patch
---

`commandResultOutputSchema` moves `$defs` and `definitions` to the envelope root for output schemas without an `$id` (#1416). Schemas with their own `$id` keep both sets of definitions inside `data`, so MCP clients can resolve local references when validating command results (#1474).
