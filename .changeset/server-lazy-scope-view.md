---
"@lushly-dev/afd-server": patch
---

With MCP authorization, a request's scope view decides which commands exist for its caller, and which it is shown, on the first question that needs them, so a request that never consults them, such as `/health` or `GET /sse`, no longer asks a scope resolver about every command; a task the request creates still has them decided before it starts. A host's `preDispatchCheck` and the handler now share one view for a vouched request instead of building it twice.
