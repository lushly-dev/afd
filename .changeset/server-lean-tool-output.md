---
'@lushly-dev/afd-server': patch
---

Cut the token cost of tool output. MCP tool results are now compact JSON instead of pretty-printed. A `COMMAND_NOT_FOUND` suggestion from command execution (direct tool calls, `/rpc`, batch entries, pipeline steps) no longer lists every command name, which defeated the lazy strategy: like `afd-call` and `afd-detail`, it names at most three close matches (bounded fuzzy matching, only commands callable in the active context) and points to `afd-discover`. All three now share one wording: `Did you mean 'a'? Other close matches: 'b', 'c'. Use afd-discover to list all commands.` `afd-detail` entries for unknown names echo the name cut to 128 characters plus `…` in their `name` field instead of the full request (up to about 88 KB each); found commands keep their exact name.
