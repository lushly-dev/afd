---
"afd-python": patch
---

### Fixed

- **`command_result_output_schema`** keeps `$defs` and `definitions` inside `data` when the output schema has its own `$id`, so MCP clients can resolve local references (#1474).
