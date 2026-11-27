---
"@lushly-dev/afd-client": patch
---

**The streamable-http transport passes `resources/list` and `resources/read`.** It answered both with `-32601` ("Method not supported by the streamable-http transport"), so a client could not list or read a server's resources, such as an MCP Apps `ui://` view, over either MCP era. Both now reach the server as `skills/list` and `skills/get` do, and a server's own error comes back as a JSON-RPC error.
