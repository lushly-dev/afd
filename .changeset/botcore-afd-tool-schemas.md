---
"lushly-botcore": patch
---

### Fixed

- **`create_host_mcp_server` keeps working with the next `afd` release**, which no longer registers tools in the MCP SDK's tool manager (lushly-dev/afd#1756): the compatibility aliases' input schemas, which the SDK checks `Mcp-Param` headers against, are given to `afd`'s own table when it has one, and to the SDK's tool manager on `afd` 0.13. Enabling telemetry no longer imports the deprecated `afd.server.middleware.TelemetrySink`.
