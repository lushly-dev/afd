---
"afd-python": minor
---

### Added

- Per-caller `ResourceProvider` support under MCP authorization (`afd.server.ResourceCaller` passed to `list` and `read` when accepted, preserving existing 0-arg `list()` and 1-arg `read(uri)` providers), forwarding verified credentials on Streamable HTTP (both eras), SSE and host-admitted (`server.admit`) requests, returning `-32602` (`Resource not found`) identically for unreadable and absent URIs, and emitting modern-era `cacheScope: "private"` on `resources/list` and provider-backed `resources/read` when a resource provider or static resource entries are configured alongside `auth` (or verified credentials) while keeping skills-only servers and static `SkillCatalog` reads `"public"` (spec/authorization.md M6, spec/mcp-resources.md R3/R4).
