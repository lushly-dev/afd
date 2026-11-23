---
'@lushly-dev/afd-server': minor
---

Extend `ResourceProvider` additively with optional `ResourceCaller` (`{ credentials?: Credentials }`) on `list(caller?)` and `read?(uri, caller?)` so providers can filter `resources/list` and gate `resources/read` per verified caller under MCP authorization (`spec/authorization.md`, M6; `spec/mcp-resources.md`, R3/R4; #2265). Verified request credentials are forwarded on Streamable HTTP (both MCP eras) and host-admitted (`handler.admit`) requests, returning `-32602` (`Resource not found`) identically for unreadable and absent URIs. Modern-era `resources/list` and provider-backed `resources/read` results emit `cacheScope: "private"` whenever a `ResourceProvider` is attached on an authorized server or a request carries verified credentials, while static `SkillCatalog` reads, `resources/templates/list`, `skills/*`, and unauthenticated or skills-only servers keep `cacheScope: "public"`.
