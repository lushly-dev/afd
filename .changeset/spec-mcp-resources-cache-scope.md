---
"afd-spec": patch
---

Align `spec/mcp-resources.md` R3 and R4 with MCP authorization's per-caller resource providers (`list_for`/`read_for`, #1880): modern-era `resources/list` and provider-backed `resources/read` results carry `cacheScope: "private"` whenever a `ResourceProvider` is attached on a server that supports per-caller providers and authorization is configured or the request carries verified credentials, while static `SkillCatalog` reads, `resources/templates/list`, `skills/*`, `resources/directory/read`, and unauthenticated or skills-only servers keep `cacheScope: "public"` (#1905).
