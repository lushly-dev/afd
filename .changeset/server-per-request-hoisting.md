---
"@lushly-dev/afd-server": patch
---

Build once what every request rebuilt ([#1746](https://github.com/lushly-dev/afd/issues/1746)). Performance only: no result, list content or order changes.

- `tools/list` is memoised: each command's tool, each grouped tool's per-command pieces and each group's tool are built once, and a whole list is kept for each configured context when no scope view narrows it. A list a view narrows is assembled from the same pieces.
- The router looks a call's command up by name and its group in groups built once, instead of scanning every command on each call; a scope view's command list is filtered only on the routes that need it.
- The `/mcp` lane still builds an SDK `Server` per request, as the SDK's stateless handler requires, but builds its capabilities, cache hints and described context fields once per server.
- A stdio server builds no HTTP runtime: no session store, authorization layer, `/mcp` lane, HTTP handler or SSE hub. It still refuses the HTTP options an HTTP server would refuse, with the same errors.
