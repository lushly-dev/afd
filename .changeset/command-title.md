---
"@lushly-dev/afd-core": minor
"@lushly-dev/afd-server": minor
"@lushly-dev/afd-client": minor
---

Add an optional command `title` (`spec/command-metadata.md`, "Tool titles", #466). `defineCommand({ title })` and core `CommandDefinition.title` set a short display label. A command's own MCP tool (individual, and first-class under `hybrid`) carries it as the tool `title`, `afd-detail` reports it, `afd-help` reports it in the `full` format, and `DirectRegistry.listCommands()` includes it. Nothing is derived from the name, so a command without `title` lists exactly as before, and it never appears in `_meta`; grouped tools carry none. The five meta-tools now carry fixed titles from `spec/meta-tools.json`, such as `Call a command` for `afd-call`. `McpTool` gains `title`.
