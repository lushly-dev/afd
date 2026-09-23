---
'@lushly-dev/afd-core': patch
'@lushly-dev/afd-server': patch
---

Resolve command exposure per flag everywhere, as `ExposeOptions` documents: each flag a command's `expose` leaves out falls back to `defaultExpose`. The core registry (`listByExposure`, `execute` with `context.interface`) used to treat any explicit `expose` object as replacing all defaults, so `expose: { mcp: true }` hid a command from the in-app agent and palette, unlike `createDirectRegistry` and the Python implementation. MCP and CLI stay opt-in. New `isExposedTo(command, interface)` helper.
