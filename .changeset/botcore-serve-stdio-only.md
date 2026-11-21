---
"lushly-botcore": minor
---

### Changed

- **`botcore serve` serves only over stdio.** Its run tool executes any Python its client sends, so `--transport sse` is now refused with exit code 2 and a pointer to a managed host (`create_host_mcp_server`), which serves commands over HTTP under an explicit command policy and host tokens. Code that calls `create_mcp_server(...).run(transport="sse")` directly is unchanged.
