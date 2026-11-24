---
"lushly-botcore": minor
---

### Added

- **`create_host_mcp_server(host, command_tools=True)` serves each command as its own MCP tool**, named as the host serves it, beside the `start`, `call` and `docs` meta-tools. Each tool publishes the host catalog's input schema and `readOnlyHint`/`destructiveHint` annotations from the command's declared effects, so a client's permission rules can tell a write from a read. The SDK does not model a command tool's arguments (SDK 2 only compares `Mcp-Param` headers with the catalog schema, which declares none): they reach `host.execute` whole, so the host stays the only validator, a `**kwargs` handler is served, and bad input is refused in AFD's error shape. A command named like a meta-tool (`-start`, `-call`, `-docs`, or `-run` even without raw Python) is refused when the server is built. The annotations are hints for a client's rules: `-call` still reaches every command.
