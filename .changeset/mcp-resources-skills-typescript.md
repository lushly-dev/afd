---
'@lushly-dev/afd-server': minor
'@lushly-dev/afd-core': minor
---

Serve MCP resources, Agent Skills and per-command tool `_meta` (`spec/mcp-resources.md`). `createMcpServer` and `createMcpHandler` take `resources` (a `ResourceProvider` or static entries) and `skills` (a `SkillCatalog`, with `skillFromDirectory` to read one from disk): the server declares `resources` and the `io.modelcontextprotocol/skills` extension, answers `resources/list`, `resources/read`, `resources/templates/list`, `skills/list`, `skills/get` and, when the catalog enables it, `resources/directory/read`, on `/mcp` and stdio in both MCP eras, with `ttlMs` and `cacheScope` on 2026-07-28 results and `dev.afd/digest` on every skill file. `defineCommand` gains `toolMeta` (reverse-DNS keys or MCP Apps' `ui`, emitted on the command's tool, grouped action entry and `afd-detail`, refused by the server for any other key) and `advertisedInputSchema` (the schema every surface shows while Zod still validates). A server that uses none of it is unchanged. `@lushly-dev/afd-server` adds a `yaml` dependency for skill frontmatter; `@lushly-dev/afd-core`'s `CommandDefinition` gains `toolMeta` and `commandToolMeta` emits it.
