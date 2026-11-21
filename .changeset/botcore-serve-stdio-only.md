---
"lushly-botcore": minor
---

### Security

- **`botcore serve` serves only over stdio.** Its run tool executes any Python its client sends, so `--transport sse` is now refused with exit code 2 and a pointer to `botcore.host_http` (`create_host_http_app` or `serve_hosts`), which serves a managed host's commands over HTTP behind bearer tokens from `botcore host-token issue`. Code that calls `create_mcp_server(...).run(transport="sse")` directly is unchanged.
